import { randomUUID, timingSafeEqual } from "node:crypto";
import { read, write, transaction, database, event, append } from "./store.mjs";
import { digest } from "../packages/runtime/src/journal.ts";
const publicStatus = (state) => ({
  agent: "prime-agent",
  online: !!state && Date.now() - state.at < 45000,
  lastSeen: state?.at ?? null,
  tools: state?.tools ?? [],
  boundary:
    "Local PC execution. Local tools do not have automatic VOID Undo. Remote services retain their own authentication requirements.",
});
export async function primeStatus() {
  return publicStatus(await read("prime-worker"));
}
export async function enqueuePrime(session) {
  await transaction(session.id, async (c) => {
    const current = await read(`session:${session.id}`, c);
    if (
      current?.status !== "running" ||
      current.generation !== session.generation
    )
      return;
    current.primeJob = { state: "queued", generation: current.generation };
    event(
      current,
      "tool",
      "Queued for your local prime-agent. Local tool changes are not covered by document Undo.",
    );
    await write(`session:${session.id}`, current, c);
  });
}
const workerAllowed = (req) => {
  const expected = process.env.VOID_BRIDGE_TOKEN,
    supplied = req.headers["x-void-worker-token"];
  return (
    typeof supplied === "string" &&
    typeof expected === "string" &&
    expected.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
};
export function mountPrimeRoutes(app) {
  app.get("/api/agents", async (_req, res) =>
    res.json({ prime: await primeStatus() }),
  );
  app.use("/api/prime", (req, res, next) =>
    workerAllowed(req)
      ? next()
      : res.status(403).json({ error: "worker_authentication_required" }),
  );
  app.post("/api/prime/claim", async (req, res) => {
    const names = req.body?.tools;
    if (
      !Array.isArray(names) ||
      names.length > 500 ||
      names.some(
        (n) => typeof n !== "string" || !/^[\w .:/@+-]{1,160}$/.test(n),
      )
    )
      return res.status(400).json({ error: "invalid_tool_inventory" });
    await write("prime-worker", { at: Date.now(), tools: names });
    const candidate = (
      await database().query(
        "SELECT document->>'id' AS id FROM void_cloud_state WHERE key LIKE 'session:%' AND document->>'agent'='prime-agent' AND document->>'status'='running' AND (document->'primeJob'->>'state'='queued' OR (document->'primeJob'->>'state'='claimed' AND (document->'primeJob'->>'at')::bigint < $1)) ORDER BY key LIMIT 1",
        [Date.now() - 90000],
      )
    ).rows[0];
    if (!candidate) return res.json({ job: null });
    const job = await transaction(candidate.id, async (c) => {
      const s = await read(`session:${candidate.id}`, c);
      if (
        s.status === "running" &&
        s.primeJob?.state === "claimed" &&
        s.primeJob.at < Date.now() - 90000
      ) {
        s.status = "failed";
        s.primeJob.state = "unknown";
        await append(
          {
            workspace: s.workspace,
            at: new Date().toISOString(),
            tool: "prime_agent_run",
            klass: "r3",
            decision: "execute:unknown",
            operationId: s.primeJob.claim,
            reason: "worker-disconnected",
            recovery: "not-captured",
          },
          c,
        );
        event(
          s,
          "error",
          "Local worker disconnected. Tool outcome is unknown; the job will not be retried automatically.",
        );
        await write(`session:${s.id}`, s, c);
        return null;
      }
      if (s.status !== "running" || s.primeJob?.state !== "queued") return null;
      const claim = randomUUID();
      s.primeJob = {
        state: "claimed",
        claim,
        generation: s.generation,
        at: Date.now(),
      };
      const prompt = s.messages
        .filter((m) => m.role === "user")
        .at(-1)?.content;
      await append(
        {
          workspace: s.workspace,
          at: new Date().toISOString(),
          tool: "prime_agent_run",
          klass: "r3",
          decision: "execute:dispatched",
          argsDigest: digest({ prompt, model: s.model }),
          operationId: claim,
          approvedBy: "web-operator",
          recovery: "not-captured",
        },
        c,
      );
      event(s, "tool", "prime-agent connected to your PC.");
      await write(`session:${s.id}`, s, c);
      return {
        id: s.id,
        generation: s.generation,
        claim,
        prompt,
        model: s.model,
        provider: s.primeProvider,
        continuation: s.generation > 1,
      };
    });
    res.json({ job });
  });
  app.post("/api/prime/jobs/:id", async (req, res) => {
    const result = await transaction(req.params.id, async (c) => {
      const s = await read(`session:${req.params.id}`, c),
        input = req.body ?? {};
      if (
        !s ||
        s.agent !== "prime-agent" ||
        s.primeJob?.claim !== input.claim ||
        s.generation !== input.generation
      )
        throw Object.assign(new Error("Stale worker claim."), { status: 409 });
      if (s.status !== "running" || s.primeJob.state === "completed")
        return { cancel: true };
      s.primeJob.at = Date.now();
      const worker = await read("prime-worker", c);
      if (worker) await write("prime-worker", { ...worker, at: Date.now() }, c);
      if (input.type === "tool") {
        if (
          typeof input.name !== "string" ||
          !/^[\w .:/@+-]{1,160}$/.test(input.name)
        )
          throw new Error("Invalid tool name.");
        event(s, "tool", `prime-agent tool: ${input.name}`, {
          tool: input.name,
          recovery: "not-captured",
        });
      } else if (input.type === "complete") {
        if (
          typeof input.text !== "string" ||
          input.text.length > 32000 ||
          typeof input.failed !== "boolean"
        )
          throw new Error("Invalid worker result.");
        const text =
          input.text ||
          (input.failed
            ? "prime-agent failed without a response."
            : "prime-agent finished.");
        s.status = input.failed ? "failed" : "idle";
        s.primeJob.state = "completed";
        if (!input.failed)
          s.messages.push({ role: "assistant", content: text });
        event(s, input.failed ? "error" : "assistant", text);
        event(s, "tool", s.status, { status: s.status }, "run.status");
        await append(
          {
            workspace: s.workspace,
            at: new Date().toISOString(),
            tool: "prime_agent_run",
            klass: "r3",
            decision: input.failed ? "execute:unknown" : "execute:completed",
            operationId: input.claim,
            resultDigest: digest(text),
            recovery: "not-captured",
          },
          c,
        );
      } else if (input.type !== "heartbeat")
        throw new Error("Invalid worker event.");
      await write(`session:${s.id}`, s, c);
      return { cancel: false };
    });
    res.json(result);
  });
}
