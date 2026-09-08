window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.taint = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var html = "<h2>Taint graph</h2><p class='muted'>Reads linked to later writes, so a replay knows its real scope. The scope is a superset of the causal set, by design.</p>" +
    "<div class='card'><h3>Edges</h3><table class='table'><tr><th>From</th><th>To</th><th>Kind</th></tr>" +
    F.taintEdges.map(function (e) {
      return "<tr><td class='mono'>" + e.from + "</td><td class='mono'>" + e.to + "</td><td>" + e.kind + "</td></tr>";
    }).join("") + "</table></div>" +
    "<div class='card' style='margin-top:16px'><h3>Scope query</h3><div class='toolbar'><select id='tn-pick' aria-label='Write'>" +
    F.taintEdges.map(function (e, i) { return "<option value='" + i + "'>" + e.from + " to " + e.to + "</option>"; }).join("") +
    "</select><button class='btn-primary btn-small' id='tn-run'>Compute scope</button></div><div id='tn-out'></div>" +
    "<p class='muted small'>Scope size against ledger size guards superset drift. A scope that covers everything is useless.</p></div>";
  wrap.innerHTML = html;
  wrap.querySelector("#tn-run").onclick = function () {
    var i = parseInt(wrap.querySelector("#tn-pick").value, 10);
    var picked = F.taintEdges[i].to;
    var downstream = F.taintEdges.filter(function (e) { return e.from === picked; });
    var txt = downstream.length === 0 ?
      "Scope of " + picked + ": 0 downstream writes in mock data." :
      "Scope of " + picked + ": " + downstream.length + " downstream, including " + downstream.map(function (d) { return d.to; }).join(", ") + ".";
    wrap.querySelector("#tn-out").innerHTML = "<p>" + txt + "</p><p class='muted small'>Mock query. Real scope counts R3 members separately.</p>";
  };
  root.appendChild(wrap);
};
