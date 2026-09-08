import type { ApprovalBroker, ApprovalDecision, ApprovalRecord } from "../../policy/src/index.ts";

export type HoldHandleOptions = {
  readonly pollMs?: number;
  readonly clock?: {
    readonly setTimeout: (callback: () => void, ms: number) => unknown;
    readonly clearTimeout: (handle: unknown) => void;
  };
};

export type HoldHandle = PromiseLike<ApprovalRecord> & {
  readonly holdId: string;
  readonly decide: (decision: ApprovalDecision) => boolean;
};

const defaultClock = {
  setTimeout: (callback: () => void, ms: number): ReturnType<typeof setTimeout> => setTimeout(callback, ms),
  clearTimeout: (handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export function holdHandle(
  broker: ApprovalBroker,
  holdId: string,
  options: HoldHandleOptions = {},
): HoldHandle {
  const clock = options.clock ?? defaultClock;
  const pollMs = options.pollMs ?? 10;

  const wait = (): Promise<ApprovalRecord> => new Promise((resolve, reject) => {
    let timer: unknown;
    const check = (): void => {
      const record = broker.get(holdId);
      if (record === undefined) {
        reject(new Error(`unknown hold ${holdId}`));
        return;
      }
      if (record.status !== "pending") {
        resolve(record);
        return;
      }
      timer = clock.setTimeout(check, pollMs);
    };
    check();
    void timer;
  });

  return {
    holdId,
    decide(decision: ApprovalDecision): boolean {
      return broker.decide(holdId, decision);
    },
    then<TResult1 = ApprovalRecord, TResult2 = never>(
      onfulfilled?: ((value: ApprovalRecord) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return wait().then(onfulfilled, onrejected);
    },
  };
}
