window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.providers = function (root) {
  root.innerHTML = "";
  var F = window.VOID_FIXTURES;
  var API = window.VOID_API;
  var wrap = document.createElement("div");
  wrap.className = "section";

  function dot(status) {
    var c = status === "connected" ? "#30d158" : status === "standby" ? "#ff9f0a" : "#8e8e93";
    return "<span style='display:inline-block;width:8px;height:8px;border-radius:50%;background:" + c + "' aria-hidden='true'></span>";
  }

  function paint() {
    var cfg = API ? API.getConfig() : { base: "", key: "" };
    wrap.innerHTML = "<h2><i class='ph ph-plug' aria-hidden='true'></i> Providers</h2>" +
      "<p class='muted'>One gateway for many models, direct endpoints as fallback, local when data must stay. Keys are write only: set them, never read them back.</p>" +
      "<div class='card'><h3>Connection</h3><div class='toolbar'>" +
      "<label>Base URL <input id='pv-base' type='text' value='" + cfg.base.replace(/"/g, "&quot;") + "' style='min-width:280px'></label>" +
      "<label>API key <input id='pv-key' type='password' placeholder='sk or or, stored in this browser' style='min-width:220px'></label>" +
      "<button class='btn-primary btn-small' id='pv-save'>Save</button>" +
      "<button class='btn-ghost btn-small' id='pv-test'>Test connection</button></div>" +
      "<p class='muted small' id='pv-msg'>" + (API && API.hasKey() ? "Key is set (masked everywhere). Requests run for real." : "No key set. Chat is disabled until you save one.") + "</p></div>" +
      "<div class='grid grid-2 section'>" +
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

    wrap.querySelector("#pv-save").onclick = function () {
      var base = wrap.querySelector("#pv-base").value.trim() || "https://openrouter.ai/api/v1";
      var key = wrap.querySelector("#pv-key").value;
      API.setConfig(base, key);
      wrap.querySelector("#pv-key").value = "";
      if (window.VOID_TOAST) window.VOID_TOAST("Connection saved in this browser.");
      if (window.updateStatus) window.updateStatus();
      paint();
    };
    wrap.querySelector("#pv-test").onclick = function () {
      var msg = wrap.querySelector("#pv-msg");
      msg.textContent = "Pinging...";
      API.testConnection().then(function (res) {
        msg.textContent = res.ok ? "Connected in " + res.ms + "ms, " + res.models + " models listed." : "Failed: " + res.error;
        if (window.VOID_TOAST) window.VOID_TOAST(res.ok ? "Provider answers." : "Provider unreachable.");
      });
    };
    wrap.querySelectorAll("button[data-t]").forEach(function (b) {
      b.onclick = function () {
        var p = F.providers[parseInt(b.getAttribute("data-i"), 10)];
        if (b.getAttribute("data-t") === "test") {
          if (p.status === "connected") {
            p.latency = (100 + Math.floor(Math.random() * 400)) + "ms (mock)";
            if (window.VOID_TOAST) window.VOID_TOAST(p.name + " answers, mock ping " + p.latency + ".");
          } else {
            if (window.VOID_TOAST) window.VOID_TOAST(p.name + " is " + p.status + ", nothing to ping.");
          }
          paint();
        } else {
          var v = prompt("Paste key for " + p.name + " (mock, never stored):", "");
          if (v) {
            p.key = "set, ends " + v.slice(-4);
            if (window.VOID_TOAST) window.VOID_TOAST("Key accepted for " + p.name + ", masked everywhere.");
            paint();
          } else if (window.VOID_TOAST) window.VOID_TOAST("No key entered.");
        }
      };
    });
  }

  paint();
  root.appendChild(wrap);
};
