window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.overview = function (root) {
  var F = window.VOID_FIXTURES;
  var hero = document.createElement("div");
  hero.className = "hero";
  hero.innerHTML = "<h1>Every write, reversible or accounted for</h1>" +
    "<p>VOID sits between the agent and its tools, classifies each call, and records it.</p>" +
    "<div class='cta-row'><a class='btn-primary' style='text-decoration:none' href='#/live'>Open live feed</a>" +
    "<a class='btn-ghost' style='text-decoration:none' href='#/holds'>Review holds</a></div>";
  root.appendChild(hero);

  var counts = { R0: 0, R1: 0, R2: 0, R3: 0 };
  F.calls.forEach(function (c) { counts[c.cls]++; });
  var pending = F.holds.filter(function (h) { return h.status === "pending"; }).length;

  var grid = document.createElement("div");
  grid.className = "grid grid-3 section";
  grid.innerHTML =
    "<div class='card'><div class='stat-num'>" + F.calls.length + "</div><div class='muted'>intercepts this session</div></div>" +
    "<div class='card'><div class='stat-num'>" + pending + "</div><div class='muted'>holds waiting for a human</div></div>" +
    "<div class='card'><div class='stat-num'>OK</div><div class='muted'>chain verify, height " + F.ledgerEntries.length + "</div></div>";
  root.appendChild(grid);

  var dist = document.createElement("div");
  dist.className = "card section";
  dist.innerHTML = "<h3>Class mix</h3><div class='dist-strip'>" +
    "<span class='badge-r0'>R0 reversible: " + counts.R0 + "</span>" +
    "<span class='badge-r1'>R1 with trace: " + counts.R1 + "</span>" +
    "<span class='badge-r2'>R2 mitigable: " + counts.R2 + "</span>" +
    "<span class='badge-r3'>R3 irreversible: " + counts.R3 + "</span></div>" +
    "<p class='muted small'>A class belongs to a call, never to a tool.</p>";
  root.appendChild(dist);

  var recent = document.createElement("div");
  recent.className = "card section";
  var rows = F.calls.slice(-5).reverse().map(function (c) {
    return "<tr><td class='mono'>" + c.t + "</td><td class='mono'>" + c.tool + "</td>" +
      "<td><span class='badge-" + c.cls.toLowerCase() + "'>" + c.cls + "</span></td><td>" + c.decision + "</td></tr>";
  }).join("");
  recent.innerHTML = "<h3>Recent calls</h3><table class='table'><tr><th>Time</th><th>Tool</th><th>Class</th><th>Decision</th></tr>" + rows + "</table>";
  root.appendChild(recent);
};
