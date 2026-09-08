#!/usr/bin/env node
/**
 * The void binary. The runnable surface grows package by package, and any
 * command not wired yet fails loudly rather than pretending to succeed.
 */
import { readFileSync } from "node:fs";
import { runClassifyCommand, runFeedCommand, runReplayCommand, parseInvocation } from "../src/index.ts";

const parsed = parseInvocation(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.reason);
  process.exit(2);
}
try {
  if (parsed.command === "classify") {
    const code = await runClassifyCommand(
      parsed.args,
      (path) => readFileSync(path, "utf8"),
      (line) => console.log(line),
    );
    process.exit(code);
  }
  if (parsed.command === "feed") {
    const code = await runFeedCommand(parsed.args, {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (!parsed.args.includes("--follow") || code !== 0) process.exit(code);
  } else if (parsed.command === "replay") {
    const code = await runReplayCommand(parsed.args, {
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    process.exit(code);
  } else if (parsed.command === "approvals") {
    console.log("no holds live: the proxy is not running");
    process.exit(0);
  } else {
    console.error(`${parsed.command} is not runnable yet`);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
