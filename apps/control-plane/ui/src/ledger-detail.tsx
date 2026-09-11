import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Row } from "./api";
import { Badge, Dialog, ErrorBox, JsonDetail, useText } from "./ui";

export function LedgerDetail({ row, close }: { row: Row; close: () => void }) {
  const t = useText(),
    client = useQueryClient();
  const [graph, setGraph] = useState<Row>(),
    [preview, setPreview] = useState<Row>();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [applied, setApplied] = useState(false);
  const workspace =
    row.workspace ??
    new URLSearchParams(location.search).get("workspace") ??
    "";
  const endpoint = `/api/records/${row.seq}/`;
  const scope = "?workspace=" + encodeURIComponent(workspace);
  async function inspect(action: "taint" | "replay") {
    setBusy(true);
    setError(undefined);
    setConfirmed(false);
    try {
      const result = await api(endpoint + action + scope);
      if (action === "taint") setGraph(result);
      else setPreview(result);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!confirmed || !preview?.digest || preview.canApply === false) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(
        await api(endpoint + "replay" + scope, "POST", {
          digest: preview.digest,
        }),
      );
      setApplied(true);
      await client.invalidateQueries();
    } catch (e) {
      setError(e);
      setPreview(undefined);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  const nodes: Row[] = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges: Row[] = Array.isArray(graph?.edges) ? graph.edges : [];
  const label = (digest: string) => {
    const node = nodes.find((n) => n.digest === digest);
    return node ? `#${node.seq} ${node.tool}` : digest;
  };
  return (
    <Dialog title={`#${row.seq} ${row.tool ?? "Ledger"}`} close={close}>
      <Badge value={row.decision} />
      <p>
        <code>{row.digest ?? row.hash}</code>
      </p>
      <div className="actions">
        <button disabled={busy} onClick={() => inspect("taint")}>
          {t("Zobrazit vazby", "Show dependencies")}
        </button>
        <button disabled={busy || applied} onClick={() => inspect("replay")}>
          {t("Náhled vrácení změny", "Preview inverse")}
        </button>
      </div>
      <ErrorBox error={error} />
      {graph && (
        <section>
          <h3>{t("Zaznamenané vazby", "Recorded dependencies")}</h3>
          <p>
            {t(
              "Vazba na společný zdroj sama o sobě nedokazuje příčinu. Datová vazba vyžaduje zaznamenaný digest výstupu.",
              "A shared resource does not prove causation. Data dependencies require a recorded output digest.",
            )}
          </p>
          <ul>
            {nodes.map((n) => (
              <li key={n.digest}>
                <strong>
                  #{n.seq} {n.tool}
                </strong>{" "}
                · {n.decision} <Badge value={n.klass} />
              </li>
            ))}
          </ul>
          {edges.length ? (
            <ul>
              {edges.map((e, i) => (
                <li key={i}>
                  <strong>{label(e.from)}</strong> /{" "}
                  <strong>{label(e.to)}</strong>
                  <p>
                    {e.kind === "data"
                      ? t("Datová vazba", "Data dependency")
                      : t("Společný zdroj", "Shared resource")}
                    : <code>{e.via}</code>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {t(
                "V tomto rozsahu nejsou další zaznamenané vazby.",
                "No further recorded dependencies in this scope.",
              )}
            </p>
          )}
          <details>
            <summary>{t("Zdrojová evidence", "Source evidence")}</summary>
            <JsonDetail value={graph} />
          </details>
        </section>
      )}
      {preview && (
        <section>
          <h3>
            {t("Zachycená inverzní operace", "Captured inverse operation")}
          </h3>
          <pre>
            {Array.isArray(preview.lines) ? preview.lines.join("\n\n") : ""}
          </pre>
          {applied ? (
            <p role="status">
              {t(
                "Změna byla vrácena. Evidence zůstává zachovaná.",
                "Change reversed. Evidence remains preserved.",
              )}
            </p>
          ) : preview.canApply === false ? (
            <p>
              {t(
                "Tuto změnu nyní nelze bezpečně vrátit.",
                "This change cannot be safely reversed now.",
              )}
            </p>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t(
                  "Zkontroloval jsem náhled a chci provést tuto změnu.",
                  "I reviewed the preview and want to apply this change.",
                )}
              </label>
              <button
                className="primary"
                disabled={busy || !confirmed}
                onClick={apply}
              >
                {t("Potvrdit vrácení změny", "Confirm inverse")}
              </button>
            </>
          )}
        </section>
      )}
      <details>
        <summary>{t("Úplný záznam", "Full record")}</summary>
        <JsonDetail value={row} />
      </details>
    </Dialog>
  );
}
