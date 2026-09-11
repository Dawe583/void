import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Row } from "./api";
import { Badge, Dialog, ErrorBox, JsonDetail, useText } from "./ui";
export function ApprovalReview({
  record,
  close,
}: {
  record: Row;
  close: () => void;
}) {
  const t = useText(),
    client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = new Date(record.expiresAt).getTime() <= now;
  async function decide(kind: string) {
    setBusy(true);
    try {
      await api(
        "/api/approvals/" + encodeURIComponent(record.holdId) + "/decision",
        "POST",
        { kind, by: "control-plane" },
      );
      await client.invalidateQueries();
      close();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={record.call?.tool ?? t("Rozhodnutí", "Decision")}
      close={close}
    >
      <Badge
        value={
          expired && record.status === "pending" ? "expired" : record.status
        }
      />
      <p>
        {record.reason ??
          record.rationale ??
          t(
            "Důvod politiky není součástí odpovědi serveru.",
            "Policy rationale is not included in the server response.",
          )}
      </p>
      <JsonDetail value={record} />
      <ErrorBox error={error} />
      <div className="actions">
        <button
          className="primary"
          disabled={busy || expired || record.status !== "pending"}
          onClick={() => decide("approved")}
        >
          {t("Schválit", "Approve")}
        </button>
        <button
          disabled={busy || expired || record.status !== "pending"}
          onClick={() => decide("denied")}
        >
          {t("Zamítnout", "Deny")}
        </button>
      </div>
    </Dialog>
  );
}
