// Hash router for VOID workbench preview. Vanilla JS, no deps.
window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_TOAST = function (msg) {
  var root = document.getElementById("toast-root");
  if (!root) return;
  var el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(function () { el.remove(); }, 3200);
};

var VIEWS = ["chat", "overview", "intercept", "live", "holds", "ledger", "registry", "policy", "providers", "models", "replay", "sessions", "connectors", "facts", "taint", "audit", "cli", "settings", "shortcuts"];

var VIEW_LABELS = { chat: "Chat", overview: "Overview", intercept: "Intercept simulator", live: "Live feed", holds: "Holds", ledger: "Ledger", registry: "Registry", policy: "Policy", providers: "Providers", models: "Models and spend", replay: "Replay", sessions: "Sessions", connectors: "Connectors", facts: "Facts and probes", taint: "Taint graph", audit: "Audit", cli: "CLI builder", settings: "Settings", shortcuts: "Shortcuts" };

var NAV_GROUPS = {
  "nav-workbench": ["chat", "overview", "intercept", "live", "holds"],
  "nav-govern": ["ledger", "registry", "policy", "replay", "taint", "audit"],
  "nav-setup": ["providers", "models", "sessions", "connectors", "facts", "cli", "settings"]
};

// Sidebar group titles, keyed by the same ids as NAV_GROUPS.
var NAV_TITLES = { "nav-workbench": "Operate", "nav-govern": "Observe", "nav-setup": "Setup" };

// Theme: dark by default, persisted in localStorage under void.theme.
function applyTheme(t) {
  document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
}
function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem("void.theme"); } catch (e) { /* storage blocked, keep dark */ }
  applyTheme(saved === "light" ? "light" : "dark");
}
function toggleTheme() {
  var next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  try { localStorage.setItem("void.theme", next); } catch (e) { /* storage blocked, session only */ }
  if (window.VOID_TOAST) window.VOID_TOAST("Theme " + next + ".");
}
// Run now, not on DOMContentLoaded: this script loads at the end of
// body, so documentElement exists and the theme lands before first
// paint of the sidebar content.
initTheme();

function currentView() {
  var h = (location.hash || "#/chat").replace("#/", "").split("?")[0];
  if (VIEWS.indexOf(h) < 0) return null;
  return h;
}

function render() {
  if (window.VOID_LIVE_STOP) { window.VOID_LIVE_STOP(); window.VOID_LIVE_STOP = null; }
  if (window.VOID_HOLDS_CLEANUP) { window.VOID_HOLDS_CLEANUP(); window.VOID_HOLDS_CLEANUP = null; }
  var pal = document.getElementById("palette");
  if (pal) pal.hidden = true;
  var name = currentView();
  Object.keys(NAV_GROUPS).forEach(function (gid) {
    var el = document.getElementById(gid);
    if (!el) return;
    el.innerHTML = NAV_GROUPS[gid].map(function (v) {
      return "<button class='side-link" + (v === name ? " active" : "") + "' data-v='" + v + "'>" + VIEW_LABELS[v] + "</button>";
    }).join("");
    el.querySelectorAll(".side-link").forEach(function (b) {
      b.onclick = function () { location.hash = "#/" + b.getAttribute("data-v"); };
    });
  });
  updateStatus();
  if (window.VOID_PAINT_SIDEBAR) window.VOID_PAINT_SIDEBAR();
  var root = document.getElementById("view-root");
  root.innerHTML = "";
  if (!name) {
    root.innerHTML = "<div class='section'><div class='card'><h2>Unknown view</h2>" +
      "<p>This link points nowhere. Pick a view from the sidebar.</p>" +
      "<div class='cta-row'><a class='btn-primary btn-small' style='text-decoration:none' href='#/chat'>Go to chat</a></div></div></div>";
    return;
  }
  var fn = window.VOID_VIEWS[name];
  if (typeof fn === "function") {
    fn(root);
  } else {
    root.innerHTML = "<div class='section'><div class='card'><p>View " + name + " is not loaded.</p></div></div>";
  }
}

function updateStatus() {
  var F = window.VOID_FIXTURES;
  var lh = document.getElementById("status-ledger");
  if (lh && F) lh.textContent = "ledger height " + F.ledgerEntries.length;
  var ch = document.getElementById("status-chain");
  if (ch) ch.textContent = window.VOID_LAST_VERIFY || "chain not verified";
  var sm = document.getElementById("status-model");
  if (sm) sm.textContent = "model " + ((F && F.routing && F.routing.def) || "n/a");
  var dot = document.getElementById("conn-dot");
  var lab = document.getElementById("conn-label");
  var keyed = window.VOID_API && window.VOID_API.hasKey();
  if (dot) dot.style.background = keyed ? "#30d158" : "#8e8e93";
  if (lab) lab.textContent = keyed ? "key set" : "no key";
}

