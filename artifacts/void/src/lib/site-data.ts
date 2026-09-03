/**
 * Single source of truth for every piece of site content.
 * Sections, subpages and the Czech mutation all read from here.
 */

export type Tone = "r0" | "r1" | "r2" | "r3";

export const toneVar: Record<Tone, string> = {
  r0: "var(--ok)",
  r1: "var(--info)",
  r2: "var(--warn)",
  r3: "var(--bad)",
};

export const toneName: Record<Tone, string> = {
  r0: "fully reversible",
  r1: "reversible with trace",
  r2: "mitigable only",
  r3: "irreversible",
};

/* -------------------------------------------------------------------------- */
/* Replay demo data                                                           */
/* -------------------------------------------------------------------------- */

export type LedgerAction = {
  time: string;
  label: string;
  tone: Tone;
  system: "CRM" | "MAIL" | "LEDGER";
  before: string;
  after: string;
  field: string;
  note: string;
};

export const actions: LedgerAction[] = [
  { time: "09:02", label: "contact.read", tone: "r0", system: "CRM", field: "acct.9182.stage", before: "qualified", after: "qualified", note: "read only, nothing to compensate" },
  { time: "09:04", label: "field.update", tone: "r0", system: "CRM", field: "acct.9182.owner", before: "dana@", after: "agent.billing", note: "snapshot captured, exact restore available" },
  { time: "09:06", label: "ticket.create", tone: "r1", system: "CRM", field: "ticket.44120", before: "none", after: "open, p2", note: "deletable, but the create was visible to the customer" },
  { time: "09:08", label: "refund.issue", tone: "r2", system: "LEDGER", field: "ch_3P9k.state", before: "captured", after: "refunded", note: "money left, a reversal entry is the best available inverse" },
  { time: "09:11", label: "hold.book", tone: "r0", system: "MAIL", field: "cal.hold.3", before: "0 holds", after: "3 holds", note: "calendar holds cancel cleanly" },
  { time: "09:14", label: "payout.move", tone: "r3", system: "LEDGER", field: "payout.8841", before: "pending", after: "settled", note: "settled to an external bank, no inverse exists" },
  { time: "09:17", label: "email.send", tone: "r2", system: "MAIL", field: "msg.71c2", before: "draft", after: "delivered", note: "cannot unsend, VOID retracts and notifies" },
  { time: "09:21", label: "field.restore", tone: "r0", system: "CRM", field: "acct.9182.tier", before: "growth", after: "enterprise", note: "snapshot restore, exact prior state" },
  { time: "09:24", label: "case.close", tone: "r1", system: "CRM", field: "case.7781", before: "open", after: "closed", note: "reopen restores state, the close was logged" },
  { time: "09:27", label: "note.append", tone: "r0", system: "CRM", field: "acct.9182.notes", before: "12 notes", after: "13 notes", note: "append only, the inverse is a delete by id" },
  { time: "09:31", label: "invoice.void", tone: "r2", system: "LEDGER", field: "inv.2291", before: "issued", after: "void", note: "re-issue is possible, the void number is permanent" },
  { time: "09:35", label: "hold.cancel", tone: "r0", system: "MAIL", field: "cal.hold.3", before: "3 holds", after: "0 holds", note: "re-booking restores the exact slots" },
  { time: "09:38", label: "record.patch", tone: "r1", system: "CRM", field: "acct.9182.address", before: "Praha 8", after: "Praha 1", note: "patch reversed from the before snapshot" },
  { time: "09:42", label: "ledger.seal", tone: "r0", system: "LEDGER", field: "chain.head", before: "0x9f3c", after: "0xa10e", note: "sealing is idempotent, the chain keeps both heads" },
];

export const systems = ["CRM", "MAIL", "LEDGER"] as const;

/* -------------------------------------------------------------------------- */
/* Mechanisms                                                                 */
/* -------------------------------------------------------------------------- */

export type Mechanism = {
  id: string;
  name: string;
  body: string;
  meta: string;
  icon: string;
  /** A pictogram drawn on the same character grid as everything else. */
  art: string;
};

