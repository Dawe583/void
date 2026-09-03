import { Link } from "wouter";
import { PageHero } from "@/components/site/page-hero";
import { Counter, Icon, Reveal, RevealGroup, RevealItem, Section, SplitHeading, Spotlight } from "@/components/site/primitives";
import { usePageMeta } from "@/lib/use-site";

const PRINCIPLES = [
  {
    title: "Say the class out loud",
    body: "A product that hides which actions cannot be undone is worse than no product. Every surface names the class before the call, including the ones that make us look limited.",
    icon: "shield",
  },
  {
    title: "The record is the product",
    body: "An undo stack nobody trusts is not a record, and a record you cannot execute is not an undo stack. We refuse to ship one without the other.",
    icon: "chain",
  },
  {
    title: "Sit in the write path, own the latency",
    body: "Being in the path is a privilege with a budget attached. Preflight has a latency target and we publish it, because a safety layer that slows agents down gets removed.",
    icon: "gauge",
  },
  {
    title: "See less than we could",
    body: "Every field we do not store is a field that cannot leak. Redaction is on by default and self hosting is a first class shape, not an enterprise upsell.",
    icon: "layers",
  },
];

const TIMELINE = [
  ["2025 Q4", "The question", "A support agent issues 41 duplicate refunds overnight. The postmortem takes nine days, mostly spent reconstructing what happened from unsigned logs."],
  ["2026 Q1", "The prototype", "First interceptor, first compensation compiler, one adapter. It reverses a CRM field update end to end and the idea stops being a slide."],
  ["2026 Q2", "Private beta", "Design partners in fintech, health operations and internal automation. Shadow mode ships first, because nobody enables a veto on day one."],
  ["2026 Q3", "Budgets and export", "Irreversibility budgets per agent, and an Article 12 style ledger export that an auditor can verify offline."],
];

export default function CompanyPage() {
  usePageMeta(
    "Company, VOID",
    "Why VOID exists, what the team believes about agent side effects, and how the product concept got here.",
    "/company",
  );

  return (
    <>
      <PageHero
        kicker="COMPANY / 17"
        title="We build the layer nobody wants to need."
        copy="VOID exists because the safety stack around AI agents can watch, filter and ask, but has no step that puts anything back. That gap is not a feature request. It is a missing layer."
        meta={["product concept", "Prague, Czech Republic", "private beta"]}
      />

      <Section id="principles" index="01" label="PRINCIPLES">
        <SplitHeading text="Four things we will not trade away." className="h2" />
        <RevealGroup className="grid-2 mt-lg" stagger={0.07}>
          {PRINCIPLES.map((principle) => (
            <RevealItem key={principle.title} style={{ height: "100%" }}>
              <Spotlight className="card" style={{ height: "100%" }}>
                <span className="mech-icon">
                  <Icon name={principle.icon} size={20} />
                </span>
                <h3 className="h3" style={{ marginTop: 12 }}>
                  {principle.title}
                </h3>
                <p>{principle.body}</p>
              </Spotlight>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section id="story" index="02" label="STORY">
        <SplitHeading text="How it got here." className="h2" />
        <RevealGroup className="mt-lg" stagger={0.07}>
          {TIMELINE.map(([when, title, body]) => (
            <RevealItem key={when}>
              <article className="changelog-entry">
                <div className="changelog-head">
                  <span className="tag tag-accent">{when}</span>
                </div>
                <h3 className="h3">{title}</h3>
                <p style={{ margin: 0, color: "var(--ink-faint)" }}>{body}</p>
              </article>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section id="craft" index="03" label="CRAFT">
        <div className="record-grid">
          <Reveal className="prose">
            <SplitHeading text="Drawn before it is built." className="h2" />
            <p>
              Every adapter starts as a table of tool actions and their inverses, written out by hand, before a
              line of code exists. If the inverse cannot be written down in one line, the tool is R2 or R3 and we
              say so, rather than shipping a helper that pretends otherwise.
            </p>
            <p>
              That discipline is why the compensation table on the specification page is the first thing we show
              engineers. It is the honest part of the product.
            </p>
            <Link href="/spec" className="link-arrow" data-testid="link-company-spec">
              See the compensation table
              <Icon name="arrowUpRight" size={15} />
            </Link>
          </Reveal>
          <Reveal className="media-frame" delay={0.08}>
            <img
              src="/void-blueprint.jpg"
              alt="A technical drawing on a drafting table with one route traced in blue"
              loading="lazy"
              decoding="async"
              width={1024}
              height={1024}
            />
          </Reveal>
        </div>
      </Section>

      <Section id="numbers" index="04" label="BY THE NUMBERS">
        <RevealGroup className="stat-grid" style={{ marginTop: 0 }}>
          {[
            [4, "", "design partner pilots"],
            [41, "", "tools with mapped inverses"],
            [3, "", "deployment shapes"],
            [24, "months", "default ledger retention"],
          ].map(([value, suffix, label]) => (
            <RevealItem className="stat" key={String(label)}>
              <strong>
                <Counter to={Number(value)} suffix={suffix ? ` ${suffix}` : ""} />
              </strong>
              <span>{String(label)}</span>
              <small>illustrative</small>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="row mt-lg">
          <Link href="/#access" className="btn btn-primary" data-testid="link-company-access">
            Request access
            <Icon name="arrow" size={15} />
          </Link>
          <Link href="/contact" className="btn btn-ghost" data-testid="link-company-contact">
            Talk to us
          </Link>
        </Reveal>
      </Section>
    </>
  );
}
