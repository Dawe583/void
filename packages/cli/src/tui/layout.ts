// CSI (any final byte), OSC terminated by BEL or ST, and two character ESC
// sequences. paint() emits only SGR, but stripAnsi also guards the width
// accounting against sequences that arrived from outside the render model,
// because sanitizeText removes those at the entry point and this is the second
// line of defence.
const ANSI_PATTERN =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

// Every character that a terminal interprets rather than prints: C0 controls
// including newline, DEL, C1, zero width and bidi override characters. A hold
// modal renders strings that came from an agent and an upstream server, and an
// escape sequence injected there can clear the screen, move the cursor or spoof
// a colour coded allow verdict in the seconds before a human approves a write.
// The replacement is a visible question mark, not a deletion, so a hostile or
// merely broken tool id still shows that something odd was in the data.
const UNPRINTABLE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

export function sanitizeText(value: string): string {
  return value.replace(UNPRINTABLE, "?");
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

/**
 * Cell width per code point, not per code unit. East Asian wide and fullwidth
 * characters occupy two terminal cells, combining marks occupy none, and
 * treating either wrongly either wraps a line or misaligns a box. This is the
 * pragmatic range table, not the full Unicode width table: the package has a
 * no dependency rule, and the uncovered ranges are scripts this product is
 * unlikely to render in a tool id. The adversarial test covers CJK and emoji.
 */
function cellWidth(point: string): number {
  const code = point.codePointAt(0) ?? 0;
  if (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f)
  )
    return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f8ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
    return 2;
  // Emoji and symbol blocks that terminals draw two cells wide although the
  // East Asian Width property alone does not force it: the presentation
  // selector defaults to emoji style and every mainstream terminal uses the
  // emoji width. Missing these made the model undercount real terminal rows
  // while agreeing with itself, which is the worst failure shape for a
  // border drawing renderer.
  if (
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0x1f000 && code <= 0x1f2ff) ||
    (code >= 0x1f0a0 && code <= 0x1f0f5)
  )
    return 2;
  return 1;
}

export function visibleLength(value: string): number {
  let total = 0;
  for (const point of stripAnsi(value)) total += cellWidth(point);
  return total;
}

export function fit(
  value: string,
  width: number,
  side: "left" | "right" = "right",
): string {
  if (width <= 0) return "";
  const plain = stripAnsi(value);
  if (visibleLength(plain) <= width) return value;
  if (width === 1) return ".";
  const points = [...plain];
  if (side === "left") {
    let kept = "";
    let used = 0;
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index]!;
      const cells = cellWidth(point);
      // Reserve one cell for the truncation marker and never split a wide
      // character: a half wide character renders as replacement garbage.
      if (used + cells > width - 1) break;
      kept = point + kept;
      used += cells;
    }
    return `.${kept}`;
  }
  let kept = "";
  let used = 0;
  for (const point of points) {
    const cells = cellWidth(point);
    if (used + cells > width - 1) break;
    kept += point;
    used += cells;
  }
  return `${kept}.`;
}

export function pad(value: string, width: number): string {
  const fitted = fit(value, width);
  return `${fitted}${" ".repeat(Math.max(0, width - visibleLength(fitted)))}`;
}

export function rule(width: number, character = "-"): string {
  return character.repeat(Math.max(0, width));
}

export function box(
  title: string,
  content: readonly string[],
  width: number,
): string[] {
  const inner = Math.max(1, width - 2);
  const titleText =
    title === "" ? "" : ` ${fit(title, Math.max(1, inner - 2))} `;
  const top = `+${titleText}${rule(inner - visibleLength(titleText))}+`;
  const body = content.map((line) => `|${pad(line, inner)}|`);
  return [top, ...body, `+${rule(inner)}+`];
}

export function columns(
  left: readonly string[],
  right: readonly string[],
  leftWidth: number,
  gap = 1,
): string[] {
  const height = Math.max(left.length, right.length);
  const result: string[] = [];
  for (let index = 0; index < height; index += 1) {
    result.push(
      `${pad(left[index] ?? "", leftWidth)}${" ".repeat(gap)}${right[index] ?? ""}`,
    );
  }
  return result;
}

export function crop(
  lines: readonly string[],
  width: number,
  height: number,
): string[] {
  return lines.slice(0, Math.max(0, height)).map((line) => fit(line, width));
}

export function meter(value: number, max: number, width: number): string {
  const safeMax = Math.max(1, max);
  const filled = Math.max(
    0,
    Math.min(width, Math.round((value / safeMax) * width)),
  );
  return `${"#".repeat(filled)}${".".repeat(Math.max(0, width - filled))}`;
}
