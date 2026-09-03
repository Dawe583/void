import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PageHero } from "@/components/site/page-hero";
import { Icon, Reveal, RevealGroup, RevealItem } from "@/components/site/primitives";
import { actions, frames } from "@/lib/site-data";
import {
  chainSupported,
  linkHash,
  sha256Hex,
  shortHash,
  verifyChain,
  type ChainEntry,
  type LinkVerdict,
} from "@/lib/chain";
import { usePageMeta } from "@/lib/use-site";
import { EASE } from "@/lib/motion";

type Tamper = "none" | "edit" | "remove";

/** The entry a tamper targets: the settled payout, the one an operator would want to hide. */
const TARGET = 5;

const AGENT_BY_SYSTEM: Record<string, string> = {
  CRM: "support-triage",
  LEDGER: "billing-ops",
  MAIL: "growth-outbound",
};

async function buildChain(tamper: Tamper): Promise<ChainEntry[]> {
  const sealed: ChainEntry[] = [];
  let prevHash: string | null = null;

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const payloadDigest = (await sha256Hex(`${action.field}|${action.before}|${action.after}`)).slice(0, 16);
    const draft = {
      seq: index + 1,
      time: action.time,
      agent: AGENT_BY_SYSTEM[action.system] ?? "unknown",
      tool: action.label,
      klass: action.tone,
      system: action.system,
      target: action.field,
      decision: action.tone === "r3" ? ("approved" as const) : action.tone === "r2" ? ("hold" as const) : ("allow" as const),
      payloadDigest,
      prevHash,
    };
    const hash = await linkHash(draft);
    sealed.push({ ...draft, hash });
    prevHash = hash;
  }

  // The tamper happens after sealing, exactly the way a forger would do it: the
  // body changes and the recorded hash is left alone, because recomputing it
  // would need the signing key.
  if (tamper === "edit") {
    sealed[TARGET] = { ...sealed[TARGET], klass: "r0", decision: "allow" };
  }
  if (tamper === "remove") {
    sealed.splice(TARGET, 1);
  }

  return sealed;
}

