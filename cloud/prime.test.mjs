import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, read, write, transaction } from "./store.mjs";
import { enqueuePrime } from "./prime.mjs";
test(
  "prime worker authenticates, claims once, rejects stale results and never replays lost jobs",
  {
    skip: process.env.VOID_GUI_DATABASE_TEST !== "1",
  },
  async () => {
    assert.equal(
      new URL(process.env.DATABASE_URL).pathname,
      "/void_gui_upgrade_preview",
    );
    process.env.VOID_BRIDGE_TOKEN = "worker-test-token-".repeat(3);
    const { default: app } = await import("./server.mjs");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {
      authorization: `Bearer ${process.env.VOID_CONTROL_TOKEN}`,
      "content-type": "application/json",
      "x-void-worker-token": process.env.VOID_BRIDGE_TOKEN,
    };
    const post = async (path, body, h = headers) => {
      const r = await fetch(base + path, {
        method: "POST",
        headers: h,
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const previous = await read("prime-worker"),
      id = randomUUID();
    try {
      assert.equal(
        (
          await post(
            "/api/prime/claim",
            { tools: [] },
            { ...headers, "x-void-worker-token": "wrong" },
          )
        ).status,
        403,
      );
      const s = {
        id,
        workspace: `agent-${id}`,
        agent: "prime-agent",
        model: "test-model",
        primeProvider: "opencode",
        generation: 1,
        status: "running",
        events: [],
        messages: [{ role: "user", content: "Test fixture" }],
      };
      await write(`session:${id}`, s);
      await enqueuePrime(s);
      const claims = await Promise.all([
        post("/api/prime/claim", { tools: ["MCP: test"] }),
        post("/api/prime/claim", { tools: ["MCP: test"] }),
      ]);
      assert.equal(claims.filter((r) => r.body.job?.id === id).length, 1);
      const job = claims.find((r) => r.body.job?.id === id).body.job;
      assert.equal(
        (
          await post(`/api/prime/jobs/${id}`, {
            claim: "wrong",
            generation: 1,
            type: "heartbeat",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await post(`/api/prime/jobs/${id}`, {
            ...job,
            type: "complete",
            text: "Done",
            failed: false,
          })
        ).status,
        200,
      );
      assert.equal((await read(`session:${id}`)).status, "idle");
      await transaction(id, async (c) => {
        const current = await read(`session:${id}`, c);
        current.status = "running";
        current.generation = 2;
        current.primeJob = {
          state: "claimed",
          claim: "lost",
          generation: 2,
          at: 0,
        };
        await write(`session:${id}`, current, c);
      });
      assert.equal(
        (await post("/api/prime/claim", { tools: [] })).body.job,
        null,
      );
      assert.equal((await read(`session:${id}`)).primeJob.state, "unknown");
      assert.equal(
        (
          await post(`/api/prime/jobs/${id}`, {
            claim: "lost",
            generation: 2,
            type: "complete",
            text: "Late",
            failed: false,
          })
        ).body.cancel,
        true,
      );
      assert.equal((await read(`session:${id}`)).status, "failed");
    } finally {
      await database().query("DELETE FROM void_cloud_state WHERE key=$1", [
        `session:${id}`,
      ]);
      if (previous) await write("prime-worker", previous);
      else
        await database().query(
          "DELETE FROM void_cloud_state WHERE key='prime-worker'",
        );
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await database().end();
    }
  },
);
