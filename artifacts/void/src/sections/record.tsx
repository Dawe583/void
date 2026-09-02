import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "wouter";
import { Icon, Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { faqs } from "@/lib/site-data";
import { EASE } from "@/lib/motion";

const LEDGER_ENTRY = [
  ["{", ""],
  ['  "sequence"', "1042"],
  ['  "timestamp"', '"2026-08-21T09:14:11.204Z"'],
  ['  "agent"', '"billing-ops"'],
  ['  "intent"', '"issue_refund"'],
  ['  "payload_digest"', '"sha256:7d19..c4b2"'],
  ['  "blast_radius"', '["payments", "ledger", "mail"]'],
  ['  "class"', '"R3"'],
  ['  "policy"', '"hold_then_human"'],
  ['  "approved_by"', '"dana@acme.example"'],
  ['  "snapshot"', '"sha256:4c2e..91af"'],
  ['  "compensation"', "null"],
  ['  "budget_entry"', '"r3:2026-08-21:1of2"'],
  ['  "prev_hash"', '"0x9f3c..77d1"'],
  ['  "hash"', '"0xa10e..3b08"'],
  ['  "signature"', '"ed25519:5f21..ee90"'],
  ["}", ""],
];

export function Record() {
  return (
    <Section id="record" index="11" label="RECORD">
      <SplitHeading text="A log you can hand to a regulator." className="h2" />
      <div className="record-grid mt-lg">
        <Reveal className="prose">
          <p>
            The EU AI Act Article 12 record keeping duty makes agent behaviour a governance problem, not only an
            observability problem. It is enforceable from August 2026, and it asks for records that are automatic,
            appropriate to the purpose of the system, and kept over its lifetime.
          </p>
          <p>
            Application logs fail that test in a boring way: they are mutable by anyone with write access, they
            have no ordering guarantee across services, and they cannot demonstrate that an entry existed at a
            given moment.
          </p>
          <p>
            A hash chained, signed, replayable ledger answers all three. Each entry carries the intent, the
            payload digest, the computed blast radius, the class, the policy decision, the approver, the before
            snapshot and the compensation plan. Removing an entry breaks the chain. Forging one requires the key.
          </p>
          <div className="note-box">
            <Icon name="info" size={16} />
            <span>Informational, not legal advice. Talk to your counsel about how the duty applies to you.</span>
          </div>
          <Link href="/compliance" className="link-arrow" data-testid="link-record-compliance">
            Read the compliance notes
            <Icon name="arrowUpRight" size={15} />
          </Link>
        </Reveal>

        <Reveal className="json-box" delay={0.08}>
          <pre>
            {LEDGER_ENTRY.map(([key, value], index) => (
              <div key={index}>
                <span className="j-key">{key}</span>
                {value && ": "}
                {value && (
                  <span className={/^0x|^"(sha256|ed25519)/.test(value.replace(/"/g, '"')) ? "j-hash" : /^\d+$/.test(value) ? "j-num" : "j-str"}>
                    {value}
                  </span>
                )}
                {value && index < LEDGER_ENTRY.length - 2 ? "," : ""}
              </div>
            ))}
          </pre>
          <div className="caption">
            <span>fig. 08, sealed ledger entry</span>
            <span>ed25519 signed</span>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section id="faq" index="12" label="FAQ">
      <SplitHeading text="The uncomfortable questions, answered plainly." className="h2" />
      <div className="faq-list mt-lg">
        {faqs.map(([question, answer], index) => {
          const isOpen = open === index;
          return (
            <div className="faq-row" key={question}>
              <button
                type="button"
                className="faq-trigger"
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${index}`}
                onClick={() => setOpen(isOpen ? null : index)}
                data-testid={`button-faq-${index}`}
              >
                <span>{question}</span>
                <b aria-hidden="true">+</b>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`faq-panel-${index}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="faq-answer-inner">{answer}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
