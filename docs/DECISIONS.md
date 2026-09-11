# VOID: decision log

The seven decisions taken before any product code was written, why each was
taken, and what was rejected. Written 4 September 2026, at WP-00.

Three deciders wrote independent logs from three biases (fastest to a demo,
safest to operate, cheapest to run and maintain by one person) and four readers
mapped the repository. This file is the synthesis. It is not an average: each
decision names one winner, and where a losing log had the better answer for a
sub point, that sub point was grafted in and is marked as such.

Read this with `docs/CONTEXT.md` and `docs/STANDARDS.md`. Those three files are
the context pack. They are authoritative: when the code disagrees with the pack,
the code is wrong. When the pack is wrong, the fix is a work package that
updates the pack, never an agent that quietly diverges.

Everything below is evidence based where evidence was available. Claims marked
**verified** were run on this machine during WP-00 and the command is given.
Claims marked **unproven** cannot be checked without a deploy or an account, and
are called out so nobody later mistakes a guess for a measurement.

---

## 1. The wedge: one agent host, one tool surface

**Decision.** Which agent host and which tool surface the first end to end path
runs through, and what is explicitly out of scope until it works.

**Choice.** Agent host: any MCP capable client, with Claude Code as the
reference implementation, over the **stdio transport only**. Tool surface: one
Postgres MCP server, its write tools, against a non production database. The
default posture is **fail closed**: an unknown tool, an unclassified call, a
ledger append failure, a missing or invalid policy file, or a proxy internal
error all resolve to deny. Observe only mode is an explicit opt in flag, never a
fallback. Preconditions come from **declared configuration**, not probes.

Out of scope until an agent has been held on a real R3 Postgres write and the
write has been proven not to happen: the Streamable HTTP transport (WP-02),
every connector other than Postgres including S3, probing of any kind, the
speculative hold with provisional receipts, the taint graph, the hosted control
plane, Slack and Teams approvals, multi tenancy, billing, SSO, the SDK wrap, and
any expansion of the registry beyond the 89 entries that exist.

**Rationale.** BUILD-PLAN section 2 gives four reasons for Postgres and all four
hold, but the decisive one for this repository is the fourth plus a fifth the
plan does not state: you control both sides, and here both sides are already on
the machine. PostgreSQL 16.13 is installed, cluster 16/main is initialised at
`/var/lib/postgresql/16/main`, and `pg_ctlcluster 16 main start` brings it up
with nothing to install (**verified**). So every exit criterion in WP-03, WP-05
and WP-06 runs locally, for zero dollars, with the undo confirmed by opening a
database client rather than asserted against a mock. A reversibility layer whose
undo has only ever been observed through its own test doubles is not something a
reviewer can sign off. Stripe is the better demo and the worse first build for
the reason BUILD-PLAN gives, and for a second one: nearly every Stripe write is
R2 or R3, so a Stripe demo proves the hold and never proves the undo, and the
undo is the differentiated half.

The narrowing to stdio goes further than BUILD-PLAN, which puts both transports
in phase 1. Streamable HTTP means an inbound listener, session identifiers,
Origin and DNS rebinding validation, TLS and bearer auth sitting in front of
someone's database: a second security surface, opened in the same week the
forwarding logic is written for the first time. It is also the only shape where
VOID holds no credentials at all, which keeps the first security conversation
short. EXECUTION-PLAN already splits this as WP-01 and WP-02, so the narrowing
costs nothing structurally.

Grafted from the losing logs: fail closed as the default posture and the non
production database rule (safest); `notifications/progress` stays in scope for
phase 1 even though the rest of the notification surface is thin, because a
blocking hold is a tool call that does not return for up to 120 seconds and
without progress the client's own timeout, not the operator, decides the outcome
of the demo (fastest); and the explicit statement of what the narrowing costs
(cheapest), below.

**What this narrowing costs, stated so nobody rediscovers it as a surprise.**
MCP only means agents calling tools through a raw SDK or LangChain are
unreachable until WP-14. Postgres only means the demo says database, not money,
which is the weaker story for selling. Stdio only means there is no shared team
gateway, so the Team tier in GO-TO-MARKET section 4, which is defined by a
hosted control plane, is structurally blocked until WP-02 and WP-10 exist.
Declared facts mean a classification is only as honest as the operator's config
file, which is the limitation BUILD-PLAN section 7.1 names and which must stay
visible in the product rather than buried. Fail closed means a VOID crash
becomes an outage of the agent's write path: availability traded for safety,
which is the right direction here but must be documented for the first user.

**On phase 1's exit criterion.** Keep it as written: run a real agent session
twice, once direct and once through the proxy, and diff the transcripts. It is
the only check that catches silent divergence. Narrow the scope, not the rigour:
the session is a stdio Postgres session, and message types that session never
emits (`resources/*`, `prompts/*`, `list_changed`, reconnect) are still
forwarded and are proven by unit test rather than by transcript.

| Rejected                                                                    | Why not                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe or another payments surface first                                    | Needs an account, keys and an internet reachable webhook before line one, so it costs money and standing surface before the first user. Nearly every call in it is R2 or R3, so the product only ever says no and never says undone. A development mistake touches someone's real money.                              |
| Both transports in phase 1, as BUILD-PLAN writes it                         | Doubles the code under review in the riskiest week and adds an inbound listener, session state, Origin checks and an auth surface in front of a database. Deferred to WP-02 with localhost binding, Origin validation and a required bearer token as its own exit criteria.                                           |
| SDK wrap or a framework plugin first                                        | Binds VOID to one framework's agent loop, which BUILD-PLAN section 8 names as the mistake that turns a framework agnostic layer into a competitor to the framework. It also defers the transport work rather than saving it. It is the natural second deployment shape, at WP-14.                                     |
| Filesystem or shell MCP server as the first surface                         | Fastest to intercept and impossible to compensate honestly. A file delete has no keyed before image you can restore without copying the payload, which collides with the rule that VOID stores references and digests, never payloads. It produces a hold demo with no path to a replay demo.                         |
| A general purpose HTTP egress proxy classifying any outbound API call       | No tool identity, no arguments, no target state, so classification degrades to URL matching. 74 of the 89 registry entries change class with configuration, so URL matching is wrong most of the time.                                                                                                                |
| A gateway across several MCP servers at once                                | Every classification bug is then spread across surfaces with different auth, snapshot formats and failure modes. A plausible but wrong interceptor is worse than none.                                                                                                                                                |
| VOID holding its own read only credentials per connector, to enable probing | BUILD-PLAN section 7.1 names this as the mistake that turns a proxy into an agent platform. It gives VOID standing access to customer systems, which is a much larger security review and a much longer sale. Declared facts ship first, probing through the upstream server's own read tools is the phase 6 upgrade. |
| A production database for the first end to end run                          | Prohibited by BUILD-PLAN section 3 and by EXECUTION-PLAN section 2. The first run of an unproven interceptor is the least safe moment there has ever been to break that rule.                                                                                                                                         |

**Revisit when.** The phase 4 moment runs end to end (an agent attempts a real
R3 Postgres write, a human cancels it, the write never happens, the agent
recovers) **or** a design partner commits to paying for a surface VOID does not
yet intercept. Either event reopens the tool surface. The transport reopens
separately, at the first request for a remote or shared proxy, which is WP-02.

---

## 2. Storage: where the ledger lives and what append only means

**Decision.** What the ledger writes to, how append only is enforced, and what
happens when there is no database.

**Choice.** Two stores behind one narrow interface, and **no memory mode at any
tier**. The interface is `append`, `read`, `head` and `verify`, and nothing
else: no `update`, no `delete`.

