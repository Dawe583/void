import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadPolicy } from "../../packages/policy/src/rules.ts";
import { decide } from "../../packages/policy/src/decide.ts";
import { HoldQueue, holdErrorMessage } from "../../packages/policy/src/hold.ts";
import { keyToRelease, renderQueue } from "../../packages/policy/src/channels/cli.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const policyText = readFileSync(resolve(root, "policy/default.yaml"), "utf8");
const loaded = loadPolicy(policyText);

if (!loaded.ok) {
  console.error(loaded.errors.join("\n"));
  process.exitCode = 1;
} else {
  const orders = { rows: 41883 };
  const call = {
    tool: "postgres.row.delete",
    connector: "postgres",
    workspace: "dev",
    klass: "r1",
    blastRadius: orders.rows,
  };
  const decision = decide(loaded, call);
  if (decision.kind !== "hold") {
    console.error(`expected a hold, got ${decision.kind}`);
    process.exitCode = 1;
  } else {
    const queue = new HoldQueue();
    const waiting = queue.hold(
      {
        tool: call.tool,
        klass: call.klass,
        blastRadius: call.blastRadius,
        ruleIndex: decision.ruleIndex,
        rationale: decision.rationale,
        args: { table: "orders", where: "status = 'draft'" },
        notify: decision.notify,
      },
      decision.seconds,
    );
    const view = renderQueue(queue);
    const held = queue.list()[0];
    if (held === undefined || view.ids[0] !== held.id) {
      console.error("expected one pending hold");
      process.exitCode = 1;
    } else {
      console.log(`held: ${held.tool} (${held.klass}, ${held.blastRadius} rows)  waiting for approval`);
      const release = keyToRelease("n");
      if (release === null || !queue.resolve(held.id, release)) {
        console.error("could not cancel hold");
        process.exitCode = 1;
      } else {
        const resolution = await waiting;
        console.log("cancelled by cli");
        console.log(`orders unchanged: ${orders.rows} rows`);
        const body = holdErrorMessage(resolution.call, resolution.outcome, "hold");
        console.log(`agent said: "The delete was blocked by policy: ${body.message}"`);
        queue.close();
      }
    }
  }
}
