# VOID: standards

The rules code in this repository must follow. Written 4 September 2026, at
WP-00. Read with `docs/CONTEXT.md` and `docs/DECISIONS.md`; those three are the
context pack and they are authoritative. When code disagrees with the pack, the
code is wrong.

Rules here are not style preferences. Each one is here because breaking it has
cost this repository a deploy, a build, an hour of debugging, or would cost the
product its claim.

---

## 1. No em dash, no en dash. Anywhere.

Not in code, comments, documentation, commit messages, site copy, YAML, SQL
comments, error strings or test names. Use a comma, a colon, a semicolon, a full
stop, or restructure the sentence. The hyphen `-` is fine: it is a different
character and it is what markdown lists, tables and compound words use.

Forbidden characters: `—` (U+2014 em dash) and `–` (U+2013 en dash).

Wrong, then right:

```
The ledger is append only — the type system enforces it.
The ledger is append only, and the type system enforces it.

Hold the call — up to 120 seconds — then deny.
Hold the call for up to 120 seconds, then deny.

Two stores — JSONL and Postgres — behind one interface.
Two stores, JSONL and Postgres, behind one interface.

// R2 means mitigable only – there is no true inverse
// R2 means mitigable only: there is no true inverse
```

Check before you commit:

```
git diff --cached | LC_ALL=C.UTF-8 grep -nP '[\x{2013}\x{2014}]'
```

An empty result is the pass. If your editor has smart punctuation or an em dash
substitution, turn it off.

The four wrong examples above are the only permitted occurrences of those two
characters in the repository, because a rule that cannot show the character it
forbids is not stated unambiguously. A whole-tree check therefore excludes this
one file:

```
LC_ALL=C.UTF-8 grep -rnP '[\x{2013}\x{2014}]' . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude=STANDARDS.md --exclude=pnpm-lock.yaml
```

---

## 2. Comments explain why, not what

A comment earns its place by carrying something the code cannot: a constraint, a
failure that was hit before, a reason a slower or uglier form was chosen. If a
comment restates the line beneath it, delete the comment.

Match the surrounding density and voice. The house style in this repository is a
file header stating the constraint that shaped the file, then very few inline
comments. `api/_core.ts`, `api/_store.ts` and `api/tsconfig.json` are the
reference for that voice; read one before adding to it.

Wrong:

```ts
// import pg statically
import pg from "pg";

// loop over the entries
for (const entry of entries) {
```

Right:

```ts
// Static, not dynamic. A dynamic import("pg") bundled into ESM output dies at
// runtime with "Dynamic require of events is not supported", and the storage
// fallback hides that as a quiet stored: false.
import pg from "pg";
```

The same rule governs a file header. State the constraint, not the contents:

```ts
/**
 * Canonical JSON for the ledger preimage.
 *
 * Deliberately recursive. The prior art in api/_core.ts passed a replacer
 * allowlist computed from top level keys, which JSON.stringify then applies at
 * every depth, so every nested value was erased from the preimage while the
 * entry still looked sealed.
 */
```

---

## 3. Tests: `node:test`, no dependency, no flag

Decision 6a. The runner is Node's own, and TypeScript runs through the runtime's
native type stripping.

Scripts:

```jsonc
// packages/<name>/package.json
{ "type": "module", "scripts": { "test": "node --test" } }

// package.json at the root
{ "scripts": { "test": "pnpm -r --if-present run test" } }
```

Rules that follow, all of them load bearing:

- Every package declares `"type": "module"`. Without it Node reparses each test
  file as ESM after failing to read it as CommonJS and warns on every run.
- Every package tsconfig sets `erasableSyntaxOnly` and `verbatimModuleSyntax`,
  so `tsc` rejects at typecheck time the syntax Node cannot strip. **No `enum`,
  no `const enum`, no `namespace`, no parameter properties, no `import =`.** Use
  a union of string literals where you reach for an enum, which is what
  `RegistryTone` already does.
- Type only imports are written `import type`.
- Relative imports inside packages carry an explicit `.ts` extension.
- Do not pass a directory as the argument. `node --test somedir/` fails with
  `MODULE_NOT_FOUND` on Node 22. Use bare `node --test`, or a quoted glob.