export const mechanisms: Mechanism[] = [
  {
    id: "interceptor",
    name: "Interceptor",
    body: "Drop in front of any tool surface: MCP servers, HTTP tools, function calling, your own SDK. One line of config, no change to the agent loop.",
    meta: "MCP / SDK / HTTP / CLI",
    icon: "plug",
    art: "  +----+  \n  | <> |  \n  +--+--+  \n     |     "
  },
  {
    id: "preflight",
    name: "Preflight",
    body: "Before a call commits, VOID computes its blast radius: which systems change, how many records, which fields, and the reversibility class. Policy allows, holds or vetoes.",
    meta: "8 to 40ms added latency",
    icon: "radar",
    art: "  .----.  \n /  /\\  \\ \n|  /  \\  |\n \\______ /"
  },
  {
    id: "shadow",
    name: "Shadow run",
    body: "Preflight does not estimate the blast radius, it measures it. The call runs against a twin first: the predicate as a counting SELECT in a transaction VOID aborts, the segment resolved without a send, the prefix listed key by key. The number you approve against is a fact.",
    meta: "measured, not estimated",
    icon: "layers",
    art: "  +---+   \n  | # |   \n  +---+   \n  : ? :   \n  '- -'   "
  },
  {
    id: "hold",
    name: "Hold queue",
    body: "A third state next to allow and deny. The call goes into a countdown, the agent gets a provisional receipt and keeps working, and the action commits when the timer runs out unless somebody cancels it. Cancelling takes every action that consumed the provisional result with it.",
    meta: "30 to 900s, cascading cancel",
    icon: "clock",
    art: "  --| |-- \n    | |   \n   [0:42] \n    | |   "
  },
  {
    id: "compensation",
    name: "Compensation compiler",
    body: "For every intercepted call, VOID synthesizes the inverse action and captures a before snapshot. Create becomes delete, update becomes restore, commit becomes revert.",
    meta: "inverse + snapshot per call",
    icon: "undo",
    art: "  [ + ]   \n   | |    \n  [ - ]   \n   | |    \n  { 0 }   "
  },
  {
    id: "ledger",
    name: "Saga ledger",
    body: "An append only, hash chained, signed record of intent, payload, result, snapshot and compensation plan. The undo stack and the compliance record are the same object.",
    meta: "ed25519 signed, append only",
    icon: "chain",
    art: "  #==#==# \n  |  |  | \n  #==#==# \n    \\_|_  "
  },
  {
    id: "scrubber",
    name: "Time scrubber",
    body: "Pick a moment. VOID replays compensations in LIFO order across every connected system and shows you, live, what came back and what did not.",
    meta: "LIFO replay, cross system",
    icon: "rewind",
    art: "  o---o---o\n      ^    \n  o---o---o\n  <  time  >"
  },
  {
    id: "taint",
    name: "Taint graph",
    body: "One agent writes a field, a second reads it and issues a refund, a third reads it and mails a thousand customers. Undoing the first means finding the other two. VOID tracks which action consumed which result, across agents and across hours, so a compensation knows its own true scope.",
    meta: "cross agent, cross session",
    icon: "git",
    art: "    o     \n   / \\    \n  o   o   \n  |    \\  \n  o     o "
  },
  {
    id: "budget",
    name: "Irreversibility budget",
    body: "Each agent gets a daily allowance of irreversible action. Spend it and the agent drops to read only until a human tops it up. Autonomy becomes a metered resource.",
    meta: "per agent, per day",
    icon: "gauge",
    art: "  [###]   \n  [## ]   \n  [#  ]   \n  [0  ]   "
  },
];

/* -------------------------------------------------------------------------- */
/* Install snippets                                                           */
/* -------------------------------------------------------------------------- */

export const codeSamples: Record<string, string> = {
  MCP: `# void.config.toml
[proxy]
listen = "127.0.0.1:8787"
upstream = ["mcp://stripe", "mcp://hubspot", "mcp://gmail"]

[policy]
file = "./void.policy.ts"
budget.irreversible = 2

[ledger]
sink = "s3://acme-void-ledger"
sign = true`,
  TypeScript: `import { void_ } from "@void/sdk";

const tools = void_.wrap(myTools, {
  policy: "./void.policy.ts",
  budget: { irreversible: 2 },   // per agent, per day
  ledger: { sink: "s3://acme-void-ledger", sign: true },
});

// the agent loop does not change
const agent = createAgent({ tools });`,
  Python: `from void import wrap

tools = wrap(
    my_tools,
    policy="./void.policy.py",
    budget={"irreversible": 2},   # per agent, per day
    ledger={"sink": "s3://acme-void-ledger", "sign": True},
)

agent = Agent(tools=tools)`,
  CLI: `$ npx void init
$ void watch --agent billing-ops
$ void classify --tool stripe.refunds.create
$ void rewind --to 09:12:00 --dry-run
$ void export --format aiact-a12 --since 30d`,
};

/* -------------------------------------------------------------------------- */
/* Reversibility classes                                                      */
/* -------------------------------------------------------------------------- */

export type ClassRow = {
  id: Tone;
  title: string;
  subtitle: string;
  body: string;
  stores: string;
  compensation: string;
  examples: string[];
};

export const classRows: ClassRow[] = [
  {
    id: "r0",
    title: "R0",
    subtitle: "fully reversible",
    body: "The prior state is recoverable byte for byte. VOID captures a snapshot before the write and can restore it without anyone outside the system noticing.",
    stores: "full before snapshot, field level diff, restore token",
    compensation: "restore(snapshot_id)",
    examples: ["CRM field update", "database row patch", "S3 object overwrite with versioning", "calendar hold"],
  },
  {
    id: "r1",
    title: "R1",
    subtitle: "reversible with trace",
    body: "The state comes back, but the change was observable while it existed. A created ticket can be deleted, yet somebody may have already seen it in a queue.",
    stores: "created entity ids, visibility window, observer log",
    compensation: "delete(entity_id) + trace_note",
    examples: ["ticket create", "issue open", "webhook fired to an internal consumer", "case close"],
  },
  {
    id: "r2",
    title: "R2",
    subtitle: "mitigable only",
    body: "There is no true inverse. The best available action reduces the damage and informs the affected party. VOID performs the mitigation and records that it was a mitigation, not an undo.",
    stores: "recipient list, message id, mitigation receipt",
    compensation: "retract() + notify(recipients)",
    examples: ["email sent to an external address", "refund issued", "invoice voided", "Slack message to a shared channel"],
  },
  {
    id: "r3",
    title: "R3",
    subtitle: "irreversible",
    body: "Money left the perimeter, data was destroyed, or an external system committed something you do not control. VOID cannot undo it, so it spends budget, demands approval and files the evidence.",
    stores: "full intent, approver identity, evidence bundle, budget entry",
    compensation: "none, budget consumed",
    examples: ["payout settled to an external bank", "hard delete without soft delete", "physical shipment dispatched", "key rotation on a third party"],
  },
];

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

