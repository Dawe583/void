import * as m from "motion/react-m";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api, download, items, json, type Row } from "./api";
export const MotionEnabled = createContext(true);
export const Locale = createContext<"cs" | "en">("en");
export function useText() {
  const locale = useContext(Locale);
  return (cs: string, en: string) => (locale === "cs" ? cs : en);
}
export function useApi(
  path: string,
  enabled = true,
  interval: number | ((data: Row | undefined) => number) = 15000,
  retry: number | boolean = 1,
) {
  return useQuery({
    queryKey: [path],
    queryFn: () => api(path),
    enabled,
    refetchInterval:
      typeof interval === "function"
        ? (query) => interval(query.state.data)
        : interval,
    refetchIntervalInBackground: false,
    retry,
  });
}
export function Badge({ value }: { value: unknown }) {
  return (
    <span className="badge" data-state={String(value)}>
      {String(value ?? "—")}
    </span>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  const t = useText();
  return error ? (
    <div className="error" role="alert">
      {t("Požadavek se nepodařil", "Request failed")}:{" "}
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <span aria-hidden="true">[ · ]</span>
      <p>{children}</p>
    </div>
  );
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const animate = useContext(MotionEnabled);
  const t = useText();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <m.dialog
      initial={animate ? { opacity: 0, y: 18, scale: 0.985 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button onClick={close} aria-label={t("Zavřít", "Close")}>
          ×
        </button>
      </div>
      {children}
    </m.dialog>
  );
}
export function JsonDetail({ value }: { value: unknown }) {
  return <pre className="json">{json(value)}</pre>;
}
export type Column = {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
};
export function DataTable({
  endpoint,
  legacyKey,
  columns,
  onRow,
  toolbar,
  empty,
}: {
  endpoint: string;
  legacyKey?: string;
  columns: Column[];
  onRow?: (row: Row) => void;
  toolbar?: ReactNode;
  empty?: string;
}) {
  const t = useText();
  const initial = new URLSearchParams(location.search);
  const [q, setQ] = useState(initial.get("q") ?? ""),
    [search, setSearch] = useState(initial.get("q") ?? ""),
    [cursor, setCursor] = useState(initial.get("cursor") ?? "");
  const [history, setHistory] = useState<string[]>(
    window.history.state?.tableHistory ?? [],
  );
  const [size, setSize] = useState(
    ["25", "50", "100"].includes(initial.get("size") ?? "")
      ? initial.get("size")!
      : "50",
  );
  const [sort, setSort] = useState(
    (initial.get("order") === "desc" ? "-" : "") + (initial.get("sort") ?? ""),
  );
  const [hidden, setHidden] = useState<string[]>([]),
    [detail, setDetail] = useState<Row>(),
    [view, setView] = useState(
      initial.get("view") === "list" ? "list" : "table",
    );
  const restoring = useRef(false);
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => {
      setSearch(q);
      setCursor("");
      setHistory([]);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, search]);
  useEffect(() => {
    const restore = () => {
      const url = new URLSearchParams(location.search);
      restoring.current = true;
      setQ(url.get("q") ?? "");
      setSearch(url.get("q") ?? "");
      setCursor(url.get("cursor") ?? "");
      setSize(url.get("size") ?? "50");
      setSort(
        (url.get("order") === "desc" ? "-" : "") + (url.get("sort") ?? ""),
      );
      setView(url.get("view") === "list" ? "list" : "table");
      setHistory(window.history.state?.tableHistory ?? []);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    const url = new URL(location.href);
    for (const [key, value] of Object.entries({
      q: search,
      size: size === "50" ? "" : size,
      sort: sort.replace(/^-/, ""),
      order: sort ? (sort.startsWith("-") ? "desc" : "asc") : "",
      cursor,
      view: view === "list" ? "list" : "",
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (url.href !== location.href)
      window.history.pushState(
        { ...window.history.state, tableHistory: history },
        "",
        url,
      );
  }, [search, size, sort, cursor, view, history]);
  const params = new URLSearchParams({
    q: search,
    limit: size,
    ...(cursor ? { cursor } : {}),
    ...(sort
      ? {
          sort: sort.replace(/^-/, ""),
          order: sort.startsWith("-") ? "desc" : "asc",
        }
      : {}),
  });
  const query = useApi(
    endpoint + (endpoint.includes("?") ? "&" : "?") + params,
  );
  const [snapshot, setSnapshot] = useState<Row>();
  const [updates, setUpdates] = useState(false);
  useEffect(() => {
    setSnapshot(undefined);
    setUpdates(false);
  }, [endpoint, search, cursor, size, sort]);
  useEffect(() => {
    if (!query.data) return;
    if (!snapshot) {
      setSnapshot(query.data);
      return;
    }
    if (json(items(snapshot, legacyKey)) !== json(items(query.data, legacyKey)))
      setUpdates(true);
  }, [query.data, snapshot, legacyKey]);
  const data = snapshot ?? query.data;
  const rows = items(data, legacyKey);
  const visible = columns.filter((c) => !hidden.includes(c.key));
  return (
    <div className="data-block">
      <div className="toolbar">
        <input
          type="search"
          aria-label={t("Hledat v celé historii", "Search all history")}
          placeholder={t("Hledat v celé historii…", "Search all history…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {toolbar}
        <button
          onClick={async () => {
            const result = await query.refetch();
            setSnapshot(result.data);
            setUpdates(false);
          }}
        >
          {t("Obnovit", "Refresh")}
        </button>
        <details className="columns">
          <summary>{t("Zobrazení", "View")}</summary>
          <div className="popover">
            <label>
              {t("Počet řádků", "Page size")}
              <select
                value={size}
                onChange={(e) => {
                  setSize(e.target.value);
                  setCursor("");
                  setHistory([]);
                }}
              >
                <option>25</option>
                <option>50</option>
                <option>100</option>
              </select>
            </label>
            <button
              onClick={() => setView(view === "table" ? "list" : "table")}
            >
              {t("Tabulka / seznam", "Table / list")}
            </button>
            {columns.map((c) => (
              <label key={c.key}>
                <input
                  type="checkbox"
                  checked={!hidden.includes(c.key)}
                  onChange={() =>
                    setHidden(
                      hidden.includes(c.key)
                        ? hidden.filter((k) => k !== c.key)
                        : [...hidden, c.key],
                    )
                  }
                />
                {c.label}
              </label>
            ))}
            <button
              onClick={() =>
                localStorage.setItem(
                  "void-view:" + endpoint,
                  json({ hidden, size, sort, view }),
                )
              }
            >
              {t("Uložit pohled", "Save view")}
            </button>
            <button
              onClick={() => {
                try {
                  const v = JSON.parse(
                    localStorage.getItem("void-view:" + endpoint) ?? "{}",
                  );
                  setHidden(v.hidden ?? []);
                  setSize(v.size ?? "50");
                  setSort(v.sort ?? "");
                  setView(v.view ?? "table");
                } catch {}
              }}
            >
              {t("Načíst pohled", "Load view")}
            </button>
          </div>
        </details>
        <button
          disabled={!rows.length}
          onClick={() =>
            download(
              "void-page.json",
              json({ scope: data?.scope, asOf: data?.asOf, items: rows }),
              "application/json",
            )
          }
        >
          {t("Export stránky", "Export page")}
        </button>
      </div>
      <ErrorBox error={query.error} />
      {updates && (
        <button
          className="notice"
          onClick={() => {
            setSnapshot(query.data);
            setUpdates(false);
          }}
        >
          {t(
            "Jsou dostupné nové záznamy. Aktualizovat pohled.",
            "New records available. Update this view.",
          )}
        </button>
      )}
      {query.isLoading ? (
        <Empty>{t("Načítání…", "Loading…")}</Empty>
      ) : !rows.length ? (
        <Empty>
          {empty ??
            t(
              "Žádné výsledky. Změňte filtr nebo začněte novou konverzaci.",
              "No results. Change the filter or start a conversation.",
            )}
        </Empty>
      ) : (
        <div
          className={"table-scroll " + (view === "list" ? "list-view" : "")}
          tabIndex={0}
          aria-label={t("Výsledky", "Results")}
        >
          <table>
            <thead>
              <tr>
                {visible.map((c) => (
                  <th key={c.key}>
                    <button
                      onClick={() => {
                        setSort(sort === c.key ? "-" + c.key : c.key);
                        setCursor("");
                        setHistory([]);
                      }}
                    >
                      {c.label}{" "}
                      {sort.replace("-", "") === c.key
                        ? sort.startsWith("-")
                          ? "↓"
                          : "↑"
                        : ""}
                    </button>
                  </th>
                ))}
                <th>{t("Detail", "Detail")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id ?? row.holdId ?? row.seq ?? row.path ?? index}>
                  {visible.map((c) => (
                    <td key={c.key} data-label={c.label}>
                      {c.render
                        ? c.render(row)
                        : row[c.key] == null
                          ? "—"
                          : /^(at|.*At)$/.test(c.key) &&
                              Number.isFinite(Date.parse(row[c.key]))
                            ? new Date(row[c.key]).toLocaleString(
                                t("cs-CZ", "en-GB"),
                              )
                            : typeof row[c.key] === "number"
                              ? new Intl.NumberFormat(
                                  t("cs-CZ", "en-GB"),
                                ).format(row[c.key])
                              : String(row[c.key])}
                    </td>
                  ))}
                  <td>
                    <button
                      onClick={() => (onRow ? onRow(row) : setDetail(row))}
                      aria-label={t("Otevřít detail", "Open details")}
                    >
                      ↗
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <span>
          {data?.total ?? rows.length} {t("záznamů", "records")}{" "}
          {data?.asOf && (
            <small>
              {new Date(data.asOf).toLocaleTimeString(t("cs-CZ", "en-GB"))}
            </small>
          )}
        </span>
        <button
          disabled={!history.length}
          onClick={() => {
            setCursor(history.at(-1) ?? "");
            setHistory(history.slice(0, -1));
          }}
        >
          {t("Předchozí", "Previous")}
        </button>
        <button
          disabled={!data?.hasMore || !data?.nextCursor}
          onClick={() => {
            setHistory([...history, cursor]);
            setCursor(data!.nextCursor);
          }}
        >
          {t("Další", "Next")}
        </button>
      </div>
      {detail && (
        <Dialog
          title={t("Podrobnosti záznamu", "Record details")}
          close={() => setDetail(undefined)}
        >
          <JsonDetail value={detail} />
          <button onClick={() => navigator.clipboard.writeText(json(detail))}>
            {t("Kopírovat", "Copy")}
          </button>
        </Dialog>
      )}
    </div>
  );
}
