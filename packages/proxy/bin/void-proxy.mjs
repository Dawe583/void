#!/usr/bin/env node
import { runProxy, PolicyStartupError, ProxyStartupError, UpstreamStartError } from "../src/bin.ts";

const args = process.argv.slice(2);

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function usage() {
  return "usage: void-proxy --policy path [--transport stdio|http] [--upstream cmd] [--args a,b] [--upstream-url url] [--facts path] [--posture fail-closed|observe] [--ledger-dir dir] [--workspace name]";
}

async function main() {
  const upstream = readFlag("--upstream");
  const policy = readFlag("--policy");
  const rawArgs = readFlag("--args");
  const facts = readFlag("--facts");
  const posture = readFlag("--posture") ?? "fail-closed";
  const ledgerDir = readFlag("--ledger-dir");
  const workspace = readFlag("--workspace") ?? "default";
  const transport = readFlag("--transport") ?? "stdio";
  const upstreamUrl = readFlag("--upstream-url");

  if (policy === undefined) throw new Error(usage());
  if (transport !== "stdio" && transport !== "http") throw new Error("--transport must be stdio or http");
  if (transport === "stdio" && upstream === undefined) throw new Error(usage());
  if (posture !== "fail-closed" && posture !== "observe") throw new Error("--posture must be fail-closed or observe");

  const upstreamArgs = rawArgs === undefined || rawArgs === "" ? [] : rawArgs.split(",");
  await runProxy({
    upstreamCommand: upstream === undefined ? undefined : [upstream, ...upstreamArgs],
    transport,
    upstreamUrl,
    policyPath: policy,
    factsPath: facts,
    posture,
    ledgerDir,
    workspace,
  });
}

try {
  await main();
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (error instanceof UpstreamStartError) process.exitCode = 2;
  else if (error instanceof PolicyStartupError || error instanceof ProxyStartupError) process.exitCode = 1;
  else process.exitCode = 1;
}