_Dev tier, the default:_ an append only JSONL file per workspace at
`VOID_LEDGER_DIR` (default `~/.void/ledger/<workspace>.jsonl`), directory mode
0700, file mode 0600, opened `O_APPEND`, one JSON object per line, `fsync`
before the append is acknowledged. The signing public key and the latest signed
checkpoint are written beside it so the store is self contained for the
standalone verifier. No `DATABASE_URL` is read and none is needed.

_Hosted tier:_ Postgres, in a dedicated schema named `ledger`, **never** in
`public`. The DDL is raw SQL, applied forward only by `packages/ledger`'s own
migrator, with each migration file's sha256 recorded in a `ledger.migrations`
table. `drizzle-kit` never touches the `ledger` schema and may at most declare
the table for typed reads.

_Append only is four layers, in ascending order of what they actually protect:_

1. **The type system.** `packages/ledger` exports `append` and `read` and no
   mutation, per BUILD-PLAN line 167, so a caller cannot form the intent.
2. **Postgres grants.** Schema, table and trigger function are owned by a
   `NOLOGIN` `ledger_owner` role. The application role holding `DATABASE_URL`
   gets `USAGE`, `SELECT` and `INSERT` only.
3. **Triggers.** `BEFORE UPDATE` and `BEFORE DELETE` per row, `BEFORE TRUNCATE`
   per statement, all raising `restrict_violation`. Plus
   `UNIQUE (workspace, prev_hash)` so a chain fork is a database error rather
   than a quiet second branch, and a `CHECK` pinning `hash` to the form
   `sha256:` followed by 64 hex characters.
4. **The chain and the per entry signature.** The only layer that survives an
   attacker who owns the database.

_The append is one serialised transaction per workspace:_ begin,
`pg_advisory_xact_lock` on the workspace, read the head, compute, insert,
commit, with the unique constraint as the backstop and a single re-read and
retry on a unique violation.

_With no `DATABASE_URL`:_ resolve `VOID_LEDGER_URL`, then `DATABASE_URL`, then
the local JSONL store if its directory is writable, and log which store was
chosen exactly once at startup. If none can be opened durably, `append` throws,
and because the proxy fails closed the intercepted call is denied with an MCP
error naming the reason. The ledger never returns a receipt for a record it did
not persist.

**Rationale.** The dedicated schema is not a preference, it was measured. With a
populated `ledger_entries` table in `public` that was not declared in
`lib/db/src/schema/index.ts`, this repository's own documented migration
command, `pnpm --filter @workspace/db run push-force`, dropped the table, its
row and all three append only triggers and printed `[done] Changes applied`,
because `DROP TABLE` does not fire a `BEFORE DELETE` trigger (**verified**). The
identical test with the table in a dedicated `ledger` schema reported
`No changes detected` and left everything intact (**verified**). So the
marketing site's tooling and the audit record are structurally unable to
collide, which is worth more than the tidiness of one schema.

The privilege split was tested too. As the application role, `UPDATE` and
`DELETE` were refused with `permission denied for table entries` before the
trigger even ran, `DROP TRIGGER` was refused with
`must be owner of relation entries`, and `ALTER TABLE ... DISABLE TRIGGER ALL`
with `must be owner of table entries` (**verified**). That is the property that
matters: the runtime `DATABASE_URL` is the credential most likely to leak, and
its holder must not be able to disarm its own audit trail. Grants stop the
ordinary path, triggers catch the privileged path, ownership stops the guard
being removed, and the chain plus the signature is what holds against a database
superuser, who bypasses all three. That last limitation is honest and belongs on
the `/docs/ledger` page in those words, and it is exactly why the record is
signed rather than merely constrained.

The JSONL default is what makes the free Dev tier in GO-TO-MARKET section 4
actually free, what makes install and try in sixty seconds possible, and what
lets a contributor run the test suite without provisioning a database. A ledger
is a sequential append and a whole file read, which is what a file is best at,
and JSONL is greppable, diffable and directly consumable by the standalone
verifier. The cheap tier is not the untrustworthy tier: because the chain and
the signature carry the guarantee, a JSONL ledger is exactly as tamper evident
as a Postgres one. It is not tamper _proof_, and the docs must say so in those
words.

Fail closed is the one place we refuse this repository's existing habit.
`api/_store.ts` degrades to memory with `stored: false` and `lib/db` throws at
import time, and both are wrong for a ledger: writing an audit record into a
process local array that dies with the process, while still returning a receipt,
manufactures false evidence, which is worse than a refusal.

Grafted from the losing logs: `fsync` before acknowledgement, the migrations
table with per file digests, and the per workspace advisory lock (safest); the
public key and checkpoint sidecar and the single startup line naming the chosen
store (cheapest); layer zero, the type system, stated first because it is the
layer that prevents the intent rather than catching it (fastest).

**Three prior art defects fixed on the way in, none cosmetic.**
`api/_store.ts:90` reads the previous hash in one statement and inserts in
another with no transaction and no lock, so two concurrent requests link to the
same predecessor and the chain forks with nothing detecting it.
`api/_core.ts:64` returns a display string, `0x` plus 8 hex characters, and
`api/_store.ts:94` writes that into the `hash` column, so the persisted chain is
linked by 32 bits: birthday collidable in roughly 65 thousand attempts, and
impossible to verify independently because the full digest was never stored.
`api/_store.ts:57` memoises a null pool, so one transient failure at first
request pins the process to memory mode until restart, with one log line as the
only trace.

**Two adjacent fixes land with WP-03, because they are in the same code and are
cheap now and expensive later.** `lib/db/src/index.ts:7` throws at import time
on a missing `DATABASE_URL`, and `replit.md:88` says the mitigation lives in
`storage.ts`, which does not exist anywhere in the repository, so the guard rail
is gone while the hazard is intact: `packages/ledger` owns its own `pg` pool and
never imports `@workspace/db`, and that gotcha is corrected in the same commit.
`lib/db/drizzle.config.ts:4` throws on a missing environment variable, which
breaks the standing rule recorded twice in this repository: it falls back to a
placeholder URL and lets the connection fail with a real message.

**What this costs.** `fsync` is a millisecond or two per dev append on SSD. The
per workspace advisory lock serialises appends, so one workspace tops out in the
low thousands per second and does not scale by adding proxy instances; at the
Team tier's one million actions a month that is orders of magnitude of headroom,
and the alternative is a chain that forks under load. JSONL is single writer per
file, so two proxy processes on one workspace need the Postgres path. Reads are
linear, so a ledger browser over a million entries is a Postgres tier feature
and always will be. Raw SQL DDL means this repository now has **two** migration
mechanisms, which must be written into `replit.md` and `README.md` in the same
commit or the next agent will not know the second one exists.

