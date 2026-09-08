window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.registry = function (root) {
  var F = window.VOID_FIXTURES;
  var tools = Object.keys(F.registryCases);
  var tool = tools[2];
  var wrap = document.createElement("div");
  wrap.className = "section";

  function paint() {
    var cases = F.registryCases[tool];
    var html = "<h2>Registry</h2><p class='muted'>Cases are ordered, first match wins. Preconditions are declared, not probed.</p>" +
      "<div class='toolbar'><select id='rg-tool' aria-label='Tool'>" +
      tools.map(function (t) { return "<option" + (t === tool ? " selected" : "") + ">" + t + "</option>"; }).join("") +
      "</select></div>" +
      "<div class='card'><table class='table'><tr><th>#</th><th>Precondition</th><th>Class</th><th>Decision</th></tr>" +
      cases.map(function (c, i) {
        return "<tr><td class='mono'>" + (i + 1) + "</td><td>" + c.pre + "</td>" +
          "<td><span class='badge-" + c.cls.toLowerCase() + "'>" + c.cls + "</span></td><td>" + c.decision + "</td></tr>";
      }).join("") + "</table></div>" +
      "<div class='card' style='margin-top:16px'><h3>Evaluator</h3><p class='muted small'>Tick the preconditions that hold, the first match wins.</p><div id='rg-checks'>" +
      cases.map(function (c, i) {
        return "<label style='display:block;padding:8px 0'><input type='checkbox' data-i='" + i + "'> " + c.pre + "</label>";
      }).join("") + "</div><p id='rg-out'></p></div>";
    wrap.innerHTML = html;
    wrap.querySelector("#rg-tool").onchange = function (e) { tool = e.target.value; paint(); };
    var out = wrap.querySelector("#rg-out");
    function evalCases() {
      var idx = -1;
      wrap.querySelectorAll("#rg-checks input").forEach(function (box) {
        if (box.checked && idx < 0) idx = parseInt(box.getAttribute("data-i"), 10);
      });
      if (idx < 0) { out.innerHTML = "<span class='muted'>No case matched. No verdict.</span>"; return; }
      var c = cases[idx];
      out.innerHTML = "Verdict: <span class='badge-" + c.cls.toLowerCase() + "'>" + c.cls + "</span> " + c.decision + " (case " + (idx + 1) + ")";
    }
    wrap.querySelectorAll("#rg-checks input").forEach(function (b) { b.onchange = evalCases; });
    evalCases();
  }

  paint();
  root.appendChild(wrap);
};
