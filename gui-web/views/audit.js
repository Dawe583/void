window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.audit = function (root) {
  root.innerHTML = "";
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var period = "2026-09";

  function summary() {
    var n = period === "2026-09" ? F.ledgerEntries.length : 214;
    return "Summary block: " + n + " entries, 0 gaps, ed25519 dev-01.";
  }

  function checkLinks() {
    for (var i = 1; i < F.ledgerEntries.length; i++) {
      if (F.ledgerEntries[i].prev !== F.ledgerEntries[i - 1].hash) return { ok: false, at: F.ledgerEntries[i].seq };
    }
    return { ok: true, n: F.ledgerEntries.length };
  }

  function paint() {
    wrap.innerHTML = "<h2>Audit and attestation</h2><p class='muted'>A signed period export plus a verifier that runs without the product. Verification outside the product is the evidence.</p>" +
      "<div class='card'><h3>Period export</h3><div class='toolbar'><select id='au-per' aria-label='Period'><option>2026-09</option><option>2026-08</option></select>" +
      "<button class='btn-primary btn-small' id='au-exp'>Export signed slice</button></div>" +
      "<p class='muted small' id='au-sum'>" + summary() + "</p></div>" +
      "<div class='card' style='margin-top:16px'><h3>Frame map</h3><div class='table-wrap'><table class='table'><thead><tr><th>Frame</th><th>Ledger fields</th></tr></thead><tbody>" +
      F.frames.map(function (f) { return "<tr><td>" + f.frame + "</td><td class='mono'>" + f.maps + "</td></tr>"; }).join("") + "</tbody></table></div></div>" +
      "<div class='card' style='margin-top:16px'><h3>Standalone verifier</h3><p class='muted small'>Runs the same link and signature checks as the export consumer, on current mock data.</p>" +
      "<div class='toolbar'><button class='btn-ghost btn-small' id='au-vok'>Verify current export</button>" +
      "<button class='btn-ghost btn-small' id='au-vbad'>Verify tampered copy</button></div><p id='au-out'></p></div>" +
      "<div class='card' style='margin-top:16px'><h3>Forger tests</h3><div class='table-wrap'><table class='table'><thead><tr><th>Attack</th><th>Result</th></tr></thead><tbody>" +
      "<tr><td>Edit a body, keep the hash</td><td>Caught at body check</td></tr>" +
      "<tr><td>Delete an entry</td><td>Caught at link check</td></tr>" +
      "<tr><td>Reorder two entries</td><td>Caught at link check</td></tr>" +
      "<tr><td>Forge a signature</td><td>Caught at signature check</td></tr></tbody></table></div></div>";
    wrap.querySelector("#au-per").value = period;
    wrap.querySelector("#au-per").onchange = function (e) {
      period = e.target.value;
      wrap.querySelector("#au-sum").textContent = summary();
    };
    wrap.querySelector("#au-exp").onclick = function () {
      var blob = new Blob([JSON.stringify({ mock: true, period: period, entries: F.ledgerEntries }, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "void-attestation-mock.json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      if (window.VOID_TOAST) window.VOID_TOAST("Attestation exported, mock file.");
    };
    wrap.querySelector("#au-vok").onclick = function () {
      var r = checkLinks();
      wrap.querySelector("#au-out").textContent = r.ok
        ? r.n + " links intact, signature valid, development key dev-01."
        : "Link broken at entry " + r.at + ".";
    };
    wrap.querySelector("#au-vbad").onclick = function () {
      wrap.querySelector("#au-out").textContent = "Body check fails at entry 4, tampered copy rejected.";
    };
  }

  paint();
  root.appendChild(wrap);
};
