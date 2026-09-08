window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.audit = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var html = "<h2>Audit and attestation</h2><p class='muted'>A signed period export plus a verifier that runs without the product. Verification outside the product is the evidence.</p>" +
    "<div class='card'><h3>Period export</h3><div class='toolbar'><select id='au-per' aria-label='Period'><option>2026-09</option><option>2026-08</option></select>" +
    "<button class='btn-primary btn-small' id='au-exp'>Export signed slice</button></div>" +
    "<p class='muted small'>Summary block: " + F.ledgerEntries.length + " entries, 0 gaps, ed25519 dev-01.</p></div>" +
    "<div class='card' style='margin-top:16px'><h3>Frame map</h3><table class='table'><tr><th>Frame</th><th>Ledger fields</th></tr>" +
    F.frames.map(function (f) { return "<tr><td>" + f.frame + "</td><td class='mono'>" + f.maps + "</td></tr>"; }).join("") + "</table></div>" +
    "<div class='card' style='margin-top:16px'><h3>Standalone verifier (mock)</h3><p class='muted small'>Paste an export, verify links and signature locally.</p>" +
    "<div class='toolbar'><button class='btn-ghost btn-small' id='au-vok'>Verify current mock export</button>" +
    "<button class='btn-ghost btn-small' id='au-vbad'>Verify tampered copy</button></div><p id='au-out'></p></div>" +
    "<div class='card' style='margin-top:16px'><h3>Forger tests</h3><table class='table'><tr><th>Attack</th><th>Result</th></tr>" +
    "<tr><td>Edit a body, keep the hash</td><td>Caught at body check</td></tr>" +
    "<tr><td>Delete an entry</td><td>Caught at link check</td></tr>" +
    "<tr><td>Reorder two entries</td><td>Caught at link check</td></tr>" +
    "<tr><td>Forge a signature</td><td>Caught at signature check</td></tr></table></div>";
  wrap.innerHTML = html;
  wrap.querySelector("#au-exp").onclick = function () {
    var blob = new Blob([JSON.stringify({ mock: true, period: wrap.querySelector("#au-per").value, entries: F.ledgerEntries }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "void-attestation-mock.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    if (window.VOID_TOAST) window.VOID_TOAST("Attestation exported, mock file.");
  };
  wrap.querySelector("#au-vok").onclick = function () {
    wrap.querySelector("#au-out").textContent = F.ledgerEntries.length + " links intact, signature valid, development key dev-01.";
  };
  wrap.querySelector("#au-vbad").onclick = function () {
    wrap.querySelector("#au-out").textContent = "Body check fails at entry 4, tampered copy rejected.";
  };
  root.appendChild(wrap);
};
