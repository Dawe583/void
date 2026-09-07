# @void/cli

The `void` command.

## Responsible for

The operator's entire interface to VOID on the dev tier: wrapping an agent
session (`void run`), verifying a ledger (`void ledger verify`), replaying an
inverse (`void replay`), and exporting an attestation (`void attest`). It is the
surface that has to work with no database, no account and no network, because the
free tier is a local ledger in a file.

WP-09 lands the command handlers. Only the invocation parser and the WP-09b
terminal render model (`src/tui/`) exist today; no command is runnable yet, and
`void watch` currently resolves in the parser only.

## Must never import

`@workspace/*` or anything from the site. It composes the product packages
(`@void/proxy`, `@void/ledger`, `@void/policy`, `@void/registry`) and owns no
domain logic of its own: anything worth testing belongs in the package that owns
it, not in an argument parser.

## Must never do

Print a secret. Not in a verbose mode, not in an error, not in a receipt. The
ledger stores a digest of a payload, never the payload, and the CLI is the place
where that rule is easiest to break by accident.

Exit 0 on a verification it could not complete. `void ledger verify` exits
non-zero when the chain does not verify, and reports an entry signed by a `dev-`
key as valid, development key, never as plain valid.

## Public surface

- `COMMANDS`, `Command`
- `ParsedInvocation`, `parseInvocation(argv)`
- TUI render model, capability detection, inline, watch and hold renderers from
  `src/tui/`. See `src/tui/README.md` for the visual and degradation contracts.

`parseInvocation` takes argv as a parameter; the process boundary stays in the
bin entry point, which does not exist yet.
