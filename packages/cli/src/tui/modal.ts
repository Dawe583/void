import { box, crop, fit, rule, sanitizeText } from "./layout.ts";
import { classLabel, paint } from "./theme.ts";
import type { PendingHold, TerminalCapabilities } from "./types.ts";

export function renderHoldPrompt(
  hold: PendingHold,
  capabilities: TerminalCapabilities,
  now = Date.now(),
): string {
  const width = Math.min(
    capabilities.columns,
    Math.max(40, Math.min(76, capabilities.columns - 2)),
  );
  const remaining = Math.max(0, Math.ceil((hold.expiresAt - now) / 1000));
  const radius =
    hold.call.blastRadius === null
      ? "not measured"
      : `${hold.call.blastRadius} target${hold.call.blastRadius === 1 ? "" : "s"}, measured`;
  // The fields below all come from the intercepted call, which means from the
  // agent and the upstream server. The modal is the one screen a human reads
  // immediately before approving a write, so nothing enters it unescaped.
  const call = hold.call;
  // Information rows lose their place before the countdown and the action
  // row do: a short terminal must still show what to press, so the drop
  // order here is agent and workspace first, then policy and reason.
  const information = [
    `agent          ${sanitizeText(call.agent)}`,
    `workspace      ${sanitizeText(call.workspace)}`,
    `policy         ${sanitizeText(call.policyRule)}`,
    `blast radius   ${radius}`,
    `inverse        ${call.inverse === null ? "none" : sanitizeText(call.inverse)}`,
    `compensation   ${call.compensation === null ? "none" : sanitizeText(call.compensation)}`,
    `reason         ${fit(sanitizeText(call.reason), width - 19)}`,
  ];
  const tail = [
    paint(
      `HOLDING ${String(remaining).padStart(3)}s`,
      "r2",
      capabilities,
      true,
    ),
    `${paint("[a] approve once", "r0", capabilities, true)}   ${paint("[c] cancel", "r3", capabilities, true)}   [d] details`,
  ];
  // The box costs 4 lines of chrome (top, rule, tail rule is inside contents
  // below, bottom); keep the arithmetic explicit so the reservation cannot
  // drift when a row is added later.
  const chrome = 4;
  const headroom = capabilities.rows - chrome - tail.length;
  const kept =
    headroom >= information.length
      ? information
      : information.slice(Math.max(0, information.length - headroom));
  const contents = [
    `${classLabel(call.class, capabilities)}  ${fit(sanitizeText(call.tool), width - 14, "left")}`,
    paint(rule(width - 4), "rule", capabilities),
    ...kept,
    ...(headroom > information.length ? [""] : []),
    ...tail,
  ];
  return crop(
    box("VOID / HUMAN DECISION", contents, width),
    capabilities.columns,
    capabilities.rows,
  ).join("\n");
}

export type HoldResolution = "approve" | "cancel" | "expired";

export interface RawInput {
  setRawMode?(mode: boolean): void;
  resume(): void;
  pause(): void;
  once(event: "error", listener: (error: Error) => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  off(event: "error", listener: (error: Error) => void): this;
  off(event: "data", listener: (chunk: Buffer) => void): this;
}

export async function promptForHold(
  hold: PendingHold,
  capabilities: TerminalCapabilities,
  input: RawInput = process.stdin,
  output: Pick<NodeJS.WriteStream, "write"> = process.stderr,
  now: () => number = Date.now,
): Promise<HoldResolution> {
  if (!capabilities.interactive || input.setRawMode === undefined)
    return "expired";

  let timer: NodeJS.Timeout | undefined;
  let restored = false;
  let onData: ((chunk: Buffer) => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  let exitHandler: (() => void) | undefined;
  let exceptionHandler: ((error: Error) => void) | undefined;
  let previousFrame: string[] = [];
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (timer !== undefined) clearInterval(timer);
    input.setRawMode?.(false);
    input.pause();
    if (onData !== undefined) input.off("data", onData);
    if (onError !== undefined) input.off("error", onError);
    for (const [signal, handler] of signalHandlers)
      process.off(signal, handler);
    if (exitHandler !== undefined) process.off("exit", exitHandler);
    if (exceptionHandler !== undefined)
      process.off("uncaughtException", exceptionHandler);
    output.write("\u001b[?25h\u001b[?1049l\n");
  };

  return await new Promise<HoldResolution>((resolve, reject) => {
    const finish = (result: HoldResolution): void => {
      restore();
      resolve(result);
    };
    const fail = (error: Error): void => {
      restore();
      reject(error);
    };
    onError = fail;
    exitHandler = restore;
    exceptionHandler = (error: Error): void => {
      restore();
      setImmediate(() => {
        throw error;
      });
    };
    const draw = (): void => {
      const nextFrame = renderHoldPrompt(hold, capabilities, now()).split("\n");
      for (
        let index = 0;
        index < Math.max(previousFrame.length, nextFrame.length);
        index += 1
      ) {
        const line = nextFrame[index] ?? "";
        if (line !== (previousFrame[index] ?? ""))
          output.write(`\u001b[${index + 1};1H${line}\u001b[K`);
      }
      previousFrame = nextFrame;
      if (now() >= hold.expiresAt) finish("expired");
    };
    onData = (chunk: Buffer): void => {
      const key = chunk.toString("utf8").toLowerCase();
      if (key === "a") {
        // The expiry check lives in the keypress path too, not only on the
        // redraw tick, because a key arriving between two ticks would
        // otherwise approve a hold up to 250ms after it had expired.
        finish(now() >= hold.expiresAt ? "expired" : "approve");
      } else if (key === "c" || key === "q" || key === "\u0003") {
        finish("cancel");
      }
    };

    try {
      input.setRawMode?.(true);
      input.resume();
      input.once("error", onError);
      input.on("data", onData);
      process.once("exit", exitHandler);
      process.once("uncaughtException", exceptionHandler);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        const handler = (): void => {
          restore();
          process.kill(process.pid, signal);
        };
        signalHandlers.set(signal, handler);
        process.once(signal, handler);
      }
      output.write("\u001b[?1049h\u001b[?25l\u001b[H");
      // The first draw runs on the timer, not synchronously: a hold that is
      // already expired at call time would otherwise finish and restore
      // before the interval variable below is assigned, and the then
      // orphaned timer keeps a resolved prompt, and the process, alive.
      timer = setInterval(draw, 250);
      draw();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
