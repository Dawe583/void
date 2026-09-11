import { mkdir, open, realpath, lstat, chmod } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../ledger/src/canonical.ts";
import { jsonlStore } from "../../ledger/src/store.ts";
import type { KeyProvider } from "../../ledger/src/index.ts";
import type { Json } from "../../connectors/src/recovery.ts";
export const digest = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export type Stage =
  | "received"
  | "authorized"
  | "prepared"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "denied"
  | "unknown"
  | "recovery-dispatched"
  | "restored"
  | "compensated"
  | "conflict"
  | "recovery-unknown";
export type OperationEvent = {
  schema: "void.operation.v1";
  workspace: string;
  operationId: string;
  requestDigest: string;
  adapterId: string;
  adapterVersion: string;
  agentId: string;
  runId: string;
  at: string;
  stage: Stage;
  data: Json;
};
export interface JournalTransaction {
  events: OperationEvent[];
  append(event: OperationEvent): Promise<void>;
}
export interface OperationJournal {
  transaction<T>(
    workspace: string,
    run: (tx: JournalTransaction) => Promise<T>,
  ): Promise<T>;
}
const queues = new Map<string, Promise<unknown>>();
const allowed: Record<Stage, readonly Stage[]> = {
  received: ["authorized", "denied", "failed"],
  authorized: ["prepared", "failed"],
  prepared: ["dispatched", "failed"],
  dispatched: ["succeeded", "failed", "unknown"],
  unknown: ["succeeded", "failed", "unknown"],
  succeeded: ["recovery-dispatched"],
  "recovery-dispatched": [
    "restored",
    "compensated",
    "conflict",
    "recovery-unknown",
  ],
  "recovery-unknown": ["restored", "compensated", "conflict"],
  restored: [],
  compensated: [],
  conflict: [],
  failed: [],
  denied: [],
};
export function validateTransition(
  events: readonly OperationEvent[],
  event: OperationEvent,
): void {
  if (
    event.schema !== "void.operation.v1" ||
    !/^[\w-]{1,120}$/.test(event.operationId) ||
    !/^[a-f0-9]{64}$/.test(event.requestDigest) ||
    !Object.hasOwn(allowed, event.stage)
  )
    throw new Error("Invalid operation event.");
  const previous = [...events]
    .reverse()
    .find((e) => e.operationId === event.operationId);
  if (!previous) {
    if (event.stage !== "received")
      throw new Error("Operation must start with received.");
  } else {
    for (const field of [
      "workspace",
      "requestDigest",
      "adapterId",
      "adapterVersion",
      "agentId",
      "runId",
    ] as const)
      if (previous[field] !== event[field])
        throw new Error("Operation identity or request changed.");
    if (!allowed[previous.stage].includes(event.stage))
      throw new Error(
        `Invalid operation transition: ${previous.stage} to ${event.stage}.`,
      );
  }
}
/** ponytail: use SQLite's OS-backed lock instead of inventing stale-process leases.
 * The transaction is a writer mutex only; signed JSONL remains the source of truth.
 * Process death releases the lock. Local disk only, never an NFS/distributed lease. */
export function localOperationJournal(
  dir: string,
  signer: KeyProvider,
): OperationJournal {
  const root = resolve(dir);
  return {
    async transaction<T>(
      workspace: string,
      run: (tx: JournalTransaction) => Promise<T>,
    ): Promise<T> {
      if (!/^[\w-]{1,100}$/.test(workspace))
        throw new Error("Invalid workspace.");
      await mkdir(root, { recursive: true, mode: 0o700 });
      const key = await realpath(root);
      const next = (queues.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const legacy = await lstat(join(key, ".runtime.lock")).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            },
          );
          if (legacy)
            throw new Error(
              "Legacy writer lock exists; stop the old executor and review it before migration.",
            );
          const lockPath = join(key, ".writer.sqlite"),
            lock = new DatabaseSync(lockPath);
          try {
            await chmod(lockPath, 0o600);
            lock.exec("PRAGMA busy_timeout=0");
            const deadline = Date.now() + 30_000;
            for (;;) {
              try {
                lock.exec("BEGIN IMMEDIATE");
                break;
              } catch (error) {
                if (
                  !(error instanceof Error) ||
                  !error.message.includes("database is locked") ||
                  Date.now() >= deadline
                )
                  throw error;
                await delay(25);
              }
            }
            const ledger = jsonlStore(signer, { dir: key });
            const verification = await ledger.verify(workspace);
            if (!verification.ok)
              throw new Error(
                "Operation journal signature or integrity verification failed.",
              );
            const events: OperationEvent[] = [];
            for await (const entry of ledger.read(workspace)) {
              const event = entry.body as OperationEvent;
              validateTransition(events, event);
              events.push(event);
            }
            return await run({
              events,
              async append(event) {
                if (event.workspace !== workspace)
                  throw new Error("Wrong journal workspace.");
                const stable = JSON.parse(
                  canonicalJson(event),
                ) as OperationEvent;
                validateTransition(events, stable);
                await ledger.append(stable);
                const directory = await open(key, "r");
                try {
                  await directory.sync();
                } finally {
                  await directory.close();
                }
                events.push(stable);
              },
            });
          } finally {
            lock.close();
          }
        });
      queues.set(key, next);
      try {
        return await next;
      } finally {
        if (queues.get(key) === next) queues.delete(key);
      }
    },
  };
}
