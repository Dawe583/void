import { fit, pad, sanitizeText } from "./layout.ts";

export interface HeldCall {
  readonly id: string;
  readonly tool: string;
  readonly klass: string;
  readonly blastRadius: number | undefined;
  readonly ruleIndex: number;
  readonly rationale: string | undefined;
  readonly args: Readonly<Record<string, unknown>>;
  readonly heldAt: number;
  readonly expiresAt: number;
  readonly notify: readonly string[];
}

function countdown(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function radius(call: HeldCall): string {
  if (call.blastRadius === undefined) return "? targets";
  return `${call.blastRadius} target${call.blastRadius === 1 ? "" : "s"}`;
}

export function approvalsView(
  holds: readonly HeldCall[],
  now: number,
): string[] {
  const width = 96;
  const lines = ["VOID APPROVALS", "held calls waiting for one key decision"];
  if (holds.length === 0) {
    lines.push("", "No held calls.", "[q] quit");
    return lines;
  }

  lines.push("", "#  class  remaining  tool                         blast       rule");
  holds.forEach((hold, index) => {
    const klass = sanitizeText(hold.klass).toUpperCase();
    const line = `${String(index + 1).padStart(2)} ${pad(klass, 5)} ${countdown(hold.expiresAt, now)}     ${pad(fit(sanitizeText(hold.tool), 28, "left"), 28)} ${pad(radius(hold), 11)} rule ${hold.ruleIndex}`;
    lines.push(fit(line, width));
    if (hold.rationale !== undefined)
      lines.push(fit(`   ${sanitizeText(hold.rationale)}`, width));
  });
  lines.push("", "[y] approve selected   [n] deny selected   [j/k] move   [q] quit");
  return lines;
}
