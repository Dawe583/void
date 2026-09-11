import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  recoveryRuntime,
  Json,
  RecoveryPlan,
} from "../../runtime/src/index.ts";

type Runtime = ReturnType<typeof recoveryRuntime>;
const identity = { type: "string", pattern: "^[\\w-]{1,120}$" };
const operation = { operationId: identity };
const names = [
  "void_execute",
  "void_recovery_plan",
  "void_recovery_apply",
  "void_reconcile",
  "void_recovery_reconcile",
] as const;
export type RecoveryTool = (typeof names)[number];
const tool = (
  name: RecoveryTool,
  description: string,
  properties: Record<string, object>,
  required: string[],
  readOnlyHint: boolean,
): Tool => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint,
    destructiveHint: !readOnlyHint,
    idempotentHint: true,
    openWorldHint: true,
  },
});
const tools: Tool[] = [
  tool(
    "void_recovery_reconcile",
    "Read durable evidence after an unknown Undo outcome. Never repeats the inverse; may update the local journal.",
    operation,
    ["operationId"],
    false,
  ),
  tool(
    "void_execute",
    "Execute one configured PostgreSQL row mutation with durable capture. Reuse operationId and runId only for the identical request. Unknown results must be reconciled, never resubmitted under another ID.",
    {
      ...operation,
      runId: identity,
      mutation: {
        type: "object",
        additionalProperties: false,
        required: ["table", "action", "key"],
        properties: {
          table: { type: "string", description: "Configured schema.table" },
          action: { type: "string", enum: ["insert", "update", "delete"] },
          key: { type: "object", description: "Exact primary key" },
          values: {
            type: "object",
            description: "Configured writable columns; omit for delete",
          },
        },
      },
    },
    ["operationId", "runId", "mutation"],
    false,
  ),
  tool(
    "void_recovery_plan",
    "Preview the exact scope and digest for restoring one confirmed operation. This does not execute recovery.",
    operation,
    ["operationId"],
    true,
  ),
  tool(
    "void_recovery_apply",
    "Apply the reviewed recovery plan if operator policy permits it. Concurrent human changes produce a conflict. A plan digest is not permission.",
    {
      plan: {
        type: "object",
        additionalProperties: false,
        required: [
          "workspace",
          "operationId",
          "digest",
          "scope",
          "resources",
          "reversibility",
        ],
        properties: {
          workspace: { type: "string" },
          operationId: identity,
          digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          scope: { type: "string" },
          resources: { type: "array", items: { type: "string" } },
          reversibility: { type: "string", enum: ["r0", "r1", "r2"] },
        },
      },
    },
    ["plan"],
    false,
  ),
  tool(
    "void_reconcile",
    "Look up durable execution evidence after an unknown outcome. Does not repeat the original mutation; may update the local journal.",
    operation,
    ["operationId"],
    false,
  ),
];
export function recoveryMcpServer(options: {
  runtime: Runtime;
  workspace: string;
  agentId: string;
  adapterId: string;
  permitted: (tool: RecoveryTool) => Promise<boolean>;
}) {
  const server = new Server(
    { name: "void-recovery", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const name = request.params.name as RecoveryTool;
      if (!names.includes(name)) throw new Error("Unknown recovery tool.");
      const args = request.params.arguments ?? {};
      const definition = tools.find((t) => t.name === name)!;
      if (
        Object.keys(args).some(
          (k) => !(k in definition.inputSchema.properties!),
        )
      )
        throw new Error("Unexpected argument.");
      for (const key of definition.inputSchema.required ?? [])
        if (!(key in args)) throw new Error("Missing argument.");
      for (const key of ["operationId", "runId"])
        if (
          key in args &&
          (typeof args[key] !== "string" || !/^[\w-]{1,120}$/.test(args[key]))
        )
          throw new Error("Invalid identity.");
      if (!(await options.permitted(name)))
        throw new Error(
          "Operator policy does not allow this tool. Hold requires operator approval outside this server.",
        );
      let result: unknown;
      if (name === "void_execute") {
        if (
          !args.mutation ||
          typeof args.mutation !== "object" ||
          Array.isArray(args.mutation)
        )
          throw new Error("Mutation must be an object.");
        result = await options.runtime.execute({
          workspace: options.workspace,
          agentId: options.agentId,
          adapterId: options.adapterId,
          operationId: args.operationId as string,
          runId: args.runId as string,
          arguments: args.mutation as Json,
        });
      } else if (name === "void_recovery_plan")
        result = await options.runtime.planRecovery(
          options.workspace,
          args.operationId as string,
        );
      else if (name === "void_recovery_reconcile")
        result = await options.runtime.reconcileRecovery(
          options.workspace,
          args.operationId as string,
        );
      else if (name === "void_reconcile")
        result = await options.runtime.reconcile(
          options.workspace,
          args.operationId as string,
        );
      else {
        const plan = args.plan as RecoveryPlan | undefined;
        if (!plan || plan.workspace !== options.workspace)
          throw new Error("Recovery plan belongs to another workspace.");
        result = await options.runtime.recover(plan, async () =>
          options.permitted(name),
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch {
      // Database errors can include credentials or row values. Keep them off the MCP channel.
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Recovery request refused or unavailable. Check operator policy, argument schema, workspace, and signed operation evidence.",
          },
        ],
      };
    }
  });
  return server;
}
