import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "wouter";
import { Icon } from "@/components/site/primitives";
import { EASE } from "@/lib/motion";
import { usePageMeta, useVisibleInterval } from "@/lib/use-site";

const CHARS = "01<>[]{}=+*#%&/\\|.:-_";
const ROWS = 5;
const COLS = 46;

function noise() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join(""),
  ).join("\n");
}

export default function NotFound() {
  usePageMeta("Not found, VOID", "This path has no inverse. The requested page is not in the ledger.");
  const reduced = useReducedMotion();
  const [field, setField] = useState(noise);

  useVisibleInterval(() => setField(noise()), 90, !reduced);

  useEffect(() => {
    if (reduced) setField(noise());
  }, [reduced]);

  return (
    <div className="not-found">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <div className="nf-code" aria-hidden="true">
          404
        </div>
        <pre className="nf-noise" aria-hidden="true">
          {field}
        </pre>
        <span className="kicker" style={{ justifyContent: "center" }}>
          [ 404 ] NULL ROUTE
        </span>
        <h1 className="h2" style={{ marginTop: 14 }}>
          This path has no inverse.
        </h1>
        <p className="lede" style={{ margin: "0 auto 28px" }}>
          The requested page is not in the ledger. Return to the write path, or read the specification and find
          out what should have been here.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/" className="btn btn-primary" data-testid="link-404-home">
            Return home
            <Icon name="arrow" size={15} />
          </Link>
          <Link href="/spec" className="btn btn-ghost" data-testid="link-404-spec">
            Read the spec
          </Link>
          <Link href="/docs" className="btn btn-ghost" data-testid="link-404-docs">
            Open the docs
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
