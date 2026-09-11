import { Integrations } from "./integrations";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, items, json, type Row } from "./api";
import { Badge, Dialog, ErrorBox, JsonDetail, useApi, useText } from "./ui";
export function Settings({
  appearance,
  setAppearance,
  locale,
  setLocale,
}: {
  appearance: string;
  setAppearance: (s: string) => void;
  locale: "cs" | "en";
  setLocale: (s: "cs" | "en") => void;
}) {
  const t = useText(),
    client = useQueryClient();
  const provider = useApi("/api/provider"),
    preferences = useApi("/api/preferences"),
    agents = useApi("/api/agents");
  const [baseUrl, setBaseUrl] = useState("https://api.tokenrouter.com/v1"),
    [kind, setKind] = useState("openai"),
    [key, setKey] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<"" | "connected" | "disconnected">("");
  async function preference(body: Row) {
    try {
      await api("/api/preferences", "PATCH", body);
      await client.invalidateQueries();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="settings">
      <section>
        <h2>{t("Váš pracovní prostor", "Your workspace")}</h2>
        {agents.data && (
          <>
            <label>
              {t("Výchozí agent", "Default agent")}
              <select
                value={preferences.data?.preferences?.defaultAgent ?? "cloud"}
                onChange={(e) => preference({ defaultAgent: e.target.value })}
              >
                <option value="cloud">VOID Cloud</option>
                <option value="prime-agent">prime-agent (local PC)</option>
              </select>
            </label>
            <p>
              prime-agent: {agents.data.prime?.online ? "Online" : "Offline"}
            </p>
            <p>
              {t(
                "PC musí být zapnuté. Lokální nástroje nemají automatické VOID Undo.",
                "Your PC must stay online. Local tools do not have automatic VOID Undo.",
              )}
            </p>
            <details>
              <summary>
                {t(
                  "Nakonfigurované lokální nástroje",
                  "Configured local tools",
                )}
              </summary>
              <ul>
                {(agents.data.prime?.tools ?? []).map((name: string) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <p>
                {t(
                  "Konfigurace není ověření přístupu. Služby mohou vyžadovat vlastní OAuth.",
                  "Configuration is not access verification. Services may require their own OAuth.",
                )}
              </p>
            </details>
          </>
        )}

        <label>
          {t("Vzhled", "Appearance")}
          <select
            value={appearance}
            onChange={(e) => {
              setAppearance(e.target.value);
              void preference({ appearance: e.target.value });
            }}
          >
            <option value="system">{t("Podle systému", "System")}</option>
            <option value="light">{t("Světlý", "Light")}</option>
            <option value="dark">{t("Tmavý", "Dark")}</option>
          </select>
        </label>
        <label>
          {t("Jazyk", "Language")}
          <select
            value={locale}
            onChange={(e) => {
              setLocale(e.target.value as "cs" | "en");
              void preference({ locale: e.target.value });
            }}
          >
            <option value="cs">{t("Čeština", "Czech")}</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {t("Odesílání na počítači", "Desktop send behavior")}
          <select
            value={preferences.data?.preferences?.sendBehavior ?? "mod-enter"}
            onChange={(e) => preference({ sendBehavior: e.target.value })}
          >
            <option value="mod-enter">⌘ / Ctrl + Enter</option>
            <option value="enter">Enter</option>
          </select>
        </label>
        <p className="muted">
          {t(
            "Na telefonu Enter vždy vloží nový řádek.",
            "On mobile, Enter always inserts a new line.",
          )}
        </p>
      </section>
      <section>
        <h2>{t("Poskytovatel modelu", "Model provider")}</h2>
        <Badge
          value={
            provider.data?.connected
              ? t("Připojeno", "Connected")
              : t("Nepřipojeno", "Disconnected")
          }
        />
        <p>{provider.data?.baseUrl}</p>
        <p className="muted">
          {t("Výchozí model", "Default model")}:{" "}
          {preferences.data?.preferences?.defaultModel ?? "z-ai/glm-5.3-free"}.{" "}
          {t(
            "Existující konverzace si ponechají původní nastavení.",
            "Existing conversations retain their settings.",
          )}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            setMessage("");
            try {
              await api("/api/provider", "POST", {
                baseUrl,
                kind,
                apiKey: key,
              });
              setMessage("connected");
              await client.invalidateQueries();
            } catch (e) {
              setError(e);
            } finally {
              setKey("");
              setBusy(false);
            }
          }}
        >
          {!!provider.data?.presets?.length && (
            <label>
              {t("Poskytovatel", "Provider")}
              <select
                value={
                  provider.data.presets.find((p: Row) => p.baseUrl === baseUrl)
                    ?.id ?? "custom"
                }
                onChange={(e) => {
                  const preset = provider.data?.presets.find(
                    (p: Row) => p.id === e.target.value,
                  );
                  if (preset) {
                    setBaseUrl(preset.baseUrl);
                    setKind(preset.kind);
                    setKey("");
                  }
                }}
              >
                {provider.data.presets.map((p: Row) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="custom">{t("Vlastní API", "Custom API")}</option>
              </select>
            </label>
          )}
          <label>
            {t("Adresa API", "API URL")}
            <input
              type="url"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label>
            {t("Protokol", "Protocol")}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="openai">OpenAI compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label>
            API key
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy}>
              {busy
                ? t("Připojuji…", "Connecting…")
                : t("Připojit a ověřit", "Connect and validate")}
            </button>
            <button
              type="button"
              disabled={busy || !provider.data?.connected}
              onClick={async () => {
                try {
                  await api("/api/provider", "DELETE");
                  await client.invalidateQueries();
                  setMessage("disconnected");
                } catch (e) {
                  setError(e);
                }
              }}
            >
              {t("Odpojit", "Disconnect")}
            </button>
          </div>
        </form>
      </section>
      <ErrorBox error={error} />
      {message && (
        <p role="status" className="notice">
          {message === "connected"
            ? t(
                "Poskytovatel připojen. Klíč je uložen šifrovaně na serveru.",
                "Provider connected. The key is encrypted on the server.",
              )
            : t(
                "Poskytovatel odpojen pro nové konverzace.",
                "Provider disconnected for new conversations.",
              )}
        </p>
      )}
      <section>
        <h2>{t("Schopnosti a připojení", "Capabilities and connection")}</h2>
        <Capabilities />
      </section>
    </div>
  );
}
function Capabilities() {
  const query = useApi("/api/capabilities");
  const t = useText();
  return (
    <>
      <ErrorBox error={query.error} />
      {query.data && (
        <>
          <dl>
            <dt>{t("Prostředí", "Environment")}</dt>
            <dd>
              {query.data.mode === "cloud"
                ? "Vercel"
                : t("Lokální počítač", "Local computer")}
            </dd>
            <dt>{t("Současné běhy", "Concurrent runs")}</dt>
            <dd>{query.data.maxActiveRuns ?? "—"}</dd>
            <dt>{t("Velikost zprávy", "Message size")}</dt>
            <dd>
              {query.data.maxPromptCharacters ?? "—"} {t("znaků", "characters")}
            </dd>
            <dt>{t("Přílohy", "Attachments")}</dt>
            <dd>
              {query.data.binaryAttachments
                ? t("Textové a binární", "Text and binary")
                : t("Textové soubory do 24 KB", "Text files up to 24 KB")}
            </dd>
          </dl>
          <details>
            <summary>{t("Technické podrobnosti", "Technical details")}</summary>
            <JsonDetail value={query.data} />
          </details>
        </>
      )}
    </>
  );
}
const defaultPolicy =
  "version: 1\nrules:\n  - match:\n      class: r0\n    decision: allow\n  - match: {}\n    decision: hold\n    seconds: 300\n    notify: [cli]\n";
export function Connections() {
  const t = useText(),
    client = useQueryClient();
  const query = useApi("/api/connectors");
  const [editing, setEditing] = useState<Row>(),
    [testResult, setTestResult] = useState<Row>();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [token, setToken] = useState(""),
    [policy, setPolicy] = useState(defaultPolicy),
    [facts, setFacts] = useState("{}"),
    [mapping, setMapping] = useState("{}");
  return (
    <>
      <Integrations />
      <h2>{t("Vlastní MCP konektory", "Custom MCP connectors")}</h2>
      <ErrorBox error={query.error ?? error} />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(
          "Hledat konektor nebo nástroj…",
          "Search connectors or tools…",
        )}
        aria-label={t(
          "Hledat konektor nebo nástroj",
          "Search connectors or tools",
        )}
      />
      <div className="connector-list">
        {items(query.data, "connectors")
          .filter((c) =>
            (c.name + " " + json(c.tools))
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((c) => (
            <article key={c.id ?? c.name}>
              <div className="connector-heading">
                <h2>{c.name}</h2>
                <Badge
                  value={
                    c.builtin
                      ? t("Vestavěný", "Built-in")
                      : t("Připojený", "Connected")
                  }
                />
              </div>
              <p>
                {c.url ??
                  c.endpoint ??
                  t("Spravovaný pracovní prostor", "Managed workspace")}
              </p>
              <p className="muted">
                {c.tools?.length ?? 0} {t("nástrojů", "tools")} ·{" "}
                {c.undo
                  ? t("Podporuje Undo", "Supports Undo")
                  : t("Bez automatického Undo", "No automatic Undo")}
              </p>
              <details>
                <summary>
                  {t("Katalog nástrojů a schémata", "Tool catalog and schemas")}
                </summary>
                {(c.toolDetails ?? c.tools ?? []).map((tool: string | Row) => (
                  <details
                    key={typeof tool === "string" ? tool : tool.name}
                    className="tool-card"
                  >
                    <summary>
                      {typeof tool === "string" ? tool : tool.name}
                    </summary>
                    {typeof tool === "string" ? (
                      <p>
                        {t(
                          "Tento endpoint neposkytuje schéma ani klasifikaci nástroje.",
                          "This endpoint does not provide a tool schema or classification.",
                        )}
                      </p>
                    ) : (
                      <JsonDetail value={tool} />
                    )}
                  </details>
                ))}
              </details>
              {!c.builtin && (
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(c);
                      setName(c.name);
                      setUrl(c.url ?? c.endpoint ?? "");
                      setPolicy(c.policy ?? defaultPolicy);
                      setFacts(json(c.facts ?? {}));
                      setMapping(json(c.mapping ?? {}));
                      setToken("");
                    }}
                  >
                    {t("Upravit", "Edit")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        setTestResult(
                          await api(
                            "/api/connectors/" + c.id + "/test",
                            "POST",
                          ),
                        );
                        await client.invalidateQueries();
                      } catch (e) {
                        setError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("Ověřit spojení", "Test connection")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api("/api/connectors/" + c.id, "DELETE");
                        await client.invalidateQueries();
                      } catch (e) {
                        setError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("Odpojit", "Disconnect")}
                  </button>
                </div>
              )}
            </article>
          ))}
      </div>
      {testResult && (
        <Dialog
          title={t("Výsledek ověření", "Connection test result")}
          close={() => setTestResult(undefined)}
        >
          <JsonDetail value={testResult} />
        </Dialog>
      )}
      {editing && (
        <Dialog
          title={t("Upravit konektor", "Edit connector")}
          close={() => setEditing(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              try {
                await api("/api/connectors/" + editing.id, "PATCH", {
                  name,
                  url,
                  token,
                  policy,
                  facts: JSON.parse(facts),
                  mapping: JSON.parse(mapping),
                });
                setEditing(undefined);
                await client.invalidateQueries();
              } catch (e) {
                setError(e);
              } finally {
                setToken("");
                setBusy(false);
              }
            }}
          >
            <label>
              {t("Název", "Name")}
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              URL
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              {t(
                "Nový token (prázdný zachová původní)",
                "New token (leave empty to keep current)",
              )}
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <label>
              {t("Politika", "Policy")}
              <textarea
                rows={9}
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
              />
            </label>
            <label>
              Registry facts JSON
              <textarea
                value={facts}
                onChange={(e) => setFacts(e.target.value)}
              />
            </label>
            <label>
              Tool mapping JSON
              <textarea
                value={mapping}
                onChange={(e) => setMapping(e.target.value)}
              />
            </label>
            <ErrorBox error={error} />
            <button className="primary" disabled={busy}>
              {t("Uložit a ověřit", "Save and validate")}
            </button>
          </form>
        </Dialog>
      )}
      <details className="connect-form">
        <summary>
          {t("Připojit nový MCP konektor", "Connect a new MCP connector")}
        </summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            try {
              await api("/api/connectors", "POST", {
                name,
                url,
                token,
                policy,
                facts: JSON.parse(facts),
                mapping: JSON.parse(mapping),
              });
              await client.invalidateQueries();
              setName("");
              setUrl("");
            } catch (e) {
              setError(e);
            } finally {
              setToken("");
              setBusy(false);
            }
          }}
        >
          <label>
            {t("Název", "Name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label>
            URL
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </label>
          <label>
            Token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            {t("Politika", "Policy")}
            <textarea
              rows={9}
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
            />
          </label>
          <label>
            Registry facts JSON
            <textarea
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
            />
          </label>
          <label>
            Tool mapping JSON
            <textarea
              value={mapping}
              onChange={(e) => setMapping(e.target.value)}
            />
          </label>
          <button disabled={busy} className="primary">
            {busy
              ? t("Připojuji…", "Connecting…")
              : t("Připojit a objevit nástroje", "Connect and discover tools")}
          </button>
        </form>
      </details>
    </>
  );
}