| Rejected                                                            | Why not                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Postgres required in every tier                                     | Kills the free Dev tier that GO-TO-MARKET sells as a local ledger, forces every contributor and trial user to provision a database, and makes the trivial WP-00 test depend on infrastructure. Adoption of a safety layer is itself a safety outcome.                                                              |
| The ledger table in the `public` schema next to `waitlist_requests` | Verified destroyed by this repository's own documented migration command, with a success message and no error. A ledger that a routine developer command deletes is not a ledger.                                                                                                                                  |
| Declaring the ledger in Drizzle and pushing it with `drizzle-kit`   | `drizzle-kit` 0.31 cannot express a trigger, a grant or an owner, so it would reconcile the columns while silently leaving a mutable table wearing the name ledger. `push` is a live reconciler with no history, no reviewable artifact and no rollback, including `DROP`.                                         |
| Triggers alone, without the ownership and grant split               | A trigger is owned by the table owner and the table owner can drop it, so triggers alone are a speed bump for whoever holds the connection string. Verified: with the split, the application role cannot drop or disable them.                                                                                     |
| Memory fallback matching `api/_store.ts`                            | Correct for a marketing waitlist, catastrophic for an audit record: the append path stops being durable while every response still returns a receipt. Consistency with a policy that trades durability for uptime is not a virtue in the one component whose entire value is durability.                           |
| SQLite or libsql for the dev tier                                   | Either a native dependency added under the 1440 minute `minimumReleaseAge` gate, or `node:sqlite`, which is still experimental on Node 22. For an append only log that is only ever scanned forward, a file with one JSON object per line gives the same durability with zero install and a diff a human can read. |
| Object storage (S3, R2) as the ledger sink                          | No append semantics, so every entry is a PUT with per request cost and network latency inside the write path, and the free tier stops being free and offline.                                                                                                                                                      |
| A managed ledger service (QLDB, a hosted transparency log)          | Monthly cost, vendor lock, and it moves the root of trust to a third party at the exact moment the product's claim is that verification is offline and needs no trust in us.                                                                                                                                       |
| Filesystem immutability (`chattr +a`, WORM) for the dev tier        | Not portable, needs privileges a developer will not grant to try a tool, and it would imply a guarantee the free tier cannot make.                                                                                                                                                                                 |
| Reusing the `waitlist_requests` chain shape                         | A chain by convention only: `prev_hash` and `hash` are nullable non-unique text, nothing stops an `UPDATE`, the digest is truncated to 32 bits, and the read of the head is outside the insert's transaction.                                                                                                      |

**Revisit when.** A single workspace needs more than one concurrent proxy
process, **or** a customer asks for a ledger browser over more than roughly a
million entries, **or** the first paying Team tier customer exists. Any of those
makes Postgres the default rather than the hosted option. The JSONL store is
never removed: it is what the free tier and the test suite run on.

---

## 3. The signing key path

**Decision.** What signs a ledger entry, what the interface looks like, where
the key comes from in development and in production, and what is signed.

**Choice.** ed25519 through `node:crypto`, **zero new dependencies**, signing
**every entry** rather than only the head, plus a periodic signed checkpoint
over the head for the attestation export.

The interface is frozen now, is **asynchronous from the first line**, and never
returns private key material:

```ts
type Alg = "ed25519" | "ecdsa-p256-sha256";

interface KeyProvider {
  readonly alg: Alg;
  currentKeyId(): Promise<string>;
  sign(input: Uint8Array, keyId?: string): Promise<Uint8Array>;
  publicKey(keyId: string): Promise<Uint8Array | null>; // SPKI DER
}
```

`key_id` is derived from the key, not chosen: `ed25519:` plus the first 16 hex
characters of the sha256 of the SPKI public key, so an id cannot be silently
reused for a different key. It is a `NOT NULL` column on every entry.

The signed input is domain separated, versioned, and binds the algorithm and the
key: the ASCII bytes of `void.ledger.v1|<alg>|<key_id>|` followed by the full 64
character entry hash. The stored signature is tagged: the algorithm, a colon,
then base64. Signatures cover the hash rather than the body, so signature
checking is independent of canonicalisation once the verifier has recomputed the
hash from the body.

In development the private key comes from `VOID_SIGNING_KEY` as base64 PKCS8 if
set. If unset, `packages/ledger` generates one on first append into
`~/.void/keys/<key_id>.pkcs8` at mode 0600, prints one loud line saying a
development key is in use, and gives the id a `dev-` prefix. The verifier
reports an entry signed by a `dev-` key as **valid, development key**, never as
plain valid. In production the same interface is backed by KMS and no calling
code changes. Rotation appends a rotation entry into the chain itself, signed by
the outgoing key and naming the incoming key id, alongside a keys record
carrying `key_id`, `alg`, SPKI, `not_before` and `not_after`.

**sealHash is rewritten, not lifted.** BUILD-PLAN line 218 says lift it and do
not reinvent it. Lifting it verbatim would be wrong three times over.
`api/_core.ts:62` canonicalises with
`JSON.stringify(payload, Object.keys(payload).sort())`. The second argument is a
replacer **allowlist**, not a sort order: it is computed from top level keys and
applied at every nesting depth, so `{email, meta: {ip, utm}}` canonicalises to
`{"email":...,"meta":{}}` and every nested value is erased from the preimage
(**verified** in node). Tool call arguments, snapshot descriptors, policy
decisions and connector metadata are all nested by nature, so the first real
ledger entry would be unauthenticated while looking sealed. `api/_core.ts:64`
then truncates to 8 hex characters. So `packages/ledger` gets a recursive
canonicaliser with explicit handling of `undefined`, non-finite numbers and key
order at every depth, a version tag and a domain separator in the preimage, and
the full 64 character digest persisted, truncated only at the render boundary.
This is half a day and it is not optional: WP-13's standalone verifier is
impossible against a truncated chain, and the tamper forger in WP-03 would
otherwise pass.

**Rationale.** **Verified** on this machine on Node 22.22.2:
`crypto.generateKeyPairSync("ed25519")`, `crypto.sign(null, ...)` returning a 64
byte signature, `crypto.verify` returning true, PKCS8 export and JWK public
export all work with nothing installed. That is the entire cryptographic
dependency budget for the product's central claim, which is the correct budget,
and in a security product a userland curve library is the single worst place to
spend supply chain risk.

The decisions that are expensive to reverse are the ones taken now for free:
`sign` is async because every KMS is a network call and turning a synchronous
signature asynchronous later is a change at every call site, at exactly the
moment production is being set up under time pressure. `sign` is the only
method, and there is no `getPrivateKey` or `exportKey`, so the unsafe code
cannot be written rather than merely being discouraged. `alg` is a field rather
than a hardcode because Ed25519 is not offered by every KMS (AWS KMS signs
ECDSA and RSA), and discovering that after a million signed entries would make
an algorithm change a break in the stored format. `key_id` is on every entry
because a signature you cannot attribute to a key is unverifiable after the
first rotation. Domain separating and binding `alg` and `key_id` into the
preimage defeats substitution and downgrade replay.

Signing every entry rather than only the head is a deliberate deviation from
BUILD-PLAN phase 2. It costs tens of microseconds and one text column, and it
means an exported slice verifies on its own, which is the whole of WP-13 and of
the per entry `signature` field the site already publishes at
`artifacts/void/src/pages/docs.tsx:106`.

Grafted from the losing logs: the `alg` field, the alg-bound preimage and the
in-chain rotation entry (safest); the `dev-` key id prefix and the verifier's
distinct verdict (fastest); the tagged signature string, the checkpoint, and the
honest limitation statement (cheapest).

**One correction to a published contract.** `/docs/ledger` lists `signature` but
not `key_id`. That is an omission, and the site copy is updated in the same
commit as WP-03, in both the English and Czech surfaces.

**What this cannot claim.** An environment or file key means whoever compromises
the host can forge future entries. Past entries are protected only to the extent
that a checkpoint was published somewhere the attacker does not control. The
honest claim is tamper evident against the database, against the operator's
future self, and against us, not against a live compromise of the machine the
proxy runs on. A KMS sign call is roughly 20 to 60 milliseconds in the write
path of every intercepted call; if that is measured to hurt, the growth path is
a session key, where KMS signs a short lived certificate binding a locally
generated public key to the workspace and a validity window. Build that only if
the latency actually hurts, because it adds a second thing for a reviewer to
check.

