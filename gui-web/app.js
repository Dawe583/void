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

var VIEWS = ["overview", "intercept", "live", "holds", "ledger", "registry", "policy", "replay", "sessions", "connectors", "facts", "taint", "audit", "cli", "settings"];

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
