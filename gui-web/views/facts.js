window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.facts = function (root) {
  root.innerHTML = "";
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";

  function paint() {
    wrap.innerHTML = "<h2>Facts and probes</h2><p class='muted'>Preconditions read declared facts. Probes replace declaration with measurement where a read exists. Every hold carries a measured number, never an estimate.</p>" +
      "<div class='card'><h3>Declared facts</h3><div class='table-wrap'><table class='table'><thead><tr><th>Fact</th><th>Value</th><th>Verified</th><th>State</th><th></th></tr></thead><tbody>" +
      F.facts.map(function (f, i) {
        return "<tr><td>" + f.fact + "</td><td class='mono'>" + f.value + "</td><td class='mono'>" + f.verified + "</td><td>" + f.state + "</td>" +
          "<td><button class='btn-pearl btn-small' data-re='" + i + "'>Reverify</button></td></tr>";
      }).join("") + "</tbody></table></div></div>" +
      "<div class='card' style='margin-top:16px'><h3>Probe cache</h3><div class='table-wrap'><table class='table'><thead><tr><th>Target</th><th>Fact</th><th>TTL</th><th>Status</th><th>Value</th></tr></thead><tbody>" +
      F.probeCache.map(function (p) {
        return "<tr><td class='mono'>" + p.target + "</td><td>" + p.fact + "</td><td class='mono'>" + p.ttl + "</td><td>" + p.status + "</td><td class='mono'>" + p.value + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      "<div class='toolbar'><button class='btn-primary btn-small' id='fc-run'>Run probe (mock)</button></div><p id='fc-out' class='muted small'></p>" +
      "<p class='muted small'>Postgres counts run as a role with no write grants, inside an aborted transaction. A failed probe falls back to declared facts and says so in the ledger.</p></div>";
    wrap.querySelectorAll("button[data-re]").forEach(function (b) {
      b.onclick = function () {
        var f = F.facts[parseInt(b.getAttribute("data-re"), 10)];
        f.state = "fresh";
        f.verified = "2026-09-08";
        if (window.VOID_TOAST) window.VOID_TOAST(f.fact + " reverified, mock.");
        paint();
      };
    });
    wrap.querySelector("#fc-run").onclick = function () {
      F.probeCache.unshift({ target: "DELETE FROM orders", fact: "row count", ttl: "60s", status: "fresh", value: "41883 rows in 41ms" });
      if (window.VOID_TOAST) window.VOID_TOAST("Probe finished, mock.");
      paint();
      wrap.querySelector("#fc-out").textContent = "Probe measured 41883 rows across 3 tables in 41ms, mock result.";
    };
  }

  paint();
  root.appendChild(wrap);
};
