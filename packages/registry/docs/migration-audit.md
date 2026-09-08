# Registry migration audit

Audit target: `packages/registry/src/registry.ts` after `migrate-batch2` reported completion.

## Summary

| Metric | Value |
| --- | --- |
| Entries | 89 |
| Fully migrated entries | 88 |
| Partially migrated entries | 0 |
| Unmigrated entries | 1 |
| Cases | 178 |
| Cases with structured if | 177 |
| Fact names used by ifs | 87 |
| Fact name strays | 0 |

## Entry table

| id | migrated | case count | fact names used | not-expressible cases or audit note |
| --- | --- | --- | --- | --- |
| aws.s3.object.put | yes | 3 | bucket.versioning, s3.key.existed | none |
| aws.s3.object.delete | yes | 3 | bucket.mfa_delete, bucket.versioning | case 0 mismatch |
| aws.s3.bucket.delete | yes | 1 | none | none |
| aws.s3.bucket.policy.put | yes | 2 | s3.policy.widens_access | none |
| aws.ec2.instance.terminate | yes | 2 | aws.ec2.ami.exists, aws.ec2.root_volume.delete_on_termination | none |
| aws.ec2.instance.stop | yes | 2 | ec2.instance.root_device_type | none |
| aws.ec2.volume.delete | yes | 2 | aws.ec2.volume.snapshot_exists | none |
| aws.ec2.securitygroup.authorize_ingress | yes | 2 | ec2.rule.source_internal | none |
| aws.rds.instance.delete | yes | 2 | none | none |
| aws.rds.snapshot.delete | yes | 1 | none | none |
| aws.dynamodb.item.put | yes | 3 | aws.dynamodb.capture.before_image, aws.dynamodb.pitr.enabled | none |
| aws.dynamodb.table.delete | yes | 2 | aws.dynamodb.backup.exists | none |
| aws.iam.access_key.create | yes | 2 | aws.iam.secret.disclosed | none |
| aws.iam.role.policy.attach | yes | 2 | aws.iam.policy.write_or_credential | none |
| aws.kms.key.schedule_deletion | yes | 2 | aws.kms.deletion.window_elapsed | none |
| aws.secretsmanager.secret.delete | yes | 2 | none | none |
| aws.ses.email.send | yes | 2 | hold.released | none |
| aws.route53.recordset.change | yes | 2 | aws.route53.record.ttl_lte_300 | none |
| aws.cloudtrail.trail.stop_logging | yes | 1 | none | none |
| aws.cloudformation.stack.delete | yes | 2 | aws.cloudformation.resources.retain_policy | none |
| stripe.payment_intent.create | yes | 3 | stripe.balance_covers_refund | case 0 mismatch; case 1 mismatch |
| stripe.refund.create | yes | 2 | stripe.refund.submitted | case 0 mismatch |
| stripe.payout.create | yes | 2 | stripe.payout.status | none |
| stripe.subscription.delete | yes | 2 | none | none |
| stripe.invoice.finalize | yes | 2 | stripe.invoice.is_draft | none |
| stripe.customer.delete | yes | 1 | none | none |
| stripe.dispute.close | yes | 1 | none | none |
| quickbooks.journal_entry.create | yes | 2 | quickbooks.period.open | none |
| shopify.order.cancel | yes | 2 | shopify.order.fulfillment_created | none |
| shopify.product.delete | yes | 2 | shopify.product.capture.full_payload | none |
| gmail.message.send | yes | 3 | gmail.recipients.internal, hold.released | none |
| gmail.draft.create | yes | 1 | none | none |
| google.calendar.event.create | yes | 2 | google.calendar.event.external_attendees | none |
| google.drive.file.delete | yes | 2 | gdrive.delete.trashes | none |
| google.drive.permission.create | yes | 2 | google.drive.grantee.internal | none |
| slack.chat.post_message | yes | 3 | hold.released, slack.channel.private_small | none |
| slack.conversation.archive | yes | 1 | none | none |
| twilio.message.create | yes | 3 | hold.released, twilio.message.status | none |
| microsoft.teams.message.send | yes | 2 | hold.released | none |
| microsoft.outlook.message.send | yes | 3 | hold.released, microsoft.outlook.message.unread, microsoft.outlook.recipients.same_tenant | none |
| sendgrid.mail.send | yes | 3 | hold.released, sendgrid.send.fired | none |
| postgres.row.update | yes | 3 | pg.capture.before_image, pg.transaction.void_controlled | none |
| postgres.row.delete | yes | 3 | pg.capture.before_image, pg.cascade.traversed | case 0 mismatch |
| postgres.table.drop | yes | 2 | pg.transaction.void_controlled | none |
| postgres.migration.apply | yes | 2 | pg.migration.additive_only | none |
| mysql.table.truncate | no | 1 | none | unmigrated legacy fixture |
| mongodb.collection.delete_many | yes | 2 | mongodb.capture.before_image | none |
| redis.key.flushdb | yes | 2 | redis.instance.pure_cache, redis.warm_path.known | none |
| bigquery.table.delete | yes | 2 | bigquery.table.partitioned, bigquery.table.within_time_travel | none |
| elasticsearch.index.delete | yes | 3 | elasticsearch.index.derived, elasticsearch.snapshot.recent | none |
| snowflake.table.drop | yes | 2 | snowflake.table.within_retention | none |
| github.pull_request.merge | yes | 2 | github.base_branch.deploys | none |
| github.branch.force_push | yes | 2 | github.commits.reachable | none |
| github.repository.delete | yes | 2 | github.repository.name_untaken, github.repository.within_restore_window | none |
| github.release.publish | yes | 2 | github.release.is_draft | none |
| npm.package.publish | yes | 2 | npm.version.has_dependents, npm.version.within_unpublish_window | none |
| kubernetes.deployment.apply | yes | 2 | kubernetes.replicaset.in_revision_history | none |
| kubernetes.namespace.delete | yes | 2 | kubernetes.manifests.in_git, kubernetes.pv.reclaim_policy | none |
| terraform.apply.destroy | yes | 2 | terraform.plan.stateless_recreatable | none |
| cloudflare.dns_record.update | yes | 2 | cloudflare.dns_record.proxied | none |
| cloudflare.zone.delete | yes | 1 | none | none |
| docker.image.push | yes | 2 | registry.tag.immutable | case 0 mismatch |
| pagerduty.incident.trigger | yes | 1 | none | none |
| salesforce.record.update | yes | 3 | salesforce.capture.before_image, salesforce.field_history.all_touched | none |
| salesforce.record.delete | yes | 2 | salesforce.record.recycle_bin | none |
| salesforce.mass_email.send | yes | 2 | hold.released | none |
| hubspot.contact.merge | yes | 1 | none | none |
| hubspot.workflow.enroll | yes | 2 | hubspot.workflow.external_action, hubspot.workflow.step_advanced | none |
| zendesk.ticket.create | yes | 2 | zendesk.ticket.requester_notified | none |
| zendesk.ticket.merge | yes | 1 | none | none |
| intercom.conversation.reply | yes | 2 | hold.released | none |
| jira.issue.transition | yes | 2 | jira.transition.external_post_function | none |
| jira.issue.delete | yes | 2 | jira.issue.capture.full_payload | none |
| linear.issue.archive | yes | 1 | none | none |
| notion.page.delete | yes | 2 | notion.page.trashed | none |
| notion.block.update | yes | 2 | notion.edit.within_history_window, notion.workspace.page_history | none |
| airtable.record.delete | yes | 3 | airtable.base.snapshot_covers_call, airtable.capture.records | none |
| okta.user.deactivate | yes | 1 | none | none |
| okta.user.delete | yes | 1 | none | none |
| entra.group.member.add | yes | 2 | entra.group.data_access, entra.group.privileged_role | none |
| auth0.client_secret.rotate | yes | 2 | auth0.application.two_active_secrets, auth0.secret.prior_captured | none |
| openai.file.delete | yes | 2 | openai.file.source_exists | none |
| openai.fine_tune.create | yes | 2 | openai.fine_tune.status | none |
| vectordb.namespace.delete | yes | 2 | vectordb.embedding_model.pinned, vectordb.source_documents.pinned | none |
| fs.file.write | yes | 3 | fs.path.existed, fs.shadow.captured | case 1 mismatch |
| fs.path.remove_recursive | yes | 2 | fs.tree.git_clean | none |
| git.branch.delete | yes | 2 | git.branch.tip_merged, git.branch.tip_recorded | none |
| git.history.rewrite | yes | 2 | git.branch.pushed | none |
| shell.command.exec | yes | 2 | shell.command.read_only_allowlist | none |

