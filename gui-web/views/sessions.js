window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.sessions = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var html = "<h2>Sessions</h2><p class='muted'>Each wrapped agent run is a session. Pick one to inspect, or start a new mock session.</p>" +
    F.sessions.map(function (s) {
      return "<div class='card' style='margin-bottom:16px'><b class='mono'>" + s.id + "</b> " +
        "<span class='muted'>" + s.status + "</span><br>" +
        "<span class='muted'>host " + s.host + ", surface " + s.surface + ", transport " + s.transport + ", posture " + s.posture + "</span><br>" +
        "<span>" + s.calls + " calls, " + s.holds + " holds</span></div>";
    }).join("") +
    "<div class='card'><h3>Start session (mock)</h3><div class='toolbar'>" +
    "<select id='ss-host' aria-label='Host'><option>Claude Code</option><option>MCP client</option></select>" +
    "<select id='ss-surface' aria-label='Surface'><option>Postgres</option><option>S3</option></select>" +
    "<select id='ss-trans' aria-label='Transport'><option>stdio</option><option>http :7777</option></select>" +
    "<button class='btn-primary btn-small' id='ss-start'>Start</button></div>" +
    "<p class='muted small'>Real command: void run. HTTP needs localhost binding, origin check, bearer token.</p></div>";
  wrap.innerHTML = html;
  wrap.querySelector("#ss-start").onclick = function () {
    var id = "sess-demo-" + String(F.sessions.length).padStart(2, "0");
    F.sessions.push({ id: id, agent: "demo-agent", host: wrap.querySelector("#ss-host").value, surface: wrap.querySelector("#ss-surface").value, transport: wrap.querySelector("#ss-trans").value, posture: "fail closed", status: "active", calls: 0, holds: 0 });
    if (window.VOID_TOAST) window.VOID_TOAST(id + " started, mock.");
    window.VOID_VIEWS.sessions(root);
  };
  root.appendChild(wrap);
};
