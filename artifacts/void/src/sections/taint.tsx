import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon, Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { taintAgents, taintNodes, toneName, type TaintNode } from "@/lib/site-data";
import { EASE } from "@/lib/motion";

const COL = 232;
const ROW = 104;
const PAD_X = 96;
const PAD_Y = 46;

const x = (node: TaintNode) => PAD_X + node.col * COL;
const y = (node: TaintNode) => PAD_Y + node.row * ROW;

const WIDTH = PAD_X * 2 + 4 * COL;
const HEIGHT = PAD_Y * 2 + 2 * ROW;

/** Everything that transitively consumed this node's result. */
function downstreamOf(id: string): Set<string> {
  const out = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of taintNodes) {
      if (out.has(node.id)) continue;
      if (node.reads.some((parent) => parent === id || out.has(parent))) {
        out.add(node.id);
        changed = true;
      }
    }
  }
  return out;
}

export function Taint() {
  const [selected, setSelected] = useState<string>("t2");
  const reduced = useReducedMotion();

  const tainted = useMemo(() => downstreamOf(selected), [selected]);
  const node = taintNodes.find((item) => item.id === selected) ?? taintNodes[0];

  const blocked = useMemo(
    () => taintNodes.filter((item) => tainted.has(item.id) && item.tone === "r3"),
    [tainted],
  );

  const edges = useMemo(
    () =>
      taintNodes.flatMap((child) =>
        child.reads.map((parentId) => {
          const parent = taintNodes.find((item) => item.id === parentId);
          return parent ? { from: parent, to: child, key: `${parentId}-${child.id}` } : null;
        }),
      ).filter((edge): edge is { from: TaintNode; to: TaintNode; key: string } => edge !== null),
    [],
  );

  return (
    <Section id="taint" index="07" label="TAINT GRAPH">
      <SplitHeading text="Undo one action, find the other five." className="h2" />
      <p className="lede mt-sm">
        By the time you want a write back, three agents have read it. A rollback that only touches the record it
        changed is not a rollback, it is a divergence. Pick any action below and VOID shows you the true scope of
        compensating it.
      </p>

      <div className="taint-legend mt-lg">
        {taintAgents.map((agent, index) => (
          <span className="taint-legend-item" key={agent} data-agent={index}>
            <i /> {agent}
          </span>
        ))}
        <span className="taint-hint">
          <Icon name="arrow" size={12} /> select a node
        </span>
      </div>

      <Reveal className="taint-frame">
        <div className="taint-scroll">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="taint-svg" role="img" aria-label="Causal graph of actions across three agents">
            <g className="taint-edges">
              {edges.map((edge) => {
                const isHot = edge.from.id === selected || (tainted.has(edge.from.id) && tainted.has(edge.to.id));
                const x1 = x(edge.from) + 78;
                const y1 = y(edge.from) + 22;
                const x2 = x(edge.to) - 78;
                const y2 = y(edge.to) + 22;
                const mid = (x1 + x2) / 2;
                return (
                  <path
                    key={edge.key}
                    d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                    className={`taint-edge ${isHot ? "is-hot" : ""}`}
                  />
                );
              })}
            </g>

            <g>
              {taintNodes.map((item) => {
                const isSelected = item.id === selected;
                const isTainted = tainted.has(item.id);
                const agentIndex = taintAgents.indexOf(item.agent as (typeof taintAgents)[number]);

                return (
                  // The layout translate has to stay a plain attribute on a plain
                  // <g>. Motion drives transforms through the CSS property, and a
                  // CSS transform on an SVG element overrides the transform
                  // attribute, so letting motion own this node collapses all eight
                  // of them onto the origin. The lift animates on an inner group,
                  // which has no attribute of its own to lose.
                  <g
                    key={item.id}
                    className={`taint-node ${isSelected ? "is-selected" : ""} ${isTainted ? "is-tainted" : ""}`}
                    data-tone={item.tone}
                    data-agent={agentIndex}
                    transform={`translate(${x(item) - 78} ${y(item)})`}
                    onClick={() => setSelected(item.id)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(item.id);
                      }
                    }}
                  >
                    <motion.g
                      animate={reduced ? undefined : { y: isSelected ? -3 : 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                    >
                      <rect width="156" height="44" rx="0" />
                      <text x="10" y="18" className="taint-node-label">
                        {item.label.length > 22 ? `${item.label.slice(0, 21)}...` : item.label}
                      </text>
                      <text x="10" y="33" className="taint-node-meta">
                        {item.at} / {item.tone.toUpperCase()}
                      </text>
                      <rect className="taint-node-edge" width="3" height="44" />
                    </motion.g>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </Reveal>

      <div className="taint-readout">
        <div className="taint-selected">
          <span className="kicker">compensating</span>
          <code>{node.label}</code>
          <span className={`tag tag-${node.tone}`}>
            {node.tone.toUpperCase()} {toneName[node.tone]}
          </span>
          <p>{node.detail}</p>
        </div>

        <div className="taint-scope" data-blocked={blocked.length > 0}>
          <span className="kicker">true scope</span>
          <strong>
            {tainted.size} downstream {tainted.size === 1 ? "action" : "actions"}
          </strong>
          {blocked.length > 0 ? (
            <>
              <p>
                {blocked.length} of them {blocked.length === 1 ? "is" : "are"} R3. The record can be restored, the
                consequences cannot.
              </p>
              <ul>
                {blocked.map((item) => (
                  <li key={item.id}>
                    <code>{item.label}</code>
                    <span>{item.agent}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              {tainted.size === 0
                ? "Nothing read this result, so the compensation is exactly one action."
                : "Every downstream action has an inverse, so the compensation runs clean in LIFO order."}
            </p>
          )}
        </div>
      </div>

      <Reveal className="taint-punchline">
        <p>
          <b>This is the case the incumbents do not cover.</b> Snapshot based rollback restores a resource. It has
          no idea that a different agent, in a different session, forty minutes later, read that resource and paid
          somebody. Reversibility is a property of the causal chain, not of the row.
        </p>
      </Reveal>
    </Section>
  );
}
