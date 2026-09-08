import { createHash } from "node:crypto";

import type { EvaluationResult } from "../../../registry/src/index.ts";
import { UNCLASSIFIED_CLASS, type PolicyCall, type PolicyDecision } from "../../../policy/src/index.ts";
import { holdErrorMessage, type HeldCall, type HoldResolution } from "../../../policy/src/index.ts";

import type { JsonRpcError, JsonRpcResult } from "../rpc.ts";

export type { JsonRpcError, JsonRpcResult } from "../rpc.ts";

export type InterceptedCall = {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly connector: string;
  readonly workspace?: string;
};

export type CallVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly error: JsonRpcError }
  | { readonly kind: "hold"; readonly promise: Promise<JsonRpcResult | JsonRpcError> };

export type LedgerEntryInput = {
  readonly at: string;
  readonly tool: string;
  readonly klass: string;
  readonly decision: string;
  readonly argsDigest: string;
};

export type InterceptDeps = {
  readonly classify: () => EvaluationResult;
  readonly policy: (call: PolicyCall) => PolicyDecision;
  readonly hold: (seconds: number) => Promise<HoldResolution>;
  readonly ledger: (entry: LedgerEntryInput) => void;
  readonly now?: () => Date;
};

const ERROR_CODE = -32003;
const BLAST_KEYS = ["rows", "count", "limit", "n"] as const;

export async function interceptCall(
  call: InterceptedCall,
  deps: InterceptDeps,
): Promise<CallVerdict> {
  const now = deps.now ?? (() => new Date());
  const digest = digestArgs(call.args);
  try {
    const classification = deps.classify();
    const policyCall = buildPolicyCall(call, classification);
    const decision = deps.policy(policyCall);
    // The decision record lands before the verdict, so a crash after the
    // decision still leaves the ledger saying what was about to happen.
    await writeLedger(deps, now, call.tool, policyCall.klass, decision.kind, digest);

    if (decision.kind === "allow") {
      await writeLedger(deps, now, call.tool, policyCall.klass, "allow:resolved", digest);
      return { kind: "allow" };
    }

    if (decision.kind === "deny" || decision.kind === "unmatched") {
      const error = decision.kind === "deny"
        ? denyError(call, policyCall, decision.ruleIndex, decision.rationale)
        : denyError(call, policyCall, -1, `policy returned ${decision.decision}`);
      await writeLedger(deps, now, call.tool, policyCall.klass, `${decision.kind}:resolved`, digest);
      return { kind: "deny", error };
    }

    const heldCall = toHeldCall(call, policyCall, decision);
    const promise = deps.hold(decision.seconds).then(async (resolution) => {
      if (resolution.outcome.kind === "released" && resolution.outcome.release.kind === "approved") {
        await writeLedger(deps, now, call.tool, policyCall.klass, "hold:approved", digest);
        return { jsonrpc: "2.0", id: 0, result: { approved: true } } satisfies JsonRpcResult;
      }
      const result = resolution.outcome.kind === "expired" ? "expired" : "denied";
      await writeLedger(deps, now, call.tool, policyCall.klass, `hold:${result}`, digest);
      return holdError(resolution.call, resolution.outcome, "hold");
    });
    void heldCall;
    return { kind: "hold", promise };
  } catch (error) {
    const policyCall = {
      tool: call.tool,
      connector: call.connector,
      workspace: call.workspace,
      klass: UNCLASSIFIED_CLASS,
      blastRadius: extractBlastRadius(call.args),
    };
    return { kind: "deny", error: denyError(call, policyCall, -1, error instanceof Error ? error.message : String(error)) };
  }
}

function buildPolicyCall(call: InterceptedCall, classification: EvaluationResult): PolicyCall {
  const klass = classification.outcome === "classified" ? classification.tone : UNCLASSIFIED_CLASS;
  return {
    tool: call.tool,
    connector: call.connector,
    workspace: call.workspace,
    klass,
    blastRadius: extractBlastRadius(call.args),
  };
}

function extractBlastRadius(args: Readonly<Record<string, unknown>>): number | undefined {
  for (const key of BLAST_KEYS) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function digestArgs(args: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex");
}

function writeLedger(
  deps: InterceptDeps,
  now: () => Date,
  tool: string,
  klass: string,
  decision: string,
  argsDigest: string,
): void {
  deps.ledger({ at: now().toISOString(), tool, klass, decision, argsDigest });
}

function denyError(
  call: InterceptedCall,
  policyCall: PolicyCall,
  ruleIndex: number,
  rationale: string | undefined,
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    error: {
      code: ERROR_CODE,
      message:
        `The call to ${call.tool} (${policyCall.klass}, blast radius ${policyCall.blastRadius ?? "unknown"}) was denied. ` +
        `Rule ${ruleIndex} denied it${rationale === undefined ? "." : `: ${rationale}.`} ` +
        "Do not retry the same call; VOID rejected it.",
      data: {
        tool: call.tool,
        class: policyCall.klass,
        blastRadius: policyCall.blastRadius,
        rule: ruleIndex,
        rationale,
        retry: "do-not-retry",
      },
    },
  };
}

function toHeldCall(
  call: InterceptedCall,
  policyCall: PolicyCall,
  decision: Extract<PolicyDecision, { readonly kind: "hold" }>,
): HeldCall {
  const heldAt = Date.now();
  return {
    id: "pending",
    tool: call.tool,
    klass: policyCall.klass,
    blastRadius: policyCall.blastRadius,
    ruleIndex: decision.ruleIndex,
    rationale: decision.rationale,
    args: call.args,
    heldAt,
    expiresAt: heldAt + decision.seconds * 1000,
    notify: decision.notify,
  };
}

function holdError(
  call: HeldCall,
  outcome: HoldResolution["outcome"],
  decision: "hold" | "deny" | "allow",
): JsonRpcError {
  const body = holdErrorMessage(call, outcome, decision);
  return {
    jsonrpc: "2.0",
    error: {
      code: ERROR_CODE,
      message: body.message.includes("Do not retry") ? body.message : `${body.message} Do not retry the same call; VOID rejected it.`,
      data: body.data,
    },
  };
}