| Rejected                                                                  | Why not                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HMAC with a shared secret                                                 | Verification requires the secret, so anyone who can verify can forge. That makes "verifiable by someone who does not trust you" false and the attestation export in phase 9 worthless.                                                                                                     |
| Signing only the chain head, as BUILD-PLAN phase 2 literally says         | A partial or period export cannot then be verified without the whole chain, per entry attribution to a key is lost after a rotation, and it contradicts the per entry `signature` field already published on `/docs/ledger`. Signing is tens of microseconds, so there is nothing to save. |
| JOSE, JWS, COSE or a detached signature envelope                          | Standards weight and a dependency with a long history of algorithm confusion vulnerabilities, for one algorithm, one key and 64 bytes. It also buys a spec to implement in a verifier that is supposed to be small enough to read.                                                         |
| libsodium, tweetnacl, noble-ed25519                                       | A new dependency behind the 1440 minute release age gate for a primitive the platform already implements, and a supply chain surface in the one component whose job is to be trustworthy.                                                                                                  |
| A `KeyProvider` with `getPrivateKey`, `exportKey` or a synchronous `sign` | Exported key material eventually reaches a log or a crash dump, and a synchronous signature makes a KMS implementation impossible without rewriting every caller.                                                                                                                          |
| Hardcoding ed25519 with no `alg` field                                    | Blocks AWS KMS, the most common enterprise ask, and turns a later algorithm addition into a format break for every entry already written.                                                                                                                                                  |
| Requiring `VOID_SIGNING_KEY`, with no auto generated development key      | Safer, and it puts a setup step in front of the demo and in front of every contributor's first test run. The `dev-` prefix plus a distinct verifier verdict recovers the safety at a fraction of the friction.                                                                             |
| Sigstore or a public transparency log                                     | An external service and an availability dependency in the write path, disproportionate at one user. Worth revisiting as a paid attestation feature.                                                                                                                                        |
| X.509 and a small PKI                                                     | Certificate lifecycle management for a solo operator, to solve a key distribution problem that one public key file next to the ledger already solves.                                                                                                                                      |
| One key shared between development and production, or a key with no id    | Rotation becomes unverifiable after the first rotation, and a development key that can sign production entries makes every entry's provenance a guess.                                                                                                                                     |

**Revisit when.** The first customer asks for bring your own KMS (an Enterprise
tier feature in GO-TO-MARKET section 4), **or** a measured KMS signing latency
exceeds the hold budget in the write path, **or** an auditor asks for an
algorithm this interface does not carry.

**WP-03 implementation notes, recorded because they sharpened the frozen
contracts.** `LedgerStore` grew its second type parameter into two: `Body`
is what the caller brings, `StoredEntry` is what the file holds, because the
append takes a payload and read yields the payload plus chain metadata, and
conflating the two let a type error through where the caller's body was
silently expected to carry seq and prev_hash. The dev key file is written
O_CREAT|O_EXCL after an adversarial review reproduced a pre placed symlink
capturing the private key through the write, and a concurrent first start
adopting a different key per process via last write wins; the loser of the
O_EXCL race now reads back the winner's key. A line with an unsupported
algorithm tag is a named finding at that entry, never a thrown TypeError,
because a verifier that crashes on line one of a hostile file stops checking
exactly where the hostility starts. The canonicaliser refuses payloads nested
deeper than a thousand levels with a named error rather than a RangeError
stack dump.

---

## 4. The policy format

**Decision.** How an operator expresses which calls are allowed, held or denied.

**Choice.** Declarative YAML match rules, exactly as BUILD-PLAN phase 4
sketches, first match wins by file order, parsed with the `yaml` package and
validated by a **strict** zod schema. No expressions, no regular expressions, no
boolean operators, no nesting, no interpolation, no evaluator.

The whole grammar for version one: a required top level `version: 1`, then an
ordered list of rules. Each rule has a required stable `id`, a `match` object,
and a decision.

Match keys, and there are exactly five: `class` (one of r0 to r3 or a list of
them), `tool` (an exact id or one **trailing** wildcard such as
`postgres.row.*`), `connector`, `workspace`, and `blast_radius` taking `lt`,
`lte`, `gt` or `gte`. Keys within one `match` are an implicit AND. A list of
values within one key is an OR. Decisions: `allow`, `deny`, or `hold` with
`seconds` and `notify`.

Four properties make it growable without a breaking change, and they are the
decision, not the grammar:

1. `version: 1` is required from the first file written, and an unknown version
   is a load error rather than a guess.
2. **An unknown key or an unknown value anywhere is a loud load error, never
   ignored.**
3. Because match keys AND together, adding a sixth key later is additive and
   cannot change what an existing file means.
4. Every rule carries an `id`, and every ledger entry records the matched rule
   id together with the sha256 of the policy file text.

Defaults, which is where the three logs disagreed and where the answer is split
rather than averaged:

- **No rule in a valid, loaded file matched: hold.** Hold is the only decision
  that is itself reversible, an unmatched call is precisely the case a human
  should look at once, and the notification tells the operator which rule they
  are missing, so the default teaches the policy file rather than either
  blocking work or silently permitting it. The schema nonetheless **requires**
  the file to end with an explicit terminal catch-all rule, so an operator reads
  the rule rather than inheriting a hidden one, and in a well formed file the
  implicit default never fires.
- **Policy file missing, unreadable, invalid, or of an unknown version: deny,
  loudly.** That is a broken configuration, not an unmatched call, and the two
  must not resolve the same way.
- **An unclassified call is treated as R3**, which makes registry coverage a
  safety property and creates the right pressure: BUILD-PLAN phase 3's exit
  already says more than a fifth unclassified means the registry has the wrong
  coverage for the wedge.

**Rationale.** BUILD-PLAN section 8 lists a policy DSL under what not to build,
and the cheapest reading of that is stronger than the plan states: a language is
not one project, it is a permanent one. It needs precedence rules, error
messages a non-programmer can act on, a security review of an evaluator that now
runs inside the interception path, and a compatibility promise on every future
syntax change. Five keys and four comparators is roughly forty lines of zod, has
no evaluation semantics to get wrong, and leaves a rule file as a document a
compliance reader can diff. Matching rules are also **total and inspectable**: a
reviewer can read the file top to bottom and know what happens to every call,
which is not true of any expression language.

Property 2 is the load bearing one and it is the one people skip. If unknown
keys are silently ignored, an operator's typo (`blast_radus`) quietly drops a
condition and widens a narrow rule to everything of that class, which in a tool
that gates writes means allowing what should have been held. Worse, the day the
real key is added, every file containing that typo changes meaning without
anyone editing it. Failing the load is what makes adding a key later a safe,
non-breaking act, and it is also what makes a newer policy file fail closed on
an older binary rather than silently allow.

Property 4 is what lets an audit answer, months later and after the file has
changed, which text produced a decision. Without it the ledger records a
decision nobody can reproduce. It also gives a cheap migration test: a later
format change can be replayed against real history to see what would have
changed.

The one dependency, `yaml`, is worth it. The format is going to be read and
diffed by people who are not its author, a policy file without comments is a
policy file nobody can explain six months later, and hand rolling a YAML subset
is the kind of task that looks like an hour and is not. Validation goes through
zod rather than a JSON Schema validator because zod is already a root
dependency, gives the parsed rules their TypeScript types for free, and produces
errors naming the path in the file. JSON is still accepted, since YAML is a
superset, so anyone generating policy programmatically loses nothing.

