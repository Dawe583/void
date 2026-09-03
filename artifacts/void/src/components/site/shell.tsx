import { type ReactNode, useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from "motion/react";
import { Link, useLocation } from "wouter";
import { Backdrop, EasterEggs } from "@/components/site/backdrop";
import { Icon } from "@/components/site/primitives";
import { useTheme, useVisibleInterval } from "@/lib/use-site";

const NAV_LINKS = [
  { label: "Product", cs: "Produkt", href: "/#mechanisms" },
  { label: "Docs", cs: "Dokumentace", href: "/docs" },
  { label: "Spec", cs: "Specifikace", href: "/spec" },
  { label: "Pricing", cs: "Ceny", href: "/pricing" },
  { label: "Security", cs: "Bezpečnost", href: "/security" },
  { label: "Blog", cs: "Blog", href: "/blog" },
];

/**
 * The Czech mutation is a real route, not a widget, so the chrome around it is
 * translated too. Anything not on /cs stays in English.
 */
const COPY = {
  en: {
    cta: "Request access",
    menu: "Open menu",
    close: "Close menu",
    skip: "Skip to content",
    tagline: "The reversible autonomy layer for AI agents. Every write intercepted, classified, and replayable.",
    nominal: "all systems nominal",
    disclaimer: "VOID is a product concept. Numbers on this page are illustrative.",
    shortcut: ["press", "for theme,", "for grid"],
    columns: ["Product", "Developers", "Trust", "Company"],
  },
  cs: {
    cta: "Požádat o přístup",
    menu: "Otevřít menu",
    close: "Zavřít menu",
    skip: "Přejít na obsah",
    tagline: "Vrstva vratné autonomie pro AI agenty. Každý zápis zachycený, zatříděný a přehratelný.",
    nominal: "vše v pořádku",
    disclaimer: "VOID je produktový koncept. Čísla na této stránce jsou ilustrativní.",
    shortcut: ["stiskněte", "pro motiv,", "pro mřížku"],
    columns: ["Produkt", "Pro vývojáře", "Důvěra", "Společnost"],
  },
} as const;

function useLocale() {
  const [location] = useLocation();
  return location.startsWith("/cs") ? "cs" : "en";
}

const MOBILE_LINKS = [
  { label: "Product", cs: "Produkt", href: "/#mechanisms", meta: "six mechanisms", metaCs: "šest mechanismů" },
  { label: "Replay demo", cs: "Přehrání", href: "/#replay", meta: "the centerpiece", metaCs: "hlavní ukázka" },
  { label: "Docs", cs: "Dokumentace", href: "/docs", meta: "quickstart", metaCs: "quickstart" },
  { label: "Spec", cs: "Specifikace", href: "/spec", meta: "technical", metaCs: "technické" },
  { label: "Pricing", cs: "Ceny", href: "/pricing", meta: "calculator", metaCs: "kalkulačka" },
  { label: "Security", cs: "Bezpečnost", href: "/security", meta: "data flow", metaCs: "tok dat" },
  { label: "Compliance", cs: "Compliance", href: "/compliance", meta: "article 12", metaCs: "článek 12" },
  { label: "Changelog", cs: "Changelog", href: "/changelog", meta: "0.9.0", metaCs: "0.9.0" },
  { label: "Blog", cs: "Blog", href: "/blog", meta: "3 posts", metaCs: "3 články" },
  { label: "Status", cs: "Stav", href: "/status", meta: "operational", metaCs: "v provozu" },
  { label: "Contact", cs: "Kontakt", href: "/contact", meta: "talk to us", metaCs: "napište nám" },
  { label: "Česky", cs: "English", href: "/cs", meta: "česká verze", metaCs: "English version" },
];

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" className="brand" data-testid="link-brand" onClick={onClick} aria-label="VOID home">
      <span className="brand-mark" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8h11a6 6 0 0 1 0 12H9" />
          <path d="m7 4-4 4 4 4" />
        </svg>
      </span>
      VOID
    </Link>
  );
}

