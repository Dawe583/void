import { detectCapabilities } from "./caps.ts";
import { previewHold, previewState } from "./fixtures.ts";
import { promptForHold, renderHoldPrompt } from "./modal.ts";
import { renderWatchFrame } from "./watch.ts";

// Standards rule 10: the fixtures carry invented counts and hashes, so the
// preview states the illustrative nature of its own data rather than letting
// realistic looking numbers stand as if a proxy had produced them.
const ILLUSTRATIVE = "illustrative fixture, not a live session";

const dimensions = process.argv
  .slice(2)
  .filter((argument) => /^\d+$/.test(argument));
const width = Number.parseInt(dimensions[0] ?? "120", 10);
const height = Number.parseInt(dimensions[1] ?? "38", 10);
const detected = detectCapabilities();
const capabilities = {
  ...detected,
  columns: Math.max(40, width),
  rows: Math.max(12, height),
};
const state = process.argv.includes("--hold")
  ? { ...previewState, holds: [previewHold] }
  : previewState;

if (process.argv.includes("--interactive-hold")) {
  const result = await promptForHold(previewHold, capabilities);
  process.stdout.write(
    `hold=${result} raw=${process.stdin.isRaw === true ? "on" : "off"}\n`,
  );
} else {
  process.stdout.write(
    `${renderWatchFrame(state, capabilities)}\n${ILLUSTRATIVE}\n`,
  );
  if (process.argv.includes("--modal"))
    process.stdout.write(
      `\n${renderHoldPrompt(previewHold, capabilities)}\n${ILLUSTRATIVE}\n`,
    );
}