Grafted from the losing logs: the required rule `id`, the policy digest in the
ledger and the unclassified-as-R3 rule (safest); the split between an unmatched
call and a broken file, and the argument for hold as the unmatched default
(fastest); the ban on regular expressions in v1 and the trap below (cheapest).

**The trap for WP-05, which is not in the format at all.** It is the MCP error
body returned on a deny or a cancel. A generic error trains agents to retry with
a slightly reworded statement, which turns a safety tool into an evasion
trainer. The error must name the rule id, the class, and what approval would
require.

**What this cannot express, stated now so nobody bolts it on.** No rule can
relate two calls: nothing about rate over time, a running total, time of day, or
the identity of the human behind the agent beyond the workspace. Irreversibility
budgets, which GO-TO-MARKET sells on the Business tier, are exactly that class
of stateful rule and need a counter store and a decision that is a function of
history, not a sixth match key. Anything cross tool, such as hold any write that
follows a read of table X, is the taint graph in WP-12, not the policy engine.

| Rejected                                                     | Why not                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A small purpose built expression language                    | A parser, precedence, a type checker, error messages a non-programmer can act on, and a sandbox, sitting inside the component that holds credentials. You then cannot statically tell what a rule will do, which is the exact property needed in a component that gates writes. BUILD-PLAN section 8 names it explicitly. |
| An embedded evaluator (CEL, JSONLogic)                       | A dependency plus an evaluation surface to reason about in the write path, buying expressiveness nobody has asked for, and turning a rule file into something you debug rather than read. Kept as the shape of a possible optional `expr` field in v2.                                                                    |
| OPA and Rego                                                 | Genuinely the right answer at enterprise scale and wildly disproportionate here: a Go binary or a large wasm blob, plus a second language for the operator, for four rule kinds and three decisions. Keep as a documented enterprise escape hatch.                                                                        |
| Cedar                                                        | Models authorisation of a principal on a resource, not classification of a call against the state of its target, so the core concept has to be bent to fit, and it adds a wasm dependency for the privilege.                                                                                                              |
| Policy as TypeScript, an exported `decide` function          | Maximum expressiveness, zero auditability. A compliance reader cannot diff it, changing policy becomes a code deploy, the operator's policy runs with the proxy's privileges, and shared policies become a supply chain problem. The one option a security reviewer would refuse outright.                                |
| JSON instead of YAML, to avoid the dependency                | No comments, and a policy that cannot be annotated is a policy that does not get reviewed. JSON input is accepted anyway.                                                                                                                                                                                                 |
| Regular expressions in match fields in v1                    | ReDoS in the write path with no dependency free mitigation, and a regex is precisely where an accidentally over broad allow rule hides from review. A single trailing wildcard covers the real cases and is readable at a glance.                                                                                         |
| Match keys for everything the registry knows, added up front | Every key is a compatibility promise forever. Five keys that are all used beats twenty where six are, and the load time rejection of unknown keys makes adding the rest later free.                                                                                                                                       |
| Implicit allow when no rule matches                          | Inverts the product. The failure mode of an incomplete policy file becomes an unprotected write path, invisibly and permanently.                                                                                                                                                                                          |
| Implicit deny when no rule matches in a valid file           | The more obviously safe answer, and it makes an incomplete policy file indistinguishable from a deliberate refusal, teaches the operator nothing, and blocks work over a gap rather than surfacing it. Deny is kept for the genuinely broken cases: missing, unreadable, invalid or unknown version.                      |

**Revisit when.** A user states, in writing, a condition the five keys cannot
express and explains what they needed it for. That is the event BUILD-PLAN
section 8 asks for, and the response is a sixth key or a new comparator inside
the same structure, at version 2, or at most an optional `expr` field alongside
`match` so every v1 file keeps working. It is never a replacement of the format.

---

## 5. The licence line

**Decision.** What is open, what is paid, under which licence, and how the line
is kept credible.

**Choice.** Confirm GO-TO-MARKET section 3: **Apache 2.0** open core, with the
hard rule that **a feature never moves from open to paid**. Four amendments.

_Open, Apache 2.0:_ `packages/registry` (data, evaluator, schema),
`packages/ledger` (chain, canonicaliser, signing, both stores, verification),
`packages/proxy` (both transports when they exist), `packages/policy` (rules,
decide, hold, the approval **channel interface** and the CLI channel),
`packages/cli`, `packages/connectors/postgres`, `packages/connectors/s3`, and
the standalone verifier as its own separately installable package with **zero
dependency on any other VOID package**.

_Paid and closed:_ `apps/control-plane`, the Slack and Teams channel
implementations, SSO, multiple workspaces, irreversibility budgets, the taint
graph, attestation exports with compliance frame mappings, premium connectors
(Stripe, Salesforce, HubSpot, Gmail, Kubernetes), retention beyond seven days,
SLA support, and the self hosted enterprise licence.

_Amendment one, a line collision resolved before the file exists._ WP-05 builds
`channels/slack.ts` inside `packages/policy`, which is open, while GO-TO-MARKET
sells Slack approvals as paid. Two of the three deciders caught this
independently. The channel interface and the CLI channel are **open** and live
in `packages/policy`, because an open policy package that cannot notify anyone
is not complete for its purpose and would break the hard rule in its first week.
The Slack and Teams implementations live in a separate paid package
implementing that interface.

_Amendment two, the verifier's independence is structural._ It ships as its own
installable package with no VOID dependencies, the ledger format is documented
well enough that a second verifier can be written in another language, and the
commitment that it never moves is written into its own README.

_Amendment three, DCO sign off, not a CLA._ Apache 2.0 section 5 already
licenses inbound contributions under the same terms. A CLA is the specific
instrument that makes a future relicence possible, which is the move the hard
rule promises never to make, so refusing to collect one is a credible commitment
rather than a statement of intent. It is also friction placed exactly on the
registry contribution flow that GO-TO-MARKET depends on.

_Amendment four, a NOTICE requirement on the registry data_ carrying
`REGISTRY_DISCLAIMER` verbatim, so the "draft classifications, not vendor
certified" label travels with the data wherever it is embedded. Once someone
puts those classifications into their own policy engine, that label is the only
thing between an illustrative classification and a false assurance.

**Rationale.** The safety argument for the line is stronger than the commercial
one: nobody puts a closed proxy in front of their production database on a
stranger's word, so the component that intercepts, classifies and holds must be
readable by the person putting it in their write path. Apache 2.0 over MIT for
two clauses that cost nothing now and matter later: the express patent grant in
section 3, which is what a corporate legal reviewer looks for before allowing a
security component into a write path and is the question that stalls exactly
this kind of review, and the trademark reservation, which keeps the VOID name
when a gateway vendor forks the proxy. Under a cheapest bias the same conclusion
arrives differently: an open, dependency light core is the only distribution a
solo operator cannot buy with money, and the MCP registry, GitHub search and the
registry entry pages only work for something installable without a sales call.

The operational test that makes the line decidable in the moment, and which
would have caught the Slack collision: **before anything merges into a paid
package, ask whether a solo developer protecting one Postgres could do their job
without it. If the answer is no, it belongs open.**

Grafted from the losing logs: the Slack channel split (independently in two
logs), the DCO amendment and the operational test (fastest), the registry NOTICE
requirement (safest), and the maintenance bound and the MIT correction below
(cheapest).

**Two housekeeping items this creates.** The root `package.json` currently
declares `"license": "MIT"` for the whole workspace. That is an inherited
default, not a decision, and it has to be resolved deliberately: the site stays
as it is, each new package carries its own Apache 2.0 `LICENSE` and header, and
a root `NOTICE` is added. Second, open source maintenance is real work for one
person and gets bounded up front rather than discovered: `CONTRIBUTING.md` says
registry data pull requests are welcome, connector pull requests are by prior
agreement only, and feature requests need a described use case, and the README
states there is no support obligation on the open packages.

