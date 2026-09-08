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
| s3.key.existed | string | Whether the object key existed before the intercepted call, true or false. |
| s3.policy.widens_access | string | Whether the interceptor's diff of the new bucket policy widens access beyond the account, true or false. |
| ec2.instance.root_device_type | string | The instance's root device type, ebs or instance-store. |
| ec2.rule.source_internal | string | Whether the new ingress source is a security group or an RFC1918 range, true or false. |
| pg.capture.before_image | string | Whether the interceptor captured a before image of every matched row, true or false. |
| pg.transaction.void_controlled | string | Whether the statement ran inside a transaction VOID controls, true or false. |
| pg.cascade.traversed | string | Whether a foreign key with ON DELETE CASCADE was traversed, true or false. |
| pg.migration.additive_only | string | Whether the migration is additive only and a down migration exists, true or false. |
| stripe.balance_covers_refund | string | Whether the settled balance can cover a refund of the charge, true or false. |
| stripe.refund.submitted | string | Whether the refund was submitted to the network, true or false. |
| stripe.invoice.is_draft | string | Whether the invoice is still a draft, true or false. |
| slack.channel.private_small | string | Whether the channel is private with fewer than five members, true or false. |
| gmail.recipients.internal | string | Whether every recipient is inside the same Workspace domain, true or false. |
| github.base_branch.deploys | string | Whether deployment or release automation triggers from the base branch, true or false. |
| github.release.is_draft | string | Whether the release is still a draft, true or false. |
| registry.tag.immutable | string | Whether the image registry tag is immutable and previously unused, true or false. |
| fs.shadow.captured | string | Whether the interceptor copied the prior contents to the shadow store, true or false. |
| fs.path.existed | string | Whether the path existed before the intercepted write, true or false. |
| gdrive.delete.trashes | string | Whether the Drive delete call trashes rather than permanently deletes, true or false. |
| hold.released | string | Whether the interceptor's hold already released the call, true or false. |

A fact value is a string or a boolean. The precondition grammar compares
strings exactly and treats booleans with presence, because `is` on a boolean
fact has no honest string form: the evaluator compares the boolean's presence,
not the string "true".

## Staleness

Each declared fact carries `verifiedAt` and `source`. A fact older than the
configured window is stale: it still evaluates, because staleness is a
warning to the operator, not a silent denial, and the report the loader
returns carries the stale list so the CLI can show it.
