import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenControlPlane } from "./server.ts";

test("built web serves deep links and hashed assets without exposing source or unknown API paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "void-spa-"));
  const webRoot = join(directory, "web");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(
    join(webRoot, "index.html"),
    '<div id="root"></div><script type="module" src="/assets/app-123.js"></script>',
  );
  await writeFile(
    join(webRoot, "assets/app-123.js"),
    'document.title = "VOID";',
  );
  await writeFile(join(directory, "private.txt"), "not-public");
  const server = await listenControlPlane({
    webRoot,
    env: { VOID_DATA_DIR: join(directory, "data") },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    for (const path of [
      "/",
      "/chat/new",
      "/chat/session-id",
      "/documents",
      "/settings",
      "/ledger",
      "/feed.html",
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await response.text(), /id="root"/);
    }
    const asset = await fetch(base + "/assets/app-123.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    for (const path of [
      "/api/not-found",
      "/src/main.tsx",
      "/assets/..%2f..%2fprivate.txt",
      "/assets/missing.js",
    ])
      assert.equal((await fetch(base + path)).status, 404, path);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
