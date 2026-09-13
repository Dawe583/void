import { managedFilesystemAdapter } from "../../connectors/src/filesystem/managed.ts";
import { readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  reservedRecoveryVault,
  digest,
  type ExecutionRequest,
  type RecoveryPlan,
} from "../../runtime/src/index.ts";
import {
  managedPostgresAdapter,
  installManagedPostgres,
  type ManagedPostgresOptions,
} from "../../connectors/src/postgres/managed.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { recoveryMcpServer } from "./recovery-mcp.ts";
import { loadPolicy, decide } from "../../policy/src/index.ts";
import { postgresExecutor } from "./postgres.ts";
type Config = {
  vaultCapacity?: { maxArtifactBytes: number; maxTotalBytes: number };
  policyPath?: string;
  agentId?: string;
  workspace: string;
  stateDir: string;
  encryptionKeyEnv: string;
  filesystem?: { root: string; cooperative: true };
  postgres?: {
    schema: string;
    tables: ManagedPostgresOptions["tables"];
    urlEnv: string;
  };
};
export async function runRecoveryCommand(
  argv: readonly string[],
  env: Readonly<NodeJS.ProcessEnv> = process.env,
  print: (s: string) => void = console.log,
): Promise<number> {
  const [action, ...rest] = argv;
  const args = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !["--config", "--input", "--approve"].includes(rest[i] ?? "") ||
      !rest[i + 1] ||
      args.has(rest[i]!)
    )
      throw new Error("Invalid recovery arguments.");
    args.set(rest[i]!, rest[i + 1]!);
  }
  if (
    ![
      "install",
      "inspect",
      "execute",
      "plan",
      "apply",
      "reconcile",
      "reconcile-recovery",
      "serve",
    ].includes(action ?? "") ||
    !args.get("--config")
  )
    throw new Error(
      "usage: void recovery <install|inspect|execute|plan|apply|reconcile|reconcile-recovery|serve> --config file [--input file] [--approve digest]",
    );
  const configPath = resolve(args.get("--config")!),
    config = JSON.parse(await readFile(configPath, "utf8")) as Config;
  if (
    !/^[\w-]{1,100}$/.test(config.workspace) ||
    !config.stateDir ||
    Boolean(config.postgres) === Boolean(config.filesystem)
  )
    throw new Error("Invalid recovery configuration.");
  const postgres = config.postgres;
  const url = postgres ? env[postgres.urlEnv] : undefined;
  if (postgres && !url)
    throw new Error("Configured Postgres URL environment variable is absent.");
  const options: ManagedPostgresOptions | undefined = postgres
    ? {
        workspace: config.workspace,
        schema: postgres.schema,
        tables: postgres.tables,
        connect: () => postgresExecutor(url!),
      }
    : undefined;
  if (action === "install") {
    if (!options)
      throw new Error(
        "Filesystem needs no installation. Configure an existing cooperative root.",
      );
    await installManagedPostgres(options);
    print(
      JSON.stringify({
        installed: true,
        workspace: config.workspace,
        tables: options.tables.map((t) => t.table),
      }),
    );
    return 0;
  }
  if (action !== "serve" && !args.get("--input"))
    throw new Error("--input is required.");
  const input =
    action === "serve"
      ? { workspace: config.workspace }
      : JSON.parse(await readFile(resolve(args.get("--input")!), "utf8"));
  if (input.workspace !== config.workspace)
    throw new Error("Input belongs to another workspace.");
  if (config.filesystem) {
    const root = resolve(dirname(configPath), config.filesystem.root);
    const state = resolve(dirname(configPath), config.stateDir);
    if (state === root || state.startsWith(root + "/"))
      throw new Error(
        "Recovery state must be outside the managed filesystem root.",
      );
  }
  const adapter = options
    ? managedPostgresAdapter(options)
    : managedFilesystemAdapter({
        root: resolve(dirname(configPath), config.filesystem!.root),
        cooperative: config.filesystem!.cooperative,
      });
  if (action === "inspect") {
    const request = input as ExecutionRequest;
    if (request.adapterId !== adapter.id)
      throw new Error("Adapter does not match configuration.");
    const observation = await adapter.preflight(request.arguments);
    print(
      JSON.stringify(
        {
          request,
          observation,
          approvalDigest: digest({
            requestDigest: digest(request),
            adapterVersion: adapter.version,
            observation,
          }),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const state = resolve(dirname(configPath), config.stateDir),
    key = Buffer.from(env[config.encryptionKeyEnv] ?? "", "base64");
  if (key.length !== 32)
    throw new Error(
      "Configured recovery encryption key must be 32 bytes in base64.",
    );
  const signer = await devKeyProvider({ dir: join(state, "keys"), env: {} });
  const policy = async () => {
    if (!config.policyPath)
      return { ok: false, errors: ["No policy configured."] } as const;
    return loadPolicy(
      await readFile(resolve(dirname(configPath), config.policyPath), "utf8"),
    );
  };
  const allowed = async (
    tool: string,
    klass: string,
    blastRadius: number | undefined,
  ) => {
    try {
      const loaded = await policy();
      return (
        loaded.ok &&
        decide(loaded, {
          tool,
          connector: options ? "postgres" : "filesystem",
          workspace: config.workspace,
          klass,
          blastRadius,
        }).kind === "allow"
      );
    } catch {
      return false;
    }
  };
  const runtime = recoveryRuntime({
    journal: localOperationJournal(join(state, "journal"), signer),
    vault: reservedRecoveryVault(
      join(state, "vault"),
      { local: key },
      "local",
      config.vaultCapacity,
    ),
    adapters: [adapter],
    authorize: async (proposal) =>
      action === "serve"
        ? allowed(
            "void_execute",
            proposal.observation.reversibility,
            proposal.observation.blastRadius.count ?? undefined,
          )
        : args.get("--approve") === proposal.digest,
  });
  if (action === "serve") {
    if (!config.agentId || !/^[\w-]{1,120}$/.test(config.agentId))
      throw new Error("A stable agentId is required for MCP.");
    const server = recoveryMcpServer({
      runtime,
      workspace: config.workspace,
      agentId: config.agentId,
      adapterId: adapter.id,
      permitted: (tool) =>
        allowed(
          tool,
          tool === "void_recovery_plan" ? "r0" : "r1",
          tool === "void_recovery_plan" ? 0 : 1,
        ),
    });
    await server.connect(new StdioServerTransport());
    return 0;
  }
  if (action === "execute") {
    if (!args.has("--approve"))
      throw new Error(
        "Inspect the request and supply its exact --approve digest.",
      );
    const result = await runtime.execute(input as ExecutionRequest);
    print(JSON.stringify(result));
    return result.status === "succeeded" ? 0 : 1;
  }
  if (action === "plan") {
    print(
      JSON.stringify(
        await runtime.planRecovery(config.workspace, input.operationId),
        null,
        2,
      ),
    );
    return 0;
  }
  if (action === "reconcile-recovery") {
    const result = await runtime.reconcileRecovery(
      config.workspace,
      input.operationId,
    );
    print(JSON.stringify(result));
    return result.status === "restored" || result.status === "compensated"
      ? 0
      : 1;
  }
  if (action === "reconcile") {
    const result = await runtime.reconcile(config.workspace, input.operationId);
    print(JSON.stringify(result));
    return result.status === "succeeded" ? 0 : 1;
  }
  if (!args.has("--approve"))
    throw new Error(
      "Review the recovery plan and supply its exact --approve digest.",
    );
  const result = await runtime.recover(
    input as RecoveryPlan,
    async (plan) => args.get("--approve") === plan.digest,
  );
  print(JSON.stringify(result));
  return result.status === "restored" || result.status === "compensated"
    ? 0
    : 1;
}
