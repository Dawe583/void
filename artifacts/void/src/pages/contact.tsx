import { type FormEvent, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { z } from "zod";
import { PageHero } from "@/components/site/page-hero";
import { Icon, Magnetic, Reveal } from "@/components/site/primitives";
import { submitContact } from "@/lib/api";
import { EASE } from "@/lib/motion";
import { usePageMeta } from "@/lib/use-site";

const schema = z.object({
  name: z.string().min(2, "your name is required"),
  email: z.string().min(1, "email is required").email("enter a valid email"),
  topic: z.string().min(1, "pick a topic"),
  message: z.string().min(10, "a sentence or two, please"),
});

const TOPICS = ["Private beta access", "Self hosted deployment", "Security review", "Compliance question", "Press", "Something else"];

const LINES: [string, string][] = [
  ["General", "hello@void.systems"],
  ["Security", "security@void.systems"],
  ["Press", "press@void.systems"],
  ["Location", "Prague, Czech Republic"],
  ["Response time", "one working day, from a person"],
];

export default function ContactPage() {
  usePageMeta(
    "Contact, VOID",
    "Talk to the team behind VOID about private beta access, self hosted deployments, security reviews or compliance questions.",
    "/contact",
  );

  const [form, setForm] = useState({ name: "", email: "", topic: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [serverError, setServerError] = useState("");

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse(form);
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
      await submitContact(parsed.data);
      setState("done");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "the message could not be sent");
      setState("failed");
    }
  };

  return (
    <>
      <PageHero
        kicker="CONTACT / 16"
        title="Talk to the people building it."
        copy="No chatbot, no qualification form with eleven fields. Tell us what you run and what you are trying to make safe, and a person replies."
        meta={["one working day", "no sales sequence", "Prague, CET"]}
      />

      <div style={{ padding: "clamp(30px, 5vw, 56px) var(--gut)" }}>
        <div className="contact-grid">
          <AnimatePresence mode="wait" initial={false}>
            {state === "done" ? (
              <motion.div
                key="done"
                className="receipt"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                data-testid="status-contact-success"
              >
                {`  +-----------------------------------------------+
  |  MESSAGE RECEIVED                             |
  +-----------------------------------------------+

`}
                <b>{`  Thanks, ${form.name.split(" ")[0]}. We read every message.`}</b>
                {`

  You will hear back within one working day, from a
  person, about ${form.topic.toLowerCase()}.`}
              </motion.div>
            ) : (
              <motion.form
                key="form"
                className="waitlist"
                onSubmit={submit}
                noValidate
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                data-testid="form-contact"
              >
                <div className="waitlist-row">
                  <div className="field">
                    <label htmlFor="ct-name">your name</label>
                    <input
                      id="ct-name"
                      autoComplete="name"
                      value={form.name}
                      onChange={(event) => set("name", event.target.value)}
                      aria-invalid={Boolean(errors.name)}
                      data-testid="input-contact-name"
                    />
                    {errors.name && <span className="field-error">{errors.name}</span>}
                  </div>
                  <div className="field">
                    <label htmlFor="ct-email">email</label>
                    <input
                      id="ct-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) => set("email", event.target.value)}
                      aria-invalid={Boolean(errors.email)}
                      data-testid="input-contact-email"
                    />
                    {errors.email && <span className="field-error">{errors.email}</span>}
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="ct-topic">topic</label>
                  <select
                    id="ct-topic"
                    value={form.topic}
                    onChange={(event) => set("topic", event.target.value)}
                    aria-invalid={Boolean(errors.topic)}
                    data-testid="select-contact-topic"
                  >
                    <option value="">select one</option>
                    {TOPICS.map((topic) => (
                      <option key={topic} value={topic}>
                        {topic}
                      </option>
                    ))}
                  </select>
                  {errors.topic && <span className="field-error">{errors.topic}</span>}
                </div>

                <div className="field">
                  <label htmlFor="ct-message">message</label>
                  <textarea
                    id="ct-message"
                    value={form.message}
                    onChange={(event) => set("message", event.target.value)}
                    placeholder="What are your agents allowed to write to today?"
                    aria-invalid={Boolean(errors.message)}
                    data-testid="input-contact-message"
                  />
                  {errors.message && <span className="field-error">{errors.message}</span>}
                </div>

                {state === "failed" && (
                  <div className="field-error" role="alert" data-testid="status-contact-error">
                    {serverError}. You can also write to hello@void.systems.
                  </div>
                )}

                <Magnetic strength={0.14}>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    disabled={state === "sending"}
                    data-testid="button-submit-contact"
                  >
                    {state === "sending" ? "sending" : "Send message"}
                    <Icon name="arrow" size={16} />
                  </button>
                </Magnetic>
              </motion.form>
            )}
          </AnimatePresence>

          <Reveal className="side-note" delay={0.08}>
            <span className="kicker">Direct lines</span>
            {LINES.map(([label, value]) => (
              <div className="contact-line" key={label}>
                <span>{label}</span>
                <strong>
                  {value.includes("@") ? <a href={`mailto:${value}`}>{value}</a> : value}
                </strong>
              </div>
            ))}
            <p className="mono">
              VOID is a product concept. The addresses above are placeholders for the concept, not a staffed
              inbox.
            </p>
          </Reveal>
        </div>
      </div>
    </>
  );
}
