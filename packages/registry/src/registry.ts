import type { Precondition } from "./precondition.ts";

/**
 * The Reversibility Registry.
 *
 * The premise the rest of VOID rests on: reversibility is not a property of an
 * API call, it is a property of a call evaluated against the state of its
 * target. Deleting an S3 object is fully reversible with bucket versioning on
 * and irreversible with it off. The same DELETE, two different classes.
 *
 * So an entry does not carry a class. It carries an ordered list of cases, each
 * guarded by a precondition. The first case whose precondition holds decides
 * the class, which is why the last case in every entry is the unguarded
 * fallback ("always").
 *
 * Kept dependency free on purpose, and it must stay that way. This module is the
 * canonical copy of the registry. The site repository mirrors it byte for byte so
 * its /registry page and /api/registry endpoint can build without reaching this
 * repository, and scripts/src/check-registry-mirror.mjs fails when the two drift.
 * A workspace import here would break the site's Vercel Function, and a node:*
 * import would break its browser bundle, so this file depends on neither.
 */

export type RegistryTone = "r0" | "r1" | "r2" | "r3";

/** One verdict, valid only while its precondition holds. */
export type RegistryCase = {
  /** The precondition, written the way an operator would actually check it. */
  when: string;
  tone: RegistryTone;
  /** The call that undoes it, or null when nothing does. */
  inverse: string | null;
  /** How long the inverse stays valid. */
  window: string;
  note: string;
  /**
   * The structured form of `when`, optional because the migration lands per
   * entry: an unmigrated case is display only and the evaluator must say
   * unclassified rather than guess from the prose.
   */
  if?: Precondition;
};

export type RegistryEntry = {
  /** Canonical dotted id, stable across registry versions. */
  id: string;
  vendor: string;
  surface: string;
  summary: string;
  /** Ordered. The first matching precondition wins. */
  cases: RegistryCase[];
  tags: string[];
};

export const REGISTRY_VERSION = "2026.09.1";

/**
 * Draft classifications reviewed by the VOID team against public vendor
 * documentation. Not vendor certified, and no vendor has endorsed them.
 * Preconditions are the part that goes stale first, so every entry is dated by
 * the registry version rather than pretending to be timeless.
 */
export const REGISTRY_DISCLAIMER =
  "Draft classifications, reviewed against public vendor documentation and not certified by any vendor. Verify preconditions against your own account configuration before relying on a class.";

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