## Adversarial review

Random seed: 404. The 15 sampled migrated entries were: aws.dynamodb.table.delete, github.branch.force_push, aws.s3.object.put, hubspot.workflow.enroll, shell.command.exec, okta.user.deactivate, aws.iam.access_key.create, postgres.row.delete, aws.route53.recordset.change, github.pull_request.merge, aws.s3.bucket.delete, fs.file.write, git.branch.delete, pagerduty.incident.trigger, zendesk.ticket.merge.

| entry | cases checked | result |
| --- | --- | --- |
| aws.dynamodb.table.delete | 2 | no mismatch found |
| github.branch.force_push | 2 | no mismatch found |
| aws.s3.object.put | 3 | no mismatch found |
| hubspot.workflow.enroll | 2 | no mismatch found |
| shell.command.exec | 2 | no mismatch found |
| okta.user.deactivate | 1 | no mismatch found |
| aws.iam.access_key.create | 2 | no mismatch found |
| postgres.row.delete | 3 | mismatch found |
| aws.route53.recordset.change | 2 | no mismatch found |
| github.pull_request.merge | 2 | no mismatch found |
| aws.s3.bucket.delete | 1 | no mismatch found |
| fs.file.write | 3 | mismatch found |
| git.branch.delete | 2 | no mismatch found |
| pagerduty.incident.trigger | 1 | no mismatch found |
| zendesk.ticket.merge | 1 | no mismatch found |

