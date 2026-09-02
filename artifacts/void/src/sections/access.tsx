import { type FormEvent, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "wouter";
import { z } from "zod";
import { Icon, Magnetic, Reveal, Section, SplitHeading } from "@/components/site/primitives";
import { submitWaitlist, type WaitlistReceipt } from "@/lib/api";
import { EASE } from "@/lib/motion";

const schema = z.object({
  email: z.string().min(1, "work email is required").email("enter a valid work email"),
  company: z.string().min(2, "company is required"),
  agents: z.string().min(1, "select how many agents you run"),
  frameworks: z.array(z.string()),
  note: z.string().max(1200).optional(),
});

const FRAMEWORKS = ["LangGraph", "CrewAI", "OpenAI Agents", "Claude Agent SDK", "MCP", "custom loop"];
const SIZES = ["1 to 5", "6 to 25", "26 to 100", "100+"];

export function Access() {
  const [form, setForm] = useState({ email: "", company: "", agents: "", note: "" });
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [receipt, setReceipt] = useState<WaitlistReceipt | null>(null);
  const [serverError, setServerError] = useState("");

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({ ...form, frameworks });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const key = String(issue.path[0]);
        if (!next[key]) next[key] = issue.message;
      });
      setErrors(next);
      return;
    }

    setState("sending");
    setServerError("");
    try {
      const result = await submitWaitlist(parsed.data);
      setReceipt(result);
      setState("done");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "the request could not be sent");
      setState("failed");
    }
  };

  return (
    <Section id="access" index="13" label="ACCESS">
      <div className="cta-grid">
        <div>
          <SplitHeading text="Let your agents act. Keep the undo." className="h2" />
          <p className="lede mt-sm mt-md">
            Private beta access for platform and compliance teams running agents in production. Tell us what you
            run and what you wish you could reverse.
          </p>

          <AnimatePresence mode="wait" initial={false}>
            {state === "done" && receipt ? (
              <motion.div
                key="receipt"
                className="receipt mt-md"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                data-testid="status-waitlist-success"
              >
                {`  +-----------------------------------------------+
  |  ACCESS REQUEST SEALED                        |
  +-----------------------------------------------+
`}
                <b>{`  sequence   #${receipt.sequence}
  request    ${receipt.id}
  hash       ${receipt.hash}
  sealed at  ${new Date(receipt.sealedAt).toISOString()}
  storage    ${receipt.stored ? "durable" : "in memory, no database configured"}
`}</b>
                {`
  We reply to every request from a real person, usually
  within two working days. Nothing else lands in your inbox.`}
              </motion.div>
            ) : (
              <motion.form
                key="form"
                className="waitlist mt-md"
                onSubmit={submit}
                noValidate
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                data-testid="form-waitlist"
              >
                <div className="waitlist-row">
                  <div className="field">
                    <label htmlFor="wl-email">work email</label>
                    <input
                      id="wl-email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={form.email}
                      onChange={(event) => set("email", event.target.value)}
                      placeholder="you@company.com"
                      aria-invalid={Boolean(errors.email)}
                      data-testid="input-email"
                    />
                    {errors.email && <span className="field-error">{errors.email}</span>}
                  </div>
                  <div className="field">
                    <label htmlFor="wl-company">company</label>
                    <input
                      id="wl-company"
                      autoComplete="organization"
                      value={form.company}
                      onChange={(event) => set("company", event.target.value)}
                      placeholder="your team"
                      aria-invalid={Boolean(errors.company)}
                      data-testid="input-company"
                    />
                    {errors.company && <span className="field-error">{errors.company}</span>}
                  </div>
                </div>

                <div className="field">
                  <span id="wl-frameworks-label" style={{ display: "block", fontFamily: "var(--font-code)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                    frameworks
                  </span>
                  <div className="chip-row" role="group" aria-labelledby="wl-frameworks-label">
                    {FRAMEWORKS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="chip"
                        aria-pressed={frameworks.includes(item)}
                        onClick={() =>
                          setFrameworks((current) =>
                            current.includes(item) ? current.filter((value) => value !== item) : [...current, item],
                          )
                        }
                        data-testid={`button-framework-${item.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="wl-agents">agents in production</label>
                  <select
                    id="wl-agents"
                    value={form.agents}
                    onChange={(event) => set("agents", event.target.value)}
                    aria-invalid={Boolean(errors.agents)}
                    data-testid="select-agents"
                  >
                    <option value="">select one</option>
                    {SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  {errors.agents && <span className="field-error">{errors.agents}</span>}
                </div>

                <div className="field">
                  <label htmlFor="wl-note">context, optional</label>
                  <textarea
                    id="wl-note"
                    value={form.note}
                    onChange={(event) => set("note", event.target.value)}
                    placeholder="What write do you wish you could reverse?"
                    data-testid="input-note"
                  />
                </div>

                {state === "failed" && (
                  <div className="field-error" role="alert" data-testid="status-waitlist-error">
                    {serverError}. You can also write to hello@void.systems.
                  </div>
                )}

                <Magnetic strength={0.14}>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    disabled={state === "sending"}
                    data-testid="button-submit-waitlist"
                  >
                    {state === "sending" ? "sealing request" : "Request access"}
                    <Icon name="arrow" size={16} />
                  </button>
                </Magnetic>
                <p className="mono">
                  No newsletter. No sales sequence. One human reply.
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        <Reveal className="side-note" delay={0.1}>
          <span className="kicker">Also read</span>
          <h3 className="h2" style={{ fontSize: "clamp(26px, 3.4vw, 36px)" }}>
            The reversible autonomy specification.
          </h3>
          <p className="lede" style={{ fontSize: 15 }}>
            A technical model for interceptors, compensation plans, classifying risk, and replaying across
            systems. This is the page an engineer sends to a colleague.
          </p>
          <Link href="/spec" className="btn btn-ghost" data-testid="link-access-spec">
            Read the spec
            <Icon name="arrowUpRight" size={15} />
          </Link>
          <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "6px 0" }} />
          <span className="kicker">Prefer to talk</span>
          <p className="mono" style={{ lineHeight: 1.8 }}>
            hello@void.systems
            <br />
            security@void.systems
            <br />
            Prague, Czech Republic
          </p>
          <Link href="/contact" className="link-arrow" data-testid="link-access-contact">
            Open the contact page
            <Icon name="arrowUpRight" size={15} />
          </Link>
        </Reveal>
      </div>
    </Section>
  );
}
