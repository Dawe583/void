#!/usr/bin/env node
/**
 * The void binary. The runnable surface grows package by package, and any
 * command not wired yet fails loudly rather than pretending to succeed.
 */
import { runRecoveryCommand } from "../src/recovery.ts";
import { runAgentCommand } from "../src/agent.ts";
import { runOperation } from "../src/operations.ts";
import { runWatchCommand } from "../src/watch.ts";
import { runApproveCommand, runApprovalsCommand } from "../src/approve.ts";
import { readFileSync } from "node:fs";
import { runClassifyCommand, runFeedCommand, runReplayCommand, runTaintCommand, runVerifyCommand, parseInvocation } from "../src/index.ts";

const parsed = parseInvocation(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.reason);
  process.exit(2);
}
try {
  if (parsed.command === "recovery") process.exitCode = await runRecoveryCommand(parsed.args);
  else if (parsed.command === "agent") process.exit(await runAgentCommand(parsed.args));
  else if (parsed.command === "run") { await import("../../proxy/bin/void-proxy.mjs"); }
  else if (["attest", "export", "policy"].includes(parsed.command)) process.exit(await runOperation(parsed.command, parsed.args, process.env, text => console.log(text)));
  else if (parsed.command === "ledger") {
    const [action, ...args] = parsed.args;
    if (action !== "verify") throw new Error("usage: void ledger verify --ledger <path>");
    process.exit(await runVerifyCommand(args, { stdout: console.log, stderr: console.error }));
  }
  else if (parsed.command === "watch") process.exit(await runWatchCommand(parsed.args));
  else if (parsed.command === "classify") {
    const code = await runClassifyCommand(
      parsed.args,
      (path) => readFileSync(path, "utf8"),
      (line) => console.log(line),
    );
    process.exit(code);
  }
  else if (parsed.command === "feed") {
    const code = await runFeedCommand(parsed.args, {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (!parsed.args.includes("--follow") || code !== 0) process.exit(code);
  } else if (parsed.command === "replay") {
    const code = await runReplayCommand(parsed.args, {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      env: process.env,
    });
    process.exit(code);
  } else if (parsed.command === "taint") {
    const code = await runTaintCommand(parsed.args, {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    process.exit(code);
  } else if (parsed.command === "verify") {
    const code = await runVerifyCommand(parsed.args, {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    process.exit(code);
  } else if (parsed.command === "approve" || parsed.command === "approvals") {
    const run = parsed.command === "approve" ? runApproveCommand : runApprovalsCommand;
    process.exit(await run(parsed.args, {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      env: process.env,
    }));
  } else {
    console.error(`${parsed.command} is not runnable yet`);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
