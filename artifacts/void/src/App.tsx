import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Link, Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";

type Tone = "r0" | "r1" | "r2" | "r3";
type Action = { time: string; label: string; tone: Tone; system: string };

const actions: Action[] = [
  { time: "09:02", label: "contact.read", tone: "r0", system: "CRM" },
  { time: "09:04", label: "field.update", tone: "r0", system: "CRM" },
  { time: "09:06", label: "ticket.create", tone: "r1", system: "CRM" },
  { time: "09:08", label: "refund.issue", tone: "r2", system: "LEDGER" },
  { time: "09:11", label: "hold.book", tone: "r0", system: "MAIL" },
  { time: "09:14", label: "payout.move", tone: "r3", system: "LEDGER" },
  { time: "09:17", label: "email.send", tone: "r2", system: "MAIL" },
  { time: "09:21", label: "field.restore", tone: "r0", system: "CRM" },
  { time: "09:24", label: "case.close", tone: "r1", system: "CRM" },
  { time: "09:27", label: "note.append", tone: "r0", system: "CRM" },
  { time: "09:31", label: "invoice.void", tone: "r2", system: "LEDGER" },
  { time: "09:35", label: "hold.cancel", tone: "r0", system: "MAIL" },
  { time: "09:38", label: "record.patch", tone: "r1", system: "CRM" },
  { time: "09:42", label: "ledger.seal", tone: "r0", system: "LEDGER" },
];

const featureData = [
  ["Interceptor", "Drop in front of any tool surface: MCP servers, HTTP tools, function calling, your own SDK.", "MCP / SDK / HTTP", "  +----+  \n  | <> |  \n  +--+--+  \n     |     "],
  ["Preflight", "Before a call commits, VOID computes its blast radius: which systems change, how many records, which fields, and the reversibility class.", "ALLOW / HOLD / VETO", "  .----.  \n /  /\\  \\ \n|  /  \\  |\n \\______ /"],
  ["Compensation compiler", "For every intercepted call, VOID synthesizes the inverse action and captures a before snapshot.", "INVERSE / SNAPSHOT", "  [ + ]   \n   | |    \n  [ - ]   \n   | |    \n  { 0 }   "],
  ["Saga ledger", "An append only, hash chained, signed record of intent, payload, result, snapshot and compensation plan for every action.", "SIGNED / CHAINED", "  #==#==# \n  |  |  | \n  #==#==# \n    \\_|_  "],
  ["Time scrubber", "Pick a moment. VOID replays compensations in LIFO order across every connected system and shows you, live, what came back and what did not.", "LIFO / REPLAY", "  o---o---o\n      ^    \n  o---o---o\n  <  time  >"],
  ["Irreversibility budget", "Each agent gets a daily allowance of irreversible action. Spend it and the agent drops to read only until a human tops it up.", "METERED / R3", "  [###]   \n  [## ]   \n  [#  ]   \n  [0  ]   "],
];

const codeSamples: Record<string, string> = {
  MCP: `$ void mcp proxy --config void.policy.ts\n\nexport default {\n  upstream: \"mcp://tools\",\n  policy: \"./void.policy.ts\",\n  ledger: { sink: \"s3://your-ledger\", sign: true },\n};`,
  TypeScript: `import { void_ } from \"@void/sdk\";\n\nconst tools = void_.wrap(myTools, {\n  policy: \"./void.policy.ts\",\n  budget: { irreversible: 2 },\n  ledger: { sink: \"s3://your-ledger\", sign: true },\n});`,
  Python: `from void_sdk import protect\n\nagent = protect(tools, policy=\"void.policy.yaml\")\nagent.budget(irreversible=2)\nagent.ledger(\"s3://your-ledger\", sign=True)`,
  CLI: `$ void init\n$ void watch --agent billing-ops\n$ void rewind --to 09:12:00\n  <- 11 reversed, 2 mitigated, 1 logged`,
};

const classRows: { id: Tone; title: string; subtitle: string; body: string; example: string }[] = [
  { id: "r0", title: "fully reversible", subtitle: "snapshot restore, exact prior state", body: "VOID keeps a before snapshot and an exact inverse. Replay is deterministic and the prior state is restored.", example: "CRM field update -> field restore" },
  { id: "r1", title: "reversible with trace", subtitle: "undone, but the change was visible", body: "The side effect can be reversed, but an external observer may have seen it. VOID preserves the trace.", example: "ticket create -> ticket close + audit note" },
  { id: "r2", title: "mitigable only", subtitle: "cannot unsend, can retract and notify", body: "The original side effect cannot be erased. VOID applies the safest compensation and records the gap.", example: "email send -> retract + recipient notice" },
  { id: "r3", title: "irreversible", subtitle: "money moved, data destroyed, no path", body: "R3 costs from the agent budget. Policy can hold the call for a human, and the signed record remains.", example: "payout move -> logged, budgeted, never claimed undoable" },
];

