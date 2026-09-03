import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Reveal, Section, SplitHeading } from "@/components/site/primitives";

type Shape = {
  left: [string, string][];
  right: [string, string][];
  entry: string;
  exit: string;
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
    entry: "mcp transport terminated",
    exit: "forwarded on allow",
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
    entry: "tool object wrapped",
    exit: "invoked on allow",
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
    entry: "egress intercepted",
    exit: "released on allow",
    note: "A sidecar container in the same pod intercepts egress at the network level. Useful when the agent code cannot be changed at all, for example in a vendor runtime.",
  },
};

const STAGES: [string, string, string][] = [
  ["01", "PREFLIGHT", "class, blast radius, policy"],
  ["02", "INVERSE", "snapshot and compensation plan"],
  ["03", "LEDGER", "hash chained, signed, replayable"],
];

type Wire = { id: string; side: "in" | "out"; d: string };

/**
 * Layout offset relative to an ancestor, walking offsetParent rather than
 * reading getBoundingClientRect. Rects include CSS transforms, and the nodes
 * carry an entrance animation, so a rect based measurement would wire the
 * diagram to wherever the boxes happened to be mid transition.
 */
function offsetWithin(node: HTMLElement, ancestor: HTMLElement) {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = node;
  while (current && current !== ancestor) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return { x, y, w: node.offsetWidth, h: node.offsetHeight };
}

/** Orthogonal run with rounded corners, out to a bus at bx and back in. */
function orthPath(x1: number, y1: number, x2: number, y2: number, bx: number): string {
  const dy = y2 - y1;
  const radius = Math.min(12, Math.abs(dy) / 2, Math.abs(bx - x1), Math.abs(x2 - bx));

  if (radius < 1.5) return `M ${x1} ${y1} H ${x2}`;

  const dir = dy > 0 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `H ${bx - radius}`,
    `Q ${bx} ${y1} ${bx} ${y1 + dir * radius}`,
    `V ${y2 - dir * radius}`,
    `Q ${bx} ${y2} ${bx + radius} ${y2}`,
    `H ${x2}`,
  ].join(" ");
}

