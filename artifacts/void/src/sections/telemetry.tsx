import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Reveal, RevealGroup, RevealItem, Section, SplitHeading } from "@/components/site/primitives";
import { blastSeries, budgetAgents, coverageSeries } from "@/lib/site-data";

function ChartCard({
  title,
  copy,
  fig,
  children,
}: {
  title: string;
  copy: string;
  fig: string;
  children: React.ReactNode;
}) {
  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3 className="h3">{title}</h3>
        <p>{copy}</p>
      </div>
      <div className="chart-body">{children}</div>
      <div className="caption">
        <span>{fig}</span>
        <span>illustrative dataset</span>
      </div>
    </div>
  );
}

function BudgetRing() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [shown, setShown] = useState(0);

  const spent = budgetAgents.reduce((total, agent) => total + agent.spent, 0);
  const cap = budgetAgents.reduce((total, agent) => total + agent.cap, 0);
  const pct = Math.round((spent / cap) * 100);

  useEffect(() => {
    if (inView) setShown(pct);
  }, [inView, pct]);

  const radius = 62;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="ring-wrap" ref={ref}>
      <div className="ring">
        <svg width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent-dark)" />
            </linearGradient>
          </defs>
          <circle className="track" cx="74" cy="74" r={radius} strokeWidth="10" />
          <circle
            className="value"
            cx="74"
            cy="74"
            r={radius}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (circumference * shown) / 100}
          />
        </svg>
        <div className="ring-label">
          <strong>{shown}%</strong>
          <span>budget burned</span>
        </div>
      </div>
      <div className="ring-legend">
        {budgetAgents.map((agent) => (
          <div key={agent.agent}>
            <span>{agent.agent}</span>
            <b>
              {agent.spent}/{agent.cap}
            </b>
          </div>
        ))}
      </div>
    </div>
  );
}

const axisStyle = { fontFamily: "var(--font-code)", fontSize: 10, fill: "var(--ink-faint)" };

export function Telemetry() {
  return (
    <Section id="telemetry" index="07" label="TELEMETRY">
      <SplitHeading text="The numbers your risk team will ask for." className="h2" />
      <p className="lede mt-sm">
        Coverage, blast radius and budget burn, on one screen. These are the three questions that decide whether
        an agent gets to keep writing.
      </p>

      <RevealGroup className="chart-grid mt-lg">
        <RevealItem>
          <ChartCard
            title="Reversible coverage"
            copy="Share of intercepted writes with a prepared inverse, over 12 weeks."
            fig="fig. 05, coverage"
          >
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={coverageSeries} margin={{ top: 6, right: 10, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="covGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="week" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={40} domain={[0, 100]} />
                <Tooltip cursor={{ stroke: "var(--line-strong)" }} />
                <Area
                  type="monotone"
                  dataKey="coverage"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#covGrad)"
                  animationDuration={1100}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </RevealItem>

        <RevealItem>
          <ChartCard
            title="Blast radius by tool"
            copy="Median records touched per call, worst six tools this week."
            fig="fig. 06, blast radius"
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={blastSeries} margin={{ top: 6, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="tool" tick={axisStyle} axisLine={false} tickLine={false} interval={0} height={24} />
                <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={40} />
                <Tooltip cursor={{ fill: "var(--a08)" }} labelFormatter={(label: string) => blastSeries.find((entry) => entry.tool === label)?.full ?? label} />
                <Bar dataKey="records" radius={[3, 3, 0, 0]} animationDuration={1100}>
                  {blastSeries.map((entry) => (
                    <Cell
                      key={entry.tool}
                      fill={entry.records > 150 ? "var(--warn)" : "var(--accent)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </RevealItem>

        <RevealItem>
          <ChartCard
            title="Irreversibility budget"
            copy="Share of today's R3 allowance already spent, per agent."
            fig="fig. 07, budget burn"
          >
            <BudgetRing />
          </ChartCard>
        </RevealItem>
      </RevealGroup>

      <Reveal className="mt-md">
        <p className="mono">
          takeaway: coverage climbs as adapters learn inverses, blast radius flags the tools worth a policy, and
          budget burn tells you which agent is about to go read only.
        </p>
      </Reveal>
    </Section>
  );
}