const faqs = [
  ["What happens when an action genuinely cannot be undone?", "It is classified R3 before the call commits. VOID spends budget, can hold for approval, and records the action with its evidence. It never pretends a mitigation is an undo."],
  ["Does VOID slow my agents down?", "Preflight adds 8 to 40ms. Commits are not blocked unless policy says so. Compensation plans are compiled ahead of time where the tool surface allows it."],
  ["Do you see my payloads?", "In self hosted mode, no data leaves your infrastructure. Field level redaction is available in both modes, and your signing keys stay yours."],
  ["Which frameworks are supported?", "LangGraph, CrewAI, OpenAI Agents SDK, Claude Agent SDK, MCP clients, and custom loops through the SDK or proxy."],
  ["What if a tool has no API to reverse a change?", "The action is classified R2 or R3. VOID stores the evidence, applies the best mitigation when one exists, and makes the gap visible."],
  ["How is this different from database transactions?", "Database transactions stop at the database boundary. VOID follows an action across CRM, mail, payments and infrastructure."],
  ["How is this different from tracing tools?", "Tracing tells you what happened. VOID prepares the inverse before it happens and keeps a signed replayable record."],
  ["Can I run it in shadow mode first?", "Yes. Shadow mode records intent and classifies blast radius without changing commit behavior. Move to preflight, then compensation, then enforce."],
];

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${visible ? "is-visible" : ""} ${className}`}>{children}</div>;
}

function AsciiField() {
  return <div aria-hidden="true" className="ascii-field" />;
}

function Section({ id, index, title, children, className = "" }: { id: string; index: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`hairline-section content-pad ${className}`}>
      <Reveal><div className="kicker">[ {index} ] {title}</div></Reveal>
      {children}
    </section>
  );
}

function SiteNav() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastScroll = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const current = window.scrollY;
      setHidden(current > lastScroll.current && current > 80);
      lastScroll.current = current;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const close = () => setOpen(false);
  return (
    <nav className={`site-nav ${hidden ? "nav-hidden" : ""}`} aria-label="Primary navigation">
      <div className="nav-inner">
        <div className="nav-links">
          <Link data-testid="link-product" className="nav-link" href="/#gap">[Product]</Link>
          <Link data-testid="link-docs" className="nav-link" href="/docs">[Docs]</Link>
        </div>
        <Link data-testid="link-logo" className="wordmark" href="/">VOID</Link>
        <div className="nav-links right">
          <Link data-testid="link-pricing" className="nav-link" href="/pricing">[Pricing]</Link>
          <Link data-testid="link-security" className="nav-link" href="/security">[Security]</Link>
        </div>
        <button data-testid="button-mobile-menu" className="menu-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>[ {open ? "close" : "menu"} ]</button>
      </div>
      <div className={`mobile-menu ${open ? "open" : ""}`}>
        <Link data-testid="mobile-link-product" className="nav-link" href="/#gap" onClick={close}>[Product]</Link>
        <Link data-testid="mobile-link-spec" className="nav-link" href="/spec" onClick={close}>[Spec]</Link>
        <Link data-testid="mobile-link-docs" className="nav-link" href="/docs" onClick={close}>[Docs]</Link>
        <Link data-testid="mobile-link-pricing" className="nav-link" href="/pricing" onClick={close}>[Pricing]</Link>
        <Link data-testid="mobile-link-cs" className="nav-link" href="/cs" onClick={close}>[Česky]</Link>
      </div>
    </nav>
  );
}

function Footer() {
  const [clock, setClock] = useState(new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date().toISOString().slice(11, 19)), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-cell"><div className="wordmark">VOID</div><div style={{ marginTop: 18 }}>UTC {clock}</div><div className="status-dot">● all systems nominal</div></div>
        <div className="footer-cell"><div className="kicker">Product</div><Link data-testid="footer-link-spec" href="/spec">Spec</Link><Link data-testid="footer-link-pricing" href="/pricing">Pricing</Link><Link data-testid="footer-link-security" href="/security">Security</Link></div>
        <div className="footer-cell"><div className="kicker">Observe</div><Link data-testid="footer-link-docs" href="/docs">Docs</Link><Link data-testid="footer-link-changelog" href="/changelog">Changelog</Link><Link data-testid="footer-link-cs" href="/cs">Česká mutace</Link></div>
        <div className="footer-cell"><div className="kicker">Status</div><span>private beta</span><span>self hosted or managed</span><span>SDK, MCP proxy or CLI</span></div>
      </div>
      <div className="footer-bottom"><span>VOID is a product concept. Numbers on this page are illustrative.</span><span>press T for CRT, G for grid</span></div>
    </footer>
  );
}

function SharedShell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [grid, setGrid] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem("void-theme");
    if (stored === "dark") setTheme("dark");
    const onKey = (event: KeyboardEvent) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (event.key.toLowerCase() === "t") setTheme((value) => value === "light" ? "dark" : "light");
      if (event.key.toLowerCase() === "g") setGrid((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("void-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.body.classList.toggle("grid-overlay", grid);
  }, [grid]);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? (window.scrollY / max) * 100 : 0);
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => window.removeEventListener("scroll", update);
  }, []);
  return <div className="void-app"><AsciiField /><div className="scroll-progress" style={{ width: `${progress}%` }} /><SiteNav /><main className="frame">{children}</main><Footer /></div>;
}

function Hero() {
  return (
    <section className="hero hairline-section">
      <div className="hero-copy">
        <Reveal><div className="kicker">VOID · reversible autonomy layer · private beta</div></Reveal>
        <Reveal className="stagger-1"><h1 className="display">Every action your agents take, reversible.</h1></Reveal>
        <Reveal className="stagger-2"><p className="hero-sub">VOID sits between your agents and your tools. It intercepts every write, computes what it would take to undo it, and keeps a signed record you can replay. Ctrl+Z for autonomous systems.</p></Reveal>
        <Reveal className="stagger-3"><div className="hero-actions"><Link data-testid="link-request-access" className="btn btn-primary" href="#access">Request access</Link><Link data-testid="link-read-spec" className="btn btn-ghost" href="/spec">Read the spec <span>↗</span></Link></div></Reveal>
        <div className="mono-small">Private beta · self hosted or managed · SDK, MCP proxy or CLI</div>
        <div className="status-line"><span className="status-dot">● Live now:</span> reversing a Stripe refund / restoring 412 CRM fields / cancelling 3 calendar holds</div>
      </div>
      <Reveal className="stagger-4">
        <div className="ascii-box crop crop-extra terminal" data-testid="display-terminal">
          <div className="terminal-bar"><span>[ ][ ][ ]</span><span>session / billing-ops</span></div>
          <pre><span className="prompt">$</span> <span className="cmd">npx void init</span>{"\n"}  <span className="good">+ detected 4 tool surfaces</span> (mcp: stripe, hubspot, gmail, postgres){"\n"}  <span className="good">+ compensation plans generated</span> for 37 of 41 tools{"\n"}  <span className="warn">! 4 tools have no inverse</span>: class R3, budget required{"\n\n"}<span className="prompt">$</span> <span className="cmd">void watch --agent billing-ops</span>{"\n"}  [09:14:02] intent   issue_refund(ch_3P9k, 4200 EUR){"\n"}  [09:14:02] preflight blast radius: 1 payment, 1 ledger row, 1 email{"\n"}  [09:14:02] class    <span className="bad">R3 irreversible</span>{"\n"}  [09:14:02] policy   HOLD, budget 0/2 spent today{"\n"}  [09:14:11] human    approved by dana@ (SSO){"\n"}  [09:14:11] commit   <span className="good">ok, sealed 0x9f3c..a10e</span>{"\n\n"}<span className="prompt">$</span> <span className="cmd">void rewind --to 09:12:00</span>{"\n"}  <span className="good">&lt;- restoring 412 fields across 3 systems .... done</span>{"\n"}  <span className="good">&lt;- cancelling 3 calendar holds .......... done</span>{"\n"}  <span className="warn">&lt;- retracting 1 email .................... mitigated (R2)</span>{"\n"}  1 action could not be reversed (R3) and is listed above.</pre>
          <div className="caption">fig. 01, live session</div>
        </div>
      </Reveal>
      <div className="scroll-cue">[ scroll ↓ ] <span className="muted">the write path starts below</span></div>
    </section>
  );
}

function Marquee() {
  const systems = ["Stripe", "HubSpot", "Salesforce", "Gmail", "Slack", "Postgres", "GitHub", "S3", "Zendesk", "Twilio", "Notion", "Linear", "Snowflake", "Kubernetes"];
  return <div className="marquee-wrap"><div className="marquee" aria-label="Integration targets">{[...systems, ...systems].map((system, index) => <span key={`${system}-${index}`}>+ {system}</span>)}</div><div className="mono-small" style={{ padding: "0 22px 13px" }}>integration targets, not endorsements</div></div>;
}

function Gap() {
  return <Section id="gap" index="01" title="THE GAP"><Reveal><h2 className="section-title">Your stack can watch, filter and ask. It cannot undo.</h2></Reveal><div className="comparison-grid"><Reveal className="comparison-cell"><div className="kicker">01 / OBSERVABILITY</div><h3>sees it after</h3><p>Tracing tells you what the agent did once the side effect is already in the world.</p></Reveal><Reveal className="comparison-cell stagger-1"><div className="kicker">02 / GUARDRAILS</div><h3>blocks the prompt, not the write</h3><p>Filters catch words and inputs. They do not restore a changed record.</p></Reveal><Reveal className="comparison-cell stagger-2"><div className="kicker">03 / APPROVALS</div><h3>a human clicks yes</h3><p>Approval moves the moment of responsibility. The human still owns the mess.</p></Reveal></div><Reveal><div className="comparison-foot">VOID / reverses the write <span style={{ float: "right" }}>preflight → compensate → replay</span></div></Reveal><div className="stats-grid">{[["73.4%", "writes with a prepared inverse", "▂▃▅▆▅▇"], ["8 to 40ms", "preflight latency", "▇▅▄▃▄▂"], ["14", "systems in one write path", "▂▄▃▆▇█"], ["R3", "budgeted, never hidden", "▆▅▃▃▂▁"]].map(([value, label, spark], index) => <Reveal key={label} className={`stat stagger-${index + 1}`}><strong>{value}</strong><span>{label}</span><div className="spark">{spark}</div><small className="mono-small">illustrative</small></Reveal>)}</div></Section>;
}

function Mechanisms() {
  return <Section id="mechanisms" index="02" title="MECHANISMS"><Reveal><h2 className="section-title">Six moving parts, one guarantee.</h2></Reveal><div className="mechanism-grid">{featureData.map(([name, body, meta, art], index) => <Reveal key={name} className={`mechanism stagger-${(index % 4) + 1}`}><div className="pictogram" aria-hidden="true">{art}</div><h3>{name}</h3><p>{body}</p><div className="meta">{meta}</div></Reveal>)}</div></Section>;
}

function Install() {
  const [tab, setTab] = useState("TypeScript");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(codeSamples[tab]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const code = codeSamples[tab];
  return <Section id="install" index="03" title="INSTALL"><Reveal><h2 className="section-title">Three lines, in front of anything.</h2></Reveal><div className="install-layout"><Reveal><div className="tabs" role="tablist">{Object.keys(codeSamples).map((item) => <button data-testid={`tab-${item.toLowerCase()}`} role="tab" aria-selected={tab === item} className={`tab ${tab === item ? "active" : ""}`} key={item} onClick={() => setTab(item)}>{item}</button>)}</div><div className="ascii-box crop crop-extra codebox"><div className="code-actions"><span className="mono-small">[ ][ ][ ] / {tab.toLowerCase()}</span><button data-testid="button-copy-code" className="tab" onClick={copy}>{copied ? "copied ✓" : "copy"}</button></div><div className="code-window"><div className="line-nos">{code.split("\n").map((_, index) => <div key={index}>{String(index + 1).padStart(2, "0")}</div>)}</div><code className="code-text">{code}</code></div><div className="caption">fig. 02, deployment surface</div></div></Reveal><Reveal className="install-note stagger-1"><div className="kicker">THE SMALL PROMISE</div><p>Any agent. Any tool. One layer in the write path.</p><p className="mono-small">The SDK wraps existing tools without changing the agent loop. The MCP proxy is drop-in. The CLI gives platform teams a view before code changes.</p><Link data-testid="link-install-docs" className="link-arrow" href="/docs">read the quickstart ↗</Link></Reveal></div></Section>;
}

function Replay() {
  const [position, setPosition] = useState(actions.length - 1);
  const active = actions.slice(0, position + 1);
  const count = useMemo(() => ({ reversed: active.filter((item) => item.tone === "r0" || item.tone === "r1").length, mitigated: active.filter((item) => item.tone === "r2").length, irreversible: active.filter((item) => item.tone === "r3").length }), [active]);
  const rows = [
    ["CRM", position < 4 ? "lead_104 / unchanged" : position < 9 ? "lead_104 / qualified" : "lead_104 / restored"],
    ["MAIL", position < 5 ? "3 holds / empty" : position < 11 ? "3 holds / booked" : "3 holds / cancelled"],
    ["LEDGER", position < 3 ? "no refund / sealed" : position < 6 ? "refund / pending" : "payout / R3 logged"],
  ];
  return <Section id="replay" index="04" title="REPLAY" className="replay-section"><Reveal><h2 className="section-title">Drag the past back.</h2><p className="section-copy">Pick a moment. VOID replays compensations in LIFO order across every connected system and shows you what came back and what did not.</p></Reveal><Reveal><div className="ascii-box crop crop-extra replay-shell" data-testid="replay-demo"><div className="timeline-head"><span className="kicker">LIVE LEDGER / 14 ACTIONS</span><span className="mono-small">09:02 → {actions[position].time}</span></div><div className="timeline"><div className="timeline-line" /><div className="timeline-fill" style={{ width: `${(position / (actions.length - 1)) * 100}%` }} /><div className="timeline-nodes">{actions.map((item, index) => <div className={`timeline-node ${index <= position ? "active" : ""}`} key={`${item.label}-${index}`}><i title={item.tone} style={{ background: index <= position ? `var(--${item.tone === "r0" ? "ok" : item.tone === "r1" ? "accent-hex" : item.tone === "r2" ? "warn" : "bad"})` : "var(--paper)" }} /><span>{item.time}</span></div>)}</div></div><input data-testid="input-replay-scrubber" className="replay-range" type="range" min="0" max={actions.length - 1} value={position} onChange={(event) => setPosition(Number(event.target.value))} aria-label="Replay timeline" /><div className="replay-panels">{rows.map(([system, value]) => <div className="system-panel" key={system}><h4>{system}</h4><div><span>state</span><span>{value}</span></div><div><span>comp</span><span>{position < 6 && system === "LEDGER" ? "none" : "ready"}</span></div><div><span>hash</span><span>0x9f3c..</span></div></div>)}</div>{count.irreversible > 0 && <div className="replay-note">cannot be reversed, R3, logged and budgeted</div>}<div className="replay-counter">reversed {count.reversed} · mitigated {count.mitigated} · irreversible {count.irreversible}</div><div className="caption">fig. 03, compensation replay</div></div></Reveal></Section>;
}

function Topology() {
  const [mode, setMode] = useState("MCP proxy");
  return <Section id="topology" index="05" title="TOPOLOGY"><Reveal><h2 className="section-title">One layer, in the write path.</h2></Reveal><Reveal><div className="ascii-box topology"><div className="beams" aria-hidden="true">───────&gt;───────&gt;───────&gt;───────</div><div className="topology-grid"><div className="node-stack">{["LangGraph", "CrewAI", "custom loop"].map((node) => <div className="node" key={node}>{node}</div>)}</div><div className="node void-node">[ VOID ]<small className="mono-small">preflight / inverse / ledger</small></div><div className="node-stack">{["MCP tools", "payments", "data + mail"].map((node) => <div className="node" key={node}>{node}</div>)}</div></div><div className="caption">fig. 04, deployment topology</div></div></Reveal><div className="deployment-chips">{["MCP proxy", "SDK wrap", "Sidecar"].map((item) => <button data-testid={`button-mode-${item.replace(" ", "-").toLowerCase()}`} key={item} onClick={() => setMode(item)} className={`chip-toggle ${mode === item ? "selected" : ""}`}>{item}</button>)}<span className="mono-small">active shape: {mode}</span></div></Section>;
}

function Classes() {
  const [open, setOpen] = useState<Tone | null>("r0");
  return <Section id="classes" index="06" title="CLASSES"><Reveal><h2 className="section-title">Know the class before the call.</h2></Reveal><div className="class-list">{classRows.map((row) => <div className="class-row" key={row.id}><button data-testid={`button-class-${row.id}`} className="class-trigger" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id}><i className="class-chip" style={{ background: `var(--${row.id === "r0" ? "ok" : row.id === "r1" ? "accent-hex" : row.id === "r2" ? "warn" : "bad"})` }} /><strong>{row.id.toUpperCase()}</strong><span>{row.title}, {row.subtitle}</span><b>{open === row.id ? "−" : "+"}</b></button>{open === row.id && <div className="class-detail"><div>{row.body}</div><div><span className="mono-small">COMPENSATION</span><br />{row.example}</div></div>}</div>)}</div></Section>;
}

function Telemetry() {
  return <Section id="telemetry" index="07" title="TELEMETRY"><Reveal><h2 className="section-title">The numbers your risk team will ask for.</h2></Reveal><div className="chart-grid"><Reveal className="ascii-box crop chart-box wide"><div className="chart-title">reversible coverage / 12 weeks</div><div className="area-chart">{[28, 35, 42, 39, 53, 56, 61, 68, 71, 76, 82, 87].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><div className="mono-small" style={{ marginTop: 10 }}>week 01&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;week 12</div><div className="caption">fig. 05, coverage</div></Reveal><Reveal className="ascii-box chart-box stagger-1"><div className="chart-title">blast radius / tool</div><div className="bar-chart">{[62, 90, 47, 76, 38, 56].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><div className="mono-small" style={{ marginTop: 10 }}>crm&nbsp;&nbsp;pay&nbsp;&nbsp;mail&nbsp;&nbsp;db&nbsp;&nbsp;infra&nbsp;&nbsp;files</div><div className="caption">fig. 06, radius</div></Reveal><Reveal className="ascii-box chart-box stagger-2"><div className="chart-title">budget burned / today</div><div className="ring">37%</div><div className="mono-small" style={{ textAlign: "center", marginTop: 10 }}>billing-ops / 2 of 5 R3</div><div className="caption">fig. 07, budget</div></Reveal></div><div className="mono-small" style={{ marginTop: 24 }}>dataset illustrative, generated from a fictional production workspace</div></Section>;
}

function Rollout() {
  const steps = [["01 / SHADOW", "record only", "Watch intent without changing behavior."], ["02 / PREFLIGHT", "classify and warn", "Expose blast radius and reversibility before commit."], ["03 / COMPENSATE", "undo enabled", "Compile inverses and capture before snapshots."], ["04 / ENFORCE", "policy and budget on", "Hold R3, meter risk, and make the write path accountable."]];
  return <Section id="rollout" index="08" title="ROLLOUT"><div className="rollout-layout"><Reveal><h2 className="section-title">Four weeks from shadow mode to enforcing.</h2></Reveal><Reveal className="rollout-steps stagger-1">{steps.map(([number, title, body]) => <div className="rollout-step" key={number}><h3>{number} / {title}</h3><p>{body}</p></div>)}</Reveal></div></Section>;
}

function PricingCards() {
  return <><div className="pricing-grid"><Reveal className="price-card"><h3>DEV</h3><div className="price">free</div><div className="mono-small">10k protected actions / month</div><ul><li>community support</li><li>local ledger</li><li>shadow mode</li></ul></Reveal><Reveal className="price-card featured stagger-1"><span className="most-common">most common</span><h3>TEAM</h3><div className="price">490 <small>EUR / month</small></div><div className="mono-small">1M protected actions / month</div><ul><li>SSO and policy controls</li><li>signed ledger export</li><li>8h support</li></ul></Reveal><Reveal className="price-card stagger-2"><h3>SELF HOSTED</h3><div className="price">custom</div><div className="mono-small">your infra, your keys</div><ul><li>no data leaves</li><li>audit support</li><li>air-gapped option</li></ul></Reveal></div><div className="mono-small" style={{ marginTop: 16 }}>illustrative pricing, protected action volume is the unit</div></>;
}

function ComparisonTable() {
  const rows = [["Reverses writes", "yes", "no", "no", "partial"], ["Pre commit veto", "yes", "no", "partial", "yes"], ["Signed record", "yes", "partial", "partial", "partial"], ["Cross system", "yes", "no", "no", "partial"], ["Time to value", "days", "hours", "hours", "months"]];
  return <div className="table-wrap"><table className="compare-table"><thead><tr><th>capability</th><th>VOID</th><th>Tracing</th><th>Guardrails</th><th>Build it yourself</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td className={index === 0 ? "" : cell === "yes" ? "yes" : cell === "no" ? "no" : "partial"} key={`${row[0]}-${index}`}>{index === 0 ? cell : cell === "yes" ? "+" : cell === "no" ? "·" : cell}</td>)}</tr>)}</tbody></table></div>;
}

function PricingSection() {
  return <Section id="pricing" index="09" title="PRICING"><Reveal><h2 className="section-title">Priced per protected action, not per seat.</h2></Reveal><PricingCards /><ComparisonTable /></Section>;
}

function FieldNotes() {
  const quotes = ["Our agents were fine 99 percent of the time. VOID is for the other 1 percent, and it is the only reason legal let us go past shadow mode.", "We had logs for every call. We did not have a way to answer what would happen if we needed to go back.", "The budget made autonomy legible. Platform owns the guardrail, compliance owns the evidence."];
  return <Section id="field-notes" index="10" title="FIELD NOTES"><div className="notes-grid">{quotes.map((quote, index) => <Reveal className="quote" key={quote}><p>“{quote}”</p><footer>illustrative, design partner pilot<br />{["Head of Platform, Series B fintech, 40 agents in production", "Staff Engineer, internal automation, 18 agents", "Compliance Lead, health operations, 7 agents"][index]}</footer></Reveal>)}</div></Section>;
}

function Record() {
  return <Section id="record" index="11" title="RECORD"><Reveal><h2 className="section-title">A log you can hand to a regulator.</h2></Reveal><div className="record-grid"><Reveal className="record-copy"><p>The EU AI Act Article 12 record keeping duty makes agent behavior a governance problem, not only an observability problem.</p><p>A hash chained, signed, replayable ledger gives risk teams the intent, payload, result, snapshot and compensation plan as one defensible record. Export it in an AI Act Article 12 style format.</p><div className="mono-small">Informational, not legal advice.</div></Reveal><Reveal><div className="ascii-box crop"><pre className="json"><span className="key">{"{"}</span>{"\n"}  <span className="key">"intent"</span>: <span className="value">"issue_refund"</span>,{"\n"}  <span className="key">"class"</span>: <span className="value">"R3"</span>,{"\n"}  <span className="key">"agent"</span>: <span className="value">"billing-ops"</span>,{"\n"}  <span className="key">"snapshot"</span>: <span className="value">"sha256:4c2e..."</span>,{"\n"}  <span className="key">"compensation"</span>: <span className="value">null</span>,{"\n"}  <span className="key">"prev_hash"</span>: <span className="value">"0x9f3c..."</span>,{"\n"}  <span className="key">"signature"</span>: <span className="value">"ed25519:a10e"</span>{"\n"}<span className="key">{"}"}</span></pre><div className="caption">fig. 08, sealed ledger entry</div></div></Reveal></div></Section>;
}

function Faq() {
  const [open, setOpen] = useState(0);
  return <Section id="faq" index="12" title="FAQ"><Reveal><h2 className="section-title">The uncomfortable questions, answered plainly.</h2></Reveal><div className="faq-list">{faqs.map(([question, answer], index) => <div className="faq-row" key={question}><button data-testid={`button-faq-${index}`} className="faq-trigger" onClick={() => setOpen(open === index ? -1 : index)} aria-expanded={open === index}><span>{question}</span><b>{open === index ? "−" : "+"}</b></button>{open === index && <div className="faq-answer">{answer}</div>}</div>)}</div></Section>;
}

const waitlistSchema = z.object({ email: z.string().email("enter a valid work email"), company: z.string().min(2, "company is required"), agents: z.string().min(1, "select an agent count") });

function Access() {
  const [form, setForm] = useState({ email: "", company: "", agents: "", note: "" });
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const setField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = waitlistSchema.safeParse(form);
    if (!result.success) { setError(result.error.issues[0]?.message || "check the form"); return; }
    setError("");
    setSubmitted(true);
    console.info("VOID waitlist request", { ...form, frameworks });
  };
  if (submitted) return <Section id="access" index="13" title="ACCESS"><div className="receipt">{"+"} request sealed{"\n"}{"+"} queue: private-beta{"\n"}{"+"} company: {form.company}{"\n"}{"+"} frameworks: {frameworks.join(", ") || "custom"}{"\n"}{"+"} receipt: 0x7b4e..91ac{"\n\n"}We will find the right write path.</div></Section>;
  return <Section id="access" index="13" title="ACCESS"><div className="cta-layout"><Reveal><h2 className="section-title">Let your agents act. Keep the undo.</h2><p className="section-copy">Private beta access for platform and compliance teams running agents in production.</p><form className="waitlist-form" onSubmit={submit}><div className="field"><label htmlFor="email">work email</label><input data-testid="input-email" id="email" value={form.email} onChange={(event) => setField("email", event.target.value)} placeholder="you@company.com" /></div><div className="field"><label htmlFor="company">company</label><input data-testid="input-company" id="company" value={form.company} onChange={(event) => setField("company", event.target.value)} placeholder="your team" /></div><div className="field"><label>frameworks</label><div className="chip-select">{["LangGraph", "CrewAI", "MCP", "custom"].map((item) => <button data-testid={`button-framework-${item.toLowerCase()}`} type="button" className={`chip-toggle ${frameworks.includes(item) ? "selected" : ""}`} key={item} onClick={() => setFrameworks((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])}>{item}</button>)}</div></div><div className="field"><label htmlFor="agents">agents in production</label><select data-testid="select-agents" id="agents" value={form.agents} onChange={(event) => setField("agents", event.target.value)}><option value="">select one</option><option value="1 to 5">1 to 5</option><option value="6 to 25">6 to 25</option><option value="26 to 100">26 to 100</option><option value="100+">100+</option></select></div><div className="field"><label htmlFor="note">context, optional</label><textarea data-testid="input-note" id="note" value={form.note} onChange={(event) => setField("note", event.target.value)} placeholder="What write do you wish you could reverse?" /></div>{error && <div data-testid="status-form-error" className="field-error">{error}</div>}<button data-testid="button-submit-waitlist" type="submit" className="btn btn-primary">request access ↗</button></form></Reveal><Reveal className="install-note stagger-1"><div className="kicker">ALSO READ</div><h3 style={{ font: "400 34px var(--app-font-serif)", margin: "16px 0" }}>The reversible autonomy specification.</h3><p className="section-copy">A technical model for interceptors, compensation plans, classifying risk, and replaying across systems.</p><Link data-testid="link-access-spec" className="btn btn-ghost" href="/spec">read the spec</Link></Reveal></div></Section>;
}

function Explore() {
  const items = [["DOCS", "/docs"], ["SPEC", "/spec"], ["CHANGELOG", "/changelog"], ["SECURITY", "/security"], ["COMPLIANCE", "/#record"], ["PRICING", "/pricing"], ["BLOG", "/changelog"], ["STATUS", "/#access"], ["CONTACT", "/#access"]];
  return <section className="hairline-section content-pad"><div className="kicker">[ 14 ] EXPLORE</div><div className="explore-grid">{items.map(([label, href], index) => <Link data-testid={`link-explore-${label.toLowerCase()}`} className="explore-card" href={href} key={label}><span className="mono-small">0{index + 1}</span><strong>{label} <span className="link-arrow">↗</span></strong></Link>)}</div></section>;
}

function Home() {
  return <><Hero /><Marquee /><Gap /><Mechanisms /><Install /><Replay /><Topology /><Classes /><Telemetry /><Rollout /><PricingSection /><FieldNotes /><Record /><Faq /><Access /><Explore /></>;
}

function SubHeader({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return <header className="subpage-header"><div className="kicker">[ {kicker} ]</div><h1 className="section-title">{title}</h1><p>{copy}</p></header>;
}

function SpecPage() {
  const tools = ["stripe.refund", "hubspot.contact", "salesforce.case", "gmail.send", "slack.message", "postgres.update", "github.commit", "s3.putObject", "zendesk.ticket", "twilio.sms", "notion.page", "linear.issue", "snowflake.query", "kubernetes.patch", "calendar.book", "file.delete", "invoice.void", "crm.merge", "email.unsubscribe", "feature.flag"];
  return <><SubHeader kicker="SPEC / 01" title="The reversible autonomy specification." copy="A system model for placing an accountable layer between an AI agent and the tools it can change." /><div className="sub-layout"><nav className="toc"><a href="#model">01 / model</a><a href="#classes-spec">02 / classes</a><a href="#compensation">03 / compensation</a><a href="#ledger-spec">04 / ledger</a></nav><div><div id="model" className="doc-section"><h2>01 / The model</h2><p>VOID treats every agent side effect as a transaction with five known moments: intent, preflight, commit, compensation and record. The interceptor is the boundary. The ledger is the memory.</p><pre className="spec-code">{"agent -> interceptor -> preflight -> policy -> tool\n                                      |             |\n                                 hold / veto   commit\n                                      |             |\n                              compensation plan -> ledger"}</pre></div><div id="classes-spec" className="doc-section"><h2>02 / Reversibility classes</h2><p>Class is computed before a write. It is not a post hoc label. R3 consumes budget even when policy allows the action.</p>{classRows.map((row) => <div className="class-row" key={row.id}><div className="class-trigger"><i className="class-chip" style={{ background: `var(--${row.id === "r0" ? "ok" : row.id === "r1" ? "accent-hex" : row.id === "r2" ? "warn" : "bad"})` }} /><strong>{row.id.toUpperCase()}</strong><span>{row.subtitle}</span></div></div>)}</div><div id="compensation" className="doc-section"><h2>03 / Compensation table</h2><table className="comp-table"><thead><tr><th>tool action</th><th>class</th><th>stored inverse</th></tr></thead><tbody>{tools.map((tool, index) => <tr key={tool}><td>{tool}</td><td className={index % 7 === 0 ? "partial" : index % 5 === 0 ? "yes" : "partial"}>{index % 7 === 0 ? "R3" : index % 5 === 0 ? "R0" : index % 3 === 0 ? "R2" : "R1"}</td><td>{index % 7 === 0 ? "evidence + budget" : index % 3 === 0 ? "mitigation + notice" : "snapshot restore"}</td></tr>)}</tbody></table></div><div id="ledger-spec" className="doc-section"><h2>04 / Ledger format</h2><p>Each entry is append only, signed by the workspace key, and linked to the previous entry. An export is useful to an engineer and legible to a risk team.</p><pre className="spec-code">{`{\n  \"sequence\": 1042,\n  \"intent\": \"issue_refund\",\n  \"blast_radius\": [\"payments\", \"ledger\", \"mail\"],\n  \"class\": \"R3\",\n  \"snapshot\": \"sha256:4c2e...\",\n  \"prev_hash\": \"0x9f3c...\",\n  \"signature\": \"ed25519:a10e\"\n}`}</pre></div></div></div></>;
}

