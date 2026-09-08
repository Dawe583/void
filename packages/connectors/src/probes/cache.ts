import { createHash } from "node:crypto";

import type { Probe, ProbeCall, ProbeExecutor, ProbeResult } from "./registry.ts";

export type ProbeCacheEntry = {
  readonly radius: number | undefined;
  readonly facts: Readonly<Record<string, string>> | undefined;
  readonly note: string | undefined;
  readonly when: number;
};

export type ProbeCache = {
  readonly run: (probe: Probe, call: ProbeCall, exec: ProbeExecutor) => Promise<ProbeResult>;
  readonly size: () => number;
};

export function probeCache(seconds: number, clock: () => Date): ProbeCache {
  const entries = new Map<string, ProbeCacheEntry>();
  return {
    async run(probe, call, exec) {
      const key = digestCall(probe.id, call);
      const now = clock().getTime();
      const cached = entries.get(key);
      if (cached !== undefined && now - cached.when < seconds * 1000) {
        return { radius: cached.radius, facts: cached.facts, note: cached.note };
      }
      const result = await probe.run(call, exec);
      if (!("error" in result)) {
        entries.set(key, { radius: result.radius, facts: result.facts, note: result.note, when: now });
      }
      return result;
    },
    size() {
      return entries.size;
    },
  };
}

function digestCall(probeId: string, call: ProbeCall): string {
  return createHash("sha256").update(`${probeId}:${stableJson(call)}`).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
