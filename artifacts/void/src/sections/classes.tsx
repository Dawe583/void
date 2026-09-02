import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Section, SplitHeading } from "@/components/site/primitives";
import { classRows, toneVar, type Tone } from "@/lib/site-data";
import { EASE } from "@/lib/motion";

export function Classes() {
  const [open, setOpen] = useState<Tone | null>("r0");

  return (
    <Section id="classes" index="06" label="CLASSES">
      <SplitHeading text="Know the class before the call." className="h2" />
      <p className="lede mt-sm">
        VOID does not promise everything is undoable. It promises you know which class you are in before the
        agent acts, and that R3 costs budget.
      </p>

      <div className="class-list mt-lg">
        {classRows.map((row) => {
          const isOpen = open === row.id;
          return (
            <div className="class-row" key={row.id}>
              <button
                type="button"
                className="class-trigger"
                aria-expanded={isOpen}
                aria-controls={`class-panel-${row.id}`}
                onClick={() => setOpen(isOpen ? null : row.id)}
                data-testid={`button-class-${row.id}`}
              >
                <span className="class-dot" style={{ background: toneVar[row.id], color: toneVar[row.id] }} />
                <strong>{row.title}</strong>
                <span className="class-copy">
                  <b>{row.subtitle}</b>, {row.body.split(".")[0].toLowerCase()}.
                </span>
                <span className="class-plus" aria-hidden="true">
                  {isOpen ? "−" : "+"}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`class-panel-${row.id}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="class-detail-inner">
                      <div>
                        <h5>What it means</h5>
                        <p>{row.body}</p>
                      </div>
                      <div>
                        <h5>What VOID stores</h5>
                        <p>{row.stores}</p>
                        <p className="mt-sm">
                          <code>{row.compensation}</code>
                        </p>
                      </div>
                      <div>
                        <h5>Examples</h5>
                        <p>{row.examples.join(", ")}.</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
