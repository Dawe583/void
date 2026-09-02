import { Link } from "wouter";
import { PageHero, TableOfContents } from "@/components/site/page-hero";
import { Icon, Reveal } from "@/components/site/primitives";
import { useActiveSection, usePageMeta } from "@/lib/use-site";

const TOC = [
  { id: "duty", label: "The duty" },
  { id: "answer", label: "Why a ledger" },
  { id: "mapping", label: "Field mapping" },
  { id: "export", label: "Export format" },
  { id: "retention", label: "Retention and erasure" },
  { id: "audit", label: "An audit walkthrough" },
];

const MAPPING: [string, string, string][] = [
  ["Period of use", "timestamp, workspace, agent", "every entry is timestamped and signed at write time"],
  ["Reference database or input data", "payload_digest, snapshot reference", "digest proves which inputs were used without storing them"],
  ["Input data for which the search led to a match", "blast_radius, records", "the systems and record counts the call touched"],
  ["Identification of natural persons involved in verification", "approved_by, policy.rule", "the SSO identity that approved a held call"],
  ["Automatically generated logs over the lifetime", "the chain itself", "append only, hash linked, verifiable offline"],
];

export default function CompliancePage() {
  usePageMeta(
    "Compliance, VOID",
    "How a hash chained, signed, replayable ledger answers the EU AI Act Article 12 record keeping duty for agent systems.",
    "/compliance",
  );
  const active = useActiveSection(TOC.map((entry) => entry.id));

  return (
    <>
      <PageHero
        kicker="COMPLIANCE / 12"
        title="Record keeping that survives a question."
        copy="Article 12 of the EU AI Act asks for automatic records over a system's lifetime. This page explains what that means for a system that lets agents write to production, and where VOID fits."
        meta={["enforceable from August 2026", "informational, not legal advice"]}
      />

      <div className="doc-layout">
        <TableOfContents items={TOC} active={active} />

        <article className="prose">
          <section id="duty">
            <h2>01 / The duty, in plain terms</h2>
            <p>
              High risk AI systems must technically allow for the automatic recording of events over the lifetime
              of the system, to a degree appropriate to its intended purpose. That is the substance. The
              interesting work is deciding what appropriate means for a system whose events are side effects in
              other people's databases.
            </p>
            <blockquote>
              The question an auditor actually asks is not "do you have logs". It is "show me what this agent did
              on the fourteenth of March, why it was allowed to, and who signed off".
            </blockquote>
          </section>

          <section id="answer">
            <h2>02 / Why a ledger and not log files</h2>
            <p>Application logs fail an audit in three specific ways.</p>
            <ul>
              <li>
                <strong>Mutability.</strong> Anyone with write access to the sink can edit or remove an entry, and
                nothing detects it.
              </li>
              <li>
                <strong>Ordering.</strong> Across services, clock skew and buffering mean the sequence you read is
                not necessarily the sequence that happened.
              </li>
              <li>
                <strong>Context.</strong> A refund line in a log tells you a refund happened. It does not tell you
                what the agent intended, what the blast radius was, or who approved it.
              </li>
            </ul>
            <p>
              A hash chained, signed ledger fixes the first two structurally. The event model fixes the third by
              recording intent and decision alongside the result.
            </p>
          </section>

          <section id="mapping">
            <h2>03 / Field mapping</h2>
            <p>
              How the Article 12 style expectations map onto ledger fields. This mapping is a starting point for a
              conversation with your counsel, not a legal opinion.
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>expectation</th>
                    <th>ledger field</th>
                    <th>how it is satisfied</th>
                  </tr>
                </thead>
                <tbody>
                  {MAPPING.map(([expectation, field, how]) => (
                    <tr key={expectation}>
                      <td>{expectation}</td>
                      <td>
                        <code>{field}</code>
                      </td>
                      <td>{how}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="export">
            <h2>04 / Export format</h2>
            <p>
              <code>void export --format aiact-a12 --since 30d</code> produces a single file containing the chain
              segment, the public key, a verification manifest, and a human readable summary per entry.
            </p>
            <pre className="block">{`void-export-2026-08-21.jsonl
  meta.workspace      acme
  meta.range          2026-07-22T00:00:00Z .. 2026-08-21T00:00:00Z
  meta.entries        18422
  meta.chain_head     0xa10e..3b08
  meta.public_key     ed25519:pk_7f21..
  meta.redactions     3 rules applied at export

verify:
  $ void verify void-export-2026-08-21.jsonl --key pk.pem
  + 18422 entries, chain intact
  + 18422 signatures valid
  + 0 gaps detected`}</pre>
          </section>

          <section id="retention">
            <h2>05 / Retention and erasure</h2>
            <p>
              Record keeping and data minimisation pull in opposite directions. VOID resolves it by keeping the
              chain forever and the content only as long as you configure. Redacted content is replaced by a
              digest, so an entry stays verifiable after the data behind it is erased.
            </p>
            <ul>
              <li>Chain entries: retained for the configured audit window, default 24 months.</li>
              <li>Snapshots: your bucket, your lifecycle rules, referenced by digest.</li>
              <li>Erasure request: the payload behind a digest is removed, the chain link is untouched.</li>
            </ul>
          </section>

          <section id="audit">
            <h2>06 / An audit walkthrough</h2>
            <ol>
              <li>The auditor names a date and a system, for example payments on 14 March.</li>
              <li>You export the chain segment for that window and hand over the file and the public key.</li>
              <li>They run the verifier offline. It reports the entry count, chain integrity and signature validity.</li>
              <li>They read the summaries. Every R3 action shows its approver and the budget entry that paid for it.</li>
              <li>Where a compensation ran, the replay entry is in the same chain, with its own signature.</li>
            </ol>
            <div className="note-box">
              <Icon name="info" size={16} />
              <span>
                Informational, not legal advice. VOID is a product concept and this page is not a compliance
                certification.
              </span>
            </div>
            <Reveal className="row mt-md">
              <Link href="/spec" className="btn btn-ghost" data-testid="link-compliance-spec">
                Read the ledger format
              </Link>
              <Link href="/contact" className="btn btn-primary" data-testid="link-compliance-contact">
                Talk to us
                <Icon name="arrow" size={15} />
              </Link>
            </Reveal>
          </section>
        </article>
      </div>
    </>
  );
}
