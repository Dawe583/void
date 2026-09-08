window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.replay = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  wrap.innerHTML = "<h2>Replay and attestation</h2><p class='muted'>Replay walks inverses in taint order. R3 has no inverse and stays blocked.</p>" +
    "<div class='card'><h3>Replay</h3><div class='toolbar'>" +
    "<label>From <input type='number' id='rp-from' value='1' min='1' max='8'></label>" +
    "<label>To <input type='number' id='rp-to' value='8' min='1' max='8'></label>" +
    "<button class='btn-primary btn-small' id='rp-run'>Run replay</button></div><div id='rp-out'></div></div>" +
    "<div class='card' style='margin-top:16px'><h3>Attestation</h3><p class='muted'>Export a ledger slice for offline verify, without our software.</p>" +
    "<button class='btn-ghost btn-small' id='rp-exp'>Export slice</button></div>";

  wrap.querySelector("#rp-run").onclick = function () {
    var from = Math.max(1, parseInt(wrap.querySelector("#rp-from").value, 10) || 1);
    var to = Math.min(8, parseInt(wrap.querySelector("#rp-to").value, 10) || 8);
    var slice = F.ledgerEntries.filter(function (e) { return e.seq >= from && e.seq <= to; });
    var html = "<table class='table'><tr><th>Seq</th><th>Step</th></tr>" + slice.map(function (e) {
      var step = e.cls === "R0" || e.cls === "R1" ? "Apply inverse of " + e.tool + " entry " + e.seq :
        e.cls === "R2" ? "Apply compensation of " + e.tool + " entry " + e.seq :
        "Blocked, " + e.tool + " entry " + e.seq + " is irreversible";
      return "<tr><td class='mono'>" + e.seq + "</td><td>" + step + "</td></tr>";
    }).join("") + "</table>";
    wrap.querySelector("#rp-out").innerHTML = html;
    if (window.VOID_TOAST) window.VOID_TOAST("Replay planned for " + slice.length + " entries, mock run.");
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