const awsEntries: RegistryEntry[] = [
  {
    id: "aws.s3.object.put",
    vendor: "aws",
    surface: "S3",
    summary: "Write an object, overwriting whatever key it lands on.",
    tags: ["storage", "write", "overwrite"],
    cases: [
      { when: "bucket versioning is Enabled", tone: "r0", inverse: "s3:DeleteObject on the new versionId", window: "until a lifecycle rule expires the prior version", note: "the previous version stays addressable, so the overwrite is a pointer move", if: { kind: "fact", fact: "bucket.versioning", is: "Enabled" } },
      { when: "the key did not exist", tone: "r0", inverse: "s3:DeleteObject", window: "unbounded", note: "nothing was displaced, the inverse is a plain delete", if: { kind: "fact", fact: "s3.key.existed", is: "false" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "versioning off means the prior bytes are gone at the moment of the PUT" , if: { kind: "always" } },
    ],
  },
  {
    id: "aws.s3.object.delete",
    vendor: "aws",
    surface: "S3",
    summary: "Delete an object by key.",
    tags: ["storage", "delete"],
    cases: [
      { when: "bucket versioning is Enabled and MFA delete is off", tone: "r0", inverse: "s3:DeleteObject on the delete marker", window: "until a lifecycle rule expires noncurrent versions", note: "the delete only writes a marker, the object is still there underneath", if: { kind: "all", of: [{ kind: "fact", fact: "bucket.versioning", is: "Enabled" }, { kind: "fact", fact: "bucket.mfa_delete", is: "off" }] } },
      { when: "a versionId was passed explicitly", tone: "r3", inverse: null, window: "none", note: "deleting a specific version is a permanent destruction, not a marker", if: { kind: "argument", argument: "versionId", operator: "present" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "without versioning the bytes are unrecoverable outside a backup" , if: { kind: "always" } },
    ],
  },
  {
    id: "aws.s3.bucket.delete",
    vendor: "aws",
    surface: "S3",
    summary: "Delete a bucket.",
    tags: ["storage", "delete", "namespace"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "bucket names are a global namespace and can be claimed by another account within minutes" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.s3.bucket.policy.put",
    vendor: "aws",
    surface: "S3",
    summary: "Replace a bucket policy.",
    tags: ["storage", "access-control"],
    cases: [
      { when: "the new policy does not widen access beyond the account", tone: "r0", inverse: "s3:PutBucketPolicy with the captured prior document", window: "unbounded", note: "policy documents are small and fully snapshotable", if: { kind: "fact", fact: "s3.policy.widens_access", is: "false" } },
      { when: "always", tone: "r2", inverse: "s3:PutBucketPolicy with the captured prior document", window: "unbounded", note: "restoring the policy closes the hole but cannot un-read anything fetched while it was open" , if: { kind: "always" } },
    ],
  },
  {
    id: "aws.ec2.instance.terminate",
    vendor: "aws",
    surface: "EC2",
    summary: "Terminate an instance.",
    tags: ["compute", "delete"],
    cases: [
      { when: "the root volume has DeleteOnTermination false and an AMI exists", tone: "r1", inverse: "ec2:RunInstances from the AMI plus volume reattach", window: "while the AMI and volume are retained", note: "a new instance id and private address, so anything pinned to the old identity breaks" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "aws.ec2.root_volume.delete_on_termination", "is": "false"}, {"kind": "fact", "fact": "aws.ec2.ami.exists", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "instance store and DeleteOnTermination volumes are destroyed with the instance" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.ec2.instance.stop",
    vendor: "aws",
    surface: "EC2",
    summary: "Stop a running instance.",
    tags: ["compute", "state"],
    cases: [
      { when: "the instance is EBS backed", tone: "r0", inverse: "ec2:StartInstances", window: "unbounded", note: "the public IPv4 changes unless an Elastic IP is attached", if: { kind: "fact", fact: "ec2.instance.root_device_type", is: "ebs" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "instance store volumes do not survive a stop" , if: { kind: "always" } },
    ],
  },
  {
    id: "aws.ec2.volume.delete",
    vendor: "aws",
    surface: "EC2",
    summary: "Delete an EBS volume.",
    tags: ["storage", "delete"],
    cases: [
      { when: "a snapshot of the volume exists", tone: "r1", inverse: "ec2:CreateVolume from the snapshot", window: "while the snapshot is retained", note: "writes since the snapshot are lost and the volume id changes" , if: {"kind": "fact", "fact": "aws.ec2.volume.snapshot_exists", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "no snapshot means no copy of the blocks" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.ec2.securitygroup.authorize_ingress",
    vendor: "aws",
    surface: "EC2",
    summary: "Add an inbound rule to a security group.",
    tags: ["network", "access-control"],
    cases: [
      { when: "the source is a security group or an RFC1918 range", tone: "r0", inverse: "ec2:RevokeSecurityGroupIngress", window: "unbounded", note: "internal exposure only, the revoke is exact", if: { kind: "fact", fact: "ec2.rule.source_internal", is: "true" } },
      { when: "always", tone: "r2", inverse: "ec2:RevokeSecurityGroupIngress", window: "unbounded", note: "a rule open to 0.0.0.0/0 is scanned within minutes, so the revoke closes the door but the exposure happened" , if: { kind: "always" } },
    ],
  },
  {
    id: "aws.rds.instance.delete",
    vendor: "aws",
    surface: "RDS",
    summary: "Delete a database instance.",
    tags: ["database", "delete"],
    cases: [
      { when: "SkipFinalSnapshot is false", tone: "r1", inverse: "rds:RestoreDBInstanceFromDBSnapshot", window: "while the final snapshot is retained", note: "restore takes minutes to hours and produces a new endpoint" , if: {"kind": "argument", "argument": "SkipFinalSnapshot", "operator": "equals", "value": "false"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "skipping the final snapshot with no automated backups leaves nothing to restore from" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.rds.snapshot.delete",
    vendor: "aws",
    surface: "RDS",
    summary: "Delete a database snapshot.",
    tags: ["database", "delete", "backup"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleting a backup is the one action that removes the ability to undo other actions" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.dynamodb.item.put",
    vendor: "aws",
    surface: "DynamoDB",
    summary: "Write an item, replacing any item with the same key.",
    tags: ["database", "write", "overwrite"],
    cases: [
      { when: "a before image was captured by the interceptor", tone: "r0", inverse: "dynamodb:PutItem with the captured image", window: "unbounded", note: "the interceptor reads the item before writing, which costs one extra RCU" , if: {"kind": "fact", "fact": "aws.dynamodb.capture.before_image", "is": "true"} },
      { when: "point in time recovery is enabled", tone: "r1", inverse: "table level restore to a timestamp", window: "35 days", note: "PITR restores a whole table to a new name, it cannot restore one item in place" , if: {"kind": "fact", "fact": "aws.dynamodb.pitr.enabled", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the replaced attributes are not retained anywhere" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.dynamodb.table.delete",
    vendor: "aws",
    surface: "DynamoDB",
    summary: "Delete a table.",
    tags: ["database", "delete"],
    cases: [
      { when: "an on demand backup exists", tone: "r1", inverse: "dynamodb:RestoreTableFromBackup", window: "while the backup is retained", note: "restores under a new name, stream ARNs and triggers must be rebuilt" , if: {"kind": "fact", "fact": "aws.dynamodb.backup.exists", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "PITR is deleted with the table it belonged to" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.iam.access_key.create",
    vendor: "aws",
    surface: "IAM",
    summary: "Create a long lived access key for a user.",
    tags: ["identity", "credential"],
    cases: [
      { when: "the secret never left the interceptor process", tone: "r1", inverse: "iam:DeleteAccessKey", window: "unbounded", note: "the key existed, so it appears in the credential report" , if: {"kind": "fact", "fact": "aws.iam.secret.disclosed", "is": "false"} },
      { when: "always", tone: "r2", inverse: "iam:DeleteAccessKey plus rotation notice", window: "unbounded", note: "once a secret reaches an agent transcript or a log it must be treated as disclosed, and deleting it does not un-disclose it" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.iam.role.policy.attach",
    vendor: "aws",
    surface: "IAM",
    summary: "Attach a managed policy to a role.",
    tags: ["identity", "access-control"],
    cases: [
      { when: "the policy grants no write or credential action", tone: "r0", inverse: "iam:DetachRolePolicy", window: "unbounded", note: "read only widening is recoverable with no residue" , if: {"kind": "fact", "fact": "aws.iam.policy.write_or_credential", "is": "false"} },
      { when: "always", tone: "r2", inverse: "iam:DetachRolePolicy", window: "unbounded", note: "anything the role did while over-permissioned is its own set of actions to compensate" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.kms.key.schedule_deletion",
    vendor: "aws",
    surface: "KMS",
    summary: "Schedule a customer managed key for deletion.",
    tags: ["security", "delete", "deferred"],
    cases: [
      { when: "the pending window has not elapsed", tone: "r0", inverse: "kms:CancelKeyDeletion", window: "7 to 30 days as configured", note: "AWS built the deferral in, which is exactly the pattern VOID generalises" , if: {"kind": "fact", "fact": "aws.kms.deletion.window_elapsed", "is": "false"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "everything encrypted under the key is permanently unreadable" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.secretsmanager.secret.delete",
    vendor: "aws",
    surface: "Secrets Manager",
    summary: "Delete a secret.",
    tags: ["security", "delete", "deferred"],
    cases: [
      { when: "ForceDeleteWithoutRecovery was not set", tone: "r0", inverse: "secretsmanager:RestoreSecret", window: "7 to 30 days as configured", note: "the default is a soft delete with a recovery window" , if: {"kind": "argument", "argument": "ForceDeleteWithoutRecovery", "operator": "equals", "value": "false"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the force flag skips the recovery window entirely" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.ses.email.send",
    vendor: "aws",
    surface: "SES",
    summary: "Send an email to a recipient.",
    tags: ["messaging", "external"],
    cases: [
      { when: "the interceptor holds the send and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "a held send has not reached SES, so cancelling costs nothing" , if: {"kind": "fact", "fact": "hold.released", "is": "false"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "SMTP has no recall, and a follow up correction is a new message rather than an undo" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.route53.recordset.change",
    vendor: "aws",
    surface: "Route 53",
    summary: "Upsert a DNS record.",
    tags: ["network", "dns"],
    cases: [
      { when: "the record TTL is 300 seconds or less", tone: "r1", inverse: "route53:ChangeResourceRecordSets with the prior value", window: "unbounded", note: "the record comes back but resolvers keep the old answer for up to one TTL" , if: {"kind": "fact", "fact": "aws.route53.record.ttl_lte_300", "is": "true"} },
      { when: "always", tone: "r2", inverse: "route53:ChangeResourceRecordSets with the prior value", window: "unbounded", note: "a long TTL means the wrong answer is cached far outside your control" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.cloudtrail.trail.stop_logging",
    vendor: "aws",
    surface: "CloudTrail",
    summary: "Stop logging on a trail.",
    tags: ["audit", "compliance"],
    cases: [
      { when: "always", tone: "r2", inverse: "cloudtrail:StartLogging", window: "unbounded", note: "logging resumes but the gap in the record can never be filled, which is precisely what an auditor looks for" , if: {"kind": "always"} },
    ],
  },
  {
    id: "aws.cloudformation.stack.delete",
    vendor: "aws",
    surface: "CloudFormation",
    summary: "Delete a stack and every resource it owns.",
    tags: ["infrastructure", "delete", "fan-out"],
    cases: [
      { when: "every resource carries a Retain deletion policy", tone: "r1", inverse: "redeploy the template and import the retained resources", window: "unbounded", note: "the resources survive but the stack identity and drift history do not" , if: {"kind": "fact", "fact": "aws.cloudformation.resources.retain_policy", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "one call fans out into dozens of deletions, each with its own class, and the worst one wins" , if: {"kind": "always"} },
    ],
  },
];

const moneyEntries: RegistryEntry[] = [
  {
    id: "stripe.payment_intent.create",
    vendor: "stripe",
    surface: "Payments",
    summary: "Create and confirm a payment intent against a customer.",
    tags: ["payments", "money", "external"],
    cases: [
      { when: "capture_method is manual and the intent is uncaptured", tone: "r0", inverse: "POST /v1/payment_intents/:id/cancel", window: "7 days before the authorisation expires", note: "an uncaptured authorisation holds funds but never moves them, so cancelling is clean", if: { kind: "argument", argument: "capture_method", operator: "equals", value: "manual" } },
      { when: "the charge settled and the balance can cover a refund", tone: "r2", inverse: "POST /v1/refunds", window: "no hard limit, practically 180 days for disputes", note: "the customer sees a charge and a refund, not the absence of a charge, and the card network fee is not returned", if: { kind: "fact", fact: "stripe.balance_covers_refund", is: "true" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a refund with an insufficient balance fails, which leaves the charge standing" , if: { kind: "always" } },
    ],
  },
  {
    id: "stripe.refund.create",
    vendor: "stripe",
    surface: "Payments",
    summary: "Refund a charge in whole or in part.",
    tags: ["payments", "money"],
    cases: [
      { when: "the refund is still pending and unsubmitted", tone: "r1", inverse: "POST /v1/refunds/:id/cancel", window: "minutes, only for some payment methods", note: "cancellation is available for a narrow set of methods and never for cards", if: { kind: "fact", fact: "stripe.refund.submitted", is: "false" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "there is no un-refund, only a fresh charge, which needs the customer to authorise it again" , if: { kind: "always" } },
    ],
  },
  {
    id: "stripe.payout.create",
    vendor: "stripe",
    surface: "Payments",
    summary: "Move funds from the Stripe balance to a bank account.",
    tags: ["payments", "money", "external"],
    cases: [
      { when: "the payout status is still pending", tone: "r0", inverse: "POST /v1/payouts/:id/cancel", window: "until the payout is submitted to the bank", note: "only manual payouts sit in pending long enough to be worth intercepting" , if: {"kind": "fact", "fact": "stripe.payout.status", "is": "pending"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "once it settles the money is in a bank you do not control and recovery is a legal process, not an API call" , if: {"kind": "always"} },
    ],
  },
  {
    id: "stripe.subscription.delete",
    vendor: "stripe",
    surface: "Billing",
    summary: "Cancel a subscription.",
    tags: ["payments", "billing"],
    cases: [
      { when: "cancel_at_period_end was used", tone: "r0", inverse: "POST /v1/subscriptions/:id with cancel_at_period_end false", window: "until the period ends", note: "the subscription is still active, only the renewal flag changed", if: { kind: "argument", argument: "cancel_at_period_end", operator: "equals", value: "true" } },
      { when: "always", tone: "r1", inverse: "create a new subscription on the same price", window: "unbounded", note: "billing anchors, trial state and the subscription id do not survive, so proration and revenue reporting shift" , if: { kind: "always" } },
    ],
  },
  {
    id: "stripe.invoice.finalize",
    vendor: "stripe",
    surface: "Billing",
    summary: "Finalise a draft invoice.",
    tags: ["payments", "billing", "external"],
    cases: [
      { when: "the invoice is still a draft", tone: "r0", inverse: "DELETE /v1/invoices/:id", window: "until finalisation", note: "draft invoices are private and deletable", if: { kind: "fact", fact: "stripe.invoice.is_draft", is: "true" } },
      { when: "always", tone: "r2", inverse: "POST /v1/invoices/:id/void", window: "unbounded", note: "voiding keeps the invoice number consumed and the customer may already have the emailed copy" , if: { kind: "always" } },
    ],
  },
  {
    id: "stripe.customer.delete",
    vendor: "stripe",
    surface: "Payments",
    summary: "Delete a customer object.",
    tags: ["payments", "delete", "pii"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the customer id is gone, saved payment methods are detached, and every subscription on it is cancelled in the same call" , if: {"kind": "always"} },
    ],
  },
  {
    id: "stripe.dispute.close",
    vendor: "stripe",
    surface: "Payments",
    summary: "Accept a dispute rather than contesting it.",
    tags: ["payments", "money", "terminal"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "accepting is final, the funds and the dispute fee are gone, and evidence can no longer be submitted" , if: {"kind": "always"} },
    ],
  },
  {
    id: "quickbooks.journal_entry.create",
    vendor: "quickbooks",
    surface: "Accounting",
    summary: "Post a journal entry to the general ledger.",
    tags: ["accounting", "money"],
    cases: [
      { when: "the accounting period is open", tone: "r1", inverse: "delete the entry", window: "until the period closes", note: "the audit log keeps the create and the delete, which is what an auditor expects to see" , if: {"kind": "fact", "fact": "quickbooks.period.open", "is": "true"} },
      { when: "always", tone: "r2", inverse: "post a reversing entry", window: "unbounded", note: "a closed period must not be edited, so the only correct inverse is a new entry that offsets it" , if: {"kind": "always"} },
    ],
  },
  {
    id: "shopify.order.cancel",
    vendor: "shopify",
    surface: "Commerce",
    summary: "Cancel an order.",
    tags: ["commerce", "money", "fulfilment"],
    cases: [
      { when: "no fulfilment has been created", tone: "r1", inverse: "create a new draft order from the captured line items", window: "unbounded", note: "the order number is consumed and the customer received a cancellation email" , if: {"kind": "fact", "fact": "shopify.order.fulfillment_created", "is": "false"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a cancelled order that was already handed to a carrier is a physical object moving through the world" , if: {"kind": "always"} },
    ],
  },
  {
    id: "shopify.product.delete",
    vendor: "shopify",
    surface: "Commerce",
    summary: "Delete a product and its variants.",
    tags: ["commerce", "delete"],
    cases: [
      { when: "a full product payload was captured before the call", tone: "r1", inverse: "productCreate from the captured payload", window: "unbounded", note: "new product and variant ids break every external reference, including live ad campaigns" , if: {"kind": "fact", "fact": "shopify.product.capture.full_payload", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "variant ids, metafields and inventory history are not reconstructable" , if: {"kind": "always"} },
    ],
  },
];

const messagingEntries: RegistryEntry[] = [
  {
    id: "gmail.message.send",
    vendor: "google",
    surface: "Gmail",
    summary: "Send a message from a user mailbox.",
    tags: ["messaging", "external", "deferred"],
    cases: [
      { when: "the interceptor holds the send and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "this is the single highest value hold in the registry, because most agent email damage is caught within a minute", if: { kind: "fact", fact: "hold.released", is: "false" } },
      { when: "every recipient is inside the same Workspace domain", tone: "r2", inverse: "delete from recipient mailboxes via the admin API", window: "unbounded with delegated admin", note: "an admin can remove the message, but read receipts, notifications and forwards already happened", if: { kind: "fact", fact: "gmail.recipients.internal", is: "true" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an external recipient cannot be made to unsee a message" , if: { kind: "always" } },
    ],
  },
  {
    id: "gmail.draft.create",
    vendor: "google",
    surface: "Gmail",
    summary: "Create a draft without sending it.",
    tags: ["messaging"],
    cases: [
      { when: "always", tone: "r0", inverse: "users.drafts.delete", window: "unbounded", note: "the draft never left the account, which is why VOID rewrites risky sends into drafts under a strict policy" , if: {"kind": "always"} },
    ],
  },
  {
    id: "google.calendar.event.create",
    vendor: "google",
    surface: "Calendar",
    summary: "Create an event and invite attendees.",
    tags: ["calendar", "external"],
    cases: [
      { when: "the event has no attendees other than the organiser", tone: "r0", inverse: "events.delete", window: "unbounded", note: "a private hold that nobody was told about" , if: {"kind": "fact", "fact": "google.calendar.event.external_attendees", "is": "false"} },
      { when: "always", tone: "r1", inverse: "events.delete with sendUpdates", window: "unbounded", note: "attendees get an invitation and then a cancellation, so two notifications for an event that should not have existed" , if: {"kind": "always"} },
    ],
  },
  {
    id: "google.drive.file.delete",
    vendor: "google",
    surface: "Drive",
    summary: "Delete a file.",
    tags: ["storage", "delete", "deferred"],
    cases: [
      { when: "the file was trashed rather than permanently deleted", tone: "r0", inverse: "files.update with trashed false", window: "30 days in the trash", note: "the default delete is a trash operation, which is a deferral the vendor already built", if: { kind: "fact", fact: "gdrive.delete.trashes", is: "true" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "files.delete skips the trash, and shared drive retention does not cover it" , if: { kind: "always" } },
    ],
  },
  {
    id: "google.drive.permission.create",
    vendor: "google",
    surface: "Drive",
    summary: "Share a file with a person, group or the public.",
    tags: ["storage", "access-control"],
    cases: [
      { when: "the grantee is inside the organisation", tone: "r0", inverse: "permissions.delete", window: "unbounded", note: "internal sharing is revocable with no residue outside the audit log" , if: {"kind": "fact", "fact": "google.drive.grantee.internal", "is": "true"} },
      { when: "always", tone: "r2", inverse: "permissions.delete", window: "unbounded", note: "anyone-with-the-link means the content may already be copied, indexed or forwarded" , if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.chat.post_message",
    vendor: "slack",
    surface: "Slack",
    summary: "Post a message to a channel or conversation.",
    tags: ["messaging", "deferred"],
    cases: [
      { when: "the interceptor holds the post and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "nothing was posted, so nobody was notified", if: { kind: "fact", fact: "hold.released", is: "false" } },
      { when: "the channel is private with fewer than five members", tone: "r1", inverse: "chat.delete", window: "unbounded with the right token", note: "deletion is fast enough that in practice few people saw it, but push notifications already fired", if: { kind: "fact", fact: "slack.channel.private_small", is: "true" } },
      { when: "always", tone: "r2", inverse: "chat.delete plus a correction message", window: "unbounded with the right token", note: "the message vanishes from history but mobile notifications, email digests and exports keep it" , if: { kind: "always" } },
    ],
  },
  {
    id: "slack.conversation.archive",
    vendor: "slack",
    surface: "Slack",
    summary: "Archive a channel.",
    tags: ["messaging", "state"],
    cases: [
      { when: "always", tone: "r1", inverse: "conversations.unarchive", window: "unbounded", note: "unarchiving restores history but members were removed and are not automatically re-added" , if: {"kind": "always"} },
    ],
  },
  {
    id: "twilio.message.create",
    vendor: "twilio",
    surface: "SMS",
    summary: "Send an SMS or WhatsApp message.",
    tags: ["messaging", "external", "deferred"],
    cases: [
      { when: "the interceptor holds the send and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "the only reliable inverse for SMS is not sending it" , if: {"kind": "fact", "fact": "hold.released", "is": "false"} },
      { when: "the message is queued and not yet sent", tone: "r1", inverse: "POST to the message resource with status canceled", window: "seconds, and only while queued", note: "the window is real but far too short to depend on without a hold in front of it" , if: {"kind": "fact", "fact": "twilio.message.status", "is": "queued"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "delivered to a handset, outside every system you operate" , if: {"kind": "always"} },
    ],
  },
  {
    id: "microsoft.teams.message.send",
    vendor: "microsoft",
    surface: "Teams",
    summary: "Post a message to a channel or chat.",
    tags: ["messaging"],
    cases: [
      { when: "the interceptor holds the post and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "no notification was raised" , if: {"kind": "fact", "fact": "hold.released", "is": "false"} },
      { when: "always", tone: "r2", inverse: "soft delete via the Graph API", window: "unbounded with the right permission", note: "the message is hidden rather than erased and stays in the compliance copy, by design" , if: {"kind": "always"} },
    ],
  },
  {
    id: "microsoft.outlook.message.send",
    vendor: "microsoft",
    surface: "Outlook",
    summary: "Send a mail message.",
    tags: ["messaging", "external", "deferred"],
    cases: [
      { when: "the interceptor holds the send and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "recall inside Exchange is unreliable and the hold is not" , if: {"kind": "fact", "fact": "hold.released", "is": "false"} },
      { when: "every recipient is on the same Exchange tenant and the mail is unread", tone: "r2", inverse: "message recall", window: "minutes, best effort", note: "recall fails silently in many client configurations, so it can never be treated as an undo" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "microsoft.outlook.recipients.same_tenant", "is": "true"}, {"kind": "fact", "fact": "microsoft.outlook.message.unread", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "external SMTP delivery is final" , if: {"kind": "always"} },
    ],
  },
  {
    id: "sendgrid.mail.send",
    vendor: "sendgrid",
    surface: "Email",
    summary: "Send a transactional or bulk email.",
    tags: ["messaging", "external", "fan-out", "deferred"],
    cases: [
      { when: "the interceptor holds the send and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "a bulk send is the highest blast radius call most agents can reach, so the hold matters most here" , if: {"kind": "fact", "fact": "hold.released", "is": "false"} },
      { when: "the send is scheduled with a batch id and has not fired", tone: "r1", inverse: "POST /v3/user/scheduled_sends with status cancel", window: "until the scheduled time", note: "the vendor supports cancellation, but only for scheduled batches" , if: {"kind": "all", "of": [{"kind": "argument", "argument": "batch_id", "operator": "present"}, {"kind": "fact", "fact": "sendgrid.send.fired", "is": "false"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "one call can reach a hundred thousand inboxes and none of them can be recalled" , if: {"kind": "always"} },
    ],
  },
];

const dataEntries: RegistryEntry[] = [
  {
    id: "postgres.row.update",
    vendor: "postgres",
    surface: "SQL",
    summary: "UPDATE one or more rows.",
    tags: ["database", "write"],
    cases: [
      { when: "the interceptor captured a before image of every matched row", tone: "r0", inverse: "UPDATE from the captured image, keyed by primary key", window: "unbounded", note: "the interceptor runs the predicate as a SELECT first, which is also where the blast radius number comes from", if: { kind: "fact", fact: "pg.capture.before_image", is: "true" } },
      { when: "the statement ran inside an open transaction VOID controls", tone: "r0", inverse: "ROLLBACK", window: "until commit", note: "the cheapest inverse there is, and the reason VOID prefers to own the transaction boundary", if: { kind: "fact", fact: "pg.transaction.void_controlled", is: "true" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an unbounded UPDATE with no before image cannot be reconstructed from the WAL after the retention window" , if: { kind: "always" } },
    ],
  },
  {
    id: "postgres.row.delete",
    vendor: "postgres",
    surface: "SQL",
    summary: "DELETE rows matching a predicate.",
    tags: ["database", "delete"],
    cases: [
      { when: "the interceptor captured the full rows and no foreign key cascaded", tone: "r0", inverse: "INSERT from the captured rows", window: "unbounded", note: "identity columns must be restored explicitly or the ids shift", if: { kind: "fact", fact: "pg.capture.before_image", is: "true" } },
      { when: "a foreign key with ON DELETE CASCADE was traversed", tone: "r1", inverse: "INSERT the captured rows across every affected table in dependency order", window: "unbounded", note: "this is the case people underestimate, because one DELETE silently becomes many", if: { kind: "fact", fact: "pg.cascade.traversed", is: "true" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "no before image means the rows are gone unless a backup predates the statement" , if: { kind: "always" } },
    ],
  },
  {
    id: "postgres.table.drop",
    vendor: "postgres",
    surface: "SQL",
    summary: "DROP TABLE.",
    tags: ["database", "delete", "schema"],
    cases: [
      { when: "the statement ran inside an open transaction VOID controls", tone: "r0", inverse: "ROLLBACK", window: "until commit", note: "DDL is transactional in Postgres, which is not true of MySQL and is the single biggest difference between them here" , if: {"kind": "fact", "fact": "pg.transaction.void_controlled", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "restoring from a backup is an out of band operation measured in hours, not an inverse" , if: {"kind": "always"} },
    ],
  },
  {
    id: "postgres.migration.apply",
    vendor: "postgres",
    surface: "SQL",
    summary: "Apply a schema migration.",
    tags: ["database", "schema"],
    cases: [
      { when: "the migration is additive only and a down migration exists", tone: "r0", inverse: "the down migration", window: "unbounded", note: "adding a nullable column or an index is genuinely reversible", if: { kind: "fact", fact: "pg.migration.additive_only", is: "true" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a migration that drops or narrows a column destroys data that the down migration cannot invent" , if: { kind: "always" } },
    ],
  },
  {
    id: "mysql.table.truncate",
    vendor: "mysql",
    surface: "SQL",
    summary: "TRUNCATE TABLE.",
    tags: ["database", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "TRUNCATE is DDL in MySQL, so it commits implicitly and cannot be rolled back, which catches out anyone reasoning from Postgres" },
    ],
  },
  {
    id: "mongodb.collection.delete_many",
    vendor: "mongodb",
    surface: "Documents",
    summary: "Delete every document matching a filter.",
    tags: ["database", "delete"],
    cases: [
      { when: "the interceptor captured the matched documents", tone: "r0", inverse: "insertMany with the captured documents", window: "unbounded", note: "ObjectIds are preserved because they are part of the captured document" , if: {"kind": "fact", "fact": "mongodb.capture.before_image", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an empty filter deletes the whole collection and there is nothing to replay from" , if: {"kind": "always"} },
    ],
  },
  {
    id: "redis.key.flushdb",
    vendor: "redis",
    surface: "Cache",
    summary: "Flush every key in the database.",
    tags: ["cache", "delete"],
    cases: [
      { when: "the instance is a pure cache with a known warm path", tone: "r1", inverse: "re-warm from the source of truth", window: "unbounded", note: "correctness returns immediately, latency and load do not, and a cold cache can take a service down" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "redis.instance.pure_cache", "is": "true"}, {"kind": "fact", "fact": "redis.warm_path.known", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Redis used as a primary store for sessions or queues loses real state" , if: {"kind": "always"} },
    ],
  },
  {
    id: "bigquery.table.delete",
    vendor: "google",
    surface: "BigQuery",
    summary: "Delete a table.",
    tags: ["analytics", "delete", "deferred"],
    cases: [
      { when: "the table is not partitioned and was created within the time travel window", tone: "r0", inverse: "CREATE TABLE from a FOR SYSTEM_TIME AS OF snapshot", window: "7 days by default", note: "time travel is a deferral the vendor already built, and most teams do not know it exists" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "bigquery.table.partitioned", "is": "false"}, {"kind": "fact", "fact": "bigquery.table.within_time_travel", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "past the time travel window there is no copy" , if: {"kind": "always"} },
    ],
  },
  {
    id: "elasticsearch.index.delete",
    vendor: "elastic",
    surface: "Search",
    summary: "Delete an index.",
    tags: ["search", "delete"],
    cases: [
      { when: "a snapshot repository holds a recent snapshot", tone: "r1", inverse: "restore from the snapshot", window: "while the snapshot is retained", note: "documents indexed since the snapshot are lost" , if: {"kind": "fact", "fact": "elasticsearch.snapshot.recent", "is": "true"} },
      { when: "the index is a derived view of a source of truth", tone: "r1", inverse: "reindex from the source", window: "unbounded", note: "correct but slow, and search is degraded for the whole rebuild" , if: {"kind": "fact", "fact": "elasticsearch.index.derived", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a primary index with no snapshot and no source is unrecoverable" , if: {"kind": "always"} },
    ],
  },
  {
    id: "snowflake.table.drop",
    vendor: "snowflake",
    surface: "Warehouse",
    summary: "DROP TABLE.",
    tags: ["analytics", "delete", "deferred"],
    cases: [
      { when: "the table is within its data retention period", tone: "r0", inverse: "UNDROP TABLE", window: "1 day on standard, up to 90 on enterprise", note: "one of the few vendors that ships a literal UNDROP, which is the primitive the rest of the industry is missing" , if: {"kind": "fact", "fact": "snowflake.table.within_retention", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "past retention the micro-partitions are purged" , if: {"kind": "always"} },
    ],
  },
];

const devEntries: RegistryEntry[] = [
  {
    id: "github.pull_request.merge",
    vendor: "github",
    surface: "GitHub",
    summary: "Merge a pull request into its base branch.",
    tags: ["source", "deploy"],
    cases: [
      { when: "no deployment or release automation is triggered by the base branch", tone: "r1", inverse: "revert commit", window: "unbounded", note: "history keeps both the merge and the revert, which is correct but visible", if: { kind: "fact", fact: "github.base_branch.deploys", is: "false" } },
      { when: "always", tone: "r2", inverse: "revert commit plus the compensations for whatever the merge deployed", window: "unbounded", note: "a merge that ships to production is not one action, it is the root of a causal chain" , if: { kind: "always" } },
    ],
  },
  {
    id: "github.branch.force_push",
    vendor: "github",
    surface: "GitHub",
    summary: "Force push over a branch.",
    tags: ["source", "destructive"],
    cases: [
      { when: "the overwritten commits are still reachable through the reflog or a PR ref", tone: "r1", inverse: "force push back to the captured SHA", window: "roughly 90 days for unreachable objects", note: "recoverable by someone who knows the old SHA, which is why the interceptor records it" , if: {"kind": "fact", "fact": "github.commits.reachable", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "every collaborator with the old history now has a diverged checkout" , if: {"kind": "always"} },
    ],
  },
  {
    id: "github.repository.delete",
    vendor: "github",
    surface: "GitHub",
    summary: "Delete a repository.",
    tags: ["source", "delete", "deferred"],
    cases: [
      { when: "the deletion is within the restore window and the name is untaken", tone: "r1", inverse: "restore from the account settings", window: "90 days", note: "restore brings back code and issues but not forks or stars" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "github.repository.within_restore_window", "is": "true"}, {"kind": "fact", "fact": "github.repository.name_untaken", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the owner and name pair can be claimed by anyone, which makes it a supply chain problem as well as a data loss" , if: {"kind": "always"} },
    ],
  },
  {
    id: "github.release.publish",
    vendor: "github",
    surface: "GitHub",
    summary: "Publish a release and its tag.",
    tags: ["source", "distribution"],
    cases: [
      { when: "the release is a draft", tone: "r0", inverse: "delete the draft", window: "until publication", note: "drafts are invisible outside the repository", if: { kind: "fact", fact: "github.release.is_draft", is: "true" } },
      { when: "always", tone: "r2", inverse: "delete the release and the tag", window: "unbounded", note: "package registries, mirrors and CI caches may have pulled the artifact within seconds" , if: { kind: "always" } },
    ],
  },
  {
    id: "npm.package.publish",
    vendor: "npm",
    surface: "Registry",
    summary: "Publish a package version.",
    tags: ["distribution", "supply-chain"],
    cases: [
      { when: "the version was published under 72 hours ago and nothing depends on it", tone: "r1", inverse: "npm unpublish", window: "72 hours", note: "the version number is burned permanently and can never be reused" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "npm.version.within_unpublish_window", "is": "true"}, {"kind": "fact", "fact": "npm.version.has_dependents", "is": "false"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deprecation is the only remaining move, and mirrors keep the tarball regardless" , if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.deployment.apply",
    vendor: "kubernetes",
    surface: "Workloads",
    summary: "Apply a deployment manifest.",
    tags: ["infrastructure", "deploy"],
    cases: [
      { when: "the previous ReplicaSet is inside the revision history limit", tone: "r0", inverse: "kubectl rollout undo", window: "10 revisions by default", note: "the cleanest rollback primitive in mainstream infrastructure" , if: {"kind": "fact", "fact": "kubernetes.replicaset.in_revision_history", "is": "true"} },
      { when: "always", tone: "r1", inverse: "apply the captured prior manifest", window: "unbounded", note: "the manifest returns but anything the new version wrote to a database does not" , if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.namespace.delete",
    vendor: "kubernetes",
    surface: "Workloads",
    summary: "Delete a namespace and everything in it.",
    tags: ["infrastructure", "delete", "fan-out"],
    cases: [
      { when: "every PersistentVolume uses a Retain reclaim policy and manifests are in git", tone: "r1", inverse: "re-apply from git and rebind the volumes", window: "unbounded", note: "a slow rebuild, and Secrets not stored in git are gone" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "kubernetes.pv.reclaim_policy", "is": "Retain"}, {"kind": "fact", "fact": "kubernetes.manifests.in_git", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Delete reclaim policy destroys the underlying disks along with the claims" , if: {"kind": "always"} },
    ],
  },
  {
    id: "terraform.apply.destroy",
    vendor: "terraform",
    surface: "IaC",
    summary: "Destroy the resources in a state file.",
    tags: ["infrastructure", "delete", "fan-out"],
    cases: [
      { when: "every resource in the plan is stateless and re-creatable from the configuration", tone: "r1", inverse: "terraform apply", window: "unbounded", note: "new identifiers throughout, so DNS, allowlists and anything pinned to an ARN breaks" , if: {"kind": "fact", "fact": "terraform.plan.stateless_recreatable", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "one plan can destroy databases, buckets and keys together, and the plan output is the only warning you get" , if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.dns_record.update",
    vendor: "cloudflare",
    surface: "DNS",
    summary: "Update a DNS record.",
    tags: ["network", "dns"],
    cases: [
      { when: "the record is proxied, which pins the TTL low", tone: "r1", inverse: "update back to the captured value", window: "unbounded", note: "proxied records propagate fast because resolvers only ever see Cloudflare addresses" , if: {"kind": "fact", "fact": "cloudflare.dns_record.proxied", "is": "true"} },
      { when: "always", tone: "r2", inverse: "update back to the captured value", window: "unbounded", note: "a high TTL on an unproxied record leaves stale answers cached worldwide" , if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.zone.delete",
    vendor: "cloudflare",
    surface: "DNS",
    summary: "Delete a zone.",
    tags: ["network", "dns", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "every record goes at once and the domain stops resolving before anyone can react" , if: {"kind": "always"} },
    ],
  },
  {
    id: "docker.image.push",
    vendor: "docker",
    surface: "Registry",
    summary: "Push an image tag to a registry.",
    tags: ["distribution", "supply-chain"],
    cases: [
      { when: "the tag is immutable and previously unused", tone: "r1", inverse: "delete the tag", window: "unbounded", note: "the digest may already be pinned by a running deployment", if: { kind: "fact", fact: "registry.tag.immutable", is: "true" } },
      { when: "always", tone: "r2", inverse: "re-push the captured prior digest to the tag", window: "unbounded", note: "a mutable tag like latest means anything that pulled in between got the wrong image" , if: { kind: "always" } },
    ],
  },
  {
    id: "pagerduty.incident.trigger",
    vendor: "pagerduty",
    surface: "On call",
    summary: "Trigger an incident and page the on call rotation.",
    tags: ["operations", "external"],
    cases: [
      { when: "always", tone: "r2", inverse: "resolve the incident with a false alarm note", window: "unbounded", note: "you cannot un-wake somebody at three in the morning, and repeated false pages cost real alert trust" , if: {"kind": "always"} },
    ],
  },
];

const recordEntries: RegistryEntry[] = [
  {
    id: "salesforce.record.update",
    vendor: "salesforce",
    surface: "CRM",
    summary: "Update fields on a record.",
    tags: ["crm", "write"],
    cases: [
      { when: "field history tracking is on for every touched field", tone: "r0", inverse: "update from field history", window: "18 to 24 months", note: "Salesforce keeps the before value itself, so the inverse needs no snapshot of ours" , if: {"kind": "fact", "fact": "salesforce.field_history.all_touched", "is": "true"} },
      { when: "the interceptor captured a before image", tone: "r0", inverse: "update from the captured image", window: "unbounded", note: "the default path, because field history is rarely enabled on every field" , if: {"kind": "fact", "fact": "salesforce.capture.before_image", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an untracked field with no before image has no recoverable prior value" , if: {"kind": "always"} },
    ],
  },
  {
    id: "salesforce.record.delete",
    vendor: "salesforce",
    surface: "CRM",
    summary: "Delete a record.",
    tags: ["crm", "delete", "deferred"],
    cases: [
      { when: "the record went to the recycle bin", tone: "r0", inverse: "undelete", window: "15 days", note: "another vendor built deferral, and again most teams do not rely on it" , if: {"kind": "fact", "fact": "salesforce.record.recycle_bin", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a hard delete or an emptied recycle bin leaves nothing, and cascade deletes take children with it" , if: {"kind": "always"} },
    ],
  },
  {
    id: "salesforce.mass_email.send",
    vendor: "salesforce",
    surface: "CRM",
    summary: "Send a mass email to a list view.",
    tags: ["messaging", "external", "fan-out", "deferred"],
    cases: [
      { when: "the interceptor holds the send and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "an agent with a wrong list filter is the classic case, and the hold is the only thing between it and every customer" , if: {"kind": "fact", "fact": "hold.released", "is": "false"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "unsubscribes and spam complaints from a bad send damage domain reputation for months" , if: {"kind": "always"} },
    ],
  },
  {
    id: "hubspot.contact.merge",
    vendor: "hubspot",
    surface: "CRM",
    summary: "Merge two contact records.",
    tags: ["crm", "destructive"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "merges are explicitly one way, the secondary record is absorbed and field level provenance is lost" , if: {"kind": "always"} },
    ],
  },
  {
    id: "hubspot.workflow.enroll",
    vendor: "hubspot",
    surface: "Marketing",
    summary: "Enrol contacts into a workflow.",
    tags: ["marketing", "fan-out"],
    cases: [
      { when: "the workflow has no external action and enrolment has not advanced a step", tone: "r1", inverse: "unenroll", window: "until the first step fires", note: "the race here is measured in seconds, which is why enrolment is a hold candidate" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "hubspot.workflow.external_action", "is": "false"}, {"kind": "fact", "fact": "hubspot.workflow.step_advanced", "is": "false"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "unenrolling stops future steps but every email already sent stays sent" , if: {"kind": "always"} },
    ],
  },
  {
    id: "zendesk.ticket.create",
    vendor: "zendesk",
    surface: "Support",
    summary: "Create a ticket.",
    tags: ["support", "external"],
    cases: [
      { when: "the ticket is created without a requester notification", tone: "r1", inverse: "delete the ticket", window: "unbounded", note: "the ticket id is consumed and reporting counts it" , if: {"kind": "fact", "fact": "zendesk.ticket.requester_notified", "is": "false"} },
      { when: "always", tone: "r2", inverse: "delete the ticket plus a correction to the requester", window: "unbounded", note: "the requester already received a confirmation email for a ticket that should not exist" , if: {"kind": "always"} },
    ],
  },
  {
    id: "zendesk.ticket.merge",
    vendor: "zendesk",
    surface: "Support",
    summary: "Merge one ticket into another.",
    tags: ["support", "destructive"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the source ticket is closed and its comments are copied, and there is no unmerge" , if: {"kind": "always"} },
    ],
  },
  {
    id: "intercom.conversation.reply",
    vendor: "intercom",
    surface: "Support",
    summary: "Reply to a customer conversation.",
    tags: ["messaging", "external", "deferred"],
    cases: [
      { when: "the interceptor holds the reply and it has not been released", tone: "r0", inverse: "drop from the hold queue", window: "the configured hold, 30 to 900 seconds", note: "the highest value hold for a support agent, because a wrong reply is seen instantly" , if: {"kind": "fact", "fact": "hold.released", "is": "false"} },
      { when: "always", tone: "r2", inverse: "delete the part plus a correction reply", window: "unbounded", note: "deleting removes it from the thread but the customer already got the email or push" , if: {"kind": "always"} },
    ],
  },
  {
    id: "jira.issue.transition",
    vendor: "atlassian",
    surface: "Jira",
    summary: "Transition an issue to another status.",
    tags: ["project", "workflow"],
    cases: [
      { when: "no post function on the transition fires an external action", tone: "r0", inverse: "transition back to the captured status", window: "unbounded", note: "the change history keeps both transitions" , if: {"kind": "fact", "fact": "jira.transition.external_post_function", "is": "false"} },
      { when: "always", tone: "r1", inverse: "transition back plus compensations for each post function", window: "unbounded", note: "post functions are the hidden fan-out here, a status change can send mail or trigger a release" , if: {"kind": "always"} },
    ],
  },
  {
    id: "jira.issue.delete",
    vendor: "atlassian",
    surface: "Jira",
    summary: "Delete an issue.",
    tags: ["project", "delete"],
    cases: [
      { when: "the interceptor captured the issue with its comments and attachments", tone: "r1", inverse: "recreate from the captured payload", window: "unbounded", note: "the issue key is permanently burned, so every link and commit message pointing at it is dead" , if: {"kind": "fact", "fact": "jira.issue.capture.full_payload", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Jira has no recycle bin for issues" , if: {"kind": "always"} },
    ],
  },
  {
    id: "linear.issue.archive",
    vendor: "linear",
    surface: "Project",
    summary: "Archive an issue.",
    tags: ["project", "state"],
    cases: [
      { when: "always", tone: "r0", inverse: "unarchive", window: "unbounded", note: "archiving is a reversible state flag, which is why it is the right default for an agent doing triage" , if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.page.delete",
    vendor: "notion",
    surface: "Docs",
    summary: "Move a page to trash.",
    tags: ["docs", "delete", "deferred"],
    cases: [
      { when: "the page was trashed rather than permanently deleted", tone: "r0", inverse: "restore from trash", window: "30 days on paid plans", note: "the API archive flag is a trash operation, not a destruction" , if: {"kind": "fact", "fact": "notion.page.trashed", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a permanent delete takes every child block with it" , if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.block.update",
    vendor: "notion",
    surface: "Docs",
    summary: "Rewrite the content of a block.",
    tags: ["docs", "write"],
    cases: [
      { when: "the workspace has page history and the edit is within the window", tone: "r0", inverse: "restore the prior page version", window: "7 to 90 days by plan", note: "restore is page level, so it also reverts edits a human made in between" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "notion.workspace.page_history", "is": "true"}, {"kind": "fact", "fact": "notion.edit.within_history_window", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "free workspaces keep no version history at all" , if: {"kind": "always"} },
    ],
  },
  {
    id: "airtable.record.delete",
    vendor: "airtable",
    surface: "Base",
    summary: "Delete records from a table.",
    tags: ["database", "delete", "deferred"],
    cases: [
      { when: "the base snapshot history covers the moment before the call", tone: "r0", inverse: "restore the base snapshot", window: "2 weeks to 1 year by plan", note: "restore is whole base, which is heavy handed but real" , if: {"kind": "fact", "fact": "airtable.base.snapshot_covers_call", "is": "true"} },
      { when: "the interceptor captured the records", tone: "r1", inverse: "create records from the captured payload", window: "unbounded", note: "record ids change, so every linked record and external reference breaks" , if: {"kind": "fact", "fact": "airtable.capture.records", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "attachments hosted by Airtable expire from their URLs and are not part of a record payload" , if: {"kind": "always"} },
    ],
  },
];

const identityEntries: RegistryEntry[] = [
  {
    id: "okta.user.deactivate",
    vendor: "okta",
    surface: "Identity",
    summary: "Deactivate a user.",
    tags: ["identity", "access-control"],
    cases: [
      { when: "always", tone: "r1", inverse: "reactivate the user", window: "unbounded", note: "the account comes back but every session was killed and MFA factors need re-enrolment, so the human is locked out for real time" , if: {"kind": "always"} },
    ],
  },
  {
    id: "okta.user.delete",
    vendor: "okta",
    surface: "Identity",
    summary: "Delete a deactivated user.",
    tags: ["identity", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the user id is gone, and every downstream system that keyed off it now has an orphan" , if: {"kind": "always"} },
    ],
  },
  {
    id: "entra.group.member.add",
    vendor: "microsoft",
    surface: "Entra ID",
    summary: "Add a member to a group.",
    tags: ["identity", "access-control"],
    cases: [
      { when: "the group grants no privileged role and no data access", tone: "r0", inverse: "remove the member", window: "unbounded", note: "clean removal, the membership change is in the audit log" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "entra.group.privileged_role", "is": "false"}, {"kind": "fact", "fact": "entra.group.data_access", "is": "false"}]} },
      { when: "always", tone: "r2", inverse: "remove the member", window: "unbounded", note: "group membership can grant access to years of files, and the removal does not un-read them" , if: {"kind": "always"} },
    ],
  },
  {
    id: "auth0.client_secret.rotate",
    vendor: "auth0",
    surface: "Identity",
    summary: "Rotate an application client secret.",
    tags: ["identity", "credential", "outage"],
    cases: [
      { when: "the prior secret was captured and the application supports two active secrets", tone: "r0", inverse: "restore the prior secret", window: "unbounded", note: "rotation with an overlap window is safe, rotation without one is an outage" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "auth0.secret.prior_captured", "is": "true"}, {"kind": "fact", "fact": "auth0.application.two_active_secrets", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the old secret is not retrievable after rotation, so every service still holding it fails until redeployed" , if: {"kind": "always"} },
    ],
  },
];

const aiEntries: RegistryEntry[] = [
  {
    id: "openai.file.delete",
    vendor: "openai",
    surface: "Platform",
    summary: "Delete an uploaded file.",
    tags: ["ai", "delete"],
    cases: [
      { when: "the original artifact still exists in the source system", tone: "r1", inverse: "re-upload from the source", window: "unbounded", note: "the file id changes, so every assistant and batch job referencing it breaks" , if: {"kind": "fact", "fact": "openai.file.source_exists", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an uploaded file is not retrievable in full once deleted" , if: {"kind": "always"} },
    ],
  },
  {
    id: "openai.fine_tune.create",
    vendor: "openai",
    surface: "Platform",
    summary: "Start a fine tuning job.",
    tags: ["ai", "money", "compute"],
    cases: [
      { when: "the job is queued and has not started", tone: "r0", inverse: "cancel the job", window: "until the job starts", note: "queued jobs are free to cancel" , if: {"kind": "fact", "fact": "openai.fine_tune.status", "is": "queued"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "compute spent is billed whether the resulting model is used or not, and cancellation does not refund it" , if: {"kind": "always"} },
    ],
  },
  {
    id: "vectordb.namespace.delete",
    vendor: "generic",
    surface: "Vector store",
    summary: "Delete a namespace of embeddings.",
    tags: ["ai", "delete"],
    cases: [
      { when: "the source documents and the embedding model version are both pinned", tone: "r1", inverse: "re-embed and re-upsert", window: "unbounded", note: "correct but expensive, and retrieval quality is degraded for the whole rebuild" , if: {"kind": "all", "of": [{"kind": "fact", "fact": "vectordb.source_documents.pinned", "is": "true"}, {"kind": "fact", "fact": "vectordb.embedding_model.pinned", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "if the embedding model has moved on, the vectors cannot be reproduced identically" , if: {"kind": "always"} },
    ],
  },
];

const localEntries: RegistryEntry[] = [
  {
    id: "fs.file.write",
    vendor: "local",
    surface: "Filesystem",
    summary: "Write a file, truncating it if it exists.",
    tags: ["filesystem", "write", "overwrite"],
    cases: [
      { when: "the interceptor copied the prior contents to the shadow store", tone: "r0", inverse: "restore the copy", window: "the shadow store retention", note: "cheap for source files, expensive for anything large, so the interceptor has a size ceiling", if: { kind: "fact", fact: "fs.shadow.captured", is: "true" } },
      { when: "the path is untracked and did not exist", tone: "r0", inverse: "unlink", window: "unbounded", note: "nothing was displaced", if: { kind: "fact", fact: "fs.path.existed", is: "false" } },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an unversioned file over the copy ceiling has no recoverable prior state" , if: { kind: "always" } },
    ],
  },
  {
    id: "fs.path.remove_recursive",
    vendor: "local",
    surface: "Filesystem",
    summary: "Delete a directory tree.",
    tags: ["filesystem", "delete", "fan-out"],
    cases: [
      { when: "every path in the tree is committed and unmodified in git", tone: "r0", inverse: "git checkout of the tree", window: "unbounded", note: "the interceptor checks git status before classifying, which is why the class differs per invocation" , if: {"kind": "fact", "fact": "fs.tree.git_clean", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "untracked files, build outputs and local environment files are not in any history" , if: {"kind": "always"} },
    ],
  },
  {
    id: "git.branch.delete",
    vendor: "local",
    surface: "Git",
    summary: "Delete a branch.",
    tags: ["source", "delete"],
    cases: [
      { when: "the tip commit is merged or recorded by the interceptor", tone: "r0", inverse: "git branch from the captured SHA", window: "roughly 90 days before garbage collection", note: "a branch is only a pointer, so the inverse is exact as long as the SHA is known" , if: {"kind": "any", "of": [{"kind": "fact", "fact": "git.branch.tip_merged", "is": "true"}, {"kind": "fact", "fact": "git.branch.tip_recorded", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an unmerged branch whose SHA nobody recorded is gone once the objects are collected" , if: {"kind": "always"} },
    ],
  },
  {
    id: "git.history.rewrite",
    vendor: "local",
    surface: "Git",
    summary: "Rebase, amend or filter published history.",
    tags: ["source", "destructive"],
    cases: [
      { when: "the branch has not been pushed", tone: "r0", inverse: "reset to the captured SHA", window: "until push", note: "local history is private, so rewriting it costs nothing" , if: {"kind": "fact", "fact": "git.branch.pushed", "is": "false"} },
      { when: "always", tone: "r2", inverse: "force push the captured SHA", window: "until collaborators rebase onto the rewritten history", note: "restoring the old history breaks anyone who already rebased onto the new one, so the inverse has its own blast radius" , if: {"kind": "always"} },
    ],
  },
  {
    id: "shell.command.exec",
    vendor: "local",
    surface: "Shell",
    summary: "Execute an arbitrary shell command.",
    tags: ["shell", "unbounded"],
    cases: [
      { when: "the command matches the read only allowlist", tone: "r0", inverse: "none needed", window: "unbounded", note: "the allowlist is the only reason a shell call can ever be classified better than R3" , if: {"kind": "fact", "fact": "shell.command.read_only_allowlist", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "an arbitrary command cannot be classified before it runs, so it is the worst case by definition, and this is why VOID intercepts at the tool boundary rather than the shell" , if: {"kind": "always"} },
    ],
  },
];

export const registry: RegistryEntry[] = [
  ...awsEntries,
  ...moneyEntries,
  ...messagingEntries,
  ...dataEntries,
  ...devEntries,
  ...recordEntries,
  ...identityEntries,
  ...aiEntries,
  ...localEntries,
];

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

const TONE_RANK: Record<RegistryTone, number> = { r0: 0, r1: 1, r2: 2, r3: 3 };

export const TONE_LABEL: Record<RegistryTone, string> = {
  r0: "fully reversible",
  r1: "reversible with trace",
  r2: "mitigable only",
  r3: "irreversible",
};

/** The class you get when no precondition holds, which is what policy must assume. */
export function worstCase(entry: RegistryEntry): RegistryTone {
  return entry.cases.reduce<RegistryTone>((worst, item) => (TONE_RANK[item.tone] > TONE_RANK[worst] ? item.tone : worst), "r0");
}

/** The class you get when every precondition is configured in your favour. */
export function bestCase(entry: RegistryEntry): RegistryTone {
  return entry.cases.reduce<RegistryTone>((best, item) => (TONE_RANK[item.tone] < TONE_RANK[best] ? item.tone : best), "r3");
}

/**
 * True when the class depends on the state of the target rather than the call.
 * This is the number that matters: a registry of constants would be a lookup
 * table anyone could write, and the conditional entries are the reason it is not.
 */
export function isConditional(entry: RegistryEntry): boolean {
  return worstCase(entry) !== bestCase(entry);
}

/** How much better the best case is than the worst, in classes. */
export function spread(entry: RegistryEntry): number {
  return TONE_RANK[worstCase(entry)] - TONE_RANK[bestCase(entry)];
}

export function findEntry(id: string): RegistryEntry | undefined {
  return registry.find((entry) => entry.id === id);
}

export type RegistryQuery = {
  q?: string;
  vendor?: string;
  tone?: RegistryTone;
  tag?: string;
  conditionalOnly?: boolean;
};

export function searchRegistry(query: RegistryQuery = {}): RegistryEntry[] {
  const needle = (query.q ?? "").trim().toLowerCase();

  return registry.filter((entry) => {
    if (query.vendor && entry.vendor !== query.vendor) return false;
    if (query.tag && !entry.tags.includes(query.tag)) return false;
    if (query.tone && worstCase(entry) !== query.tone) return false;
    if (query.conditionalOnly && !isConditional(entry)) return false;
    if (!needle) return true;

    const haystack = [entry.id, entry.vendor, entry.surface, entry.summary, entry.tags.join(" "), entry.cases.map((item) => `${item.when} ${item.note}`).join(" ")]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function registryVendors(): { vendor: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of registry) counts.set(entry.vendor, (counts.get(entry.vendor) ?? 0) + 1);
  return [...counts.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor));
}

export function registryTags(): string[] {
  const tags = new Set<string>();
  for (const entry of registry) for (const tag of entry.tags) tags.add(tag);
  return [...tags].sort();
}

export function registryStats() {
  const conditional = registry.filter(isConditional);
  const byWorst: Record<RegistryTone, number> = { r0: 0, r1: 0, r2: 0, r3: 0 };
  for (const entry of registry) byWorst[worstCase(entry)] += 1;

  return {
    version: REGISTRY_VERSION,
    entries: registry.length,
    vendors: registryVendors().length,
    cases: registry.reduce((total, entry) => total + entry.cases.length, 0),
    conditional: conditional.length,
    /** Entries where configuration moves the class by two or more, the ones worth auditing first. */
    wideSpread: registry.filter((entry) => spread(entry) >= 2).length,
    byWorstCase: byWorst,
    disclaimer: REGISTRY_DISCLAIMER,
  };
}
