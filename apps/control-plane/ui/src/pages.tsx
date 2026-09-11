import { ApprovalReview } from "./approval-review";
import { LedgerDetail } from "./ledger-detail";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, items, json, type Row } from "./api";
import {
  Badge,
  DataTable,
  Dialog,
  Empty,
  ErrorBox,
  JsonDetail,
  useApi,
  useText,
} from "./ui";
export function Sessions({ navigate }: { navigate: (path: string) => void }) {
  const t = useText(),
    client = useQueryClient();
  const [archived, setArchived] = useState(false),
    [edit, setEdit] = useState<Row>(),
    [title, setTitle] = useState(""),
    [error, setError] = useState<unknown>();
  async function patch(row: Row, body: Row) {
    try {
      await api("/api/sessions/" + row.id, "PATCH", body);
      await client.invalidateQueries();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <ErrorBox error={error} />
      <DataTable
        key={String(archived)}
        endpoint={"/api/sessions?archived=" + archived}
        legacyKey="sessions"
        toolbar={
          <button
            aria-pressed={archived}
            onClick={() => setArchived(!archived)}
          >
            {t("Archiv", "Archive")}
          </button>
        }
        columns={[
          {
            key: "title",
            label: t("Konverzace", "Conversation"),
            render: (r) => (
              <button
                className="text-button"
                onClick={() => navigate("/chat/" + r.id)}
              >
                {r.pinned ? "⌖ " : ""}
                {r.title ?? r.model}
              </button>
            ),
          },
          { key: "model", label: "Model" },
          {
            key: "status",
            label: t("Stav", "Status"),
            render: (r) => <Badge value={r.status} />,
          },
          { key: "updatedAt", label: t("Změněno", "Updated") },
          { key: "messageCount", label: t("Zprávy", "Messages") },
          {
            key: "actions",
            label: t("Akce", "Actions"),
            render: (r) => (
              <div className="row-actions">
                <button
                  onClick={() => {
                    setEdit(r);
                    setTitle(r.title ?? "");
                  }}
                >
                  {t("Název", "Rename")}
                </button>
                <button onClick={() => patch(r, { pinned: !r.pinned })}>
                  {r.pinned ? t("Odepnout", "Unpin") : t("Připnout", "Pin")}
                </button>
                <button onClick={() => patch(r, { archived: !r.archived })}>
                  {r.archived
                    ? t("Obnovit", "Restore")
                    : t("Archivovat", "Archive")}
                </button>
              </div>
            ),
          },
        ]}
        onRow={(r) => navigate("/chat/" + r.id)}
      />
      {edit && (
        <Dialog
          title={t("Přejmenovat konverzaci", "Rename conversation")}
          close={() => setEdit(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await patch(edit, { title });
              setEdit(undefined);
            }}
          >
            <label>
              {t("Název", "Title")}
              <input
                autoFocus
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button className="primary">{t("Uložit", "Save")}</button>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function Overview({ navigate }: { navigate: (path: string) => void }) {
  const t = useText();
  const query = useApi("/api/overview");
  const data = query.data;
  const metrics =
    data?.counts ?? data?.overview?.counts ?? data?.overview ?? data ?? {};
  return (
    <>
      <p className="page-intro">
        {t(
          "Co se právě děje ve vašem pracovním prostoru.",
          "What is happening in your workspace.",
        )}
      </p>
      <ErrorBox error={query.error} />
      <div className="metrics">
        {[
          [t("Konverzace", "Conversations"), "sessions", "/sessions"],
          [t("Aktivní běhy", "Active runs"), "running", "/runs"],
          [
            t("Čeká na rozhodnutí", "Awaiting decision"),
            "pendingApprovals",
            "/approvals",
          ],
          [t("Dokumenty", "Documents"), "documents", "/documents"],
        ].map(([label, key, path]) => (
          <button key={key} onClick={() => navigate(path)}>
            <span>{label}</span>
            <strong>{metrics[key] ?? "—"}</strong>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <h2>{t("Nedávná práce", "Recent work")}</h2>
      <DataTable
        endpoint="/api/sessions?archived=false"
        legacyKey="sessions"
        columns={[
          { key: "title", label: t("Konverzace", "Conversation") },
          {
            key: "status",
            label: t("Stav", "Status"),
            render: (r) => <Badge value={r.status} />,
          },
          { key: "model", label: "Model" },
          { key: "updatedAt", label: t("Změněno", "Updated") },
        ]}
        onRow={(r) => navigate("/chat/" + r.id)}
      />
      <details>
        <summary>
          {t("Stav a rozsah přehledu", "Overview status and scope")}
        </summary>
        <JsonDetail value={data} />
      </details>
    </>
  );
}
export function Runs({ navigate }: { navigate: (path: string) => void }) {
  const t = useText();
  const [status, setStatus] = useState("");
  return (
    <DataTable
      key={status}
      endpoint={"/api/runs?status=" + status}
      columns={[
        { key: "id", label: t("Běh", "Run") },
        {
          key: "sessionId",
          label: t("Konverzace", "Conversation"),
          render: (r) => (
            <button
              className="text-button"
              onClick={() => navigate("/chat/" + r.sessionId)}
            >
              {r.title ?? r.sessionId}
            </button>
          ),
        },
        {
          key: "status",
          label: t("Stav", "Status"),
          render: (r) => <Badge value={r.status} />,
        },
        { key: "model", label: "Model" },
        { key: "createdAt", label: t("Začátek", "Started") },
        { key: "durationMs", label: "ms" },
        { key: "steps", label: t("Kroky", "Steps") },
      ]}
      toolbar={
        <select
          aria-label={t("Stav běhu", "Run status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t("Všechny stavy", "All states")}</option>
          {["running", "idle", "failed", "cancelled"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      }
    />
  );
}
export function Approvals() {
  const t = useText();
  const [selected, setSelected] = useState<Row>();
  return (
    <>
      {" "}
      <DataTable
        endpoint="/api/approvals?history=true"
        legacyKey="approvals"
        columns={[
          {
            key: "tool",
            label: t("Nástroj", "Tool"),
            render: (r) => r.call?.tool ?? r.tool,
          },
          {
            key: "klass",
            label: t("Riziko", "Risk"),
            render: (r) => <Badge value={r.call?.klass ?? r.klass} />,
          },
          {
            key: "status",
            label: t("Stav", "Status"),
            render: (r) => <Badge value={r.status} />,
          },
          {
            key: "expiresAt",
            label: t("Vyprší", "Expires"),
            render: (r) =>
              new Date(r.expiresAt).toLocaleString(t("cs-CZ", "en-GB")),
          },
        ]}
        onRow={(r) => {
          setSelected(r);
        }}
      />
      {selected && (
        <ApprovalReview
          record={selected}
          close={() => setSelected(undefined)}
        />
      )}
    </>
  );
}
export function Ledger() {
  const t = useText();
  const readFilters = () => {
    const p = new URLSearchParams(location.search);
    return Object.fromEntries(
      ["workspace", "decision", "klass", "outcome", "from", "to"].map((k) => [
        k,
        p.get(k) ?? "",
      ]),
    );
  };
  const [filters, setFilters] = useState(readFilters),
    [detail, setDetail] = useState<Row>(),
    [proof, setProof] = useState<Row>(),
    [error, setError] = useState<unknown>(),
    [scopeSearch, setScopeSearch] = useState("");
  const scopes = useApi(
    "/api/sessions?archived=all&limit=100&q=" + encodeURIComponent(scopeSearch),
  );
  const workspace = filters.workspace;
  const query = workspace ? "workspace=" + encodeURIComponent(workspace) : "";
  const filterQuery = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
  function changeFilter(key: string, value: string) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setProof(undefined);
    const url = new URL(location.href);
    for (const [name, v] of Object.entries(next)) {
      if (v) url.searchParams.set(name, v);
      else url.searchParams.delete(name);
    }
    url.searchParams.delete("cursor");
    window.history.pushState({}, "", url);
  }
  useEffect(() => {
    const pop = () => {
      setFilters(readFilters());
      setProof(undefined);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return (
    <>
      <ErrorBox error={error} />
      {proof && (
        <div className="notice" role="status">
          {proof.verified && proof.signed
            ? t("Podpisy ověřeny", "Signatures verified")
            : proof.integrity
              ? t(
                  "Ověřena integrita; podpisy nejsou ověřeny",
                  "Integrity checked; signatures not verified",
                )
              : t("Ověření nepotvrzeno", "Verification not confirmed")}{" "}
          · {proof.checked ?? "—"}
          <details>
            <summary>{t("Rozsah ověření", "Verification scope")}</summary>
            <JsonDetail value={proof} />
          </details>
        </div>
      )}
      <DataTable
        key={filterQuery}
        endpoint={"/api/feed?" + filterQuery}
        legacyKey="entries"
        toolbar={
          <>
            <input
              type="search"
              aria-label={t(
                "Hledat pracovní prostor v celé historii",
                "Find workspace in all history",
              )}
              placeholder={t("Hledat pracovní prostor…", "Find workspace…")}
              value={scopeSearch}
              onChange={(e) => setScopeSearch(e.target.value)}
            />
            <select
              aria-label={t("Pracovní prostor", "Workspace")}
              value={workspace}
              onChange={(e) => changeFilter("workspace", e.target.value)}
            >
              <option value="">
                {t("Výchozí prostor serveru", "Server default workspace")}
              </option>
              {workspace &&
                !items(scopes.data, "sessions").some(
                  (r) => r.workspace === workspace,
                ) && <option value={workspace}>{workspace}</option>}
              {items(scopes.data, "sessions").map((row) => (
                <option key={row.id} value={row.workspace}>
                  {row.title ?? row.workspace}
                </option>
              ))}
            </select>
            <select
              aria-label={t("Třída rizika", "Risk class")}
              value={filters.klass}
              onChange={(e) => changeFilter("klass", e.target.value)}
            >
              <option value="">{t("Všechny třídy", "All classes")}</option>
              {["r0", "r1", "r2", "r3"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label={t("Výsledek operace", "Operation outcome")}
              value={filters.outcome}
              onChange={(e) => changeFilter("outcome", e.target.value)}
            >
              <option value="">{t("Všechny výsledky", "All outcomes")}</option>
              {["completed", "failed", "undo:completed"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <label>
              {t("Od", "From")}
              <input
                type="date"
                value={filters.from.slice(0, 10)}
                onChange={(e) =>
                  changeFilter(
                    "from",
                    e.target.value ? e.target.value + "T00:00:00.000Z" : "",
                  )
                }
              />
            </label>
            <label>
              {t("Do", "To")}
              <input
                type="date"
                value={filters.to.slice(0, 10)}
                onChange={(e) =>
                  changeFilter(
                    "to",
                    e.target.value ? e.target.value + "T23:59:59.999Z" : "",
                  )
                }
              />
            </label>
            <select
              aria-label={t("Rozhodnutí", "Decision")}
              value={filters.decision}
              onChange={(e) => changeFilter("decision", e.target.value)}
            >
              <option value="">
                {t("Všechna rozhodnutí", "All decisions")}
              </option>
              <option>allow</option>
              <option>hold</option>
              <option>deny</option>
            </select>
            <button
              onClick={async () => {
                try {
                  setProof(await api("/api/ledger/verify?" + query));
                } catch (e) {
                  setError(e);
                }
              }}
            >
              {t("Ověřit ledger", "Verify ledger")}
            </button>
            <a className="button" href={"/api/ledger/export?" + query}>
              {t("Podepsaný export", "Signed export")}
            </a>
          </>
        }
        columns={[
          { key: "seq", label: "#" },
          { key: "at", label: t("Čas", "Time") },
          { key: "tool", label: t("Nástroj", "Tool") },
          {
            key: "klass",
            label: t("Třída", "Class"),
            render: (r) => <Badge value={r.klass} />,
          },
          { key: "decision", label: t("Rozhodnutí", "Decision") },
          {
            key: "digest",
            label: "Digest",
            render: (r) => <code>{String(r.digest ?? "").slice(0, 14)}…</code>,
          },
        ]}
        onRow={setDetail}
      />
      {detail && (
        <LedgerDetail row={detail} close={() => setDetail(undefined)} />
      )}
    </>
  );
}
export function Models() {
  const t = useText();
  const provider = useApi("/api/provider"),
    client = useQueryClient();
  const [error, setError] = useState<unknown>(),
    [search, setSearch] = useState("");
  return (
    <>
      <ErrorBox error={provider.error ?? error} />
      <p className="page-intro">
        {t(
          "Katalog aktuálně připojeného poskytovatele. Ceny a limity bez zdroje jsou neověřené.",
          "Catalog of the connected provider. Prices and limits without a source are unverified.",
        )}
      </p>
      <input
        type="search"
        aria-label={t("Hledat model", "Search models")}
        placeholder={t("Hledat model…", "Search models…")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="model-catalog">
        {items(provider.data, "models")
          .filter((m) =>
            (m.id + " " + m.name).toLowerCase().includes(search.toLowerCase()),
          )
          .map((m) => (
            <article key={m.id}>
              <div>
                <h3>{m.name ?? m.id}</h3>
                <code>{m.id}</code>
                <p className="muted">
                  {t("Cena", "Price")}:{" "}
                  {m.pricing ? json(m.pricing) : t("neověřena", "unverified")} ·{" "}
                  {t("Kontext", "Context")}: {m.contextLength ?? "—"}
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await api("/api/preferences", "PATCH", {
                      defaultModel: m.id,
                    });
                    await client.invalidateQueries();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {t("Nastavit výchozí", "Set default")}
              </button>
            </article>
          ))}
      </div>
      <h2>{t("Spotřeba", "Usage")}</h2>
      <DataTable
        endpoint="/api/usage"
        columns={[
          { key: "sessionId", label: t("Konverzace", "Conversation") },
          { key: "model", label: "Model" },
          { key: "inputTokens", label: t("Vstupní tokeny", "Input tokens") },
          { key: "outputTokens", label: t("Výstupní tokeny", "Output tokens") },
          { key: "cost", label: t("Náklad", "Cost") },
          { key: "source", label: t("Zdroj ceny", "Price source") },
        ]}
        empty={t(
          "Zatím žádná zaznamenaná spotřeba. Chybějící údaje nejsou nulová spotřeba.",
          "No recorded usage yet. Missing data does not mean zero usage.",
        )}
      />
    </>
  );
}
