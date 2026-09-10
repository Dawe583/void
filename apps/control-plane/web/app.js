const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const errorMessage = error => error instanceof Error ? error.message : String(error);
const errorHtml = message => `<p class="error" role="alert">Error: ${escapeHtml(message)}</p>`;
const expiry = value => typeof value === "number" ? value : Date.parse(value);

export function feedUrl(workspace, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be an integer from 1 to 200");
  const params = new URLSearchParams();
  if (workspace) params.set("workspace", workspace);
  params.set("limit", String(limit));
  return `/api/feed?${params}`;
}

export function decisionRequest(id, kind) {
  if (!id || (kind !== "approved" && kind !== "denied")) throw new Error("invalid approval decision");
  return {
    url: `/api/approvals/${encodeURIComponent(id)}/decision`,
    options: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, by: "control-plane" }) },
  };
}

export function decisionState(state, event) {
  if (event === "refresh") return state === "submitting" ? state : "idle";
  if (state === "idle" && event === "submit") return "submitting";
  if (state === "submitting" && event === "success") return "submitted";
  if (state === "submitting" && event === "failure") return "error";
  return state;
}

function classTag(klass) {
  const tone = ({ r0: "ok", r1: "info", r2: "warn", r3: "bad" })[klass.toLowerCase()];
  return `<span class="chip" data-tone="${tone ?? "bad"}">${escapeHtml(klass.toUpperCase())} (${tone ?? "unclassified"})</span>`;
}

export function renderFeed(entries, error) {
  if (error) return `<tr><td colspan="6">${errorHtml(error)}</td></tr>`;
  if (entries.length === 0) return '<tr><td colspan="6">No ledger entries in this view.</td></tr>';
  return entries.map(entry => `<tr><td>${escapeHtml(entry.seq)}</td><td>${escapeHtml(entry.at)}</td><td>${escapeHtml(entry.tool)}</td><td>${classTag(entry.klass)}</td><td>${escapeHtml(entry.decision)}</td><td class="digest">${escapeHtml(entry.digest.slice(0, 12))}...</td></tr>`).join("");
}

export function renderApprovals(records, now, states = new Map(), error) {
  if (error) return errorHtml(error);
  const pending = records.filter(record => record.status === "pending");
  if (pending.length === 0) return '<p class="empty">No pending holds.</p>';
  return pending.map(record => {
    const remaining = Math.max(0, Math.ceil((expiry(record.expiresAt) - now) / 1000));
    const disabled = remaining === 0 || (states.get(record.holdId) ?? "idle") !== "idle";
    const tool = escapeHtml(record.call.tool);
    const buttons = [["approved", "Approve"], ["denied", "Deny"]].map(([kind, label]) => `<button class="secondary" type="button" data-hold-id="${escapeHtml(record.holdId)}" data-decision="${kind}" aria-label="${label} ${tool}"${disabled ? " disabled" : ""}>${label}</button>`).join("");
    return `<article class="card">${classTag(record.call.klass)}<h2>${tool}</h2><p>Hold: <code>${escapeHtml(record.holdId)}</code></p><p>Workspace: ${escapeHtml(record.call.workspace ?? "not provided")}</p><p>Blast radius: ${escapeHtml(record.call.blastRadius ?? "not measured")}</p><p class="muted">Policy rationale is not included in this API response.</p><p>${remaining === 0 ? "Expired, awaiting server refresh" : `${remaining} seconds remaining`}</p><div class="actions">${buttons}</div></article>`;
  }).join("");
}

export function renderVerification(result, error) {
  if (!error && result?.ok === true && result?.verified === true && Number.isInteger(result.checked) && result.checked >= 0) {
    const scope = result.signed === true ? "chain ok, signatures checked" : "chain ok, signatures NOT checked";
    return `<span data-tone="ok">${scope}: ${result.checked} records checked</span>`;
  }
  if (!error && result?.ok === true && result?.integrity === true && Number.isInteger(result.checked) && result.checked >= 0) {
    return `<span data-tone="warn">integrity only: hash chain agrees but no signature key was configured, so a rewritten copy could still look like this</span>`;
  }
  return `<span class="error" role="alert">VERIFICATION FAILED: ${escapeHtml(error ?? result?.reason ?? "no positive verification result")}</span>`;
}

function validateFeed(body) {
  if (body?.verified !== true || !Array.isArray(body.entries) || !body.entries.every(entry => Number.isInteger(entry?.seq) && ["at", "tool", "klass", "decision", "digest"].every(key => typeof entry[key] === "string" && entry[key] !== ""))) throw new Error("Invalid or unverified feed response");
  return body.entries;
}

function validateApprovals(body) {
  if (!Array.isArray(body?.approvals) || !body.approvals.every(record => typeof record?.holdId === "string" && record.holdId !== "" && ["pending", "approved", "denied", "expired"].includes(record.status) && Number.isFinite(expiry(record.expiresAt)) && typeof record.call?.tool === "string" && typeof record.call?.klass === "string")) throw new Error("Invalid approvals response");
  return body.approvals;
}