function PricingPage() {
  const [actionsPerMonth, setActionsPerMonth] = useState(250000);
  const [selfHosted, setSelfHosted] = useState(false);
  const cost = selfHosted ? 1250 + Math.round(actionsPerMonth / 1000000) * 90 : actionsPerMonth <= 10000 ? 0 : 490 + Math.round(actionsPerMonth / 1000000) * 110;
  return <><SubHeader kicker="PRICING / 09" title="A meter for the write path." copy="Protected action volume is the unit. Seats are not the risk surface." /><div className="content-pad"><PricingCards /><Reveal><div className="calculator"><div className="kicker">PROTECTED ACTIONS CALCULATOR</div><output data-testid="text-calculator-cost">{selfHosted ? "custom / " : "EUR "}{cost.toLocaleString("en-US")}{!selfHosted && " / month"}</output><label className="mono-small" htmlFor="actions">actions per month: {actionsPerMonth.toLocaleString("en-US")}</label><input data-testid="input-actions-calculator" id="actions" type="range" min="10000" max="5000000" step="10000" value={actionsPerMonth} onChange={(event) => setActionsPerMonth(Number(event.target.value))} /><div className="toggle-row" style={{ marginTop: 26 }}><span>self hosted, your infra and keys</span><button data-testid="button-toggle-self-hosted" className={`switch ${selfHosted ? "on" : ""}`} onClick={() => setSelfHosted((value) => !value)} aria-pressed={selfHosted}><i /></button></div><div className="mono-small" style={{ marginTop: 18 }}>estimate is illustrative, contact us for a real workload model</div></div></Reveal><ComparisonTable /></div></>;
}

