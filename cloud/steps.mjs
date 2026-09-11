import { providerFailure } from "../packages/workbench/src/gui.ts";
import {
  createWorkspace,
  executeWorkspaceTool,
  workspaceToolClass,
} from "../packages/workbench/src/workspace.ts";
import { encrypt } from "./store.mjs";
import { read, write, transaction, event, append, decrypt } from "./store.mjs";
import { ProviderRequestError } from "../packages/workbench/src/provider.ts";
import { provider } from "./provider.mjs";
import { rpc } from "./mcp.mjs";
import { classifyTool } from "../packages/registry/src/evaluate.ts";
import { loadPolicy } from "../packages/policy/src/rules.ts";
import { decide } from "../packages/policy/src/decide.ts";
import { canonicalJson } from "../packages/ledger/src/canonical.ts";
import { sha256Hex } from "../packages/ledger/src/sign.ts";
export const CLOUD_POLICY =
  "version: 1\nrules:\n  - match:\n      class: r0\n    decision: allow\n  - match: {}\n    decision: hold\n    seconds: 300\n    notify: [cli]\n";
const save = (s, c) => write(`session:${s.id}`, s, c);
export async function advance(id, generation) {
  "use step";
  const claim = await transaction(id, async (c) => {
    const s = await read(`session:${id}`, c);
    if (!s || s.generation !== generation || s.status !== "running")
      return { kind: "done" };
    if (s.executing) {
      event(
        s,
        "error",
        "Execution was interrupted. Review the ledger; the tool will not be retried automatically.",
      );
      s.status = "failed";
      await save(s, c);
      return { kind: "done" };
    }
    if (s.pending) {
      const h = await read(`hold:${s.pending.id}`, c);
      if (h.status === "pending" && h.expiresAt > Date.now())
        return { kind: "wait" };
      const approved = h.status === "approved" && h.decidedAt <= h.expiresAt;
      await append(
        {
          ...s.pending.body,
          at: new Date().toISOString(),
          decision: approved ? "hold:approved" : "hold:denied",
        },
        c,
      );
      if (!approved) {
        s.messages.push({
          role: "tool",
          tool_call_id: s.pending.call.id,
          content: "VOID denied the request. Do not retry.",
        });
        s.queue.shift();
        event(s, "tool", `${s.pending.name}: denied`);
        s.pending = null;
        await save(s, c);
        return { kind: "next" };
      }
      s.executing = "tool";
      const job = {
        kind: "tool",
        session: s,
        call: s.pending.call,
        name: s.pending.name,
        args: s.pending.args,
        body: s.pending.body,
        connectorId: s.pending.connectorId,
      };
      s.pending = null;
      await save(s, c);
      return job;
    }
    if (s.queue?.length) {
      const call = s.queue[0],
        index = Number(call.function.name.replace(/^tool_/, "")),
        tool = s.tools[index];
      if (!tool || call.function.name !== `tool_${index}`)
        throw new Error("Provider requested a tool outside the catalog.");
      const args = JSON.parse(call.function.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new Error("Invalid tool arguments.");
      const config =
        tool.connectorId && s.connected?.[tool.connectorId]
          ? decrypt(s.connected[tool.connectorId].config)
          : s.upstream
            ? decrypt(s.upstream)
            : {};
      const name = config.mapping?.[tool.name] ?? tool.name;
      const classification = tool.builtin
        ? { outcome: "classified", tone: workspaceToolClass(tool.name) }
        : classifyTool(name, {
            facts: config.facts ?? {},
            args,
          });
      const policy = loadPolicy(config.policy ?? CLOUD_POLICY);
      if (!policy.ok) throw new Error("Invalid cloud policy.");
      const callInfo = {
        tool: name,
        connector: name.split(".")[0],
        workspace: s.workspace,
        klass:
          classification.outcome === "classified" ? classification.tone : "r3",
        blastRadius: undefined,
      };
      const decision =
        classification.outcome === "classified"
          ? tool.builtin
            ? { kind: "allow" }
            : decide(policy, callInfo)
          : { kind: "deny" };
      const body = {
        workspace: s.workspace,
        at: new Date().toISOString(),
        tool: name,
        klass: callInfo.klass,
        decision: decision.kind,
        argsDigest: `sha256:${await sha256Hex(new TextEncoder().encode(canonicalJson(args)))}`,
      };
      event(
        s,
        "tool",
        `${tool.name}: requested`,
        {
          tool: tool.name,
          callId: call.id,
          klass: callInfo.klass,
          decision: decision.kind,
        },
        "tool.started",
      );
      await append(body, c);
      if (decision.kind === "hold") {
        const holdId = `${s.id}-${s.generation}-${s.turn}-${s.queue.length}`;
        await write(
          `hold:${holdId}`,
          {
            holdId,
            sessionId: s.id,
            call: callInfo,
            expiresAt: Date.now() + decision.seconds * 1000,
            status: "pending",
            notify: [],
          },
          c,
        );
        s.pending = {
          id: holdId,
          call,
          name: tool.name,
          args,
          body,
          connectorId: tool.connectorId,
        };
        event(s, "tool", `${tool.name}: waiting for your approval`);
        await save(s, c);
        return { kind: "wait" };
      }
      if (decision.kind !== "allow") {
        s.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "VOID denied an unknown, unclassified or disallowed tool. Do not retry.",
        });
        s.queue.shift();
        event(s, "tool", `${tool.name}: denied by VOID`);
        await save(s, c);
        return { kind: "next" };
      }
      s.executing = "tool";
      await save(s, c);
      return {
        kind: "tool",
        session: s,
        call,
        name: tool.name,
        args,
        body,
        builtin: tool.builtin,
        connectorId: tool.connectorId,
      };
    }
    if (s.turn >= 20 || s.messages.length > 200)
      throw new Error("Session limit reached. Start a new session.");
    s.executing = "model";
    await save(s, c);
    return { kind: "model", session: s };
  });
  if (claim.kind === "done" || claim.kind === "wait" || claim.kind === "next")
    return claim.kind;
  const s = claim.session;
  try {
    const client = await provider(s.provider);
    if (claim.kind === "model") {
      const tools = s.tools.map((tool, index) => ({
        type: "function",
        function: {
          name: `tool_${index}`,
          description: `${tool.name}: ${tool.description ?? ""}`,
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        },
      }));
      let delta = "",
        flushed = Date.now();
      const flush = async () => {
        if (!delta) return;
        const text = client.redact(delta);
        delta = "";
        flushed = Date.now();
        await transaction(id, async (c) => {
          const current = await read(`session:${id}`, c);
          if (current.status !== "running" || current.generation !== generation)
            return;
          event(current, "assistant", text, {}, "message.delta");
          await save(current, c);
        });
      };
      const reply = await client.complete(
        s.model,
        s.messages,
        tools,
        AbortSignal.timeout(65000),
        async (text) => {
          delta += text;
          if (Date.now() - flushed > 500 || delta.length > 1024) await flush();
        },
      );
      await flush();
      if ((reply.message.tool_calls?.length ?? 0) > 32)
        throw new Error("Too many tool calls in a single batch.");
      await transaction(id, async (c) => {
        const current = await read(`session:${id}`, c);
        if (current.status !== "running" || current.generation !== generation)
          return;
        current.executing = null;
        const safeMessage = JSON.parse(
          client.redact(JSON.stringify(reply.message)),
        );
        current.messages.push(safeMessage);
        current.queue = safeMessage.tool_calls ?? [];
        current.turn++;
        if (reply.message.content)
          event(current, "assistant", client.redact(reply.message.content));
        if (reply.usage)
          event(
            current,
            "usage",
            `${reply.usage.total_tokens ?? "Unknown"} tokens reported by provider`,
            { ...reply.usage, model: s.model, source: "provider", cost: null },
          );
        if (!current.queue.length) {
          current.status = "idle";
          event(current, "tool", "Idle", { status: "idle" }, "run.status");
        }
        await save(current, c);
      });
    } else {
      if (claim.builtin) {
        await transaction(id, async (c) => {
          const current = await read(`session:${id}`, c);
          if (current.status !== "running" || current.generation !== generation)
            return;
          const saved = await read(`workspace:${id}`, c),
            state = saved ? decrypt(saved) : createWorkspace();
          const transition = executeWorkspaceTool(state, {
            id: `${id}-${generation}-${s.turn}-${claim.call.id}`,
            name: claim.name,
            arguments: claim.args,
          });
          await append(
            {
              ...claim.body,
              at: new Date().toISOString(),
              decision: transition.result.isError
                ? "execute:failed"
                : "execute:completed",
              ...(transition.operation
                ? {
                    operationId: transition.operation.id,
                    captureDigest: await sha256Hex(
                      canonicalJson(transition.operation),
                    ),
                  }
                : {}),
            },
            c,
          );
          await write(`workspace:${id}`, encrypt(transition.state), c);
          event(
            current,
            "tool",
            `${claim.name}: ${transition.result.isError ? "failed" : "completed, change captured"}`,
            {
              tool: claim.name,
              callId: claim.call.id,
              result: transition.result,
            },
          );
          if (transition.operation)
            event(
              current,
              "tool",
              `Changed ${transition.operation.path}.`,
              {
                path: transition.operation.path,
                operationId: transition.operation.id,
              },
              "document.changed",
            );
          current.executing = null;
          current.queue.shift();
          current.messages.push({
            role: "tool",
            tool_call_id: claim.call.id,
            content: client.redact(JSON.stringify(transition.result)),
          });
          await save(current, c);
        });
        return "next";
      }
      const connection = claim.connectorId
        ? s.connected?.[claim.connectorId]
        : undefined;
      const config = decrypt(connection?.config ?? s.upstream);
      const result = await rpc(
        config,
        "tools/call",
        { name: claim.name, arguments: claim.args },
        connection?.sessionId ?? s.mcpSession,
      );
      await transaction(id, async (c) => {
        const current = await read(`session:${id}`, c);
        await append(
          {
            ...claim.body,
            at: new Date().toISOString(),
            decision: result.result?.isError
              ? "execute:failed"
              : "execute:completed",
          },
          c,
        );
        event(
          current,
          "tool",
          `${claim.name}: ${result.result?.isError ? "failed" : "result received"}`,
        );
        current.executing = null;
        current.queue.shift();
        current.messages.push({
          role: "tool",
          tool_call_id: claim.call.id,
          content: (config.token
            ? client
                .redact(JSON.stringify(result.result))
                .split(config.token)
                .join("[redacted]")
            : client.redact(JSON.stringify(result.result))
          ).slice(0, 64000),
        });
        await save(current, c);
      });
    }
    return "next";
  } catch (error) {
    await transaction(id, async (c) => {
      const current = await read(`session:${id}`, c);
      if (current.status === "running" && current.generation === generation) {
        current.status = "failed";
        event(
          current,
          "error",
          error instanceof ProviderRequestError
            ? providerFailure(error).text
            : "Cloud execution failed. Check provider and tool connectivity. A dispatched tool is not retried automatically.",
          error instanceof ProviderRequestError
            ? providerFailure(error).payload
            : {},
        );
        await save(current, c);
      }
    });
    return "done";
  }
}
export async function fail(id, generation) {
  "use step";
  await transaction(id, async (c) => {
    const s = await read(`session:${id}`, c);
    if (s?.status === "running" && s.generation === generation) {
      s.status = "failed";
      event(
        s,
        "error",
        "Cloud execution stopped. Check provider access and the tool server. An interrupted tool is never automatically retried.",
      );
      await save(s, c);
    }
  });
}
