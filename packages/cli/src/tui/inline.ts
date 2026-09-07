import { fit, pad, sanitizeText, visibleLength } from "./layout.ts";
import { classLabel, decisionLabel, paint } from "./theme.ts";
import type { InterceptedCall, TerminalCapabilities } from "./types.ts";

export function renderInlineCall(
  call: InterceptedCall,
  capabilities: TerminalCapabilities,
): string {
  const width = capabilities.columns;
  const radius =
    call.blastRadius === null
      ? "? targets"
      : `${call.blastRadius} target${call.blastRadius === 1 ? "" : "s"}`;
  const fixed = `${sanitizeText(call.time)} ${classLabel(call.class, capabilities)} ${decisionLabel(call.decision, capabilities)} `;
  const suffix = ` ${radius} ${call.durationMs}ms`;
  const toolWidth = Math.max(
    12,
    width - visibleLength(fit(fixed, width)) - suffix.length,
  );
  // Left truncation keeps the resource and action suffix of a long tool id,
  // which is where the meaning lives. The tool id is external data, so it is
  // sanitized before any of the width math, not after.
  const tool = fit(sanitizeText(call.tool), toolWidth, "left");
  return fit(
    `${fixed}${pad(tool, toolWidth)}${paint(suffix, "muted", capabilities)}`,
    width,
  );
}