function Nav() {
  const [location] = useLocation();
  const locale = useLocale();
  const copy = COPY[locale];
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (value) => setStuck(value > 24));

  useEffect(() => setOpen(false), [location]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header className={`nav ${stuck ? "is-stuck" : ""}`}>
        <div className="nav-inner">
          {/* Links flank a centred wordmark, the way the spec sheet reads. */}
          <nav className="nav-links" aria-label="Primary">
            {NAV_LINKS.slice(0, 3).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                data-testid={`link-nav-${link.label.toLowerCase()}`}
                className={`nav-link ${location === link.href ? "is-active" : ""}`}
              >
                [{locale === "cs" ? link.cs : link.label}]
              </Link>
            ))}
          </nav>

          <Brand />

          <div className="nav-actions">
            <nav className="nav-links right" aria-label="Secondary">
              {NAV_LINKS.slice(3).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  data-testid={`link-nav-${link.label.toLowerCase()}`}
                  className={`nav-link ${location === link.href ? "is-active" : ""}`}
                >
                  [{locale === "cs" ? link.cs : link.label}]
                </Link>
              ))}
            </nav>
            <button
              type="button"
              className="icon-btn"
              onClick={toggle}
              data-testid="button-theme"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
            </button>
            <Link href="/#access" className="btn btn-primary btn-sm" data-testid="link-nav-access">
              {copy.cta}
            </Link>
            <button
              type="button"
              className="icon-btn burger"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? copy.close : copy.menu}
              data-testid="button-menu"
            >
              <Icon name={open ? "close" : "menu"} size={18} />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.nav
            id="mobile-menu"
            className="mobile-menu"
            aria-label="Mobile"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            {MOBILE_LINKS.map((link, index) => (
              <motion.div
                key={link.href}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * index, duration: 0.3 }}
              >
                <Link
                  href={link.label === "Česky" && locale === "cs" ? "/" : link.href}
                  data-testid={`link-mobile-${link.label.toLowerCase()}`}
                >
                  {locale === "cs" ? link.cs : link.label}
                  <span>{locale === "cs" ? link.metaCs : link.meta}</span>
                </Link>
              </motion.div>
            ))}
            <Link href="/#access" className="btn btn-primary mt-md" style={{ width: "100%" }}>
              {copy.cta}
            </Link>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}

function Clock({ nominal }: { nominal: string }) {
  const [now, setNow] = useState(() => new Date());
  useVisibleInterval(() => setNow(new Date()), 1000);
  const stamp = now.toISOString().slice(11, 19);

  return (
    <span className="footer-clock" data-testid="text-clock">
      <span className="live-dot" aria-hidden="true" />
      {stamp} UTC
      <span className="muted">{nominal}</span>
    </span>
  );
}

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Mechanisms", cs: "Mechanismy", href: "/#mechanisms" },
      { label: "Replay demo", cs: "Přehrání", href: "/#replay" },
      { label: "Pricing", cs: "Ceny", href: "/pricing" },
      { label: "Changelog", cs: "Changelog", href: "/changelog" },
      { label: "Status", cs: "Stav", href: "/status" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Docs", cs: "Dokumentace", href: "/docs" },
      { label: "Quickstart", cs: "Quickstart", href: "/docs/quickstart" },
      { label: "Policy language", cs: "Jazyk politik", href: "/docs/policy" },
      { label: "Ledger format", cs: "Formát ledgeru", href: "/docs/ledger" },
      { label: "Specification", cs: "Specifikace", href: "/spec" },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Security", cs: "Bezpečnost", href: "/security" },
      { label: "Compliance", cs: "Compliance", href: "/compliance" },
      { label: "Reversibility classes", cs: "Třídy vratnosti", href: "/#classes" },
      { label: "FAQ", cs: "Otázky", href: "/#faq" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", cs: "O nás", href: "/company" },
      { label: "Blog", cs: "Blog", href: "/blog" },
      { label: "Contact", cs: "Kontakt", href: "/contact" },
      { label: "Česky", cs: "English", href: "/cs" },
    ],
  },
];

function Footer() {
  const locale = useLocale();
  const copy = COPY[locale];

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Brand />
          <p>{copy.tagline}</p>
          <Clock nominal={copy.nominal} />
        </div>
        {FOOTER_COLUMNS.map((column, index) => (
          <div className="footer-col" key={column.title}>
            <h4>{copy.columns[index] ?? column.title}</h4>
            <ul>
              {column.links.map((link) => (
                <li key={link.href + link.label}>
                  <Link
                    href={link.label === "Česky" && locale === "cs" ? "/" : link.href}
                    data-testid={`link-footer-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {locale === "cs" ? link.cs : link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <span>{copy.disclaimer}</span>
        <span>
          {copy.shortcut[0]} <kbd>T</kbd> {copy.shortcut[1]} <kbd>G</kbd> {copy.shortcut[2]}
        </span>
        <span>&copy; {new Date().getFullYear()} VOID Systems</span>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [gridOn, setGridOn] = useState(false);
  const copy = COPY[useLocale()];
  const { toggle } = useTheme();
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 180, damping: 30, restDelta: 0.001 });

  return (
    <div className={`void-app ${gridOn ? "grid-overlay-on" : ""}`}>
      <a href="#main" className="skip-link">
        {copy.skip}
      </a>
      <Backdrop />
      <EasterEggs onGrid={() => setGridOn((value) => !value)} onTheme={toggle} />
      <motion.div
        className="scroll-progress"
        style={{ scaleX: reduced ? scrollYProgress : progress }}
        aria-hidden="true"
      />
      <Nav />
      <div className="shell">
        <main id="main" className="frame">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
