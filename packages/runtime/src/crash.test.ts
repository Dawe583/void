import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import {
  recoveryRuntime,
  localOperationJournal,
  localRecoveryVault,
  type RecoveryAdapter,
} from "./index.ts";

test("SIGKILL releases the writer mutex; restarted executor records unknown without repeating a dispatched write", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-killed-runtime-")),
    key = randomBytes(32);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const request = {
    workspace: "test",
    agentId: "agent",
    runId: "run",
    operationId: "op",
    adapterId: "fixture",
    arguments: null,
  };
  const worker = join(dir, "worker.mjs");
  await writeFile(
    worker,
    `
 import {writeFile} from 'node:fs/promises';
 import {join} from 'node:path';
 import {devKeyProvider} from ${JSON.stringify(new URL("../../ledger/src/sign.ts", import.meta.url).href)};
 import {recoveryRuntime,localOperationJournal,localRecoveryVault} from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
 const root=process.env.TEST_ROOT,signer=await devKeyProvider({dir:join(root,'keys'),env:{}});
 const adapter={id:'fixture',version:'1',async preflight(){return {effect:'write',reversibility:'r1',readiness:'verified',scope:'fixture',resources:['value'],revision:null,blastRadius:{count:1,precision:'exact'}}},async prepare(){return {before:null,plan:null}},async execute(){await writeFile(join(root,'effect'),'one actual effect');process.send('dispatched');await new Promise(()=>{})},async release(){},async reconcile(){return {status:'unknown'}},async recover(){throw new Error('not used')}};
 await recoveryRuntime({journal:localOperationJournal(join(root,'journal'),signer),vault:localRecoveryVault(join(root,'vault'),{key:Buffer.from(process.env.TEST_KEY,'base64')},'key'),adapters:[adapter],authorize:async()=>true}).execute(${JSON.stringify(request)});
 `,
  );
  const child = fork(worker, [], {
    env: { ...process.env, TEST_ROOT: dir, TEST_KEY: key.toString("base64") },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const [message] = await once(child, "message", {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(message, "dispatched");
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  let repeats = 0;
  const adapter: RecoveryAdapter = {
    id: "fixture",
    version: "1",
    async preflight() {
      throw new Error("must not preflight again");
    },
    async prepare() {
      throw new Error("must not prepare again");
    },
    async execute() {
      repeats++;
      throw new Error("must not execute again");
    },
    async release() {},
    async reconcile() {
      return { status: "unknown" };
    },
    async recover() {
      throw new Error("unused");
    },
  };
  const runtime = recoveryRuntime({
    journal: localOperationJournal(join(dir, "journal"), signer),
    vault: localRecoveryVault(join(dir, "vault"), { key }, "key"),
    adapters: [adapter],
    authorize: async () => true,
  });
  assert.equal((await runtime.execute(request)).status, "unknown");
  assert.equal(repeats, 0);
  assert.equal(
    await readFile(join(dir, "effect"), "utf8"),
    "one actual effect",
  );
  assert.equal((await runtime.reconcile("test", "op")).status, "unknown");
});

test("independent processes cannot enter the local journal transaction together", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "void-process-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} }),
    worker = join(dir, "worker.mjs");
  await writeFile(
    worker,
    `
 import {join} from 'node:path';
 import {devKeyProvider} from ${JSON.stringify(new URL("../../ledger/src/sign.ts", import.meta.url).href)};
 import {localOperationJournal} from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
 const root=process.env.TEST_ROOT,signer=await devKeyProvider({dir:join(root,'keys'),env:{}});
 await localOperationJournal(join(root,'journal'),signer).transaction('test',async()=>{process.send('locked');await new Promise(resolve=>process.once('message',resolve));});
 process.disconnect();
 `,
  );
  const child = fork(worker, [], {
    env: { ...process.env, TEST_ROOT: dir },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  await once(child, "message", { signal: AbortSignal.timeout(15_000) });
  let entered = false;
  const waiting = localOperationJournal(
    join(dir, "journal"),
    signer,
  ).transaction("test", async () => {
    entered = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(entered, false);
  child.send("release");
  await waiting;
  assert.equal(entered, true);
  if (child.exitCode === null) await once(child, "exit");
});
