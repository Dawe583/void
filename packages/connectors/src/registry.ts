import { applyInverse, type ApplyInverseReport } from "./postgres/replay.ts";
import { buildInverse, type InverseStep as PostgresInverseStep } from "./postgres/inverse.ts";
import { captureBeforeImage, type BeforeImage, type CaptureSchema, type QueryExecutor } from "./postgres/capture.ts";
import { connectorFacts } from "./postgres/classify.ts";
import { parseStatement } from "./postgres/parse.ts";
import { applyRestore, type ApplyReport as S3ApplyReport, type ApplyRestoreInput } from "./s3/apply.ts";
import { captureObject } from "./s3/capture.ts";
import type { SnapshotReference, SnapshotStore } from "./snapshot/store.ts";
import { s3Facts, type ConnectorFact, type S3Client, type S3DeleteCall } from "./s3/classify.ts";
import { pickProbes, type Probe } from "./probes/registry.ts";

export type ConnectorId = "postgres" | "s3";
export type RegistryEntryId = string;
export type ReversibilityClass = "r0" | "r1" | "r2" | "r3";
export type FactValue = string | boolean;
export type { ConnectorFact } from "./s3/classify.ts";
export type { SnapshotReference, SnapshotStore } from "./snapshot/store.ts";
export type { QueryExecutor } from "./postgres/capture.ts";
export type { S3Client } from "./s3/classify.ts";

export type ConnectorCall = {
  readonly tool: RegistryEntryId;
  readonly connector: ConnectorId;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly workspace: string | undefined;
};

export type ClassifiedCallFacts = {
  readonly call: ConnectorCall;
  readonly facts: readonly ConnectorFact[];
  readonly blastRadius: number | undefined;
  readonly notes: readonly string[];
};

export type CaptureResult = {
  readonly reference: SnapshotReference;
  readonly digest: `sha256:${string}`;
  readonly facts: readonly ConnectorFact[];
  readonly capturedAt: string;
};

export type InverseStep = {
  readonly id: string;
  readonly target: string;
  readonly operation: string;
  readonly dependsOn: readonly string[];
  readonly inputDigest: `sha256:${string}`;
};

export type InversePlan = {
  readonly connector: ConnectorId;
  readonly call: ConnectorCall;
  readonly capture: SnapshotReference;
  readonly steps: readonly InverseStep[];
  readonly facts: readonly ConnectorFact[];
};

export type DriftChange = {
  readonly target: string;
  readonly key: Readonly<Record<string, string>>;
  readonly field: string;
  readonly capturedDigest: `sha256:${string}`;
  readonly currentDigest: `sha256:${string}`;
};

export type ReplayRefusal = {
  readonly stepId: string;
  readonly reason: "drift" | "missing_target" | "permission_denied" | "internal_error";
  readonly changed: readonly DriftChange[];
  readonly report?: string;
};

export type ApplyReport = {
  readonly applied: readonly string[];
  readonly refused: readonly ReplayRefusal[];
};

export type Connector = {
  readonly id: ConnectorId;
  readonly surface: string;
  readonly probes: readonly Probe[];
  readonly classify: (call: ConnectorCall) => Promise<ClassifiedCallFacts>;
  readonly capture: (call: ConnectorCall) => Promise<CaptureResult>;
  readonly inverse: (capture: SnapshotReference) => Promise<InversePlan>;
  readonly apply: (plan: InversePlan) => Promise<ApplyReport>;
};

export type ConnectorRegistry = Readonly<Record<ConnectorId, Connector>>;

export type ConnectorDeps = {
  readonly store: SnapshotStore;
  readonly exec?: QueryExecutor;
  readonly s3?: S3Client;
};

type StoredPostgresCapture = {
  readonly call: ConnectorCall;
  readonly image: BeforeImage;
  readonly steps: readonly PostgresInverseStep[];
};

type PostgresPlan = InversePlan & {
  readonly postgres: StoredPostgresCapture;
};

type StoredS3Capture = {
  readonly call: ConnectorCall;
  readonly input: ApplyRestoreInput;
  readonly facts: readonly ConnectorFact[];
};

type S3Plan = InversePlan & {
  readonly s3: StoredS3Capture;
};

export function connectorRegistry(): ConnectorRegistry {
  return makeConnector({ store: missingSnapshotStore() });
}

export function makeConnector(deps: ConnectorDeps): ConnectorRegistry {
  const postgresCaptures = new Map<string, StoredPostgresCapture>();
  const s3Captures = new Map<string, StoredS3Capture>();

  return {
    postgres: makePostgresConnector(deps, postgresCaptures),
    s3: makeS3Connector(deps, s3Captures),
  };
}

export function connectorFor(tool: string): { readonly connectorId: ConnectorId; readonly connector: Connector } | null {
  const vendor = tool.startsWith("aws.s3.") ? "s3" : tool.split(".")[0];
  if (vendor !== "postgres" && vendor !== "s3") {
    // Unknown vendors return null so callers deny instead of guessing a connector.
    return null;
  }
  const registry = connectorRegistry();
  return { connectorId: vendor, connector: registry[vendor] };
}

