import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { EASE, revealReduced, revealTransition, revealVariants, staggerParent, VIEWPORT, wordVariants } from "@/lib/motion";

/* -------------------------------------------------------------------------- */
/* Reveal                                                                     */
/* -------------------------------------------------------------------------- */

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "article" | "header";
  style?: CSSProperties;
};

/**
 * The one reveal primitive. Falls back to a plain fade when the visitor asks
 * for reduced motion, so content still animates in gently on every device.
 */
export function Reveal({ children, className, delay = 0, as = "div", style }: RevealProps) {
  const reduced = useReducedMotion();
  const Component = motion[as];
  return (
    <Component
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      variants={reduced ? revealReduced : revealVariants}
      transition={reduced ? { duration: 0.2, delay } : { ...revealTransition, delay }}
    >
      {children}
    </Component>
  );
}

/** Staggers direct children that use the Reveal variants. */
export function RevealGroup({
  children,
  className,
  stagger = 0.07,
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  style?: CSSProperties;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      variants={staggerParent(stagger, delay)}
    >
      {children}
    </motion.div>
  );
}

/** A child of RevealGroup. */
export function RevealItem({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={className} style={style} variants={reduced ? revealReduced : revealVariants}>
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Headline word mask                                                         */
/* -------------------------------------------------------------------------- */

export function SplitHeading({
  text,
  className = "h2",
  as: Tag = "h2",
  delay = 0,
}: {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "h3";
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const words = useMemo(() => text.split(" "), [text]);

  if (reduced) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={className}>
      <motion.span
        style={{ display: "inline" }}
        initial="hidden"
        whileInView="show"
        viewport={VIEWPORT}
        variants={staggerParent(0.038, delay)}
      >
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: "0.06em" }}
          >
            <motion.span style={{ display: "inline-block" }} variants={wordVariants}>
              {word}
              {index < words.length - 1 ? " " : ""}
            </motion.span>
          </span>
        ))}
      </motion.span>
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/* Counter                                                                    */
/* -------------------------------------------------------------------------- */

export function Counter({
  to,
  from = 0,
  duration = 1.5,
  decimals = 0,
  prefix = "",
  suffix = "",
  separator = true,
}: {
  to: number;
  from?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  separator?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? to : from);

  useEffect(() => {
    if (!inView || reduced) {
      if (reduced) setValue(to);
      return;
    }
    const controls = animate(from, to, {
      duration,
      ease: EASE,
      onUpdate: (latest) => setValue(latest),
    });
    return () => controls.stop();
  }, [inView, from, to, duration, reduced]);

  const formatted = separator
    ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : value.toFixed(decimals);

  return (
    <span ref={ref}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Scramble text                                                              */
/* -------------------------------------------------------------------------- */

const SCRAMBLE_CHARS = "!<>-_\\/[]{}=+*^?#";

export function Scramble({ text, className, speed = 34 }: { text: string; className?: string; speed?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? text : "");

  useEffect(() => {
    if (!inView || reduced) {
      setDisplay(text);
      return;
    }
    let frame = 0;
    let raf = 0;
    const total = text.length * 2 + 8;

    const tick = () => {
      const revealed = Math.floor(frame / 2);
      let out = "";
      for (let i = 0; i < text.length; i += 1) {
        if (i < revealed || text[i] === " ") {
          out += text[i];
        } else {
          out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }
      setDisplay(out);
      frame += 1;
      if (frame <= total) raf = window.setTimeout(tick, speed) as unknown as number;
      else setDisplay(text);
    };

    tick();
    return () => window.clearTimeout(raf);
  }, [inView, text, reduced, speed]);

  return (
    <span ref={ref} className={className}>
      {display || text}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Spotlight card                                                             */
/* -------------------------------------------------------------------------- */

export function Spotlight({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    node.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return (
    <div ref={ref} className={`spotlight ${className}`} style={style} onPointerMove={onMove}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Magnetic button wrapper                                                    */
/* -------------------------------------------------------------------------- */

export function Magnetic({ children, strength = 0.22 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 20, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 20, mass: 0.4 });

  const onMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (reduced || event.pointerType !== "mouse") return;
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    x.set((event.clientX - rect.left - rect.width / 2) * strength);
    y.set((event.clientY - rect.top - rect.height / 2) * strength);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span
      ref={ref}
      style={{ x: sx, y: sy, display: "inline-flex" }}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      {children}
    </motion.span>
  );
}

/* -------------------------------------------------------------------------- */
/* Section shell                                                              */
/* -------------------------------------------------------------------------- */

export function Section({
  id,
  index,
  label,
  children,
  className = "",
}: {
  id: string;
  index: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`section ${className}`} aria-labelledby={`${id}-label`}>
      <Reveal className="section-head">
        <span className="kicker" id={`${id}-label`}>
          [ {index} ] {label}
        </span>
        <span className="kicker-line" aria-hidden="true" />
      </Reveal>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Icons, a small inline set so nothing is fetched at runtime                  */
/* -------------------------------------------------------------------------- */

const paths: Record<string, ReactNode> = {
  plug: <><path d="M9 2v6M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" /><path d="M12 17v5" /></>,
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 12 19 5" /></>,
  undo: <><path d="M3 8h11a6 6 0 0 1 0 12H9" /><path d="m7 4-4 4 4 4" /></>,
  chain: <><rect x="3" y="4" width="8" height="6" rx="2" /><rect x="13" y="14" width="8" height="6" rx="2" /><path d="M7 10v4h10" /></>,
  rewind: <><path d="m11 7-7 5 7 5z" /><path d="m20 7-7 5 7 5z" /></>,
  gauge: <><path d="M12 21a9 9 0 1 1 9-9" /><path d="m12 12 5-3" /><circle cx="12" cy="12" r="1.6" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  arrowUpRight: <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  menu: <><path d="M4 7h16" /><path d="M4 17h16" /></>,
  close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
  play: <path d="m7 4 12 8-12 8z" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
  alert: <><path d="M12 8v5" /><circle cx="12" cy="16.5" r="0.6" /><path d="M10.3 3.6 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.6" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 14 9 5 9-5" /></>,
  git: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M6 8.5v7M8.5 6h4a3 3 0 0 1 3 3v.6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  code: <><path d="m9 8-5 4 5 4" /><path d="m15 8 5 4-5 4" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z" /><path d="M8 7h7" /></>,
};

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.6,
}: {
  name: keyof typeof paths | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}
