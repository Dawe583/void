window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.replay = function (root) {
  root.innerHTML = "";
  var F = window.VOID_FIXTURES;
  var max = F.ledgerEntries.length;
  var wrap = document.createElement("div");
  wrap.className = "section";
  wrap.innerHTML = "<h2>Replay and attestation</h2><p class='muted'>Replay walks inverses in taint order. R3 has no inverse and stays blocked. VOID never compensates silently: preview first, commit second.</p>" +
    "<div class='card'><h3>Replay</h3><div class='toolbar'>" +
    "<label>From <input type='number' id='rp-from' value='1' min='1' max='" + max + "'></label>" +
    "<label>To <input type='number' id='rp-to' value='" + max + "' min='1' max='" + max + "'></label>" +
    "<button class='btn-primary btn-small' id='rp-run'>Preview replay</button></div><div id='rp-out'></div></div>" +
    "<div class='card' style='margin-top:16px'><h3>Attestation</h3><p class='muted'>Export a ledger slice for offline verify, without our software.</p>" +
    "<button class='btn-ghost btn-small' id='rp-exp'>Export slice</button></div>";

  var planned = 0;

  wrap.querySelector("#rp-run").onclick = function () {
    var from = Math.max(1, parseInt(wrap.querySelector("#rp-from").value, 10) || 1);
    var to = Math.min(max, parseInt(wrap.querySelector("#rp-to").value, 10) || max);
    if (from > to) {
      wrap.querySelector("#rp-out").innerHTML = "<p class='muted'>Empty range: from is after to.</p>";
      return;
    }
    var slice = F.ledgerEntries.filter(function (e) { return e.seq >= from && e.seq <= to; });
    planned = slice.length;
    var nodes = slice.map(function (e) {
      var ok = e.cls === "R0" || e.cls === "R1" || e.cls === "R2";
      return "<i class='node" + (ok ? " on" : "") + "' title='entry " + e.seq + " " + e.cls + "'></i>";
    }).join("");
    var html = "<div class='timeline running'><div class='track'>" + nodes + "</div>" +
      "<div class='timeline-labels'><span>" + from + "</span><span>" + to + "</span><span>now</span></div></div>" +
      "<table class='table'><tr><th>Seq</th><th>Step</th></tr>" + slice.map(function (e) {
      var step = e.cls === "R0" || e.cls === "R1" ? "Apply inverse of " + e.tool + " entry " + e.seq :
        e.cls === "R2" ? "Apply compensation of " + e.tool + " entry " + e.seq :
        "Blocked, " + e.tool + " entry " + e.seq + " is irreversible";
      return "<tr><td class='mono'>" + e.seq + "</td><td>" + step + "</td></tr>";
    }).join("") + "</table>" +
    "<div class='toolbar'><label><input type='checkbox' id='rp-confirm'> I reviewed the plan</label>" +
    "<button class='btn-ghost btn-small' id='rp-commit'>Commit replay</button></div>";
    wrap.querySelector("#rp-out").innerHTML = html;
    if (window.VOID_TOAST) window.VOID_TOAST("Replay preview for " + slice.length + " entries, nothing applied.");
    wrap.querySelector("#rp-commit").onclick = function () {
      if (!wrap.querySelector("#rp-confirm").checked) {
        if (window.VOID_TOAST) window.VOID_TOAST("Review the plan first, then commit.");
        return;
      }
      wrap.querySelector(".timeline").classList.remove("running");
      if (window.VOID_TOAST) window.VOID_TOAST("Replay committed for " + planned + " entries, mock run.");
    };
  };

  wrap.querySelector("#rp-exp").onclick = function () {
    var blob = new Blob([JSON.stringify({ mock: true, entries: F.ledgerEntries }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "void-attestation-mock.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    if (window.VOID_TOAST) window.VOID_TOAST("Slice exported, mock file.");
  };

  root.appendChild(wrap);
};
