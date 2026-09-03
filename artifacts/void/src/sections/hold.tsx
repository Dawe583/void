import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon, Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { heldActions } from "@/lib/site-data";
import { useVisibleInterval } from "@/lib/use-site";
import { EASE } from "@/lib/motion";

/** The demo clock runs faster than a real hold so the whole queue fits on screen. */
const TICK_MS = 200;

type Status = "held" | "cancelled" | "committed";

type LogLine = { id: number; kind: "call" | "reply" | "warn" | "commit"; text: string };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const initialRemaining = () => Object.fromEntries(heldActions.map((action) => [action.id, action.seconds]));

/** Every action that consumed this one's provisional result, transitively. */
function dependentsOf(id: string): string[] {
  const out = new Set<string>();
  const walk = (current: string) => {
    const action = heldActions.find((item) => item.id === current);
    for (const child of action?.dependents ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      walk(child);
    }
  };
  walk(id);
  return [...out];
}

export function Hold() {
  const [remaining, setRemaining] = useState<Record<string, number>>(initialRemaining);
  const [status, setStatus] = useState<Record<string, Status>>(() =>
    Object.fromEntries(heldActions.map((action) => [action.id, "held" as Status])),
  );
  const [log, setLog] = useState<LogLine[]>(() =>
    heldActions.flatMap((action, index) => [
      { id: index * 2, kind: "call" as const, text: `> ${action.label}(...)` },
      { id: index * 2 + 1, kind: "reply" as const, text: `< { status: "provisional", commits_in: ${action.seconds} }` },
    ]),
  );
  const [running, setRunning] = useState(true);

  const anyHeld = useMemo(() => heldActions.some((action) => status[action.id] === "held"), [status]);

  const append = useCallback((lines: Omit<LogLine, "id">[]) => {
    setLog((current) => [...current, ...lines.map((line, index) => ({ ...line, id: current.length + index + 1000 }))].slice(-14));
  }, []);

  useVisibleInterval(
    () => {
      setRemaining((current) => {
        const next = { ...current };
        const committed: string[] = [];

        for (const action of heldActions) {
          if (status[action.id] !== "held") continue;
          const value = next[action.id];
          if (value <= 0) continue;
          next[action.id] = value - 1;
          if (next[action.id] === 0) committed.push(action.id);
        }

        if (committed.length > 0) {
          setStatus((currentStatus) => {
            const updated = { ...currentStatus };
            for (const id of committed) updated[id] = "committed";
            return updated;
          });
          append(
            committed.map((id) => ({
              kind: "commit" as const,
              text: `! ${heldActions.find((action) => action.id === id)?.label} committed, hold elapsed`,
            })),
          );
        }

        return next;
      });
    },
    TICK_MS,
    running && anyHeld,
  );

  const cancel = (id: string) => {
    const action = heldActions.find((item) => item.id === id);
    if (!action || status[id] !== "held") return;

    const cascade = dependentsOf(id).filter((child) => status[child] === "held");

    setStatus((current) => {
      const next = { ...current, [id]: "cancelled" as Status };
      for (const child of cascade) next[child] = "cancelled";
      return next;
    });

    append([
      { kind: "warn", text: `! hold cancelled: ${action.label}` },
      ...(cascade.length > 0
        ? [
            {
              kind: "warn" as const,
              text: `! ${cascade.length} dependent ${cascade.length === 1 ? "action" : "actions"} withdrawn, they consumed a result that no longer exists`,
            },
          ]
        : []),
    ]);
  };

  const reset = () => {
    setRemaining(initialRemaining());
    setStatus(Object.fromEntries(heldActions.map((action) => [action.id, "held" as Status])));
    setLog(
      heldActions.flatMap((action, index) => [
        { id: index * 2, kind: "call" as const, text: `> ${action.label}(...)` },
        { id: index * 2 + 1, kind: "reply" as const, text: `< { status: "provisional", commits_in: ${action.seconds} }` },
      ]),
    );
    setRunning(true);
  };

  const cancelledCount = heldActions.filter((action) => status[action.id] === "cancelled").length;

  return (
    <Section id="hold" index="05" label="HOLD QUEUE">
      <SplitHeading text="Allow, deny, and the state nobody ships." className="h2" />
      <p className="lede mt-sm">
        A gateway gives you two answers and both are wrong for the interesting calls. Deny blocks work the agent
        was right to want. Allow is a bet you cannot take back. A hold is the third answer: the call goes into a
        countdown, the agent gets a provisional receipt and carries on, and a human has until the timer runs out.
      </p>

      <div className="hold-grid mt-lg">
        <Reveal className="hold-queue">
          <div className="hold-head">
            <span className="kicker">queue, {TICK_MS}ms per second for the demo</span>
            <div className="hold-head-actions">
              <button type="button" className="hold-mini" onClick={() => setRunning(!running)} data-testid="button-hold-play">
                <Icon name={running ? "pause" : "play"} size={12} />
                {running ? "pause" : "run"}
              </button>
              <button type="button" className="hold-mini" onClick={reset} data-testid="button-hold-reset">
                <Icon name="undo" size={12} />
                reset
              </button>
            </div>
          </div>

          {heldActions.map((action) => {
            const state = status[action.id];
            const left = remaining[action.id];
            const pct = Math.max(0, Math.min(100, (left / action.seconds) * 100));

            return (
              <div className="hold-row" key={action.id} data-state={state} data-tone={action.tone}>
                <div className="hold-row-top">
                  <span className="hold-clock">
                    {state === "held" ? clock(left) : state === "cancelled" ? "--:--" : "0:00"}
                  </span>
                  <code className="hold-label">{action.label}</code>
                  <span className={`tag tag-${action.tone}`}>{action.tone.toUpperCase()}</span>
                  <button
                    type="button"
                    className="hold-cancel"
                    onClick={() => cancel(action.id)}
                    disabled={state !== "held"}
                    data-testid={`button-hold-cancel-${action.id}`}
                  >
                    {state === "held" ? "cancel" : state}
                  </button>
                </div>

                <div className="hold-bar" aria-hidden="true">
                  <span style={{ width: `${state === "held" ? pct : 0}%` }} />
                </div>

                <p className="hold-detail">{action.detail}</p>

                {action.dependents.length > 0 && (
                  <p className="hold-deps">
                    <Icon name="git" size={12} />
                    {action.dependents.length} downstream {action.dependents.length === 1 ? "action" : "actions"} built
                    on this result
                  </p>
                )}
              </div>
            );
          })}
        </Reveal>

        <div className="hold-side">
          <Reveal className="terminal hold-term">
            <div className="terminal-bar">
              <span className="terminal-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>agent transcript</span>
              <span className="terminal-title">provisional receipts</span>
            </div>
            <div className="terminal-body">
              <AnimatePresence initial={false}>
                {log.map((line) => (
                  <motion.p
                    key={line.id}
                    className={`hold-log is-${line.kind}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                  >
                    {line.text}
                  </motion.p>
                ))}
              </AnimatePresence>
            </div>
          </Reveal>

          <Reveal className="hold-note">
            <h5>Why this is harder than a delay</h5>
            <p>
              The agent did not wait. It took the provisional refund id and wrote three more calls against it. So
              cancelling the refund cannot just drop one row, it has to withdraw everything that consumed a result
              which now never existed. That is a dependency graph, not a queue.
            </p>
            {cancelledCount > 0 && (
              <p className="hold-note-live">
                {cancelledCount} of {heldActions.length} withdrawn in this run.
              </p>
            )}
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
