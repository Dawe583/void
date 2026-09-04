# @void/ledger

The append only record: hash chain, canonicalisation, signing, verification.

## Responsible for

Turning an intercepted call into an entry that a third party can verify offline,
and refusing to acknowledge anything it did not durably persist. Two stores
behind one interface: an append only JSONL file per workspace for the dev tier
(`fsync` before the append is acknowledged), and Postgres in a dedicated `ledger`
schema for the hosted tier. It owns its own `pg` pool and its own forward only
SQL migrations, which is the second migration mechanism in this repository.

Append only is four layers: the type system, Postgres grants, triggers, then the
chain and the per entry signature. Only the last survives an attacker who owns
the database, so the honest claim is tamper **evident**, not tamper proof.

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
  method that mutates. No `update`, no `delete`.
- `KeyProvider`: `alg`, `currentKeyId`, `sign`, `publicKey`. Async from the first
  line because every KMS is a network call, and with no way to export private key
  material.
- `Alg`, `LEDGER_PREIMAGE_VERSION`, `signingPreimage`.

The stores, the canonicaliser and the verifier are WP-03 and do not exist yet.
