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

var VIEWS = ["overview", "intercept", "live", "holds", "ledger", "registry", "policy", "providers", "models", "replay", "sessions", "connectors", "facts", "taint", "audit", "cli", "settings"];

var VIEW_LABELS = { overview: "Overview", intercept: "Intercept simulator", live: "Live feed", holds: "Holds", ledger: "Ledger", registry: "Registry", policy: "Policy", providers: "Providers", models: "Models and spend", replay: "Replay", sessions: "Sessions", connectors: "Connectors", facts: "Facts and probes", taint: "Taint graph", audit: "Audit", cli: "CLI builder", settings: "Settings" };

function currentView() {
  var h = (location.hash || "#/overview").replace("#/", "");
  if (VIEWS.indexOf(h) < 0) return "overview";
  return h;
}

function render() {
  var name = currentView();
  var tabs = document.querySelectorAll(".view-tabs button");
  tabs.forEach(function (b) {
    b.setAttribute("aria-selected", b.getAttribute("data-view") === name ? "true" : "false");
    b.onclick = function () { location.hash = "#/" + b.getAttribute("data-view"); };
  });
  var root = document.getElementById("view-root");
  root.innerHTML = "";
  var fn = window.VOID_VIEWS[name];
  if (typeof fn === "function") {
    fn(root);
  } else {
    var d = document.createElement("div");
    d.className = "card";
    d.textContent = "View " + name + " is not loaded.";
    root.appendChild(d);
  }
}

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", render);

// Command palette: Cmd/Ctrl+K jumps anywhere. Esc closes.
document.addEventListener("keydown", function (e) {
  var pal = document.getElementById("palette");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    pal.hidden = !pal.hidden;
    if (!pal.hidden) { paintPalette(""); document.getElementById("palette-input").focus(); }
  } else if (e.key === "Escape" && pal && !pal.hidden) {
    pal.hidden = true;
  }
});

function paintPalette(q) {
  var list = document.getElementById("palette-list");
  var hits = VIEWS.filter(function (v) {
    return (VIEW_LABELS[v] + v).toLowerCase().indexOf(q.toLowerCase()) >= 0;
  });
  list.innerHTML = hits.map(function (v) {
    return "<button class='pal-row' data-v='" + v + "'><b>" + VIEW_LABELS[v] + "</b> <span class='muted'>#/" + v + "</span></button>";
  }).join("") || "<p class='muted'>No view matches.</p>";
  list.querySelectorAll(".pal-row").forEach(function (b) {
    b.onclick = function () {
      document.getElementById("palette").hidden = true;
      location.hash = "#/" + b.getAttribute("data-v");
    };
  });
}

document.addEventListener("input", function (e) {
  if (e.target && e.target.id === "palette-input") paintPalette(e.target.value);
});
