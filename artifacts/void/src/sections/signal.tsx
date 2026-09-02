import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Counter, Reveal, SplitHeading } from "@/components/site/primitives";

const READOUT: [string, string][] = [
  ["intercepted today", "18,422"],
  ["prepared inverses", "13,517"],
  ["held for a human", "211"],
  ["budget remaining", "6 of 15"],
];

/**
 * A deliberate break from the monospace language: one photographic band with a
 * parallax layer, so the page has a moment that is not a diagram.
 */
export function Signal() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduced ? ["0%", "0%"] : ["-7%", "7%"]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], reduced ? [1, 1, 1] : [1.08, 1, 1.08]);

  return (
    <section className="signal" ref={ref} aria-labelledby="signal-title">
      <div className="signal-grid">
        <figure className="signal-media" style={{ margin: 0 }}>
          <motion.img
            src="/void-rack.jpg"
            alt="A dark data centre aisle with one illuminated cable running through the rack"
            style={{ y, scale }}
            loading="lazy"
            decoding="async"
            width={1024}
            height={1024}
          />
          <figcaption>fig. 00, the write path, somebody else's hardware</figcaption>
        </figure>

        <div className="signal-copy">
          <span className="kicker">Where the damage happens</span>
          <SplitHeading text="Your agent's mistakes land in other people's systems." className="h2" as="h2" />
          <p id="signal-title">
            The model runs in your infrastructure. The consequences do not. A refund lands in a payment
            processor, a field update lands in a CRM your sales team lives in, an email lands in somebody's
            inbox and stays there.
          </p>
          <p>
            That is why the undo has to live at the boundary, in front of the call, rather than inside the
            framework that happened to make it.
          </p>

          <Reveal className="signal-list">
            {READOUT.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
            <div>
              <span>reversible coverage</span>
              <span>
                <Counter to={73.4} decimals={1} suffix="%" />
              </span>
            </div>
          </Reveal>
          <p className="mono">illustrative telemetry from a design partner pilot</p>
        </div>
      </div>
    </section>
  );
}
