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
| airtable.base.snapshot_covers_call | string | Whether base snapshot history covers the moment before the intercepted call, true or false. |
| airtable.capture.records | string | Whether the interceptor captured the records before deletion, true or false. |
| auth0.application.two_active_secrets | string | Whether the application supports two active client secrets at once, true or false. |
| auth0.secret.prior_captured | string | Whether the prior client secret was captured before rotation, true or false. |
| aws.cloudformation.resources.retain_policy | string | Whether every stack resource carries a Retain deletion policy, true or false. |
| aws.dynamodb.backup.exists | string | Whether an on demand table backup exists, true or false. |
| aws.dynamodb.capture.before_image | string | Whether the interceptor captured the item before image, true or false. |
| aws.dynamodb.pitr.enabled | string | Whether point in time recovery is enabled on the table, true or false. |
| aws.ec2.ami.exists | string | Whether an AMI exists for recreating the instance, true or false. |
| aws.ec2.root_volume.delete_on_termination | string | Whether the instance root volume has DeleteOnTermination set, true or false. |
| aws.ec2.volume.snapshot_exists | string | Whether a snapshot exists for the EBS volume, true or false. |
| aws.iam.policy.write_or_credential | string | Whether the attached policy grants write or credential actions, true or false. |
| aws.iam.secret.disclosed | string | Whether the access key secret left the interceptor process, true or false. |
| aws.kms.deletion.window_elapsed | string | Whether the scheduled KMS deletion window has elapsed, true or false. |
| aws.route53.record.ttl_lte_300 | string | Whether the DNS record TTL is 300 seconds or less, true or false. |
| bigquery.table.partitioned | string | Whether the BigQuery table is partitioned, true or false. |
| bigquery.table.within_time_travel | string | Whether the table was created within the available time travel window, true or false. |
| cloudflare.dns_record.proxied | string | Whether the Cloudflare DNS record is proxied, true or false. |
| elasticsearch.index.derived | string | Whether the index is a derived view of a source of truth, true or false. |
| elasticsearch.snapshot.recent | string | Whether a snapshot repository holds a recent snapshot of the index, true or false. |
| entra.group.data_access | string | Whether the group grants data access, true or false. |
| entra.group.privileged_role | string | Whether the group grants a privileged role, true or false. |
| fs.tree.git_clean | string | Whether every path in the tree is committed and unmodified in git, true or false. |
| git.branch.pushed | string | Whether the branch has been pushed to a remote, true or false. |
| git.branch.tip_merged | string | Whether the branch tip commit is merged, true or false. |
| git.branch.tip_recorded | string | Whether the interceptor recorded the branch tip commit, true or false. |
| github.commits.reachable | string | Whether overwritten commits remain reachable through reflog or a PR ref, true or false. |
| github.repository.name_untaken | string | Whether the deleted repository name is still untaken, true or false. |
| github.repository.within_restore_window | string | Whether repository deletion is still inside the restore window, true or false. |
| google.calendar.event.external_attendees | string | Whether the event has attendees other than the organiser, true or false. |
| google.drive.grantee.internal | string | Whether the permission grantee is inside the organisation, true or false. |
| hubspot.workflow.external_action | string | Whether the workflow has an external action, true or false. |
| hubspot.workflow.step_advanced | string | Whether enrolment has advanced a workflow step, true or false. |
| jira.issue.capture.full_payload | string | Whether the interceptor captured the issue, comments and attachments, true or false. |
| jira.transition.external_post_function | string | Whether a transition post function fires an external action, true or false. |
| kubernetes.manifests.in_git | string | Whether the namespace manifests are in git, true or false. |
| kubernetes.pv.reclaim_policy | string | The reclaim policy used by every PersistentVolume, for example Retain. |
| kubernetes.replicaset.in_revision_history | string | Whether the previous ReplicaSet is inside the deployment revision history limit, true or false. |
| microsoft.outlook.message.unread | string | Whether the sent message remains unread by the recipients, true or false. |
| microsoft.outlook.recipients.same_tenant | string | Whether every recipient is on the same Exchange tenant, true or false. |
| mongodb.capture.before_image | string | Whether the interceptor captured the matched documents before deletion, true or false. |
| notion.edit.within_history_window | string | Whether the edit is within the workspace page history window, true or false. |
| notion.page.trashed | string | Whether the page was moved to trash rather than permanently deleted, true or false. |
| notion.workspace.page_history | string | Whether the workspace has page history, true or false. |
| npm.version.has_dependents | string | Whether another package depends on the published version, true or false. |
| npm.version.within_unpublish_window | string | Whether the package version is still inside npm unpublish window, true or false. |
| openai.file.source_exists | string | Whether the original file artifact still exists in the source system, true or false. |
| openai.fine_tune.status | string | The fine tuning job status, for example queued or running. |
| quickbooks.period.open | string | Whether the accounting period is open, true or false. |
| redis.instance.pure_cache | string | Whether Redis is used only as a cache, true or false. |
| redis.warm_path.known | string | Whether a known warm path exists for rebuilding Redis contents, true or false. |
| salesforce.capture.before_image | string | Whether the interceptor captured the record before image, true or false. |
| salesforce.field_history.all_touched | string | Whether field history tracking is on for every touched field, true or false. |
| salesforce.record.recycle_bin | string | Whether the record went to the recycle bin, true or false. |
| sendgrid.send.fired | string | Whether the scheduled SendGrid send has fired, true or false. |
| shell.command.read_only_allowlist | string | Whether the shell command matches the read only allowlist, true or false. |
| shopify.order.fulfillment_created | string | Whether fulfilment has been created for the order, true or false. |
| shopify.product.capture.full_payload | string | Whether the interceptor captured the full product payload before deletion, true or false. |
| snowflake.table.within_retention | string | Whether the table is still within its data retention period, true or false. |
| stripe.payout.status | string | The Stripe payout status, for example pending or paid. |
| terraform.plan.stateless_recreatable | string | Whether every resource in the destroy plan is stateless and re-creatable from configuration, true or false. |
| twilio.message.status | string | The Twilio message status, for example queued or sent. |
| vectordb.embedding_model.pinned | string | Whether the embedding model version is pinned, true or false. |
| vectordb.source_documents.pinned | string | Whether the source documents are pinned, true or false. |
| zendesk.ticket.requester_notified | string | Whether the requester notification was sent for the ticket, true or false. |
| asana.member_state_captured | string | Whether the member's workspace access and team memberships were captured before removal, true or false. |
| asana.portfolio.capture.settings | string | Whether the portfolio membership, fields and settings were captured before deletion, true or false. |
| asana.project.within_restore_window | string | Whether the deleted Asana project is still inside the vendor restore window, true or false. |
| asana.task.capture.full_payload | string | Whether the interceptor captured every task body, comment and relationship before deletion, true or false. |
| asana.team_state_captured | string | Whether the team members, projects and settings were captured before deletion, true or false. |
| gitea.actions.secret_values_captured | string | Whether Gitea Actions secret values were captured in the operator vault before deletion, true or false. |
| gitea.commits.reachable | string | Whether overwritten commits remain reachable through refs, reflog or backup, true or false. |
| gitea.member_state_captured | string | Whether Gitea organization team memberships and repository grants were captured, true or false. |
| gitea.repository.backup_exists | string | Whether a repository backup exists for restoring the deleted Gitea repository, true or false. |
| gitea.repository.contains_private_data | string | Whether the Gitea repository contains private data, true or false. |
| gitea.transfer.target_cooperative | string | Whether the new Gitea owner is expected to transfer the repository back on request, true or false. |
| github.actions.secret_values_captured | string | Whether GitHub Actions secret values were captured in the operator vault before deletion, true or false. |
| github.branch_protection.captured | string | Whether the branch protection rule was captured before deletion, true or false. |
| github.deploy_key.captured | string | Whether the deploy key public key and write access flag were captured before deletion, true or false. |
| github.environment.secret_values_captured | string | Whether GitHub environment secret values were captured in the operator vault before deletion, true or false. |
| github.org.member_state_captured | string | Whether organization membership, teams and roles were captured before removal, true or false. |
| github.repository.contains_private_data | string | Whether the GitHub repository contains private data, true or false. |
| github.repository.public | string | Whether the GitHub repository is public, true or false. |
| github.repository.public_mirrors_observed | string | Whether public mirrors or caches of the repository were observed after visibility change, true or false. |
| github.team_state_captured | string | Whether team membership and repository grants were captured before deletion, true or false. |
| github.transfer.target_cooperative | string | Whether the new GitHub owner is expected to transfer the repository back on request, true or false. |
| gitlab.branch.deploys | string | Whether deployment or release automation triggers from the GitLab branch, true or false. |
| gitlab.ci_variable_values_captured | string | Whether GitLab CI variable values were captured in the operator vault before deletion, true or false. |
| gitlab.commits.reachable | string | Whether overwritten GitLab commits remain reachable through refs, merge requests or backup, true or false. |
| gitlab.member_state_captured | string | Whether GitLab group roles and project memberships were captured before removal, true or false. |
| gitlab.project.contains_private_data | string | Whether the GitLab project contains private data, true or false. |
| gitlab.project.within_restore_window | string | Whether the deleted GitLab project is still inside the vendor restore window, true or false. |
| gitlab.protected_branch.captured | string | Whether the protected branch rule was captured before deletion, true or false. |
| gitlab.transfer.target_cooperative | string | Whether the new GitLab namespace owner is expected to transfer the project back on request, true or false. |
| jira.board.capture.settings | string | Whether the Jira board filter and settings were captured before deletion, true or false. |
| jira.project.in_trash | string | Whether the Jira project is still in trash with project data retained, true or false. |
| jira.scrub.display_name_only | string | Whether the Jira data scrub is limited to reversible display name masking, true or false. |
| jira.workflow.capture.full_payload | string | Whether the Jira workflow XML and scheme bindings were captured before deletion, true or false. |
| kubernetes.deployment.prior_replicas_captured | string | Whether the prior Deployment replica count was captured before scaling, true or false. |
| kubernetes.deployment.replicas_gt_0 | string | Whether the Deployment had more than zero desired replicas before the scale call, true or false. |
| kubernetes.helm.values_captured | string | Whether the Helm chart reference and values were captured before uninstall, true or false. |
| kubernetes.namespace.empty | string | Whether the Kubernetes namespace has no namespaced resources other than system defaults, true or false. |
| kubernetes.secret.source_in_git | string | Whether the Secret manifest or sealed source is available in git, true or false. |
| kubernetes.workload.has_persistent_volume | string | Whether the Kubernetes workload owns or depends on a persistent volume, true or false. |
| linear.issue.capture.full_payload | string | Whether every Linear issue payload, comment and relationship was captured before deletion, true or false. |
| linear.project.capture.full_payload | string | Whether the Linear project payload was captured before deletion, true or false. |
| linear.project.in_archive | string | Whether the Linear project remains present in archive for unarchive, true or false. |
| linear.scrub.archive_exists | string | Whether a policy-approved archive exists for data scrubbed from Linear, true or false. |
| linear.team_state_captured | string | Whether Linear team settings, members and workflow states were captured before deletion, true or false. |
| sendgrid.clients.rotatable | string | Whether every SendGrid client can receive and use a newly issued API key, true or false. |
| sendgrid.domain.config_captured | string | Whether SendGrid domain settings and DNS records were captured before deletion, true or false. |
| sendgrid.suppression.capture.list | string | Whether the SendGrid suppression list was captured before deletion, true or false. |
| sendgrid.template.capture.versions | string | Whether SendGrid template versions were captured before deletion, true or false. |
| sentry.clients.redeployable | string | Whether applications using the Sentry DSN can be redeployed with a new DSN, true or false. |
| sentry.events.exported | string | Whether Sentry events were exported before deletion or scrubbing, true or false. |
| sentry.member_state_captured | string | Whether Sentry member role and team assignments were captured before removal, true or false. |
| sentry.project.settings_captured | string | Whether Sentry project settings and DSNs were captured before deletion, true or false. |
| sentry.replay.archive_exists | string | Whether a policy-approved archive exists for replay data scrubbed from Sentry, true or false. |
| shopify.customer.erasure_pending | string | Whether the Shopify customer erasure request is still pending and cancellable, true or false. |
| shopify.discount.capture.definitions | string | Whether Shopify discount definitions were captured before deletion, true or false. |
| shopify.order.payment_captured | string | Whether payment has been captured for the Shopify order, true or false. |
| shopify.theme.previous_live_captured | string | Whether the previous live Shopify theme id was captured before publishing, true or false. |
| supabase.auth.users_count | string | The number of Supabase Auth users selected by the bulk delete, for example 0 or nonzero. |
| supabase.auth.users_exported | string | Whether Supabase Auth users and provider identities were exported before deletion, true or false. |
| supabase.branch.unique_data | string | Whether the Supabase database branch contains data not present in its parent, true or false. |
| supabase.database.pitr_available | string | Whether Supabase point in time recovery covers the database at the call time, true or false. |
| supabase.edge_function.source_in_git | string | Whether the Supabase Edge Function source and deploy manifest are in git, true or false. |
| supabase.rls.policy_captured | string | Whether the Supabase row level security policy SQL was captured before deletion, true or false. |
| supabase.secret_values_captured | string | Whether Supabase project secret values were captured in the operator vault before deletion, true or false. |
| supabase.storage.objects_mirrored | string | Whether every Supabase Storage object targeted by the purge was mirrored before deletion, true or false. |
| terraform.lock.holder_active | string | Whether the Terraform state lock holder is still active, true or false. |
| terraform.plan.destroy_actions_count | string | The destroy action count in the Terraform plan, for example 0 or nonzero. |
| terraform.state.backup_exists | string | Whether a Terraform state backup exists from before the state operation, true or false. |
| terraform.variable_set.captured | string | Whether Terraform variable names and secret values were captured before deletion, true or false. |
| terraform.workspace.empty | string | Whether the Terraform workspace has no resources remaining in state, true or false. |
| twilio.clients.rotatable | string | Whether every Twilio client can receive and use a newly issued API key, true or false. |
| twilio.domain.config_captured | string | Whether Twilio domain configuration and DNS records were captured before deletion, true or false. |
| twilio.messaging_service.captured | string | Whether Twilio Messaging Service configuration was captured before deletion, true or false. |
| twilio.number.within_reclaim_window | string | Whether the released Twilio phone number is still inside the provider reclaim window, true or false. |

A fact value is a string or a boolean. The precondition grammar compares
strings exactly and treats booleans with presence, because `is` on a boolean
fact has no honest string form: the evaluator compares the boolean's presence,
not the string "true".

## Staleness

Each declared fact carries `verifiedAt` and `source`. A fact older than the
configured window is stale: it still evaluates, because staleness is a
warning to the operator, not a silent denial, and the report the loader
returns carries the stale list so the CLI can show it.
| `registry.tag.previously_used` | the pushed tag already pointed at a digest someone may have pulled | true / false |
| `stripe.intent.captured` | the payment intent moved funds, not only held them | true / false |
| `stripe.charge.settled` | the charge settled, so a refund moves real money back | true / false |
| `stripe.refund.pending` | the refund has not been submitted to the payment method yet | true / false |
