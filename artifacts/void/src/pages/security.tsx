import { PageHero, TableOfContents } from "@/components/site/page-hero";
import { Icon } from "@/components/site/primitives";
import { useActiveSection, usePageMeta } from "@/lib/use-site";

const TOC = [
  { id: "flow", label: "Data flow" },
  { id: "stored", label: "What is stored" },
  { id: "redaction", label: "Redaction" },
  { id: "keys", label: "Key handling" },
  { id: "hosting", label: "Hosting shapes" },
  { id: "isolation", label: "Tenant isolation" },
  { id: "practices", label: "Engineering practices" },
  { id: "disclosure", label: "Disclosure" },
];

export default function SecurityPage() {
  usePageMeta(
    "Security, VOID",
    "Data flow, what VOID stores, field level redaction, key handling and self hosting for the reversible autonomy layer.",
    "/security",
  );
  const active = useActiveSection(TOC.map((entry) => entry.id));

  return (
    <>
      <PageHero
        kicker="SECURITY / 11"
        title="The layer that sees less, by design."
        copy="VOID is built to make the write path accountable without becoming another place your data collects. Every choice below trades capability for exposure, and you make the trade per tool."
        meta={["self hosted option", "bring your own KMS", "field level redaction", "air-gapped mode"]}
      />

      <div className="doc-layout">
        <TableOfContents items={TOC} active={active} />

        <article className="prose">
          <section id="flow">
            <h2>01 / Data flow</h2>
            <pre className="block">{`agent -> [ VOID interceptor ] -> tool
              |            |
        redaction     signed event
              |            |
         policy engine   ledger sink
              |            |
        allow/hold/veto  your bucket or ours`}</pre>
            <p>
              In self hosted mode the interceptor, policy engine and ledger all run inside your infrastructure.
              Nothing crosses a network boundary you do not control. In managed mode the control plane holds
              metadata and the redacted ledger, and the signing keys stay in your KMS.
            </p>
          </section>

          <section id="stored">
            <h2>02 / What is stored</h2>
            <p>Per intercepted call, the ledger holds:</p>
            <ul>
              <li>intent, agent identity and tool identity</li>
              <li>a digest of the payload, not the payload, unless you opt in per tool</li>
              <li>computed blast radius and reversibility class</li>
              <li>the policy decision and any approver identity</li>
              <li>a reference to the before snapshot, plus where that snapshot lives</li>
              <li>the compensation plan, or the reason there is none</li>
              <li>the hash chain link and the signature</li>
            </ul>
            <p>
              Snapshots are the one place real data can land. They live in a bucket you nominate, with your
              lifecycle rules, and VOID stores only the reference and the digest.
            </p>
          </section>

          <section id="redaction">
            <h2>03 / Redaction</h2>
            <p>
              Redaction runs before anything enters the ledger, at the field level, driven by the same config as
              policy. Redacted fields are replaced by a digest, so a replay can verify that a value was restored
              correctly without ever reading it.
            </p>
            <pre className="block">{`redact:
  - tool: "crm.contact.*"
    fields: ["email", "phone", "national_id"]
    mode: digest
  - tool: "stripe.*"
    fields: ["card.*"]
    mode: drop`}</pre>
          </section>

          <section id="keys">
            <h2>04 / Key handling</h2>
            <p>
              Your signing keys remain yours. Bring your own KMS, or keep the ledger entirely inside an air-gapped
              deployment. VOID cannot replay what it cannot read, and that limit is deliberate: a compromised
              control plane cannot reconstruct your payloads from the ledger alone.
            </p>
            <ul>
              <li>Ed25519 workspace keys, rotated without breaking the existing chain.</li>
              <li>Rotation records the old and new key in the chain, so historic entries stay verifiable.</li>
              <li>Verification is offline: a checker binary plus the public key validates an export with no network access.</li>
            </ul>
          </section>

          <section id="hosting">
            <h2>05 / Hosting shapes</h2>
            <ul>
              <li>
                <strong>MCP proxy.</strong> A process in your network that terminates the MCP transport. Lowest
                integration cost, no code change.
              </li>
              <li>
                <strong>SDK wrap.</strong> A library in your agent process. Highest fidelity, because it sees the
                typed arguments before serialisation.
              </li>
              <li>
                <strong>Sidecar.</strong> A container in the same pod intercepting egress. For runtimes you cannot
                modify at all.
              </li>
            </ul>
          </section>

          <section id="isolation">
            <h2>06 / Tenant isolation</h2>
            <p>
              In managed mode every workspace has its own ledger chain, its own signing key and its own storage
              prefix. There is no shared table where one tenant's entries sit next to another's. Cross workspace
              queries are not a feature that exists to be misconfigured.
            </p>
          </section>

          <section id="practices">
            <h2>07 / Engineering practices</h2>
            <ul>
              <li>Least privilege by default: adapters request the narrowest scope that supports their inverses.</li>
              <li>Every dependency pinned, with a minimum release age before a version is allowed into a build.</li>
              <li>Reproducible builds, signed release artifacts, and an SBOM published with every tag.</li>
              <li>Ledger writes are append only at the storage layer, not only in application code.</li>
            </ul>
          </section>

          <section id="disclosure">
            <h2>08 / Disclosure</h2>
            <p>
              Report a vulnerability to <a href="mailto:security@void.systems">security@void.systems</a>. We
              acknowledge within one working day, agree a disclosure timeline with you, and credit reporters who
              want to be credited.
            </p>
            <div className="note-box">
              <Icon name="shield" size={16} />
              <span>
                VOID is a product concept. This page describes the intended security model, not an audited
                production deployment.
              </span>
            </div>
          </section>
        </article>
      </div>
    </>
  );
}
