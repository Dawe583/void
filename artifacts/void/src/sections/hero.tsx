import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Link } from "wouter";
import { Counter, Icon, Magnetic, Scramble } from "@/components/site/primitives";
import { EASE, staggerParent } from "@/lib/motion";
import { useVisibleInterval } from "@/lib/use-site";

type Line = { text: string; cls?: string };

const TERMINAL: Line[] = [
  { text: "$ npx void init", cls: "t-cmd" },
  { text: "  + detected 4 tool surfaces (mcp: stripe, hubspot, gmail, postgres)", cls: "t-ok" },
  { text: "  + compensation plans generated for 37 of 41 tools", cls: "t-ok" },
  { text: "  ! 4 tools have no inverse: class R3, budget required", cls: "t-warn" },
  { text: "" },
  { text: "$ void watch --agent billing-ops", cls: "t-cmd" },
  { text: "  [09:14:02] intent    issue_refund(ch_3P9k, 4200 EUR)", cls: "t-dim" },
  { text: "  [09:14:02] preflight blast radius: 1 payment, 1 ledger row, 1 email", cls: "t-dim" },
  { text: "  [09:14:02] class     R3  irreversible", cls: "t-bad" },
  { text: "  [09:14:02] policy    HOLD, budget 0/2 spent today", cls: "t-warn" },
  { text: "  [09:14:11] human     approved by dana@ (SSO)", cls: "t-accent" },
  { text: "  [09:14:11] commit    ok, sealed 0x9f3c..a10e", cls: "t-ok" },
  { text: "" },
  { text: "$ void rewind --to 09:12:00", cls: "t-cmd" },
  { text: "  <- restoring 412 fields across 3 systems ....... done", cls: "t-ok" },
  { text: "  <- cancelling 3 calendar holds ................. done", cls: "t-ok" },
  { text: "  <- retracting 1 email .......................... mitigated (R2)", cls: "t-warn" },
  { text: "  1 action could not be reversed (R3) and is listed above.", cls: "t-bad" },
];

const FULL_LENGTH = TERMINAL.reduce((total, line) => total + line.text.length + 1, 0);

function Terminal() {
  const reduced = useReducedMotion();
  const [chars, setChars] = useState(reduced ? FULL_LENGTH : 0);
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (reduced || started) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced, started]);

  useVisibleInterval(
    () => setChars((value) => (value >= FULL_LENGTH ? value : value + 3)),
    12,
    started && !reduced && chars < FULL_LENGTH,
  );

  const rendered = useMemo(() => {
    let budget = chars;
    return TERMINAL.map((line, index) => {
      if (budget <= 0) return { ...line, shown: "", done: false, index };
      const take = Math.min(line.text.length, budget);
      budget -= line.text.length + 1;
      return { ...line, shown: line.text.slice(0, take), done: take === line.text.length, index };
    });
  }, [chars]);

  const typing = chars < FULL_LENGTH;

  return (
    <div className="terminal" ref={ref} data-testid="terminal-hero">
      <div className="terminal-bar">
        <span className="terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="mono" style={{ fontSize: 11 }}>
          billing-ops
        </span>
        <span className="terminal-title">fig. 01, live session</span>
      </div>
      <div className="terminal-body" aria-label="Example VOID terminal session">
        {rendered.map((line) => (
          <div key={line.index} className={line.cls}>
            {line.shown || " "}
            {typing && line.shown && !line.done ? <span className="caret" /> : null}
          </div>
        ))}
        {!typing ? <span className="caret" /> : null}
      </div>
      <div className="caption">
        <span>fig. 01, intercepted session</span>
        <span>illustrative output</span>
      </div>
    </div>
  );
}

const ROTATOR = [
  "reversing a Stripe refund",
  "restoring 412 CRM fields",
  "cancelling 3 calendar holds",
  "retracting 1 outbound email",
  "sealing ledger block 0xa10e",
];

function LiveRotator() {
  const [index, setIndex] = useState(0);
  useVisibleInterval(() => setIndex((value) => (value + 1) % ROTATOR.length), 2600);

  return (
    <div className="live-strip" data-testid="text-live-rotator">
      <span className="live-dot" aria-hidden="true" />
      <span className="muted" style={{ flex: "none" }}>
        Live now:
      </span>
      <span className="live-rotator">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            {ROTATOR[index]}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

export function Hero() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 70]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, reduced ? 1 : 0.25]);

  const item = {
    hidden: { opacity: 0, y: 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
  };

  return (
    <section className="hero" ref={ref} aria-label="VOID, reversible autonomy for AI agents">
      <div className="hero-grid">
        <motion.div style={{ y, opacity }} initial="hidden" animate="show" variants={staggerParent(0.09)}>
          <motion.div variants={item}>
            <span className="hero-eyebrow">
              <b>PRIVATE BETA</b>
              <span>
                <Scramble text="reversible autonomy layer" />
              </span>
            </span>
          </motion.div>

          <motion.h1 className="h1" variants={item}>
            Every action your agents take,{" "}
            <span className="gradient-text">reversible</span>.
          </motion.h1>

          <motion.p className="hero-sub" variants={item}>
            VOID sits between your agents and your tools. It intercepts every write, computes what it would
            take to undo it, and keeps a signed record you can replay. Ctrl+Z for autonomous systems.
          </motion.p>

          <motion.div className="hero-actions" variants={item}>
            <Magnetic>
              <Link href="/#access" className="btn btn-primary btn-lg" data-testid="link-hero-access">
                Request access
                <Icon name="arrow" size={16} />
              </Link>
            </Magnetic>
            <Magnetic strength={0.14}>
              <Link href="/spec" className="btn btn-ghost btn-lg" data-testid="link-hero-spec">
                Read the spec
              </Link>
            </Magnetic>
          </motion.div>

          <motion.p className="hero-note" variants={item}>
            Private beta / self hosted or managed / SDK, MCP proxy or CLI
          </motion.p>

          <motion.div variants={item}>
            <LiveRotator />
          </motion.div>

          <motion.div className="hero-stats" variants={item}>
            <div>
              <strong>
                <Counter to={73.4} decimals={1} suffix="%" />
              </strong>
              <span>writes with an inverse</span>
            </div>
            <div>
              <strong>
                <Counter to={40} suffix="ms" />
              </strong>
              <span>worst case preflight</span>
            </div>
            <div>
              <strong>
                <Counter to={14} />
              </strong>
              <span>systems, one path</span>
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 26, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.35 }}
        >
          <Terminal />
        </motion.div>
      </div>
    </section>
  );
}
