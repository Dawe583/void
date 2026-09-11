import { BrandMark } from "./brand";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError, download, items, json } from "./api";
import { Badge, Dialog, ErrorBox, Locale, useApi, useText } from "./ui";
import { Chat } from "./chat";
import { Documents } from "./documents";
import { Approvals, Ledger, Models, Overview, Runs, Sessions } from "./pages";
import { Connections, Settings } from "./settings";
import "./styles.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000, refetchOnWindowFocus: true } },
});
const routes = [
  ["chat", "◇", "Chat", "Chat"],
  ["overview", "◫", "Přehled", "Overview"],
  ["sessions", "≡", "Konverzace", "Conversations"],
  ["runs", "⌁", "Běhy a aktivita", "Runs and activity"],
  ["documents", "▤", "Dokumenty", "Documents"],
  ["approvals", "◈", "Schvalování", "Approvals"],
  ["ledger", "▦", "Ledger", "Ledger"],
  ["connections", "⌘", "Nástroje a konektory", "Tools and connections"],
  ["models", "◎", "Modely a spotřeba", "Models and usage"],
  ["settings", "⚙", "Nastavení", "Settings"],
];
function Root() {
  const [locale, setLocale] = useState<"cs" | "en">(() =>
    localStorage.getItem("void-locale") === "cs" ? "cs" : "en",
  );
  useEffect(() => {
    localStorage.setItem("void-locale", locale);
    document.documentElement.lang = locale;
    document.title =
      locale === "en" ? "VOID — Workspace" : "VOID — Pracovní prostor";
  }, [locale]);
  return (
    <Locale value={locale}>
      <App locale={locale} setLocale={setLocale} />
    </Locale>
  );
}
function App({
  locale,
  setLocale,
}: {
  locale: "cs" | "en";
  setLocale: (s: "cs" | "en") => void;
}) {
  const t = useText();
  const contextRef = useRef<HTMLElement>(null),
    sidebarRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(
      () => Number(localStorage.getItem("void-sidebar-width")) || 248,
    ),
    [contextWidth, setContextWidth] = useState(
      () => Number(localStorage.getItem("void-context-width")) || 360,
    );
  const [path, setPath] = useState(location.pathname),
    [drawer, setDrawer] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [context, setContext] = useState(false),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [appearance, setAppearance] = useState(
      () => localStorage.getItem("void-appearance") ?? "system",
    ),
    [online, setOnline] = useState(navigator.onLine),
    [token, setToken] = useState(""),
    [error, setError] = useState<unknown>(),
    [connecting, setConnecting] = useState(false);
  const [motion, setMotion] = useState(
    () => localStorage.getItem("void-motion") !== "off",
  );
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? "on" : "off";
    localStorage.setItem("void-motion", motion ? "on" : "off");
  }, [motion]);
  const provider = useApi("/api/provider");
  const prefs = useApi("/api/preferences");
  const initialPreferences = useRef({
    appearance: !localStorage.getItem("void-appearance"),
    locale: !localStorage.getItem("void-locale"),
  });
  useEffect(() => {
    const value = prefs.data?.preferences;
    if (!value) return;
    if (initialPreferences.current.appearance && value.appearance)
      setAppearance(value.appearance);
    if (
      initialPreferences.current.locale &&
      ["cs", "en"].includes(value.locale)
    )
      setLocale(value.locale);
    initialPreferences.current = { appearance: false, locale: false };
  }, [prefs.data, setLocale]);
  const sessions = useApi("/api/sessions?archived=false&limit=20");
  const approvals = useApi("/api/approvals");
  const history = useApi(
    "/api/sessions?q=" + encodeURIComponent(query) + "&limit=50",
    search,
  );
  const [page, sessionId] = path.replace(/^\//, "").split("/");
  const active = routes.find((r) => r[0] === page) ?? routes[0];
  const chatId =
    page === "chat" && sessionId && sessionId !== "new" ? sessionId : undefined;
  const currentDetail = useApi(
    "/api/sessions/" + chatId + "?events=false",
    !!chatId,
  );
  const current =
    currentDetail.data?.session ??
    items(sessions.data, "sessions").find((s) => s.id === chatId);
  const pending = items(approvals.data, "approvals").filter(
    (a) => a.status === "pending",
  ).length;
  function navigate(next: string) {
    const params = new URLSearchParams();
    const workspace = new URLSearchParams(location.search).get("workspace");
    if (workspace) params.set("workspace", workspace);
    const suffix = params.size ? "?" + params : "";
    historyPush(next + suffix);
    setPath(next);
    setDrawer(false);
    setSearch(false);
    setContext(false);
  }
  function historyPush(next: string) {
    window.history.pushState({}, "", next);
  }
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("void-appearance", appearance);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const dark =
        appearance === "dark" || (appearance === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#12100a" : "#f6f0e3");
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [appearance]);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if (e.key === "Escape") {
        setDrawer(false);
        setContext(false);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    const mobile = matchMedia("(max-width:767px)").matches;
    const panel = drawer
      ? sidebarRef.current
      : context && mobile
        ? contextRef.current
        : null;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button,a[href],input,select,textarea,[tabindex="0"]',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", trap);
    return () => {
      panel.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [drawer, context]);
  const needsAuth =
    provider.error instanceof ApiError &&
    (provider.error.status === 401 || provider.error.status === 403);
  return (
    <div
      style={
        {
          "--sidebar-width": sidebarWidth + "px",
          "--context-width": contextWidth + "px",
        } as CSSProperties
      }
      className={
        "shell " +
        (collapsed ? "collapsed " : "") +
        (drawer ? "drawer-open" : "")
      }
    >
      <a href="#main" className="skip-link">
        {t("Přejít na obsah", "Skip to content")}
      </a>
      {drawer && (
        <button
          className="scrim"
          aria-label={t("Zavřít menu", "Close menu")}
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className="sidebar"
        aria-label={t("Hlavní navigace", "Main navigation")}
      >
        <div className="brand">
          <a
            href="/chat/new"
            onClick={(e) => {
              e.preventDefault();
              navigate("/chat/new");
            }}
          >
            <BrandMark className="brand-mark" />
            <strong>VOID</strong>
          </a>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={t("Sbalit navigaci", "Collapse navigation")}
          >
            ⇤
          </button>
          <button
            className="drawer-close"
            onClick={() => setDrawer(false)}
            aria-label={t("Zavřít menu", "Close menu")}
          >
            ×
          </button>
        </div>
        <p className="workspace-name">
          {new URLSearchParams(location.search).get("workspace") ??
            t("Osobní prostor", "Personal workspace")}
        </p>
        <button className="new-chat" onClick={() => navigate("/chat/new")}>
          <span>＋</span>
          <span>{t("Nová konverzace", "New conversation")}</span>
        </button>
        <button className="search-button" onClick={() => setSearch(true)}>
          <span>⌕</span>
          <span>{t("Hledat", "Search")}</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav>
          {routes.slice(1, -1).map(([slug, icon, cs, en]) => (
            <a
              key={slug}
              href={"/" + slug}
              onClick={(e) => {
                e.preventDefault();
                navigate("/" + slug);
              }}
              className={page === slug ? "active" : ""}
              aria-current={page === slug ? "page" : undefined}
              title={t(cs, en)}
            >
              <span className="nav-icon" aria-hidden="true">
                {icon}
              </span>
              <span>{t(cs, en)}</span>
              {slug === "approvals" && pending > 0 && (
                <span className="count">{pending}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="recent">
          <h2>{t("Nedávné konverzace", "Recent conversations")}</h2>
          {items(sessions.data, "sessions").map((s) => (
            <a
              className={chatId === s.id ? "active" : ""}
              key={s.id}
              href={"/chat/" + s.id}
              onClick={(e) => {
                e.preventDefault();
                navigate("/chat/" + s.id);
              }}
              title={s.title ?? s.model}
            >
              <span aria-hidden="true">
                {s.status === "running" ? "[>]" : s.pinned ? "⌖" : "·"}
              </span>
              <span>{s.title ?? s.model}</span>
            </a>
          ))}
          {!items(sessions.data, "sessions").length && (
            <p className="muted">
              {t(
                "Vaše práce začíná novou konverzací.",
                "Your work starts with a new conversation.",
              )}
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <details className="panel-size">
            <summary>{t("Šířka panelu", "Panel width")}</summary>
            <label>
              {t("Navigace", "Navigation")}
              <input
                type="range"
                min="216"
                max="300"
                step="8"
                value={sidebarWidth}
                onChange={(e) => {
                  setSidebarWidth(Number(e.target.value));
                  localStorage.setItem("void-sidebar-width", e.target.value);
                }}
              />
            </label>
          </details>
          <a
            href="/settings"
            onClick={(e) => {
              e.preventDefault();
              navigate("/settings");
            }}
          >
            <span aria-hidden="true">⚙</span>
            <span>{t("Nastavení", "Settings")}</span>
          </a>
          <div className="connection">
            <span
              className={
                online && provider.data?.connected
                  ? "connected-dot"
                  : "disconnected-dot"
              }
            />
            <span>
              {!online
                ? t("Offline", "Offline")
                : provider.isLoading
                  ? t("Připojuji…", "Connecting…")
                  : provider.data?.connected
                    ? t("Poskytovatel připojen", "Provider connected")
                    : t("Nastavit připojení", "Set up connection")}
            </span>
          </div>
        </div>
      </aside>
      <main id="main" tabIndex={-1} inert={drawer}>
        <header
          className="topbar"
          inert={context && matchMedia("(max-width:767px)").matches}
        >
          <button
            className="menu-toggle"
            onClick={() => setDrawer(true)}
            aria-label={t("Otevřít menu", "Open menu")}
          >
            ☰
          </button>
          <div className="page-title">
            <span>
              {page === "chat" || path === "/"
                ? (current?.title ?? t("Nová konverzace", "New conversation"))
                : t(active[2], active[3])}
            </span>
            {current && <Badge value={current.status} />}
          </div>
          <div className="header-actions">
            <button
              className="locale-toggle"
              title={t("Přepnout do angličtiny", "Switch to Czech")}
              aria-label={t("Přepnout do angličtiny", "Switch to Czech")}
              onClick={() => {
                const next = locale === "cs" ? "en" : "cs";
                setLocale(next);
                if (!needsAuth)
                  void api("/api/preferences", "PATCH", { locale: next }).catch(
                    setError,
                  );
              }}
            >
              {locale === "cs" ? "EN" : "CS"}
            </button>
            <button
              className="theme-toggle"
              aria-label={t("Přepnout vzhled", "Toggle theme")}
              onClick={() =>
                setAppearance(
                  document.documentElement.dataset.theme === "dark"
                    ? "light"
                    : "dark",
                )
              }
            >
              ◐
            </button>
            <button
              className="motion-toggle"
              aria-label={t("Animace", "Animations")}
              title={t(
                "Zapnout nebo vypnout animace",
                "Turn animations on or off",
              )}
              aria-pressed={motion}
              onClick={() => setMotion(!motion)}
            >
              ⌁
            </button>
            {chatId && (
              <button
                onClick={async () => {
                  try {
                    const result = await api("/api/sessions/" + chatId);
                    download(
                      "void-" + chatId + ".json",
                      json(result.session),
                      "application/json",
                    );
                  } catch (e) {
                    setError(e);
                  }
                }}
                aria-label={t("Export konverzace", "Export conversation")}
              >
                ⇩
              </button>
            )}
            <button
              onClick={() => setContext(!context)}
              aria-expanded={context}
              aria-label={t("Otevřít kontext", "Open context")}
            >
              ◧ <span>{t("Kontext", "Context")}</span>
            </button>
          </div>
        </header>
        {!online && (
          <div className="offline" role="status">
            {t(
              "Jste offline. Koncept zůstává uložený v této kartě.",
              "You are offline. Your draft is preserved in this tab.",
            )}
          </div>
        )}
        <ErrorBox error={error} />
        {needsAuth ? (
          <div className="connection-gate">
            <BrandMark className="gate-logo" />
            <h1>
              {t("Připojte svůj pracovní prostor.", "Connect your workspace.")}
            </h1>
            <p>
              {t(
                "Zadejte přístupový token pro tento server.",
                "Enter the access token for this server.",
              )}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setConnecting(true);
                setError(undefined);
                try {
                  await api("/api/session", "POST", { token });
                  setToken("");
                  await queryClient.invalidateQueries();
                } catch (e) {
                  setError(e);
                } finally {
                  setConnecting(false);
                }
              }}
            >
              <label>
                {t("Přístupový token", "Access token")}
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <button className="primary" disabled={connecting}>
                {t("Připojit", "Connect")}
              </button>
            </form>
          </div>
        ) : (
          <div className={"work-area " + (context ? "with-context" : "")}>
            {page === "chat" || path === "/" ? (
              <div
                className="chat-container"
                inert={context && matchMedia("(max-width:767px)").matches}
              >
                <Chat
                  key={chatId ?? "new"}
                  id={chatId}
                  navigate={navigate}
                  onContext={() => setContext(true)}
                />
              </div>
            ) : (
              <div
                key={page}
                className="page-content"
                inert={context && matchMedia("(max-width:767px)").matches}
              >
                <h1>{t(active[2], active[3])}</h1>
                {page === "overview" ? (
                  <Overview navigate={navigate} />
                ) : page === "sessions" ? (
                  <Sessions navigate={navigate} />
                ) : page === "runs" ? (
                  <Runs navigate={navigate} />
                ) : page === "documents" ? (
                  <Documents />
                ) : page === "approvals" ? (
                  <Approvals />
                ) : page === "ledger" ? (
                  <Ledger />
                ) : page === "connections" ? (
                  <Connections />
                ) : page === "models" ? (
                  <Models />
                ) : page === "settings" ? (
                  <Settings
                    appearance={appearance}
                    setAppearance={setAppearance}
                    locale={locale}
                    setLocale={setLocale}
                  />
                ) : (
                  <p>{t("Stránka nenalezena.", "Page not found.")}</p>
                )}
              </div>
            )}
            {context && (
              <aside
                ref={contextRef}
                className="context-panel"
                role={
                  matchMedia("(max-width:767px)").matches ? "dialog" : undefined
                }
                aria-modal={
                  matchMedia("(max-width:767px)").matches ? true : undefined
                }
                aria-label={t("Kontext", "Context")}
              >
                <div className="dialog-heading">
                  <h2>{t("Kontext", "Context")}</h2>
                  <button
                    aria-label={t("Zavřít kontext", "Close context")}
                    onClick={() => setContext(false)}
                  >
                    ×
                  </button>
                </div>
                <label className="panel-size">
                  {t("Šířka kontextu", "Context width")}
                  <input
                    type="range"
                    min="320"
                    max="520"
                    step="8"
                    value={contextWidth}
                    onChange={(e) => {
                      setContextWidth(Number(e.target.value));
                      localStorage.setItem(
                        "void-context-width",
                        e.target.value,
                      );
                    }}
                  />
                </label>
                {chatId ? (
                  <>
                    <p className="muted">
                      {t(
                        "Dokumenty této konverzace",
                        "Documents in this conversation",
                      )}
                    </p>
                    <Documents sessionId={chatId} />
                    <button onClick={() => navigate("/ledger")}>
                      {t("Otevřít ledger", "Open ledger")}
                    </button>
                  </>
                ) : (
                  <p>
                    {t(
                      "Otevřete konverzaci pro zobrazení dokumentů a změn.",
                      "Open a conversation to see its documents and changes.",
                    )}
                  </p>
                )}
              </aside>
            )}
          </div>
        )}
        <nav
          inert={context}
          className="mobile-nav"
          aria-label={t("Mobilní navigace", "Mobile navigation")}
        >
          {[
            ["/chat/new", "◇", t("Chat", "Chat")],
            ["/overview", "◫", t("Přehled", "Overview")],
            ["/approvals", "◈", t("Schválení", "Approvals")],
          ].map(([href, icon, label]) => (
            <a
              key={href}
              href={href}
              onClick={(e) => {
                e.preventDefault();
                navigate(href);
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {href === "/approvals" && pending > 0 ? " " + pending : ""}
            </a>
          ))}
          <button onClick={() => setDrawer(true)}>
            <span aria-hidden="true">≡</span>
            {t("Více", "More")}
          </button>
        </nav>
      </main>
      {search && (
        <Dialog
          title={t("Hledat konverzaci", "Find a conversation")}
          close={() => setSearch(false)}
        >
          <input
            autoFocus
            type="search"
            placeholder={t("Název nebo obsah…", "Title or content…")}
            aria-label={t("Hledat konverzaci", "Find a conversation")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ErrorBox error={history.error} />
          <div className="search-results">
            {items(history.data, "sessions").map((s) => (
              <button key={s.id} onClick={() => navigate("/chat/" + s.id)}>
                <strong>{s.title ?? s.model}</strong>
                <Badge value={s.status} />
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Root />
  </QueryClientProvider>,
);
