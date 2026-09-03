import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { Reveal, RevealGroup, RevealItem, Section, SplitHeading } from "@/components/site/primitives";
import { rollout } from "@/lib/site-data";

export function Rollout() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 60%"] });
  const scaleY = useSpring(scrollYProgress, { stiffness: 120, damping: 26, restDelta: 0.001 });

  return (
    <Section id="rollout" index="11" label="ROLLOUT">
      <div className="rollout-grid">
        <div className="rollout-sticky">
          <SplitHeading text="Four weeks from shadow mode to enforcing." className="h2" />
          <p className="lede mt-sm">
            Nobody turns on a veto in week one. The rollout is designed so every step produces a number that
            justifies the next one.
          </p>
          <Reveal className="note-box mt-md">
            <span>
              Week one is free of risk by construction: shadow mode records intent and computes classes without
              holding a single call.
            </span>
          </Reveal>
        </div>

        <RevealGroup className="rollout-steps" stagger={0.09}>
          <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
            <motion.div
              className="rollout-progress"
              style={{ scaleY: reduced ? 1 : scaleY, height: "100%" }}
            />
          </div>
          {rollout.map((step) => (
            <RevealItem className="rollout-step" key={step.n}>
              <h3 className="h3">
                <em>{step.n}</em>
                {step.title}
                <span className="mono" style={{ marginLeft: "auto" }}>
                  {step.week}
                </span>
              </h3>
              <p>{step.body}</p>
              <div className="rollout-bar" aria-hidden="true">
                <motion.i
                  initial={{ width: 0 }}
                  whileInView={{ width: `${step.progress}%` }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </Section>
  );
}
