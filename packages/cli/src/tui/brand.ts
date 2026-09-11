import { fit, sanitizeText } from "./layout.ts";
import { paint } from "./theme.ts";
import type { TerminalCapabilities } from "./types.ts";

// Rasterize the original void-empty Aperture paths, in their 55 55 146 146
// header viewBox. Half blocks preserve the geometry on a character terminal.
function pixel(x: number, y: number): "ink" | "accent" | undefined {
  const dx = Math.abs(x - 128), dy = Math.abs(y - 128);
  if (dx * dx + dy * dy <= 36) return "ink";
  if (Math.max(dx, dy) <= 26 && Math.max(dx, dy) >= 14) return "accent";
  if ((dx >= 47.5 && dx <= 62.5 && dy >= 18.5 && dy <= 62.5)
    || (dy >= 47.5 && dy <= 62.5 && dx >= 18.5 && dx <= 62.5)) return "ink";
  return undefined;
}

export function brandHeader(label: string, caps: TerminalCapabilities): string[] {
  return Array.from({ length: 7 }, (_, row) => {
    let line = "";
    for (let column = 0; column < 13; column++) {
      const x = 55 + (column + 0.5) * 146 / 13;
      const top = pixel(x, 55 + (row * 2 + 0.5) * 146 / 14);
      const bottom = pixel(x, 55 + (row * 2 + 1.5) * 146 / 14);
      const glyph = top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
      line += paint(glyph, top ?? bottom ?? "ink", caps);
    }
    return fit(`${line}  ${row === 3 ? sanitizeText(label) : ""}`, caps.columns);
  });
}
