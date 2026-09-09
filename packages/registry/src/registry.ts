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

export const REGISTRY_VERSION = "2026.09.2";

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
      { when: "bucket versioning is Enabled and MFA delete is off", tone: "r0", inverse: "s3:DeleteObject on the delete marker", window: "until a lifecycle rule expires noncurrent versions", note: "the delete only writes a marker, the object is still there underneath", if: { kind: "all", of: [{ kind: "fact", fact: "bucket.versioning", is: "Enabled" }, { kind: "fact", fact: "bucket.mfa_delete", is: "off" }, { kind: "argument", argument: "versionId", operator: "absent" }] } },
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
      { when: "capture_method is manual and the intent is uncaptured", tone: "r0", inverse: "POST /v1/payment_intents/:id/cancel", window: "7 days before the authorisation expires", note: "an uncaptured authorisation holds funds but never moves them, so cancelling is clean", if: { kind: "all", of: [{ kind: "argument", argument: "capture_method", operator: "equals", value: "manual" }, { kind: "fact", fact: "stripe.intent.captured", is: "false" }] } },
      { when: "the charge settled and the balance can cover a refund", tone: "r2", inverse: "POST /v1/refunds", window: "no hard limit, practically 180 days for disputes", note: "the customer sees a charge and a refund, not the absence of a charge, and the card network fee is not returned", if: { kind: "all", of: [{ kind: "fact", fact: "stripe.balance_covers_refund", is: "true" }, { kind: "fact", fact: "stripe.charge.settled", is: "true" }] } },
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
      { when: "the refund is still pending and unsubmitted", tone: "r1", inverse: "POST /v1/refunds/:id/cancel", window: "minutes, only for some payment methods", note: "cancellation is available for a narrow set of methods and never for cards", if: { kind: "all", of: [{ kind: "fact", fact: "stripe.refund.submitted", is: "false" }, { kind: "fact", fact: "stripe.refund.pending", is: "true" }] } },
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
      { when: "always", tone: "r2", inverse: "create a new subscription on the same price", window: "unbounded", note: "billing anchors, trial state and the subscription id do not survive, so proration and revenue reporting shift; recreating is a mitigation, not an undo" , if: { kind: "always" } },
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

  {
    id: "shopify.product.bulk_delete",
    vendor: "shopify",
    surface: "Products",
    summary: "Bulk delete Shopify products.",
    tags: ["shopify", "product", "delete", "bulk"],
    cases: [
      { when: "the full product payloads were captured", tone: "r1", inverse: "recreate products from captured payloads", window: "while media and variant references remain available", note: "product ids, URLs and app side effects can change", if: {"kind": "fact","fact": "shopify.product.capture.full_payload","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted product data and media links are not recoverable without capture", if: {"kind": "always"} },
    ],
  },
  {
    id: "shopify.theme.publish_live",
    vendor: "shopify",
    surface: "Themes",
    summary: "Publish a theme over the live Shopify theme.",
    tags: ["shopify", "theme", "publish"],
    cases: [
      { when: "the previous live theme id was captured", tone: "r0", inverse: "publish the captured previous theme", window: "while the previous theme is retained", note: "publishing switches the live pointer and does not delete the old theme", if: {"kind": "fact","fact": "shopify.theme.previous_live_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "customers may see or cache the new live theme before rollback", if: {"kind": "always"} },
    ],
  },
  {
    id: "shopify.order.bulk_cancel",
    vendor: "shopify",
    surface: "Orders",
    summary: "Cancel many Shopify orders at once.",
    tags: ["shopify", "order", "cancel", "bulk"],
    cases: [
      { when: "no fulfilment or payment capture exists for the orders", tone: "r1", inverse: "recreate draft orders from captured payloads", window: "while inventory and customers remain", note: "order numbers and notifications change", if: {"kind": "all","of": [{"kind": "fact","fact": "shopify.order.fulfillment_created","is": "false"},{"kind": "fact","fact": "shopify.order.payment_captured","is": "false"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "refunds and restocking can mitigate harm but the cancellations cannot be erased", if: {"kind": "always"} },
    ],
  },
  {
    id: "shopify.customer.data_erasure",
    vendor: "shopify",
    surface: "Customers",
    summary: "Erase customer personal data from Shopify.",
    tags: ["shopify", "privacy", "scrub"],
    cases: [
      { when: "the erasure is still pending", tone: "r1", inverse: "cancel the pending erasure request", window: "before Shopify processes the request", note: "after processing, privacy erasure is meant to be permanent", if: {"kind": "fact","fact": "shopify.customer.erasure_pending","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "completed customer data erasure is intentionally irreversible", if: {"kind": "always"} },
    ],
  },
  {
    id: "shopify.discount.bulk_delete",
    vendor: "shopify",
    surface: "Discounts",
    summary: "Bulk delete Shopify discount codes.",
    tags: ["shopify", "discount", "delete", "bulk"],
    cases: [
      { when: "the discount definitions were captured", tone: "r1", inverse: "recreate discounts from captured definitions", window: "while code names remain available", note: "redemption analytics and app side effects are not exactly restored", if: {"kind": "fact","fact": "shopify.discount.capture.definitions","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "discounts can be recreated but campaigns and customer behavior during the gap remain changed", if: {"kind": "always"} },
    ],
  },];

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

  {
    id: "twilio.phone_number.release",
    vendor: "twilio",
    surface: "Phone Numbers",
    summary: "Release a Twilio phone number.",
    tags: ["twilio", "phone", "delete"],
    cases: [
      { when: "the number is still inside Twilio's reclaim window", tone: "r2", inverse: "attempt to reclaim the released number", window: "while the provider holds the number", note: "provider-side release is not a guaranteed inverse and inbound messages during the gap are lost", if: {"kind": "fact","fact": "twilio.number.within_reclaim_window","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the number can be assigned to another customer and cannot be recovered", if: {"kind": "always"} },
    ],
  },
  {
    id: "twilio.messaging_service.delete",
    vendor: "twilio",
    surface: "Messaging Services",
    summary: "Delete a Twilio Messaging Service.",
    tags: ["twilio", "messaging", "delete"],
    cases: [
      { when: "the service configuration was captured", tone: "r2", inverse: "recreate the service and attach available senders", window: "while sender numbers remain available", note: "service SID, delivery history and inbound routing identity change", if: {"kind": "fact","fact": "twilio.messaging_service.captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "sender routing and service identity are lost without a captured configuration", if: {"kind": "always"} },
    ],
  },
  {
    id: "twilio.domain.delete",
    vendor: "twilio",
    surface: "Domains",
    summary: "Delete a Twilio domain or branded link domain.",
    tags: ["twilio", "domain", "delete"],
    cases: [
      { when: "DNS records and provider configuration were captured", tone: "r2", inverse: "recreate the domain configuration and DNS records", window: "while the domain remains under operator control", note: "provider verification and reputation history may not return exactly", if: {"kind": "fact","fact": "twilio.domain.config_captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a deleted provider domain can lose verification and reputation state", if: {"kind": "always"} },
    ],
  },
  {
    id: "twilio.api_key.revoke",
    vendor: "twilio",
    surface: "API Keys",
    summary: "Revoke a Twilio API key.",
    tags: ["twilio", "credential", "revoke"],
    cases: [
      { when: "all clients can rotate to a new key", tone: "r2", inverse: "create a new key and deploy it to clients", window: "while clients are reachable", note: "the revoked key cannot be unrevoked, so rotation is mitigation only", if: {"kind": "fact","fact": "twilio.clients.rotatable","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "unreachable clients that only know the revoked key lose access permanently", if: {"kind": "always"} },
    ],
  },
  {
    id: "sendgrid.domain.delete",
    vendor: "sendgrid",
    surface: "Domains",
    summary: "Delete a SendGrid authenticated sending domain.",
    tags: ["sendgrid", "domain", "delete"],
    cases: [
      { when: "DNS records and domain settings were captured", tone: "r2", inverse: "recreate the domain and DNS records", window: "while DNS ownership remains", note: "sender reputation and verification continuity can still be damaged", if: {"kind": "fact","fact": "sendgrid.domain.config_captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleting a sending domain can break authentication and reputation with no exact inverse", if: {"kind": "always"} },
    ],
  },
  {
    id: "sendgrid.api_key.revoke",
    vendor: "sendgrid",
    surface: "API Keys",
    summary: "Revoke a SendGrid API key.",
    tags: ["sendgrid", "credential", "revoke"],
    cases: [
      { when: "all clients can rotate to a new key", tone: "r2", inverse: "create a new API key and deploy it to clients", window: "while clients are reachable", note: "the old key cannot be restored after revocation", if: {"kind": "fact","fact": "sendgrid.clients.rotatable","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "unreachable senders that only know the revoked key lose mail capability", if: {"kind": "always"} },
    ],
  },
  {
    id: "sendgrid.suppression.delete",
    vendor: "sendgrid",
    surface: "Suppressions",
    summary: "Delete SendGrid suppression records.",
    tags: ["sendgrid", "email", "delete"],
    cases: [
      { when: "the suppression list was captured", tone: "r1", inverse: "restore suppressions from the captured list", window: "while recipient addresses remain valid", note: "messages sent during the gap may have reached suppressed recipients", if: {"kind": "fact","fact": "sendgrid.suppression.capture.list","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "suppression state can be rebuilt but unwanted sends during the gap remain", if: {"kind": "always"} },
    ],
  },
  {
    id: "sendgrid.template.delete",
    vendor: "sendgrid",
    surface: "Templates",
    summary: "Delete a SendGrid dynamic template.",
    tags: ["sendgrid", "template", "delete"],
    cases: [
      { when: "the template versions were captured", tone: "r1", inverse: "recreate the template and versions from capture", window: "while template id references can be updated", note: "the template id changes and clients may need redeploy", if: {"kind": "fact","fact": "sendgrid.template.capture.versions","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "template content is not recoverable without a captured copy", if: {"kind": "always"} },
    ],
  },];

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
      { when: "the interceptor captured the full rows and no foreign key cascaded", tone: "r0", inverse: "INSERT from the captured rows", window: "unbounded", note: "identity columns must be restored explicitly or the ids shift", if: { kind: "all", of: [{ kind: "fact", fact: "pg.capture.before_image", is: "true" }, { kind: "fact", fact: "pg.cascade.traversed", is: "false" }] } },
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
      { when: "always", tone: "r3", inverse: null, window: "none", note: "TRUNCATE is DDL in MySQL, so it commits implicitly and cannot be rolled back, which catches out anyone reasoning from Postgres" , if: {"kind": "always"} },
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

  {
    id: "supabase.table.truncate",
    vendor: "supabase",
    surface: "Postgres",
    summary: "Truncate a Supabase table.",
    tags: ["supabase", "postgres", "database", "delete"],
    cases: [
      { when: "point in time recovery covers the table", tone: "r1", inverse: "restore to a new database and copy the table back", window: "within the PITR window", note: "restore is table-scoped only after manual copy and leaves audit traces", if: {"kind": "fact","fact": "supabase.database.pitr_available","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "truncate removes rows without row-level undo information", if: {"kind": "always"} },
    ],
  },
  {
    id: "supabase.table.drop",
    vendor: "supabase",
    surface: "Postgres",
    summary: "Drop a Supabase table.",
    tags: ["supabase", "postgres", "database", "delete"],
    cases: [
      { when: "point in time recovery covers the database", tone: "r1", inverse: "restore to a new database and copy schema and data back", window: "within the PITR window", note: "dependent policies, grants and generated ids need reconciliation", if: {"kind": "fact","fact": "supabase.database.pitr_available","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "dropping the table removes schema and data with no service-side undelete", if: {"kind": "always"} },
    ],
  },
  {
    id: "supabase.storage.bucket.purge",
    vendor: "supabase",
    surface: "Storage",
    summary: "Purge every object in a Supabase Storage bucket.",
    tags: ["supabase", "storage", "delete", "bulk"],
    cases: [
      { when: "all objects were mirrored before the purge", tone: "r1", inverse: "upload mirrored objects back into the bucket", window: "while the mirror is retained", note: "object metadata and signed URL observations may differ", if: {"kind": "fact","fact": "supabase.storage.objects_mirrored","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "purged objects are deleted from storage with no version restore path", if: {"kind": "always"} },
    ],
  },
  {
    id: "supabase.auth.users.bulk_delete",
    vendor: "supabase",
    surface: "Auth",
    summary: "Bulk delete Supabase Auth users.",
    tags: ["supabase", "auth", "identity", "delete"],
    cases: [
      { when: "auth users count is zero", tone: "r0", inverse: "none needed", window: "unbounded", note: "a no-op bulk delete changes no account state", if: {"kind": "fact","fact": "supabase.auth.users_count","is": "0"} },
      { when: "user exports and provider identities were captured", tone: "r2", inverse: "recreate users where policy and providers allow", window: "while exports and external identities remain valid", note: "password hashes, sessions and auth UIDs cannot be exactly restored", if: {"kind": "fact","fact": "supabase.auth.users_exported","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted auth users, sessions and credentials have no exact inverse", if: {"kind": "always"} },
    ],
  },
  {
    id: "supabase.edge_function.delete",
    vendor: "supabase",
    surface: "Edge Functions",
    summary: "Delete a Supabase Edge Function.",
    tags: ["supabase", "function", "delete"],
    cases: [
      { when: "the function source and secrets manifest are in git", tone: "r1", inverse: "redeploy the function from git", window: "while referenced secrets remain available", note: "deploy history and endpoint downtime remain as traces", if: {"kind": "fact","fact": "supabase.edge_function.source_in_git","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "without source control the deployed code cannot be recovered from deletion", if: {"kind": "always"} },
    ],
  },
  {
    id: "supabase.rls.policy.delete",
    vendor: "supabase",
    surface: "Postgres",
    summary: "Delete a Supabase row level security policy.",
    tags: ["supabase", "postgres", "access-control", "delete"],
    cases: [
      { when: "the policy definition was captured", tone: "r1", inverse: "recreate the policy from captured SQL", window: "unbounded", note: "rows read or written while the policy was absent are not undone", if: {"kind": "fact","fact": "supabase.rls.policy_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "the policy can be rebuilt but exposure or denied work during the gap remains", if: {"kind": "always"} },
    ],
  },
  {
    id: "supabase.database.branch.delete",
    vendor: "supabase",
    surface: "Branches",
    summary: "Delete a Supabase database branch.",
    tags: ["supabase", "database", "branch", "delete"],
    cases: [
      { when: "the branch has no unique data", tone: "r1", inverse: "recreate the branch from its parent", window: "while the parent remains", note: "branch identity and logs change but data loss is absent", if: {"kind": "fact","fact": "supabase.branch.unique_data","is": "false"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "unique branch data is gone when the branch is deleted", if: {"kind": "always"} },
    ],
  },
  {
    id: "supabase.secret.delete",
    vendor: "supabase",
    surface: "Secrets",
    summary: "Delete Supabase project secrets.",
    tags: ["supabase", "secret", "delete", "credential"],
    cases: [
      { when: "the secret values are captured in the operator vault", tone: "r1", inverse: "set each secret from the captured values", window: "while the values remain valid", note: "secret plaintext is write-only after storage", if: {"kind": "fact","fact": "supabase.secret_values_captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted secret values cannot be read back from Supabase", if: {"kind": "always"} },
    ],
  },];

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
      { when: "the tag is immutable and previously unused", tone: "r1", inverse: "delete the tag", window: "unbounded", note: "the digest may already be pinned by a running deployment", if: { kind: "all", of: [{ kind: "fact", fact: "registry.tag.immutable", is: "true" }, { kind: "fact", fact: "registry.tag.previously_used", is: "false" }] } },
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

  {
    id: "kubernetes.deployment.delete",
    vendor: "kubernetes",
    surface: "Deployment",
    summary: "Delete a Deployment and its managed ReplicaSets and Pods.",
    tags: ["kubernetes", "delete", "compute"],
    cases: [
      { when: "manifests are in git and the workload has no persistent volume", tone: "r1", inverse: "kubectl apply -f captured manifest", window: "while referenced images remain available", note: "the replacement has new UIDs and a gap in service history", if: {"kind": "all","of": [{"kind": "fact","fact": "kubernetes.manifests.in_git","is": "true"},{"kind": "fact","fact": "kubernetes.workload.has_persistent_volume","is": "false"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "the spec can often be recreated but the live rollout state and terminated Pods are gone", if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.deployment.scale_down",
    vendor: "kubernetes",
    surface: "Deployment",
    summary: "Scale a Deployment down to fewer replicas.",
    tags: ["kubernetes", "scale", "compute"],
    cases: [
      { when: "the prior replica count was captured and replicas were greater than zero", tone: "r0", inverse: "kubectl scale deployment to the captured replica count", window: "until another actor changes the scale target", note: "the Deployment object remains the same and the inverse only restores desired count", if: {"kind": "all","of": [{"kind": "fact","fact": "kubernetes.deployment.prior_replicas_captured","is": "true"},{"kind": "fact","fact": "kubernetes.deployment.replicas_gt_0","is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Pods killed during the scale down cannot be brought back with the same identity", if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.secret.delete",
    vendor: "kubernetes",
    surface: "Secret",
    summary: "Delete a Kubernetes Secret.",
    tags: ["kubernetes", "secret", "delete", "credential"],
    cases: [
      { when: "the Secret manifest or sealed source is in git", tone: "r1", inverse: "kubectl apply -f captured Secret manifest", window: "while the secret material remains valid", note: "the recreated Secret gets a new resource version and consumers may have observed an outage", if: {"kind": "fact","fact": "kubernetes.secret.source_in_git","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "without a captured value the secret bytes are no longer recoverable from the API", if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.namespace.delete_cascade",
    vendor: "kubernetes",
    surface: "Namespace",
    summary: "Delete a Namespace and cascade deletion to namespaced resources.",
    tags: ["kubernetes", "namespace", "delete", "cascade"],
    cases: [
      { when: "the namespace is empty", tone: "r1", inverse: "kubectl create namespace with captured labels and annotations", window: "unbounded", note: "the namespace object can be recreated but its UID changes", if: {"kind": "fact","fact": "kubernetes.namespace.empty","is": "true"} },
      { when: "manifests are in git and every persistent volume uses Retain", tone: "r2", inverse: "reapply manifests and rebind retained volumes", window: "while retained volumes and images exist", note: "the control plane objects can be rebuilt but workload identity and event history change", if: {"kind": "all","of": [{"kind": "fact","fact": "kubernetes.manifests.in_git","is": "true"},{"kind": "fact","fact": "kubernetes.pv.reclaim_policy","is": "Retain"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "cascade deletion can remove workloads, claims and controller state with no exact inverse", if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.pvc.delete",
    vendor: "kubernetes",
    surface: "PersistentVolumeClaim",
    summary: "Delete a PersistentVolumeClaim.",
    tags: ["kubernetes", "storage", "delete"],
    cases: [
      { when: "the bound PersistentVolume reclaim policy is Retain", tone: "r2", inverse: "recreate the claim and bind it to the retained volume", window: "while the retained volume exists", note: "the data may remain but claim identity and consumers must be repaired", if: {"kind": "fact","fact": "kubernetes.pv.reclaim_policy","is": "Retain"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a Delete reclaim policy can destroy the backing volume with the claim", if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.helm.release.uninstall",
    vendor: "kubernetes",
    surface: "Helm",
    summary: "Uninstall a Helm release.",
    tags: ["kubernetes", "helm", "delete"],
    cases: [
      { when: "chart values were captured and every persistent volume uses Retain", tone: "r2", inverse: "helm install with captured chart and values, then rebind retained volumes", window: "while chart artifacts and retained volumes exist", note: "Helm can recreate objects but cannot preserve UIDs or downtime-free state", if: {"kind": "all","of": [{"kind": "fact","fact": "kubernetes.helm.values_captured","is": "true"},{"kind": "fact","fact": "kubernetes.pv.reclaim_policy","is": "Retain"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "hooks and cascading resource deletion can remove state that Helm history cannot restore", if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.configmap.delete",
    vendor: "kubernetes",
    surface: "ConfigMap",
    summary: "Delete a ConfigMap used by workloads.",
    tags: ["kubernetes", "config", "delete"],
    cases: [
      { when: "the ConfigMap manifest is in git", tone: "r1", inverse: "kubectl apply -f captured ConfigMap manifest", window: "while the referenced data stays current", note: "workloads may have restarted or failed during the absence", if: {"kind": "fact","fact": "kubernetes.manifests.in_git","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "the previous key values are not recoverable without a captured manifest", if: {"kind": "always"} },
    ],
  },
  {
    id: "kubernetes.service.delete",
    vendor: "kubernetes",
    surface: "Service",
    summary: "Delete a Service and its cluster virtual IP.",
    tags: ["kubernetes", "network", "delete"],
    cases: [
      { when: "the Service manifest is in git", tone: "r1", inverse: "kubectl apply -f captured Service manifest", window: "unbounded", note: "the recreated Service can receive a different cluster IP unless it was pinned", if: {"kind": "fact","fact": "kubernetes.manifests.in_git","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "clients may have cached or observed the missing endpoint even after recreation", if: {"kind": "always"} },
    ],
  },
  {
    id: "terraform.apply.plan",
    vendor: "terraform",
    surface: "Apply",
    summary: "Apply a Terraform plan that may destroy or replace resources.",
    tags: ["terraform", "infra", "apply"],
    cases: [
      { when: "the plan has zero destroy actions", tone: "r1", inverse: "terraform apply the captured rollback plan", window: "while providers keep prior remote state", note: "remote provider side effects can still leave traces outside state", if: {"kind": "fact","fact": "terraform.plan.destroy_actions_count","is": "0"} },
      { when: "destroy actions exist and every destroyed resource is stateless and re-creatable from configuration", tone: "r2", inverse: "terraform apply the prior configuration", window: "while provider names and quotas remain available", note: "the resource graph can be rebuilt but identities and outage history change", if: {"kind": "all","of": [{"kind": "fact","fact": "terraform.plan.destroy_actions_count","is": "nonzero"},{"kind": "fact","fact": "terraform.plan.stateless_recreatable","is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "destroying stateful resources can remove provider-side data with no exact inverse", if: {"kind": "always"} },
    ],
  },
  {
    id: "terraform.state.rm",
    vendor: "terraform",
    surface: "State",
    summary: "Remove an address from Terraform state.",
    tags: ["terraform", "state", "delete"],
    cases: [
      { when: "a state backup exists", tone: "r1", inverse: "restore the captured state backup", window: "until another apply depends on the modified state", note: "restoring state is exact for Terraform but may conflict with later remote changes", if: {"kind": "fact","fact": "terraform.state.backup_exists","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "the remote object may survive but Terraform forgets ownership and future applies can drift", if: {"kind": "always"} },
    ],
  },
  {
    id: "terraform.force_unlock",
    vendor: "terraform",
    surface: "Lock",
    summary: "Force unlock a Terraform state lock.",
    tags: ["terraform", "state", "lock"],
    cases: [
      { when: "the recorded lock holder is inactive", tone: "r0", inverse: "no inverse needed", window: "immediate", note: "removing a stale lock only returns the backend to the usable state", if: {"kind": "fact","fact": "terraform.lock.holder_active","is": "false"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "unlocking an active writer can allow concurrent applies and corrupt state ordering", if: {"kind": "always"} },
    ],
  },
  {
    id: "terraform.workspace.delete",
    vendor: "terraform",
    surface: "Workspace",
    summary: "Delete a Terraform workspace.",
    tags: ["terraform", "workspace", "delete"],
    cases: [
      { when: "the workspace state backup exists and no resources remain", tone: "r1", inverse: "recreate workspace and restore the captured state", window: "while backend history retains the backup", note: "the workspace name can return but backend audit history records the deletion", if: {"kind": "all","of": [{"kind": "fact","fact": "terraform.state.backup_exists","is": "true"},{"kind": "fact","fact": "terraform.workspace.empty","is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleting a workspace can discard the last copy of state for live resources", if: {"kind": "always"} },
    ],
  },
  {
    id: "terraform.variable_set.delete",
    vendor: "terraform",
    surface: "Variables",
    summary: "Delete a Terraform variable set.",
    tags: ["terraform", "config", "delete"],
    cases: [
      { when: "the prior variable set was captured", tone: "r1", inverse: "recreate variables from the captured set", window: "while secret values remain captured", note: "secret variables cannot be read back after deletion unless intercepted before the call", if: {"kind": "fact","fact": "terraform.variable_set.captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "write-only secret values are lost when no capture exists", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.repository.transfer_public",
    vendor: "github",
    surface: "Repository",
    summary: "Transfer a public repository to another owner.",
    tags: ["github", "repository", "transfer", "public"],
    cases: [
      { when: "the repository is public and the target owner will transfer it back", tone: "r2", inverse: "request transfer back to the original owner", window: "while the target owner cooperates", note: "public clones and forks made during the transfer cannot be recalled", if: {"kind": "all","of": [{"kind": "fact","fact": "github.repository.public","is": "true"},{"kind": "fact","fact": "github.transfer.target_cooperative","is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "ownership and access may be lost without a unilateral inverse", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.organization.member.remove",
    vendor: "github",
    surface: "Organization",
    summary: "Remove a member from a GitHub organization.",
    tags: ["github", "identity", "access-control"],
    cases: [
      { when: "membership, teams and roles were captured", tone: "r1", inverse: "reinvite the member and restore captured teams and roles", window: "while the user accepts the invitation", note: "the access gap and audit log remain even if permissions return", if: {"kind": "fact","fact": "github.org.member_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "access can be re-granted but private forks, tokens and automation may be disrupted", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.actions.secret.delete",
    vendor: "github",
    surface: "Actions",
    summary: "Delete GitHub Actions repository secrets.",
    tags: ["github", "secret", "delete", "credential"],
    cases: [
      { when: "the secret values are captured in the operator vault", tone: "r1", inverse: "gh secret set for each captured secret", window: "while the secret values remain valid", note: "GitHub cannot reveal deleted secret values, so only an external capture makes this reversible", if: {"kind": "fact","fact": "github.actions.secret_values_captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "write-only secret values are gone from GitHub after deletion", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.branch.force_push.default",
    vendor: "github",
    surface: "Git",
    summary: "Force push the default branch.",
    tags: ["github", "git", "history"],
    cases: [
      { when: "overwritten commits remain reachable and the default branch does not deploy", tone: "r1", inverse: "force push the captured prior tip", window: "while overwritten commits remain reachable", note: "restoring history can invalidate work based on the new tip", if: {"kind": "all","of": [{"kind": "fact","fact": "github.commits.reachable","is": "true"},{"kind": "fact","fact": "github.base_branch.deploys","is": "false"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "lost commits or triggered deployments cannot be exactly undone", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.branch.protection.delete",
    vendor: "github",
    surface: "Branches",
    summary: "Delete a branch protection rule.",
    tags: ["github", "access-control", "delete"],
    cases: [
      { when: "the prior protection rule was captured", tone: "r1", inverse: "recreate the captured branch protection rule", window: "unbounded", note: "writes accepted while protection was absent remain in history", if: {"kind": "fact","fact": "github.branch_protection.captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "the rule can be rebuilt but unreviewed pushes during the gap remain", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.team.delete",
    vendor: "github",
    surface: "Teams",
    summary: "Delete a GitHub team.",
    tags: ["github", "identity", "delete"],
    cases: [
      { when: "team membership and repository grants were captured", tone: "r1", inverse: "recreate the team and restore captured grants", window: "while members and repositories still exist", note: "the team slug and audit trail can change", if: {"kind": "fact","fact": "github.team_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "permissions can be reassembled but exact team identity and audit continuity are lost", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.deploy_key.delete",
    vendor: "github",
    surface: "Deploy keys",
    summary: "Delete a repository deploy key.",
    tags: ["github", "credential", "delete"],
    cases: [
      { when: "the public key and write access flag were captured", tone: "r1", inverse: "recreate the deploy key from the captured public key", window: "while the private key still exists wherever it was generated", note: "GitHub stores only the public key, so runtime reachability depends on the external private key", if: {"kind": "fact","fact": "github.deploy_key.captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "a new key can restore access but every consumer must rotate", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.repository.visibility_public",
    vendor: "github",
    surface: "Repository",
    summary: "Change a private repository to public.",
    tags: ["github", "repository", "exposure"],
    cases: [
      { when: "the repository has no private data and the visibility change has not propagated to mirrors", tone: "r1", inverse: "set repository visibility back to private", window: "minutes", note: "the setting can be restored but the exposure event is still visible in audit history", if: {"kind": "all","of": [{"kind": "fact","fact": "github.repository.contains_private_data","is": "false"},{"kind": "fact","fact": "github.repository.public_mirrors_observed","is": "false"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "making code public cannot unshare clones or cached copies", if: {"kind": "always"} },
    ],
  },
  {
    id: "github.environment.secret.delete",
    vendor: "github",
    surface: "Environments",
    summary: "Delete GitHub environment secrets.",
    tags: ["github", "secret", "delete", "credential"],
    cases: [
      { when: "the environment secret values are captured in the operator vault", tone: "r1", inverse: "gh secret set with the captured environment scope", window: "while the values remain valid", note: "the environment protection rules do not store secret plaintext", if: {"kind": "fact","fact": "github.environment.secret_values_captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "write-only environment secret values are gone after deletion", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitlab.project.delete",
    vendor: "gitlab",
    surface: "Project",
    summary: "Delete a GitLab project.",
    tags: ["gitlab", "project", "delete"],
    cases: [
      { when: "the project is inside the restore window", tone: "r1", inverse: "restore the project from GitLab pending deletion", window: "until the deletion window expires", note: "webhooks and runners may need repair after restore", if: {"kind": "fact","fact": "gitlab.project.within_restore_window","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "after permanent deletion the repository, issues and packages are gone from GitLab", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitlab.branch.force_push",
    vendor: "gitlab",
    surface: "Git",
    summary: "Force push a GitLab branch.",
    tags: ["gitlab", "git", "history"],
    cases: [
      { when: "overwritten commits remain reachable and the branch does not deploy", tone: "r1", inverse: "force push the captured prior tip", window: "while overwritten commits remain reachable", note: "pipelines and reviews created from the new tip remain as traces", if: {"kind": "all","of": [{"kind": "fact","fact": "gitlab.commits.reachable","is": "true"},{"kind": "fact","fact": "gitlab.branch.deploys","is": "false"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "lost commits or triggered deployments cannot be exactly undone", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitlab.group.member.remove",
    vendor: "gitlab",
    surface: "Group",
    summary: "Remove a member from a GitLab group.",
    tags: ["gitlab", "identity", "access-control"],
    cases: [
      { when: "group roles and project memberships were captured", tone: "r1", inverse: "reinvite the member and restore captured roles", window: "while the user accepts the invitation", note: "the access gap and audit event remain", if: {"kind": "fact","fact": "gitlab.member_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "access can be restored but tokens and running jobs may already have failed", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitlab.ci_variable.delete",
    vendor: "gitlab",
    surface: "CI variables",
    summary: "Delete GitLab CI variables.",
    tags: ["gitlab", "secret", "delete", "credential"],
    cases: [
      { when: "the variable values were captured in the operator vault", tone: "r1", inverse: "recreate the CI variables from the captured values", window: "while the values remain valid", note: "masked variables are write-only in GitLab after creation", if: {"kind": "fact","fact": "gitlab.ci_variable_values_captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted masked variable values cannot be read back from GitLab", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitlab.project.transfer_public_namespace",
    vendor: "gitlab",
    surface: "Project",
    summary: "Transfer a project into a public namespace.",
    tags: ["gitlab", "project", "transfer", "public"],
    cases: [
      { when: "the namespace owner will transfer it back and the project has no private data", tone: "r2", inverse: "request transfer back to the original namespace", window: "while the new owner cooperates", note: "public fetches during the transfer cannot be recalled", if: {"kind": "all","of": [{"kind": "fact","fact": "gitlab.transfer.target_cooperative","is": "true"},{"kind": "fact","fact": "gitlab.project.contains_private_data","is": "false"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "project ownership can be lost without a unilateral restore path", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitlab.protected_branch.delete",
    vendor: "gitlab",
    surface: "Protected branches",
    summary: "Delete a GitLab protected branch rule.",
    tags: ["gitlab", "access-control", "delete"],
    cases: [
      { when: "the protected branch rule was captured", tone: "r1", inverse: "recreate the protected branch rule", window: "unbounded", note: "pushes accepted while protection was absent remain in history", if: {"kind": "fact","fact": "gitlab.protected_branch.captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "the rule can be rebuilt but the protection gap cannot be erased", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitea.repository.delete",
    vendor: "gitea",
    surface: "Repository",
    summary: "Delete a Gitea repository.",
    tags: ["gitea", "repository", "delete"],
    cases: [
      { when: "a repository backup exists", tone: "r1", inverse: "restore the repository from the captured backup", window: "while the backup is retained", note: "repository ids, hooks and issue side effects may differ after restore", if: {"kind": "fact","fact": "gitea.repository.backup_exists","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "without a backup the repository database rows and git data are removed", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitea.branch.force_push",
    vendor: "gitea",
    surface: "Git",
    summary: "Force push a Gitea branch.",
    tags: ["gitea", "git", "history"],
    cases: [
      { when: "overwritten commits remain reachable", tone: "r1", inverse: "force push the captured prior tip", window: "while commits remain reachable", note: "restoring the tip changes history again for anyone who pulled the new one", if: {"kind": "fact","fact": "gitea.commits.reachable","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "unreachable commits may be garbage collected with no service restore path", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitea.organization.member.remove",
    vendor: "gitea",
    surface: "Organization",
    summary: "Remove a member from a Gitea organization.",
    tags: ["gitea", "identity", "access-control"],
    cases: [
      { when: "team memberships and repository grants were captured", tone: "r1", inverse: "reinvite the member and restore captured teams", window: "while the user account exists", note: "access continuity and audit history are not erased", if: {"kind": "fact","fact": "gitea.member_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "permissions can be reconstructed but work depending on the access may already have failed", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitea.actions.secret.delete",
    vendor: "gitea",
    surface: "Actions",
    summary: "Delete Gitea Actions secrets.",
    tags: ["gitea", "secret", "delete", "credential"],
    cases: [
      { when: "the secret values are captured in the operator vault", tone: "r1", inverse: "recreate the captured secrets", window: "while values remain valid", note: "secret plaintext is not readable after creation", if: {"kind": "fact","fact": "gitea.actions.secret_values_captured","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted write-only secret values cannot be recovered from Gitea", if: {"kind": "always"} },
    ],
  },
  {
    id: "gitea.repository.transfer_public",
    vendor: "gitea",
    surface: "Repository",
    summary: "Transfer a repository to a public owner.",
    tags: ["gitea", "repository", "transfer", "public"],
    cases: [
      { when: "the target owner will transfer it back and the repository has no private data", tone: "r2", inverse: "request transfer back to the original owner", window: "while the new owner cooperates", note: "public clones during the transfer cannot be recalled", if: {"kind": "all","of": [{"kind": "fact","fact": "gitea.transfer.target_cooperative","is": "true"},{"kind": "fact","fact": "gitea.repository.contains_private_data","is": "false"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "ownership may be lost with no unilateral inverse", if: {"kind": "always"} },
    ],
  },];

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

  {
    id: "linear.project.delete",
    vendor: "linear",
    surface: "Project",
    summary: "Delete a Linear project.",
    tags: ["linear", "project", "delete"],
    cases: [
      { when: "the full project payload was captured", tone: "r1", inverse: "recreate the project from the captured payload", window: "while teams and issue ids are still meaningful", note: "Linear can recreate content but not preserve every id or notification trace", if: {"kind": "fact","fact": "linear.project.capture.full_payload","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "exports can mitigate loss but project identity and history are not exactly restorable", if: {"kind": "always"} },
    ],
  },
  {
    id: "linear.issue.bulk_delete",
    vendor: "linear",
    surface: "Issues",
    summary: "Bulk delete Linear issues.",
    tags: ["linear", "issue", "delete", "bulk"],
    cases: [
      { when: "full issue payloads were captured", tone: "r1", inverse: "recreate each issue from the captured payload", window: "while referenced projects and teams exist", note: "issue identifiers and notification history change", if: {"kind": "fact","fact": "linear.issue.capture.full_payload","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted issue descriptions and comments are not recoverable without capture", if: {"kind": "always"} },
    ],
  },
  {
    id: "linear.team.delete",
    vendor: "linear",
    surface: "Team",
    summary: "Delete a Linear team.",
    tags: ["linear", "team", "delete"],
    cases: [
      { when: "team settings, members and workflow states were captured", tone: "r1", inverse: "recreate the team and restore captured settings", window: "while workspace members exist", note: "the team key and issue links may change", if: {"kind": "fact","fact": "linear.team_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "work can be reorganized but team identity and routing history are gone", if: {"kind": "always"} },
    ],
  },
  {
    id: "linear.workspace.data_scrub",
    vendor: "linear",
    surface: "Workspace",
    summary: "Scrub personal data from Linear workspace records.",
    tags: ["linear", "privacy", "scrub"],
    cases: [
      { when: "the scrub only redacts data already exported to the compliance archive", tone: "r2", inverse: "restore operational references from the archive where allowed", window: "while the archive is retained", note: "privacy erasure can be mitigated for operations but should not be reversed into the product", if: {"kind": "fact","fact": "linear.scrub.archive_exists","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "a completed privacy scrub is intentionally destructive", if: {"kind": "always"} },
    ],
  },
  {
    id: "linear.project.archive",
    vendor: "linear",
    surface: "Project",
    summary: "Archive a Linear project.",
    tags: ["linear", "project", "archive"],
    cases: [
      { when: "the project remains restorable from archive", tone: "r1", inverse: "unarchive the project", window: "while the archive state is retained", note: "automation that skipped archived projects may already have run", if: {"kind": "fact","fact": "linear.project.in_archive","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "the project can be recreated but scheduling and notification side effects remain", if: {"kind": "always"} },
    ],
  },
  {
    id: "jira.project.delete",
    vendor: "jira",
    surface: "Project",
    summary: "Delete a Jira project.",
    tags: ["jira", "project", "delete"],
    cases: [
      { when: "the project is inside Jira trash and project data is retained", tone: "r1", inverse: "restore the project from trash", window: "until trash retention expires", note: "project restoration leaves deletion and restoration audit events", if: {"kind": "fact","fact": "jira.project.in_trash","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "permanent project deletion removes issues, configuration and history", if: {"kind": "always"} },
    ],
  },
  {
    id: "jira.issue.bulk_delete",
    vendor: "jira",
    surface: "Issues",
    summary: "Bulk delete Jira issues.",
    tags: ["jira", "issue", "delete", "bulk"],
    cases: [
      { when: "the interceptor captured issues, comments and attachments", tone: "r1", inverse: "recreate issues from the captured payload", window: "while referenced projects and users exist", note: "issue keys and notifications cannot be exactly preserved", if: {"kind": "fact","fact": "jira.issue.capture.full_payload","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "bulk deleted issue content is not recoverable without capture", if: {"kind": "always"} },
    ],
  },
  {
    id: "jira.user.data_scrub",
    vendor: "jira",
    surface: "Users",
    summary: "Scrub a user's personal data from Jira.",
    tags: ["jira", "privacy", "scrub"],
    cases: [
      { when: "the scrub is limited to reversible display name masking", tone: "r2", inverse: "restore display names where policy allows", window: "while account mappings remain", note: "privacy actions are policy constrained and audit-visible", if: {"kind": "fact","fact": "jira.scrub.display_name_only","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "completed erasure of user personal data is intentionally irreversible", if: {"kind": "always"} },
    ],
  },
  {
    id: "jira.workflow.delete",
    vendor: "jira",
    surface: "Workflow",
    summary: "Delete a Jira workflow.",
    tags: ["jira", "config", "delete"],
    cases: [
      { when: "the workflow XML and scheme bindings were captured", tone: "r1", inverse: "import the workflow and restore captured scheme bindings", window: "while referenced statuses exist", note: "issues moved during the gap may stay on different paths", if: {"kind": "fact","fact": "jira.workflow.capture.full_payload","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "workflow shape can be rebuilt but transition history and automation gaps remain", if: {"kind": "always"} },
    ],
  },
  {
    id: "jira.board.delete",
    vendor: "jira",
    surface: "Board",
    summary: "Delete a Jira board.",
    tags: ["jira", "board", "delete"],
    cases: [
      { when: "the board filter and settings were captured", tone: "r1", inverse: "recreate the board from captured settings", window: "while the saved filter exists", note: "board id and sprint side effects may change", if: {"kind": "fact","fact": "jira.board.capture.settings","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "reports and filters can be rebuilt but board identity and analytics history change", if: {"kind": "always"} },
    ],
  },
  {
    id: "asana.project.delete",
    vendor: "asana",
    surface: "Project",
    summary: "Delete an Asana project.",
    tags: ["asana", "project", "delete"],
    cases: [
      { when: "the project is inside the restore window", tone: "r1", inverse: "restore the project from Asana deleted projects", window: "until the restore window expires", note: "notifications and integrations may have observed the deletion", if: {"kind": "fact","fact": "asana.project.within_restore_window","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "after the restore window expires project data is permanently deleted", if: {"kind": "always"} },
    ],
  },
  {
    id: "asana.task.bulk_delete",
    vendor: "asana",
    surface: "Tasks",
    summary: "Bulk delete Asana tasks.",
    tags: ["asana", "task", "delete", "bulk"],
    cases: [
      { when: "full task payloads were captured", tone: "r1", inverse: "recreate tasks from captured payloads", window: "while projects and users remain", note: "task ids, activity history and notifications cannot be exactly preserved", if: {"kind": "fact","fact": "asana.task.capture.full_payload","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted task bodies and comments are not recoverable without capture", if: {"kind": "always"} },
    ],
  },
  {
    id: "asana.team.delete",
    vendor: "asana",
    surface: "Team",
    summary: "Delete an Asana team.",
    tags: ["asana", "team", "delete"],
    cases: [
      { when: "team members, projects and settings were captured", tone: "r1", inverse: "recreate the team and restore captured membership", window: "while workspace members exist", note: "team identity and audit history change", if: {"kind": "fact","fact": "asana.team_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "membership can be rebuilt but access gaps and integration failures remain", if: {"kind": "always"} },
    ],
  },
  {
    id: "asana.portfolio.delete",
    vendor: "asana",
    surface: "Portfolio",
    summary: "Delete an Asana portfolio.",
    tags: ["asana", "portfolio", "delete"],
    cases: [
      { when: "portfolio membership and fields were captured", tone: "r1", inverse: "recreate the portfolio from captured settings", window: "while referenced projects exist", note: "portfolio id and reporting continuity change", if: {"kind": "fact","fact": "asana.portfolio.capture.settings","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "the visible grouping can be rebuilt but historical reporting continuity is lost", if: {"kind": "always"} },
    ],
  },
  {
    id: "asana.workspace.member.remove",
    vendor: "asana",
    surface: "Workspace",
    summary: "Remove a member from an Asana workspace.",
    tags: ["asana", "identity", "access-control"],
    cases: [
      { when: "member access and team memberships were captured", tone: "r1", inverse: "reinvite the member and restore captured access", window: "while the user accepts the invitation", note: "tasks reassigned or automation triggered during the gap remain changed", if: {"kind": "fact","fact": "asana.member_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "permissions can be restored but access-dependent work may already have failed", if: {"kind": "always"} },
    ],
  },
  {
    id: "sentry.project.delete",
    vendor: "sentry",
    surface: "Project",
    summary: "Delete a Sentry project.",
    tags: ["sentry", "project", "delete"],
    cases: [
      { when: "project settings and DSNs were captured and events were exported", tone: "r2", inverse: "recreate the project and import supported settings", window: "while exports are retained", note: "event ids, issue grouping and inbound DSNs do not return exactly", if: {"kind": "all","of": [{"kind": "fact","fact": "sentry.project.settings_captured","is": "true"},{"kind": "fact","fact": "sentry.events.exported","is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleting the project removes issue and event history from Sentry", if: {"kind": "always"} },
    ],
  },
  {
    id: "sentry.issue.bulk_delete",
    vendor: "sentry",
    surface: "Issues",
    summary: "Bulk delete Sentry issues.",
    tags: ["sentry", "issue", "delete", "bulk"],
    cases: [
      { when: "events were exported before deletion", tone: "r2", inverse: "recreate tracking from exported events where supported", window: "while exports are retained", note: "Sentry issue grouping and comments cannot be exactly replayed", if: {"kind": "fact","fact": "sentry.events.exported","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "deleted issues and events are not restorable from the service", if: {"kind": "always"} },
    ],
  },
  {
    id: "sentry.organization.member.remove",
    vendor: "sentry",
    surface: "Organization",
    summary: "Remove a member from a Sentry organization.",
    tags: ["sentry", "identity", "access-control"],
    cases: [
      { when: "member role and team assignments were captured", tone: "r1", inverse: "reinvite the member and restore captured assignments", window: "while the user accepts the invitation", note: "the access gap and audit event remain", if: {"kind": "fact","fact": "sentry.member_state_captured","is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "access can be restored but alerts and ownership workflows may already have changed", if: {"kind": "always"} },
    ],
  },
  {
    id: "sentry.dsn.revoke",
    vendor: "sentry",
    surface: "DSN",
    summary: "Revoke a Sentry DSN.",
    tags: ["sentry", "credential", "revoke"],
    cases: [
      { when: "applications can receive a newly issued DSN through the deploy pipeline", tone: "r2", inverse: "create a new DSN and deploy it to clients", window: "while clients can be redeployed", note: "the old DSN cannot be unrevoked, so clients must rotate", if: {"kind": "fact","fact": "sentry.clients.redeployable","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "revoked ingestion credentials can strand clients that cannot be updated", if: {"kind": "always"} },
    ],
  },
  {
    id: "sentry.replay.scrub",
    vendor: "sentry",
    surface: "Replay",
    summary: "Scrub Sentry replay data.",
    tags: ["sentry", "privacy", "scrub"],
    cases: [
      { when: "the scrub removes only replay data already exported to an allowed archive", tone: "r2", inverse: "use the archive for investigation where policy allows", window: "while the archive is retained", note: "privacy scrubbing should not be reversed into Sentry", if: {"kind": "fact","fact": "sentry.replay.archive_exists","is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "completed replay scrubbing destroys diagnostic data", if: {"kind": "always"} },
    ],
  },];

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
      { when: "the path is untracked and did not exist", tone: "r0", inverse: "unlink", window: "unbounded", note: "nothing was displaced", if: { kind: "all", of: [{ kind: "fact", fact: "fs.path.existed", is: "false" }, { kind: "fact", fact: "fs.tree.git_clean", is: "true" }] } },
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

const platformEntries: RegistryEntry[] = [
  {
    id: "airtable.base.delete",
    vendor: "airtable",
    surface: "Base Administration",
    summary: "Delete an Airtable base through the Enterprise administration API.",
    tags: ["airtable", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Rebuild from the copy; record identifiers, automation history and integrations may differ.", if: {"kind": "fact", "fact": "airtable.base.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Base deletion can remove tables, automations, attachments and access configuration.", if: {"kind": "always"} },
    ],
  },
  {
    id: "airtable.base.member.remove",
    vendor: "airtable",
    surface: "Base Collaborators",
    summary: "Remove a base collaborator.",
    tags: ["airtable", "remove"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinvite or regrant access to reduce disruption; required acceptance, missed activity and original access state cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "airtable.record.bulk_delete",
    vendor: "airtable",
    surface: "Records",
    summary: "Delete a batch of Airtable records.",
    tags: ["airtable", "bulk_delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Reinsert captured records and reconnect links; record IDs and automation side effects may change.", if: {"kind": "fact", "fact": "airtable.record.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleted records and attachments are unavailable without a retained recovery path.", if: {"kind": "always"} },
    ],
  },
  {
    id: "airtable.token.revoke",
    vendor: "airtable",
    surface: "Token Administration",
    summary: "Revoke an Airtable personal access token through developer settings.",
    tags: ["airtable", "revoke"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Issue a replacement credential and update consumers to reduce disruption; the revoked credential cannot be reactivated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "airtable.user.deactivate",
    vendor: "airtable",
    surface: "Enterprise Users",
    summary: "Deactivate a user in a supported Airtable Enterprise account.",
    tags: ["airtable", "deactivate"],
    cases: [
      { when: "the user was active and same-account reactivation preserves all access", tone: "r1", inverse: "Reactivate the same enterprise user.", window: "while the same account remains available for reactivation", note: "Reactivation preserves the account, but access interruption and audit events remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "airtable.user.previously_active", "is": "true"}, {"kind": "fact", "fact": "airtable.user.reactivation_preserves_access", "is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reactivate the user to mitigate disruption; uncaptured permissions and reassigned content can prevent full recovery.", if: {"kind": "always"} },
    ],
  },
  {
    id: "airtable.workspace.delete",
    vendor: "airtable",
    surface: "Workspace Administration",
    summary: "Delete an Airtable workspace through the Enterprise administration API.",
    tags: ["airtable", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Rebuild a replacement workspace and bases; workspace identity, billing state and history differ.", if: {"kind": "fact", "fact": "airtable.workspace.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Workspace deletion can cascade to bases and destroy their content.", if: {"kind": "always"} },
    ],
  },
  {
    id: "airtable.workspace.member.remove",
    vendor: "airtable",
    surface: "Workspace Collaborators",
    summary: "Remove a workspace collaborator.",
    tags: ["airtable", "remove"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinvite or regrant access to reduce disruption; required acceptance, missed activity and original access state cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.aks.cluster.delete",
    vendor: "azure",
    surface: "AKS",
    summary: "Delete an AKS cluster.",
    tags: ["azure", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Rebuild the cluster and restore volumes; cluster identity, event history and running workloads do not return.", if: {"kind": "fact", "fact": "azure.aks.cluster.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Cluster deletion can destroy workloads, node resources and volume data.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.appservice.site.delete",
    vendor: "azure",
    surface: "App Service",
    summary: "Delete an App Service web app.",
    tags: ["azure", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the app from the copy; identity, host bindings and service continuity may change.", if: {"kind": "fact", "fact": "azure.appservice.site.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the app can remove unique content, configuration and credentials.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.cosmosdb.account.delete",
    vendor: "azure",
    surface: "Cosmos DB",
    summary: "Delete a Cosmos DB account.",
    tags: ["azure", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Restore the account data into replacement resources; account identity and subsequent writes may not return.", if: {"kind": "fact", "fact": "azure.cosmosdb.account.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the account can remove every database and container.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.keyvault.purge",
    vendor: "azure",
    surface: "Key Vault",
    summary: "Permanently purge a soft deleted Key Vault.",
    tags: ["azure", "purge"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Purge removes the recovery path for the vault and its remaining keys, secrets and certificates.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.keyvault.secret.purge",
    vendor: "azure",
    surface: "Key Vault",
    summary: "Permanently purge a soft deleted secret.",
    tags: ["azure", "purge"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The retained secret versions are permanently removed from Key Vault.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.managed_disk.delete",
    vendor: "azure",
    surface: "Managed Disks",
    summary: "Delete a managed disk.",
    tags: ["azure", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement disk from the copy; attachments and writes after the recovery point require repair.", if: {"kind": "fact", "fact": "azure.managed_disk.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The disk bytes cannot be recovered without a retained recovery copy.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.resource_group.delete",
    vendor: "azure",
    surface: "Resource Manager",
    summary: "Delete a resource group and cascade deletion to its resources.",
    tags: ["azure", "delete", "cascade"],
    cases: [
      { when: "the resource group is empty and its complete metadata was captured", tone: "r2", inverse: null, window: "while the name and captured access remain available", note: "Recreate the empty group from captured metadata to reduce disruption; resource identity, inherited access and activity history cannot be restored exactly.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "azure.resource_group.empty", "is": "true"}, {"kind": "fact", "fact": "azure.resource_group.metadata_captured", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Cascade deletion can permanently remove independent resources and their data.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.snapshot.delete",
    vendor: "azure",
    surface: "Managed Disks",
    summary: "Delete a managed disk snapshot.",
    tags: ["azure", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The snapshot recovery point is destroyed; another snapshot is not the same recovery point.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.sql.database.drop",
    vendor: "azure",
    surface: "Azure SQL",
    summary: "Drop an Azure SQL database.",
    tags: ["azure", "drop"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Restore a database from the recovery copy; endpoint bindings and writes after the recovery point require repair.", if: {"kind": "fact", "fact": "azure.sql.database.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Without a usable restore path the deleted database contents are lost.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.storage.account.delete",
    vendor: "azure",
    surface: "Storage",
    summary: "Delete a storage account and its data services.",
    tags: ["azure", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create replacement storage and import the recovery copies; URLs and account identity may change.", if: {"kind": "fact", "fact": "azure.storage.account.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the account can destroy blobs, queues, tables and files.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.storage.container.delete",
    vendor: "azure",
    surface: "Blob Storage",
    summary: "Delete a blob container.",
    tags: ["azure", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Restore contents into a replacement container; identity and access history may differ.", if: {"kind": "fact", "fact": "azure.storage.container.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Without retained recoverable data the container contents cannot be restored.", if: {"kind": "always"} },
    ],
  },
  {
    id: "azure.vm.delete",
    vendor: "azure",
    surface: "Virtual Machines",
    summary: "Delete a virtual machine.",
    tags: ["azure", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Rebuild the VM from the recovery copies; VM identity, runtime state and downtime cannot be undone.", if: {"kind": "fact", "fact": "azure.vm.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "VM deletion can also delete attached disks and unique runtime state.", if: {"kind": "always"} },
    ],
  },
  {
    id: "basecamp.project.archive",
    vendor: "basecamp",
    surface: "Projects",
    summary: "Archive a Basecamp project.",
    tags: ["basecamp", "archive"],
    cases: [
      { when: "the project was active before this call and account project capacity permits restoration", tone: "r1", inverse: "Set the same project status to active.", window: "while the project remains archived", note: "The same project can return to active status with archive history retained.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "basecamp.project.previously_active", "is": "true"}, {"kind": "fact", "fact": "basecamp.project.restore_capacity_available", "is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Unarchive to reduce disruption; an unknown prior state prevents a reliable inverse.", if: {"kind": "always"} },
    ],
  },
  {
    id: "basecamp.project.member.remove",
    vendor: "basecamp",
    surface: "Project Access",
    summary: "Remove a person from a Basecamp project.",
    tags: ["basecamp", "remove"],
    cases: [
      { when: "all prior access was captured and regrant to the same principal is supported", tone: "r1", inverse: "Regrant all captured access to the same principal.", window: "while the principal and captured grants remain valid", note: "Access can be restored, but removal, missed activity and audit events remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "basecamp.project.member.access_captured", "is": "true"}, {"kind": "fact", "fact": "basecamp.project.member.regrant_supported", "is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinviting a user may reduce disruption but does not restore uncaptured access or undo missed activity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "basecamp.project.trash",
    vendor: "basecamp",
    surface: "Projects",
    summary: "Move a Basecamp project to trash.",
    tags: ["basecamp", "trash"],
    cases: [
      { when: "the project was active and its complete contents remain restorable from trash and account project capacity permits restoration", tone: "r1", inverse: "Set the same project status to active.", window: "while the original project remains in trash and restorable", note: "Restoring preserves the project, but deletion history and notification gaps remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "basecamp.project.previously_active", "is": "true"}, {"kind": "fact", "fact": "basecamp.project.trash_restorable", "is": "true"}, {"kind": "fact", "fact": "basecamp.project.restore_capacity_available", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Without a supported restore path the deleted project data cannot be recovered.", if: {"kind": "always"} },
    ],
  },
  {
    id: "basecamp.recording.trash",
    vendor: "basecamp",
    surface: "Recordings",
    summary: "Move a Basecamp recording to trash.",
    tags: ["basecamp", "trash"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Trashing hides the original recording; without a verified retained recovery path VOID cannot promise restoration.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.api_token.revoke",
    vendor: "cloudflare",
    surface: "API Tokens",
    summary: "Revoke a Cloudflare API token.",
    tags: ["cloudflare", "revoke"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Issue a replacement credential and update consumers to reduce disruption; the revoked credential cannot be reactivated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.d1.database.delete",
    vendor: "cloudflare",
    surface: "D1",
    summary: "Delete a D1 database.",
    tags: ["cloudflare", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Import into a replacement D1 database and update bindings; database identity and later writes differ.", if: {"kind": "fact", "fact": "cloudflare.d1.database.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Database deletion can remove the last usable database recovery path.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.dns_record.delete",
    vendor: "cloudflare",
    surface: "DNS",
    summary: "Delete a DNS record.",
    tags: ["cloudflare", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Recreating a record can reduce outage but cannot undo cached negative responses or failed traffic.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.kv.namespace.delete",
    vendor: "cloudflare",
    surface: "Workers KV",
    summary: "Delete a KV namespace and every stored key.",
    tags: ["cloudflare", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Import into a replacement namespace and update bindings; namespace identity and expired data differ.", if: {"kind": "fact", "fact": "cloudflare.kv.namespace.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Namespace deletion destroys the stored values and their original namespace identity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.pages.project.delete",
    vendor: "cloudflare",
    surface: "Pages",
    summary: "Delete a Pages project.",
    tags: ["cloudflare", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the project and deploy source; deployment URLs and history do not return.", if: {"kind": "fact", "fact": "cloudflare.pages.project.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Project deletion removes deployment history and can remove unique settings.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.r2.bucket.delete",
    vendor: "cloudflare",
    surface: "R2",
    summary: "Delete an R2 bucket.",
    tags: ["cloudflare", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the bucket and import copies; name availability and subsequent writes may prevent full recovery.", if: {"kind": "fact", "fact": "cloudflare.r2.bucket.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Bucket contents and configuration have no exact inverse when recovery data is absent.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.worker.route.delete",
    vendor: "cloudflare",
    surface: "Workers Routes",
    summary: "Delete a Worker route.",
    tags: ["cloudflare", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Recreate the route to restore routing; requests handled during the gap cannot be replayed exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "cloudflare.workers.script.delete",
    vendor: "cloudflare",
    surface: "Workers",
    summary: "Delete a Worker script.",
    tags: ["cloudflare", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Deploy a replacement Worker from the copy; running state and missed requests cannot be recovered.", if: {"kind": "fact", "fact": "cloudflare.workers.script.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the script can discard the only copy of deployed code and bindings.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.doc.delete",
    vendor: "coda",
    surface: "Docs",
    summary: "Delete a Coda document.",
    tags: ["coda", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Rebuild a document from the copies; document and row identities and automation history may differ.", if: {"kind": "fact", "fact": "coda.doc.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Document deletion can remove tables, pages, automations and access configuration.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.doc.permission.delete",
    vendor: "coda",
    surface: "Doc Permissions",
    summary: "Delete a document access permission.",
    tags: ["coda", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Regrant captured access to reduce disruption; the original permission identity is not guaranteed, and intervening access changes remain.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.folder.delete",
    vendor: "coda",
    surface: "Folders",
    summary: "Delete an empty Coda folder.",
    tags: ["coda", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Recreate the folder to reduce organization disruption; original folder identity and links cannot be restored.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.pack.delete",
    vendor: "coda",
    surface: "Packs",
    summary: "Delete a Coda Pack.",
    tags: ["coda", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Pack deletion can remove unique integration configuration and break dependent documents.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.page.content.delete",
    vendor: "coda",
    surface: "Page Content",
    summary: "Delete selected content elements or all content from a Coda page.",
    tags: ["coda", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleted content and automation side effects cannot be restored without a verified recovery path.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.page.delete",
    vendor: "coda",
    surface: "Pages",
    summary: "Delete a Coda page.",
    tags: ["coda", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Page content and references may be unavailable without a retained recovery copy.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.row.delete",
    vendor: "coda",
    surface: "Rows",
    summary: "Delete a Coda table row.",
    tags: ["coda", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Insert replacement values and repair links; row identity and triggered automations may differ.", if: {"kind": "fact", "fact": "coda.row.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Row values and references are not recoverable without a retained recovery path.", if: {"kind": "always"} },
    ],
  },
  {
    id: "coda.rows.bulk_delete",
    vendor: "coda",
    surface: "Rows",
    summary: "Delete multiple Coda table rows.",
    tags: ["coda", "bulk_delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Insert replacement rows and repair links; row identities and automation effects do not return.", if: {"kind": "fact", "fact": "coda.rows.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleted row values and relationships may have no retained recovery path.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.api_key.revoke",
    vendor: "datadog",
    surface: "API Keys",
    summary: "Delete a Datadog API key.",
    tags: ["datadog", "revoke"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Issue a replacement credential and update consumers to reduce disruption; the revoked credential cannot be reactivated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.application_key.revoke",
    vendor: "datadog",
    surface: "Application Keys",
    summary: "Delete a Datadog application key.",
    tags: ["datadog", "revoke"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Issue a replacement credential and update consumers to reduce disruption; the revoked credential cannot be reactivated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.dashboard.delete",
    vendor: "datadog",
    surface: "Dashboards",
    summary: "Delete a Datadog dashboard.",
    tags: ["datadog", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the dashboard; dashboard identity and existing links may change.", if: {"kind": "fact", "fact": "datadog.dashboard.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleted dashboard configuration may no longer be available.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.downtime.cancel",
    vendor: "datadog",
    surface: "Downtimes",
    summary: "Cancel a scheduled or active monitor downtime through the v2 API.",
    tags: ["datadog", "cancel"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the downtime from captured settings; alerts emitted during the gap remain.", if: {"kind": "fact", "fact": "datadog.downtime.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Recreate the downtime to reduce unwanted notifications; notifications already sent cannot be recalled.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.logs.index.delete",
    vendor: "datadog",
    surface: "Log Indexes",
    summary: "Permanently delete a Datadog log index.",
    tags: ["datadog", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deletion cannot be reverted, and the deleted index name cannot be reused.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.logs.pipeline.delete",
    vendor: "datadog",
    surface: "Log Pipelines",
    summary: "Delete a Datadog log processing pipeline.",
    tags: ["datadog", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Without captured configuration the pipeline cannot be reconstructed, and previously processed logs cannot be reprocessed exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.monitor.delete",
    vendor: "datadog",
    surface: "Monitors",
    summary: "Delete a Datadog monitor.",
    tags: ["datadog", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the monitor from its captured definition; monitor identity, evaluation state and notification gaps remain.", if: {"kind": "fact", "fact": "datadog.monitor.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The original monitor state and alert history cannot be restored by a new monitor.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.slo.delete",
    vendor: "datadog",
    surface: "Service Level Objectives",
    summary: "Delete a service level objective.",
    tags: ["datadog", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the SLO; objective identity and historical evaluation continuity may differ.", if: {"kind": "fact", "fact": "datadog.slo.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the SLO loses its configuration and tracked objective continuity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "datadog.synthetics.test.delete",
    vendor: "datadog",
    surface: "Synthetics",
    summary: "Delete a Synthetic test.",
    tags: ["datadog", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement test; test identity, execution history and missed checks cannot be restored.", if: {"kind": "fact", "fact": "datadog.synthetics.test.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the test removes its configuration and breaks continuity of monitoring.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.bigquery.dataset.delete",
    vendor: "gcp",
    surface: "BigQuery",
    summary: "Delete a dataset, optionally deleting its contents.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the dataset and recover copied resources; jobs, identities and later writes cannot be restored exactly.", if: {"kind": "fact", "fact": "gcp.bigquery.dataset.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Dataset deletion can remove tables, routines and models with no complete recovery path.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.compute.disk.delete",
    vendor: "gcp",
    surface: "Compute Engine",
    summary: "Delete a persistent disk.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement disk from the copy; attachment identity and later writes need repair.", if: {"kind": "fact", "fact": "gcp.compute.disk.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Without a retained recovery copy the disk bytes cannot be recovered.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.compute.instance.delete",
    vendor: "gcp",
    surface: "Compute Engine",
    summary: "Delete a Compute Engine VM instance.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Rebuild the instance and its disks; runtime state, identity and downtime cannot be undone.", if: {"kind": "fact", "fact": "gcp.compute.instance.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deletion can destroy auto-delete disks and unique VM runtime state.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.compute.snapshot.delete",
    vendor: "gcp",
    surface: "Compute Engine",
    summary: "Delete a disk snapshot.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The snapshot recovery point is permanently removed.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.gcs.bucket.delete",
    vendor: "gcp",
    surface: "Cloud Storage",
    summary: "Delete a Cloud Storage bucket.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Restore the bucket data and configuration; the bucket name may no longer be available.", if: {"kind": "fact", "fact": "gcp.gcs.bucket.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Bucket configuration and any deleted contents are not recoverable without retained recovery data.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.gke.cluster.delete",
    vendor: "gcp",
    surface: "GKE",
    summary: "Delete a Kubernetes cluster and its managed nodes.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Rebuild the cluster and restore volumes; UIDs, running state and event history change.", if: {"kind": "fact", "fact": "gcp.gke.cluster.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Cluster deletion can destroy workloads and persistent data in its deletion scope.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.iam.role.delete",
    vendor: "gcp",
    surface: "IAM",
    summary: "Soft delete a custom IAM role.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "the custom role remains inside its undelete window", tone: "r1", inverse: "Undelete the same custom role.", window: "within 7 days of deletion, before permanent deletion", note: "Undeleting retains the role, but access disruption and audit events remain.", if: {"kind": "fact", "fact": "gcp.iam.role.within_undelete_window", "is": "true"} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "After permanent deletion, recreating a role does not recover its identity or dependent access.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.project.delete",
    vendor: "gcp",
    surface: "Resource Manager",
    summary: "Shut down a Google Cloud project and schedule deletion.",
    tags: ["gcp", "delete", "cascade"],
    cases: [
      { when: "the project is inside its soft delete window and every affected service has a verified recovery path", tone: "r2", inverse: null, window: "until the project or a dependent service recovery window expires", note: "Restoring the project can reduce harm, but service data and operations lost during shutdown may not return.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "gcp.project.within_soft_delete_window", "is": "true"}, {"kind": "fact", "fact": "gcp.project.services_recoverable", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Project deletion can cascade to services whose data is not recoverable by restoring the project.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.pubsub.subscription.delete",
    vendor: "gcp",
    surface: "Pub/Sub",
    summary: "Delete a Pub/Sub subscription.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the subscription removes its delivery cursor and unacknowledged backlog unless a separate recovery path exists.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.pubsub.topic.delete",
    vendor: "gcp",
    surface: "Pub/Sub",
    summary: "Delete a Pub/Sub topic.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The topic message retention and original subscription connections cannot be restored by recreating its name.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.secretmanager.version.destroy",
    vendor: "gcp",
    surface: "Secret Manager",
    summary: "Destroy a secret version.",
    tags: ["gcp", "destroy"],
    cases: [
      { when: "delayed destruction is enabled and the version remains inside its restore window", tone: "r2", inverse: null, window: "until the version scheduled destruction time", note: "Enable or disable the retained version before scheduled destruction to cancel it; prior state and interrupted consumers still need reconciliation. Whole-secret deletion or expiry bypasses the delay.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "gcp.secretmanager.version.delayed_destruction", "is": "true"}, {"kind": "fact", "fact": "gcp.secretmanager.version.within_restore_window", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The version payload is irrecoverable after destruction takes effect; no retained delayed-destruction window was established.", if: {"kind": "always"} },
    ],
  },
  {
    id: "gcp.sql.instance.delete",
    vendor: "gcp",
    surface: "Cloud SQL",
    summary: "Delete a Cloud SQL instance.",
    tags: ["gcp", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Restore into a replacement instance; connections, instance identity and subsequent writes require repair.", if: {"kind": "fact", "fact": "gcp.sql.instance.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Instance deletion can remove the database and backups included in its deletion scope.", if: {"kind": "always"} },
    ],
  },
  {
    id: "netlify.build_hook.delete",
    vendor: "netlify",
    surface: "Build Hooks",
    summary: "Delete a Netlify build hook.",
    tags: ["netlify", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement hook and update callers; missed builds and original hook identity cannot be restored.", if: {"kind": "fact", "fact": "netlify.build_hook.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "A replacement build hook has a new URL; callers using the original URL can no longer trigger builds.", if: {"kind": "always"} },
    ],
  },
  {
    id: "netlify.deploy.delete",
    vendor: "netlify",
    surface: "Deploys",
    summary: "Delete a Netlify deploy.",
    tags: ["netlify", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The exact deploy artifact and its logs are lost; a new build creates a different deploy.", if: {"kind": "always"} },
    ],
  },
  {
    id: "netlify.dns.record.delete",
    vendor: "netlify",
    surface: "DNS",
    summary: "Delete a Netlify DNS record.",
    tags: ["netlify", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Recreate the record to reduce disruption; DNS caches and missed traffic remain outside the inverse.", if: {"kind": "always"} },
    ],
  },
  {
    id: "netlify.form.delete",
    vendor: "netlify",
    surface: "Forms",
    summary: "Delete a Netlify form and its stored submissions.",
    tags: ["netlify", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Deploy the form again and retain exports; submission history and identifiers do not return.", if: {"kind": "fact", "fact": "netlify.form.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the form can remove the last copy of collected submissions.", if: {"kind": "always"} },
    ],
  },
  {
    id: "netlify.form.submission.delete",
    vendor: "netlify",
    surface: "Forms",
    summary: "Delete one Netlify form submission.",
    tags: ["netlify", "purge"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Retain the exported submission for manual follow-up; original submission identity and integration events cannot be restored.", if: {"kind": "fact", "fact": "netlify.form.submission.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Submission bodies and uploaded files are not recoverable without an independent export.", if: {"kind": "always"} },
    ],
  },
  {
    id: "netlify.site.delete",
    vendor: "netlify",
    surface: "Sites",
    summary: "Delete a Netlify site.",
    tags: ["netlify", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement site and import the recovery copies; site identity and deployment history change.", if: {"kind": "fact", "fact": "netlify.site.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Site deletion removes deployments and site data with no exact inverse.", if: {"kind": "always"} },
    ],
  },
  {
    id: "netlify.team.member.remove",
    vendor: "netlify",
    surface: "Team Members",
    summary: "Remove a member from a Netlify team.",
    tags: ["netlify", "remove"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinvite or regrant access to reduce disruption; required acceptance, missed activity and original access state cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.block.delete",
    vendor: "notion",
    surface: "Blocks",
    summary: "Move a Notion block to trash.",
    tags: ["notion", "delete"],
    cases: [
      { when: "the block was not in trash and remains available for restoration", tone: "r1", inverse: "Update the same block with in_trash set to false.", window: "while the original block remains restorable", note: "The same block can be restored, but deletion and restoration remain visible in history.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "notion.block.previously_trashed", "is": "false"}, {"kind": "fact", "fact": "notion.block.restore_supported", "is": "true"}]} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "A block outside its restore path may no longer be recoverable.", if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.teamspace.archive",
    vendor: "notion",
    surface: "Teamspace Administration",
    summary: "Archive a Notion teamspace through workspace settings.",
    tags: ["notion", "archive", "manual"],
    cases: [
      { when: "the teamspace was active and its same-object restore is supported", tone: "r1", inverse: "Restore the same teamspace through workspace settings.", window: "while the teamspace remains archived and restorable", note: "Restoring the teamspace retains its content, but access interruption and history remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "notion.teamspace.previously_active", "is": "true"}, {"kind": "fact", "fact": "notion.teamspace.restore_supported", "is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Restore the teamspace to reduce disruption; uncaptured permissions or later changes prevent an exact inverse.", if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.teamspace.member.remove",
    vendor: "notion",
    surface: "Teamspace Administration",
    summary: "Remove a member from a Notion teamspace through workspace settings.",
    tags: ["notion", "remove"],
    cases: [
      { when: "all prior access was captured and regrant to the same principal is supported", tone: "r1", inverse: "Regrant all captured access to the same principal.", window: "while the principal and captured grants remain valid", note: "Access can be restored, but removal, missed activity and audit events remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "notion.teamspace.member.access_captured", "is": "true"}, {"kind": "fact", "fact": "notion.teamspace.member.regrant_supported", "is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinviting a user may reduce disruption but does not restore uncaptured access or undo missed activity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.token.revoke",
    vendor: "notion",
    surface: "OAuth",
    summary: "Revoke a Notion OAuth access token.",
    tags: ["notion", "revoke"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Issue a replacement credential and update consumers to reduce disruption; the revoked credential cannot be reactivated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.workspace.delete",
    vendor: "notion",
    surface: "Workspace Administration",
    summary: "Permanently delete a Notion workspace through workspace settings.",
    tags: ["notion", "workspace", "delete", "manual"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Workspace deletion can remove all content and membership state; this is a manual administration surface, not a public Notion API endpoint.", if: {"kind": "always"} },
    ],
  },
  {
    id: "notion.workspace.member.remove",
    vendor: "notion",
    surface: "Workspace Administration",
    summary: "Remove a member through Notion workspace settings.",
    tags: ["notion", "remove"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinvite or regrant access to reduce disruption; required acceptance, missed activity and original access state cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "opsgenie.alert.delete",
    vendor: "opsgenie",
    surface: "Alerts",
    summary: "Delete an Opsgenie alert.",
    tags: ["opsgenie", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The alert record, notes and original history cannot be recreated with the same identity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "opsgenie.escalation.delete",
    vendor: "opsgenie",
    surface: "Escalations",
    summary: "Delete an Opsgenie escalation policy.",
    tags: ["opsgenie", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the escalation and reconnect routing; missed alerts and identity changes remain.", if: {"kind": "fact", "fact": "opsgenie.escalation.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The escalation configuration is unavailable after deletion without a capture.", if: {"kind": "always"} },
    ],
  },
  {
    id: "opsgenie.integration.delete",
    vendor: "opsgenie",
    surface: "Integrations",
    summary: "Delete an Opsgenie integration.",
    tags: ["opsgenie", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement integration and update consumers; revoked credentials and missed alerts remain different.", if: {"kind": "fact", "fact": "opsgenie.integration.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The integration credentials and missed alerts cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "opsgenie.schedule.delete",
    vendor: "opsgenie",
    surface: "Schedules",
    summary: "Delete an Opsgenie on-call schedule.",
    tags: ["opsgenie", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement schedule and repair references; identity and missed notifications cannot be restored.", if: {"kind": "fact", "fact": "opsgenie.schedule.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Schedule deletion removes routing configuration and can interrupt on-call coverage.", if: {"kind": "always"} },
    ],
  },
  {
    id: "opsgenie.team.delete",
    vendor: "opsgenie",
    surface: "Teams",
    summary: "Delete an Opsgenie team.",
    tags: ["opsgenie", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the team and restore captured routing; team identity and missed alerts cannot return.", if: {"kind": "fact", "fact": "opsgenie.team.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Team deletion can remove routing rules and memberships.", if: {"kind": "always"} },
    ],
  },
  {
    id: "opsgenie.user.delete",
    vendor: "opsgenie",
    surface: "Users",
    summary: "Delete an Opsgenie user.",
    tags: ["opsgenie", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Invite a replacement account and repair routing to reduce disruption; deleted identity and audit references cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.business_service.delete",
    vendor: "pagerduty",
    surface: "Business Services",
    summary: "Delete a PagerDuty business service.",
    tags: ["pagerduty", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Recreating a service does not restore its original identity or reverse alert-routing disruption.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.escalation_policy.delete",
    vendor: "pagerduty",
    surface: "Escalation Policies",
    summary: "Delete an escalation policy.",
    tags: ["pagerduty", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the policy and reconnect services; policy identity and missed escalations remain different.", if: {"kind": "fact", "fact": "pagerduty.escalation_policy.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting the policy removes alert escalation routing.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.event_orchestration.integration.delete",
    vendor: "pagerduty",
    surface: "Event Orchestration Integrations",
    summary: "Delete an Event Orchestration integration and its routing key.",
    tags: ["pagerduty", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement integration and rotate every consumer to the new key; missed events remain.", if: {"kind": "fact", "fact": "pagerduty.integration.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The routing key is deleted, and subsequent events using it are dropped.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.incident.note.delete",
    vendor: "pagerduty",
    surface: "Incident Notes",
    summary: "Delete a note from a PagerDuty incident.",
    tags: ["pagerduty", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The original note and its authorship context cannot be recreated with the same identity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.schedule.delete",
    vendor: "pagerduty",
    surface: "Schedules",
    summary: "Delete an on-call schedule.",
    tags: ["pagerduty", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the schedule and repair escalation references; schedule identity and missed pages cannot return.", if: {"kind": "fact", "fact": "pagerduty.schedule.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleting a schedule disrupts routing and removes schedule configuration.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.service.delete",
    vendor: "pagerduty",
    surface: "Services",
    summary: "Delete a PagerDuty service.",
    tags: ["pagerduty", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement service and integrations; incident history and original integration keys may not return.", if: {"kind": "fact", "fact": "pagerduty.service.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Service deletion removes incident routing and associated integration configuration.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.team.member.remove",
    vendor: "pagerduty",
    surface: "Teams",
    summary: "Remove a user from a PagerDuty team.",
    tags: ["pagerduty", "remove"],
    cases: [
      { when: "all prior access was captured and regrant to the same principal is supported", tone: "r1", inverse: "Regrant all captured access to the same principal.", window: "while the principal and captured grants remain valid", note: "Access can be restored, but removal, missed activity and audit events remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "pagerduty.team.member.access_captured", "is": "true"}, {"kind": "fact", "fact": "pagerduty.team.member.regrant_supported", "is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinviting a user may reduce disruption but does not restore uncaptured access or undo missed activity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "pagerduty.user.delete",
    vendor: "pagerduty",
    surface: "Users",
    summary: "Delete a PagerDuty user.",
    tags: ["pagerduty", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinvite the person and repair routing to reduce disruption; deleted user identity and historical references are not an exact inverse.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.admin.apps.uninstall",
    vendor: "slack",
    surface: "Admin Apps",
    summary: "Uninstall an app from a Slack organization or workspace.",
    tags: ["slack", "uninstall"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Manual reinstallation may restore service, but revoked tokens, app state and missed events cannot be reinstated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.admin.conversation.archive",
    vendor: "slack",
    surface: "Admin Conversations",
    summary: "Archive a Slack channel through the Admin API.",
    tags: ["slack", "archive"],
    cases: [
      { when: "the channel was active, same-channel restoration is supported, and no template workflows are attached", tone: "r1", inverse: "Unarchive the same Slack channel.", window: "while the channel remains available for unarchive", note: "The same channel can be unarchived, but archive events and interrupted conversations remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "slack.channel.previously_active", "is": "true"}, {"kind": "fact", "fact": "slack.channel.restore_supported", "is": "true"}, {"kind": "fact", "fact": "slack.channel.template_workflows_present", "is": "false"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Unarchive may reduce disruption, but an unknown prior state prevents a reliable inverse.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.admin.conversation.delete",
    vendor: "slack",
    surface: "Admin Conversations",
    summary: "Permanently delete a Slack channel and its messages.",
    tags: ["slack", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Channel deletion destroys messages and channel identity; creating another channel is not an inverse.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.admin.invite_request.deny",
    vendor: "slack",
    surface: "Admin Invite Requests",
    summary: "Deny a pending workspace invite request.",
    tags: ["slack", "deny"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "A new invitation can compensate, but the original denial decision and request history cannot be withdrawn.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.admin.session.reset",
    vendor: "slack",
    surface: "Admin Sessions",
    summary: "Invalidate all valid sessions for a Slack user, optionally limited to web or mobile clients.",
    tags: ["slack", "reset"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "The user can sign in again, but invalidated sessions and interrupted actions cannot be reinstated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.admin.user.remove",
    vendor: "slack",
    surface: "Admin Users",
    summary: "Remove a user from a Slack workspace.",
    tags: ["slack", "remove"],
    cases: [
      { when: "all prior access was captured and regrant to the same principal is supported", tone: "r1", inverse: "Regrant all captured access to the same principal.", window: "while the principal and captured grants remain valid", note: "Access can be restored, but removal, missed activity and audit events remain.", if: {"kind": "all", "of": [{"kind": "fact", "fact": "slack.admin.user.access_captured", "is": "true"}, {"kind": "fact", "fact": "slack.admin.user.regrant_supported", "is": "true"}]} },
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinviting a user may reduce disruption but does not restore uncaptured access or undo missed activity.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.admin.usergroup.channels.remove",
    vendor: "slack",
    surface: "Admin User Groups",
    summary: "Remove default channels from an IDP user group.",
    tags: ["slack", "remove"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reassociate the default channels to reduce disruption; this does not imply every current user is removed, and changes during the gap cannot be undone.", if: {"kind": "always"} },
    ],
  },
  {
    id: "slack.auth.revoke",
    vendor: "slack",
    surface: "Auth",
    summary: "Revoke a Slack OAuth token.",
    tags: ["slack", "revoke"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Issue a replacement token and update consumers to reduce disruption. Revoking a bot token deactivates the bot and removes its memberships, but does not uninstall the app. The old token cannot be restored.", if: {"kind": "always"} },
    ],
  },
  {
    id: "stripe.invoice.delete",
    vendor: "stripe",
    surface: "Invoices",
    summary: "Delete a one-off draft Stripe invoice.",
    tags: ["stripe", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The invoice object and its original identifier cannot be restored after deletion.", if: {"kind": "always"} },
    ],
  },
  {
    id: "stripe.invoice.void",
    vendor: "stripe",
    surface: "Invoices",
    summary: "Void a finalized Stripe invoice.",
    tags: ["stripe", "void"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Create a replacement invoice to reduce accounting disruption; the void status and original document remain permanent.", if: {"kind": "always"} },
    ],
  },
  {
    id: "stripe.payout.cancel",
    vendor: "stripe",
    surface: "Payouts",
    summary: "Cancel a pending manual payout.",
    tags: ["stripe", "cancel"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Cancellation returns funds to available balance, but cannot reactivate the original payout. A new manual payout only compensates. Automatic payouts cannot be cancelled.", if: {"kind": "always"} },
    ],
  },
  {
    id: "stripe.webhook_endpoint.delete",
    vendor: "stripe",
    surface: "Webhook Endpoints",
    summary: "Delete a Stripe webhook endpoint.",
    tags: ["stripe", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "A replacement endpoint can resume delivery but has a new identity and signing secret; missed events require reconciliation.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.alias.delete",
    vendor: "vercel",
    surface: "Aliases",
    summary: "Remove a deployment alias.",
    tags: ["vercel", "delete"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reassign the alias to a known deployment to reduce disruption; failed requests and caches cannot be undone.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.deployment.delete",
    vendor: "vercel",
    surface: "Deployments",
    summary: "Permanently delete a Vercel deployment.",
    tags: ["vercel", "delete"],
    cases: [
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The deployment artifact, URL and deployment logs cannot be recovered by building a new deployment.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.domain.remove",
    vendor: "vercel",
    surface: "Domains",
    summary: "Remove a domain from a Vercel project.",
    tags: ["vercel", "remove"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reattach an available domain to reduce outage; DNS caches, validation state and missed requests cannot be undone.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.environment.bulk_delete",
    vendor: "vercel",
    surface: "Environment Variables",
    summary: "Delete a selected set of project environment variables.",
    tags: ["vercel", "bulk_delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Recreate the variables from the operator vault and redeploy; consumers may already have failed.", if: {"kind": "fact", "fact": "vercel.environment.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Deleted secret values cannot be recovered through the API.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.project.delete",
    vendor: "vercel",
    surface: "Projects",
    summary: "Delete a Vercel project and its deployments.",
    tags: ["vercel", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Redeploy from the copy; deployment history, project identity and service continuity do not return.", if: {"kind": "fact", "fact": "vercel.project.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "Project deletion removes deployment history and project state that cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.team.member.remove",
    vendor: "vercel",
    surface: "Teams",
    summary: "Remove a member from a Vercel team.",
    tags: ["vercel", "remove"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Reinvite or regrant access to reduce disruption; required acceptance, missed activity and original access state cannot be restored exactly.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.token.revoke",
    vendor: "vercel",
    surface: "Access Tokens",
    summary: "Revoke a Vercel access token.",
    tags: ["vercel", "revoke"],
    cases: [
      { when: "always", tone: "r2", inverse: null, window: "none", note: "Issue a replacement credential and update consumers to reduce disruption; the revoked credential cannot be reactivated.", if: {"kind": "always"} },
    ],
  },
  {
    id: "vercel.webhook.delete",
    vendor: "vercel",
    surface: "Webhooks",
    summary: "Delete a team webhook.",
    tags: ["vercel", "delete"],
    cases: [
      { when: "a complete recovery copy was verified before this call", tone: "r2", inverse: null, window: "while the verified recovery copy remains available", note: "Create a replacement webhook and update its consumer; missed deliveries and endpoint identity remain different.", if: {"kind": "fact", "fact": "vercel.webhook.recovery_copy_verified", "is": "true"} },
      { when: "always", tone: "r3", inverse: null, window: "none", note: "The original webhook secret and missed deliveries cannot be recovered from the deleted endpoint.", if: {"kind": "always"} },
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
  ...platformEntries,
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
