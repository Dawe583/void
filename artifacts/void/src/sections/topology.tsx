import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { EASE } from "@/lib/motion";

type Shape = {
  left: [string, string][];
  right: [string, string][];
  note: string;
};

const shapes: Record<string, Shape> = {
  "MCP proxy": {
    left: [
      ["Claude Agent SDK", "mcp"],
      ["OpenAI Agents SDK", "mcp"],
      ["Custom loop", "mcp"],
    ],
    right: [
      ["Stripe MCP", "write"],
      ["HubSpot MCP", "write"],
      ["Gmail MCP", "write"],
    ],
    note: "VOID terminates the MCP transport, classifies each advertised tool on connect, and forwards the call only after policy allows it. No framework support needed.",
  },
  "SDK wrap": {
    left: [
      ["LangGraph", "wrap"],
      ["CrewAI", "wrap"],
      ["Function calling", "wrap"],
    ],
    right: [
      ["HTTP tools", "write"],
      ["Postgres", "write"],
      ["Internal RPC", "write"],
    ],
    note: "void_.wrap() returns the same tool objects your agent already uses, with preflight, snapshot capture and ledger writes attached to each invocation.",
  },
  Sidecar: {
    left: [
      ["Agent runtime pod", "grpc"],
      ["Batch workers", "grpc"],
      ["Scheduled jobs", "grpc"],
    ],
    right: [
      ["Kubernetes API", "write"],
      ["S3", "write"],
      ["Data warehouse", "write"],
    ],
    note: "A sidecar container in the same pod intercepts egress at the network level. Useful when the agent code cannot be changed at all, for example in a vendor runtime.",
  },
};

export function Topology() {
  const [mode, setMode] = useState("MCP proxy");
  const shape = shapes[mode];

  return (
    <Section id="topology" index="05" label="TOPOLOGY">
      <SplitHeading text="One layer, in the write path." className="h2" />
      <p className="lede mt-sm">
        The same event model in three deployment shapes. Pick the one that matches how much of the agent runtime
        you control.
      </p>

      <div className="row mt-md" role="group" aria-label="Deployment shape">
        {Object.keys(shapes).map((key) => (
          <button
            key={key}
            type="button"
            className={`chip ${mode === key ? "is-on" : ""}`}
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
            data-testid={`button-mode-${key.replace(/\s+/g, "-").toLowerCase()}`}
          >
            {key}
          </button>
        ))}
      </div>

      <Reveal className="topology mt-md">
        <div className="topo-stage">
          <svg className="topo-wire" viewBox="0 0 1000 320" preserveAspectRatio="none" aria-hidden="true">
            <path d="M300 60 C 400 60, 400 160, 470 160" />
            <path d="M300 160 C 400 160, 400 160, 470 160" />
            <path d="M300 260 C 400 260, 400 160, 470 160" />
            <path d="M530 160 C 600 160, 600 60, 700 60" />
            <path d="M530 160 C 600 160, 600 160, 700 160" />
            <path d="M530 160 C 600 160, 600 260, 700 260" />
            <path className="flow" d="M300 60 C 400 60, 400 160, 470 160" />
            <path className="flow" d="M300 160 C 400 160, 400 160, 470 160" />
            <path className="flow" d="M300 260 C 400 260, 400 160, 470 160" />
            <path className="flow" d="M530 160 C 600 160, 600 60, 700 60" />
            <path className="flow" d="M530 160 C 600 160, 600 160, 700 160" />
            <path className="flow" d="M530 160 C 600 160, 600 260, 700 260" />
          </svg>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="topo-col left"
              key={`${mode}-left`}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 14 }}
              transition={{ duration: 0.26, ease: EASE }}
              style={{ position: "relative", zIndex: 1 }}
            >
              <span className="kicker">Agents</span>
              {shape.left.map(([name, meta]) => (
                <motion.div layout className="topo-node" key={name}>
                  {name}
                  <small>{meta}</small>
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>

          <div className="topo-beam" aria-hidden="true">
            <i />
          </div>

          <motion.div
            className="topo-core"
            layout
            style={{ position: "relative", zIndex: 1 }}
            data-testid="node-void-core"
          >
            <b>VOID</b>
            <span>preflight / inverse / ledger</span>
            <span className="mono" style={{ fontSize: 10 }}>
              {mode}
            </span>
          </motion.div>

          <div className="topo-beam" aria-hidden="true">
            <i style={{ animationDelay: "0.7s" }} />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="topo-col right"
              key={`${mode}-right`}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.26, ease: EASE }}
              style={{ position: "relative", zIndex: 1 }}
            >
              <span className="kicker">Tool surfaces</span>
              {shape.right.map(([name, meta]) => (
                <motion.div layout className="topo-node" key={name}>
                  {name}
                  <small>{meta}</small>
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="topo-note"
            key={mode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {shape.note}
          </motion.div>
        </AnimatePresence>
        <div className="caption">
          <span>fig. 04, deployment topology</span>
          <span>{mode}</span>
        </div>
      </Reveal>
    </Section>
  );
}
