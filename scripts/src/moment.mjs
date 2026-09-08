import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { approvalsView } from "../../packages/cli/src/tui/approvals.ts";
import { decide } from "../../packages/policy/src/decide.ts";
import { keyToRelease, renderQueue } from "../../packages/policy/src/channels/cli.ts";
import { HoldQueue, holdErrorMessage } from "../../packages/policy/src/hold.ts";
import { loadPolicy } from "../../packages/policy/src/rules.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const policyText = readFileSync(resolve(root, "policy/default.yaml"), "utf8");
const loaded = loadPolicy(policyText);
const args = new Set(process.argv.slice(2));

const scenarios = [
  {
    name: "postgres delete denied",
    call: {
      tool: "postgres.row.delete",
      connector: "postgres",
      workspace: "dev",
      klass: "r1",
      blastRadius: 41883,
    },
    toolArgs: { table: "orders", where: "status = 'draft'" },
    key: "n",
    resultLine: "orders unchanged: 41883 rows",
    agentLine: (message) => `agent said: "The delete was blocked by policy: ${message}"`,
  },
  {
    name: "postgres delete approved",
    call: {
      tool: "postgres.row.delete",
      connector: "postgres",
      workspace: "dev",
      klass: "r3",
      blastRadius: 2,
    },
    toolArgs: { table: "orders", where: "id in (17, 23)" },
    key: "y",
    resultLine: "simulated result: 2 rows deleted",
  },
];

function checkedDecision(scenario) {
  const decision = decide(loaded, scenario.call);
  if (decision.kind !== "hold")
    throw new Error(`expected a hold for ${scenario.name}, got ${decision.kind}`);
  return decision;
}

async function runScenario(scenario) {
  const decision = checkedDecision(scenario);
  const queue = new HoldQueue();
  const ledger = [];
  const waiting = queue.hold(
    {
      tool: scenario.call.tool,
      klass: scenario.call.klass,
      blastRadius: scenario.call.blastRadius,
      ruleIndex: decision.ruleIndex,
      rationale: decision.rationale,
      args: scenario.toolArgs,
      notify: decision.notify,
    },
    decision.seconds,
  );
  const view = renderQueue(queue);
  const held = queue.list()[0];
  if (held === undefined || view.ids[0] !== held.id)
    throw new Error(`expected one pending hold for ${scenario.name}`);

  ledger.push("held");
  const release = keyToRelease(scenario.key);
  if (release === null || !queue.resolve(held.id, release))
    throw new Error(`could not resolve hold for ${scenario.name}`);

  const resolution = await waiting;
  const approved =
    resolution.outcome.kind === "released" &&
    resolution.outcome.release.kind === "approved";
  if (approved) ledger.push("forwarded");
  else ledger.push("cancelled");

  const lines = [
    `moment: ${scenario.name}`,
    `held: ${held.tool} (${held.klass}, ${held.blastRadius} rows)  waiting for approval`,
    approved ? "approved by cli" : "cancelled by cli",
  ];
  if (approved) lines.push("forwarded");
  lines.push(scenario.resultLine);
  lines.push(`ledger records: ${ledger.length}`);
  if (scenario.agentLine !== undefined) {
    const body = holdErrorMessage(resolution.call, resolution.outcome, "hold");
    lines.push(scenario.agentLine(body.message));
  }
  queue.close();
  return lines;
}

async function runText() {
  const chunks = [];
  for (const scenario of scenarios) {
    if (chunks.length > 0) chunks.push("");
    chunks.push(...(await runScenario(scenario)));
  }
  return `${chunks.join("\n")}\n`;
}

async function runTui() {
  const scenario = scenarios[1];
  const decision = checkedDecision(scenario);
  const queue = new HoldQueue();
  const waiting = queue.hold(
    {
      tool: scenario.call.tool,
      klass: scenario.call.klass,
      blastRadius: scenario.call.blastRadius,
      ruleIndex: decision.ruleIndex,
      rationale: decision.rationale,
      args: scenario.toolArgs,
      notify: decision.notify,
    },
    decision.seconds,
  );
  const held = queue.list()[0];
  if (held === undefined) throw new Error("expected one pending hold for tui");
  const first = approvalsView(queue.list(), held.heldAt).join("\n");
  const release = keyToRelease("y");
  if (release === null || !queue.resolve(held.id, release))
    throw new Error("could not approve tui hold");
  await waiting;
  const second = approvalsView(queue.list(), held.heldAt + 1000).join("\n");
  queue.close();
  return `${first}\n\n${second}\n`;
}

if (!loaded.ok) {
  console.error(loaded.errors.join("\n"));
  process.exitCode = 1;
} else {
  try {
    process.stdout.write(await (args.has("--tui") ? runTui() : runText()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