- Do not pass `--experimental-strip-types`. It is unnecessary on the pinned
  engine and it turns the test command into a hard startup error on any future
  runtime that removes the flag.
- Assertions come from `node:assert/strict`. Never the loose `node:assert`.
- Take dependencies as parameters. Module substitution is awkward here, and a
  package that takes its clock, its store and its signer as arguments is easier
  to test and better designed anyway.

A worked example, `packages/ledger/src/canonical.test.ts`:

```ts
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { canonicalJson } from "./canonical.ts";

describe("canonicalJson", () => {
  test("sorts keys at every depth, not only the top", () => {
    // The defect in the prior art: a top level replacer allowlist erased every
    // nested value while the entry still hashed to something that looked sealed.
    const a = { b: 1, meta: { z: "last", a: "first" } };
    const b = { meta: { a: "first", z: "last" }, b: 1 };

    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(canonicalJson(a), '{"b":1,"meta":{"a":"first","z":"last"}}');
  });

  test("refuses values that do not round trip", () => {
    assert.throws(() => canonicalJson({ n: Number.NaN }), /non-finite/);
    assert.throws(() => canonicalJson({ u: undefined }), /undefined/);
  });
});
```

Run it:

```
pnpm test                                  # every package
node --test packages/ledger/src/canonical.test.ts   # one file
```

A failing assertion exits 1, so the command gates CI honestly.

---

## 4. Commit messages

The convention already in use in this repository. Read
`git log -6 --format=%B` before your first commit and match it.

- **Subject line:** imperative mood, sentence case, no full stop, no `feat:` or
  `fix:` prefix, under 72 characters. A colon mid-subject to name the subsystem
  is fine when it earns its place: `Fix the Vercel function build:
  api/tsconfig.json could not emit`.
- **Blank line**, then the body.
- **Body:** prose paragraphs wrapped at 80 columns, explaining why the change
  exists and what a reviewer needs in order to check it. It is not a changelog
  of files; the diff already lists those. Indented sub-paragraphs and lists are
  used where the change has several parts. Where a work package's exit criteria
  ran, the evidence goes in the body.
- **Trailers**, last, after a blank line:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<id>
```

- No em dashes or en dashes in the message. Rule 1 applies here too.
- Commit or push only when asked. If you are on the default branch, branch
  first.

Example shape:

```
Move the ledger into its own Postgres schema

drizzle-kit push reconciles only the public schema, and a ledger table that
lives there but is not declared in lib/db/src/schema/index.ts is dropped by a
routine push-force, triggers and all, with a success message. DROP TABLE does
not fire a BEFORE DELETE trigger, so the append only guard is no defence.