function SecurityPage() {
  return <><SubHeader kicker="SECURITY / 11" title="The layer that sees less, by design." copy="VOID is built to make the write path accountable without becoming another place to collect your data." /><div className="sub-layout"><nav className="toc"><a href="#flow">01 / data flow</a><a href="#stored">02 / stored</a><a href="#keys">03 / keys</a><a href="#hosting">04 / hosting</a></nav><div><div id="flow" className="doc-section"><h2>01 / Data flow</h2><pre className="spec-code">{"agent -> [VOID interceptor] -> tool\n             |       |\n       redaction   signed event\n             |       |\n        policy     ledger sink"}</pre><p>Self hosted mode keeps the interceptor, policy engine and ledger in your infrastructure. Managed mode uses an encrypted control plane with configurable retention.</p></div><div id="stored" className="doc-section"><h2>02 / What is stored</h2><p>Intent, tool identity, blast radius, class, result metadata, before snapshot reference, compensation plan and a signed hash chain. Payload fields can be redacted before they enter the ledger.</p></div><div id="keys" className="doc-section"><h2>03 / Key handling</h2><p>Your signing keys remain yours. Bring your own KMS or keep the ledger entirely inside an air-gapped deployment. VOID cannot replay what it cannot read.</p></div><div id="hosting" className="doc-section"><h2>04 / Hosting shapes</h2><p>Deploy as an MCP proxy, an SDK wrapper, or a sidecar next to the agent runtime. Each shape preserves the same event model and policy language.</p></div></div></div></>;
}

