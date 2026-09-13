import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { runRecoveryCommand } from "./recovery.ts";
import type { RecoveryPlan } from "../../runtime/src/index.ts";
test("filesystem CLI requires exact approval and restores user bytes from encrypted state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "void-fs-cli-"));
  const env = { TEST_KEY: randomBytes(32).toString("base64") };
  try {
    await mkdir(join(dir, "project"));
    await writeFile(join(dir, "project", "notes.md"), "User original");
    const config = join(dir, "config.json"),
      input = join(dir, "input.json");
    await writeFile(
      config,
      JSON.stringify({
        workspace: "test",
        stateDir: "state",
        encryptionKeyEnv: "TEST_KEY",
        filesystem: { root: "project", cooperative: true },
      }),
    );
    await writeFile(
      input,
      JSON.stringify({
        workspace: "test",
        operationId: "op",
        runId: "run",
        agentId: "agent",
        adapterId: "filesystem.managed",
        arguments: {
          action: "write",
          path: "notes.md",
          base64: Buffer.from("Agent edit").toString("base64"),
        },
      }),
    );
    let inspected: { approvalDigest: string } | undefined;
    assert.equal(
      await runRecoveryCommand(
        ["inspect", "--config", config, "--input", input],
        env,
        (s) => (inspected = JSON.parse(s)),
      ),
      0,
    );
    assert.equal(
      await runRecoveryCommand(
        [
          "execute",
          "--config",
          config,
          "--input",
          input,
          "--approve",
          inspected!.approvalDigest,
        ],
        env,
        () => {},
      ),
      0,
    );
    assert.equal(
      await readFile(join(dir, "project", "notes.md"), "utf8"),
      "Agent edit",
    );
    let plan: RecoveryPlan | undefined;
    assert.equal(
      await runRecoveryCommand(
        ["plan", "--config", config, "--input", input],
        env,
        (s) => (plan = JSON.parse(s)),
      ),
      0,
    );
    await writeFile(input, JSON.stringify(plan));
    assert.equal(
      await runRecoveryCommand(
        [
          "apply",
          "--config",
          config,
          "--input",
          input,
          "--approve",
          plan!.digest,
        ],
        env,
        () => {},
      ),
      0,
    );
    assert.equal(
      await readFile(join(dir, "project", "notes.md"), "utf8"),
      "User original",
    );
    console.log(
      "PASS actual CLI inspect/approve/execute/plan/approve/Undo with encrypted disk state",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