export default function AttestationPage() {
  usePageMeta(
    "Attestation, VOID",
    "The ledger is not a dashboard, it is an artifact. A signed hash chain an auditor, a customer or an underwriter can verify without trusting VOID.",
    "/attestation",
  );

  const [tamper, setTamper] = useState<Tamper>("none");
  const [entries, setEntries] = useState<ChainEntry[]>([]);
  const [verdicts, setVerdicts] = useState<LinkVerdict[]>([]);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(true);

  const run = useCallback(async (mode: Tamper) => {
    if (!chainSupported()) {
      setSupported(false);
      setBusy(false);
      return;
    }
    setBusy(true);
    const chain = await buildChain(mode);
    setEntries(chain);
    setVerdicts(await verifyChain(chain));
    setBusy(false);
  }, []);

  useEffect(() => {
    void run(tamper);
  }, [tamper, run]);

  const broken = useMemo(() => verdicts.filter((item) => !item.bodyOk || !item.linkOk), [verdicts]);
  const intact = verdicts.length > 0 && broken.length === 0;

  return (
    <>
      <PageHero
        kicker="ATTESTATION / 13"
        title="Not a dashboard. An artifact."
        copy="A compliance dashboard proves you bought a compliance dashboard. What an auditor, a customer or an underwriter actually needs is something they can check without trusting you: a hash chain over every intercepted call, signed at the head. Verify it below, in your own browser, then break it on purpose."
        meta={["sha256 chain", "ed25519 at the head", "verifiable offline", "one ledger, five frames"]}
      />

      <section className="section" aria-labelledby="att-verify-label">
        <Reveal className="section-head">
          <span className="kicker" id="att-verify-label">
            [ 01 ] VERIFY
          </span>
          <span className="kicker-line" aria-hidden="true" />
        </Reveal>

        <h2 className="h2">Recomputed here, not asserted by us.</h2>
        <p className="lede mt-sm">
          Every line below was hashed by your browser using Web Crypto, linking each entry to the one before it.
          Nothing was fetched. Break a record and watch which check catches it, because the two failures are not
          the same failure.
        </p>

        <div className="att-controls mt-lg">
          <div className="att-tampers" role="group" aria-label="Tamper with the ledger">
            <button
              type="button"
              className={`att-tamper ${tamper === "none" ? "is-on" : ""}`}
              onClick={() => setTamper("none")}
              aria-pressed={tamper === "none"}
              data-testid="button-attest-none"
            >
              as sealed
            </button>
            <button
              type="button"
              className={`att-tamper ${tamper === "edit" ? "is-on" : ""}`}
              onClick={() => setTamper("edit")}
              aria-pressed={tamper === "edit"}
              data-testid="button-attest-edit"
            >
              downgrade the R3 payout
            </button>
            <button
              type="button"
              className={`att-tamper ${tamper === "remove" ? "is-on" : ""}`}
              onClick={() => setTamper("remove")}
              aria-pressed={tamper === "remove"}
              data-testid="button-attest-remove"
            >
              delete the record
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${tamper}-${intact}-${busy}`}
              className={`att-badge ${busy ? "is-busy" : intact ? "is-ok" : "is-bad"}`}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              role="status"
            >
              <Icon name={busy ? "clock" : intact ? "shield" : "alert"} size={16} />
              {busy ? "verifying" : intact ? "chain intact" : `${broken.length} broken ${broken.length === 1 ? "link" : "links"}`}
            </motion.div>
          </AnimatePresence>
        </div>

        {!supported && (
          <p className="att-unsupported">
            This browser does not expose Web Crypto in this context, so the chain cannot be recomputed here. The
            same verification runs in the CLI with <code>void attest verify</code>.
          </p>
        )}

        <div className="att-chain">
          {entries.map((entry, index) => {
            const verdict = verdicts[index];
            const ok = verdict?.bodyOk && verdict?.linkOk;
            return (
              <div className="att-entry" key={`${entry.seq}-${entry.hash}`} data-ok={ok ? "1" : "0"} data-tone={entry.klass}>
                <span className="att-seq">{String(entry.seq).padStart(2, "0")}</span>
                <span className="att-time">{entry.time}</span>
                <code className="att-tool">{entry.tool}</code>
                <span className="att-agent">{entry.agent}</span>
                <span className={`tag tag-${entry.klass}`}>{entry.klass.toUpperCase()}</span>
                <span className="att-decision">{entry.decision}</span>
                <code className="att-hash">{shortHash(entry.hash)}</code>
                <span className="att-check">
                  {verdict === undefined ? (
                    "..."
                  ) : ok ? (
                    <Icon name="check" size={13} />
                  ) : !verdict.bodyOk ? (
                    "body"
                  ) : (
                    "link"
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {!busy && broken.length > 0 && (
            <motion.div
              className="att-explain"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <Icon name="alert" size={16} />
              <div>
                {tamper === "edit" ? (
                  <p>
                    <b>Caught by the body check, not the link check.</b> The record was edited and its recorded
                    hash left alone, so every prevHash still points where it should. The chain looks continuous.
                    Only recomputing sha256 over the contents shows entry {TARGET + 1} no longer produces the hash
                    it claims. This is why a verifier has to rehash rather than walk the links.
                  </p>
                ) : (
                  <p>
                    <b>Caught by the link check.</b> Removing a record leaves the next entry pointing at a hash
                    that is not in the ledger any more. A deletion cannot be hidden in an append only chain, which
                    is the one thing a plain database audit table cannot promise you.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Reveal className="att-honest">
          <p>
            <b>What this demo does and does not prove.</b> The hash chain is real and recomputed in front of you.
            Signature verification is not: that needs the deployment public key and happens in the CLI or against
            your own KMS. A chain proves internal consistency, a signature proves origin, and you need both.
          </p>
        </Reveal>
      </section>

      <section className="section" aria-labelledby="att-frames-label">
        <Reveal className="section-head">
          <span className="kicker" id="att-frames-label">
            [ 02 ] FRAMES
          </span>
          <span className="kicker-line" aria-hidden="true" />
        </Reveal>

        <h2 className="h2">One ledger, five sets of questions.</h2>
        <p className="lede mt-sm">
          Every framework below asks a version of the same thing: show me what the system did, who allowed it, and
          what happened next. The fields differ, the record does not. Each row also states what the ledger does
          not cover, because none of these are satisfied by a log alone.
        </p>

        <RevealGroup className="att-frames" stagger={0.06}>
          {frames.map((frame) => (
            <RevealItem className="att-frame" key={frame.id}>
              <header>
                <h3>{frame.name}</h3>
                <span className="tag">{frame.scope}</span>
              </header>
              <p className="att-frame-applies">
                <Icon name="clock" size={12} /> {frame.applies}
              </p>
              <p className="att-frame-asks">{frame.asks}</p>
              <div className="att-frame-fields">
                <h6>Answered by</h6>
                <div>
                  {frame.fields.map((field) => (
                    <code key={field}>{field}</code>
                  ))}
                </div>
              </div>
              <p className="att-frame-gap">
                <Icon name="alert" size={12} /> {frame.gap}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      <section className="section" aria-labelledby="att-under-label">
        <Reveal className="section-head">
          <span className="kicker" id="att-under-label">
            [ 03 ] WHERE THIS GOES
          </span>
          <span className="kicker-line" aria-hidden="true" />
        </Reveal>

        <div className="att-under">
          <Reveal>
            <h2 className="h2">The artifact an underwriter would need.</h2>
            <p className="lede mt-sm">
              Insuring an autonomous agent means pricing how much irreversible action it can take and how reliably
              that is constrained. Nobody can price that today because nobody has the telemetry. A signed
              attestation is the shape that evidence takes: bounded exposure, an unbroken record, and a budget that
              was enforced rather than declared.
            </p>
            <p className="mt-sm att-under-honest">
              <b>Stated as a direction, not a product.</b> VOID has no insurance partner, no underwriting
              agreement and no actuarial model. What it has is the substrate such a thing would require, which is
              why the ledger is built to be exported and verified by somebody who does not trust us.
            </p>
          </Reveal>

          <Reveal className="codebox">
            <pre>{`$ void attest export --period 2026-08 --sign

  period            2026-08-01 .. 2026-08-31
  actions           14203
  r3 executed          17
  r3 without approval   0
  budget breaches       0
  compensations run   206
  compensations failed  0
  chain               intact, 14203 links
  head       0x9f3c..a10e
  signature  ed25519:MEUCIQD...  (key: prod-2026-08)

  written to attest-2026-08.jsonl`}</pre>
          </Reveal>
        </div>
      </section>
    </>
  );
}
