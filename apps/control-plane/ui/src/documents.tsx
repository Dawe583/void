import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, download, type Row } from "./api";
import { DataTable, Dialog, Empty, ErrorBox, useApi, useText } from "./ui";
import { RichText } from "./chat";
export function Documents({
  sessionId,
  initialPath,
}: {
  sessionId?: string;
  initialPath?: string;
}) {
  const t = useText();
  const [selected, setSelected] = useState<Row | undefined>(() => {
    const params = new URLSearchParams(location.search);
    const path = initialPath ?? params.get("document");
    const id = sessionId ?? params.get("documentSession");
    return path && id ? { path, sessionId: id } : undefined;
  });
  return (
    <div className="documents">
      <DataTable
        endpoint={
          "/api/documents" +
          (sessionId ? "?sessionId=" + encodeURIComponent(sessionId) : "")
        }
        columns={[
          { key: "path", label: t("Dokument", "Document") },
          { key: "bytes", label: t("Velikost", "Size") },
          { key: "revision", label: t("Revize", "Revision") },
          { key: "updatedAt", label: t("Změněno", "Updated") },
          { key: "sessionId", label: t("Konverzace", "Conversation") },
        ]}
        onRow={(row) => {
          setSelected(row);
          const url = new URL(location.href);
          url.searchParams.set("document", row.path);
          url.searchParams.set("documentSession", row.sessionId);
          window.history.replaceState(window.history.state, "", url);
        }}
      />
      {selected && (
        <DocumentEditor
          selected={selected}
          close={() => {
            setSelected(undefined);
            const url = new URL(location.href);
            url.searchParams.delete("document");
            url.searchParams.delete("documentSession");
            window.history.replaceState(window.history.state, "", url);
          }}
        />
      )}
    </div>
  );
}
function Diff({
  before,
  after,
}: {
  before?: string | null;
  after?: string | null;
}) {
  const t = useText();
  const left = (before ?? "").split("\n"),
    right = (after ?? "").split("\n");
  let prefix = 0,
    suffix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  )
    prefix++;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++;
  return (
    <div className="diff">
      {[
        [t("Před změnou", "Before"), left, "removed"],
        [t("Po změně", "After"), right, "added"],
      ].map(([label, lines, tone]) => (
        <section key={String(tone)}>
          <h3>{String(label)}</h3>
          <pre>
            {(lines as string[]).map((line, i) => (
              <span
                key={i}
                className={
                  i >= prefix && i < (lines as string[]).length - suffix
                    ? String(tone)
                    : "unchanged"
                }
              >
                <span className="line-number">{i + 1}</span>
                {i >= prefix && i < (lines as string[]).length - suffix
                  ? tone === "removed"
                    ? "− "
                    : "+ "
                  : "  "}
                {line}
                {"\n"}
              </span>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}
function DocumentEditor({
  selected,
  close,
}: {
  selected: Row;
  close: () => void;
}) {
  const t = useText(),
    client = useQueryClient();
  const previewTab = useRef<HTMLButtonElement>(null);
  const base = "/api/sessions/" + encodeURIComponent(selected.sessionId);
  const detail = useApi(
    base + "/documents?path=" + encodeURIComponent(selected.path),
  );
  const workspace = useApi(base + "/workspace");
  const document = detail.data?.document;
  const [baseline, setBaseline] = useState(""),
    [comparison, setComparison] = useState("");
  const [content, setContent] = useState(""),
    [revision, setRevision] = useState<string | number>(),
    [mode, setMode] = useState("preview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [undo, setUndo] = useState<Row>();
  useEffect(() => {
    if (document && (revision === undefined || content === baseline)) {
      setContent(document.content ?? "");
      setBaseline(document.content ?? "");
      setRevision(document.revision);
    }
  }, [document]);
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api(base + "/documents", "PATCH", {
        path: selected.path,
        content,
        expectedRevision: revision,
      });
      setRevision(result.document.revision);
      setContent(result.document.content ?? "");
      setBaseline(result.document.content ?? "");
      await client.invalidateQueries();
      setMode("preview");
      requestAnimationFrame(() => previewTab.current?.focus());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={selected.path} close={close}>
      <div className="toolbar">
        {["preview", "edit", "diff", "history"].map((tab) => (
          <button
            key={tab}
            ref={tab === "preview" ? previewTab : undefined}
            aria-pressed={mode === tab}
            onClick={() => setMode(tab)}
          >
            {
              (
                {
                  preview: t("Náhled", "Preview"),
                  edit: t("Upravit", "Edit"),
                  diff: t("Porovnat", "Compare"),
                  history: t("Historie", "History"),
                } as Record<string, string>
              )[tab]
            }
          </button>
        ))}
        <button
          onClick={() => download(selected.path.split("/").at(-1), content)}
        >
          {t("Stáhnout", "Download")}
        </button>
      </div>
      <ErrorBox error={error ?? detail.error} />
      {document && revision !== undefined && document.revision !== revision && (
        <p className="notice">
          {t(
            "Na serveru existuje novější revize. Váš koncept je zachován; před uložením porovnejte změny.",
            "A newer revision exists on the server. Your draft is preserved; compare changes before saving.",
          )}
          <button
            onClick={() => {
              setContent(document.content ?? "");
              setBaseline(document.content ?? "");
              setRevision(document.revision);
            }}
          >
            {t(
              "Načíst novější a zahodit koncept",
              "Load newer and discard draft",
            )}
          </button>
        </p>
      )}
      {document && (
        <p className="muted">
          {t("Revize", "Revision")}: {String(revision)} · {document.bytes} B
        </p>
      )}
      {mode === "edit" ? (
        <>
          <textarea
            className="document-editor"
            aria-label={t("Obsah dokumentu", "Document content")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || content === document?.content}
            onClick={save}
          >
            {t("Uložit novou revizi", "Save new revision")}
          </button>
        </>
      ) : mode === "diff" ? (
        <>
          <label>
            {t("Porovnávaná revize", "Compare revision")}
            <select
              value={comparison}
              onChange={(e) => setComparison(e.target.value)}
            >
              <option value="">
                {t("Aktuální dokument a koncept", "Current document and draft")}
              </option>
              {(workspace.data?.workspace?.operations ?? [])
                .filter((op: Row) => op.path === selected.path)
                .map((op: Row) => (
                  <option key={op.id} value={op.id}>
                    {new Date(op.at).toLocaleString(t("cs-CZ", "en-GB"))} ·{" "}
                    {op.kind}
                  </option>
                ))}
            </select>
          </label>
          {comparison ? (
            <Diff
              before={
                (workspace.data?.workspace?.operations ?? []).find(
                  (op: Row) => op.id === comparison,
                )?.before
              }
              after={
                (workspace.data?.workspace?.operations ?? []).find(
                  (op: Row) => op.id === comparison,
                )?.after
              }
            />
          ) : (
            <Diff before={document?.content} after={content} />
          )}
        </>
      ) : mode === "history" ? (
        <div className="history-list">
          {(workspace.data?.workspace?.operations ?? [])
            .filter((op: Row) => op.path === selected.path)
            .slice()
            .reverse()
            .map((op: Row) => (
              <article key={op.id}>
                <div>
                  <strong>{op.kind}</strong>
                  <p className="muted">
                    {new Date(op.at).toLocaleString(t("cs-CZ", "en-GB"))}
                  </p>
                </div>
                <button
                  disabled={op.kind === "undo"}
                  onClick={async () => {
                    try {
                      const preview = await api(
                        base + "/undo/" + encodeURIComponent(op.id),
                      );
                      setUndo({ ...preview, operation: op.id });
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  {t("Náhled Undo", "Preview Undo")}
                </button>
              </article>
            ))}
        </div>
      ) : document ? (
        <div className="prose document-preview">
          <RichText text={content} />
        </div>
      ) : (
        <Empty>{t("Načítání dokumentu…", "Loading document…")}</Empty>
      )}
      {undo && (
        <div className="undo-review">
          <h3>{t("Vrácení změny", "Undo change")}</h3>
          <p>
            {undo.reason ??
              t(
                "Zkontrolujte přesnou změnu před potvrzením.",
                "Review the exact change before confirming.",
              )}
          </p>
          <Diff before={undo.before} after={undo.after} />
          <button
            disabled={!undo.canApply || busy}
            className="primary"
            onClick={async () => {
              setBusy(true);
              try {
                await api(
                  base + "/undo/" + encodeURIComponent(undo.operation),
                  "POST",
                  { confirm: undo.operation },
                );
                setUndo(undefined);
                const refreshed = await detail.refetch();
                if (refreshed.data?.document) {
                  setContent(refreshed.data.document.content ?? "");
                  setBaseline(refreshed.data.document.content ?? "");
                  setRevision(refreshed.data.document.revision);
                }
                await client.invalidateQueries();
                setMode("preview");
                requestAnimationFrame(() => previewTab.current?.focus());
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Potvrdit Undo", "Confirm Undo")}
          </button>
          <button onClick={() => setUndo(undefined)}>
            {t("Zrušit", "Cancel")}
          </button>
        </div>
      )}
    </Dialog>
  );
}
