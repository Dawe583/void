window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.facts = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var html = "<h2>Facts and probes</h2><p class='muted'>Preconditions read declared facts. Probes replace declaration with measurement where a read exists. Every hold carries a measured number, never an estimate.</p>" +
    "<div class='card'><h3>Declared facts</h3><table class='table'><tr><th>Fact</th><th>Value</th><th>Verified</th><th>State</th></tr>" +
    F.facts.map(function (f) {
      return "<tr><td>" + f.fact + "</td><td class='mono'>" + f.value + "</td><td class='mono'>" + f.verified + "</td><td>" + f.state + "</td></tr>";
    }).join("") + "</table></div>" +
    "<div class='card' style='margin-top:16px'><h3>Probe cache</h3><table class='table'><tr><th>Target</th><th>Fact</th><th>TTL</th><th>Status</th><th>Value</th></tr>" +
    F.probeCache.map(function (p) {
      return "<tr><td class='mono'>" + p.target + "</td><td>" + p.fact + "</td><td class='mono'>" + p.ttl + "</td><td>" + p.status + "</td><td class='mono'>" + p.value + "</td></tr>";
    }).join("") + "</table>" +
    "<div class='toolbar'><button class='btn-primary btn-small' id='fc-run'>Run probe (mock)</button></div><p id='fc-out' class='muted small'></p>" +
    "<p class='muted small'>Postgres counts run as a role with no write grants, inside an aborted transaction. A failed probe falls back to declared facts and says so in the ledger.</p></div>";
  wrap.innerHTML = html;
  wrap.querySelector("#fc-run").onclick = function () {
    wrap.querySelector("#fc-out").textContent = "Probe measured 41883 rows across 3 tables in 41ms, mock result.";
    if (window.VOID_TOAST) window.VOID_TOAST("Probe finished, mock.");
  };
  root.appendChild(wrap);
};