function makePostgresConnector(deps: ConnectorDeps, captures: Map<string, StoredPostgresCapture>): Connector {
  return {
    id: "postgres",
    surface: "postgres",
    probes: pickProbes("postgres"),
    classify: async (call) => {
      const statement = parseStatement(sqlArgument(call));
      const now = new Date().toISOString();
      return {
        call,
        blastRadius: undefined,
        notes: statement.type === "other" ? ["postgres statement did not match a reversible write shape"] : [],
        facts: [
          { name: "pg.statement.type", value: statement.type, source: "derived", verifiedAt: now },
          { name: "pg.statement.returning", value: statement.returning, source: "derived", verifiedAt: now },
        ],
      };
    },
    capture: async (call) => {
      const exec = requireDependency(deps.exec, "postgres exec");
      const statement = parseStatement(sqlArgument(call));
      const image = await captureBeforeImage(exec, statement, schemaArgument(call));
      const bytes = encodeJson({ version: "void.postgres.capture.v1", call, image });
      const result = await deps.store.put(snapshotNamespace(call, "postgres"), bytes, {
        tool: call.tool,
        connector: "postgres",
        workspace: call.workspace ?? "",
      });
      const facts = factsFromRecord(connectorFacts(statement, image), image.capturedAt);
      const steps = buildInverse(statement, image);
      captures.set(captureKey(result.reference), { call, image, steps });
      return { reference: result.reference, digest: result.digest, facts, capturedAt: image.capturedAt };
    },
    inverse: async (reference) => {
      const stored = await readPostgresCapture(deps.store, reference);
      const steps = stored.steps.map(postgresStepToPlanStep);
      return {
        connector: "postgres",
        call: stored.call,
        capture: reference,
        steps,
        facts: factsFromRecord(connectorFacts(stored.image.statement, stored.image), stored.image.capturedAt),
        postgres: stored,
      } satisfies PostgresPlan;
    },
    apply: async (plan) => {
      const exec = requireDependency(deps.exec, "postgres exec");
      postgresPlan(plan);
      const stored = await readPostgresCapture(deps.store, plan.capture);
      if (JSON.stringify(plan.steps) !== JSON.stringify(stored.steps.map(postgresStepToPlanStep))) throw new Error("Inverse plan differs from its captured snapshot.");
      try {
        return postgresApplyReport(await applyInverse(exec, stored.steps, stored.image));
      } catch {
        // Driver exceptions can contain SQL values or connection credentials.
        return { applied: [], refused: [{ stepId: "transaction", reason: "internal_error", changed: [] }] };
      }
    },
  };
}

function makeS3Connector(deps: ConnectorDeps, captures: Map<string, StoredS3Capture>): Connector {
  return {
    id: "s3",
    surface: "s3",
    probes: pickProbes("s3"),
    classify: async (call) => {
      const client = requireDependency(deps.s3, "s3 client");
      const result = await s3Facts(s3Call(call), client);
      return {
        call,
        facts: result.facts,
        blastRadius: undefined,
        notes: result.errors.map((error) => error.message),
      };
    },
    capture: async (call) => {
      const client = requireDependency(deps.s3, "s3 client");
      const result = await captureObject(deps.store, client, s3Call(call));
      const input = {
        stepId: `restore-${result.digest}`,
        call: s3Call(call),
        reference: result.reference,
        capturedEtag: result.etag,
      };
      const stored = { call, input, facts: result.facts };
      // Bind the target and before-image reference into one content-addressed
      // envelope so replay after a restart never guesses a bucket or object key.
      const envelope = await deps.store.put(snapshotNamespace(call, "s3"), encodeJson({ version: "void.s3.capture.v1", ...stored }));
      captures.set(captureKey(envelope.reference), stored);
      return { reference: envelope.reference, digest: envelope.digest, facts: result.facts, capturedAt: result.capturedAt };
    },
    inverse: async (reference) => {
      const stored = await readS3Capture(deps.store, reference);
      return {
        connector: "s3",
        call: stored.call,
        capture: reference,
        steps: [{
          id: stored.input.stepId,
          target: `s3://${stored.input.call.bucket}/${stored.input.call.key}`,
          operation: "putObject",
          dependsOn: [],
          inputDigest: stored.input.reference.digest,
        }],
        facts: stored.facts,
        s3: stored,
      } satisfies S3Plan;
    },
    apply: async (plan) => {
      const client = requireDependency(deps.s3, "s3 client");
      s3Plan(plan);
      const stored = await readS3Capture(deps.store, plan.capture);
      if (plan.steps.length !== 1 || plan.steps[0]?.inputDigest !== stored.input.reference.digest || plan.steps[0]?.target !== `s3://${stored.input.call.bucket}/${stored.input.call.key}`) throw new Error("Inverse plan differs from its captured snapshot.");
      return s3ApplyReport(await applyRestore(deps.store, client, stored.input));
    },
  };
}

