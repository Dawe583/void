import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { probeCache } from "./cache.ts";
import type { Probe } from "./registry.ts";

describe("probe cache", () => {
  test("memoizes and expires with a fake clock", async () => {
    let now = 1_000;
    let runs = 0;
    const cache = probeCache(10, () => new Date(now));
    const probe: Probe = {
      id: "demo",
      async run() {
        runs += 1;
        return { radius: runs, facts: { seen: String(runs) }, note: `run ${runs}` };
      },
    };
    const call = { tool: "x", args: { table: "a" } };

    assert.deepEqual(await cache.run(probe, call, {}), { radius: 1, facts: { seen: "1" }, note: "run 1" });
    now = 5_000;
    assert.deepEqual(await cache.run(probe, call, {}), { radius: 1, facts: { seen: "1" }, note: "run 1" });
    now = 12_000;
    assert.deepEqual(await cache.run(probe, call, {}), { radius: 2, facts: { seen: "2" }, note: "run 2" });
    assert.equal(runs, 2);
    assert.equal(cache.size(), 1);
  });
});