export const faqs: [string, string][] = [
  [
    "What happens when an action genuinely cannot be undone?",
    "It is classified R3 before the call, not after. VOID requires the policy to allow it, spends from the agent's daily irreversibility budget, captures an evidence bundle including the approver identity, and marks the ledger entry as terminal. During a replay, R3 rows print a line saying they could not be reversed, with the reason and the budget entry that paid for them.",
  ],
  [
    "Does VOID slow my agents down?",
    "Preflight adds 8 to 40ms depending on how many systems the call touches. Commits are not blocked unless your policy says hold or veto. Snapshot capture happens in parallel with the call in most adapters, and read only calls skip the pipeline entirely.",
  ],
  [
    "Do you see my payloads?",
    "In self hosted mode nothing leaves your infrastructure: the interceptor, policy engine and ledger all run in your VPC. In managed mode you configure field level redaction before anything enters the ledger, and the signing keys stay in your KMS. VOID cannot replay what it cannot read, and that is a deliberate trade you control per tool.",
  ],
  [
    "Which frameworks are supported?",
    "Anything that calls tools. There are first class adapters for LangGraph, CrewAI, the OpenAI Agents SDK, the Claude Agent SDK and plain function calling loops. The MCP proxy shape works without any framework support at all, because it sits at the transport level.",
  ],
  [
    "What if a tool has no API to reverse a change?",
    "Then it is R2 or R3, and VOID says so before the agent acts. The compensation compiler will not invent an inverse it cannot execute. You get a mitigation plan where one exists, and a budget line where it does not.",
  ],
  [
    "How is this different from database transactions?",
    "A transaction protects one system for the duration of one unit of work. An agent touches a CRM, a payment processor, a mailbox and a warehouse in a single reasoning turn, and each of those commits independently. VOID is a saga layer over that: per call compensation, cross system LIFO replay, and a record of what could not be rolled back.",
  ],
  [
    "How is this different from tracing tools?",
    "Tracing tells you what happened. VOID changes what can happen and gives you a way back. The two compose well: keep your traces for debugging behaviour, use VOID for the write path and the record you have to defend.",
  ],
  [
    "Can I run it in shadow mode first?",
    "That is the recommended first week. Shadow mode records intent, computes classes and builds compensation plans without holding anything. You get a report of what would have been vetoed and how much irreversible action your agents actually take, before a single policy is enforced.",
  ],
];

/* -------------------------------------------------------------------------- */
/* Integration targets                                                        */
/* -------------------------------------------------------------------------- */

export const integrations = [
  "Stripe", "HubSpot", "Salesforce", "Gmail", "Slack", "Postgres", "GitHub",
  "S3", "Zendesk", "Twilio", "Notion", "Linear", "Snowflake", "Kubernetes",
  "Shopify", "Jira", "MongoDB", "Terraform",
];

/* -------------------------------------------------------------------------- */
/* Rollout                                                                    */
/* -------------------------------------------------------------------------- */

export const rollout = [
  { n: "01", week: "week 1", title: "Shadow", body: "Record intent and compute classes without holding anything. At the end of the week you have a real number for how much irreversible action your agents take.", progress: 25 },
  { n: "02", week: "week 2", title: "Preflight", body: "Turn on classification and warnings. Agents keep running, platform sees blast radius per call, and the first policy drafts write themselves from the data.", progress: 50 },
  { n: "03", week: "week 3", title: "Compensate", body: "Enable undo. Compensation plans are generated and tested against a staging copy, and the time scrubber becomes usable on real incidents.", progress: 75 },
  { n: "04", week: "week 4", title: "Enforce", body: "Policy holds and vetoes go live, irreversibility budgets are assigned per agent, and the signed ledger becomes the record your risk team signs off on.", progress: 100 },
];

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

export const plans = [
  {
    id: "dev",
    name: "Dev",
    price: "free",
    unit: "",
    volume: "10k protected actions / month",
    featured: false,
    features: ["community support", "local file ledger", "shadow mode", "all adapters", "1 workspace"],
    cta: "start free",
  },
  {
    id: "team",
    name: "Team",
    price: "490",
    unit: "EUR / month",
    volume: "1M protected actions / month",
    featured: true,
    features: ["SSO and policy controls", "signed ledger export", "8h support response", "irreversibility budgets", "unlimited workspaces", "AI Act Article 12 style export"],
    cta: "request access",
  },
  {
    id: "self",
    name: "Self hosted",
    price: "custom",
    unit: "",
    volume: "your infra, your keys",
    featured: false,
    features: ["no data leaves your VPC", "bring your own KMS", "audit support", "air-gapped option", "dedicated onboarding"],
    cta: "talk to us",
  },
];