// Boot sequence: terminal power-on lines, then reveal. Click skips.
// Reduced motion or repeat visits (void.booted) show one line only.
function boot() {
  var el = document.getElementById("boot");
  if (!el) return;
  var pre = document.getElementById("boot-lines");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen = null;
  try { seen = localStorage.getItem("void.booted"); } catch (e) { /* storage blocked */ }
  function done() {
    el.remove();
    try { localStorage.setItem("void.booted", "1"); } catch (e) { /* storage blocked */ }
  }
  el.addEventListener("click", done);
  if (reduce || seen) {
    pre.textContent = "VOID WORKBENCH\nready";
    setTimeout(done, 350);
    return;
  }
  var lines = [
    "VOID WORKBENCH v0.1",
    "> ledger chain ............ <span class='ok'>SEALED</span>",
    "> policy .................. <span class='ok'>ENFORCED</span>",
    "> proxy ................... <span class='warn'>MOCK</span>",
    "> provider key ............ " + (window.VOID_API && window.VOID_API.hasKey() ? "<span class='ok'>SET</span>" : "<span class='warn'>MISSING</span>"),
    "ready"
  ];
  var i = 0;
  pre.innerHTML = "";
  var timer = setInterval(function () {
    if (!document.body.contains(el) || i >= lines.length) { clearInterval(timer); return; }
    pre.innerHTML += lines[i] + "\n";
    i++;
    if (i >= lines.length) { clearInterval(timer); setTimeout(done, 450); }
  }, 180);
}

function openPalette() {
  var pal = document.getElementById("palette");
  pal.hidden = false;
  var input = document.getElementById("palette-input");
  input.value = "";
  paintPalette("", 0);
  input.focus();
}

var PAL_SEL = 0;
function paletteRows(q) {
  var views = VIEWS.filter(function (v) {
    return (VIEW_LABELS[v] + v).toLowerCase().indexOf(q.toLowerCase()) >= 0;
  }).map(function (v) { return { label: VIEW_LABELS[v], sub: "#/" + v, run: function () { location.hash = "#/" + v; } }; });
  var actions = [
    { label: "New chat", sub: "action", run: function () { location.hash = "#/chat"; setTimeout(function () { if (window.VOID_VIEWS.chat) { var c = window.VOID_CHATS.create((window.VOID_FIXTURES.routing || {}).def || "z-ai/glm-5.3"); location.hash = "#/chat?" + c.id; } }, 50); } },
    { label: "Verify ledger chain", sub: "action", run: function () { location.hash = "#/ledger"; } },
    { label: "Export attestation", sub: "action", run: function () { location.hash = "#/audit"; } },
    { label: "Open holds queue", sub: "action", run: function () { location.hash = "#/holds"; } },
    { label: "Toggle theme", sub: "action", run: function () { toggleTheme(); } }
  ].filter(function (a) { return !q || a.label.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
  return views.concat(actions);
}

function paintPalette(q, sel) {
  PAL_SEL = sel || 0;
  var rows = paletteRows(q);
  var list = document.getElementById("palette-list");
  list.innerHTML = rows.map(function (r, i) {
    return "<button class='pal-row" + (i === PAL_SEL ? " sel" : "") + "' data-i='" + i + "'><b>" + r.label + "</b> <span class='muted'>" + r.sub + "</span></button>";
  }).join("") || "<p class='muted'>No match.</p>";
  list.querySelectorAll(".pal-row").forEach(function (b) {
    b.onclick = function () {
      document.getElementById("palette").hidden = true;
      rows[parseInt(b.getAttribute("data-i"), 10)].run();
    };
  });
  list._rows = rows;
}

function typing() {
  var t = document.activeElement;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
}

document.addEventListener("keydown", function (e) {
  var pal = document.getElementById("palette");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (pal.hidden) openPalette(); else pal.hidden = true;
    return;
  }
  if (!pal.hidden) {
    var input = document.getElementById("palette-input");
    var rows = document.getElementById("palette-list")._rows || [];
    if (e.key === "Escape") { pal.hidden = true; return; }
    if (e.key === "Enter") {
      e.preventDefault();
      pal.hidden = true;
      if (rows[PAL_SEL]) rows[PAL_SEL].run();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var n = rows.length;
      if (!n) return;
      PAL_SEL = e.key === "ArrowDown" ? (PAL_SEL + 1) % n : (PAL_SEL - 1 + n) % n;
      paintPalette(input.value, PAL_SEL);
      return;
    }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    var def = ((window.VOID_FIXTURES || {}).routing || {}).def || "z-ai/glm-5.3";
    var c = window.VOID_CHATS.create(def);
    location.hash = "#/chat?" + c.id;
    return;
  }
  if ((e.metaKey || e.ctrlKey) && ["1", "2", "3", "4"].indexOf(e.key) >= 0 && !typing()) {
    var jump = { 1: "chat", 2: "holds", 3: "ledger", 4: "replay" }[e.key];
    e.preventDefault();
    location.hash = "#/" + jump;
    return;
  }
  if (e.key === "Escape" && window.VOID_STOP) { window.VOID_STOP(); return; }
  if ((e.key === "?" || (e.shiftKey && e.key === "/")) && !typing()) {
    location.hash = "#/shortcuts";
  }
});

document.addEventListener("input", function (e) {
  if (e.target && e.target.id === "palette-input") paintPalette(e.target.value, 0);
});

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", function () {
  boot();
  render();
  var po = document.getElementById("palette-open");
  if (po) po.onclick = openPalette;
  var tt = document.getElementById("theme-toggle");
  if (tt) tt.onclick = toggleTheme;
  var sn = document.getElementById("side-new");
  if (sn) sn.onclick = function () {
    var def = ((window.VOID_FIXTURES || {}).routing || {}).def || "z-ai/glm-5.3";
    var c = window.VOID_CHATS.create(def);
    location.hash = "#/chat?" + c.id;
  };
  var ss = document.getElementById("side-search");
  if (ss) ss.addEventListener("input", function () {
    if (window.VOID_PAINT_SIDEBAR) window.VOID_PAINT_SIDEBAR();
  });
  var st = document.getElementById("side-toggle");
  if (st) st.onclick = function () { document.body.classList.toggle("side-open"); };
});
