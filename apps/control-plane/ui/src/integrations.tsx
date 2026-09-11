import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Row } from "./api";
import { Badge, ErrorBox, useApi, useText } from "./ui";

function useIntegrations(enabled = true) {
  return useApi("/api/integrations", enabled, 30000, false);
}
function cloudOnly(error: unknown, data?: Row) {
  return (
    (error instanceof ApiError && error.status === 404) ||
    data?.supported === false
  );
}
function CloudNotice() {
  const t = useText();
  return (
    <p className="notice">
      {t(
        "OAuth připojení jsou dostupná v cloudové aplikaci. Lokální runtime používá níže nastavené MCP konektory.",
        "OAuth connections are available in the cloud app. The local runtime uses the MCP connectors configured below.",
      )}
    </p>
  );
}
function statusLabel(integration: Row, t: ReturnType<typeof useText>) {
  if (integration.connected) return t("Připojeno", "Connected");
  if (!integration.configured) return t("Vyžaduje nastavení", "Setup required");
  if (integration.status === "disconnected")
    return t("Odpojeno", "Disconnected");
  if (["expired", "reauthorization_required"].includes(integration.status))
    return t("Přihlásit znovu", "Reconnect");
  return t("Připraveno k přihlášení", "Ready to connect");
}
export function Integrations() {
  const t = useText(),
    client = useQueryClient(),
    query = useIntegrations();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState<{
      kind: "refreshed" | "disconnected" | "configured";
      name: string;
      count?: number;
    }>();
  const [callbackStatus, setCallbackStatus] = useState(() => {
    const value = new URLSearchParams(location.search).get("oauth");
    return value && ["connected", "denied", "failed"].includes(value)
      ? value
      : null;
  });
  const rows: Row[] = Array.isArray(query.data?.integrations)
    ? query.data.integrations
    : [];
  async function action(
    integration: Row,
    kind: "start" | "refresh" | "disconnect",
  ) {
    setBusy(integration.id);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await api(
        "/api/integrations/" +
          encodeURIComponent(integration.id) +
          (kind === "disconnect" ? "" : "/" + kind),
        kind === "disconnect" ? "DELETE" : "POST",
      );
      if (kind === "start") {
        const url = new URL(result.url);
        if (url.protocol !== "https:")
          throw new Error(
            t(
              "Server vrátil neplatnou adresu přihlášení.",
              "The server returned an invalid authorization URL.",
            ),
          );
        window.location.assign(url.href);
        return;
      }
      setNotice({
        kind: kind === "refresh" ? "refreshed" : "disconnected",
        name: integration.name,
        count: result.toolCount,
      });
      await client.invalidateQueries({ queryKey: ["/api/integrations"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="integrations" aria-labelledby="integrations-title">
      <div className="integration-intro">
        <div>
          <h2 id="integrations-title">
            {t("Připojené účty", "Connected accounts")}
          </h2>
          <p>
            {t(
              "Připojte GitHub, Vercel a Supabase a zpřístupněte jejich nástroje agentovi.",
              "Connect GitHub, Vercel, and Supabase to make their tools available to the agent.",
            )}
          </p>
        </div>
        <button disabled={query.isFetching} onClick={() => query.refetch()}>
          {t("Obnovit stav", "Refresh status")}
        </button>
      </div>
      {callbackStatus && (
        <div
          className={callbackStatus === "connected" ? "notice" : "error"}
          role={callbackStatus === "connected" ? "status" : "alert"}
        >
          {callbackStatus === "connected"
            ? t(
                "Účet byl připojen. Nástroje jsou dostupné pro nové konverzace; otevřenou konverzaci aktualizujte v panelu Kontext.",
                "Account connected. Tools are available to new conversations; update an open conversation from its Context panel.",
              )
            : callbackStatus === "denied"
              ? t(
                  "Přístup nebyl udělen. Připojení můžete zkusit znovu.",
                  "Access was not granted. You can try connecting again.",
                )
              : t(
                  "Připojení účtu se nepodařilo dokončit. Zkontrolujte nastavení OAuth aplikace a zkuste to znovu.",
                  "Account connection could not be completed. Check the OAuth app settings and try again.",
                )}{" "}
          <button
            aria-label={t("Skrýt oznámení", "Dismiss notification")}
            onClick={() => {
              setCallbackStatus(null);
              const url = new URL(location.href);
              url.searchParams.delete("oauth");
              window.history.replaceState(window.history.state, "", url);
            }}
          >
            ×
          </button>
        </div>
      )}
      {cloudOnly(query.error, query.data) ? (
        <CloudNotice />
      ) : (
        <>
          <ErrorBox error={query.error ?? error} />
          {query.isLoading && (
            <p role="status">
              {t("Načítání připojení…", "Loading connections…")}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice.name}:{" "}
              {notice.kind === "refreshed"
                ? t("Katalog nástrojů obnoven", "Tool catalog refreshed")
                : notice.kind === "configured"
                  ? t(
                      "OAuth aplikace nastavena. Pokračujte přihlášením.",
                      "OAuth app configured. Continue by connecting your account.",
                    )
                  : t(
                      "Účet odpojen. Aktualizujte nástroje v otevřené konverzaci.",
                      "Account disconnected. Update the tools in your open conversation.",
                    )}
              {notice.count !== undefined ? " (" + notice.count + ")" : ""}
            </p>
          )}
          <div className="integration-grid">
            {rows.map((integration) => (
              <article className="integration-card" key={integration.id}>
                <header>
                  <h3>{integration.name}</h3>
                  <Badge value={statusLabel(integration, t)} />
                </header>
                <p>
                  {integration.description ??
                    t(
                      "Nástroje poskytovatele dostupné po přihlášení.",
                      "Provider tools are available after you connect.",
                    )}
                </p>
                {integration.connected && (
                  <p className="muted">
                    {integration.toolCount ?? integration.tools?.length ?? "—"}{" "}
                    {t("nástrojů", "tools")}
                    {integration.connectedAt
                      ? " · " +
                        new Date(integration.connectedAt).toLocaleString(
                          t("cs-CZ", "en-GB"),
                        )
                      : ""}
                  </p>
                )}
                <div className="actions">
                  {integration.connected ? (
                    <>
                      <button
                        disabled={!!busy}
                        onClick={() => action(integration, "refresh")}
                      >
                        {busy === integration.id
                          ? t("Pracuji…", "Working…")
                          : t("Obnovit nástroje", "Refresh tools")}
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => action(integration, "disconnect")}
                      >
                        {t("Odpojit", "Disconnect")}
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={!!busy || !integration.configured}
                      onClick={() => action(integration, "start")}
                    >
                      {busy === integration.id
                        ? t("Otevírám přihlášení…", "Opening authorization…")
                        : t("Připojit účet", "Connect account")}
                    </button>
                  )}
                </div>
                {integration.connected && (
                  <details>
                    <summary>
                      {t("Oprávnění a nástroje", "Permissions and tools")}
                    </summary>
                    <p className="muted">
                      {t("Oprávnění", "Permissions")}:{" "}
                      {Array.isArray(integration.scopes)
                        ? integration.scopes.join(", ")
                        : integration.scopes ||
                          t(
                            "Poskytovatel rozsah neuvádí",
                            "Not reported by the provider",
                          )}
                    </p>
                    <ul className="integration-tool-list">
                      {(integration.tools ?? []).map((tool: string) => (
                        <li key={tool}>
                          <code>{tool}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {["github", "vercel"].includes(integration.id) && (
                  <ClientSetup
                    integration={integration}
                    callbackBase={query.data?.callbackBase}
                    disabled={!!busy}
                    onSaved={async () => {
                      setNotice({ kind: "configured", name: integration.name });
                      await client.invalidateQueries({
                        queryKey: ["/api/integrations"],
                      });
                    }}
                  />
                )}
                {!integration.configured &&
                  !["github", "vercel"].includes(integration.id) && (
                    <p className="muted">
                      {t(
                        "Registrace OAuth aplikace na serveru zatím není dokončená.",
                        "Server OAuth app registration is not complete yet.",
                      )}
                    </p>
                  )}
              </article>
            ))}
          </div>
          {rows.length > 0 && (
            <p className="integration-policy">
              {t(
                "Výslovně povolené nástroje pouze pro čtení jsou R0. Zápisy, neznámé nástroje a nástroje s více metodami jsou R3 a vyžadují schválení. Externí nástroje nemají automatické Undo; agent si kontext načítá na vyžádání.",
                "Explicitly allowlisted read-only tools are R0. Write, unknown, and multi-method tools are R3 and require approval. External tools have no automatic Undo; the agent retrieves context on demand.",
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
function ClientSetup({
  integration,
  callbackBase,
  disabled,
  onSaved,
}: {
  integration: Row;
  callbackBase?: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const t = useText();
  const [integrationSlug, setIntegrationSlug] = useState(
    String(integration.integrationSlug ?? ""),
  );
  const [clientId, setClientId] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const callback = callbackBase
    ? callbackBase.replace(/\/$/, "") + "/" + integration.id + "/callback"
    : undefined;
  return (
    <details
      className="integration-setup"
      onToggle={(e) => {
        if (!e.currentTarget.open) setSecret("");
      }}
    >
      <summary>
        {integration.configured
          ? t("Upravit OAuth aplikaci", "Edit OAuth app")
          : t("Nastavit OAuth aplikaci", "Set up OAuth app")}
      </summary>
      <p>
        {integration.id === "vercel"
          ? t(
              "Ve Vercelu zaregistrujte připojitelnou integraci pro přístup k platformě. Sign in with Vercel slouží pouze k ověření identity a pro toto připojení není vhodné. Níže vložte slug a OAuth údaje integrace.",
              "Register a Vercel connectable integration for platform access. Sign in with Vercel provides identity authentication and cannot be used for this connection. Enter the integration slug and OAuth credentials below.",
            )
          : t(
              "Správce nejprve zaregistruje OAuth aplikaci poskytovatele. Přístup k účtu pak potvrdíte samostatně.",
              "An administrator first registers an OAuth app with the provider. You then authorize account access separately.",
            )}
      </p>
      <a
        href={
          integration.id === "github"
            ? "https://github.com/settings/developers"
            : "https://vercel.com/docs/integrations/create-integration"
        }
        target="_blank"
        rel="noopener noreferrer"
      >
        {integration.id === "github"
          ? t("Otevřít GitHub OAuth aplikace", "Open GitHub OAuth apps")
          : t("Registrace integrace Vercel", "Register a Vercel integration")}
      </a>
      {callback && (
        <label>
          {t("Adresa zpětného přesměrování", "Callback URL")}
          <input readOnly value={callback} onFocus={(e) => e.target.select()} />
        </label>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            await api(
              "/api/integrations/" +
                encodeURIComponent(integration.id) +
                "/client",
              "POST",
              {
                clientId: clientId.trim(),
                clientSecret: secret,
                ...(integration.id === "vercel"
                  ? { integrationSlug: integrationSlug.trim() }
                  : {}),
              },
            );
            setClientId("");
            await onSaved();
          } catch (e) {
            setError(e);
          } finally {
            setSecret("");
            setBusy(false);
          }
        }}
      >
        {integration.id === "vercel" && (
          <label>
            {t("Slug integrace", "Integration slug")}
            <input
              value={integrationSlug}
              onChange={(e) => setIntegrationSlug(e.target.value)}
              required
              maxLength={80}
              pattern="([a-z0-9]|-){1,80}"
              title={t(
                "1–80 malých písmen a–z, číslic nebo pomlček.",
                "1–80 lowercase letters a–z, digits, or hyphens.",
              )}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
            />
          </label>
        )}
        <label>
          Client ID
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            required
            disabled={busy}
          />
        </label>
        <label>
          Client secret
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </label>
        <p className="muted">
          {t(
            "Klíč se ukládá šifrovaně na serveru, nikoli do úložiště prohlížeče.",
            "The secret is stored encrypted on the server, not in browser storage.",
          )}
        </p>
        <ErrorBox error={error} />
        <button disabled={disabled || busy || !callback} type="submit">
          {busy
            ? t("Ukládám…", "Saving…")
            : t("Uložit OAuth aplikaci", "Save OAuth app")}
        </button>
      </form>
    </details>
  );
}
export function IntegrationContext({
  sessionId,
  status,
  onManage,
}: {
  sessionId?: string;
  status?: string;
  onManage: () => void;
}) {
  const t = useText(),
    client = useQueryClient();
  const query = useIntegrations();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [updated, setUpdated] = useState(false);
  const connected: Row[] = (query.data?.integrations ?? []).filter(
    (integration: Row) => integration.connected,
  );
  const idle = status === "idle";
  return (
    <section className="integration-context">
      <h3>{t("Připojené služby", "Connected services")}</h3>
      {cloudOnly(query.error, query.data) ? (
        <p className="muted">
          {t(
            "OAuth je dostupný v cloudové aplikaci.",
            "OAuth is available in the cloud app.",
          )}
        </p>
      ) : (
        <>
          <ErrorBox error={query.error ?? error} />
          {query.isLoading ? (
            <p>{t("Načítání…", "Loading…")}</p>
          ) : connected.length ? (
            <ul>
              {connected.map((integration) => (
                <li key={integration.id}>
                  <strong>{integration.name}</strong>
                  <span>
                    {integration.toolCount ?? integration.tools?.length ?? "—"}{" "}
                    {t("nástrojů", "tools")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {t("Zatím žádné připojené účty.", "No connected accounts yet.")}
            </p>
          )}
          {sessionId && (
            <>
              <button
                disabled={busy || !idle}
                onClick={async () => {
                  setBusy(true);
                  setError(undefined);
                  setUpdated(false);
                  try {
                    await api(
                      "/api/sessions/" +
                        encodeURIComponent(sessionId) +
                        "/integrations",
                      "POST",
                    );
                    await client.invalidateQueries({
                      queryKey: [
                        "/api/sessions/" + sessionId + "?events=false",
                      ],
                    });
                    setUpdated(true);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? t("Aktualizuji…", "Updating…")
                  : t(
                      "Aktualizovat nástroje konverzace",
                      "Update conversation tools",
                    )}
              </button>
              {!idle && (
                <p className="muted">
                  {t(
                    "Nástroje lze obnovit, až bude konverzace neaktivní.",
                    "Tools can be updated when the conversation is idle.",
                  )}
                </p>
              )}
              {updated && (
                <p role="status">
                  {t(
                    "Nástroje konverzace byly aktualizovány.",
                    "Conversation tools updated.",
                  )}
                </p>
              )}
            </>
          )}
        </>
      )}
      <button onClick={onManage}>
        {t("Spravovat připojení", "Manage connections")}
      </button>
      <p className="muted">
        {t(
          "Povolené čtení je R0. Zápisy, neznámé nástroje a nástroje s více metodami jsou R3 a vyžadují schválení; automatické Undo není dostupné.",
          "Allowlisted reads are R0. Write, unknown, and multi-method tools are R3 and require approval; automatic Undo is unavailable.",
        )}
      </p>
    </section>
  );
}