export const compareRows: string[][] = [
  ["Reverses writes", "yes", "no", "no", "partial"],
  ["Pre commit veto", "yes", "no", "yes", "partial"],
  ["Signed record", "yes", "partial", "no", "partial"],
  ["Cross system replay", "yes", "no", "no", "no"],
  ["Blast radius before the call", "yes", "no", "partial", "no"],
  ["Metered irreversibility", "yes", "no", "no", "no"],
  ["Time to value", "1 day", "1 day", "3 days", "2 quarters"],
];

/* -------------------------------------------------------------------------- */
/* Field notes                                                                */
/* -------------------------------------------------------------------------- */

export const quotes = [
  {
    text: "Our agents were fine 99 percent of the time. VOID is for the other 1 percent, and it is the only reason legal let us go past shadow mode.",
    who: "Head of Platform",
    ctx: "Series B fintech, 40 agents in production",
  },
  {
    text: "The budget changed the conversation. Autonomy stopped being a yes or no argument and became a number we tune every sprint.",
    who: "Staff Engineer",
    ctx: "internal automation, 18 agents",
  },
  {
    text: "We used to answer the auditor with a folder of JSON. Now we hand over one signed chain and they stop asking follow ups.",
    who: "Compliance Lead",
    ctx: "health operations, 7 agents",
  },
];

/* -------------------------------------------------------------------------- */
/* Explore grid                                                               */
/* -------------------------------------------------------------------------- */

export const exploreItems = [
  { label: "Registry", href: "/registry", tag: "open data", copy: "What undoes what, classified against the state of the target." },
  { label: "Attestation", href: "/attestation", tag: "evidence", copy: "Verify the hash chain in your own browser." },
  { label: "Docs", href: "/docs", tag: "guides", copy: "Quickstart, policy language, ledger format." },
  { label: "Spec", href: "/spec", tag: "technical", copy: "The full reversible autonomy model." },
  { label: "Pricing", href: "/pricing", tag: "commercial", copy: "Per protected action, with a calculator." },
  { label: "Security", href: "/security", tag: "trust", copy: "Data flow, redaction, key handling." },
  { label: "Compliance", href: "/compliance", tag: "governance", copy: "Article 12 style record keeping." },
  { label: "Changelog", href: "/changelog", tag: "product", copy: "What changed in the write path." },
  { label: "Blog", href: "/blog", tag: "writing", copy: "Notes on agent side effects." },
  { label: "Status", href: "/status", tag: "operations", copy: "Region health and uptime history." },
  { label: "Contact", href: "/contact", tag: "company", copy: "Talk to the team behind VOID." },
];

/* -------------------------------------------------------------------------- */
/* Telemetry charts                                                           */
/* -------------------------------------------------------------------------- */

export const coverageSeries = [
  { week: "w1", coverage: 41, shadow: 100 },
  { week: "w2", coverage: 47, shadow: 100 },
  { week: "w3", coverage: 56, shadow: 98 },
  { week: "w4", coverage: 58, shadow: 97 },
  { week: "w5", coverage: 63, shadow: 97 },
  { week: "w6", coverage: 66, shadow: 95 },
  { week: "w7", coverage: 69, shadow: 95 },
  { week: "w8", coverage: 71, shadow: 94 },
  { week: "w9", coverage: 72, shadow: 94 },
  { week: "w10", coverage: 73, shadow: 93 },
  { week: "w11", coverage: 74, shadow: 93 },
  { week: "w12", coverage: 76, shadow: 92 },
];

export const blastSeries = [
  { tool: "crm", records: 412, full: "crm.contact.update" },
  { tool: "mail", records: 168, full: "gmail.message.send" },
  { tool: "pg", records: 121, full: "pg.row.update" },
  { tool: "refund", records: 46, full: "stripe.refund.create" },
  { tool: "s3", records: 38, full: "s3.object.put" },
  { tool: "cal", records: 24, full: "cal.event.create" },
];

export const budgetAgents = [
  { agent: "billing-ops", spent: 2, cap: 2 },
  { agent: "support-triage", spent: 1, cap: 4 },
  { agent: "data-hygiene", spent: 0, cap: 3 },
  { agent: "growth-outbound", spent: 3, cap: 6 },
];

/* -------------------------------------------------------------------------- */
/* Compensation table for the spec page                                       */
/* -------------------------------------------------------------------------- */

