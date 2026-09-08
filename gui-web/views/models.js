window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.models = function (root) {
  var F = window.VOID_FIXTURES;
  var R = F.routing;
  var U = F.usage;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var pct = Math.round(U.spent / U.budget * 100);

  var html = "<h2><i class='ph ph-cpu' aria-hidden='true'></i> Models and spend</h2>" +
    "<p class='muted'>Default model, ordered fallbacks, routing rules, and every cent accounted. Failed requests are never billed in this mock.</p>" +
    "<div class='grid grid-3'>" +
    "<div class='card'><div class='stat-num small-mono mono'>" + R.def + "</div><div class='muted'>default model</div></div>" +
    "<div class='card'><div class='stat-num'>$" + U.spent.toFixed(2) + " <span class='muted small'>of $" + U.budget.toFixed(2) + "</span></div>" +
    "<div class='meter'><span style='width:" + pct + "'></span></div><div class='muted'>" + U.period + ", " + pct + " percent of budget</div></div>" +
    "<div class='card'><div class='stat-num'>" + R.fallbacks.length + "</div><div class='muted'>fallbacks behind default</div></div></div>" +
    "<div class='card section'><h3>Catalog</h3><table class='table'><tr><th>Model</th><th>Provider</th><th>Role</th><th>Context</th><th>Tools</th><th>Price in/out per 1M</th><th></th></tr>" +
    F.models.map(function (m, i) {
      var isDef = m.id === R.def;
      return "<tr><td class='mono'>" + m.id + "</td><td>" + m.provider + "</td><td>" + m.tag + "</td>" +
        "<td class='mono'>" + m.ctx + "</td><td>" + m.tools + "</td><td class='mono'>" + m.price + "</td>" +
        "<td>" + (isDef ? "<span class='muted small'>default</span>" : "<button class='btn-pearl btn-small' data-m='" + i + "'>Make default</button>") + "</td></tr>";
    }).join("") + "</table>" +
    "<p class='muted small'>Prices mock. Free tier: default model costs nothing at this volume.</p></div>" +
    "<div class='card section'><h3>Routing rules</h3><table class='table'>" +
    "<tr><td>Sort providers by</td><td class='mono'>" + R.sort + "</td></tr>" +
    "<tr><td>Allow fallbacks</td><td class='mono'>" + (R.allowFallbacks ? "yes" : "no") + "</td></tr>" +
    "<tr><td>Fallback order</td><td class='mono'>" + R.fallbacks.join(", ") + "</td></tr>" +
    "<tr><td>Cost tier</td><td class='mono'>" + R.tier + "</td></tr>" +
    "<tr><td>Price cap</td><td class='mono'>$" + R.maxPrice + "</td></tr>" +
    "<tr><td>Data policy</td><td class='mono'>" + R.dataPolicy + "</td></tr></table>" +
    "<div class='toolbar'><button class='btn-ghost btn-small' id='md-fb'>" + (R.allowFallbacks ? "Disable fallbacks" : "Enable fallbacks") + "</button></div></div>" +
    "<div class='grid grid-2 section'><div class='card'><h3>Spend by model</h3>" +
    U.byModel.map(function (b) {
      var w = Math.min(100, Math.round(b.cost / U.spent * 100));
      return "<p class='mono small'>" + b.model + " " + b.tokens + " $" + b.cost.toFixed(2) + "</p><div class='meter'><span style='width:" + w + "'></span></div>";
    }).join("") + "</div>" +
    "<div class='card'><h3>Request log</h3><table class='table'><tr><th>Time</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Status</th></tr>" +
    F.requestLog.map(function (l) {
      return "<tr><td class='mono'>" + l.t + "</td><td class='mono'>" + l.model + "</td><td class='mono'>" + l.tokens + "</td><td class='mono'>" + l.cost + "</td><td>" + l.status + "</td></tr>";
    }).join("") + "</table><p class='muted small'>Each row records model, provider, tokens, cost, latency. No separate tracing service.</p></div></div>";
  wrap.innerHTML = html;

  wrap.querySelectorAll("button[data-m]").forEach(function (b) {
    b.onclick = function () {
      var m = F.models[parseInt(b.getAttribute("data-m"), 10)];
      R.def = m.id;
      if (window.VOID_TOAST) window.VOID_TOAST("Default is now " + m.id + ", mock.");
      window.VOID_VIEWS.models(root);
    };
  });
  wrap.querySelector("#md-fb").onclick = function () {
    R.allowFallbacks = !R.allowFallbacks;
    if (window.VOID_TOAST) window.VOID_TOAST("Fallbacks " + (R.allowFallbacks ? "on" : "off") + ", mock.");
    window.VOID_VIEWS.models(root);
  };
  root.appendChild(wrap);
};
