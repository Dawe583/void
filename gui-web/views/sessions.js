window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.sessions = function (root) {
  root.innerHTML = "";
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";

  function paint() {
    wrap.innerHTML = "<h2>Sessions</h2><p class='muted'>Each wrapped agent run is a session. Inspect one, or start a new mock session.</p>" +
      F.sessions.map(function (s, i) {
        return "<div class='card' style='margin-bottom:16px'><b class='mono'>" + s.id + "</b> " +
          "<span class='muted'>" + s.status + "</span><br>" +
          "<span class='muted'>host " + s.host + ", surface " + s.surface + ", transport " + s.transport + ", posture " + s.posture + "</span><br>" +
          "<span>" + s.calls + " calls, " + s.holds + " holds</span>" +
          "<div class='cta-row' style='margin-top:8px'><button class='btn-pearl btn-small' data-inspect='" + i + "'>Inspect</button></div>" +
          "<div class='feed-detail' data-detail='" + i + "' hidden></div></div>";
      }).join("") +
      "<div class='card'><h3>Start session (mock)</h3><div class='toolbar'>" +
      "<select id='ss-host' aria-label='Host'><option>Claude Code</option><option>MCP client</option></select>" +
      "<select id='ss-surface' aria-label='Surface'><option>Postgres</option><option>S3</option></select>" +
      "<select id='ss-trans' aria-label='Transport'><option>stdio</option><option>http :7777</option></select>" +
      "<button class='btn-primary btn-small' id='ss-start'>Start</button></div>" +
      "<p class='muted small'>Real command: void run. HTTP needs localhost binding, origin check, bearer token.</p></div>";
    wrap.querySelector("#ss-start").onclick = function () {
      var id = "sess-demo-" + String(F.sessions.length).padStart(2, "0");
      F.sessions.push({ id: id, agent: "demo-agent", host: wrap.querySelector("#ss-host").value, surface: wrap.querySelector("#ss-surface").value, transport: wrap.querySelector("#ss-trans").value, posture: "fail closed", status: "active", calls: 0, holds: 0 });
      if (window.VOID_TOAST) window.VOID_TOAST(id + " started, mock.");
      paint();
    };
    wrap.querySelectorAll("button[data-inspect]").forEach(function (b) {
      b.onclick = function () {
        var s = F.sessions[parseInt(b.getAttribute("data-inspect"), 10)];
        var d = wrap.querySelector("div[data-detail='" + b.getAttribute("data-inspect") + "']");
        d.hidden = !d.hidden;
        d.innerHTML = "<b class='mono'>" + s.id + "</b><br>Agent " + s.agent + ", " + s.status + ", posture " + s.posture + ".<br>" +
          "<span class='muted'>" + s.calls + " intercepted calls, " + s.holds + " holds. Transport " + s.transport + " over " + s.surface + ". Mock detail.</span>";
      };
    });
  }

  paint();
  root.appendChild(wrap);
};
