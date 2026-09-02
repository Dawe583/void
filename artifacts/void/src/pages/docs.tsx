import { Link, useRoute } from "wouter";
import { PageHero } from "@/components/site/page-hero";
import { Icon, Reveal } from "@/components/site/primitives";
import { CodeBlock } from "@/sections/install";
import { usePageMeta } from "@/lib/use-site";

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "code"; label: string; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

type Doc = {
  slug: string;
  title: string;
  summary: string;
  minutes: string;
  group: string;
  blocks: Block[];
};

export const docs: Doc[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    summary: "From an unprotected agent to a signed ledger in about ten minutes.",
    minutes: "10 min",
    group: "Getting started",
    blocks: [
      { kind: "p", text: "This guide takes an agent that already calls tools and puts VOID in front of it, in shadow mode. Nothing is held or vetoed, so it is safe to run against production on the first day." },
      { kind: "h", text: "1. Install" },
      { kind: "code", label: "shell", text: "npm install @void/sdk\n# or\npip install void-sdk" },
      { kind: "h", text: "2. Initialise" },
      { kind: "p", text: "The init command discovers your tool surfaces, classifies every tool it can reach, and writes a starter policy." },
      { kind: "code", label: "shell", text: "$ npx void init\n  + detected 4 tool surfaces (mcp: stripe, hubspot, gmail, postgres)\n  + compensation plans generated for 37 of 41 tools\n  ! 4 tools have no inverse: class R3, budget required\n  + wrote void.policy.ts\n  + wrote void.config.toml" },
      { kind: "h", text: "3. Wrap your tools" },
      { kind: "code", label: "agent.ts", text: 'import { void_ } from "@void/sdk";\nimport { myTools } from "./tools";\n\nconst tools = void_.wrap(myTools, {\n  mode: "shadow",                // record only, hold nothing\n  policy: "./void.policy.ts",\n  ledger: { sink: "file://./ledger", sign: true },\n});\n\nexport const agent = createAgent({ tools });' },
      { kind: "note", text: "Shadow mode never blocks a call. It records intent, computes the class and builds the compensation plan, so you get a real picture of your exposure before enforcing anything." },
      { kind: "h", text: "4. Watch a run" },
      { kind: "code", label: "shell", text: "$ void watch --agent billing-ops\n  [09:14:02] intent    issue_refund(ch_3P9k, 4200 EUR)\n  [09:14:02] preflight blast radius: 1 payment, 1 ledger row, 1 email\n  [09:14:02] class     R3  irreversible\n  [09:14:02] policy    SHADOW, would have held\n  [09:14:03] commit    ok, sealed 0x9f3c..a10e" },
      { kind: "h", text: "5. Read the week one report" },
      { kind: "p", text: "After a few days of shadow mode, the report tells you how much irreversible action your agents actually take. That number is what your first real policy is built from." },
      { kind: "code", label: "shell", text: "$ void report --since 7d\n  intercepted        18,422 calls\n  reversible (R0/R1) 13,517  73.4%\n  mitigable  (R2)     3,908  21.2%\n  irreversible (R3)     997   5.4%\n  would have held       211 calls across 4 tools" },
      { kind: "h", text: "6. Turn on enforcement" },
      { kind: "p", text: "When you are ready, change mode to enforce. Policy holds and vetoes become real, and irreversibility budgets start counting." },
      { kind: "code", label: "agent.ts", text: 'const tools = void_.wrap(myTools, {\n  mode: "enforce",\n  policy: "./void.policy.ts",\n  budget: { irreversible: 2 },\n  ledger: { sink: "s3://acme-void-ledger", sign: true },\n});' },
      { kind: "h", text: "Next" },
      { kind: "list", items: ["Read the policy language reference to write your first rules.", "Read the ledger format if you need to export for an audit.", "Read the specification for the full event model."] },
    ],
  },
  {
    slug: "policy",
    title: "Policy language",
    summary: "Rules that decide allow, hold or veto, plus budgets and preconditions.",
    minutes: "12 min",
    group: "Reference",
    blocks: [
      { kind: "p", text: "A policy is an ordinary module, not a DSL. It exports a default policy object, it is type checked by your own toolchain, and it can import whatever it needs. Rules are evaluated in order and the first match decides." },
      { kind: "h", text: "Shape" },
      { kind: "code", label: "void.policy.ts", text: 'import { policy, R } from "@void/policy";\n\nexport default policy({\n  skip: (call) => call.effect === "read",\n  rules: [ /* ... */ ],\n  budget: { irreversible: { perAgentPerDay: 2 }, onExhausted: "read_only" },\n});' },
      { kind: "h", text: "The call object" },
      {
        kind: "table",
        head: ["field", "type", "meaning"],
        rows: [
          ["call.tool", "string", "fully qualified tool id, for example stripe.refunds.create"],
          ["call.effect", "read | write", "computed from the adapter's tool map"],
          ["call.class", "R0 | R1 | R2 | R3", "reversibility class computed at preflight"],
          ["call.domain", "string", "logical grouping, for example payments or crm"],
          ["call.records", "number", "estimated records affected"],
          ["call.systems", "string[]", "systems the call will change"],
          ["call.agent", "string", "agent identity that made the call"],
          ["call.args", "object", "the arguments, after redaction"],
        ],
      },
      { kind: "h", text: "Decisions" },
      {
        kind: "list",
        items: [
          "allow: forward the call, record it, keep the compensation plan.",
          "hold: pause and require an approver. The call is never sent until a human decides.",
          "veto: refuse before the write. The agent receives a structured refusal it can reason about.",
        ],
      },
      { kind: "h", text: "Preconditions" },
      { kind: "p", text: "A rule can require something to be true before allowing the call. The most common precondition is a captured snapshot, which turns an otherwise risky bulk update into an R0." },
      { kind: "code", label: "void.policy.ts", text: '{\n  when: (call) => call.records > 100 && call.class <= R.R1,\n  then: "allow",\n  require: ["snapshot"],\n  reason: "wide write, snapshot first",\n}' },
      { kind: "h", text: "Budgets" },
      { kind: "code", label: "void.policy.ts", text: 'budget: {\n  irreversible: {\n    perAgentPerDay: 2,\n    perWorkspacePerDay: 8,\n    // optional: a different cap for a specific agent\n    overrides: { "growth-outbound": 6 },\n  },\n  onExhausted: "read_only",   // or hold_for_human, veto\n}' },
      { kind: "note", text: "Budgets are enforced at preflight, so an agent never discovers it is out of budget halfway through a multi step write." },
      { kind: "h", text: "Testing a policy" },
      { kind: "code", label: "shell", text: "$ void policy test --fixtures ./fixtures\n  + 42 fixtures, 42 decisions matched expectations\n  + 0 rules unreachable\n  ! rule 'bulk external send' never matched in fixtures" },
    ],
  },
  {
    slug: "ledger",
    title: "Ledger format",
    summary: "Entry shape, the hash chain, signatures and offline verification.",
    minutes: "9 min",
    group: "Reference",
    blocks: [
      { kind: "p", text: "The ledger is append only, hash chained and signed per workspace. It is the undo stack and the compliance record in one object, which is the whole point: an undo stack nobody trusts is not a record, and a record you cannot execute is not an undo stack." },
      { kind: "h", text: "Entry" },
      { kind: "code", label: "entry.json", text: '{\n  "sequence": 1042,\n  "workspace": "acme",\n  "agent": "billing-ops",\n  "timestamp": "2026-08-21T09:14:11.204Z",\n  "intent": "issue_refund",\n  "tool": "stripe.refunds.create",\n  "payload_digest": "sha256:7d19..c4b2",\n  "blast_radius": { "systems": ["payments", "ledger", "mail"], "records": 3 },\n  "class": "R3",\n  "policy": { "decision": "hold", "rule": "irreversible transfer" },\n  "approved_by": "dana@acme.example",\n  "result": { "status": "ok", "external_id": "re_3P9k" },\n  "snapshot": null,\n  "compensation": null,\n  "budget_entry": "r3:2026-08-21:1of2",\n  "prev_hash": "0x9f3c..77d1",\n  "hash": "0xa10e..3b08",\n  "signature": "ed25519:5f21..ee90"\n}' },
      { kind: "h", text: "The chain" },
      { kind: "p", text: "hash = sha256(canonical_json(entry without hash and signature) || prev_hash). The signature covers the hash. Removing an entry breaks every hash after it, and forging a replacement chain requires the workspace key." },
      { kind: "h", text: "Verification" },
      { kind: "code", label: "shell", text: "$ void verify ./export.jsonl --key pk.pem\n  + 18422 entries, chain intact\n  + 18422 signatures valid\n  + 0 gaps detected\n  + head 0xa10e..3b08 matches manifest" },
      { kind: "note", text: "Verification is offline by design. An auditor needs the export file, the public key and the verifier binary. No network access to VOID is required." },
      { kind: "h", text: "Compensation entries" },
      { kind: "p", text: "A replay writes its own entries, so rewinding is itself auditable. A compensation entry references the sequence number it reverses." },
      { kind: "code", label: "compensation.json", text: '{\n  "sequence": 1103,\n  "kind": "compensation",\n  "reverses": 1039,\n  "class": "R0",\n  "action": "restore(sha256:4c2e..91af)",\n  "result": { "status": "ok", "digest_match": true },\n  "operator": "dana@acme.example",\n  "prev_hash": "0xbb41..09c2",\n  "hash": "0xcc77..1d40",\n  "signature": "ed25519:9a03..7fb1"\n}' },
      { kind: "h", text: "Sinks" },
      {
        kind: "table",
        head: ["sink", "durability", "use"],
        rows: [
          ["file://", "local disk", "development and shadow mode"],
          ["s3:// or gs://", "object storage with object lock", "production, recommended"],
          ["postgres://", "append only table with a trigger", "when you already run Postgres and want SQL access"],
          ["stdout", "none", "piping into your own pipeline"],
        ],
      },
    ],
  },
  {
    slug: "mcp-proxy",
    title: "MCP proxy",
    summary: "Run VOID at the transport level with no framework support at all.",
    minutes: "7 min",
    group: "Deployment",
    blocks: [
      { kind: "p", text: "The proxy terminates the MCP transport, classifies every advertised tool on connect, and forwards a call only after policy allows it. Your agent points at VOID instead of the upstream server, and nothing else changes." },
      { kind: "h", text: "Configure" },
      { kind: "code", label: "void.config.toml", text: '[proxy]\nlisten = "127.0.0.1:8787"\nupstream = ["mcp://stripe", "mcp://hubspot", "mcp://gmail"]\n\n[policy]\nfile = "./void.policy.ts"\nbudget.irreversible = 2\n\n[ledger]\nsink = "s3://acme-void-ledger"\nsign = true' },
      { kind: "h", text: "Run" },
      { kind: "code", label: "shell", text: "$ void proxy --config void.config.toml\n  + listening on 127.0.0.1:8787\n  + upstream stripe    12 tools, 9 with inverses\n  + upstream hubspot   17 tools, 16 with inverses\n  + upstream gmail      8 tools, 5 with inverses\n  ! 7 tools classified R3, budget applies" },
      { kind: "h", text: "Point your agent at it" },
      { kind: "code", label: "client.json", text: '{\n  "mcpServers": {\n    "void": { "url": "http://127.0.0.1:8787" }\n  }\n}' },
      {
        kind: "list",
        items: [
          "Streaming tool responses pass through without buffering the whole payload.",
          "Tool discovery classifies on connect, so classes exist before the first call.",
          "A vetoed call returns a structured refusal the agent can reason about, not a transport error.",
        ],
      },
    ],
  },
  {
    slug: "adapters",
    title: "Writing an adapter",
    summary: "Teach VOID the inverses for a tool it does not know yet.",
    minutes: "11 min",
    group: "Deployment",
    blocks: [
      { kind: "p", text: "An adapter maps tool calls to classes, snapshots and inverses. Shipping one is the difference between a tool being R3 by default and being properly reversible." },
      { kind: "h", text: "Minimal adapter" },
      { kind: "code", label: "adapters/acme.ts", text: 'import { adapter, R } from "@void/sdk";\n\nexport default adapter({\n  id: "acme",\n  tools: {\n    "acme.record.update": {\n      effect: "write",\n      class: R.R0,\n      blastRadius: (args) => ({ systems: ["acme"], records: 1 }),\n      snapshot: async (args, ctx) => ctx.client.get(args.id),\n      inverse: (before) => ({ tool: "acme.record.update", args: before }),\n    },\n    "acme.record.delete": {\n      effect: "write",\n      class: R.R1,\n      snapshot: async (args, ctx) => ctx.client.get(args.id),\n      inverse: (before) => ({ tool: "acme.record.create", args: before }),\n    },\n    "acme.payout.send": {\n      effect: "write",\n      class: R.R3,\n      inverse: null,\n      reason: "settles to an external bank",\n    },\n  },\n});' },
      { kind: "h", text: "Rules of thumb" },
      {
        kind: "list",
        items: [
          "If you cannot write the inverse, the class is R2 or R3. Do not guess.",
          "A snapshot that cannot be verified by digest is not a snapshot.",
          "Blast radius should sample for bulk operations rather than enumerate.",
          "Prefer the narrowest API scope that still supports the inverse.",
        ],
      },
      { kind: "h", text: "Testing" },
      { kind: "code", label: "shell", text: "$ void adapter test ./adapters/acme.ts\n  + 3 tools declared\n  + 2 inverses execute against the sandbox\n  + 2 snapshots verify by digest\n  ! acme.payout.send has no inverse, class R3 (expected)" },
      { kind: "note", text: "Adapters run inside your process in SDK mode and inside the proxy in transport mode. They never phone home." },
    ],
  },
];

