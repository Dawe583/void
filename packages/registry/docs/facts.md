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


## Batch 3: cloud and web administration

These facts describe only the target and the exact scope of the intercepted call.
A recovery-copy assertion covers every affected object, value and required
configuration, not an arbitrary recent backup. Copies and secret values stay in
operator-controlled storage; VOID records declarations and references, not payloads.
Every string comparison is exact. Missing or boolean values do not satisfy a guard
that requires the strings `true` or `false`.

A declared recovery capability is not a shipped connector. Manual administration
surfaces say so in their entry summaries. Enterprise API access, permissions and
vendor-plan eligibility still apply. A compensation never appears as an inverse
in this batch. Scope-wide recovery requires a complete copy outside that deletion
scope and a usable restore path.

| Fact name | Type | Meaning |
| --------- | ---- | ------- |
| airtable.base.recovery_copy_verified | string | Whether the entire base, attachments, automations and access configuration have a verified independent recovery copy, true or false. |
| airtable.record.recovery_copy_verified | string | Whether every selected record, attachment and relationship has a verified independent recovery copy, true or false. |
| airtable.user.previously_active | string | Whether the enterprise user was active before deactivation, true or false. |
| airtable.user.reactivation_preserves_access | string | Whether same-account reactivation is supported and preserves every prior permission and ownership, true or false. |
| airtable.workspace.recovery_copy_verified | string | Whether every affected base, attachment and workspace setting has a verified independent recovery copy, true or false. |
| azure.aks.cluster.recovery_copy_verified | string | Whether cluster configuration and every affected persistent volume have verified recovery copies, true or false. |
| azure.appservice.site.recovery_copy_verified | string | Whether app content, configuration and required secret references have a verified recovery copy, true or false. |
| azure.cosmosdb.account.recovery_copy_verified | string | Whether all account data and configuration have a verified complete recovery copy outside the deletion scope, true or false. |
| azure.managed_disk.recovery_copy_verified | string | Whether a retained complete disk recovery copy has a verified restore path, true or false. |
| azure.resource_group.empty | string | Whether the targeted resource group contains no resources, true or false. |
| azure.resource_group.metadata_captured | string | Whether the resource group name, location, tags and applicable access configuration were captured, true or false. |
| azure.sql.database.recovery_copy_verified | string | Whether a complete Azure SQL recovery copy covers the database before deletion and has a verified restore path, true or false. |
| azure.storage.account.recovery_copy_verified | string | Whether every affected storage service and account setting has a verified independent recovery copy, true or false. |
| azure.storage.container.recovery_copy_verified | string | Whether all container blobs, versions and metadata have a verified recovery copy outside the deletion scope, true or false. |
| azure.vm.recovery_copy_verified | string | Whether VM configuration and every affected disk have complete verified recovery copies, true or false. |
| basecamp.project.member.access_captured | string | Whether the person project role and every project access grant were captured, true or false. |
| basecamp.project.member.regrant_supported | string | Whether the same existing principal can be granted every captured membership and permission again, true or false. |
| basecamp.project.previously_active | string | Whether the project was active immediately before the intercepted status change, true or false. |
| basecamp.project.restore_capacity_available | string | Whether the account has project capacity and permission to reactivate the same archived or trashed project, true or false. |
| basecamp.project.trash_restorable | string | Whether the same project and all its contents remain in trash and available for restoration, true or false. |
| cloudflare.d1.database.recovery_copy_verified | string | Whether a complete D1 export outside the deletion scope has a verified restore path, true or false. |
| cloudflare.kv.namespace.recovery_copy_verified | string | Whether all namespace keys, values, metadata and expiration information have verified independent recovery copies, true or false. |
| cloudflare.pages.project.recovery_copy_verified | string | Whether Pages source, settings, domains and secret references have verified independent recovery copies, true or false. |
| cloudflare.r2.bucket.recovery_copy_verified | string | Whether bucket configuration and every affected object have complete verified independent recovery copies, true or false. |
| cloudflare.workers.script.recovery_copy_verified | string | Whether Worker source, bindings and secret references have a verified complete recovery copy, true or false. |
| coda.doc.recovery_copy_verified | string | Whether the complete document content, automations and access settings have verified independent recovery copies, true or false. |
| coda.row.recovery_copy_verified | string | Whether the full row values and relationships were captured in a verified independent recovery copy, true or false. |
| coda.rows.recovery_copy_verified | string | Whether every selected row value and relationship has a verified independent recovery copy, true or false. |
| datadog.dashboard.recovery_copy_verified | string | Whether the complete dashboard definition and access configuration were captured, true or false. |
| datadog.downtime.recovery_copy_verified | string | Whether the complete downtime schedule, scope and notification settings were captured, true or false. |
| datadog.monitor.recovery_copy_verified | string | Whether the complete monitor definition and notification bindings were captured before deletion, true or false. |
| datadog.slo.recovery_copy_verified | string | Whether the complete SLO definition and monitor references were captured, true or false. |
| datadog.synthetics.test.recovery_copy_verified | string | Whether the test definition, locations and secret references were completely captured, true or false. |
| gcp.bigquery.dataset.recovery_copy_verified | string | Whether dataset tables, models, routines and access settings have complete verified recovery copies, true or false. |
| gcp.compute.disk.recovery_copy_verified | string | Whether a complete retained disk recovery copy has a verified restore path, true or false. |
| gcp.compute.instance.recovery_copy_verified | string | Whether VM configuration and every affected disk have verified recovery copies, true or false. |
| gcp.gcs.bucket.recovery_copy_verified | string | Whether bucket configuration and every affected object have a verified recovery copy outside the deletion scope, true or false. |
| gcp.gke.cluster.recovery_copy_verified | string | Whether cluster configuration and every affected volume have verified recovery copies, true or false. |
| gcp.iam.role.within_undelete_window | string | Whether the custom IAM role is still within 7 days of deletion and has not been permanently deleted, true or false. |
| gcp.project.services_recoverable | string | Whether every affected service has a verified usable recovery path after project shutdown, true or false. |
| gcp.project.within_soft_delete_window | string | Whether the targeted project is still inside its current vendor project restoration window, true or false. |
| gcp.secretmanager.version.delayed_destruction | string | Whether the secret has a configured destruction delay that retains the targeted version after a destroy call, true or false. |
| gcp.secretmanager.version.within_restore_window | string | Whether the targeted delayed-destruction version remains before its scheduled irreversible destruction time, true or false. |
| gcp.sql.instance.recovery_copy_verified | string | Whether a complete database recovery copy exists outside the instance deletion scope with a verified restore path, true or false. |
| netlify.build_hook.recovery_copy_verified | string | Whether the hook configuration and every caller update path were verified before deletion, true or false. |
| netlify.form.recovery_copy_verified | string | Whether form definition and every affected submission and upload have a complete verified independent export, true or false. |
| netlify.form.submission.recovery_copy_verified | string | Whether the selected submission and every uploaded file has a complete verified export outside the site, true or false. |
| netlify.site.recovery_copy_verified | string | Whether site source, settings and all affected stored data have complete verified independent recovery copies, true or false. |
| notion.block.previously_trashed | string | Whether the block was in trash before the intercepted call, true or false. |
| notion.block.restore_supported | string | Whether the same block remains addressable for restoration with its retained contents, true or false. |
| notion.teamspace.member.access_captured | string | Whether the teamspace member role and every direct teamspace grant were captured, true or false. |
| notion.teamspace.member.regrant_supported | string | Whether the same existing principal can be granted every captured membership and permission again, true or false. |
| notion.teamspace.previously_active | string | Whether the teamspace was active immediately before archival, true or false. |
| notion.teamspace.restore_supported | string | Whether the same teamspace and memberships can be restored by an operator who is both workspace owner and teamspace owner, true or false. |
| opsgenie.escalation.recovery_copy_verified | string | Whether escalation rules, recipients and delays were fully captured, true or false. |
| opsgenie.integration.recovery_copy_verified | string | Whether integration configuration and all consumer update paths were verified before deletion, true or false. |
| opsgenie.schedule.recovery_copy_verified | string | Whether all rotations, overrides, participants and time zones were captured, true or false. |
| opsgenie.team.recovery_copy_verified | string | Whether all team members, roles and routing configuration were captured, true or false. |
| pagerduty.escalation_policy.recovery_copy_verified | string | Whether every escalation rule, target, delay and service binding was captured, true or false. |
| pagerduty.integration.recovery_copy_verified | string | Whether integration settings and every consumer update path were verified before deletion, true or false. |
| pagerduty.schedule.recovery_copy_verified | string | Whether all schedule layers, overrides, users and time zones were captured, true or false. |
| pagerduty.service.recovery_copy_verified | string | Whether service settings, integrations and escalation bindings were completely captured, true or false. |
| pagerduty.team.member.access_captured | string | Whether the user team role and all team access grants were captured, true or false. |
| pagerduty.team.member.regrant_supported | string | Whether the same existing principal can be granted every captured membership and permission again, true or false. |
| slack.admin.user.access_captured | string | Whether the user workspace role, channels and all direct access grants were captured, true or false. |
| slack.admin.user.regrant_supported | string | Whether the same existing principal can be granted every captured membership and permission again, true or false. |
| slack.channel.previously_active | string | Whether the channel was active immediately before the administrative archive call, true or false. |
| slack.channel.restore_supported | string | Whether the same channel and all its memberships can still be restored by the operator, true or false. |
| slack.channel.template_workflows_present | string | Whether template workflows are attached to the target channel, true or false. |
| vercel.environment.recovery_copy_verified | string | Whether every selected variable value, target environment and branch binding was captured in the operator vault, true or false. |
| vercel.project.recovery_copy_verified | string | Whether project source, settings, domains and secret references have complete verified recovery copies, true or false. |
| vercel.webhook.recovery_copy_verified | string | Whether the webhook configuration and consumer update path have been verified before deletion, true or false. |

### Source and review notes

`fixtures/registry/wp04b-batch3.json` includes a public official source URL for
all 107 entries, rejected candidate explanations, and the registry disclaimer.
Two vendor-group reviewers checked these sources. This was not two independent
reviews per entry and did not run actions against vendor accounts.

The Basecamp API says trashed projects last 30 days, while its current help says
25 days or until trash is emptied. The guards therefore require actual retained
contents and restore eligibility instead of assuming either duration:
https://raw.githubusercontent.com/basecamp/bc3-api/master/sections/projects.md
and https://5.basecamp-help.com/article/1133-archiving-trash-and-restoring .

Opsgenie human API pages returned HTTP 429. Public official SDK source verified
the included operations instead. These entries target existing Opsgenie accounts;
they do not claim that new account signup is available.

Stripe file deletion was excluded because its public OpenAPI has no file DELETE
operation. Cloudflare zone deletion already existed and was not counted again.
The batch does not add unused zone-active facts for that unchanged entry.