export const compensationTable: [string, Tone, string, string][] = [
  ["crm.contact.update", "r0", "restore(snapshot)", "field level diff kept for 30 days"],
  ["crm.contact.create", "r1", "delete(id)", "creation visible in shared views"],
  ["crm.case.close", "r1", "reopen(id)", "close event stays in history"],
  ["pg.row.update", "r0", "restore(snapshot)", "requires row level before image"],
  ["pg.row.delete", "r1", "insert(snapshot)", "identity columns preserved"],
  ["pg.table.drop", "r3", "none", "backup restore is out of band"],
  ["s3.object.put", "r0", "restore(version)", "needs bucket versioning on"],
  ["s3.object.delete", "r0", "undelete(marker)", "delete markers must be retained"],
  ["stripe.refund.create", "r2", "reversal entry", "money already moved"],
  ["stripe.payout.create", "r3", "none", "settles to an external bank"],
  ["gmail.message.send", "r2", "retract + notify", "external recipients cannot unsee"],
  ["gmail.draft.create", "r0", "delete(id)", "never left the account"],
  ["cal.event.create", "r0", "cancel(id)", "attendees receive a cancellation"],
  ["slack.message.post", "r2", "delete + notice", "channel members may have read it"],
  ["github.pr.merge", "r1", "revert commit", "history keeps both commits"],
  ["github.repo.delete", "r3", "none", "cannot be recreated with the same identity"],
  ["zendesk.ticket.create", "r1", "delete(id)", "queue exposure recorded"],
  ["twilio.sms.send", "r3", "none", "delivered to a handset"],
  ["k8s.deploy.apply", "r0", "rollout undo", "previous revision retained"],
  ["k8s.namespace.delete", "r3", "none", "stateful volumes are gone"],
];

/* -------------------------------------------------------------------------- */
/* Changelog                                                                  */
/* -------------------------------------------------------------------------- */