**What this costs.** Approvals, budgets and the control plane must sit behind a
package boundary from day one rather than behind a feature flag inside an open
package, which costs a little structure in WP-10 and WP-11 and rules out the
shortcut of building them inline and separating later. Publishing the proxy and
the ledger means a competitor can lift the interception spine, so defensibility
sits in the registry data, the connectors and the hosted control plane, which is
the same conclusion the BUILD-PLAN risk register reaches about native approval
hooks commoditising the hold. And the free tier is genuinely sufficient for one
developer protecting one system, so conversion depends entirely on the team
features being good rather than on artificial limits.

| Rejected                                                      | Why not                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIT, matching the current root `package.json`                 | No patent grant and no trademark clause, and no compensating benefit. For a component in a regulated buyer's write path, that omission turns a one afternoon legal review into a long one.                                                                                                                                              |
| AGPL for the proxy and the ledger                             | Puts a copyleft question in front of every security review of a component that must be read before it is installed, and deters the platform teams who should adopt it into reimplementing interception badly. It also defends the wrong asset: what a reseller would take is the control plane, which is paid and closed anyway.        |
| BSL or the Elastic License with a delayed conversion          | Not open source, so distribution through the MCP registry and package channels weakens and the registry loses its contributors. It also invites precisely the licence change story the hard rule exists to prevent.                                                                                                                     |
| SSPL                                                          | Not OSI approved, rejected by several distribution channels, and it undermines the "read the code before you put it in your write path" argument the open core exists to make.                                                                                                                                                          |
| Closed core with an open SDK                                  | Inverts the readability requirement: the parts that must be auditable, the interceptor and the ledger, would be the closed parts.                                                                                                                                                                                                       |
| Fully open with no paid line                                  | No revenue path, and the organisational features (hosted approvals, SSO, retention, exports) are the ones with real running cost, so giving them away means paying to serve users who cannot pay back.                                                                                                                                  |
| A CLA, to keep future licensing options open                  | Keeping that option open is the thing the hard rule promises not to do. Declining a CLA is what makes the promise cost something and therefore mean something.                                                                                                                                                                          |
| Two repositories from the start                               | The cleanest long term boundary and a direct tax now. One repository with a root Apache 2.0 `LICENSE`, a per-directory `LICENSE` under `apps/control-plane`, and SPDX headers where the line actually runs gives the same clarity. Splitting is a day whenever it becomes necessary, which is when a paying customer's legal team asks. |
| Opening the taint graph, budgets and attestation mappings now | They are organisational features and belong on the paid side from day one. Moving them across later would be the exact licence change the model forbids, so the line has to hold before there is pressure on it.                                                                                                                        |

**Revisit when.** A cloud provider ships a hosted VOID, **or** a customer's
procurement rejects Apache 2.0 for a reason that is not the patent grant. The
hard rule itself is not revisitable: open features stay open. New organisational
features may land paid.

---

## 6a. The test runner

**Decision.** What runs `pnpm test`, which is the first exit criterion in the
whole build.

**Choice.** `node:test` with the runtime's native TypeScript type stripping, and
**no flag**. Zero new dependencies. Each package gets `"test": "node --test"`,
the root gets `"test": "pnpm -r --if-present run test"`. Assertions come from
`node:assert/strict`.

Four rules follow and go into `STANDARDS.md`:

- Every package declares `"type": "module"`, otherwise Node reparses each test
  file as ESM after failing to read it as CommonJS and warns on every run.
- Every package tsconfig sets `erasableSyntaxOnly` and `verbatimModuleSyntax`,
  so `tsc` rejects at typecheck time the syntax Node cannot strip, rather than
  letting it fail at run time. No `enum`, no `const enum`, no `namespace`, no
  parameter properties, no `import =`. Type only imports are written
  `import type`.
- Relative imports inside the new packages carry an explicit `.ts` extension.
- Do not pass a directory as the argument. Use bare `node --test` or a quoted
  glob.

**Rationale.** **Verified** on this machine, Node 22.22.2, during WP-00: a
`.test.ts` file with a type alias and a type annotation runs and passes under
bare `node --test` with **no flag and no warning on stderr**; a failing
assertion exits 1, so CI gating is real; and an `enum` is rejected at load with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Type stripping has been on by default since
Node 22.18.

Two of the three deciders reached for `--experimental-strip-types`. The flag is
omitted deliberately: passing an experimental flag that a future runtime removes
turns a green test command into a hard startup error, whereas relying on the
pinned engine's default degrades to a one word fix if an older 22.x is ever
used. The flag is also unnecessary here, which is the stronger argument.

Against that, `vitest` brings a dependency tree into a workspace whose root
`node_modules` holds six entries today, plus a config file per package, plus a
1440 minute wait on any future version bump including an urgent one, because
`pnpm-workspace.yaml` sets `minimumReleaseAge` and its own comment calls that a
critical supply chain defence and tells you not to disable it. The cheapest way
to honour that setting is to add nothing that needs excluding. And this is a
security product whose tests will eventually run with a live Postgres, a signing
key and real credentials in the process: zero new packages is the choice a
reviewer signs off without reading a lockfile diff, and it means the test
harness can never be the thing that compromises the ledger it is testing.

Grafted from the losing logs: `erasableSyntaxOnly` and `verbatimModuleSyntax` in
the shared tsconfig, which makes the stripping constraint a compile error rather
than a runtime surprise (fastest and safest); the verified directory-argument
caveat (safest); the recursive root script (safest).

**What this costs, honestly.** No `expect` API, no snapshot testing, no watch
mode UI, no built in DOM, and mocking limited to `mock.fn`, `mock.method` and
`mock.timers`, which does cover the injectable clock the rate limiter needs but
makes module substitution awkward. Packages therefore take their dependencies as
parameters, which is what `packages/ledger` should be doing anyway. Expect
slower authoring for roughly the first week and one or two small assertion
helpers. The switching cost is low in both directions: `describe`, `it` and
`test` map onto vitest almost one to one, so a later move is a script change and
an import rename, not a rewrite.

**One discrepancy to fix while in this code.** `README.md:81` says Node.js 24,
`package.json` `engines` says `22.x`, and the installed runtime is 22.22.2. Pick
one and correct the other two.

| Rejected                                        | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| vitest                                          | The better runner by a wide margin, and it is a large new dependency tree entering under a 1440 minute release age gate, in the repository of a security product, for tests that will hold credentials and drive a live database, plus a second config file and a second module resolver next to `tsc`, `esbuild` and `vite`. The ergonomics do not pay for the supply chain surface at WP-00, and the decision is cheap to reverse later. |
| `tsx` plus `node:test`                          | Adds a runtime transform dependency to do what the runtime now does natively and verifiably. It was the right answer before Node 22.18 and is not any more, and it would only buy `enum`, which STANDARDS bans anyway.                                                                                                                                                                                                                     |
| Jest                                            | Heaviest of the three, needs `ts-jest` or a babel transform, and has the most fragile ESM story in a workspace that is ESM by default everywhere except `api/`.                                                                                                                                                                                                                                                                            |
| uvu, tape or another micro runner               | Still a dependency, with less maintenance behind it than the Node core runner, and no discovery or coverage story that `node --test` does not already have.                                                                                                                                                                                                                                                                                |
| Compiling with `tsc` before every test run      | A build step in front of every test invocation, stack traces pointing at generated code, and an emit directory to keep out of git, with no benefit over stripping types in process.                                                                                                                                                                                                                                                        |
| Passing `--experimental-strip-types` explicitly | Unnecessary on the pinned engine, and it makes the test command fail hard on any future runtime that removes the flag.                                                                                                                                                                                                                                                                                                                     |
| No test harness until a later package           | WP-00's exit criterion is a passing test command, and WP-03's verification (1000 entries, tamper, drop, and four forger attacks) runs through this harness. The ledger cannot be signed off without it.                                                                                                                                                                                                                                    |