function renderBlock(block: Block, index: number) {
  switch (block.kind) {
    case "h":
      return (
        <h3 key={index} id={block.text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}>
          {block.text}
        </h3>
      );
    case "code":
      return (
        <div key={index} style={{ margin: "18px 0" }}>
          <CodeBlock code={block.text} label={block.label} />
        </div>
      );
    case "list":
      return (
        <ul key={index}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "note":
      return (
        <div key={index} className="note-box">
          <Icon name="info" size={16} />
          <span>{block.text}</span>
        </div>
      );
    case "table":
      return (
        <div key={index} className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th key={cell}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cellIndex === 0 ? <code>{cell}</code> : cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return <p key={index}>{block.text}</p>;
  }
}

function DocsNav({ current }: { current: string }) {
  const groups = Array.from(new Set(docs.map((doc) => doc.group)));
  return (
    <nav className="docs-nav" aria-label="Documentation">
      {groups.map((group) => (
        <div className="docs-nav-group" key={group}>
          <h4
            style={{
              margin: "0 0 8px",
              fontFamily: "var(--font-code)",
              fontSize: 10.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
            }}
          >
            {group}
          </h4>
          {docs
            .filter((doc) => doc.group === group)
            .map((doc) => (
              <Link
                key={doc.slug}
                href={`/docs/${doc.slug}`}
                className={current === doc.slug ? "is-active" : ""}
                data-testid={`link-doc-${doc.slug}`}
              >
                {doc.title}
                <span className="mono" style={{ fontSize: 10 }}>
                  {doc.minutes}
                </span>
              </Link>
            ))}
        </div>
      ))}
    </nav>
  );
}

export default function DocsPage() {
  const [, params] = useRoute("/docs/:slug");
  const slug = params?.slug ?? "quickstart";
  const doc = docs.find((entry) => entry.slug === slug) ?? docs[0];
  const position = docs.indexOf(doc);
  const next = docs[position + 1];

  usePageMeta(`${doc.title}, VOID docs`, doc.summary, `/docs/${doc.slug}`);

  return (
    <>
      <PageHero
        kicker={`DOCS / ${doc.group.toUpperCase()}`}
        title={doc.title}
        copy={doc.summary}
        meta={[doc.minutes, `${docs.length} pages`, "updated 2026-08-14"]}
      />

      <div className="docs-shell">
        <DocsNav current={doc.slug} />

        <Reveal>
          <article className="prose" key={doc.slug}>
            {doc.blocks.map(renderBlock)}
            <hr />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link href="/spec" className="link-arrow" data-testid="link-docs-spec">
                Read the full specification
                <Icon name="arrowUpRight" size={15} />
              </Link>
              {next && (
                <Link href={`/docs/${next.slug}`} className="btn btn-ghost btn-sm" data-testid="link-docs-next">
                  Next: {next.title}
                  <Icon name="arrow" size={14} />
                </Link>
              )}
            </div>
          </article>
        </Reveal>
      </div>
    </>
  );
}