Verified against PostgreSQL 16.13: the same push-force against a table in a
dedicated ledger schema reports "No changes detected" and leaves the row and
all three triggers intact.
```

---

## 5. `api/` may import only npm packages and relative files inside `api/`

Anything under `api/` may import **only** npm packages that resolve from the
**repository root** `node_modules`, and relative files that live **inside**
`api/`. No `@workspace/*`, no `@void/*` unless it is declared in the root
`package.json`, and never a relative path that leaves the directory.

Two different failures, and the second is worse:

1. **A workspace package specifier fails at runtime, after a green build.**
   Vercel installs and bundles from the repository root, where `@workspace/*`
   does not resolve. Locally it resolves through the artifact's own
   `node_modules`, so it looks fine until the function is invoked. This is why
   `zod` and `pg` are declared in the root `package.json` rather than only in
   the artifact.

2. **A relative path out of `api/` fails at routing time, with no error
   anywhere.** `api/tsconfig.json` includes `**/*.ts` and TypeScript infers the
   emit root as the common source directory of every non `node_modules` file in
   the program. Today that is `api/`, so the emit is flat and
   `api/registry.ts` lands at `<out>/registry.js`, which is where the Vercel
   Node builder looks for it. Pull in one file from outside `api/` and the root
   rises to the repository root, every compiled function moves to
   `<out>/api/*.js` at once, and Vercel cannot find the entrypoint for **any**
   route. It exits 0 with zero diagnostics, passes lint and passes `build:web`.

Guards, both permanent:

- `api/tsconfig.json` sets `"rootDir": "."`, which turns a violation into
  `error TS6059` naming the offending file.
- `pnpm run typecheck` asserts the emit **layout**, not just the exit code:

```
rm -rf .tsc-api-emit \
  && tsc -p api/tsconfig.json --outDir .tsc-api-emit \
  && test -f .tsc-api-emit/registry.js \
  && test -f .tsc-api-emit/waitlist.js \
  && ! test -e .tsc-api-emit/api \
  && rm -rf .tsc-api-emit
```

Three more rules in the same area:

- `api/tsconfig.json` must describe a **real emit**. `noEmit: true` there fails
  the deploy with `Error: api/contact.ts: Emit skipped`.
- `api/_registry.ts` is compiled into the **browser** bundle through the vite
  alias, so it may not import a node builtin. `api/_core.ts` and `api/_store.ts`
  are exempt because no browser code imports them.
- `pg` stays a **static** import in `api/_store.ts`. A dynamic `import("pg")`
  bundled into ESM output dies with "Dynamic require of events is not
  supported", and the storage fallback hides it as a quiet `stored: false`.
- Do not exclude workspace packages in `.vercelignore`.
  `pnpm install --frozen-lockfile` fails if a package the lockfile knows about
  is missing from the upload.

---

## 6. No build config may throw on a missing environment variable

Not `vite.config.ts`, not `drizzle.config.ts`, not an `esbuild` script, not
anything the build loads. Default the value, or resolve it lazily at the point
of use and let the operation fail with a message naming the variable.

A `throw` at module scope makes `pnpm run build` fail on every machine that does
not happen to have that variable set, including CI and including a contributor's
first clone. `PORT` and `BASE_PATH` did exactly that once.

Wrong:

```ts
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}
```

Right:

```ts
// Default rather than throw: this file is loaded by the build, and a build that
// fails on a machine without a database is a build nobody outside CI can run.
// The connection then fails with a message that names the variable.
const url = process.env.DATABASE_URL ?? "postgresql://localhost:5432/void_dev";
```

The same rule applies to runtime code that a build imports. `lib/db` throws at
import time on a missing `DATABASE_URL`, `replit.md` says the mitigation lives
in a `storage.ts` that does not exist anywhere in this repository, and nothing
imports the package today. Do not import `@workspace/db` from product code.
`packages/ledger` owns its own pool.

**The one exception, and it is not this rule.** The ledger fails closed. If it
cannot durably persist an entry, `append` throws and the intercepted call is
denied. That is a runtime refusal on the write path, not a build config throwing
on a missing variable, and it never degrades to memory and never returns a
receipt for something it did not persist.

---

## 7. Never point an autonomous agent with computer use at a production account

From BUILD-PLAN.md section 3, and it is a hard rule, not a guideline.

Test accounts, disposable projects, a separate cloud account with a spend cap,
and a non production database for every end to end run. The model classes now in
use can find and exploit unknown vulnerabilities across defended systems without
step by step guidance, and VOID is a product that will hold credentials and sit
in a privileged position in someone else's infrastructure.

The moment you are tired and it would be convenient is the moment it costs you.

Concretely:

- No production `DATABASE_URL`, API key, or cloud credential in any development
  shell, test fixture, `.env`, or agent session.
- Every connector's tests run against a local or disposable target.
- Nothing autonomous gets write access to anything a customer could see.
- Secrets never enter a ledger entry, a log line, a test snapshot or a commit.
  The ledger stores a **digest** of the payload, never the payload.

---

## 8. Every exit criterion is a command that runs

A work package is not finished when the code looks right. It is finished when a
command exits 0 in this environment and the output has been read.

- An exit criterion is a shell command with an observable result, not a
  sentence. "The proxy forwards notifications" is not an exit criterion.
  `pnpm test` is. `curl -s localhost:8080/api/registry?view=stats | grep
  '"entries":89'` is.
- The command must assert the **thing that breaks**, not a proxy for it. A
  `tsc` exit code does not assert an emit layout, because the broken variant
  exits 0. Assert the layout.
- Prefer a check against real infrastructure over a check against a mock. The
  failure mode of an undo feature is a passing test over a mocked client. There
  is a real PostgreSQL on this machine; use it.
- If a criterion cannot be run here, say so in the same breath and name what
  would prove it. `docs/DECISIONS.md` marks such claims **unproven** and the
  same discipline applies to a work package's evidence.
- Paste the output. An exit criterion whose output nobody read did not run.

---

## 9. TypeScript and package shape

- `strict` everywhere. No `any` that is not accompanied by a comment saying why
  the type cannot be known.
- Erasable syntax only, per rule 3.
- `packages/registry` imports nothing: not the ledger, not a workspace package,
  not a node builtin. It is data and pure functions, which is why the browser,
  the API and the runtime can all read it.
- A connector never imports another connector.
- The proxy never imports a connector directly. It resolves them through a
  registry of connector ids, so adding a tool surface is additive.
- The ledger is append only **in the type system**, not only by convention.
  Export `append` and `read`. Do not export `update` or `delete`.
- No new dependency without a reason written into the commit body.
  `pnpm-workspace.yaml` sets `minimumReleaseAge` to 1440 minutes as a supply
  chain defence. Do not disable it, and prefer adding nothing that would need
  excluding from it.
- Public interfaces that will later be backed by a network call are `async` from
  the first line, even when today's implementation is synchronous.

---

## 10. Product honesty

- No fabricated companies, logos, customers, certifications or metrics. Anything
  illustrative carries a visible "illustrative" label, on the site and in the
  control plane alike.
- `REGISTRY_DISCLAIMER` travels with the registry data verbatim, wherever the
  data goes. Those classifications are draft and not vendor certified, and that
  label is the only thing between an illustrative classification and a false
  assurance.
- State a limitation where a reader will hit it, not in a footnote. The JSONL
  ledger is tamper **evident**, not tamper proof. A database superuser bypasses
  every grant and trigger, which is exactly why entries are signed. A declared
  precondition is only as honest as the operator's config file.
- A denial message names the rule id, the class and what approval would require.
  A generic error trains agents to retry with a reworded request, which turns a
  safety tool into an evasion trainer.

---

## 11. If you touch the site or the control plane

`artifacts/void/src/index.css` is the entire design system: tokens, both themes,
every keyframe. Change colours there and nowhere else.

- Never write a colour literal in a component. Every colour is a
  `var(--token)`. That is what makes the theme toggle work and it is the only
  thing keeping the control plane and the site from drifting.
- Reversibility class is only ever `--ok`, `--info`, `--warn`, `--bad`, carried
  as a `data-tone` attribute plus the tone name as text. `--accent` is brand
  only and never means a class.
- No shadows, no gradients, no rounded cards. Radii are 2px on controls and the
  22px pill on `.btn`. Hover is a background tint of `var(--a04)`, never a lift
  or a shadow. Cells are separated by 1px `var(--line)` rules at `gap: 0`.
- Serif for headlines, sans for body copy, mono for everything else: every
  label, kicker, tag, button, table header, caption, number and status word.
- Prefix every keyframe with `v-`. Tailwind ships `ping`, `spin`, `pulse` and
  `bounce`, and an unprefixed keyframe is silently overridden.
- Never write a bare descendant `span` rule; scope to `> span`. Never set
  `display: grid` on a `ul` or `ol` that needs its markers.
- Honour `prefers-reduced-motion`, animate transform and opacity only, and never
  animate `filter: blur()`.
- No hover only affordances. Everything reachable by hover is reachable by tap
  and by keyboard.

Before building a new view, read `sections/hold.tsx`, `sections/replay.tsx` and
`pages/attestation.tsx`. The component almost certainly already exists.

---

## 12. Known discrepancies to fix, not to copy

- `README.md:81` says Node.js 24, `package.json` `engines` says `22.x`, and the
  installed runtime is 22.22.2. Pick one and correct the other two.
- `replit.md:88` points the `lib/db` mitigation at a `storage.ts` that does not
  exist. Correct the gotcha when WP-03 lands.
- `lib/db/drizzle.config.ts:4` throws on a missing environment variable, which
  breaks rule 6. It is contained only because `push` is not on the build path.
- The comment in `api/tsconfig.json` says `pnpm run typecheck` passes
  `--noEmit`. It passes `--outDir`.
- Introducing raw SQL DDL for the ledger gives this repository **two** migration
  mechanisms. Write the second one into `replit.md` and `README.md` in the same
  commit, or the next agent will not know it exists.
