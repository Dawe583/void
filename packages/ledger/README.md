# @void/ledger

The append only record: hash chain, canonicalisation, signing, verification.

## Responsible for

Turning an intercepted call into an entry that a third party can verify offline,
and refusing to acknowledge anything it did not durably persist. Two stores
behind one interface: an append only JSONL file per workspace for the dev tier
(the file handle is fsynced before the append is acknowledged), and Postgres in
a dedicated `ledger` schema for the hosted tier at WP-06. It owns its own `pg`
pool and its own forward only SQL migrations, which is the second migration
mechanism in this repository.

Append only is four layers: the type system, Postgres grants, triggers, then
the chain and the per entry signature. Only the last survives an attacker who
owns the database, so the honest claim is tamper **evident**, not tamper proof.

## Known limitation of the dev tier

The JSONL store is single writer per workspace file. Two proxy processes on one
workspace need the Postgres tier. Concurrent appends from one process can fork
the chain; `verify` catches the fork and names the entry where the links
diverge, so the failure is detectable, not silent. The Postgres store closes
this with a per workspace advisory lock at WP-06.

## Must never import

`@workspace/db`, which throws at import time on a missing `DATABASE_URL`. No
userland crypto library: signing is `node:crypto` ed25519 and that is the entire
cryptographic dependency budget. It does not import the proxy, the policy engine
or a connector; it is called by them.

## Must never do

Degrade to memory. `api/_store.ts` does that for the waitlist and it is
catastrophic here: a receipt returned for a record that died with the process is
manufactured evidence. If it cannot persist, `append` throws and the intercepted
call is denied.

Persist a truncated digest. `api/_core.ts` returns 8 hex characters; the chain
stores all 64, truncated only at the render boundary.

## Public surface

- `LedgerStore`: `append`, `read`, `head`, `verify`, and there is never a fifth
  method that mutates. No `update`, no `delete`. `append` takes the caller's
  body; `read` yields the stored entry, body plus chain metadata.
- `KeyProvider`: `alg`, `currentKeyId`, `sign`, `publicKey`. Async from the first
  line because every KMS is a network call, and with no way to export private key
  material.
- `Alg`, `LEDGER_PREIMAGE_VERSION`, `signingPreimage`.
- `canonicalJson`, `entryHash`, `GENESIS_PREV`: the canonical form and the entry
  digest. Two runtimes must agree byte for byte on the same entry.
- `devKeyProvider`, `keyProviderFromPkcs8`, `verifySignature`: the ed25519 dev
  key path and signature verification, node:crypto only.
- `jsonlStore`: the dev tier store. One JSONL file per workspace at
  `VOID_LEDGER_DIR` (default `~/.void/ledger`), 0700 directory, fsync before
  the append is acknowledged.

The Postgres store is the hosted tier and lands with its own migrations at
WP-06, behind the same interface. WP-03 sharpened `LedgerStore` to three type
parameters, `Body, StoredEntry, Receipt`: the caller brings a body, the file
holds the entry with chain metadata, and `verify` recomputes every link and
signature rather than trusting what is stored. The distinction is recorded in
DECISIONS 2.
