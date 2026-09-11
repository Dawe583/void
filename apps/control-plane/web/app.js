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
  return entries.map(entry => `<tr><td>${escapeHtml(entry.seq)}</td><td>${escapeHtml(entry.at)}</td><td><button class="record-link" type="button" data-record="${escapeHtml(entry.seq)}" aria-label="Inspect record ${escapeHtml(entry.seq)}: ${escapeHtml(entry.tool)}">${escapeHtml(entry.tool)}</button></td><td>${classTag(entry.klass)}</td><td>${escapeHtml(entry.decision)}</td><td class="digest">${escapeHtml(entry.digest.slice(0, 12))}...</td></tr>`).join("");
}

export function renderRecord(entry, signed) {
  if (!entry) return '<p>This record is no longer in the current view. Close this panel and select another call.</p>';
  return `<h3>${escapeHtml(entry.tool)}</h3>${classTag(entry.klass)}<p>${signed ? "Signatures checked against the configured key." : "Hash integrity checked. Signatures have not been checked."}</p><dl>${[
    ["Record", entry.seq], ["Decision", entry.decision], ["Recorded at", entry.at],
    ["Entry digest", entry.digest], ["Previous digest", entry.prev_hash ?? entry.prevDigest ?? "Not provided"],
    ["Arguments digest", entry.argsDigest ?? "Not provided"],
  ].map(([key, value]) => `<dt>${key}</dt><dd><code>${escapeHtml(value)}</code></dd>`).join("")}</dl><p>Argument contents are not stored in this view.</p>`;
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
  if (!error && result?.setup === true) return '<span class="muted">No ledger yet. Start an agent session or select a workspace with recorded calls.</span>';
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
  if ((body?.verified !== true && body?.integrity !== true) || !Array.isArray(body.entries) || !body.entries.every(entry => Number.isInteger(entry?.seq) && ["at", "tool", "klass", "decision", "digest"].every(key => typeof entry[key] === "string" && entry[key] !== ""))) throw new Error("Invalid or unverified feed response");
  return body.entries;
}

function validateApprovals(body) {
  if (!Array.isArray(body?.approvals) || !body.approvals.every(record => typeof record?.holdId === "string" && record.holdId !== "" && ["pending", "approved", "denied", "expired"].includes(record.status) && Number.isFinite(expiry(record.expiresAt)) && typeof record.call?.tool === "string" && typeof record.call?.klass === "string")) throw new Error("Invalid approvals response");
  return body.approvals;
}