async function readS3Capture(store: SnapshotStore, reference: SnapshotReference): Promise<StoredS3Capture> {
  const value = JSON.parse(new TextDecoder().decode(await store.get(reference)));
  if (value?.version !== "void.s3.capture.v1" || value.call?.connector !== "s3" ||
    typeof value.call?.tool !== "string" || typeof value.input?.stepId !== "string" ||
    typeof value.input?.call?.bucket !== "string" || typeof value.input?.call?.key !== "string" ||
    typeof value.input?.reference?.digest !== "string" || !Array.isArray(value.facts))
    throw new Error("invalid persisted S3 capture");
  return { call: value.call, input: value.input, facts: value.facts };
}

async function readPostgresCapture(store: SnapshotStore, reference: SnapshotReference): Promise<StoredPostgresCapture> {
  const parsed = JSON.parse(new TextDecoder().decode(await store.get(reference)));
  const image = (parsed.version === "void.postgres.capture.v1" ? parsed.image : parsed) as BeforeImage;
  if (!image || !Array.isArray(image.rows) || !["update", "delete"].includes(image.statement?.type)) throw new Error("invalid persisted Postgres capture");
  const call: ConnectorCall = {
    tool: image.statement.sql.startsWith("delete") ? "postgres.row.delete" : "postgres.row.update",
    connector: "postgres",
    arguments: { sql: image.statement.sql },
    workspace: undefined,
  };
  return { call: parsed.version === "void.postgres.capture.v1" ? parsed.call : call, image, steps: buildInverse(image.statement, image) };
}

function sqlArgument(call: ConnectorCall): string {
  const sql = call.arguments.sql ?? call.arguments.query ?? call.arguments.statement;
  if (typeof sql !== "string" || sql.trim() === "") throw new Error("postgres connector requires a sql argument");
  return sql;
}

function schemaArgument(call: ConnectorCall): CaptureSchema {
  const schema = call.arguments.schema;
  if (isCaptureSchema(schema)) return schema;
  throw new Error("postgres connector requires a schema argument for capture");
}

function s3Call(call: ConnectorCall): S3DeleteCall {
  const bucket = call.arguments.bucket;
  const key = call.arguments.key;
  const versionId = call.arguments.versionId;
  if (typeof bucket !== "string" || bucket === "") throw new Error("s3 connector requires a bucket argument");
  if (typeof key !== "string" || key === "") throw new Error("s3 connector requires a key argument");
  if (versionId !== undefined && typeof versionId !== "string") throw new Error("s3 connector versionId must be a string when present");
  return versionId === undefined ? { bucket, key } : { bucket, key, versionId };
}

function snapshotNamespace(call: ConnectorCall, fallback: ConnectorId): string {
  return call.workspace === undefined ? fallback : `${fallback}-${call.workspace}`;
}

function factsFromRecord(record: Readonly<Record<string, string>>, verifiedAt: string): readonly ConnectorFact[] {
  return Object.entries(record).map(([name, value]) => ({ name, value, source: "captured", verifiedAt }));
}

function postgresStepToPlanStep(step: PostgresInverseStep): InverseStep {
  return {
    id: step.id,
    target: step.table,
    operation: step.operation,
    dependsOn: step.dependsOn,
    inputDigest: step.inputDigest,
  };
}

function postgresApplyReport(report: ApplyInverseReport): ApplyReport {
  return {
    applied: report.applied,
    refused: report.refused.map((refusal) => ({
      stepId: refusal.stepId,
      reason: refusal.reason,
      changed: [],
      ...(refusal.reason === "drift" ? { report: refusal.report } : {}),
    })),
  };
}

function s3ApplyReport(report: S3ApplyReport): ApplyReport {
  return report;
}

function postgresPlan(plan: InversePlan): PostgresPlan {
  if (!("postgres" in plan)) throw new Error("postgres apply requires a plan created by the postgres connector");
  return plan as PostgresPlan;
}

function s3Plan(plan: InversePlan): S3Plan {
  if (!("s3" in plan)) throw new Error("s3 apply requires a plan created by the s3 connector");
  return plan as S3Plan;
}

function requireDependency<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`missing ${name} dependency`);
  return value;
}

function captureKey(reference: SnapshotReference): string {
  return `${reference.digest}:${reference.uri}`;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function isCaptureSchema(value: unknown): value is CaptureSchema {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return Array.isArray(record.tables);
}

function missingSnapshotStore(): SnapshotStore {
  return {
    put: async () => {
      throw new Error("missing snapshot store dependency");
    },
    get: async () => {
      throw new Error("missing snapshot store dependency");
    },
    retention: async (namespace) => ({
      namespace,
      retainedBytes: 0,
      deleteOlderThan: async () => ({ deleted: 0, freedBytes: 0, errors: [] }),
    }),
  };
}
