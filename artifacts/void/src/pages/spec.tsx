import { Link } from "wouter";
import { PageHero, TableOfContents } from "@/components/site/page-hero";
import { Icon, Reveal } from "@/components/site/primitives";
import { CodeBlock } from "@/sections/install";
import { classRows, compensationTable, toneVar } from "@/lib/site-data";
import { useActiveSection, usePageMeta } from "@/lib/use-site";

const TOC = [
  { id: "model", label: "The model" },
  { id: "lifecycle", label: "Call lifecycle" },
  { id: "classes", label: "Reversibility classes" },
  { id: "compensation", label: "Compensation table" },
  { id: "policy", label: "Policy evaluation" },
  { id: "ledger", label: "Ledger format" },
  { id: "replay", label: "Replay semantics" },
  { id: "budget", label: "Irreversibility budget" },
  { id: "limits", label: "Known limits" },
];

const POLICY_SAMPLE = `import { policy, R } from "@void/policy";

export default policy({
  // read only calls never enter the pipeline
  skip: (call) => call.effect === "read",

  rules: [
    // anything that moves money needs a human, always
    {
      when: (call) => call.class === R.R3 && call.domain === "payments",
      then: "hold",
      approvers: ["group:finance"],
      reason: "irreversible transfer",
    },
    // external email is mitigable only, cap the blast radius
    {
      when: (call) => call.tool === "gmail.message.send" && call.recipients > 25,
      then: "veto",
      reason: "bulk external send",
    },
    // wide CRM writes are allowed but must be snapshotted first
    {
      when: (call) => call.records > 100 && call.class <= R.R1,
      then: "allow",
      require: ["snapshot"],
    },
  ],

  budget: {
    irreversible: { perAgentPerDay: 2 },
    onExhausted: "read_only",
  },
});`;

const LEDGER_SAMPLE = `{
  "sequence": 1042,
  "workspace": "acme",
  "agent": "billing-ops",
  "timestamp": "2026-08-21T09:14:11.204Z",
  "intent": "issue_refund",
  "tool": "stripe.refunds.create",
  "payload_digest": "sha256:7d19..c4b2",
  "blast_radius": { "systems": ["payments", "ledger", "mail"], "records": 3 },
  "class": "R3",
  "policy": { "decision": "hold", "rule": "irreversible transfer" },
  "approved_by": "dana@acme.example",
  "result": { "status": "ok", "external_id": "re_3P9k" },
  "snapshot": null,
  "compensation": null,
  "budget_entry": "r3:2026-08-21:1of2",
  "prev_hash": "0x9f3c..77d1",
  "hash": "0xa10e..3b08",
  "signature": "ed25519:5f21..ee90"
}`;

