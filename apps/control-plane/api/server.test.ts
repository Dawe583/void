import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { devKeyProvider } from "../../../packages/ledger/src/sign.ts";
import { jsonlStore } from "../../../packages/ledger/src/store.ts";
import { listenControlPlane, type ApprovalBroker, type PendingApproval } from "./server.ts";

type FeedBody = {
  readonly workspace: string;
  readonly at: string;
  readonly tool: string;
  readonly klass: string;
  readonly decision: string;
  readonly argsDigest: string;
  readonly payload?: string;
};

const workspace = "default";

async function seedLedger(count = 2): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "void-control-plane-api-"));
  const signer = await devKeyProvider({ dir: join(dir, "keys"), env: {} });
  const store = jsonlStore(signer, { dir });
  for (let index = 1; index <= count; index += 1) {
    const body: FeedBody = {
      workspace,
      at: `2026-09-0${index}T00:00:00.000Z`,
      tool: `postgres.row.update.${index}`,
      klass: index === 1 ? "r1" : "r3",
      decision: index === 1 ? "allow:resolved" : "hold:pending",
      argsDigest: `${index}`.repeat(64),
      payload: "not for the API feed",
    };
    await store.append(body);
  }
  return join(dir, `${workspace}.jsonl`);
}

async function withServer<T>(ledgerPath: string, run: (origin: string) => Promise<T>, approvals?: ApprovalBroker): Promise<T> {
  const handle = await listenControlPlane({ ledgerPath, approvals });
  try {
    return await run(`http://127.0.0.1:${handle.port}`);
  } finally {
    await handle.close();
  }
}

describe("control plane API", () => {
  test("returns a limited ledger feed with verified chain fields", async () => {
    const ledgerPath = await seedLedger(2);
    await withServer(ledgerPath, async (origin) => {
      const response = await fetch(`${origin}/api/feed?workspace=default&limit=1`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
      const body = await response.json() as { entries: Array<Record<string, unknown>>; verified: boolean };
      assert.equal(body.verified, true);
      assert.equal(body.entries.length, 1);
      assert.deepEqual(Object.keys(body.entries[0]!).sort(), [
        "argsDigest",
        "at",
        "decision",
        "digest",
        "hash",
        "klass",
        "prev_hash",
        "seq",
        "tool",
      ].sort());
      assert.equal(body.entries[0]!["seq"], 2);
      assert.equal(body.entries[0]!["hash"], body.entries[0]!["digest"]);
    });
  });

  test("reports chain verification status", async () => {
    const ledgerPath = await seedLedger(3);
    await withServer(ledgerPath, async (origin) => {
      const response = await fetch(`${origin}/api/ledger/verify`);
      assert.equal(response.status, 200);
      const body = await response.json() as { ok: boolean; verified: boolean; checked: number; head: string };
      assert.equal(body.ok, true);
      assert.equal(body.verified, true);
      assert.equal(body.checked, 3);
      assert.match(body.head, /^[0-9a-f]{64}$/);
    });
  });

  test("serves the control plane pages with html content type", async () => {
    const ledgerPath = await seedLedger(1);
    await withServer(ledgerPath, async (origin) => {
      const response = await fetch(`${origin}/feed.html`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.match(await response.text(), /VOID Call Feed/);
    });
  });

  test("returns a clear 503 when no ApprovalBroker is wired", async () => {
    const ledgerPath = await seedLedger(1);
    await withServer(ledgerPath, async (origin) => {
      const response = await fetch(`${origin}/api/approvals/hold-1/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "approved", by: "operator" }),
      });
      assert.equal(response.status, 503);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "approvals_not_wired");
    });
  });

  test("uses an injected ApprovalBroker for pending holds and decisions", async () => {
    const ledgerPath = await seedLedger(1);
    const pending: PendingApproval[] = [{
      holdId: "hold-1",
      call: { tool: "postgres.row.delete" },
      expiresAt: "2026-09-08T00:00:00.000Z",
      status: "pending",
    }];
    const decisions: unknown[] = [];
    const approvals: ApprovalBroker = {
      pending: () => pending,
      decide(holdId, decision) {
        decisions.push({ holdId, decision });
        return { status: "approved" };
      },
    };
    await withServer(ledgerPath, async (origin) => {
      const list = await fetch(`${origin}/api/approvals`);
      assert.equal(list.status, 200);
      assert.deepEqual(await list.json(), { approvals: pending });

      const response = await fetch(`${origin}/api/approvals/hold-1/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "approved", by: "operator", reason: "reviewed blast radius" }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, result: { status: "approved" } });
      assert.deepEqual(decisions, [{
        holdId: "hold-1",
        decision: { kind: "approved", by: "operator", reason: "reviewed blast radius" },
      }]);
    }, approvals);
  });
});
