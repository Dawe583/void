import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const preview = resolve(root, "packages/cli/src/tui/preview.ts");
const cases = [
  ["piped", {}],
  ["NO_COLOR", { NO_COLOR: "1" }],
  ["TERM=dumb", { TERM: "dumb" }],
  ["CI", { CI: "1" }],
];

for (const [name, additions] of cases) {
  const env = { ...process.env, ...additions };
  if (!("TERM" in additions)) env.TERM = "xterm-256color";
  if (!("CI" in additions)) delete env.CI;
  if (!("NO_COLOR" in additions)) delete env.NO_COLOR;
  const run = spawnSync(
    process.execPath,
    [preview, "120", "40", "--hold", "--modal"],
    {
      cwd: root,
      encoding: "utf8",
      env,
    },
  );
  if (run.status !== 0)
    throw new Error(`${name} render failed:\n${run.stderr}`);
  if (/\u001b\[/.test(run.stdout))
    throw new Error(`${name} leaked ANSI escape sequences`);
  for (const text of [
    "WRITE PATH",
    "ACTION REQUIRED",
    "[0] R0",
    "[1] R1",
    "[2] R2",
    "[3] R3",
  ]) {
    if (!run.stdout.includes(text))
      throw new Error(`${name} render lost ${text}`);
  }
  console.log(`${name.padEnd(10)} ok  ANSI=0  safety information=complete`);
}
