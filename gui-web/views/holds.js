window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.holds = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";

  function paint() {
    var pending = F.holds.filter(function (h) { return h.status === "pending"; });
    var decided = F.holds.filter(function (h) { return h.status !== "pending"; });
    var html = "<h2>Holds</h2><p class='muted'>Version one holds block the agent until decided.</p>";
    if (pending.length === 0) {
      html += "<div class='card'>Queue is clear. New holds will appear here.</div>";
    } else {
      html += pending.map(function (h) {
        return "<div class='card hold-card' style='margin-bottom:16px'><b>" + h.id + "</b> " +
          "<span class='mono'>" + h.tool + " " + h.target + "</span> " +
          "<span class='badge-" + h.cls.toLowerCase() + "'>" + h.cls + "</span>" +
          "<p>" + h.reason + " Requested " + h.requested + ", blast radius " + h.blast + ".</p>" +
          "<div class='cta-row'><button class='btn-primary btn-small' data-a='approve' data-id='" + h.id + "'>Approve</button>" +
          "<button class='btn-ghost btn-small' data-a='refuse' data-id='" + h.id + "'>Refuse</button></div></div>";
      }).join("");
    }
    if (decided.length > 0) {
      html += "<h3>Decided</h3>" + decided.map(function (h) {
        return "<div class='card' style='margin-bottom:12px'><span class='mono'>" + h.id + "</span> " + h.status + "</div>";
      }).join("");
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll("button[data-a]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-id");
        var h = F.holds.find(function (x) { return x.id === id; });
        if (h) h.status = b.getAttribute("data-a") + "d";
        if (window.VOID_TOAST) window.VOID_TOAST(id + " " + h.status);
        paint();
      };
    });
  }

  paint();
  root.appendChild(wrap);
};
