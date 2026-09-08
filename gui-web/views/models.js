window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.models = function (root) {
  root.innerHTML = "";
  var F = window.VOID_FIXTURES;
  var R = F.routing;
  var U = F.usage;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var pct = Math.round(U.spent / U.budget * 100);

  var html = "<h2><i class='ph ph-cpu' aria-hidden='true'></i> Models and spend</h2>" +
    "<p class='muted'>Default model, ordered fallbacks, routing rules, and every cent accounted. Failed requests are never billed in this mock.</p>" +
    "<div class='grid grid-3'>" +
    "<div class='card'><div class='stat-num mono' style='font-size:20px'>" + R.def + "</div><div class='muted'>default model</div></div>" +
    "<div class='card'><div class='stat-num'>$" + U.spent.toFixed(2) + " <span class='muted small'>of $" + U.budget.toFixed(2) + "</span></div>" +
    "<div class='meter'><span style='width:" + pct + "%'></span></div><div class='muted'>" + U.period + ", " + pct + " percent of budget</div></div>" +
    "<div class='card'><div class='stat-num'>" + R.fallbacks.length + "</div><div class='muted'>fallbacks behind default</div></div></div>" +
    "<div class='card section'><h3>Catalog</h3><div class='table-wrap'><table class='table'><thead><tr><th>Model</th><th>Provider</th><th>Role</th><th>Context</th><th>Tools</th><th>Price in/out per 1M</th><th></th></tr></thead><tbody>" +
    F.models.map(function (m, i) {
      var isDef = m.id === R.def;
      return "<tr><td class='mono'>" + m.id + "</td><td>" + m.provider + "</td><td>" + m.tag + "</td>" +
        "<td class='mono'>" + m.ctx + "</td><td>" + m.tools + "</td><td class='mono'>" + m.price + "</td>" +
        "<td>" + (isDef ? "<span class='muted small'>default</span>" : "<button class='btn-pearl btn-small' data-m='" + i + "'>Make default</button>") + "</td></tr>";
    }).join("") + "</tbody></table></div>" +
    "<p class='muted small'>Prices mock. Free tier: default model costs nothing at this volume.</p></div>" +
    "<div class='card section'><h3>Routing rules</h3><div class='toolbar'>" +
    "<label>Sort <select id='md-sort' aria-label='Sort'><option>price</option><option>throughput</option><option>latency</option></select></label>" +
    "<label>Tier <select id='md-tier' aria-label='Tier'><option>low</option><option>medium</option><option>high</option><option>max</option></select></label>" +
    "<label>Cap $ <input id='md-cap' type='text' value='" + R.maxPrice.split(" ")[0] + "' style='max-width:90px'></label>" +
    "<label>Data <select id='md-data' aria-label='Data policy'><option>deny training use</option><option>allow</option></select></label>" +
    "<button class='btn-ghost btn-small' id='md-fb'>" + (R.allowFallbacks ? "Disable fallbacks" : "Enable fallbacks") + "</button></div>" +
    "<p class='muted small'>Fallback order: <span class='mono'>" + R.fallbacks.join(", ") + "</span>.</p></div>" +
    "<div class='grid grid-2 section'><div class='card'><h3>Spend by model</h3>" +
    U.byModel.map(function (b) {
      var w = Math.min(100, Math.round(b.cost / U.spent * 100));
      return "<p class='mono small'>" + b.model + " " + b.tokens + " $" + b.cost.toFixed(2) + "</p><div class='meter'><span style='width:" + w + "%'></span></div>";
    }).join("") + "</div>" +
    "<div class='card'><h3>Request log</h3><div class='table-wrap'><table class='table'><thead><tr><th>Time</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Status</th></tr></thead><tbody>" +
    F.requestLog.map(function (l) {
      return "<tr><td class='mono'>" + l.t + "</td><td class='mono'>" + l.model + "</td><td class='mono'>" + l.tokens + "</td><td class='mono'>" + l.cost + "</td><td>" + l.status + "</td></tr>";
    }).join("") + "</tbody></table></div><p class='muted small'>Each row records model, provider, tokens, cost, latency. No separate tracing service.</p></div></div>";
  wrap.innerHTML = html;
  wrap.querySelector("#md-sort").value = R.sort;
  wrap.querySelector("#md-tier").value = R.tier;
  wrap.querySelector("#md-data").value = R.dataPolicy;

  wrap.querySelectorAll("button[data-m]").forEach(function (b) {
    b.onclick = function () {
      var m = F.models[parseInt(b.getAttribute("data-m"), 10)];
      R.def = m.id;
      if (window.VOID_TOAST) window.VOID_TOAST("Default is now " + m.id + ", mock.");
      window.VOID_VIEWS.models(root);
    };
  });
  wrap.querySelector("#md-sort").onchange = function (e) { R.sort = e.target.value; if (window.VOID_TOAST) window.VOID_TOAST("Sort by " + R.sort + ", mock."); };
  wrap.querySelector("#md-tier").onchange = function (e) { R.tier = e.target.value; if (window.VOID_TOAST) window.VOID_TOAST("Tier " + R.tier + ", mock."); };
  wrap.querySelector("#md-cap").onchange = function (e) { R.maxPrice = e.target.value + " per 1M"; if (window.VOID_TOAST) window.VOID_TOAST("Cap $" + R.maxPrice + ", mock."); };
  wrap.querySelector("#md-data").onchange = function (e) { R.dataPolicy = e.target.value; if (window.VOID_TOAST) window.VOID_TOAST("Data policy saved, mock."); };
  wrap.querySelector("#md-fb").onclick = function () {
    R.allowFallbacks = !R.allowFallbacks;
    if (window.VOID_TOAST) window.VOID_TOAST("Fallbacks " + (R.allowFallbacks ? "on" : "off") + ", mock.");
    window.VOID_VIEWS.models(root);
  };
  root.appendChild(wrap);
};