**Revisit when.** WP-11, when the control plane UI needs component and browser
testing. The answer there is more likely Playwright than a unit test framework,
because WP-11's exit criteria are keyboard and tap behaviour that a DOM shim
cannot honestly test. Also revisit if the repository moves to Node 24, where
nothing changes but the note about the flag becomes moot.

---

## 6b. Where the registry lives

**Decision.** Whether WP-00 physically moves `api/_registry.ts` into
`packages/registry`, as EXECUTION-PLAN's builder line says.

**Choice.** **Do not move it in WP-00.** Invert the direction instead.

`api/_registry.ts` and `api/_registry_http.ts` stay physically where they are,
byte for byte unchanged. `packages/registry` is created now as the package
boundary, with its `package.json`, `README.md` contract and tests, and
`packages/registry/src/index.ts` is a thin re-export pointing **into** `api/`:

```ts
export * from "../../../api/_registry.ts";
```

`packages/registry` stays `noEmit` until the flip, precisely because that
relative import raises its own inferred emit root above the package. That is
harmless while nothing is emitted and it is the reason the package cannot be
built or published yet, which is fine because there is nothing to publish until
the evaluator exists.

No consumer changes: `registry.tsx` keeps `@shared/_registry`, the Express route
keeps `@shared/_registry_http`, `api/registry.ts` keeps `./_registry_http`.

**Two permanent guards land in WP-00 instead, and they are the actual value of
this decision.**

1. Add `"rootDir": "."` to `api/tsconfig.json` `compilerOptions`.
2. Make `pnpm run typecheck` assert the emit **layout**, not only the exit code:

```
rm -rf .tsc-api-emit \
  && tsc -p api/tsconfig.json --outDir .tsc-api-emit \
  && test -f .tsc-api-emit/registry.js \
  && test -f .tsc-api-emit/waitlist.js \
  && ! test -e .tsc-api-emit/api \
  && rm -rf .tsc-api-emit
```

**Rationale.** The failure mode here is silent, it has already broken this
repository's deploy once, and two readers contradicted each other about it, so
the contradiction is settled on the record.

`api/tsconfig.json` sets no `rootDir` and includes `**/*.ts`, so TypeScript
infers the emit root as the common source directory of every non `node_modules`
file in the program. Today that is `api/`, and the emit is flat: 22 files,
`_core.js` through `waitlist.js`, no `api/` subdirectory (**verified** at WP-00
by `npx tsc -p api/tsconfig.json --outDir /tmp/emit`, exit 0). That flat layout
is load bearing: `api/registry.ts` must land at `<out>/registry.js` or Vercel
cannot find the entrypoint for **any** route.

Reader B recommended `export * from "../packages/registry/src/index"` in
`api/_registry.ts`, reasoning that `api/tsconfig.json` has no `paths` and no
`baseUrl` so a bare specifier will not resolve. **That reasoning is wrong**: a
bare specifier resolves through `node_modules`, not through tsconfig paths. And
Reader A **proved by isolated experiment** that this exact form is the
regression that breaks the deploy: `tsc` exits 0 with zero diagnostics while the
layout becomes `<out>/api/registry.js` plus `<out>/packages/registry/src/...`,
because pulling one file outside `api/` raises the inferred common source
directory to the repository root and re-parents every compiled function at once.
It passes typecheck, passes lint, passes `build:web`, and fails only when Vercel
cannot find the function. `pnpm run typecheck` runs the real emit into
`.tsc-api-emit` and deletes it without ever looking at the shape, which is why
the regression is silent. **So the relative shim out of `api/` is rejected on
evidence, permanently.**

That leaves the safe move against not moving yet. The bare specifier form
(`export * from "@void/registry"`, package declared as a root dependency) is
**proven safe on the emit half**, even when the package's types resolve to
TypeScript source through a pnpm style symlink, because TypeScript treats
anything resolved through `node_modules` as an external library file and
excludes it from both emit and the common source directory calculation. But the
install and trace half is **unproven** and cannot be proven on this machine. It
has three moving parts that must all be right at once on a platform only
testable by deploying: the package's top level `main` and `types` must point at
CommonJS loadable JavaScript, because `api/tsconfig.json` uses `moduleResolution`
`node` (node10) which never reads an `exports` map, and the api emit is CommonJS
and will `require()` it; that JavaScript must exist **before** the Vercel Node
builder compiles the functions; and `vercel.json`'s `buildCommand` is
`pnpm run build:web`, which filters to `@workspace/void` and would not run a
build script in `packages/registry` at all. So the safe move costs a root
dependency, a dual CommonJS and ESM build, `main`, `module`, `types` and
`exports` kept correct for three resolvers simultaneously (node10 for `api/`,
bundler for vite, esbuild for api-server), a change to `build:web`, a lockfile
change, and a preview deploy to validate Vercel's file tracing of a root
workspace symlink. That is five new failure modes on the deploy path of the
whole API, added inside the scaffolding package everything else depends on, to
buy a file living in a nicer directory.

Nothing needs the move yet. At WP-00 the only consumers are `api/`, vite and
esbuild, and all three read TypeScript source. The inversion is also not novel
here: `artifacts/api-server` has mapped `@shared/*` to `../../api/*` for the
whole life of the site, and its built output proves it works,
`dist/index.mjs:38247` carrying a `// ../../api/_registry.ts` banner with the
entry data inlined.

The guards are verified and permanent. `"rootDir": "."` is a no op with the tree
as it stands (identical flat emit, zero errors) and raises `error TS6059` naming
the offending file the moment a relative import leaves `api/`. That converts a
silent, deploy-breaking re-parent into a typecheck failure forever, for one
line. One caveat to record: `api/tsconfig.json` deliberately does not set
`noEmitOnError`, so a violating build still emits and writes the offending `.js`
next to its source, which wants a `packages/**/*.js` gitignore entry.

**When the move happens, and in exactly what form.** At WP-04a, when the
evaluator lands, the package has to be built and published anyway, and the CLI
imports the registry at runtime where Node's type stripping deliberately does
not apply inside `node_modules`. Then, and only then:

- `api/_registry.ts` becomes, as its entire contents,
  `export * from "@void/registry";` with a header comment explaining that the
  bare specifier is deliberate.
- `@void/registry` is declared in the **root** `package.json` dependencies as
  `"workspace:*"`, in the slot `zod` and `pg` occupy.
- The package carries top level `main` and `types`, not only an `exports` map.
- `main` points at CommonJS that exists before the functions compile; ship dual
  output so vite consumes the ESM entry.
- Build ordering is added to `build:web`.
- It is gated on a preview deploy that curls `/api/registry` and loads
  `/registry` before merge.

**A note for whoever reads the tree.** The registry data physically lives in
`api/` for longer than BUILD-PLAN section 4's picture implies. That reads
backwards and is deliberate. It is stated in `docs/CONTEXT.md` so nobody treats
it as an oversight.