export function createApp({ document, fetch, now, timer, page, workspace, limit = 50 }) {
  const states = new Map();
  let approvals = [];
  let entries = [];
  let feedSigned = false;
  let approvalsError;
  let interval;
  let refreshing = false;
  let stopped = false;
  const pending = new Set();
  const setHtml = (id, html) => { const node = document.getElementById(id); if (node && !stopped) node.innerHTML = html; };
  const setText = (id, text) => { const node = document.getElementById(id); if (node && !stopped) node.textContent = text; };
  const drawApprovals = () => {
    const focused = document.activeElement?.dataset;
    setHtml("approvals-list", renderApprovals(approvals, now(), states, approvalsError));
    // Polling must not steal keyboard focus from an operator reviewing a hold.
    if (focused?.holdId) {
      const buttons = document.getElementById("approvals-list")?.querySelectorAll("button") ?? [];
      for (const button of buttons) if (!button.disabled && button.dataset.holdId === focused.holdId && button.dataset.decision === focused.decision) button.focus();
    }
  };
  function drawFeed() {
    const klass = document.getElementById("class-filter")?.value ?? "";
    const decision = document.getElementById("decision-filter")?.value ?? "";
    setHtml("feed-scope", feedSigned
      ? '<span data-tone="ok">feed verified with signatures checked against the configured key</span>'
      : '<span data-tone="warn">feed shows hash chain integrity only: no signature key is configured, so a rewritten copy of the ledger could still present these entries</span>');
    setHtml("feed-list", renderFeed(entries.filter(entry => (!klass || entry.klass.toLowerCase() === klass) && (!decision || entry.decision.split(":")[0] === decision))));
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), ...options });
    if (!response.ok) throw new Error(`HTTP ${response.status}. Data could not be loaded.`);
    return response.json();
  }
  async function pollFeed(selectedWorkspace = workspace, selectedLimit = limit) {
    if (pending.has("feed")) return false;
    pending.add("feed");
    try {
      const body = await request(feedUrl(selectedWorkspace, selectedLimit));
      entries = validateFeed(body);
      feedSigned = body.signed === true;
      drawFeed();
      return true;
    } catch (error) {
      entries = [];
      feedSigned = false;
      setHtml("feed-list", renderFeed([], errorMessage(error)));
      return false;
    } finally { pending.delete("feed"); }
  }
  async function pollApprovals() {
    if (pending.has("approvals")) return false;
    pending.add("approvals");
    // A GET started before the POST finished cannot unlock that decision.
    const completed = [...states].filter(([, state]) => state !== "submitting");
    try {
      approvals = validateApprovals(await request("/api/approvals"));
      if (workspace) approvals = approvals.filter(record => record.call.workspace === workspace);
      for (const [id, state] of completed) if (states.get(id) === state) states.set(id, decisionState(state, "refresh"));
      approvalsError = undefined;
      drawApprovals();
      return true;
    } catch (error) {
      approvals = [];
      approvalsError = errorMessage(error);
      drawApprovals();
      return false;
    } finally { pending.delete("approvals"); }
  }
  async function verifyIndicator() {
    if (pending.has("verify")) return false;
    pending.add("verify");
    try {
      const query = workspace ? `?${new URLSearchParams({ workspace })}` : "";
      const result = await request(`/api/ledger/verify${query}`);
      setHtml("verify-status", renderVerification(result));
      return result?.ok === true && result?.verified === true && Number.isInteger(result.checked) && result.checked >= 0;
    } catch (error) {
      setHtml("verify-status", renderVerification(null, errorMessage(error)));
      return false;
    } finally { pending.delete("verify"); }
  }
  async function decide(id, kind) {
    const record = approvals.find(record => record.holdId === id);
    const state = states.get(id) ?? "idle";
    if (state !== "idle" || record?.status !== "pending" || expiry(record.expiresAt) <= now()) return false;
    states.set(id, decisionState(state, "submit"));
    drawApprovals();
    setText("decision-status", "Submitting decision. Waiting for the API.");
    try {
      const { url, options } = decisionRequest(id, kind);
      const result = await request(url, options);
      if (result?.ok !== true || result.result !== true) throw new Error("Decision not accepted. Refresh to check the hold status.");
      states.set(id, decisionState("submitting", "success"));
      setText("decision-status", "Decision accepted by the API. Waiting for refresh.");
      return true;
    } catch (error) {
      states.set(id, decisionState("submitting", "failure"));
      setHtml("decision-status", errorHtml(errorMessage(error)));
      return false;
    } finally { drawApprovals(); }
  }
  async function refresh() {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      const work = [verifyIndicator()];
      if (page !== "approvals") work.push(pollFeed());
      if (page === "index" || page === "approvals") work.push(pollApprovals());
      const results = await Promise.all(work);
      setText("last-updated", `${results.every(Boolean) ? "Last updated" : "Last refresh failed"}: ${new Date(now()).toISOString()}. Refresh every 2 seconds.`);
    } finally { refreshing = false; }
  }
  return {
    pollFeed, pollApprovals, verifyIndicator, decide, refresh, drawFeed,
    start() {
      if (interval === undefined) interval = timer.setInterval(refresh, 2000);
      return refresh();
    },
    stop() { stopped = true; if (interval !== undefined) timer.clearInterval(interval); },
  };
}

if (typeof document !== "undefined") {
  const script = document.querySelector('script[data-page]');
  if (script) {
    const params = new URLSearchParams(window.location.search);
    const workspace = params.get("workspace") || undefined;
    const app = createApp({ document, fetch: window.fetch.bind(window), now: Date.now, timer: window, page: script.dataset.page, workspace, limit: 50 });
    document.getElementById("approvals-list")?.addEventListener("click", event => {
      const button = event.target.closest("button[data-hold-id]");
      if (button && !button.disabled) void app.decide(button.dataset.holdId, button.dataset.decision);
    });
    document.getElementById("verify-button")?.addEventListener("click", () => { void app.refresh(); });
    for (const id of ["class-filter", "decision-filter"]) document.getElementById(id)?.addEventListener("change", () => { void app.pollFeed(); });
    const input = document.getElementById("workspace");
    if (input) input.value = workspace ?? "";
    if (workspace) for (const link of document.querySelectorAll('a[href$=".html"]')) link.search = new URLSearchParams({ workspace }).toString();
    window.addEventListener("pagehide", () => app.stop(), { once: true });
    void app.start();
  }
}
