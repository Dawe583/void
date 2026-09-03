import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon, Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { actions, systems, toneName, toneVar, type Tone } from "@/lib/site-data";
import { EASE } from "@/lib/motion";
import { useVisibleInterval } from "@/lib/use-site";

const LAST = actions.length - 1;
const SCRAMBLE = "!<>-_\\/[]{}=+*^?#";

/** Flips a value through noise when it changes, then settles on the new text. */
function ScrambleValue({ value }: { value: string }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (value === previous.current) return;
    previous.current = value;
    if (reduced) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const total = 8;
    const id = window.setInterval(() => {
      frame += 1;
      if (frame >= total) {
        window.clearInterval(id);
        setDisplay(value);
        return;
      }
      setDisplay(
        value
          .split("")
          .map((char) => (char === " " || Math.random() > 0.55 ? char : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]))
          .join(""),
      );
    }, 34);
    return () => window.clearInterval(id);
  }, [value, reduced]);

  return <span>{display}</span>;
}

function StaticTable() {
  return (
    <div className="table-wrap" data-testid="replay-static">
      <table className="data">
        <thead>
          <tr>
            <th>time</th>
            <th>action</th>
            <th>system</th>
            <th>class</th>
            <th>before</th>
            <th>after</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <tr key={action.time}>
              <td>{action.time}</td>
              <td>{action.label}</td>
              <td>{action.system}</td>
              <td>
                <span className={`tag tag-${action.tone}`}>{action.tone.toUpperCase()}</span>
              </td>
              <td>{action.before}</td>
              <td>{action.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Replay() {
  const reduced = useReducedMotion();
  const [position, setPosition] = useState(LAST);
  const [playing, setPlaying] = useState(false);

  useVisibleInterval(
    () =>
      setPosition((value) => {
        if (value <= 0) {
          setPlaying(false);
          return 0;
        }
        return value - 1;
      }),
    520,
    playing && !reduced,
  );

  const current = actions[position];

  /** Every action after the scrub point is being reversed, LIFO. */
  const tally = useMemo(() => {
    const pending = actions.slice(position + 1);
    return {
      reversed: pending.filter((action) => action.tone === "r0" || action.tone === "r1").length,
      mitigated: pending.filter((action) => action.tone === "r2").length,
      irreversible: pending.filter((action) => action.tone === "r3").length,
      terminal: pending.filter((action) => action.tone === "r3"),
    };
  }, [position]);

  /** Latest known value per system field at the scrub point. */
  const panels = useMemo(
    () =>
      systems.map((system) => {
        const rows = actions
          .filter((action) => action.system === system)
          .map((action) => {
            const index = actions.indexOf(action);
            const committed = index <= position;
            return {
              field: action.field,
              value: committed ? action.after : action.before,
              committed,
              tone: action.tone,
              index,
            };
          });
        const seen = new Map<string, (typeof rows)[number]>();
        rows.forEach((row) => seen.set(row.field, row));
        return { system, rows: Array.from(seen.values()).slice(0, 4) };
      }),
    [position],
  );

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Home") {
      event.preventDefault();
      setPosition(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      setPosition(LAST);
    }
  };

  return (
    <Section id="replay" index="04" label="REPLAY">
      <SplitHeading text="Drag the past back." className="h2" />
      <p className="lede mt-sm">
        Pick a moment. VOID replays compensations in LIFO order across every connected system and shows you, live,
        what came back and what did not. This is the reason the product exists.
      </p>

      {reduced ? (
        <>
          <p className="mono mt-md">reduced motion, showing the full before and after table instead of the scrubber</p>
          <StaticTable />
        </>
      ) : (
        <Reveal className="mt-lg">
          <div className="replay" data-testid="replay-demo">
            <div className="replay-head">
              <span className="kicker">Live ledger / {actions.length} actions</span>
              <span className="mono">
                window 09:02 to 09:42 / scrubbed to {current.time} / head 0x9f3c..a10e
              </span>
            </div>

            <div className="replay-body">
              <div className="replay-controls">
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    if (position === 0) setPosition(LAST);
                    setPlaying((value) => !value);
                  }}
                  data-testid="button-replay-play"
                  aria-label={playing ? "Pause the replay" : "Play the replay"}
                >
                  <Icon name={playing ? "pause" : "play"} size={12} />
                  {playing ? "pause replay" : "play replay"}
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    setPlaying(false);
                    setPosition(LAST);
                  }}
                  data-testid="button-replay-reset"
                >
                  reset to now
                </button>
                <span className="mono">arrows step, Home and End jump</span>
              </div>

              <div className="timeline">
                <div className="timeline-track">
                  <div className="timeline-rail" />
                  <motion.div
                    className="timeline-fill"
                    animate={{ width: `${(position / LAST) * 100}%` }}
                    transition={{ type: "spring", stiffness: 180, damping: 24 }}
                  />
                  <div className="timeline-nodes">
                    {actions.map((action, index) => (
                      <button
                        key={action.time}
                        type="button"
                        className={`tl-node ${index <= position ? "is-past" : ""} ${index === position ? "is-here" : ""}`}
                        onClick={() => {
                          setPlaying(false);
                          setPosition(index);
                        }}
                        aria-label={`Jump to ${action.time}, ${action.label}, class ${action.tone.toUpperCase()}`}
                        data-testid={`button-timeline-${index}`}
                        data-tone={action.tone}
                      >
                        <i />
                        <b>{action.time}</b>
                        <em>{action.tone.toUpperCase()}</em>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="sr-only" htmlFor="replay-range">
                Replay timeline position
              </label>
              <input
                id="replay-range"
                className="range"
                type="range"
                min={0}
                max={LAST}
                value={position}
                onChange={(event) => {
                  setPlaying(false);
                  setPosition(Number(event.target.value));
                }}
                onKeyDown={onKey}
                style={{ ["--fill" as string]: `${(position / LAST) * 100}%` }}
                data-testid="input-replay-scrubber"
              />

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  className="replay-focus"
                  key={current.label}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  <div className="row" style={{ gap: 10 }}>
                    <span className={`tag tag-${current.tone}`}>
                      {current.tone.toUpperCase()} {toneName[current.tone]}
                    </span>
                    <span className="mono">{current.system}</span>
                    <span className="mono">{current.time}</span>
                  </div>
                  <strong>{current.label}</strong>
                  <p>{current.note}</p>
                </motion.div>
              </AnimatePresence>

              <div className="replay-panels">
                {panels.map((panel) => (
                  <div className="sys-panel" key={panel.system}>
                    <h4>
                      {panel.system}
                      <span className="mono" style={{ fontSize: 10 }}>
                        {panel.rows.filter((row) => !row.committed).length} reverted
                      </span>
                    </h4>
                    {panel.rows.map((row) => (
                      <div className={`sys-row ${!row.committed ? "is-reverting" : ""}`} key={row.field}>
                        <span>{row.field.split(".").slice(-2).join(".")}</span>
                        <span>
                          <ScrambleValue value={row.value} />
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="replay-meters">
                <div className="meter m-ok">
                  <strong>{tally.reversed}</strong>
                  <span>reversed</span>
                </div>
                <div className="meter m-warn">
                  <strong>{tally.mitigated}</strong>
                  <span>mitigated</span>
                </div>
                <div className="meter m-bad">
                  <strong>{tally.irreversible}</strong>
                  <span>irreversible</span>
                </div>
                <div className="meter">
                  <strong>{position + 1}</strong>
                  <span>actions in scope</span>
                </div>
              </div>

              <AnimatePresence>
                {tally.terminal.length > 0 && (
                  <motion.div
                    className="replay-alert"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.24, ease: EASE }}
                    data-testid="status-replay-terminal"
                  >
                    <Icon name="alert" size={14} />
                    <span>
                      cannot be reversed, R3, logged and budgeted:{" "}
                      {tally.terminal.map((action) => `${action.time} ${action.label}`).join(", ")}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="caption">
              <span>fig. 03, compensation replay across CRM, MAIL and LEDGER</span>
              <span>illustrative data</span>
            </div>
          </div>
        </Reveal>
      )}
    </Section>
  );
}

export const replayTones: Tone[] = ["r0", "r1", "r2", "r3"];
