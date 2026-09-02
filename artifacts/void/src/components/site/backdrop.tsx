import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useFinePointer } from "@/lib/use-site";

/**
 * The layered page backdrop: a soft aurora mesh, a technical grid, a dot field
 * and film grain. Everything is CSS driven, so it costs no main thread work and
 * renders identically on low powered phones.
 */
export function Backdrop() {
  return (
    <>
      <div className="backdrop" aria-hidden="true">
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="aurora aurora-c" />
        <div className="backdrop-grid" />
        <div className="backdrop-dots" />
      </div>
      <div className="grain" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
    </>
  );
}

/**
 * A blinking block caret that follows a mouse. Never rendered on touch devices
 * or when reduced motion is requested, and it never blocks pointer events.
 */
export function Cursor() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!fine || reduced) return;
    const dot = document.createElement("div");
    const ring = document.createElement("div");
    dot.className = "cursor-dot";
    ring.className = "cursor-ring";
    document.body.append(dot, ring);

    let ringX = -100;
    let ringY = -100;
    let mouseX = -100;
    let mouseY = -100;
    let raf = 0;

    const onMove = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      dot.style.transform = `translate3d(${mouseX - 3}px, ${mouseY - 3}px, 0)`;
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest("a, button, input, select, textarea, [role='button']");
      ring.style.width = interactive ? "44px" : "30px";
      ring.style.height = interactive ? "44px" : "30px";
      ring.style.borderColor = interactive ? "var(--accent)" : "var(--a45)";
    };

    const loop = () => {
      ringX += (mouseX - ringX) * 0.16;
      ringY += (mouseY - ringY) * 0.16;
      const half = ring.offsetWidth / 2;
      ring.style.transform = `translate3d(${ringX - half}px, ${ringY - half}px, 0)`;
      raf = window.requestAnimationFrame(loop);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    raf = window.requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.cancelAnimationFrame(raf);
      dot.remove();
      ring.remove();
    };
  }, [fine, reduced]);

  return null;
}

const RAIN_CHARS = "01<>[]{}=+*#%&/\\|.:-_";

/** Typing "void" anywhere dissolves the page into falling characters. */
export function EasterEggs({ onGrid, onTheme }: { onGrid: () => void; onTheme: () => void }) {
  const [raining, setRaining] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    let buffer = "";

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "g") onGrid();
      if (key === "t") onTheme();

      buffer = (buffer + key).slice(-4);
      if (buffer === "void") {
        buffer = "";
        setRaining(true);
        window.setTimeout(() => setRaining(false), 1600);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onGrid, onTheme, reduced]);

  if (!raining) return null;

  const columns = Math.min(60, Math.floor(window.innerWidth / 22));

  return (
    <div className="rain-layer" aria-hidden="true">
      {Array.from({ length: columns }, (_, index) => {
        const length = 14 + Math.floor(Math.random() * 18);
        const chars = Array.from({ length }, () => RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)]).join("\n");
        return (
          <span
            key={index}
            className="rain-col"
            style={{
              left: `${(index / columns) * 100}%`,
              animationDuration: `${0.9 + Math.random() * 0.8}s`,
              animationDelay: `${Math.random() * 0.3}s`,
            }}
          >
            {chars}
          </span>
        );
      })}
    </div>
  );
}