function ChangelogPage() {
  const entries = [["0.7.0", "2025-02-14", "Replay lanes", "Cross system replay now renders compensation order per connected system, including R2 mitigation lines."], ["0.6.2", "2025-01-29", "Policy holds", "R3 actions can pause at preflight while a human approves from the signed intent record."], ["0.6.0", "2025-01-08", "MCP surface", "Added the MCP proxy path with tool discovery and inverse coverage reporting."], ["0.5.1", "2024-12-11", "Redaction", "Field level redaction rules now compile alongside compensation plans."], ["0.5.0", "2024-11-19", "First ledger", "Append only signed saga entries, exportable as a compact JSONL stream."]];
  return <><SubHeader kicker="CHANGELOG / 12" title="The undo stack keeps changing." copy="Reverse chronological notes from a fictional private beta. Each entry is a small change to the write path." /><div className="content-pad">{entries.map(([version, date, title, body]) => <Reveal className="doc-section" key={version}><div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}><span className="accent mono-small">[{version}]</span><span className="mono-small">{date}</span></div><h2 style={{ marginTop: 12 }}>{title}</h2><p>{body}</p></Reveal>)}</div></>;
}

function DocsPage() {
  const [doc, setDoc] = useState("quickstart");
  const pages: Record<string, { title: string; copy: string; code: string }> = {
    quickstart: { title: "Quickstart", copy: "Put VOID in front of one tool surface and watch the write path before you enforce it.", code: `$ npx void init\n$ void mcp proxy --upstream mcp://tools\n$ void watch --agent billing-ops\n  detected 4 surfaces, 37 inverses, 4 R3 gaps` },
    policy: { title: "Policy language", copy: "Policy decides allow, hold or veto using class, blast radius, actor, tool and budget.", code: `rule refund {\n  when: tool == \"stripe.refund\"\n  if: class == R3\n  then: hold\n  require: role(\"finance\")\n}` },
    ledger: { title: "Ledger format", copy: "The ledger is append only, hash chained, signed and exportable. One entry is enough to reconstruct the decision.", code: `sequence: 1042\nintent: issue_refund\nclass: R3\nprev_hash: 0x9f3c...\nsignature: ed25519:a10e` },
  };
  const current = pages[doc];
  return <><SubHeader kicker="DOCS / 00" title="Documentation for the write path." copy="Three short pages for the engineer who wants to know exactly where the inverse comes from." /><div className="docs-shell"><nav className="docs-nav">{Object.entries(pages).map(([key, item]) => <button data-testid={`button-doc-${key}`} className={doc === key ? "active" : ""} onClick={() => setDoc(key)} key={key}>[ {item.title} ]</button>)}</nav><article className="docs-content"><div className="kicker">DOCS / {doc}</div><h2>{current.title}</h2><p className="section-copy">{current.copy}</p><pre className="spec-code">{current.code}</pre><p className="mono-small" style={{ marginTop: 24 }}>Need the long version? <Link data-testid="link-docs-spec" className="accent" href="/spec">read the full spec ↗</Link></p></article></div></>;
}

