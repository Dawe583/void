import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const preview = resolve(root, "packages/cli/src/tui/preview.ts");

function quote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function runInPty(command) {
  if (process.platform === "darwin") {
    const program =
      "set timeout 15; log_user 1; spawn -noecho sh -c $env(VOID_TUI_COMMAND); expect eof; set result [wait]; exit [lindex $result 3]";
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

for (const signal of ["INT", "TERM", "HUP"]) {
  const command = `stty sane cols 80 rows 30; node ${quote(preview)} 80 30 --interactive-hold & tui_pid=$!; sleep 1; kill -${signal} "$tui_pid"; wait "$tui_pid" >/dev/null 2>&1 || true; printf '\\nVOID_STTY '; stty -a`;
  const run = runInPty(command);
  if (run.status !== 0)
    throw new Error(`SIG${signal} PTY run failed:\n${run.stderr}`);
  const report =
    `${run.stdout ?? ""}${run.stderr ?? ""}`.split("VOID_STTY ").at(-1) ?? "";
  const canonical =
    /(?:^|[ ;])icanon(?:[ ;]|$)/m.test(report) &&
    !/(?:^|[ ;])-icanon(?:[ ;]|$)/m.test(report);
  const echo =
    /(?:^|[ ;])echo(?:[ ;]|$)/m.test(report) &&
    !/(?:^|[ ;])-echo(?:[ ;]|$)/m.test(report);
  if (!canonical || !echo)
    throw new Error(`SIG${signal} left terminal unsafe:\n${report}`);
  console.log(`SIG${signal.padEnd(4)} ok  echo=on  icanon=on`);
}
