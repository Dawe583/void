// Real provider + durable workflow smoke. Credentials stay in a temporary 0600 file.
// node scripts/src/verify-gui-deployment.mjs <deployment-url> <ignored-secret-json> [run|resume]
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const target = new URL(process.argv[2]);
if (
  target.protocol !== "https:" ||
  !/^void-[a-z0-9-]+\.vercel\.app$/.test(target.hostname)
)
  throw new Error("Use an exact VOID Vercel deployment URL.");
const secrets = JSON.parse(await readFile(process.argv[3], "utf8"));
assert.ok(secrets.VOID_CONTROL_TOKEN);
const directory = await mkdtemp(join(tmpdir(), "void-gui-smoke-"));
const headers = join(directory, "headers");
await writeFile(
  headers,
  `Authorization: Bearer ${secrets.VOID_CONTROL_TOKEN}\nContent-Type: application/json\n`,
  { mode: 0o600 },
);
function request(path, method = "GET", body) {
  const args = [
    "curl",
    target.origin + path,
    "--scope",
    "sitespot",
    "--",
    "-sS",
    "--max-time",
    "60",
    "-H",
    "@" + headers,
    "-X",
    method,
    "-w",
    "\n%{http_code}",
  ];
  if (body !== undefined) args.push("--data", JSON.stringify(body));
  const result = spawnSync("vercel", args, {
    encoding: "utf8",
    timeout: 75000,
  });
  if (result.status !== 0)
    throw new Error(`Transport failed: ${method} ${path}`);
  const split = result.stdout.lastIndexOf("\n"),
    status = Number(result.stdout.slice(split + 1));
  let value;
  try {
    value = JSON.parse(result.stdout.slice(0, split));
  } catch {
    throw new Error(`Non-JSON response: ${path} (${status})`);
  }
  return { status, value };
}
try {
  const state = request("/api/provider"),
    preferences = request("/api/preferences");
  assert.equal(state.status, 200);
  assert.equal(state.value.connected, true);
  assert.equal(preferences.value.preferences.defaultModel, "z-ai/glm-5.3-free");
  assert.ok(state.value.models.some((m) => m.id === "z-ai/glm-5.3-free"));
  console.log(
    JSON.stringify({
      connected: true,
      defaultModel: preferences.value.preferences.defaultModel,
      modelCount: state.value.models.length,
    }),
  );
  for (const path of [
    "/api/capabilities",
    "/api/sessions?limit=25",
    "/api/documents?limit=25",
    "/api/runs?limit=25",
    "/api/usage?limit=25",
    "/api/overview",
    "/api/connectors",
  ])
    assert.equal(request(path).status, 200, path);
  if (["run", "resume"].includes(process.argv[4])) {
    const saved =
      process.argv[4] === "resume"
        ? JSON.parse(await readFile(".env.gui-smoke-result", "utf8"))
        : undefined;
    if (saved)
      assert.equal(
        saved.url,
        target.origin,
        "Resume on the original deployment",
      );
    const key = randomUUID(),
      path = saved?.path ?? `gui-smoke-${key}.md`;
    const body = {
      prompt: `Use the VOID document write tool to create ${path} with exactly this content: # GUI smoke\n\nVerified live model and tool. Then reply briefly. Do not call any other tool.`,
      idempotencyKey: key,
    };
    const started = saved ? undefined : request("/api/sessions", "POST", body);
    if (started) assert.equal(started.status, 201, "Start durable model run");
    const id = saved?.id ?? started.value.session.id,
      base = "/api/sessions/" + id;
    if (!saved)
      assert.equal(
        request("/api/sessions", "POST", body).value.session.id,
        id,
        "Idempotent creation",
      );
    await writeFile(
      ".env.gui-smoke-result",
      JSON.stringify({ url: target.origin, id, path }),
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ sessionId: id, stage: "running" }));
    let session;
    const deadline = Date.now() + 600000;
    do {
      await delay(3000);
      session = request(base).value.session;
    } while (session.status === "running" && Date.now() < deadline);
    assert.equal(session.status, "idle", `Workflow ended ${session.status}`);
    assert.ok(
      session.events.some((e) => e.type === "tool.result"),
      "Real tool completed",
    );
    const document = request(
      base + "/documents?path=" + encodeURIComponent(path),
    ).value.document;
    assert.ok(
      document.content?.includes("GUI smoke"),
      "Provider created document",
    );
    const edit = request(base + "/documents", "PATCH", {
      path,
      content: "# Edited GUI smoke",
      expectedRevision: document.revision,
    });
    assert.equal(edit.status, 200);
    assert.equal(
      request(base + "/documents", "PATCH", {
        path,
        content: "stale",
        expectedRevision: document.revision,
      }).status,
      409,
    );
    const undoPath = base + "/undo/" + edit.value.document.revision;
    assert.equal(request(undoPath).value.canApply, true);
    assert.equal(
      request(undoPath, "POST", { confirm: edit.value.document.revision })
        .status,
      200,
    );
    assert.equal(
      request(base + "/documents?path=" + encodeURIComponent(path)).value
        .document.content,
      document.content,
    );
    const proof = request("/api/ledger/verify?workspace=" + session.workspace);
    assert.equal(proof.value.verified, true);
    assert.ok(proof.value.checked >= 3);
    const events = request(base + "/events?after=0");
    assert.ok(events.value.items?.length || events.value.events?.length);
    await writeFile(
      ".env.gui-smoke-result",
      JSON.stringify({
        url: target.origin,
        id,
        workspace: session.workspace,
        path,
      }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        sessionId: id,
        stage: "passed",
        checks: [
          "default",
          "live-generation",
          "tool-write",
          "idempotency",
          "revision-conflict",
          "undo",
          "signed-ledger",
          "events",
        ],
        records: proof.value.checked,
      }),
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
