# VOID

The reversibility layer for AI agents.

VOID sits between an agent and the tools it can write to. For each call it works
out a reversibility class from the state of the target, applies a policy, and
appends a signed record. Later it can replay the inverses.

The marketing site that describes VOID lives in
[Dawe583/void-empty](https://github.com/Dawe583/void-empty) under MIT. This
repository is the product, under Apache 2.0.

## Status

Being built one work package at a time, following `docs/EXECUTION-PLAN.md`.
WP-00 is complete: the packages exist, the decisions are recorded, the harness
runs. Nothing intercepts a tool call yet.

## The packages

| package            | responsible for                               |
| ------------------ | --------------------------------------------- |
| `@void/registry`   | the reversibility data and the case evaluator |
| `@void/ledger`     | hash chain, signing, verification             |
| `@void/proxy`      | the MCP proxy                                 |
| `@void/policy`     | match rules, decisions, approval channels     |
| `@void/connectors` | per tool surface snapshot and inverse         |
| `@void/cli`        | the `void` command                            |

Each package README states what it is responsible for and what it must never
import. Read it before adding to one.

## Working here

```
pnpm install
pnpm run typecheck     # every package
pnpm test              # every package, and fails a package that ran zero tests
pnpm run check         # both
pnpm run check:mirror  # the registry against the site's copy
```

Tests use the Node 22 built in runner with native type stripping, so there is no
test framework dependency at all. `pnpm test` goes through
`scripts/src/check-tests.mjs` rather than `pnpm -r run test`, because plain
`node --test` exits 0 when it finds no test files, which would make the first
exit criterion of every work package dishonest.

## Preview the terminal interface

The terminal interface is under construction (WP-09b). The render model already
exists and a preview renders it from illustrative fixtures, no proxy required:

```sh
pnpm tui:preview 80 40
pnpm tui:preview 120 40 --hold
pnpm tui:preview 200 48 --modal
```

The preview prints its data as an illustrative fixture. Nothing in it came from
a live session.

## The registry is mirrored into the site, and the mirror is checked

`packages/registry/src/registry.ts` is the canonical copy. The site repository
carries a byte identical mirror at `api/_registry.ts` so its Vercel build never
has to reach this repository, and `pnpm run check:mirror` fails when the two
drift. Clone the site beside this repository, or set `VOID_SITE_REPO`, and the
check runs; without it the check reports that it was skipped rather than passing
quietly.

At WP-15 this repository publishes `@void/registry` to npm, the site imports a
bare specifier instead, and both the mirror and its check are deleted. That also
retires the emit root trap the site's `api/tsconfig.json` currently guards with a
pinned `rootDir`.

## Documents

| file                     | what                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `docs/CONTEXT.md`        | what VOID is and the vocabulary, read this first                        |
| `docs/STANDARDS.md`      | the rules code here follows                                             |
| `docs/DECISIONS.md`      | every foundational choice, what was rejected, and when to revisit       |
| `docs/BUILD-PLAN.md`     | what to build and in which order                                        |
| `docs/EXECUTION-PLAN.md` | that build cut into work packages                                       |
| `docs/GO-TO-MARKET.md`   | positioning, pricing and the business case, not for a public repository |

## Licence

Apache 2.0. See `LICENSE` and `NOTICE`.

The registry classifications are a draft reviewed against public vendor
documentation and certified by no vendor. No vendor named in it has reviewed or
endorsed the classification of their API.
