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
  ]
};
