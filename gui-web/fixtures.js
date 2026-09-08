// MOCK fixtures only. Nothing here came from a live session.
window.VOID_FIXTURES = {
  session: { id: "sess-demo-01", agent: "demo-agent", started: "2026-09-08T08:00:00Z" },
  calls: [
    { t: "08:00:11", tool: "fs.read", target: "/repo/README.md", cls: "R0", decision: "forward", blast: 1, note: "Read returns prior state untouched, inverse is trivial." },
    { t: "08:01:02", tool: "fs.write", target: "/repo/notes.txt", cls: "R1", decision: "forward", blast: 1, note: "Overwrite with snapshot kept, replay restores exact bytes." },
    { t: "08:02:44", tool: "db.query", target: "UPDATE users SET plan", cls: "R1", decision: "forward", blast: 3, note: "Row count measured in aborted transaction, 3 rows matched." },
    { t: "08:03:19", tool: "s3.put", target: "s3://assets/logo.png", cls: "R2", decision: "hold", blast: 1, note: "Versioning off, compensation is delete of the new version." },
    { t: "08:04:57", tool: "net.fetch", target: "https://api.vendor/v1/send", cls: "R3", decision: "hold", blast: 120, note: "External send has no inverse, held for human decision." },
    { t: "08:05:31", tool: "fs.delete", target: "/tmp/cache/a.json", cls: "R0", decision: "forward", blast: 1, note: "Cache delete, inverse recreates identical content." },
    { t: "08:06:08", tool: "db.query", target: "DELETE FROM events", cls: "R2", decision: "hold", blast: 42, note: "Delete without versioning, compensation restores from snapshot." },
    { t: "08:07:52", tool: "s3.put", target: "s3://backups/dump.sql", cls: "R1", decision: "forward", blast: 1, note: "Bucket versioning enabled, prior version restores exactly." }
  ],
  holds: [
    { id: "hold-101", tool: "s3.put", target: "s3://assets/logo.png", cls: "R2", blast: 1, reason: "No versioning, confirm compensation.", requested: "08:03:19", status: "pending" },
    { id: "hold-102", tool: "net.fetch", target: "https://api.vendor/v1/send", cls: "R3", blast: 120, reason: "Irreversible send, needs approval.", requested: "08:04:57", status: "pending" },
    { id: "hold-103", tool: "db.query", target: "DELETE FROM events", cls: "R2", blast: 42, reason: "Wide delete, confirm scope of 42 rows.", requested: "08:06:08", status: "pending" }
  ],
  ledgerEntries: [
    { seq: 1, hash: "a1c401", prev: "000000", sig: "OK", cls: "R0", tool: "fs.read", decision: "forward" },
    { seq: 2, hash: "b27d02", prev: "a1c401", sig: "OK", cls: "R1", tool: "fs.write", decision: "forward" },
    { seq: 3, hash: "c3e103", prev: "b27d02", sig: "OK", cls: "R1", tool: "db.query", decision: "forward" },
    { seq: 4, hash: "d4f104", prev: "c3e103", sig: "OK", cls: "R2", tool: "s3.put", decision: "hold" },
    { seq: 5, hash: "e5a105", prev: "d4f104", sig: "OK", cls: "R3", tool: "net.fetch", decision: "hold" },
    { seq: 6, hash: "f6b106", prev: "e5a105", sig: "OK", cls: "R0", tool: "fs.delete", decision: "forward" },
    { seq: 7, hash: "07c107", prev: "f6b106", sig: "OK", cls: "R2", tool: "db.query", decision: "hold" },
    { seq: 8, hash: "18d108", prev: "07c107", sig: "OK", cls: "R1", tool: "s3.put", decision: "forward" }
  ],
  registryCases: {
    "fs.write": [
      { pre: "target under /tmp/cache", cls: "R0", decision: "forward" },
      { pre: "snapshot kept before write", cls: "R1", decision: "forward" },
      { pre: "otherwise", cls: "R2", decision: "hold" }
    ],
    "db.query": [
      { pre: "read only SELECT", cls: "R0", decision: "forward" },
      { pre: "write with row snapshot", cls: "R1", decision: "forward" },
      { pre: "otherwise", cls: "R2", decision: "hold" }
    ],
    "s3.put": [
      { pre: "bucket versioning enabled", cls: "R1", decision: "forward" },
      { pre: "otherwise", cls: "R2", decision: "hold" }
    ],
    "net.fetch": [
      { pre: "GET to allowlisted host", cls: "R1", decision: "forward" },
      { pre: "otherwise", cls: "R3", decision: "hold" }
    ]
  },
  policyRules: [
    { name: "allow reads", match: "class R0", action: "forward", on: true },
    { name: "hold mitigable", match: "class R2", action: "hold", on: true },
    { name: "hold irreversible", match: "class R3", action: "hold", on: true }
  ],
  sessions: [
    { id: "sess-demo-01", agent: "demo-agent", host: "Claude Code", surface: "Postgres", transport: "stdio", posture: "fail closed", status: "active", calls: 8, holds: 2 },
    { id: "sess-demo-02", agent: "demo-agent", host: "Claude Code", surface: "S3", transport: "http :7777", posture: "fail closed", status: "paused", calls: 31, holds: 0 },
    { id: "sess-demo-00", agent: "ci-probe", host: "MCP client", surface: "Postgres", transport: "stdio", posture: "observe only", status: "closed", calls: 120, holds: 0 }
  ],
  facts: [
    { fact: "s3 versioning assets", value: "off", verified: "2026-09-07", state: "fresh" },
    { fact: "s3 versioning backups", value: "on", verified: "2026-09-07", state: "fresh" },
    { fact: "pg role can write", value: "no", verified: "2026-09-05", state: "stale" },
    { fact: "allowlisted hosts", value: "api.vendor", verified: "2026-09-08", state: "fresh" },
    { fact: "snapshot bucket reachable", value: "yes", verified: "2026-09-01", state: "stale" }
  ],
  probeCache: [
    { target: "DELETE FROM events", fact: "row count", ttl: "60s", status: "fresh", value: "42 rows" },
    { target: "DELETE FROM orders", fact: "row count", ttl: "60s", status: "fresh", value: "41883 rows" },
    { target: "s3://assets prefix", fact: "key count", ttl: "300s", status: "stale", value: "500 keys, 3 without prior version" },
    { target: "api.vendor ping", fact: "reachability", ttl: "30s", status: "failed, declared used", value: "declared" }
  ],
  taintEdges: [
    { from: "SELECT orders", to: "UPDATE users SET plan", kind: "read to write" },
    { from: "SELECT order_items", to: "DELETE FROM orders", kind: "read to write" },
    { from: "DELETE FROM orders", to: "stripe.payout.create", kind: "write to write" },
    { from: "DELETE FROM orders", to: "sendgrid.mail.send", kind: "write to write" },
    { from: "GET s3://assets/logo.png", to: "PUT s3://assets/logo.png", kind: "read to write" },
    { from: "SELECT events", to: "DELETE FROM events", kind: "read to write" }
  ],
  frames: [
    { frame: "ledger entry", maps: "seq, hash, prev, sig, class, tool" },
    { frame: "classification", maps: "tool id, case index, precondition" },
    { frame: "policy decision", maps: "rule id, decision, reason" },
    { frame: "blast radius", maps: "measured count plus per table split" },
    { frame: "replay step", maps: "inverse or compensation plus order" }
  ],
  cliCommands: [
    { cmd: "void run", desc: "Wrap an agent session through the proxy.", ex: "void run -- npx agent" },
    { cmd: "void approvals", desc: "List and resolve pending holds.", ex: "void approvals --json" },
    { cmd: "void ledger verify", desc: "Verify chain links and signatures.", ex: "void ledger verify" },
    { cmd: "void replay", desc: "Preview or run inverses in taint order.", ex: "void replay --to 7 --dry-run" },
    { cmd: "void policy test", desc: "Test a policy file against a transcript.", ex: "void policy test --policy policy/default.yaml --transcript fixtures/session.jsonl" },
    { cmd: "void classify", desc: "Print class distribution over a transcript.", ex: "void classify --transcript fixtures/session.jsonl" },
    { cmd: "void probe", desc: "Measure blast radius for one statement.", ex: "void probe -- db.query DELETE FROM orders" },
    { cmd: "void export", desc: "Export a signed period slice.", ex: "void export --period 2026-09 --sign" }
  ],
  keys: [
    { id: "dev-01", alg: "ed25519", state: "active", note: "Verify reports development key, never plain valid." },
    { id: "dev-00", alg: "ed25519", state: "retired", note: "Old entries still verify against retired keys." }
  ],
  providers: [
    { id: "openrouter", name: "OpenRouter", kind: "gateway, primary", base: "https://openrouter.ai/api/v1", key: "own key set, ends 4f2a", status: "connected", latency: "320ms", note: "BYOK tried before shared endpoints. One key, many models." },
    { id: "ollama", name: "Ollama local", kind: "local", base: "http://localhost:11434/v1", key: "none needed", status: "connected", latency: "45ms", note: "Zero retention by construction, stays on this machine." },
    { id: "openai", name: "OpenAI direct", kind: "direct, fallback", base: "https://api.openai.com/v1", key: "missing", status: "standby", latency: "n/a", note: "Used only when the gateway has no route." },
    { id: "anthropic", name: "Anthropic direct", kind: "direct", base: "https://api.anthropic.com", key: "missing", status: "off", latency: "n/a", note: "Turn on to add a second direct fallback." }
  ],
  models: [
    { id: "z-ai/glm-5.3", provider: "openrouter", tag: "FREE, default", ctx: "200k", out: "64k", tools: "yes", price: "0 / 0", note: "Daily driver. Cost tier low." },
    { id: "openai/gpt-5-mini", provider: "openrouter", tag: "fallback 1", ctx: "400k", out: "128k", tools: "yes", price: "0.25 / 2.00", note: "Cheap reserve when the default errors." },
    { id: "google/gemini-3-flash", provider: "openrouter", tag: "fallback 2", ctx: "1M", out: "64k", tools: "yes", price: "0.10 / 0.40", note: "Fast reserve, latency sensitive work." },
    { id: "anthropic/claude-sonnet-4.5", provider: "openrouter", tag: "frontier", ctx: "1M", out: "128k", tools: "yes", price: "3.00 / 15.00", note: "Complex jobs only, needs explicit pick." },
    { id: "meta/llama-3.3-70b", provider: "ollama", tag: "local", ctx: "128k", out: "8k", tools: "limited", price: "0 / 0", note: "Offline work, no data leaves." }
  ],
  routing: { def: "z-ai/glm-5.3", fallbacks: ["openai/gpt-5-mini", "google/gemini-3-flash"], sort: "price", allowFallbacks: true, dataPolicy: "deny training use", maxPrice: "5.00 per 1M", tier: "medium" },
  usage: { period: "2026-09", budget: 20.0, spent: 6.42, byModel: [
    { model: "z-ai/glm-5.3", tokens: "1.42M", cost: 0.0 },
    { model: "openai/gpt-5-mini", tokens: "0.31M", cost: 0.7 },
    { model: "google/gemini-3-flash", tokens: "0.88M", cost: 0.44 },
    { model: "anthropic/claude-sonnet-4.5", tokens: "0.12M", cost: 5.28 }
  ] },
  requestLog: [
    { t: "08:00:11", model: "z-ai/glm-5.3", provider: "openrouter", tokens: "2.1k", ms: 410, cost: "0.00", status: "ok" },
    { t: "08:01:02", model: "z-ai/glm-5.3", provider: "openrouter", tokens: "8.4k", ms: 900, cost: "0.00", status: "ok" },
    { t: "08:02:44", model: "openai/gpt-5-mini", provider: "openrouter", tokens: "12.0k", ms: 1200, cost: "0.02", status: "fallback" },
    { t: "08:04:57", model: "z-ai/glm-5.3", provider: "openrouter", tokens: "1.1k", ms: 60, cost: "0.00", status: "cached" },
    { t: "08:06:08", model: "anthropic/claude-sonnet-4.5", provider: "openrouter", tokens: "22.5k", ms: 3400, cost: "0.41", status: "ok" },
    { t: "08:07:52", model: "meta/llama-3.3-70b", provider: "ollama", tokens: "3.3k", ms: 700, cost: "0.00", status: "ok" }
  ]
};
