window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.providers = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";

  function dot(status) {
    var c = status === "connected" ? "#30d158" : status === "standby" ? "#ff9f0a" : "#8e8e93";
    return "<span style='display:inline-block;width:8px;height:8px;border-radius:50%;background:" + c + "' aria-hidden='true'></span>";
  }

  var html = "<h2><i class='ph ph-plug' aria-hidden='true'></i> Providers</h2>" +
    "<p class='muted'>One gateway for many models, direct endpoints as fallback, local when data must stay. Keys are write only: set them, never read them back.</p>" +
    "<div class='grid grid-2'>" +
    F.providers.map(function (p, i) {
      return "<div class='card'><h3>" + dot(p.status) + " " + p.name + "</h3>" +
        "<p class='muted small'>" + p.kind + "</p>" +
        "<p class='mono small'>" + p.base + "</p>" +
        "<p><span class='key-badge'>key: " + p.key + "</span></p>" +
        "<p class='muted small'>status " + p.status + ", latency " + p.latency + ". " + p.note + "</p>" +
        "<div class='cta-row'><button class='btn-pearl btn-small' data-t='test' data-i='" + i + "'>Test connection</button>" +
        "<button class='btn-ghost btn-small' data-t='key' data-i='" + i + "'>Set key</button></div></div>";
    }).join("") + "</div>" +
    "<div class='card section'><h3>How routing uses providers</h3>" +
    "<p>BYOK endpoints first, then shared gateway capacity, then direct fallbacks. Turn fallbacks off and an outage errors instead of wandering to an unapproved provider.</p>" +
    "<p class='muted small'>Data policy applies before routing: a provider that trains on data stays ineligible even with your own key.</p></div>";
  wrap.innerHTML = html;

  wrap.querySelectorAll("button[data-t]").forEach(function (b) {
    b.onclick = function () {
      var p = F.providers[parseInt(b.getAttribute("data-i"), 10)];
      if (b.getAttribute("data-t") === "test") {
        if (window.VOID_TOAST) window.VOID_TOAST(p.status === "connected" ? p.name + " answers, mock ping " + p.latency + "." : p.name + " is " + p.status + ", nothing to ping.");
      } else {
        var v = prompt("Paste key for " + p.name + " (mock, never stored):", "");
        if (window.VOID_TOAST) window.VOID_TOAST(v ? "Key accepted for " + p.name + ", masked everywhere." : "No key entered.");
      }
    };
  });
  root.appendChild(wrap);
};
