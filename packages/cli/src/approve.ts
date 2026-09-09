/**
 * A separate process can confirm durable queuing, not successful release. The
 * proxy owns expiry and resolution; this command must not print "approved" as
 * an outcome. Local state needs no network credentials or listening socket.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { loadPending, writeDecision } from "../../policy/src/approvals.ts";
import type { ApprovalFs } from "../../policy/src/approvals.ts";

export type ApproveCommandIo = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
};
export type ApproveCommandOptions = { readonly fs?: ApprovalFs; readonly now?: () => number };

export async function runApproveCommand(
  argv: readonly string[], io: ApproveCommandIo, options: ApproveCommandOptions = {},
): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try { args = parseArgs(argv, true, io.env ?? process.env); }
  catch (error) { io.stderr(message(error)); return 2; }
  try {
    writeDecision(args.dir, args.holdId!, {
      kind: args.deny ? "denied" : "approved", by: args.by!,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    }, options.fs, options.now);
    io.stdout(args.json ? JSON.stringify({ holdId: args.holdId, status: "queued", decision: args.deny ? "denied" : "approved" }) :
      `decision queued for ${args.holdId}: ${args.deny ? "deny" : "approve"}; proxy resolution not confirmed`);
    return 0;
  } catch { io.stderr("could not queue decision: state unavailable, invalid, or hold not pending"); return 1; }
}

export async function runApprovalsCommand(
  argv: readonly string[], io: ApproveCommandIo, options: ApproveCommandOptions = {},
): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try { args = parseArgs(argv, false, io.env ?? process.env); }
  catch (error) { io.stderr(message(error)); return 2; }
  try {
    const pending = loadPending(args.dir, options.fs).filter((record) => record.expiresAt > (options.now ?? Date.now)());
    if (args.json) io.stdout(JSON.stringify(pending));
    else if (pending.length === 0) io.stdout("no pending holds in state directory");
    else for (const record of pending) io.stdout(`${record.holdId} ${record.call.tool} ${record.call.klass} expires ${new Date(record.expiresAt).toISOString()}`);
    return 0;
  } catch { io.stderr("could not read pending approvals: state unavailable or invalid"); return 1; }
}

function parseArgs(argv: readonly string[], approve: boolean, env: Readonly<NodeJS.ProcessEnv>) {
  let holdId: string | undefined;
  let by: string | undefined;
  let reason: string | undefined;
  let dir: string | undefined;
  let deny = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") json = true;
    else if (arg === "--deny" && approve) deny = true;
    else if (arg === "--dir" || (approve && (arg === "--by" || arg === "--reason"))) {
      const value = argv[++index];
      if (value === undefined || value.trim() === "" || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--dir") dir = value;
      else if (arg === "--by") by = value;
      else reason = value;
    } else if (approve && holdId === undefined && !arg.startsWith("-") && arg.trim() !== "") holdId = arg;
    else throw new Error("invalid approval command option");
  }
  if (approve && (holdId === undefined || by === undefined)) throw new Error("usage: void approve <holdId> --by actor [--reason text] [--dir path] [--deny] [--json]");
  const workspace = env.VOID_WORKSPACE ?? "default";
  if (dir === undefined && env.VOID_APPROVALS_DIR === undefined && !/^[a-zA-Z0-9_-]+$/.test(workspace)) throw new Error("invalid workspace");
  return { holdId, by, reason, deny, json, dir: dir ?? env.VOID_APPROVALS_DIR ?? join(homedir(), ".void", "approvals", workspace) };
}

function message(error: unknown): string { return error instanceof Error ? error.message : "invalid approval arguments"; }
