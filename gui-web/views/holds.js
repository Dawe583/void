window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.holds = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";

  var focus = false;   // focus mode: one pending hold at a time
  var byRisk = false;  // sort: R3 first, then blast radius descending
  var focusIdx = 0;    // position in focus mode
  var listSel = 0;     // selection highlight position in list mode
  var keyHandler = null;

  function pendingList() {
    var p = F.holds.filter(function (h) { return h.status === "pending"; });
    if (!byRisk) return p;
    return p.slice().sort(function (a, b) {
      var ra = parseInt(String(a.cls).replace("R", ""), 10) || 0;
      var rb = parseInt(String(b.cls).replace("R", ""), 10) || 0;
      if (ra !== rb) return rb - ra;              // R3 first
      return (b.blast || 0) - (a.blast || 0);     // then blast desc
    });
  }

  function holdCard(h, selected) {
    var style = "margin-bottom:16px";
    if (selected) style += ";outline:2px solid var(--blue-focus);outline-offset:2px";
    return "<div class='card hold-card' style='" + style + "'><b>" + h.id + "</b> " +
      "<span class='mono'>" + h.tool + " " + h.target + "</span> " +
      "<span class='badge-" + h.cls.toLowerCase() + "'>" + h.cls + "</span>" +
      "<p>" + h.reason + " Requested " + h.requested + ", blast radius " + h.blast + ".</p>" +
      "<div class='cta-row'><button class='btn-primary btn-small' data-a='approve' data-id='" + h.id + "'>Approve</button>" +
      "<button class='btn-ghost btn-small' data-a='refuse' data-id='" + h.id + "'>Refuse</button></div></div>";
  }

  function decide(id, action) {
    var h = F.holds.find(function (x) { return x.id === id; });
    if (!h || h.status !== "pending") return;
    h.status = action + "d";
    if (window.VOID_TOAST) window.VOID_TOAST(h.id + " " + h.status);
    paint();
  }

  function currentHold() {
    var p = pendingList();
    if (!p.length) return null;
    var i = focus ? focusIdx : listSel;
    if (i >= p.length) i = p.length - 1;
    if (i < 0) i = 0;
    return p[i];
  }

  function paint() {
    var pending = pendingList();
    var decided = F.holds.filter(function (h) { return h.status !== "pending"; });
    if (focusIdx >= pending.length) focusIdx = pending.length - 1;
    if (focusIdx < 0) focusIdx = 0;
    if (listSel >= pending.length) listSel = pending.length - 1;
    if (listSel < 0) listSel = 0;

    var html = "<h2>Holds</h2><p class='muted'>Version one holds block the agent until decided.</p>";
    html += "<div class='toolbar'>" +
      "<button class='btn-pearl btn-small' id='holds-focus'>Focus mode " + (focus ? "on" : "off") + "</button>" +
      "<button class='btn-pearl btn-small' id='holds-risk'>Sort by risk " + (byRisk ? "on" : "off") + "</button>" +
      "<span class='muted small'>j k move, a approve, d refuse</span></div>";

    if (pending.length === 0) {
      html += "<div class='card'>Queue is clear. New holds will appear here.</div>";
    } else if (focus) {
      html += "<p class='small muted'>Hold " + (focusIdx + 1) + " of " + pending.length + "</p>";
      html += "<div class='toolbar'>" +
        "<button class='btn-pearl btn-small' id='holds-prev'>Prev</button>" +
        "<button class='btn-pearl btn-small' id='holds-next'>Next</button></div>";
      html += holdCard(pending[focusIdx], true);
    } else {
      html += pending.map(function (h, idx) { return holdCard(h, idx === listSel); }).join("");
    }

    if (decided.length > 0) {
      html += "<h3>Decided</h3>" + decided.map(function (h) {
        return "<div class='card' style='margin-bottom:12px'><span class='mono'>" + h.id + "</span> " + h.status + "</div>";
      }).join("");
    }
    wrap.innerHTML = html;

    wrap.querySelectorAll("button[data-a]").forEach(function (b) {
      b.onclick = function () { decide(b.getAttribute("data-id"), b.getAttribute("data-a")); };
    });
    var fbtn = wrap.querySelector("#holds-focus");
    if (fbtn) fbtn.onclick = function () { focus = !focus; paint(); };
    var rbtn = wrap.querySelector("#holds-risk");
    if (rbtn) rbtn.onclick = function () { byRisk = !byRisk; paint(); };
    var prev = wrap.querySelector("#holds-prev");
    if (prev) prev.onclick = function () {
      var n = pendingList().length;
      focusIdx = (focusIdx - 1 + n) % n;
      paint();
    };
    var next = wrap.querySelector("#holds-next");
    if (next) next.onclick = function () {
      var n = pendingList().length;
      focusIdx = (focusIdx + 1) % n;
      paint();
    };
  }

  // Keyboard: register on render, always remove a previous listener first.
  if (window.VOID_HOLDS_CLEANUP) window.VOID_HOLDS_CLEANUP();
  keyHandler = function (e) {
    var pal = document.getElementById("palette");
    if (pal && !pal.hidden) return;
    var t = document.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    var k = e.key;
    if (k === "j" || k === "k") {
      var p = pendingList();
      if (!p.length) return;
      e.preventDefault();
      var n = p.length;
      if (focus) {
        focusIdx = k === "j" ? (focusIdx + 1) % n : (focusIdx - 1 + n) % n;
      } else {
        listSel = k === "j" ? (listSel + 1) % n : (listSel - 1 + n) % n;
      }
      paint();
    } else if (k === "a" || k === "d") {
      var h = currentHold();
      if (!h) return;
      e.preventDefault();
      decide(h.id, k === "a" ? "approve" : "refuse");
    }
  };
  document.addEventListener("keydown", keyHandler);
  window.VOID_HOLDS_CLEANUP = function () {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
    window.VOID_HOLDS_CLEANUP = null;
  };

  paint();
  root.appendChild(wrap);
};
