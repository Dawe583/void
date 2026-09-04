/**
 * The void command.
 *
 * Nothing is implemented yet. WP-09 lands the commands themselves. What is here
 * is the command surface, kept in one place so that an unknown command is a
 * refusal with the list rather than a silent no op, which is the shape the
 * whole product uses for anything it does not recognise.
 */

export const COMMANDS = ["run", "ledger", "replay", "attest"] as const;

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
    return { ok: false, reason: `unknown command ${JSON.stringify(name)}, expected one of ${COMMANDS.join(", ")}` };
  }
  return { ok: true, command: name as Command, args };
}
