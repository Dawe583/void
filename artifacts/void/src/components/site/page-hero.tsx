import { type ReactNode } from "react";
import { motion } from "motion/react";
import { EASE, staggerParent } from "@/lib/motion";

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export function PageHero({
  kicker,
  title,
  copy,
  meta,
  children,
}: {
  kicker: string;
  title: string;
  copy: string;
  meta?: string[];
  children?: ReactNode;
}) {
  return (
    <header className="page-hero">
      <motion.div initial="hidden" animate="show" variants={staggerParent(0.08)}>
        <motion.span className="kicker" variants={item}>
          [ {kicker} ]
        </motion.span>
        <motion.h1 className="h1" variants={item}>
          {title}
        </motion.h1>
        <motion.p className="lede" variants={item}>
          {copy}
        </motion.p>
        {meta && meta.length > 0 && (
          <motion.div className="page-hero-meta" variants={item}>
            {meta.map((entry) => (
              <span className="tag" key={entry}>
                {entry}
              </span>
            ))}
          </motion.div>
        )}
        {children && <motion.div variants={item}>{children}</motion.div>}
      </motion.div>
    </header>
  );
}

export function TableOfContents({
  items,
  active,
}: {
  items: { id: string; label: string }[];
  active?: string;
}) {
  return (
    <nav className="toc" aria-label="On this page">
      <h4>On this page</h4>
      {items.map((entry, index) => (
        <a
          key={entry.id}
          href={`#${entry.id}`}
          className={active === entry.id ? "is-active" : ""}
          data-testid={`link-toc-${entry.id}`}
        >
          {String(index + 1).padStart(2, "0")} / {entry.label}
        </a>
      ))}
    </nav>
  );
}
