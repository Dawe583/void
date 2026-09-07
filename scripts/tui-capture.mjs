import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const preview = resolve(root, "packages/cli/src/tui/preview.ts");
const ansi = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

function widths(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--cols")
      result.push(Number.parseInt(argv[index + 1] ?? "", 10));
  }
  return result.length > 0 ? result : [80, 120, 200];
}

function quote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function runInPty(command) {
  if (process.platform === "darwin") {
    const program =
      "set timeout 15; spawn -noecho sh -c $env(VOID_TUI_COMMAND); expect eof; set result [wait]; exit [lindex $result 3]";
    return spawnSync("expect", ["-c", program], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        VOID_TUI_COMMAND: command,
      },
    });
  }
  const args = ["-q", "-c", command, "/dev/null"];
  return spawnSync("script", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TERM: "xterm-256color" },
  });
}

for (const width of widths(process.argv.slice(2))) {
  if (!Number.isInteger(width) || width < 40)
    throw new Error(`invalid --cols value: ${width}`);
  const command = `stty cols ${width} rows 48; exec env -u CI -u NO_COLOR TERM=xterm-256color node ${quote(preview)} ${width} 48 --hold --modal`;
  const run = runInPty(command);
  if (run.status !== 0)
    throw new Error(`PTY capture at ${width} columns failed:\n${run.stderr}`);
  const raw = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const plain = raw.replace(ansi, "").replaceAll("\r", "");
  const content = plain
    .split("\n")
    .filter(
      (line) =>
        !/^Script (started|done)/.test(line) &&
        line !== "spawn sh -c $env(VOID_TUI_COMMAND)",
    );
  const longest = Math.max(0, ...content.map((line) => line.length));
  if (longest > width)
    throw new Error(
      `${width}-column capture overran: longest line was ${longest}`,
    );
  for (const marker of ["[0]", "[1]", "[2]", "[3]"]) {
    if (!plain.includes(marker))
      throw new Error(`${width}-column capture lost ${marker}`);
  }
  if (!raw.includes("\u001b["))
    throw new Error(`${width}-column PTY capture did not exercise ANSI output`);
  console.log(
    `${String(width).padStart(3)} cols  ok  longest=${longest}  ANSI=yes  R0-R3=yes`,
  );
}
