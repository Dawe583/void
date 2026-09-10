import type { FeedPage } from "../../../ledger/src/feed.ts";
import type { TerminalCapabilities } from "./types.ts";
import { crop, fit, pad, rule, sanitizeText } from "./layout.ts";
import { paint } from "./theme.ts";

export type LiveView = {
  readonly page?: FeedPage;
  readonly workspace: string;
  readonly selected: number;
  readonly filter: string;
  readonly paused: boolean;
  readonly detail: boolean;
  readonly help: boolean;
  readonly error?: string;
};

export function liveRecords(view: LiveView) {
  return (view.page?.records ?? []).filter(row => !view.filter || row.klass === view.filter).slice().reverse();
}

export function renderLiveFeed(view: LiveView, caps: TerminalCapabilities): string {
  const width = caps.columns;
  const rows = liveRecords(view);
  const selected = rows[Math.min(view.selected, Math.max(0, rows.length - 1))];
  const lines = [
    paint(`VOID  /  ${sanitizeText(view.workspace)}`, "ink", caps, true),
    `${view.paused ? "Paused view" : "Live ledger"}  |  ${view.filter || "All classes"}  |  ${rows.length} records`,
    paint(rule(width), "rule", caps),
    view.error ? `Read failed: ${sanitizeText(view.error)}. Press v to retry.`
      : view.page?.signed ? "Signatures checked against the configured key"
      : "Integrity only. Signatures have not been checked.",
    "",
  ];
  if (view.help) {
    lines.push("Keyboard", "", "j/k or arrows   Select a record", "Enter           Inspect the full record", "Esc             Return to activity", "f               Filter R0 / R1 / R2 / R3 / all", "p               Pause ledger updates", "v               Read and verify again", "?               Toggle help", "q or Ctrl+C     Leave watch", "", "This view reads the ledger. It does not approve or replay calls.");
  } else if (view.detail && selected) {
    lines.push(paint(`Record #${selected.seq}`, "ink", caps, true), "");
    for (const [label, value] of [["Tool", selected.tool], ["Class", selected.klass.toUpperCase()], ["Decision", selected.decision], ["Time", selected.at], ["Digest", selected.digest], ["Previous", selected.prevDigest], ["Arguments", selected.argsDigest]]) {
      const text = sanitizeText(String(value));
      const valueWidth = Math.max(1, width - 12);
      for (let offset = 0; offset < text.length; offset += valueWidth)
        lines.push(`${pad(offset === 0 ? `${label}:` : "", 12)}${text.slice(offset, offset + valueWidth)}`);
    }
  } else if (rows.length === 0) {
    lines.push(view.filter ? "No records in this class. Press f to change the filter." : "No recorded calls yet.", "", "Run an agent through void-proxy to record its tool calls.");
  } else {
    lines.push(`${pad("Record", 10)}${pad("Class", 8)}${pad("Decision", 18)}Tool`);
    const available = Math.max(1, caps.rows - lines.length - 3);
    const start = Math.max(0, Math.min(view.selected - available + 1, rows.length - available));
    for (const [index, row] of rows.slice(start, start + available).entries()) {
      const active = start + index === view.selected;
      const line = `${active ? ">" : " "} ${pad(String(row.seq), 8)}${pad(row.klass.toUpperCase(), 8)}${pad(fit(sanitizeText(row.decision), 17), 18)}${sanitizeText(row.tool)}`;
      lines.push(paint(fit(line, width), active ? "r1" : "ink", caps, active));
    }
  }
  const body = crop(lines, width, Math.max(1, caps.rows - 2));
  while (body.length < caps.rows - 2) body.push("");
  body.push(rule(width), fit("j/k select  enter inspect  f filter  p pause  v refresh  ? help  q quit", width));
  return body.join("\n");
}
