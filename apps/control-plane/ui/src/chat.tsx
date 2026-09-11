import { BrandMark } from "./brand";
import { ApprovalReview } from "./approval-review";
import { transcriptEvents } from "./events";
import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, download, json, type Row } from "./api";
import { Badge, Dialog, ErrorBox, useApi, useText } from "./ui";
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null),
    [wrap, setWrap] = useState(false),
    [highlight, setHighlight] = useState("");
  const t = useText();
  const child = Children.toArray(children).find(isValidElement);
  const props = child?.props as
    { className?: string; children?: ReactNode } | undefined;
  const language = props?.className?.replace("language-", "") ?? "text";
  const source = String(props?.children ?? "");
  useEffect(() => {
    let active = true;
    if (language === "text") return;
    void import("highlight.js/lib/common")
      .then(({ default: hljs }) => {
        if (active && hljs.getLanguage(language))
          setHighlight(
            hljs.highlight(source, { language, ignoreIllegals: true }).value,
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [source, language]);
  return (
    <div className="code-block">
      <div className="code-actions">
        <span>{language}</span>
        <button onClick={() => navigator.clipboard.writeText(source)}>
          {t("Kopírovat", "Copy")}
        </button>
        <button onClick={() => setWrap(!wrap)} aria-pressed={wrap}>
          {t("Zalamovat", "Wrap")}
        </button>
        <button
          onClick={() =>
            download("code." + (language === "text" ? "txt" : language), source)
          }
        >
          {t("Stáhnout", "Download")}
        </button>
      </div>
      <pre ref={ref} style={{ whiteSpace: wrap ? "pre-wrap" : "pre" }}>
        {highlight ? (
          <code dangerouslySetInnerHTML={{ __html: highlight }} />
        ) : (
          children
        )}
      </pre>
    </div>
  );
}
export function RichText({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        pre: CodeBlock,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </Markdown>
  );
}
export function Chat({
  id,
  navigate,
  onContext,
}: {
  id?: string;
  navigate: (path: string) => void;
  onContext: () => void;
}) {
  const t = useText(),
    client = useQueryClient();
  const sessionQuery = useApi(
    "/api/sessions/" + id + "?events=false",
    !!id,
    (data) => (data?.session?.status === "running" ? 5000 : 15000),
  );
  const provider = useApi("/api/provider");
  const preferences = useApi("/api/preferences");
  const workspace = useApi("/api/sessions/" + id + "/workspace", !!id);
  const holds = useApi("/api/approvals", !!id, 3000);
  const [contextPicker, setContextPicker] = useState(false);
  const [approval, setApproval] = useState<Row>();
  const session = sessionQuery.data?.session;
  const providerEndpoint = id ? session?.provider : provider.data?.baseUrl;
  const providerLabel =
    session?.providerName ??
    provider.data?.presets?.find(
      (preset: Row) => preset.baseUrl === providerEndpoint,
    )?.name ??
    providerEndpoint ??
    t("Poskytovatel neověřen", "Provider unverified");
  const running =
    session?.status === "running" || session?.status === "cancelling";
  const draftKey =
    "void-draft:" +
    new URLSearchParams(location.search).get("workspace") +
    ":" +
    (id ?? "new");
  const [draft, setDraft] = useState(
    () => sessionStorage.getItem(draftKey) ?? "",
  );
  const [model, setModel] = useState("z-ai/glm-5.3-free");
  const [modelSearch, setModelSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("void-model-favorites") ?? "[]");
    } catch {
      return [];
    }
  });
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [branch, setBranch] = useState<Row>();
  const [retry, setRetry] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [edited, setEdited] = useState("");
  const [attachments, setAttachments] = useState<
    { name: string; content: string; bytes: number }[]
  >([]);
  const [newMessages, setNewMessages] = useState(false);
  const [follow, setFollow] = useState(true);
  const transcript = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const requestKey = useRef<{ prompt: string; key: string } | undefined>(
    undefined,
  );
  useEffect(() => {
    setDraft(sessionStorage.getItem(draftKey) ?? "");
    setAttachments([]);
    setFollow(true);
  }, [draftKey]);
  useEffect(() => {
    sessionStorage.setItem(draftKey, draft);
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height =
        Math.min(156, textarea.current.scrollHeight) + "px";
    }
  }, [draft, draftKey]);
  useEffect(() => {
    if (preferences.data?.preferences?.defaultModel)
      setModel(preferences.data.preferences.defaultModel);
  }, [preferences.data]);
  const [eventBuffer, setEventBuffer] = useState<Row[]>([]);
  const [historyComplete, setHistoryComplete] = useState(true);
  const events = transcriptEvents(
    eventBuffer.length ? eventBuffer : (session?.events ?? []),
  );
  const latestError = [...eventBuffer]
    .reverse()
    .find((event: Row) => event.type === "run.error");
  const retryAt = Date.parse(latestError?.payload?.retryAt ?? "");
  const retryWait = Number.isFinite(retryAt)
    ? Math.max(0, Math.ceil((retryAt - now) / 1000))
    : 0;
  useEffect(() => {
    if (!retryWait) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryWait]);
  useEffect(() => {
    if (!id) return;
    let disposed = false,
      fetching = false,
      after = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingEvents: Row[] = [];
    const merge = (incoming: Row[]) => {
      if (disposed || !incoming.length) return;
      setEventBuffer((previous) =>
        [
          ...new Map(
            [...previous, ...incoming].map((event) => [event.seq, event]),
          ).values(),
        ].sort((a, b) => a.seq - b.seq),
      );
    };
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        void client.invalidateQueries({
          queryKey: ["/api/sessions/" + id + "?events=false"],
        });
        timer = undefined;
      }, 500);
    };
    async function sync() {
      if (fetching || disposed || document.hidden) return;
      fetching = true;
      try {
        let more = true;
        while (more && !disposed) {
          const result = await api(
            "/api/sessions/" + id + "/events?after=" + after,
          );
          const incoming = result.items ?? [];
          merge(incoming);
          if (after === 0) setHistoryComplete(result.historyComplete !== false);
          const next = Number(result.nextAfter ?? result.after ?? after);
          more = !!result.hasMore && next > after;
          after = next;
        }
      } catch {
        /* Session query exposes connection errors while incremental reads retry. */
      } finally {
        fetching = false;
      }
    }
    const stream = new EventSource(
      "/api/sessions/" + encodeURIComponent(id) + "/stream",
    );
    stream.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data);
        pendingEvents.push(incoming);
        if (
          ["run.status", "run.error", "message.completed"].includes(
            incoming.type,
          )
        )
          refresh();
        if (["document.changed", "tool.result"].includes(incoming.type))
          void client.invalidateQueries({
            predicate: (query) => {
              const key = String(query.queryKey[0]);
              return (
                key.startsWith("/api/documents") ||
                key.startsWith("/api/sessions/" + id + "/workspace") ||
                key.startsWith("/api/sessions/" + id + "/documents")
              );
            },
          });
        if (!eventTimer)
          eventTimer = setTimeout(() => {
            merge(pendingEvents);
            pendingEvents = [];
            eventTimer = undefined;
          }, 100);
      } catch {
        void sync();
      }
    };
    stream.onerror = () => {
      void sync();
    };
    const poll = setInterval(() => void sync(), 5000);
    void sync();
    return () => {
      disposed = true;
      stream.close();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      if (eventTimer) clearTimeout(eventTimer);
    };
  }, [id, client]);
  useEffect(() => {
    if (follow && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
      setNewMessages(false);
    } else setNewMessages(true);
  }, [events.length, events.at(-1)?.text, follow]);
  async function send() {
    if (!draft.trim() || busy || running || retryWait > 0) return;
    setBusy(true);
    setError(undefined);
    const prompt =
      draft +
      (attachments.length
        ? "\n\n" +
          attachments
            .map((a) => "--- " + a.name + " ---\n" + a.content)
            .join("\n\n")
        : "");
    if (
      prompt.length > 32000 ||
      new TextEncoder().encode(JSON.stringify({ prompt })).length > 60000
    ) {
      setError(
        t(
          "Zpráva s přílohami přesahuje limit 32 000 znaků nebo 60 KB. Zkraťte ji.",
          "Message and attachments exceed 32,000 characters or 60 KB. Shorten it.",
        ),
      );
      setBusy(false);
      return;
    }
    if (!requestKey.current || requestKey.current.prompt !== prompt)
      requestKey.current = { prompt, key: crypto.randomUUID() };
    try {
      const result = await api(
        id ? "/api/sessions/" + id : "/api/sessions",
        "POST",
        {
          prompt,
          model: session?.model ?? model,
          idempotencyKey: requestKey.current.key,
        },
      );
      sessionStorage.removeItem(draftKey);
      setDraft("");
      setAttachments([]);
      requestKey.current = undefined;
      setFollow(true);
      await client.invalidateQueries();
      if (!id) navigate("/chat/" + result.session.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function fork() {
    if (!branch || !id) return;
    setBusy(true);
    try {
      const result = await api("/api/sessions/" + id + "/branches", "POST", {
        seq: branch.seq,
        ...(branch.kind === "user" ? { prompt: edited } : {}),
        snapshotDocuments: true,
      });
      if (retry)
        await api("/api/sessions/" + result.session.id, "POST", {
          prompt: t(
            "Odpověz na předchozí uživatelskou zprávu.",
            "Respond to the preceding user message.",
          ),
          idempotencyKey: crypto.randomUUID(),
        });
      setBranch(undefined);
      setRetry(false);
      navigate("/chat/" + result.session.id);
      await client.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const models: Row[] = provider.data?.models ?? [];
  const catalog = models;
  return (
    <section className="chat">
      <div
        className="transcript"
        ref={transcript}
        onScroll={() => {
          const el = transcript.current;
          if (el)
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        <div className="messages">
          {!id && (
            <div className="welcome">
              <div className="welcome-emblem">
                <BrandMark />
              </div>
              <h1>
                {t(
                  "Prostor pro vaše další myšlenky.",
                  "Room for your next idea.",
                )}
              </h1>
              <p>
                {t(
                  "Pište, tvořte a mějte přehled o každém kroku.",
                  "Write, build, and keep every step in view.",
                )}
              </p>
              <div className="starters">
                {[
                  [
                    t("Připravit projekt", "Plan a project"),
                    t(
                      "Vytvoř stručný projektový plán a ulož ho do plan.md.",
                      "Create a concise project plan and save it to plan.md.",
                    ),
                  ],
                  [
                    t("Prozkoumat možnosti", "Explore tools"),
                    t(
                      "Jaké nástroje mám k dispozici? Vysvětli jejich použití.",
                      "Which tools are available? Explain how to use them.",
                    ),
                  ],
                  [
                    t("Začít dokument", "Start a document"),
                    t(
                      "Pomoz mi vytvořit strukturu nového dokumentu.",
                      "Help me outline a new document.",
                    ),
                  ],
                ].map(([label, prompt]) => (
                  <button
                    key={label}
                    onClick={() => {
                      setDraft(prompt);
                      textarea.current?.focus();
                    }}
                  >
                    <span className="starter-copy">
                      <strong>{label}</strong>
                      <span>{prompt}</span>
                    </span>
                    <span className="starter-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <ErrorBox error={sessionQuery.error} />
          {!historyComplete && (
            <p className="notice">
              {t(
                "Starší část historie nebyla serverem zachována.",
                "An older portion of this history was not retained by the server.",
              )}
            </p>
          )}
          {sessionQuery.isLoading && id && (
            <p>{t("Načítání konverzace…", "Loading conversation…")}</p>
          )}
          {events.map((event, index) => {
            const kind = event.kind ?? event.type ?? "event";
            const text = event.text ?? event.payload?.text ?? "";
            const isTool = kind.includes("tool") || kind === "decision";
            return (
              <article
                key={event.id ?? event.seq ?? index}
                className={
                  "message " +
                  (kind === "user" ? "user" : isTool ? "tool" : "assistant")
                }
              >
                <div className="message-label">
                  <span>
                    {kind === "user"
                      ? t("Vy", "You")
                      : kind === "assistant"
                        ? "VOID"
                        : kind}
                  </span>
                  <time>
                    {new Date(event.at).toLocaleTimeString(
                      t("cs-CZ", "en-GB"),
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </time>
                </div>
                {isTool ? (
                  <details className="tool-card">
                    <summary>
                      <span aria-hidden="true">⌘</span>{" "}
                      {event.payload?.tool ?? text.slice(0, 100) ?? kind}
                      <Badge value={event.payload?.status ?? kind} />
                    </summary>
                    <RichText text={text} />
                    {event.payload && (
                      <pre className="json">{json(event.payload)}</pre>
                    )}
                  </details>
                ) : (
                  <div className="prose">
                    <RichText text={text} />
                  </div>
                )}
                {text && (
                  <div className="message-actions">
                    <button onClick={() => navigator.clipboard.writeText(text)}>
                      {t("Kopírovat", "Copy")}
                    </button>
                    {(kind === "user" || kind === "assistant") && (
                      <button
                        disabled={running}
                        onClick={() => {
                          setRetry(false);
                          setBranch(event);
                          setEdited(kind === "user" ? text : "");
                        }}
                      >
                        {kind === "user"
                          ? t("Upravit ve větvi", "Edit as branch")
                          : t("Vytvořit větev", "Branch here")}
                      </button>
                    )}
                    {kind === "assistant" && (
                      <button
                        disabled={running || retryWait > 0}
                        onClick={() => {
                          const user = events
                            .slice(0, index)
                            .reverse()
                            .find((e) => e.kind === "user");
                          if (user) {
                            setBranch(user);
                            setEdited(user.text);
                            setRetry(true);
                          }
                        }}
                      >
                        {t("Zkusit znovu", "Retry")}
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {running && (
            <p className="run-status" role="status">
              <span className="activity-dot" />{" "}
              {session?.status === "cancelling"
                ? t(
                    "Zastavuji; odeslaný nástroj může ještě dokončit práci.",
                    "Stopping; an issued tool may still finish.",
                  )
                : t("Agent pracuje…", "Agent is working…")}
            </p>
          )}
        </div>
      </div>
      {newMessages && !follow && (
        <button className="new-messages" onClick={() => setFollow(true)}>
          {t("Nové zprávy ↓", "New messages ↓")}
        </button>
      )}
      <div className="composer-wrap">
        {retryWait > 0 && (
          <p className="notice" role="status">
            {t(
              "Limit poskytovatele. Další pokus za",
              "Provider rate limit. Retry in",
            )}{" "}
            {retryWait} s.
          </p>
        )}
        {(holds.data?.approvals ?? [])
          .filter(
            (a: Row) =>
              a.status === "pending" &&
              a.call?.workspace === session?.workspace,
          )
          .map((a: Row) => (
            <div className="inline-approval" key={a.holdId}>
              <span>
                {t("Vyžaduje rozhodnutí", "Needs a decision")}:{" "}
                <strong>{a.call?.tool}</strong>
              </span>
              <button onClick={() => setApproval(a)}>
                {t("Zkontrolovat a rozhodnout", "Review and decide")}
              </button>
            </div>
          ))}
        <ErrorBox error={error ?? provider.error} />
        {provider.data && !provider.data.connected && (
          <div className="notice">
            {t(
              "Připojte poskytovatele modelu pro zahájení konverzace.",
              "Connect a model provider to start a conversation.",
            )}{" "}
            <button onClick={() => navigate("/settings")}>
              {t("Připojit TokenRouter", "Connect TokenRouter")}
            </button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {attachments.length > 0 && (
            <div className="attachments">
              {attachments.map((a, i) => (
                <span key={a.name}>
                  {a.name} <small>{a.bytes} B</small>
                  <button
                    type="button"
                    aria-label={t("Odebrat přílohu", "Remove attachment")}
                    onClick={() =>
                      setAttachments(attachments.filter((_, n) => n !== i))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={textarea}
            aria-label={t("Zpráva", "Message")}
            placeholder={t("Co dnes vytvoříme?", "What shall we create today?")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              const enter =
                preferences.data?.preferences?.sendBehavior === "enter";
              if (
                e.key === "Enter" &&
                (e.metaKey ||
                  e.ctrlKey ||
                  (enter &&
                    !e.shiftKey &&
                    window.matchMedia("(min-width: 768px)").matches))
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-actions">
            <div>
              <label
                className="attach-button"
                title={t(
                  "Přiložit textový soubor do 24 KB",
                  "Attach a text file up to 24 KB",
                )}
              >
                ＋
                <span className="sr-only">
                  {t("Přiložit textový soubor", "Attach text file")}
                </span>
                <input
                  type="file"
                  accept=".txt,.md,.csv,.json,.ts,.js,.py,.css,.html,.yaml,.yml"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (
                      file.size + attachments.reduce((n, a) => n + a.bytes, 0) >
                      24576
                    ) {
                      setError(
                        t(
                          "Přílohy mohou mít dohromady nejvýše 24 KB.",
                          "Attachments may total at most 24 KB.",
                        ),
                      );
                      return;
                    }
                    setAttachments([
                      ...attachments,
                      {
                        name: file.name,
                        content: await file.text(),
                        bytes: file.size,
                      },
                    ]);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!id}
                onClick={() => setContextPicker(true)}
                aria-label={t(
                  "Přiložit dokument z konverzace",
                  "Attach conversation document",
                )}
              >
                ▤
              </button>
              <button
                className="model-button"
                type="button"
                disabled={!!id}
                onClick={() => setPicker(true)}
              >
                {(session?.model ?? model) === "z-ai/glm-5.3-free"
                  ? "GLM 5.3 Free"
                  : (session?.model ?? model)}
                <span aria-hidden="true">⌄</span>
              </button>
            </div>
            {running ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/api/sessions/" + id, "DELETE");
                    await client.invalidateQueries();
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("Zastavit ■", "Stop ■")}
              </button>
            ) : (
              <button
                className="primary send"
                disabled={
                  busy ||
                  !draft.trim() ||
                  !provider.data?.connected ||
                  retryWait > 0
                }
                aria-label={t("Odeslat zprávu", "Send message")}
              >
                {busy ? "…" : "↑"}
              </button>
            )}
          </div>
        </form>
        <div className="composer-footnote">
          <span>{providerLabel}</span>
          <span>
            {(session?.agent ?? preferences.data?.preferences?.defaultAgent) ===
            "prime-agent"
              ? "prime-agent · Local PC"
              : "VOID Cloud"}
          </span>
          <button onClick={onContext}>
            {t("Dokumenty a kontext", "Documents and context")}
          </button>
          <span>
            {t("Důležité výstupy vždy ověřte.", "Verify important results.")}
          </span>
        </div>
      </div>
      {contextPicker && (
        <Dialog
          title={t("Přiložit dokument", "Attach document")}
          close={() => setContextPicker(false)}
        >
          <p>
            {t(
              "Do zprávy se přiloží aktuální obsah dokumentu.",
              "The current document content is attached to the message.",
            )}
          </p>
          {Object.entries(workspace.data?.workspace?.files ?? {}).map(
            ([name, value]) => (
              <button
                key={name}
                onClick={() => {
                  const content = String(value);
                  const bytes = new TextEncoder().encode(content).length;
                  if (
                    bytes + attachments.reduce((n, a) => n + a.bytes, 0) >
                    24576
                  ) {
                    setError(
                      t("Kontext přesahuje 24 KB.", "Context exceeds 24 KB."),
                    );
                    setContextPicker(false);
                    return;
                  }
                  setAttachments([...attachments, { name, content, bytes }]);
                  setContextPicker(false);
                }}
              >
                {name}
              </button>
            ),
          )}
        </Dialog>
      )}
      {approval && (
        <ApprovalReview
          record={approval}
          close={() => setApproval(undefined)}
        />
      )}
      {picker && (
        <Dialog
          title={t("Vybrat model", "Choose model")}
          close={() => setPicker(false)}
        >
          <input
            autoFocus
            type="search"
            aria-label={t("Hledat model", "Search models")}
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            placeholder={t("Hledat model…", "Search models…")}
          />
          <div className="model-list">
            {catalog
              .filter((m) =>
                (m.name + " " + m.id)
                  .toLowerCase()
                  .includes(modelSearch.toLowerCase()),
              )
              .sort(
                (a, b) =>
                  Number(favorites.includes(b.id)) -
                  Number(favorites.includes(a.id)),
              )
              .map((m) => (
                <div className="model-choice" key={m.id}>
                  <button
                    onClick={() => {
                      setModel(m.id);
                      setPicker(false);
                    }}
                  >
                    <strong>{m.name ?? m.id}</strong>
                    <small>{m.id}</small>
                    {m.id === model && <span>✓</span>}
                  </button>
                  <button
                    aria-label={t("Oblíbený model", "Favorite model")}
                    aria-pressed={favorites.includes(m.id)}
                    onClick={() => {
                      const next = favorites.includes(m.id)
                        ? favorites.filter((f) => f !== m.id)
                        : [...favorites, m.id];
                      setFavorites(next);
                      localStorage.setItem("void-model-favorites", json(next));
                    }}
                  >
                    {favorites.includes(m.id) ? "★" : "☆"}
                  </button>
                </div>
              ))}
          </div>
        </Dialog>
      )}
      {branch && (
        <Dialog
          title={t("Nová větev konverzace", "New conversation branch")}
          close={() => setBranch(undefined)}
        >
          <p>
            {t(
              "Původní historie zůstane zachovaná. Dřívější nástroje se znovu nespustí.",
              "Original history stays intact. Previous tools will not run again.",
            )}
          </p>
          {branch.kind === "user" && (
            <textarea
              aria-label={t("Upravená zpráva", "Edited message")}
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
              rows={6}
            />
          )}
          {retry && (
            <p>
              {t(
                "Nová odpověď může použít nástroje. Zkontrolujte zprávu před spuštěním.",
                "The new response may use tools. Review the message before running.",
              )}
            </p>
          )}
          <ErrorBox error={error} />
          <button
            className="primary"
            disabled={busy || retryWait > 0}
            onClick={fork}
          >
            {retry
              ? t("Vytvořit větev a zkusit znovu", "Create branch and retry")
              : t("Vytvořit větev", "Create branch")}
          </button>
        </Dialog>
      )}
    </section>
  );
}