function CzechPage() {
  const csNames: Record<string, string> = { Interceptor: "Interceptor", Preflight: "Předběžná kontrola", "Compensation compiler": "Kompilátor kompenzací", "Saga ledger": "Saga ledger", "Time scrubber": "Časová osa", "Irreversibility budget": "Rozpočet nevratnosti" };
  return <><SubHeader kicker="CS / 00" title="Každá akce vašich agentů, vratná." copy="VOID sedí mezi vašimi agenty a nástroji. Zachytí každý zápis, spočítá jeho dopad, připraví opačnou akci a uchová podepsaný záznam, který můžete přehrát." /><div className="content-pad"><Section id="cs-gap" index="01" title="MEZERA"><h2 className="section-title">Váš stack umí sledovat, filtrovat a žádat. Neumí vrátit změnu.</h2><p className="section-copy">Observabilita vidí problém až po akci. Guardrails blokují prompt, ne zápis. Schválení přesune odpovědnost na člověka. VOID vrací zápis.</p></Section><Section id="cs-mechanisms" index="02" title="MECHANISMY"><h2 className="section-title">Šest pohyblivých částí, jedna jistota.</h2><div className="mechanism-grid">{featureData.map(([name, , meta, art]) => <div className="mechanism" key={name}><div className="pictogram">{art}</div><h3>{csNames[name]}</h3><div className="meta">{meta}</div></div>)}</div></Section><Section id="cs-access" index="03" title="PŘÍSTUP"><h2 className="section-title">Nechte agenty jednat. Ponechte si zpět.</h2><p className="section-copy">Soukromá beta pro platformní a compliance týmy, které provozují agenty v produkci.</p><Link data-testid="link-cs-access" className="btn btn-primary" href="/#access">Požádat o přístup ↗</Link></Section></div></>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/spec" component={SpecPage} /><Route path="/pricing" component={PricingPage} /><Route path="/security" component={SecurityPage} /><Route path="/changelog" component={ChangelogPage} /><Route path="/docs" component={DocsPage} /><Route path="/cs" component={CzechPage} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><SharedShell><Router /></SharedShell></WouterRouter>;
}

export default App;