### Mismatches, dangerous first

| risk | id | case | direction | finding |
| --- | --- | --- | --- | --- |
| dangerous | postgres.row.delete | 0 | Over-match | The prose requires captured full rows and no foreign key cascade. The guard checks only pg.capture.before_image. With pg.capture.before_image=true and pg.cascade.traversed=true, case 0 wins as r0 and case 1 r1 is skipped. |
| dangerous | fs.file.write | 1 | Over-match | The prose requires an untracked path that did not exist. The guard checks only fs.path.existed=false. A tracked missing path can match the r0 case even though the prose would not. |
| dangerous | aws.s3.object.delete | 0 | Over-match | The prose for case 1 says an explicit versionId is r3, but case 0 checks only bucket.versioning=Enabled and bucket.mfa_delete=off. With versionId present and those facts true, case 0 wins as r0. |
| dangerous | docker.image.push | 0 | Over-match | The prose requires the tag to be immutable and previously unused. The guard checks only registry.tag.immutable=true, so a previously used immutable tag can be treated as r1. |
| dangerous | stripe.payment_intent.create | 0 | Over-match | The prose requires capture_method manual and the intent uncaptured. The guard checks only capture_method=manual, so a later captured manual intent can remain r0. |
| dangerous | stripe.payment_intent.create | 1 | Over-match | The prose requires the charge to have settled and balance to cover a refund. The guard checks only stripe.balance_covers_refund=true, so an unsettled charge can match the r2 refund case. |
| dangerous | stripe.refund.create | 0 | Over-match | The prose requires pending and unsubmitted. The guard checks only stripe.refund.submitted=false, so it does not prove the refund is in a cancellable pending state. |

Notes: `postgres.row.delete` and `fs.file.write` were in the random sample. The other dangerous rows were found during adjacent high-risk scanning, and should still be fixed before relying on the migration.

## Fact-name consistency

Every fact name used by a structured if appears in `packages/registry/docs/facts.md`.

| status | fact names |
| --- | --- |
| strays | none |

## Blast-radius argument coverage

These entries can affect a variable number of targets. A policy may want `blast_radius`, but the proxy cannot know the measured count from the call envelope alone. A connector or upstream dry run must provide it.

| id | why proxy cannot know count |
| --- | --- |
| aws.cloudformation.stack.delete | Delete a stack and every resource it owns. |
| aws.s3.bucket.delete | Delete a bucket. |
| aws.s3.bucket.policy.put | Replace a bucket policy. |
| aws.dynamodb.table.delete | Delete a table. |
| aws.rds.instance.delete | Delete a database instance. |
| aws.route53.recordset.change | Upsert a DNS record. |
| postgres.row.update | UPDATE one or more rows. |
| postgres.row.delete | DELETE rows matching a predicate. |
| postgres.table.drop | DROP TABLE. |
| postgres.migration.apply | Apply a schema migration. |
| mysql.table.truncate | TRUNCATE TABLE. |
| mongodb.collection.delete_many | Delete every document matching a filter. |
| redis.key.flushdb | Flush every key in the database. |
| bigquery.table.delete | Delete a table. |
| elasticsearch.index.delete | Delete an index. |
| snowflake.table.drop | DROP TABLE. |
| github.pull_request.merge | Merge a pull request into its base branch. |
| github.branch.force_push | Force push over a branch. |
| github.repository.delete | Delete a repository. |
| kubernetes.deployment.apply | Apply a deployment manifest. |
| kubernetes.namespace.delete | Delete a namespace and everything in it. |
| terraform.apply.destroy | Destroy the resources in a state file. |
| cloudflare.zone.delete | Delete a zone. |
| sendgrid.mail.send | Send a transactional or bulk email. |
| salesforce.mass_email.send | Send a mass email to a list view. |
| hubspot.workflow.enroll | Enrol contacts into a workflow. |
| jira.issue.delete | Delete an issue. |
| airtable.record.delete | Delete records from a table. |
| vectordb.namespace.delete | Delete a namespace of embeddings. |
| fs.path.remove_recursive | Delete a directory tree. |
| git.history.rewrite | Rebase, amend or filter published history. |

## Verification run

Commands run after writing this file:

- `node --test /tmp/void-migration-audit.test.mjs`
- `CI=true npx tsc -p tsconfig.json` from `packages/registry`

