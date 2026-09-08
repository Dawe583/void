window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.policy = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";

  function paint() {
    var html = "<h2>Policy</h2><p class='muted'>Match rules decide forward, hold, or refuse. Version one holds block.</p>" +
      F.policyRules.map(function (r, i) {
        return "<div class='card' style='margin-bottom:16px'><b>" + r.name + "</b> <span class='muted'>" + r.match + " to " + r.action + "</span><br>" +
          "<div class='toolbar'><button class='btn-pearl' data-i='" + i + "'>" + (r.on ? "Enabled, select to disable" : "Disabled, select to enable") + "</button></div></div>";
      }).join("") +
      "<div class='card'><h3>Approval channel</h3><select id='pl-ch' aria-label='Channel'><option>Control plane</option><option>CLI</option><option>Webhook (mock)</option></select></div>";
    wrap.innerHTML = html;
    wrap.querySelectorAll("button[data-i]").forEach(function (b) {
      b.onclick = function () {
        var r = F.policyRules[parseInt(b.getAttribute("data-i"), 10)];
        r.on = !r.on;
        if (window.VOID_TOAST) window.VOID_TOAST(r.name + (r.on ? " enabled" : " disabled"));
        paint();
      };
    });
  }

  paint();
  root.appendChild(wrap);
};
