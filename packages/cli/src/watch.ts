import { loadPending, writeDecision } from "../../policy/src/approvals.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { readLedgerFeed } from "../../ledger/src/feed.ts";
import { devKeyProvider } from "../../ledger/src/sign.ts";
import { detectCapabilities } from "./tui/caps.ts";
import { DiffScreenWriter } from "./tui/watch.ts";
import { liveRecords, renderLiveFeed, type LiveView } from "./tui/live.ts";

export async function runWatchCommand(argv: readonly string[]): Promise<number> {
  let workspace = process.env.VOID_WORKSPACE ?? "default";
  let ledger: string | undefined;
  let once = false;
  let approvalDir = process.env.VOID_APPROVALS_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--once") once = true;
    else if (arg === "--ledger" || arg === "--workspace" || arg === "--approvals-dir") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--ledger") ledger = value;
      else if (arg === "--approvals-dir") approvalDir = value;
      else workspace = value;
    } else throw new Error(`unknown watch option: ${arg}`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(workspace)) throw new Error("invalid workspace");
  ledger ??= join(process.env.VOID_LEDGER_DIR ?? join(homedir(), ".void", "ledger"), `${workspace}.jsonl`);
  approvalDir ??= join(homedir(), ".void", "approvals", workspace);
  let view: LiveView = { workspace, selected: 0, filter: "", paused: false, detail: false, help: false };
  const caps = () => detectCapabilities(process.env, process.stdout);
  let reading = false;
  let stopped = false;
  let writer: DiffScreenWriter | undefined;
  const draw = () => { if (!stopped) writer?.write(renderLiveFeed(view, caps())); };
  const refresh = async () => {
    if (reading || stopped) return;
    reading = true;
    try {
      const signer = await devKeyProvider();
      const page = await readLedgerFeed(ledger, { publicKey: id => signer.publicKey(id) });
      if (stopped) return;
      const selectedSeq = liveRecords(view)[view.selected]?.seq;
      view = { ...view, page, error: undefined };
      const index = liveRecords(view).findIndex(row => row.seq === selectedSeq);
      view = { ...view, selected: Math.max(0, index) };
    } catch {
      if (!stopped) view = { ...view, page: undefined, error: "Ledger unavailable or verification failed" };
    } finally {
      try {
        const approvals = loadPending(approvalDir).filter(record => record.expiresAt > Date.now() && record.call.workspace === workspace);
        if (!stopped) {
          const selectedId = view.approvals?.[view.approvalSelected ?? 0]?.holdId;
          const index = approvals.findIndex(record => record.holdId === selectedId);
          view = { ...view, approvals, approvalSelected: Math.max(0, index), confirmDecision: index < 0 ? undefined : view.confirmDecision };
        }
      } catch (error) {
        if (!stopped) view = { ...view, approvals: [], confirmDecision: undefined, ...((error as NodeJS.ErrnoException).code === "ENOENT" ? {} : { notice: "Approval state unavailable or invalid" }) };
      }
      reading = false; draw();
    }
  };
  await refresh();
  if (once || !caps().interactive || !caps().ansi || !process.stdin.isTTY) {
    process.stdout.write(`${renderLiveFeed(view, { ...caps(), ansi: false, colorDepth: 0 })}\n`);
    return view.error ? 1 : 0;
  }
  const screen = new DiffScreenWriter(process.stdout);
  writer = screen;
  const wasRaw = process.stdin.isRaw;
  const wasPaused = process.stdin.isPaused();
  return new Promise<number>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      if (wasPaused) process.stdin.pause();
      process.off("SIGWINCH", draw);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      process.off("SIGHUP", stop);
      process.off("exit", stop);
      process.off("uncaughtExceptionMonitor", stop);
      screen.leave();
      resolve(0);
    };
    const onData = (chunk: Buffer) => {
      const key = chunk.toString("utf8");
      if (key === "q" || key === "\u0003") return stop();
      if (key === "h") { view = { ...view, approvalView: !view.approvalView, confirmDecision: undefined }; void refresh(); draw(); return; }
      if (view.approvalView) {
        if (key === "j" || key === "\u001b[B") view = { ...view, approvalSelected: Math.min((view.approvalSelected ?? 0) + 1, Math.max(0, (view.approvals?.length ?? 0) - 1)), confirmDecision: undefined };
        if (key === "k" || key === "\u001b[A") view = { ...view, approvalSelected: Math.max(0, (view.approvalSelected ?? 0) - 1), confirmDecision: undefined };
        if (key === "a" || key === "d") view = { ...view, confirmDecision: key === "a" ? "approved" : "denied" };
        if (key === "\u001b") view = { ...view, confirmDecision: undefined };
        if (key === "y" && view.confirmDecision) {
          const record = view.approvals?.[view.approvalSelected ?? 0];
          try {
            if (!record) throw new Error("No selected hold");
            writeDecision(approvalDir, record.holdId, { kind: view.confirmDecision, by: "tui" });
            view = { ...view, confirmDecision: undefined, notice: "Decision queued. Proxy resolution is not yet confirmed." };
          } catch { view = { ...view, confirmDecision: undefined, notice: "Cannot queue decision. Refresh the hold and retry." }; }
          void refresh();
        }
        draw(); return;
      }
      if (key === "j" || key === "\u001b[B") view = { ...view, selected: Math.min(view.selected + 1, Math.max(0, liveRecords(view).length - 1)) };
      if (key === "k" || key === "\u001b[A") view = { ...view, selected: Math.max(0, view.selected - 1) };
      if (key === "\r") view = { ...view, detail: !view.detail };
      if (key === "\u001b") view = { ...view, detail: false, help: false };
      if (key === "?") view = { ...view, help: !view.help };
      if (key === "p") view = { ...view, paused: !view.paused };
      if (key === "f") {
        const filters = ["", "r0", "r1", "r2", "r3"];
        view = { ...view, filter: filters[(filters.indexOf(view.filter) + 1) % filters.length]!, selected: 0 };
      }
      if (key === "v") void refresh();
      draw();
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
    process.on("SIGWINCH", draw);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.once("SIGHUP", stop);
    process.once("exit", stop);
    process.once("uncaughtExceptionMonitor", stop);
    screen.enter();
    draw();
    timer = setInterval(() => { if (!view.paused || view.approvalView) void refresh(); }, 1000);
  });
}