| Rejected                                                                                                                                        | Why not                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move the source and leave a **relative** re-export in `api/_registry.ts` (Reader B's recommendation, and EXECUTION-PLAN's literal builder line) | Proven fatal and proven silent. `tsc` exits 0 with zero diagnostics while every function moves from `<out>/registry.js` to `<out>/api/registry.js`, so Vercel cannot resolve any route. Typecheck, lint and `build:web` all pass through it. This is the exact regression that broke this repository's deploy before.                                                                                   |
| Move the source now and reach it through the bare specifier `@void/registry`                                                                    | The correct long term answer and proven safe on the emit half. Rejected only for sequencing: it costs a root dependency, dual CJS and ESM output, `main`/`types` correct for three resolvers, build ordering in `build:web`, and a preview deploy to validate a trace behaviour that cannot be tested locally, all inside the scaffolding package, to buy nothing until WP-04a. Right form, wrong time. |
| Add a `paths` mapping to `api/tsconfig.json` so a bare specifier resolves without a real package                                                | `paths` affects typechecking only. The emitted CommonJS still `require()`s the literal specifier at runtime, so it resolves during the build and fails at function invocation. That is the worst failure mode, because it looks green.                                                                                                                                                                  |
| Copy the registry into `packages/registry` and keep both                                                                                        | Two sources of truth for the classification data. `replit.md` states the reason the registry is one module: the page, the endpoint and the intercept time classification must not be able to disagree about what a class means. A classifier that disagrees with the published registry is the single worst bug this product can have.                                                                  |
| Generate a JSON artifact into `api/` from a package source                                                                                      | A build step in front of the Vercel function build and a generated file in git that can be stale, for no safety gain, and a second way for the site and the runtime to disagree.                                                                                                                                                                                                                        |
| Leave the registry in `api/` permanently and never create the package                                                                           | The CLI and the proxy will import it at runtime, type stripping does not apply inside `node_modules`, and decision 5 makes it a published open source package. It has to become a real package eventually.                                                                                                                                                                                              |
| Do not create `packages/registry` until WP-04a                                                                                                  | The package boundary and its README are part of the context pack that WP-04a's agents read first. Creating the shell now costs nothing, forces the contract to be written down, and leaves the risky physical move as a separate, independently reviewable commit.                                                                                                                                      |
| Move `_registry_http.ts` as well                                                                                                                | Its only consumers are `api/registry.ts` and the Express route, and the browser deliberately never imports it so URL parsing and `MAX_LIMIT` stay out of the site bundle. Moving it adds risk and buys nothing.                                                                                                                                                                                         |
| Keep WP-00's stated trap check (`tsc -p api/tsconfig.json --outDir /tmp/emit`) as the gate                                                      | Insufficient and demonstrably so: the broken variant exits 0. The gate must assert the shape of the emit, not the exit code.                                                                                                                                                                                                                                                                            |

**Revisit when.** WP-04a lands the case evaluator, **or** anything outside this
repository needs to `import` the registry by package name. Either event triggers
the physical move, in the bare specifier form above, as its own commit gated on
a preview deploy.

---

## Where these decisions are proven, and where they are not

| Claim                                                                                                | Status                                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `api/` emit is flat, 22 files, no `api/` subdirectory                                                | Verified at WP-00, `npx tsc -p api/tsconfig.json --outDir /tmp/emit`, exit 0        |
| A relative import out of `api/` silently re-parents every function                                   | Verified by Reader A in an isolated copy with real `node_modules`                   |
| A bare specifier leaves the flat layout untouched                                                    | Verified by Reader A, including through a pnpm style symlink to TypeScript source   |
| `"rootDir": "."` is a no op today and raises TS6059 on a violation                                   | Verified by Reader A                                                                |
| Vercel resolves a root `workspace:*` link and traces the built CJS main                              | **Unproven.** Needs a preview deploy. This is why 6b defers the move                |
| `push-force` drops an undeclared ledger table in `public`, triggers and all                          | Verified by Reader C against live PostgreSQL 16.13                                  |
| A dedicated `ledger` schema is invisible to `drizzle-kit push`                                       | Verified by Reader C, same server, `No changes detected`                            |
| The grant and ownership split refuses `UPDATE`, `DROP TRIGGER` and `DISABLE TRIGGER` to the app role | Verified by Reader C                                                                |
| The append only triggers refuse UPDATE, DELETE and TRUNCATE                                          | Verified by Reader C, error `ledger_entries is append only: UPDATE denied on seq 1` |
| `sealHash`'s replacer allowlist erases nested fields from the preimage                               | Verified in node                                                                    |
| `node --test` runs `.test.ts` on Node 22.22.2 with no flag and no warning                            | Verified at WP-00                                                                   |
| `enum` is rejected with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`                                          | Verified at WP-00                                                                   |
| A failing assertion exits 1                                                                          | Verified at WP-00                                                                   |
| `node:crypto` signs and verifies ed25519 with no dependency                                          | Verified by two deciders on Node 22.22.2                                            |
| PostgreSQL 16.13 starts here with `pg_ctlcluster 16 main start`                                      | Verified by Reader C, no install needed                                             |


## Local hardening continuation, 11 September 2026

Remove the argument fallback for blast radius. The prior rollout compatibility
rule let an agent claim a small `rows`, `count`, `limit`, or `n` and satisfy an
allow rule without a measurement. This conflicts with the context pack's
measured-count definition. Only a nonnegative safe-integer probe result supplies
a radius. Missing or failed measurements stay unknown and radius rules do not
match. The binary currently has no probe provider, so this can move calls to a
later hold or deny rule; it must not silently authorize an unmeasured write.

Reject malformed policy structures at load time, including null rules, array
matches, unknown classes and invalid count thresholds. YAML parser diagnostics
must not echo the policy source into an agent-visible error.

The control plane remains a local development surface. Enforce a loopback peer,
an explicit local Host with the listening port, and same-origin browser
requests. This blocks DNS rebinding and hostile cross-origin requests without
claiming authentication between local users. Remote authenticated serving is
still a separate feature. Feed verification means signatures checked; hash
integrity alone is stated separately and remains inspectable in the UI.

The root check now includes control-plane typechecking plus its tests and the
script test suite. Script tests run from the repository root because their
fixtures resolve relative paths there. No dependencies or lockfile changes.

## Beta workbench and web gateway, 2026-09-11

The user's ASCII direction from Dawe583/void-empty takes precedence over literal
Apple branding in GUI-RULES.md. Keep Apple's touch sizing, hierarchy and keyboard
accessibility while sharing one paper/CRT stylesheet across GUI pages.

The optional workbench originates model requests through the SDK; the proxy
itself remains an interceptor. Provider/session logic lives in @void/workbench.
Vercel hosts a stateless authenticated gateway, while a persistent runtime owns
MCP sessions, approval brokers and signed JSONL storage. There is no claim that
function-local disk is durable. See BETA.md for configuration and open scope.

Replay gains pg and AWS SDK transport adapters. PGlite is a development-only SQL
engine used to validate real foreign-key behavior during cascade restoration.
The reviewed core checks pass; external customer resources remain unverified.

## Entire web application on Vercel, 2026-09-11

The user clarified that the web app includes its backend on Vercel. This
supersedes the external runtime gateway decision above. Nitro and Vercel
Workflow host the cloud API and agent loop; Neon from Vercel Marketplace holds
durable state and signed evidence. The old gateway is retained as an optional
local module and is no longer a root Vercel API route.

Keep provider and tool secrets encrypted in Neon with a separate environment
key. Hold decisions persist across functions. Before dispatch, persist an
execution marker and authorization record. If execution becomes ambiguous,
refuse automatic retry. Model calls use Vercel AI Gateway OIDC by default or a
validated custom provider. Catalog discovery alone does not prove billing or
account verification permits generation.
