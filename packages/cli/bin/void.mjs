#!/usr/bin/env node
/**
 * The void binary. WP-09 owns the full command surface; today only
 * classify is runnable, because it is the WP-04a exit criterion and the
 * one command a registry reviewer needs before any proxy exists.
 */
import { readFileSync } from "node:fs";
import { runClassifyCommand, parseInvocation } from "../src/index.ts";

const parsed = parseInvocation(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.reason);
  process.exit(2);
}
if (parsed.command !== "classify") {
  console.error(`${parsed.command} is not runnable yet`);
  process.exit(2);
}
try {
  const code = await runClassifyCommand(
    parsed.args,
    (path) => readFileSync(path, "utf8"),
    (line) => console.log(line),
  );
  process.exit(code);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
