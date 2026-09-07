import { detectCapabilities, type CapabilityStream } from "./caps.ts";
import type { RawInput } from "./modal.ts";
import type { DashboardState, TerminalCapabilities } from "./types.ts";
import { DiffScreenWriter, renderWatchFrame } from "./watch.ts";

export interface WatchRuntimeOptions {
  readonly state: () => DashboardState;
  readonly input?: RawInput;
  readonly output?: NodeJS.WriteStream;
  readonly capabilities?: () => TerminalCapabilities;
  readonly onKey?: (key: string) => void;
  readonly refreshMs?: number;
}

export class WatchRuntime {
  private readonly state: () => DashboardState;
  private readonly input: RawInput;
  private readonly output: NodeJS.WriteStream;
  private readonly capabilities: () => TerminalCapabilities;
  private readonly onKey: (key: string) => void;
  private readonly refreshMs: number;
  private readonly writer: DiffScreenWriter;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(options: WatchRuntimeOptions) {
    this.state = options.state;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.capabilities =
      options.capabilities ??
      (() => detectCapabilities(process.env, this.output as CapabilityStream));
    this.onKey = options.onKey ?? (() => undefined);
    this.refreshMs = options.refreshMs ?? 250;
    this.writer = new DiffScreenWriter(this.output);
  }

  start(): void {
    if (this.running) return;
    const capabilities = this.capabilities();
    if (!capabilities.interactive || this.input.setRawMode === undefined) {
      throw new Error(
        `void watch requires an interactive terminal, got ${capabilities.reason}`,
      );
    }
    // Raw mode first, running flag last: setRawMode can throw on a TTY that
    // detached, and a runtime left with running true but no timer, no
    // handlers and no screen silently ignores every later start() call.
    this.input.setRawMode(true);
    this.input.resume();
    this.input.on("data", this.handleData);
    this.running = true;
    process.on("SIGWINCH", this.refresh);
    process.once("SIGINT", this.handleSigint);
    process.once("SIGTERM", this.handleSigterm);
    process.once("SIGHUP", this.handleSighup);
    process.once("exit", this.stop);
    this.writer.enter();
    this.refresh();
    this.timer = setInterval(this.refresh, this.refreshMs);
  }

  readonly refresh = (): void => {
    if (!this.running) return;
    const capabilities = this.capabilities();
    this.writer.write(renderWatchFrame(this.state(), capabilities));
  };

  readonly stop = (): void => {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.input.off("data", this.handleData);
    this.input.setRawMode?.(false);
    this.input.pause();
    process.off("SIGWINCH", this.refresh);
    process.off("SIGINT", this.handleSigint);
    process.off("SIGTERM", this.handleSigterm);
    process.off("SIGHUP", this.handleSighup);
    process.off("exit", this.stop);
    this.writer.leave();
  };

  private readonly handleData = (chunk: Buffer): void => {
    const key = chunk.toString("utf8");
    if (key === "q" || key === "\u0003") {
      this.stop();
      return;
    }
    this.onKey(key);
    this.refresh();
  };

  private readonly terminate = (signal: NodeJS.Signals): void => {
    this.stop();
    process.kill(process.pid, signal);
  };

  private readonly handleSigint = (): void => this.terminate("SIGINT");
  private readonly handleSigterm = (): void => this.terminate("SIGTERM");
  private readonly handleSighup = (): void => this.terminate("SIGHUP");
}