export function createApp({ document, fetch, now, timer, page, workspace, limit = 50 }) {
  const states = new Map();
  const queued = new Set();
  let approvals = [];
  let entries = [];
  let feedSigned = false;
  let paused = false;
  let selectedRecord;
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
    const query = (document.getElementById("activity-search")?.value ?? "").toLowerCase().trim();
    const filtered = entries.filter(entry => (!klass || entry.klass.toLowerCase() === klass) && (!decision || entry.decision.split(":")[0] === decision) && `${entry.seq} ${entry.tool} ${entry.klass} ${entry.decision}`.toLowerCase().includes(query));
    const focused = document.activeElement?.dataset?.record;
    setHtml("feed-list", renderFeed(filtered));
    setText("activity-count", `${filtered.length} of ${entries.length} records in this view${paused ? " / paused" : ""}`);
    if (focused) document.getElementById("feed-list")?.querySelector?.(`[data-record="${Number(focused)}"]`)?.focus();

  }
  async function request(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), ...options });
    if (!response.ok) {
      let body;
      try { body = await response.json(); } catch { /* Gateways may return a non-JSON error. */ }
      if (response.status === 401 || body?.error === "setup_required") {
        const panel = document.getElementById("connection-panel");
        if (panel) panel.hidden = false;
        const form = document.getElementById("connection-form");
        if (form) form.hidden = body?.error === "setup_required";
        setText("connection-message", body?.message ?? "Connect your workspace to load its records.");
      }
      const error = new Error(body?.message ?? `HTTP ${response.status}. Data could not be loaded.`);
      error.emptyLedger = body?.error === "ledger_not_found";
      throw error;
    }
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
      if (error.emptyLedger) {
        setText("feed-scope", "No calls recorded in this workspace yet.");
        setText("activity-count", "0 records");
        setHtml("feed-list", renderFeed([]));
        return true;
      }
      setHtml("feed-scope", "Ledger verification is unavailable. Refresh to retry.");
      setText("activity-count", "Activity unavailable");
      setHtml("record-details", "<p>Ledger unavailable. Close this panel and retry the connection.</p>");
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
      for (const [id, state] of completed) if (!queued.has(id) && states.get(id) === state) states.set(id, decisionState(state, "refresh"));
      for (const id of queued) if (!approvals.some(record => record.holdId === id)) queued.delete(id);
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
      return result?.setup === true || (result?.ok === true && result?.verified === true && Number.isInteger(result.checked) && result.checked >= 0);
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
      if (result?.ok !== true || (result.result !== true && result.result?.queued !== true)) throw new Error("Decision not accepted. Refresh to check the hold status.");
      if (result.result?.queued) queued.add(id);
      states.set(id, decisionState("submitting", "success"));
      setText("decision-status", result.result?.queued ? "Decision queued. Waiting for the proxy to resolve the hold." : "Decision accepted by the API. Waiting for refresh.");
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
      if (page !== "approvals" && !paused) work.push(pollFeed());
      if (page === "index" || page === "approvals") work.push(pollApprovals());
      const results = await Promise.all(work);
      setText("last-updated", `${results.every(Boolean) ? "Last updated" : "Last refresh failed"}: ${new Date(now()).toISOString()}. Refresh every 2 seconds.`);
    } finally { refreshing = false; }
  }
  return {
    pollFeed, pollApprovals, verifyIndicator, decide, refresh, drawFeed,
    inspect(seq) { selectedRecord = Number(seq); setHtml("record-details", renderRecord(entries.find(entry => entry.seq === selectedRecord), feedSigned)); },
    async recordAction(action, apply = false) {
      if (selectedRecord === undefined) return;
      const record = entries.find(entry => entry.seq === selectedRecord);
      if (!record) return;
      setText("record-action-result", "Loading...");
      try {
        const query = workspace ? `?${new URLSearchParams({ workspace })}` : "";
        const body = await request(`/api/records/${selectedRecord}/${action}${query}`, apply ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest: record.digest }) } : {});
        if (action === "taint") {
          setText("record-action-result", `${body.note}\n\n${body.nodes.map(node => `#${node.seq} ${node.tool}`).join("\n")}\n\n${body.edges.length} tracked dependency edges. This is recorded context, not proof of causation.`);
        } else {
          setText("record-action-result", body.lines.join("\n"));
          const button = document.getElementById("replay-apply");
          if (button) { button.hidden = apply; button.disabled = !feedSigned; }
        }
      } catch (error) { setText("record-action-result", errorMessage(error)); }
    },
    togglePause() { paused = !paused; drawFeed(); return paused; },
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
    for (const id of ["class-filter", "decision-filter"]) document.getElementById(id)?.addEventListener("change", app.drawFeed);
    document.getElementById("activity-search")?.addEventListener("input", app.drawFeed);
    document.getElementById("pause-feed")?.addEventListener("click", event => {
      const paused = app.togglePause();
      event.currentTarget.textContent = paused ? "Resume activity" : "Pause activity";
      event.currentTarget.setAttribute("aria-pressed", String(paused));
      if (!paused) void app.pollFeed();
    });
    document.getElementById("record-taint")?.addEventListener("click", () => { void app.recordAction("taint"); });
    document.getElementById("replay-preview")?.addEventListener("click", () => { void app.recordAction("replay"); });
    document.getElementById("replay-apply")?.addEventListener("click", event => {
      if (event.currentTarget.dataset.confirm !== "true") {
        event.currentTarget.dataset.confirm = "true";
        event.currentTarget.textContent = "Confirm replay on target";
        return;
      }
      event.currentTarget.disabled = true;
      void app.recordAction("replay", true);
    });
    let inspectedRecord;
    document.getElementById("feed-list")?.addEventListener("click", event => {
      const button = event.target.closest("button[data-record]");
      if (!button) return;
      document.getElementById("record-action-result").textContent = "";
      const apply = document.getElementById("replay-apply");
      apply.hidden = true; apply.dataset.confirm = "false"; apply.textContent = "Apply previewed inverse";
      inspectedRecord = Number(button.dataset.record);
      app.inspect(button.dataset.record);
      document.getElementById("record-dialog")?.showModal();
    });
    document.getElementById("record-dialog")?.addEventListener("close", () => {
      document.querySelector(`button[data-record="${inspectedRecord}"]`)?.focus();
    });
    document.getElementById("connection-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const input = document.getElementById("access-token");
      const status = document.getElementById("connection-status");
      status.textContent = "Connecting...";
      try {
        const response = await window.fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: input.value }) });
        input.value = "";
        if (!response.ok) throw new Error("Token not accepted. Check the workspace configuration and retry.");
        document.getElementById("connection-panel").hidden = true;
        await app.refresh();
      } catch (error) { status.textContent = errorMessage(error); }
    });
    const input = document.getElementById("workspace");
    if (input) input.value = workspace ?? "";
    if (workspace) for (const link of document.querySelectorAll('a[href$=".html"]')) link.search = new URLSearchParams({ workspace }).toString();
    if (workspace && document.getElementById("export-records")) document.getElementById("export-records").search = new URLSearchParams({ workspace }).toString();
    window.addEventListener("pagehide", () => app.stop(), { once: true });
    void app.start();
  }
}
