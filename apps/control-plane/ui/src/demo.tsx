import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as m from "motion/react-m";
import { MotionConfig, useReducedMotion } from "motion/react";
import { api, download, type Row } from "./api";
import { BrandMark } from "./brand";
import { Icon } from "./icons";
import { Dialog, ErrorBox, MotionEnabled, useText } from "./ui";

const RichText = lazy(() =>
  import("./chat").then((module) => ({ default: module.RichText })),
);

export function PublicDemo({
  onWorkspace,
  motion,
  onMotion,
}: {
  onWorkspace: () => void;
  motion: boolean;
  onMotion: () => void;
}) {
  const t = useText(),
    reduced = useReducedMotion() || !motion;
  const [state, setState] = useState<Row>(),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [panel, setPanel] = useState<"menu" | "documents" | null>(null),
    [review, setReview] = useState<Row>(),
    [proof, setProof] = useState<Row>();
  const transcript = useRef<HTMLDivElement>(null),
    started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api("/api/demo/start", "POST", {}).then(setState).catch(setError);
  }, []);
  useEffect(() => {
    transcript.current?.scrollTo({
      top: transcript.current.scrollHeight,
      behavior: reduced ? "instant" : "smooth",
    });
  }, [state?.messages?.length, busy, reduced]);
  useEffect(() => {
    if (state?.status !== "running" || busy) return;
    const timer = setInterval(() => {
      void api("/api/demo/state").then(setState).catch(setError);
    }, 2000);
    return () => clearInterval(timer);
  }, [state?.status, busy]);
  const documents = (
    <>
      <p className="demo-explanation">
        {t(
          "Dokumenty této zkušební relace. Změny lze zkontrolovat a vrátit.",
          "Documents in this demo session. Inspect changes and restore earlier content.",
        )}
      </p>
      {!Object.keys(state?.files ?? {}).length && (
        <div className="demo-empty-document">
          <Icon name="documents" />
          <p>
            {t(
              "Požádej VOID o vytvoření prvního dokumentu.",
              "Ask VOID to create your first document.",
            )}
          </p>
        </div>
      )}
      {Object.entries(state?.files ?? {}).map(([path, content]) => (
        <details key={path} className="demo-file">
          <summary>
            <Icon name="documents" />
            <span>{path}</span>
          </summary>
          <pre>{String(content)}</pre>
          <button
            onClick={() => download(path.split("/").at(-1)!, String(content))}
          >
            <Icon name="download" />
            {t("Stáhnout", "Download")}
          </button>
        </details>
      ))}
      {!!state?.operations?.length && (
        <h3>{t("Historie změn", "Change history")}</h3>
      )}
      {[...(state?.operations ?? [])].reverse().map((op: Row) => (
        <div className="demo-change" key={op.id}>
          <div>
            <strong>{op.path}</strong>
            <span>{op.kind}</span>
          </div>
          <button
            disabled={!op.canApply || busy}
            onClick={() => {
              setPanel(null);
              setReview(op);
            }}
          >
            <Icon name="undo" />
            {t("Zkontrolovat Undo", "Review Undo")}
          </button>
        </div>
      ))}
      {!!state?.operations?.length && (
        <button
          className="demo-proof"
          onClick={async () => {
            try {
              setProof(await api("/api/demo/proof"));
            } catch (e) {
              setError(e);
            }
          }}
        >
          {t("Ověřit podpisy", "Verify signatures")}
        </button>
      )}
      {proof && (
        <p role="status">
          {proof.verified
            ? t("Podpisy ověřeny", "Signatures verified")
            : t("Ověření selhalo", "Verification failed")}
          : {proof.entries?.length} {t("záznamů", "records")}
        </p>
      )}
    </>
  );
  async function send() {
    if (busy || !draft.trim()) return;
    const prompt = draft.trim();
    setBusy(true);
    setError(undefined);
    setDraft("");
    setState((current) => ({
      ...current,
      messages: [
        ...(current?.messages ?? []),
        { role: "user", content: prompt },
      ],
    }));
    try {
      setState(
        await api("/api/demo/message", "POST", {
          prompt,
          requestId: crypto.randomUUID(),
        }),
      );
    } catch (e) {
      setError(e);
      try {
        setState(await api("/api/demo/state"));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  return (
    <MotionEnabled value={!reduced}>
      <MotionConfig reducedMotion="user">
        <div className="demo-app">
          <header className="demo-topbar">
            <button
              aria-label={t("Otevřít menu", "Open menu")}
              onClick={() => setPanel("menu")}
            >
              <Icon name="menu" />
            </button>
            <a className="demo-brand" href="/demo">
              <BrandMark />
              <strong>VOID</strong>
              <span>{t("Zkušební prostor", "Demo workspace")}</span>
            </a>
            <button
              aria-label={t("Dokumenty a historie", "Documents and history")}
              onClick={() => setPanel("documents")}
            >
              <Icon name="context" />
              {!!Object.keys(state?.files ?? {}).length && <i />}
            </button>
          </header>
          <div className="demo-layout">
            <main className="demo-main" id="main">
              <div
                className="demo-transcript"
                ref={transcript}
                aria-label={t("Konverzace", "Conversation")}
              >
                {!state?.messages?.length ? (
                  <m.div
                    className="demo-welcome"
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <BrandMark />
                    <h1>
                      {t(
                        "Od nápadu. Zpět kdykoliv.",
                        "From idea. Back anytime.",
                      )}
                    </h1>
                    <p>
                      {t(
                        "Vyzkoušej AI, která tvoří dokumenty a uchovává cestu zpět. Bez nastavení.",
                        "Try an AI that creates documents and keeps a way back. No setup needed.",
                      )}
                    </p>
                    <div className="demo-starters">
                      {[
                        [
                          "Vytvoř projekt",
                          "Plan a project",
                          "Create a concise project plan in plan.md for a personal portfolio website.",
                        ],
                        [
                          "Vyzkoušej Undo",
                          "Try Undo",
                          "Create notes.md with three ideas for a weekend project. Then change the first idea so I can test Undo.",
                        ],
                        [
                          "Co umí VOID?",
                          "What can VOID do?",
                          "Explain what this demo can reverse and what remains outside its scope.",
                        ],
                      ].map(([cs, en, prompt]) => (
                        <m.button
                          key={en}
                          whileTap={reduced ? undefined : { scale: 0.97 }}
                          onClick={() => setDraft(prompt)}
                        >
                          {t(cs!, en!)}
                        </m.button>
                      ))}
                    </div>
                  </m.div>
                ) : (
                  <div className="demo-messages">
                    {state.messages.map((message: Row, index: number) => (
                      <m.article
                        key={index}
                        data-role={message.role}
                        initial={reduced ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        <span>
                          {message.role === "user"
                            ? t("Ty", "You")
                            : message.role === "tool"
                              ? t("Nástroj", "Tool")
                              : "VOID"}
                        </span>
                        <div
                          className={
                            message.role === "assistant"
                              ? "demo-rich"
                              : undefined
                          }
                        >
                          {message.role === "assistant" ? (
                            <Suspense fallback={message.content}>
                              <RichText text={message.content} />
                            </Suspense>
                          ) : (
                            message.content
                          )}
                        </div>
                      </m.article>
                    ))}
                    {busy && (
                      <div className="demo-thinking" role="status">
                        <BrandMark />
                        {t("VOID pracuje…", "VOID is working…")}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="demo-compose-area">
                <ErrorBox
                  error={
                    error ?? (state?.error ? new Error(state.error) : undefined)
                  }
                />
                <form
                  className="demo-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    aria-label={t("Zpráva", "Message")}
                    rows={2}
                    maxLength={4000}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t(
                      "Co spolu vytvoříme?",
                      "What shall we create?",
                    )}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing &&
                        matchMedia("(min-width: 768px)").matches
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="demo-composer-tools">
                    <span>
                      <b>GLM 5.3 Free</b>
                      <small>TokenRouter</small>
                    </span>
                    <m.button
                      type="submit"
                      className="primary"
                      aria-label={t("Odeslat zprávu", "Send message")}
                      disabled={
                        busy ||
                        !state ||
                        !draft.trim() ||
                        state.status === "running"
                      }
                      whileTap={reduced ? undefined : { scale: 0.92 }}
                    >
                      <Icon name="send" />
                    </m.button>
                  </div>
                </form>
                <p className="demo-scope">
                  {t(
                    "Pouze zkušební dokumenty. Bez přístupu k počítači a propojeným účtům.",
                    "Demo documents only. No access to your computer or connected accounts.",
                  )}
                </p>
              </div>
            </main>
            <aside className="demo-document-rail">
              <div className="demo-rail-title">
                <Icon name="documents" />
                <h2>{t("Dokumenty a historie", "Documents and history")}</h2>
              </div>
              {documents}
            </aside>
          </div>
          {panel && (
            <Dialog
              title={
                panel === "menu"
                  ? "VOID"
                  : t("Dokumenty a historie", "Documents and history")
              }
              close={() => setPanel(null)}
            >
              {panel === "documents" ? (
                documents
              ) : (
                <div className="mobile-action-list">
                  <button onClick={() => setPanel("documents")}>
                    <Icon name="documents" />
                    <span>
                      {t("Dokumenty a historie", "Documents and history")}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      document.documentElement.dataset.theme =
                        document.documentElement.dataset.theme === "dark"
                          ? "light"
                          : "dark";
                    }}
                  >
                    <Icon name="theme" />
                    <span>{t("Změnit vzhled", "Change appearance")}</span>
                  </button>
                  <button aria-pressed={motion} onClick={onMotion}>
                    <Icon name="motion" />
                    <span>{t("Animace", "Animations")}</span>
                    <small>
                      {motion ? t("Zapnuto", "On") : t("Vypnuto", "Off")}
                    </small>
                  </button>
                  <button onClick={onWorkspace}>
                    <Icon name="connections" />
                    <span>
                      {t("Soukromý pracovní prostor", "Private workspace")}
                    </span>
                  </button>
                  <p className="demo-explanation">
                    {t(
                      "6 zpráv na návštěvníka denně. Relace trvá 24 hodin. Nezadávej citlivé údaje.",
                      "6 messages per visitor per day. Session lasts 24 hours. Use non-sensitive examples.",
                    )}
                  </p>
                </div>
              )}
            </Dialog>
          )}
          {review && (
            <Dialog
              title={t("Zkontrolovat obnovu", "Review restoration")}
              close={() => setReview(undefined)}
            >
              <p>{review.path}</p>
              <div className="demo-diff">
                <section>
                  <h3>{t("Aktuální obsah", "Current content")}</h3>
                  <pre>
                    {review.before ??
                      t("Soubor neexistuje", "File does not exist")}
                  </pre>
                </section>
                <section>
                  <h3>{t("Po obnově", "After restoration")}</h3>
                  <pre>
                    {review.after ??
                      t("Soubor bude odstraněn", "File will be removed")}
                  </pre>
                </section>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setState(
                      await api("/api/demo/undo", "POST", {
                        operationId: review.id,
                      }),
                    );
                    setReview(undefined);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="undo" />
                {t("Obnovit tento obsah", "Restore this content")}
              </button>
            </Dialog>
          )}
        </div>
      </MotionConfig>
    </MotionEnabled>
  );
}
