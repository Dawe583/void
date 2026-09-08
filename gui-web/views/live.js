window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.live = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  var paused = false;
  var filter = "all";
  var extra = 0;
  var timer = null;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function rows() {
    var list = F.calls.slice();
    for (var i = 0; i < extra; i++) {
      list.push({ t: "live +" + (i + 1), tool: "fs.read", target: "/repo/mock-" + (i + 1) + ".txt", cls: "R0", decision: "forward", blast: 1, note: "Simulated tick, mock data." });
    }
    if (filter !== "all") list = list.filter(function (c) { return c.cls === filter || c.decision === filter; });
    return list.slice(-30).reverse();
  }

  function paint() {
    var list = rows();
    var html = "<div class='toolbar'><button class='btn-pearl' id='lv-pause'>" + (paused ? "Resume" : "Pause") + "</button>" +
      "<select id='lv-filter' aria-label='Filter'>" +
      ["all", "R0", "R1", "R2", "R3", "hold"].map(function (o) {
        return "<option" + (o === filter ? " selected" : "") + ">" + o + "</option>";
      }).join("") + "</select>" +
      "<span class='muted small'>" + list.length + " shown</span></div>";
    html += list.map(function (c, i) {
      return "<div class='feed-row' data-i='" + i + "'><span class='mono muted'>" + c.t + "</span> " +
        "<span class='mono'>" + c.tool + "</span> <span class='muted'>" + c.target + "</span> " +
        "<span class='badge-" + c.cls.toLowerCase() + "'>" + c.cls + "</span> <span class='muted'>" + c.decision + " b" + c.blast + "</span></div>";
    }).join("");
    wrap.innerHTML = "<div class='section'><h2>Live feed</h2><p class='muted'>Intercepted calls, newest first. Select a row for detail.</p>" + html + "<div id='lv-detail'></div></div>";
    wrap.querySelector("#lv-pause").onclick = function () { paused = !paused; paint(); };
    wrap.querySelector("#lv-filter").onchange = function (e) { filter = e.target.value; paint(); };
    wrap.querySelectorAll(".feed-row").forEach(function (row) {
      row.onclick = function () {
        var c = list[parseInt(row.getAttribute("data-i"), 10)];
        var d = wrap.querySelector("#lv-detail");
        d.innerHTML = "<div class='feed-detail'><b>" + c.tool + "</b> <span class='mono'>" + c.target + "</span><br>" +
          "Class " + c.cls + ", decision " + c.decision + ", blast radius " + c.blast + ".<br>" +
          "<span class='muted'>" + c.note + "</span></div>";
      };
    });
  }

  paint();
  root.appendChild(wrap);
  if (!reduce) {
    timer = setInterval(function () { if (!paused && document.body.contains(wrap)) { extra++; paint(); } }, 3000);
  }
};
