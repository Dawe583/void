# Declared facts, WP-04a

The evaluator reads a map of declared fact names to values. Facts come from
the operator's configuration, never from probes: a classification is only as
honest as the config file, which is the limitation the plan names and keeps
visible rather than hidden behind an automated guess.

## Where a fact is used

A registry case carries its `when` prose for display and, once migrated, an
`if` precondition in the structured form `schema.json` describes. The
evaluator matches a case when its precondition holds against the declared
facts and the intercepted call's arguments.

## Known fact names

The pilot migration covers these entries and names; the full migration
extends the list and this file is the index.

| Fact name | Type | Meaning |
| --------- | ---- | ------- |
| bucket.versioning | string | The S3 bucket's versioning state, exactly as the API reports it: Enabled or Disabled or Suspended. |
| bucket.mfa_delete | string | The S3 bucket's MFA delete state, as the API reports it: on or off. |
| pg.instance.backup | string | Whether the Postgres instance has a restorable backup path, e.g. "wal" or "snapshot" or "none". |
| stripe.mode | string | The Stripe account mode: live or test. |

A fact value is a string or a boolean. The precondition grammar compares
strings exactly and treats booleans with presence, because `is` on a boolean
fact has no honest string form: the evaluator compares the boolean's presence,
not the string "true".

## Staleness

Each declared fact carries `verifiedAt` and `source`. A fact older than the
configured window is stale: it still evaluates, because staleness is a
warning to the operator, not a silent denial, and the report the loader
returns carries the stale list so the CLI can show it.
