import { type ReactNode, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "wouter";
import { Icon, Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { codeSamples } from "@/lib/site-data";
import { useCopy } from "@/lib/use-site";
import { EASE } from "@/lib/motion";

const KEYWORDS =
  /\b(import|from|const|let|var|export|return|function|async|await|def|class|true|false|True|False|null|None|new)\b/;

/**
 * A deliberately small highlighter. It covers the four snippet languages on the
 * page without pulling a syntax highlighting bundle into the marketing build.
 */
function highlight(line: string, key: number): ReactNode {
  if (/^\s*(#|\/\/)/.test(line)) {
    return (
      <span className="c-com" key={key}>
        {line}
      </span>
    );
  }

  const parts: ReactNode[] = [];
  const pattern = /("[^"]*"|'[^']*'|\/\/.*$|#.*$|\b\d+\b|[A-Za-z_$][\w$]*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    const token = match[0];
    if (/^["']/.test(token)) parts.push(<span className="c-str" key={`${key}-${i}`}>{token}</span>);
    else if (/^(\/\/|#)/.test(token)) parts.push(<span className="c-com" key={`${key}-${i}`}>{token}</span>);
    else if (/^\d+$/.test(token)) parts.push(<span className="c-num" key={`${key}-${i}`}>{token}</span>);
    else if (KEYWORDS.test(token)) parts.push(<span className="c-key" key={`${key}-${i}`}>{token}</span>);
    else if (line[pattern.lastIndex] === "(") parts.push(<span className="c-fn" key={`${key}-${i}`}>{token}</span>);
    else parts.push(token);
    last = pattern.lastIndex;
    i += 1;
  }
  if (last < line.length) parts.push(line.slice(last));
  return <span key={key}>{parts}</span>;
}

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const { copied, copy } = useCopy();
  const lines = code.split("\n");

  return (
    <div className="codebox">
      <div className="codebox-bar">
        <span>
          [ ][ ][ ] {label}
        </span>
        <button
          type="button"
          className={`copy-btn ${copied ? "is-done" : ""}`}
          onClick={() => copy(code)}
          data-testid="button-copy-code"
          aria-label="Copy code to clipboard"
        >
          <Icon name={copied ? "check" : "copy"} size={12} />
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div className="code-scroll">
        <div className="code-body">
          <div className="code-nos" aria-hidden="true">
            {lines.map((_, index) => (
              <span key={index}>{String(index + 1).padStart(2, "0")}</span>
            ))}
          </div>
          <code className="code-text">
            {lines.map((line, index) => (
              <span key={index}>
                {highlight(line, index)}
                {index < lines.length - 1 ? "\n" : ""}
              </span>
            ))}
          </code>
        </div>
      </div>
    </div>
  );
}

export function Install() {
  const tabs = Object.keys(codeSamples);
  const [tab, setTab] = useState(tabs[1]);

  return (
    <Section id="install" index="03" label="INSTALL">
      <SplitHeading text="Three lines, in front of anything." className="h2" />
      <p className="lede mt-sm">
        The SDK wraps existing tools without changing the agent loop. The MCP proxy is drop in at the transport
        level. The CLI gives platform teams a view before any code changes.
      </p>

      <div className="install-grid mt-lg">
        <Reveal>
          <div className="tabs" role="tablist" aria-label="Installation surface">
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={`tab ${tab === item ? "is-on" : ""}`}
                onClick={() => setTab(item)}
                data-testid={`tab-${item.toLowerCase()}`}
              >
                {tab === item && (
                  <motion.span layoutId="tab-pill" className="tab-pill" transition={{ duration: 0.3, ease: EASE }} />
                )}
                <span style={{ position: "relative" }}>{item}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.24, ease: EASE }}
            >
              <CodeBlock code={codeSamples[tab]} label={tab.toLowerCase()} />
            </motion.div>
          </AnimatePresence>
          <p className="mono mt-sm">fig. 02, deployment surface</p>
        </Reveal>

        <Reveal className="side-note" delay={0.08}>
          <span className="kicker">The small promise</span>
          <h3 className="h3">Any agent. Any tool. One layer in the write path.</h3>
          <ul>
            <li>No change to your agent loop, prompts or model choice.</li>
            <li>Tools are classified on connect, so classes exist before the first call.</li>
            <li>Shadow mode records without holding, so week one costs you nothing.</li>
            <li>Self hosted keeps the interceptor, policy engine and ledger inside your VPC.</li>
          </ul>
          <Link href="/docs/quickstart" className="link-arrow" data-testid="link-install-docs">
            Read the quickstart
            <Icon name="arrowUpRight" size={15} />
          </Link>
        </Reveal>
      </div>
    </Section>
  );
}