export const changelog = [
  {
    version: "0.9.0",
    date: "2026-08-14",
    title: "Irreversibility budgets, per agent",
    tag: "feature",
    items: [
      "Budgets can now be set per agent, per day, and per class, instead of only globally.",
      "Agents that exhaust their budget drop to read only and emit a policy event instead of failing the tool call.",
      "New CLI: void budget show --agent billing-ops.",
    ],
  },
  {
    version: "0.8.3",
    date: "2026-07-29",
    title: "Faster preflight on wide writes",
    tag: "performance",
    items: [
      "Blast radius estimation for bulk updates now samples instead of enumerating, cutting p95 preflight from 210ms to 34ms on 10k row updates.",
      "Snapshot capture moved off the request path for adapters that support point in time reads.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-07-02",
    title: "Article 12 style ledger export",
    tag: "compliance",
    items: [
      "New export format aligned with the AI Act Article 12 record keeping structure.",
      "Exports carry the hash chain, the signature, and a human readable summary per entry.",
      "Redaction rules are applied at export time as well as at write time.",
    ],
  },
  {
    version: "0.7.4",
    date: "2026-06-11",
    title: "MCP proxy reaches parity with the SDK",
    tag: "adapters",
    items: [
      "The MCP proxy now supports streaming tool responses without buffering the whole payload.",
      "Tool discovery classifies every advertised tool on connect, so classes are known before the first call.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-05-20",
    title: "Time scrubber, cross system replay",
    tag: "feature",
    items: [
      "Replay executes compensations in LIFO order across systems instead of per system.",
      "Dry run mode prints the full plan without executing anything.",
      "R3 rows are reported as terminal with their evidence bundle attached.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-04-30",
    title: "Private beta opens",
    tag: "milestone",
    items: [
      "First external design partners on the interceptor and the saga ledger.",
      "Policy language ships with allow, hold, veto and budget primitives.",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Blog                                                                       */
/* -------------------------------------------------------------------------- */

export type Post = {
  slug: string;
  title: string;
  date: string;
  read: string;
  tag: string;
  excerpt: string;
  body: { h?: string; p?: string; code?: string; list?: string[]; quote?: string }[];
};

export const posts: Post[] = [
  {
    slug: "undo-is-a-layer",
    title: "Undo is a layer, not a feature",
    date: "2026-08-20",
    read: "7 min",
    tag: "architecture",
    excerpt: "Every agent framework will eventually add a rollback helper. That is not the same as an undo layer, and the difference shows up the first time a single reasoning turn touches four systems.",
    body: [
      { p: "The saga pattern is forty years old. Compensating transactions are in every distributed systems textbook. So why does an agent that issues a refund, updates a CRM record and sends an email leave you with a manual cleanup ticket?" },
      { p: "Because the compensation logic lives inside whichever framework happened to make the call. Each framework owns its own retry semantics, its own error taxonomy, and its own idea of what a rollback means. None of them own the boundary where the write actually leaves your perimeter." },
      { h: "The boundary is the only honest place to stand" },
      { p: "A tool call is the moment intent becomes effect. Before it, everything is reversible because nothing has happened. After it, reversibility is a property of the target system, not of your code. That asymmetry is why undo has to sit at the boundary and not in the agent loop." },
      { code: "agent -> interceptor -> preflight -> policy -> tool\n                          |                       |\n                     blast radius            before snapshot\n                          |                       |\n                    class + budget  ->  compensation plan -> ledger" },
      { p: "Once you stand at the boundary, three things become possible that are not possible from inside a framework: you can classify reversibility before the call, you can capture a before image that the framework never sees, and you can replay across systems in the order that actually matters, which is last in, first out." },
      { h: "What a layer buys you that a helper does not" },
      { list: [
        "One record for every system, instead of one per framework.",
        "A veto that happens before the write, not an exception after it.",
        "Replay ordering that respects causality across tools.",
        "A budget that means something, because it counts every irreversible call, not the ones one framework knows about.",
      ] },
      { p: "The uncomfortable part is that a layer cannot promise everything is undoable. It can only promise you know which class you are in before the agent acts. In practice that turns out to be the more useful promise." },
    ],
  },
  {
    slug: "reversibility-classes",
    title: "Why we ship four classes and not a boolean",
    date: "2026-07-15",
    read: "6 min",
    tag: "design",
    excerpt: "Reversible or not reversible is the wrong question. The useful question is what it costs to get back, and who finds out that you tried.",
    body: [
      { p: "The first version of our classifier had two states. It lasted about a week in front of real traffic." },
      { p: "The problem is that a deleted draft and a sent email both fail a boolean test for undo, but they are nothing alike. One is a local operation nobody observed. The other reached a human inbox and the best you can do is apologise in a follow up." },
      { h: "The four classes" },
      { list: [
        "R0, fully reversible: the prior state comes back byte for byte and nobody outside the system could tell.",
        "R1, reversible with trace: state comes back, but the change was observable while it existed.",
        "R2, mitigable only: there is no inverse, only a way to reduce and disclose the damage.",
        "R3, irreversible: money moved, data was destroyed, or an external party committed. No path back.",
      ] },
      { p: "The classes are not a severity scale. R1 is not a milder R2. They describe different shapes of recovery, and they need different machinery: R0 needs a snapshot, R1 needs a visibility window, R2 needs a recipient list, R3 needs an approver and an evidence bundle." },
      { quote: "VOID does not promise everything is undoable. It promises you know which class you are in before the agent acts, and that R3 costs budget." },
      { p: "The classes also give budgets something to count. A daily allowance of two irreversible actions is a sentence a risk officer can read and an engineer can implement. A daily allowance of two non reversible operations, where nobody agrees what that means, is a meeting." },
    ],
  },
  {
    slug: "article-12-in-practice",
    title: "Article 12 in practice, for engineers",
    date: "2026-06-25",
    read: "9 min",
    tag: "compliance",
    excerpt: "The record keeping duty is short, vague and enforceable from August 2026. Here is what it actually asks of a system that lets agents write to production.",
    body: [
      { p: "Article 12 of the EU AI Act requires high risk systems to automatically record events over their lifetime, to a degree appropriate to the purpose of the system. That is the whole substance. Everything else is interpretation." },
      { p: "Interpretation is where engineering teams lose months, because the obvious answer, keep the logs, is both technically easy and legally weak. Unsigned application logs are mutable by anyone with write access, have no ordering guarantee across services, and cannot demonstrate that an entry existed at a given time." },
      { h: "What a defensible record needs" },
      { list: [
        "Ordering that survives a service being restarted or replaced.",
        "Tamper evidence, so a missing or edited entry is detectable rather than merely unlikely.",
        "Enough context to reconstruct why an action was taken, not only that it was.",
        "A retention story that matches the retention obligation, including redaction of personal data.",
      ] },
      { p: "A hash chained, signed ledger gives you the first two almost for free. Each entry references the hash of the previous one, so removing an entry breaks the chain, and the workspace signature makes forging a replacement chain require the key." },
      { code: "{\n  \"sequence\": 1042,\n  \"intent\": \"issue_refund\",\n  \"class\": \"R3\",\n  \"approved_by\": \"dana@acme.example\",\n  \"prev_hash\": \"0x9f3c...\",\n  \"signature\": \"ed25519:a10e...\"\n}" },
      { p: "The third point, context, is where the agent case differs from classic audit logging. A refund is not interesting on its own. It becomes interesting when you can see the intent that produced it, the blast radius that was computed, the policy decision, the human who approved, and whether a compensation was later executed." },
      { p: "This is informational and not legal advice. Talk to your counsel about how the duty applies to your deployment." },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Status page                                                                */
/* -------------------------------------------------------------------------- */

export const statusServices = [
  { name: "Interceptor, EU (Frankfurt)", uptime: "99.99%", state: "operational" },
  { name: "Interceptor, US (Virginia)", uptime: "99.98%", state: "operational" },
  { name: "Policy engine", uptime: "100%", state: "operational" },
  { name: "Saga ledger, write path", uptime: "99.99%", state: "operational" },
  { name: "Ledger export API", uptime: "99.95%", state: "operational" },
  { name: "Control plane and dashboard", uptime: "99.97%", state: "operational" },
];

/* -------------------------------------------------------------------------- */
/* Hold queue demo                                                            */
/* -------------------------------------------------------------------------- */

export type HeldAction = {
  id: string;
  label: string;
  tone: Tone;
  system: string;
  /** Remaining hold in seconds when the demo starts. */
  seconds: number;
  detail: string;
  /**
   * Actions that were issued against this one's provisional result. Cancelling
   * a held action has to take its dependents with it, which is the part that
   * makes a hold queue harder than a delay.
   */
  dependents: string[];
};

export const heldActions: HeldAction[] = [
  {
    id: "h1",
    label: "stripe.refund.create",
    tone: "r2",
    system: "LEDGER",
    seconds: 96,
    detail: "EUR 2,480.00 against ch_3P9k. The agent read a duplicate charge that turned out to be a captured authorisation and a capture, not two payments.",
    dependents: ["h2", "h3", "h4"],
  },
  {
    id: "h2",
    label: "gmail.message.send",
    tone: "r3",
    system: "MAIL",
    seconds: 74,
    detail: "Refund confirmation to the billing contact. Written against the provisional refund id, so it is only correct if the refund is released.",
    dependents: ["h4"],
  },
  {
    id: "h3",
    label: "crm.case.close",
    tone: "r1",
    system: "CRM",
    seconds: 52,
    detail: "Closes case 7781 as resolved by refund. Depends on the refund existing.",
    dependents: [],
  },
  {
    id: "h4",
    label: "slack.chat.postMessage",
    tone: "r2",
    system: "MAIL",
    seconds: 38,
    detail: "Posts the resolution summary to #billing-ops, quoting both the refund and the confirmation email.",
    dependents: [],
  },
];

/* -------------------------------------------------------------------------- */
/* Blast radius probes                                                        */
/* -------------------------------------------------------------------------- */

export type BlastProbe = {
  id: string;
  call: string;
  tone: Tone;
  statement: string;
  /** How the number was obtained. Never an estimate, always an execution. */
  method: string;
  rows: { target: string; count: number; note: string; tone: Tone }[];
  verdict: string;
  latency: string;
};

export const blastProbes: BlastProbe[] = [
  {
    id: "p1",
    call: "postgres.row.delete",
    tone: "r1",
    statement: "DELETE FROM orders WHERE status = 'draft' AND updated_at < now() - interval '90 days'",
    method: "The predicate runs as a counting SELECT inside a transaction VOID opens and aborts. Foreign keys are walked to find what cascades.",
    latency: "31ms",
    rows: [
      { target: "orders", count: 41883, note: "matched directly by the predicate", tone: "r0" },
      { target: "order_items", count: 6204, note: "reached through ON DELETE CASCADE, not in the statement", tone: "r0" },
      { target: "refund_queue", count: 114, note: "unprocessed refunds attached to draft orders, cascaded", tone: "r2" },
    ],
    verdict: "Held. The agent wrote a statement about orders and would have deleted 114 pending refunds it never mentioned.",
  },
  {
    id: "p2",
    call: "sendgrid.mail.send",
    tone: "r3",
    statement: "POST /v3/mail/send  segment: all-customers-eu  template: d-91f4",
    method: "The segment is resolved against the list API with no send, so the recipient count is exact rather than estimated from the last run.",
    latency: "182ms",
    rows: [
      { target: "recipients", count: 128400, note: "resolved from the segment at intercept time", tone: "r3" },
      { target: "unsubscribed", count: 2216, note: "suppression list applied, these are excluded", tone: "r0" },
      { target: "outside consent scope", count: 411, note: "no marketing consent recorded, a regulatory problem rather than a delivery one", tone: "r3" },
    ],
    verdict: "Vetoed. The agent's intent said a test send to a seed list. The segment it resolved was every customer in the EU.",
  },
  {
    id: "p3",
    call: "aws.s3.object.delete",
    tone: "r3",
    statement: "DeleteObjects  bucket: prod-exports  prefix: reports/2025/",
    method: "The prefix is listed with ListObjectsV2 and each key is probed for a noncurrent version, because versioning can be suspended after objects were written.",
    latency: "1.4s",
    rows: [
      { target: "objects with a prior version", count: 12901, note: "delete writes a marker, fully reversible", tone: "r0" },
      { target: "objects with no prior version", count: 3, note: "written while versioning was suspended, unrecoverable", tone: "r3" },
    ],
    verdict: "Held for approval. Three objects out of 12,904 turn a routine cleanup into an irreversible one, and the worst case in a batch is the class of the batch.",
  },
  {
    id: "p4",
    call: "salesforce.record.update",
    tone: "r2",
    statement: "PATCH /composite/sobjects/Contact  field: OwnerId  count: 412",
    method: "Each record is read before the write to capture a before image, which also reveals what else is attached to it.",
    latency: "640ms",
    rows: [
      { target: "contacts", count: 412, note: "before image captured, restore is exact", tone: "r0" },
      { target: "active email sequences", count: 38, note: "reassignment re-triggers sender identity on running sequences", tone: "r2" },
      { target: "open opportunities", count: 61, note: "forecast attribution moves with the owner", tone: "r1" },
    ],
    verdict: "Held. The field update is reversible. The 38 sequences that fire a new email on owner change are not.",
  },
];

/* -------------------------------------------------------------------------- */
/* Cross agent taint graph                                                    */
/* -------------------------------------------------------------------------- */

export type TaintNode = {
  id: string;
  agent: string;
  label: string;
  tone: Tone;
  at: string;
  detail: string;
  /** Nodes whose output this one consumed. */
  reads: string[];
  /** Layout, in grid units. */
  col: number;
  row: number;
};

export const taintAgents = ["support-triage", "billing-ops", "growth-outbound"] as const;

export const taintNodes: TaintNode[] = [
  { id: "t1", agent: "support-triage", label: "zendesk.ticket.read", tone: "r0", at: "09:02", detail: "Reads ticket 44120, a duplicate charge complaint.", reads: [], col: 0, row: 1 },
  { id: "t2", agent: "support-triage", label: "crm.contact.update", tone: "r0", at: "09:04", detail: "Sets acct.9182.billing_state to disputed. Fully reversible on its own, a before image is held.", reads: ["t1"], col: 1, row: 1 },
  { id: "t3", agent: "billing-ops", label: "crm.contact.read", tone: "r0", at: "09:19", detail: "Polls for accounts in a disputed billing state and picks up 9182.", reads: ["t2"], col: 2, row: 0 },
  { id: "t4", agent: "billing-ops", label: "stripe.refund.create", tone: "r2", at: "09:21", detail: "Refunds EUR 2,480.00 because the account is flagged disputed.", reads: ["t3"], col: 3, row: 0 },
  { id: "t5", agent: "billing-ops", label: "stripe.payout.create", tone: "r3", at: "09:24", detail: "Nightly settlement moves the adjusted balance to the external bank. No inverse exists once it settles.", reads: ["t4"], col: 4, row: 0 },
  { id: "t6", agent: "growth-outbound", label: "crm.segment.read", tone: "r0", at: "09:30", detail: "Builds a win-back segment and excludes accounts in a disputed state, so 9182 lands in a different branch than it should have.", reads: ["t2"], col: 2, row: 2 },
  { id: "t7", agent: "growth-outbound", label: "sendgrid.mail.send", tone: "r3", at: "09:31", detail: "Sends an apology and discount offer to 1,204 accounts including 9182.", reads: ["t6"], col: 3, row: 2 },
  { id: "t8", agent: "support-triage", label: "zendesk.ticket.solve", tone: "r1", at: "09:38", detail: "Marks 44120 solved, quoting the refund id.", reads: ["t4"], col: 4, row: 1 },
];

/* -------------------------------------------------------------------------- */
/* Compliance frames served by one ledger                                     */
/* -------------------------------------------------------------------------- */

export type Frame = {
  id: string;
  name: string;
  scope: string;
  applies: string;
  asks: string;
  /** Ledger fields that answer it. */
  fields: string[];
  /** What the ledger genuinely does not cover. Stated because every frame has one. */
  gap: string;
};

export const frames: Frame[] = [
  {
    id: "aiact",
    name: "EU AI Act, Article 12",
    scope: "High risk AI systems placed on the EU market",
    applies: "Annex III obligations apply from 2 August 2026. A delay to December 2027 was proposed through the Digital Omnibus and is in trilogue, not law.",
    asks: "Automatic recording of events over the lifetime of the system, at a level that lets a competent authority reconstruct what happened.",
    fields: ["intent", "agent identity", "tool identity", "timestamp", "policy decision", "approver identity", "chain link"],
    gap: "Article 12 is one obligation among many. Risk management, data governance and human oversight are not things a ledger can evidence on its own.",
  },
  {
    id: "soc2",
    name: "SOC 2, CC7 and CC8",
    scope: "Service organisations under a Trust Services audit",
    applies: "Continuously, once the control is in scope for your report",
    asks: "Evidence that changes are authorised and that anomalies are detected and responded to.",
    fields: ["policy decision", "approver identity", "before snapshot reference", "compensation plan", "replay record"],
    gap: "An auditor tests the operation of the control, not the existence of a log. The ledger is the evidence, your process is the control.",
  },
  {
    id: "dora",
    name: "DORA, ICT risk and incident records",
    scope: "EU financial entities and their critical ICT providers",
    applies: "In force since 17 January 2025",
    asks: "Records of ICT related incidents and the ability to reconstruct and report them within defined windows.",
    fields: ["timestamp", "blast radius", "class", "compensation outcome", "chain link"],
    gap: "Reporting timelines, third party register and resilience testing sit outside anything a write path log produces.",
  },
  {
    id: "nis2",
    name: "NIS2, incident handling",
    scope: "Essential and important entities in the EU",
    applies: "Transposed into national law, with dates varying by member state",
    asks: "Logging sufficient to detect, handle and report significant incidents.",
    fields: ["agent identity", "tool identity", "policy decision", "blast radius", "replay record"],
    gap: "Scope is set by national transposition, so what counts as significant is not something the ledger can decide for you.",
  },
  {
    id: "iso42001",
    name: "ISO/IEC 42001",
    scope: "Organisations running an AI management system",
    applies: "On certification, and on each surveillance audit",
    asks: "Documented records of AI system operation, including controls over automated decisions and their effects.",
    fields: ["intent", "class", "budget entry", "approver identity", "compensation plan"],
    gap: "A management system is policy, roles and review cycles. The ledger evidences the operating layer underneath it.",
  },
];
