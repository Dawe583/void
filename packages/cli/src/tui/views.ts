import { box, crop, fit, pad, rule, sanitizeText } from "./layout.ts";
import { CLASS_MARKER, paint } from "./theme.ts";
import type {
  ReplayPlan,
  TerminalCapabilities,
  VerificationSummary,
} from "./types.ts";

export function renderHelp(capabilities: TerminalCapabilities): string {
  const width = Math.min(78, capabilities.columns);
  return crop(
    box(
      "VOID / KEYS",
      [
        "Navigation",
        "  j / k       move through intercepted calls",
        "  enter       open the complete decision record",
        "  f           filter by R0, R1, R2, R3 or all",
        "",
        "Actions",
        "  a / c       approve once or cancel a pending hold",
        "  r           preview replay, never execute immediately",
        "  v           verify ledger body, links and signatures",
        "  e           export the selected ledger slice",
        "",
        "Session",
        "  p           pause display updates, never the proxy",
        "  ?           close this help",
        "  q           leave watch mode, never stop the proxy",
      ],
      width,
    ),
    capabilities.columns,
    capabilities.rows,
  ).join("\n");
}

export function renderReplayPreview(
  plan: ReplayPlan,
  capabilities: TerminalCapabilities,
): string {
  const width = Math.min(96, capabilities.columns);
  const inner = width - 4;
  const rows = plan.steps.map((step) =>
    fit(
      `${String(step.order).padStart(2)} ${CLASS_MARKER[step.class]} ${pad(fit(sanitizeText(step.tool), 28, "left"), 28)} ${pad(fit(sanitizeText(step.target), 18, "left"), 18)} ${sanitizeText(step.action)}`,
      inner,
    ),
  );
  const blockers =
    plan.blocked.length === 0
      ? [paint("[+] no blocked steps", "r0", capabilities)]
      : plan.blocked.map((item) => paint(`[x] ${sanitizeText(item)}`, "r3", capabilities));
  // The responsive contract says every output is cropped to the reported
  // width and height; a replay plan longer than the screen must lose its
  // middle rows, not paint past the bottom into DiffScreenWriter row
  // addresses the terminal no longer has.
  return crop(
    box(
      "REPLAY PREVIEW / NO CHANGES MADE",
      [
        `workspace ${plan.workspace}`,
        `restore to ${plan.to}`,
        `snapshots ${plan.snapshotBytes} bytes in customer storage`,
        paint(rule(inner), "rule", capabilities),
        ...rows,
        paint(rule(inner), "rule", capabilities),
        ...blockers,
        "",
        "[enter] continue to explicit confirmation   [esc] cancel",
      ],
      width,
    ),
    width,
    capabilities.rows,
  ).join("\n");
}

export function renderLedgerVerification(
  summary: VerificationSummary,
  capabilities: TerminalCapabilities,
): string {
  const width = Math.min(82, capabilities.columns);
  const verdict = summary.valid
    ? summary.developmentKey
      ? paint("[!] valid, development key", "r2", capabilities, true)
      : paint("[+] valid", "r0", capabilities, true)
    : paint("[x] verification failed", "r3", capabilities, true);
  const failures = [
    ["body", summary.bodyFailures],
    ["link", summary.linkFailures],
    ["signature", summary.signatureFailures],
  ] as const;
  // Head and key id come from the ledger store, and the verification view
  // renders them at any width with no fit() truncation in between, so they
  // are sanitized like every other external string the render model shows.
  return crop(
    box(
      "LEDGER VERIFICATION",
      [
        verdict,
        "",
        `entries          ${summary.entries}`,
        `verified through ${summary.verifiedThrough}`,
        `head             ${sanitizeText(summary.head)}`,
        `key              ${sanitizeText(summary.keyId)}`,
        "",
        ...failures.map(
          ([label, entries]) =>
            `${pad(label, 16)}${entries.length === 0 ? "none" : entries.join(", ")}`,
        ),
      ],
      width,
    ),
    width,
    capabilities.rows,
  ).join("\n");
}
