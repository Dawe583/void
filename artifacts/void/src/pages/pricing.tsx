import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { PageHero } from "@/components/site/page-hero";
import { Counter, Icon, Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { ComparisonTable, PricingCards } from "@/sections/pricing";
import { Faq } from "@/sections/record";
import { usePageMeta } from "@/lib/use-site";

const INCLUDED = 1_000_000;
const OVERAGE_PER_10K = 4;

function estimate(actions: number, selfHosted: boolean) {
  if (selfHosted) return null;
  if (actions <= 10_000) return 0;
  if (actions <= INCLUDED) return 490;
  const extra = Math.ceil((actions - INCLUDED) / 10_000) * OVERAGE_PER_10K;
  return 490 + extra;
}

export default function PricingPage() {
  usePageMeta(
    "Pricing, VOID",
    "Priced per protected action, not per seat. Estimate your monthly cost with the protected actions calculator.",
    "/pricing",
  );

  const [actions, setActions] = useState(250_000);
  const [selfHosted, setSelfHosted] = useState(false);
  const cost = useMemo(() => estimate(actions, selfHosted), [actions, selfHosted]);

  return (
    <>
      <PageHero
        kicker="PRICING / 09"
        title="A meter for the write path."
        copy="Protected action volume is the unit. Seats are not the risk surface, so they are not the meter. Every number on this page is illustrative for a product concept."
        meta={["no seat pricing", "shadow mode is free", "self hosted available"]}
      />

      <Section id="plans" index="01" label="PLANS">
        <PricingCards />
        <p className="mono mt-md">
          A protected action is one intercepted write. Reads, retries and vetoed calls are never billed.
        </p>
      </Section>

      <Section id="calculator" index="02" label="CALCULATOR">
        <SplitHeading text="Estimate a month." className="h2" />
        <p className="lede mt-sm">
          Move the slider to the number of writes your agents make in a month. Reads do not count, and neither do
          calls your policy vetoes.
        </p>

        <Reveal className="calculator">
          <div>
            <span className="kicker">Estimated monthly cost</span>
            <div className="calc-out" data-testid="text-calculator-cost">
              {selfHosted ? (
                "custom"
              ) : cost === 0 ? (
                "free"
              ) : (
                <>
                  <Counter to={cost ?? 0} duration={0.6} /> <span style={{ fontSize: "0.3em" }}>EUR / month</span>
                </>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="calc-actions" className="mono" style={{ display: "block", marginBottom: 6 }}>
              protected actions per month: {actions.toLocaleString("en-US")}
            </label>
            <input
              id="calc-actions"
              className="range"
              type="range"
              min={10_000}
              max={5_000_000}
              step={10_000}
              value={actions}
              onChange={(event) => setActions(Number(event.target.value))}
              style={{ ["--fill" as string]: `${((actions - 10_000) / (5_000_000 - 10_000)) * 100}%` }}
              data-testid="input-actions-calculator"
            />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="mono">10k</span>
              <span className="mono">5M</span>
            </div>
          </div>

          <div className="calc-row">
            <div>
              <strong style={{ fontSize: 15 }}>Self hosted, your infra and your keys</strong>
              <p className="mono" style={{ margin: 0 }}>
                nothing leaves your VPC, priced per deployment
              </p>
            </div>
            <button
              type="button"
              className={`switch ${selfHosted ? "on" : ""}`}
              aria-pressed={selfHosted}
              aria-label="Toggle self hosted pricing"
              onClick={() => setSelfHosted((value) => !value)}
              data-testid="button-toggle-self-hosted"
            >
              <i />
            </button>
          </div>

          <div className="grid-3">
            {[
              ["included", selfHosted ? "unlimited" : cost === 0 ? "10k actions" : "1M actions"],
              ["overage", selfHosted ? "not applicable" : `${OVERAGE_PER_10K} EUR / 10k`],
              ["support", selfHosted ? "dedicated" : cost === 0 ? "community" : "8h response"],
            ].map(([label, value]) => (
              <div key={label} className="meter">
                <strong style={{ fontSize: 15 }}>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>

          <p className="mono">
            estimate is illustrative, talk to us for a real workload model
          </p>
        </Reveal>
      </Section>

      <Section id="compare" index="03" label="COMPARE">
        <SplitHeading text="What you get that the neighbours do not." className="h2" />
        <div className="mt-md">
          <ComparisonTable />
        </div>
      </Section>

      <Faq />
    </>
  );
}
