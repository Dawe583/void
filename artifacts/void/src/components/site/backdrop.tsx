import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * The ASCII field: a 14px rule grid under a band of scattered glyphs, masked so
 * the reading column stays calm, plus the CRT scanlines the dark theme turns on.
 *
 * Both are drawn entirely in CSS on two elements. There is no canvas and no
 * animation loop, so the field costs nothing to render and behaves the same on
 * a low powered phone as on a workstation.
 */
export function Backdrop() {
  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
    </>
  );
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
