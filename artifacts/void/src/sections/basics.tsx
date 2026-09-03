import { motion } from "motion/react";
import { Link } from "wouter";
import { Counter, Icon, Reveal, RevealGroup, RevealItem, Section, SplitHeading, Spotlight } from "@/components/site/primitives";
import { integrations, mechanisms, quotes, exploreItems } from "@/lib/site-data";

/* -------------------------------------------------------------------------- */
/* Integration marquee                                                        */
/* -------------------------------------------------------------------------- */

export function Marquee() {
  const doubled = [...integrations, ...integrations];
  return (
    <section aria-label="Integration targets">
      <div style={{ padding: "26px var(--gut) 4px" }}>
        <span className="kicker">Speaks to the systems your agents already touch</span>
      </div>
      <div className="marquee-wrap">
        <div className="marquee">
          {doubled.map((name, index) => (
            <span className="marquee-item" key={`${name}-${index}`}>
              <i aria-hidden="true" />
              {name}
            </span>
          ))}
        </div>
      </div>
      <div style={{ padding: "12px var(--gut) 22px", borderBottom: "1px solid var(--line)" }}>
        <span className="mono">integration targets, not endorsements</span>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The gap                                                                    */
/* -------------------------------------------------------------------------- */

const gapCells = [
  {
    kicker: "01 / OBSERVABILITY",
    title: "Sees it after",
    body: "Tracing tells you what the agent did once the side effect is already in the world. Perfect for debugging behaviour, useless for recovery.",
  },
  {
    kicker: "02 / GUARDRAILS",
    title: "Blocks the prompt, not the write",
    body: "Filters catch words and inputs before the model speaks. They do not restore a changed record or pull back a payment.",
  },
  {
    kicker: "03 / APPROVALS",
    title: "A human clicks yes",
    body: "Approval moves the moment of responsibility one step earlier. The human still owns the mess when the call turns out to be wrong.",
  },
];

const gapStats: [number, string, string, string, number][] = [
  [73.4, "%", "writes with a prepared inverse", "▂▃▅▆▅▇", 1],
  [40, "ms", "worst case preflight latency", "▇▅▄▃▄▂", 0],
  [14, "", "systems in one write path", "▂▄▃▆▇█", 0],
  [2, "/day", "irreversible actions budgeted", "▆▅▃▃▂▁", 0],
];

export function Gap() {
  return (
    <Section id="gap" index="01" label="THE GAP">
      <SplitHeading text="Your stack can watch, filter and ask. It cannot undo." className="h2" />
      <p className="lede mt-sm">
        Agents no longer only answer. They write to CRMs, issue refunds, send email, delete files and change
        infrastructure. The safety stack you already run has no step that puts any of it back.
      </p>

      <RevealGroup className="gap-grid mt-lg">
        {gapCells.map((cell) => (
          <RevealItem key={cell.kicker}>
            <Spotlight className="gap-cell">
              <span className="kicker">{cell.kicker}</span>
              <span className="cross" aria-hidden="true">
                &times;
              </span>
              <h3 className="h3">{cell.title}</h3>
              <p>{cell.body}</p>
            </Spotlight>
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal className="gap-answer" delay={0.1}>
        <strong>VOID reverses the write.</strong>
        <span>preflight &rarr; compensate &rarr; replay</span>
      </Reveal>

      <RevealGroup className="stat-grid">
        {gapStats.map(([value, suffix, label, spark, decimals]) => (
          <RevealItem className="stat" key={label}>
            <strong>
              <Counter to={value} decimals={decimals} suffix={suffix} />
            </strong>
            <span>{label}</span>
            <div className="spark" aria-hidden="true">
              {spark}
            </div>
            <small>illustrative</small>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Six mechanisms                                                             */
/* -------------------------------------------------------------------------- */

export function Mechanisms() {
  return (
    <Section id="mechanisms" index="02" label="MECHANISMS">
      <SplitHeading text="Six moving parts, one guarantee." className="h2" />
      <p className="lede mt-sm">
        Each one is useful alone. Together they turn an agent side effect into a transaction you can classify,
        hold, reverse and prove.
      </p>

      <RevealGroup className="mech-grid mt-lg" stagger={0.06}>
        {mechanisms.map((item, index) => (
          <RevealItem className="mech" key={item.id}>
            <span className="mech-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <pre className="mech-art" aria-hidden="true">{item.art}</pre>
            <h3 className="h3">{item.name}</h3>
            <p>{item.body}</p>
            <span className="mech-meta">{item.meta}</span>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Field notes                                                                */
/* -------------------------------------------------------------------------- */

export function FieldNotes() {
  return (
    <Section id="field-notes" index="10" label="FIELD NOTES">
      <SplitHeading text="What design partners actually say." className="h2" />
      <p className="lede mt-sm">
        VOID is a product concept. The quotes below are illustrative and describe the kind of pilot the product
        is designed for.
      </p>

      <RevealGroup className="grid-3 mt-lg">
        {quotes.map((quote) => (
          <RevealItem key={quote.who} style={{ height: "100%" }}>
            <Spotlight className="quote-card">
              <p>{quote.text}</p>
              <footer>
                <b>{quote.who}</b>
                <span>{quote.ctx}</span>
                <span className="tag mt-sm" style={{ width: "max-content" }}>
                  illustrative, design partner pilot
                </span>
              </footer>
            </Spotlight>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Explore grid                                                               */
/* -------------------------------------------------------------------------- */

export function Explore() {
  return (
    <Section id="explore" index="14" label="EXPLORE">
      <SplitHeading text="Everything else, in one grid." className="h2" />
      <RevealGroup className="explore-grid mt-md" stagger={0.04}>
        {exploreItems.map((item) => (
          <motion.div key={item.href} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
            <Link
              href={item.href}
              className="explore-card"
              data-testid={`link-explore-${item.label.toLowerCase()}`}
            >
              <em>{item.tag}</em>
              <strong>
                {item.label}
                <span className="arrow" aria-hidden="true">
                  <Icon name="arrowUpRight" size={15} />
                </span>
              </strong>
              <p>{item.copy}</p>
            </Link>
          </motion.div>
        ))}
      </RevealGroup>
    </Section>
  );
}