export function Topology() {
  const [mode, setMode] = useState("MCP proxy");
  const [hover, setHover] = useState<string | null>(null);
  const shape = shapes[mode];
  const reduced = useReducedMotion();

  const stageRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());

  const [wires, setWires] = useState<Wire[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [stacked, setStacked] = useState(false);

  const setNodeRef = useCallback((key: string) => (element: HTMLDivElement | null) => {
    if (element) nodeRefs.current.set(key, element);
    else nodeRefs.current.delete(key);
  }, []);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const core = coreRef.current;
    if (!stage || !core) return;

    const c = offsetWithin(core, stage);
    const next: Wire[] = [];

    // Columns sit beside the core on wide screens and above and below it when
    // the grid collapses. Comparing measured positions is what decides, so a
    // breakpoint never has to be kept in sync with the CSS.
    const first = nodeRefs.current.get(`${mode}-in-${shape.left[0][0]}`);
    const isStacked = first ? offsetWithin(first, stage).x + first.offsetWidth > c.x + 2 : false;
    setStacked(isStacked);
    setBox({ w: stage.offsetWidth, h: stage.offsetHeight });

    if (isStacked) {
      // One measured spine each way rather than a fan, because three curves in
      // a narrow column cross the boxes they are meant to connect.
      const lastIn = nodeRefs.current.get(`${mode}-in-${shape.left[shape.left.length - 1][0]}`);
      const firstOut = nodeRefs.current.get(`${mode}-out-${shape.right[0][0]}`);
      if (lastIn) {
        const n = offsetWithin(lastIn, stage);
        next.push({ id: "spine-in", side: "in", d: `M ${c.x + c.w / 2} ${n.y + n.h} V ${c.y}` });
      }
      if (firstOut) {
        const n = offsetWithin(firstOut, stage);
        next.push({ id: "spine-out", side: "out", d: `M ${c.x + c.w / 2} ${c.y + c.h} V ${n.y}` });
      }
      setWires(next);
      return;
    }

    const fan = (entries: [string, string][], side: "in" | "out") => {
      entries.forEach(([name], index) => {
        const element = nodeRefs.current.get(`${mode}-${side}-${name}`);
        if (!element) return;
        const n = offsetWithin(element, stage);
        // Spread the arrivals down the core edge instead of piling every wire
        // onto its midpoint.
        const coreY = c.y + (c.h * (index + 1)) / (entries.length + 1);
        const nodeY = n.y + n.h / 2;

        if (side === "in") {
          const x1 = n.x + n.w;
          const x2 = c.x;
          next.push({ id: name, side, d: orthPath(x1, nodeY, x2, coreY, x1 + (x2 - x1) / 2) });
        } else {
          const x1 = c.x + c.w;
          const x2 = n.x;
          next.push({ id: name, side, d: orthPath(x1, coreY, x2, nodeY, x1 + (x2 - x1) / 2) });
        }
      });
    };

    fan(shape.left, "in");
    fan(shape.right, "out");
    setWires(next);
  }, [mode, shape]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);
    for (const element of nodeRefs.current.values()) observer.observe(element);
    if (coreRef.current) observer.observe(coreRef.current);

    // Web fonts land after first paint and change every box height with them.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fonts?.ready.then(measure);

    return () => observer.disconnect();
  }, [measure]);

  const dim = (id: string) => hover !== null && hover !== id;

  return (
    <Section id="topology" index="08" label="TOPOLOGY">
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
        <div className="topo-stage" ref={stageRef}>
          <svg
            className="topo-wire"
            width={box.w}
            height={box.h}
            viewBox={`0 0 ${Math.max(box.w, 1)} ${Math.max(box.h, 1)}`}
            aria-hidden="true"
          >
            <defs>
              <marker id="topo-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0 0 L7 3.5 L0 7 z" className="topo-head" />
              </marker>
            </defs>
            {wires.map((wire) => (
              <g key={`${mode}-${wire.side}-${wire.id}`} className={`topo-run ${dim(wire.id) ? "is-dim" : ""}`}>
                <path className="topo-line" d={wire.d} markerEnd="url(#topo-head)" />
                {!reduced && <path className={`topo-flow ${hover === wire.id ? "is-hot" : ""}`} d={wire.d} />}
              </g>
            ))}
          </svg>

          <div className="topo-col left">
            <span className="kicker">Agents</span>
            {shape.left.map(([name, meta], index) => (
              <motion.div
                className="topo-node"
                key={`${mode}-${name}`}
                ref={setNodeRef(`${mode}-in-${name}`)}
                onMouseEnter={() => setHover(name)}
                onMouseLeave={() => setHover(null)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.24, delay: index * 0.04 }}
              >
                {name}
                <small>{meta}</small>
              </motion.div>
            ))}
            <span className="topo-edge-label">{shape.entry}</span>
          </div>

          <div className="topo-core" ref={coreRef} data-testid="node-void-core">
            <header>
              <b>VOID</b>
              <span>{mode}</span>
            </header>
            {STAGES.map(([index, name, detail]) => (
              <div className="topo-stage-row" key={name}>
                <i>{index}</i>
                <strong>{name}</strong>
                <span>{detail}</span>
              </div>
            ))}
          </div>

          <div className="topo-col right">
            <span className="kicker">Tool surfaces</span>
            {shape.right.map(([name, meta], index) => (
              <motion.div
                className="topo-node"
                key={`${mode}-${name}`}
                ref={setNodeRef(`${mode}-out-${name}`)}
                onMouseEnter={() => setHover(name)}
                onMouseLeave={() => setHover(null)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.24, delay: index * 0.04 }}
              >
                {name}
                <small>{meta}</small>
              </motion.div>
            ))}
            <span className="topo-edge-label">{shape.exit}</span>
          </div>
        </div>

        <p className="topo-note">{shape.note}</p>
        <div className="caption">
          <span>fig. 04, deployment topology</span>
          <span>{stacked ? "stacked" : "inline"}, {mode}</span>
        </div>
      </Reveal>
    </Section>
  );
}
