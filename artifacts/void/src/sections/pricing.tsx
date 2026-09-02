import { Link } from "wouter";
import { Icon, Reveal, RevealGroup, RevealItem, Section, SplitHeading, Spotlight } from "@/components/site/primitives";
import { compareRows, plans } from "@/lib/site-data";

export function PricingCards() {
  return (
    <RevealGroup className="price-grid" stagger={0.08}>
      {plans.map((plan) => (
        <RevealItem key={plan.id} style={{ height: "100%" }}>
          <Spotlight
            className={`price-card ${plan.featured ? "is-featured" : ""}`}
            style={{ height: "100%" }}
          >
            {plan.featured && <span className="price-badge">most common</span>}
            <h3>{plan.name}</h3>
            <div className="price-amount">
              {plan.price}
              {plan.unit && <small> {plan.unit}</small>}
            </div>
            <p className="mono">{plan.volume}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Icon name="check" size={14} />
                  {feature}
                </li>
              ))}
            </ul>
            <Link
              href={plan.id === "self" ? "/contact" : "/#access"}
              className={`btn ${plan.featured ? "btn-primary" : "btn-ghost"}`}
              data-testid={`link-plan-${plan.id}`}
              style={{ marginTop: 6 }}
            >
              {plan.cta}
            </Link>
          </Spotlight>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

function cellClass(value: string) {
  if (value === "yes") return "yes";
  if (value === "no") return "no";
  return "partial";
}

function cellText(value: string) {
  if (value === "yes") return "yes";
  if (value === "no") return "no";
  return value;
}

export function ComparisonTable() {
  return (
    <Reveal className="table-wrap">
      <table className="data" data-testid="table-compare">
        <thead>
          <tr>
            <th>capability</th>
            <th>VOID</th>
            <th>Tracing</th>
            <th>Guardrails</th>
            <th>Build it yourself</th>
          </tr>
        </thead>
        <tbody>
          {compareRows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td key={`${row[0]}-${index}`} className={index === 0 ? "" : cellClass(cell)}>
                  {index === 0 ? cell : cellText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Reveal>
  );
}

export function PricingSection() {
  return (
    <Section id="pricing" index="09" label="PRICING">
      <SplitHeading text="Priced per protected action, not per seat." className="h2" />
      <p className="lede mt-sm">
        Seats are not the risk surface. The number of writes VOID stands in front of is, so that is the meter.
      </p>
      <div className="mt-lg">
        <PricingCards />
      </div>
      <ComparisonTable />
      <p className="mono mt-md">illustrative pricing, protected action volume is the unit</p>
      <Link href="/pricing" className="link-arrow mt-sm" data-testid="link-pricing-full">
        Open the calculator
        <Icon name="arrowUpRight" size={15} />
      </Link>
    </Section>
  );
}
