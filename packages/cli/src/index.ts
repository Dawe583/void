/**
 * The void command.
 *
 * The command handlers are WP-09 and do not exist yet. What is here is the
 * command surface, kept in one place so that an unknown command is a refusal
 * with the list rather than a silent no op, which is the shape the whole
 * product uses for anything it does not recognise, and the WP-09b terminal
 * render model under src/tui/, which is data in and glyphs out and owns no
 * domain behaviour of its own.
 */

export const COMMANDS = [
  "run",
  "classify",
  "feed",
  "watch",
  "approvals",
  "approve",
  "ledger",
  "replay",
  "policy",
  "export",
  "attest",
  "taint",
  "verify",
  "agent",
] as const;

export type Command = (typeof COMMANDS)[number];

export type ParsedInvocation =
  | { ok: true; command: Command; args: string[] }
  | { ok: false; reason: string };

/**
 * Takes argv as a parameter rather than reading process.argv, so the parser is
 * testable and the process boundary stays in the bin entry point.
 */
export function parseInvocation(argv: readonly string[]): ParsedInvocation {
  const [name, ...args] = argv;
  if (name === undefined || name === "") {
    return { ok: false, reason: `usage: void <${COMMANDS.join("|")}>` };
  }
  if (!(COMMANDS as readonly string[]).includes(name)) {
    return {
      ok: false,
      reason: `unknown command ${JSON.stringify(name)}, expected one of ${COMMANDS.join(", ")}`,
    };
  }
  return { ok: true, command: name as Command, args };
}

export * from "./tui/index.ts";
export * from "./classify.ts";
export * from "./feed.ts";
export * from "./replay.ts";
export * from "./taint.ts";
export * from "./verify.ts";
export * from "./approve.ts";