export default function SpecPage() {
  usePageMeta(
    "Specification, VOID",
    "The reversible autonomy specification: interceptors, preflight, compensation plans, the saga ledger and cross system replay.",
    "/spec",
  );
  const active = useActiveSection(TOC.map((entry) => entry.id));

  return (
    <>
      <PageHero
        kicker="SPEC / 01"
        title="The reversible autonomy specification."
        copy="A system model for placing an accountable layer between an AI agent and the tools it can change. This is the page an engineer sends to a colleague."
        meta={["version 0.9", "updated 2026-08-14", "20 example tools", "9 sections"]}
      />

      <div className="doc-layout">
        <TableOfContents items={TOC} active={active} />

        <article className="prose">
          <section id="model">
            <h2>01 / The model</h2>
            <p>
              VOID treats every agent side effect as a transaction with five known moments: <strong>intent</strong>,{" "}
              <strong>preflight</strong>, <strong>commit</strong>, <strong>compensation</strong> and{" "}
              <strong>record</strong>. The interceptor is the boundary. The ledger is the memory.
            </p>
            <pre className="block">{`agent -> interceptor -> preflight -> policy -> tool
                          |                       |
                     blast radius            before snapshot
                          |                       |
                    class + budget  ->  compensation plan -> ledger`}</pre>
            <p>
              Nothing in this model requires the agent to cooperate. An agent that lies about its intent still has
              to make the call through the interceptor, and the interceptor classifies the call, not the claim.
            </p>
          </section>

          <section id="lifecycle">
            <h2>02 / Call lifecycle</h2>
            <ol>
              <li>
                <strong>Intercept.</strong> The call is captured at the transport or SDK boundary with its full
                argument set.
              </li>
              <li>
                <strong>Classify.</strong> The tool identity plus the argument shape resolve to a reversibility
                class using the adapter's compensation map.
              </li>
              <li>
                <strong>Estimate.</strong> Blast radius is computed: which systems change, how many records, which
                fields. Wide writes sample rather than enumerate.
              </li>
              <li>
                <strong>Decide.</strong> Policy returns allow, hold or veto. A veto happens before the write, so
                nothing has to be undone.
              </li>
              <li>
                <strong>Snapshot.</strong> For R0 and R1 calls the before image is captured, in parallel with the
                call where the adapter supports point in time reads.
              </li>
              <li>
                <strong>Commit.</strong> The call is forwarded. The result, including external identifiers, is
                recorded.
              </li>
              <li>
                <strong>Seal.</strong> The ledger entry is hashed against the previous entry and signed.
              </li>
            </ol>
            <blockquote>
              Preflight adds 8 to 40ms depending on how many systems the call touches. Read only calls skip the
              pipeline entirely.
            </blockquote>
          </section>

          <section id="classes">
            <h2>03 / Reversibility classes</h2>
            <p>
              Class is computed before a write. It is not a post hoc label. R3 consumes budget even when policy
              allows the action.
            </p>
            <div className="class-list" style={{ marginTop: 18 }}>
              {classRows.map((row) => (
                <div className="class-row" key={row.id}>
                  <div className="class-trigger" style={{ cursor: "default" }}>
                    <span className="class-dot" style={{ background: toneVar[row.id], color: toneVar[row.id] }} />
                    <strong>{row.title}</strong>
                    <span className="class-copy">
                      <b>{row.subtitle}</b>, compensation <code>{row.compensation}</code>
                    </span>
                    <span />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="compensation">
            <h2>04 / Compensation table</h2>
            <p>
              Twenty example tools with their class and stored inverse. Adapters ship with a table like this and
              extend it as new tools are registered.
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>tool action</th>
                    <th>class</th>
                    <th>stored inverse</th>
                    <th>note</th>
                  </tr>
                </thead>
                <tbody>
                  {compensationTable.map(([tool, tone, inverse, note]) => (
                    <tr key={tool}>
                      <td>
                        <code>{tool}</code>
                      </td>
                      <td>
                        <span className={`tag tag-${tone}`}>{tone.toUpperCase()}</span>
                      </td>
                      <td>{inverse}</td>
                      <td>{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="policy">
            <h2>05 / Policy evaluation</h2>
            <p>
              Policies are ordinary TypeScript or Python modules, evaluated in order. The first rule that matches
              decides. A rule can require preconditions, such as a captured snapshot, before allowing the call.
            </p>
            <CodeBlock code={POLICY_SAMPLE} label="void.policy.ts" />
          </section>

          <section id="ledger">
            <h2>06 / Ledger format</h2>
            <p>
              Each entry is append only, signed by the workspace key, and linked to the previous entry. An export
              is useful to an engineer and legible to a risk team.
            </p>
            <CodeBlock code={LEDGER_SAMPLE} label="ledger entry" />
            <p>
              The chain is per workspace, not per agent, so a replay can order actions across agents that touched
              the same system in the same window.
            </p>
          </section>

          <section id="replay">
            <h2>07 / Replay semantics</h2>
            <p>
              A replay targets a timestamp. VOID collects every entry after that timestamp, orders them last in
              first out, and executes each compensation plan in turn. Ordering is global across systems, because a
              CRM write that referenced a payment must be undone before the payment reversal.
            </p>
            <ul>
              <li>R0 entries restore from snapshot and verify the restored digest.</li>
              <li>R1 entries delete the created object and append a trace note describing the visibility window.</li>
              <li>R2 entries execute the mitigation and record that it was a mitigation, not an undo.</li>
              <li>R3 entries are reported as terminal, with the evidence bundle and the budget entry that paid for them.</li>
            </ul>
            <p>
              A replay is itself an intercepted operation. It produces its own ledger entries, so you can see who
              rewound what, and when.
            </p>
          </section>

          <section id="budget">
            <h2>08 / Irreversibility budget</h2>
            <p>
              Each agent has a daily allowance of R3 actions. Spending the last unit drops the agent to read only
              until a human tops it up. The budget is enforced at preflight, so an agent never discovers it is out
              of budget halfway through a write.
            </p>
            <pre className="block">{`budget:
  irreversible:
    perAgentPerDay: 2
    perWorkspacePerDay: 8
  onExhausted: read_only     # or: hold_for_human, veto`}</pre>
          </section>

          <section id="limits">
            <h2>09 / Known limits</h2>
            <ul>
              <li>VOID cannot reverse what a tool exposes no inverse for. Those calls are R2 or R3 by definition.</li>
              <li>Snapshots depend on the target system supporting a before image. Without one, a write drops a class.</li>
              <li>An agent that reaches a system outside the interceptor is invisible to VOID. Network policy is the answer, not hope.</li>
              <li>Replay is not a time machine. Anything a human did between the write and the replay is not accounted for automatically.</li>
            </ul>
            <hr />
            <p className="mono">
              VOID is a product concept. Numbers and examples on this page are illustrative.
            </p>
            <Link href="/docs/quickstart" className="link-arrow" data-testid="link-spec-quickstart">
              Continue to the quickstart
              <Icon name="arrowUpRight" size={15} />
            </Link>
          </section>
        </article>
      </div>
    </>
  );
}
