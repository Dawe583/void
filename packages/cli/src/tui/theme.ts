import type {
  CallDecision,
  ReversibilityClass,
  TerminalCapabilities,
} from "./types.ts";

export const VOID_PALETTE = {
  accent: "#bd4206",
  paper: "#1d1d1f",
  ink: "#f5f5f7",
  muted: "#86868b",
  rule: "#38383a",
  r0: "#5cc094",
  r1: "#2997ff",
  r2: "#dcbc63",
  r3: "#f47a88",
} as const;

export const CLASS_MARKER: Record<ReversibilityClass, string> = {
  r0: "[0]",
  r1: "[1]",
  r2: "[2]",
  r3: "[3]",
};

export const DECISION_MARKER: Record<CallDecision, string> = {
  allow: "+",
  hold: "!",
  deny: "x",
};

type Tone = keyof typeof VOID_PALETTE;

const ANSI_16: Record<Tone, number> = {
  accent: 33,
  paper: 30,
  ink: 97,
  muted: 37,
  rule: 90,
  r0: 32,
  r1: 94,
  r2: 33,
  r3: 91,
};

const ANSI_256: Record<Tone, number> = {
  accent: 166,
  paper: 233,
  ink: 255,
  muted: 102,
  rule: 239,
  r0: 78,
  r1: 111,
  r2: 179,
  r3: 211,
};

function trueColor(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `38;2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}`;
}

export function paint(
  text: string,
  tone: Tone,
  capabilities: TerminalCapabilities,
  bold = false,
): string {
  if (!capabilities.ansi || capabilities.colorDepth === 0) return text;
  const color =
    capabilities.colorDepth === 24
      ? trueColor(VOID_PALETTE[tone])
      : capabilities.colorDepth === 8
        ? `38;5;${ANSI_256[tone]}`
        : String(ANSI_16[tone]);
  return `\u001b[${bold ? "1;" : ""}${color}m${text}\u001b[0m`;
}

export function classLabel(
  value: ReversibilityClass,
  capabilities: TerminalCapabilities,
): string {
  return paint(
    `${CLASS_MARKER[value]} ${value.toUpperCase()}`,
    value,
    capabilities,
    true,
  );
}

export function decisionLabel(
  value: CallDecision,
  capabilities: TerminalCapabilities,
): string {
  const tone: Tone = value === "allow" ? "r0" : value === "hold" ? "r2" : "r3";
  return paint(
    `[${DECISION_MARKER[value]}] ${value}`,
    tone,
    capabilities,
    true,
  );
}
