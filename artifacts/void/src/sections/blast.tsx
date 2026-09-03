import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Counter, Icon, Section, SplitHeading } from "@/components/site/primitives";
import { blastProbes } from "@/lib/site-data";
import { EASE } from "@/lib/motion";

export function Blast() {
  const [active, setActive] = useState(blastProbes[0].id);
  const probe = blastProbes.find((item) => item.id === active) ?? blastProbes[0];
  const total = probe.rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Section id="blast" index="04" label="SHADOW RUN">
      <SplitHeading text="The number is measured, not guessed." className="h2" />
      <p className="lede mt-sm">
        A policy engine that reads the call can tell you a DELETE is a DELETE. It cannot tell you the predicate
        matches 41,883 rows and drags 114 unprocessed refunds along a foreign key nobody mentioned. VOID runs the
        call against a twin first and reads the answer off the result.
      </p>

      <div className="blast-tabs mt-lg" role="tablist" aria-label="Intercepted calls">
        {blastProbes.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === active}
            className={`blast-tab ${item.id === active ? "is-on" : ""}`}
            data-tone={item.tone}
            onClick={() => setActive(item.id)}
            data-testid={`button-blast-${item.id}`}
          >
            <code>{item.call}</code>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={probe.id}
          className="blast-panel"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          <div className="blast-statement codebox">
            <pre>{probe.statement}</pre>
          </div>

          <div className="blast-method">
            <h5>How the number was obtained</h5>
            <p>{probe.method}</p>
            <span className="blast-latency">
              <Icon name="clock" size={12} /> {probe.latency} added to the call
            </span>
          </div>

          <div className="blast-rows">
            {probe.rows.map((row) => {
              const share = total > 0 ? (row.count / total) * 100 : 0;
              return (
                <div className="blast-row" key={`${probe.id}-${row.target}`} data-tone={row.tone}>
                  <div className="blast-row-head">
                    <strong>
                      <Counter to={row.count} />
                    </strong>
                    <span className="blast-target">{row.target}</span>
                    <span className={`tag tag-${row.tone}`}>{row.tone.toUpperCase()}</span>
                  </div>
                  <div className="blast-row-bar" aria-hidden="true">
                    <motion.span
                      data-tone={row.tone}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(share, 1.5)}%` }}
                      transition={{ duration: 0.7, ease: EASE }}
                    />
                  </div>
                  <p>{row.note}</p>
                </div>
              );
            })}
          </div>

          <div className="blast-verdict" data-tone={probe.tone}>
            <Icon name="alert" size={16} />
            <p>{probe.verdict}</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </Section>
  );
}
