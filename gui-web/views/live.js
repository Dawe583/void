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
    var body = list.length === 0
      ? "<p class='muted'>No calls match this filter.</p>"
      : list.map(function (c, i) {
        return "<button class='feed-row' data-i='" + i + "' style='display:block;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--divider)'><span class='mono muted'>" + c.t + "</span> " +
          "<span class='mono'>" + c.tool + "</span> <span class='muted'>" + c.target + "</span> " +
          "<span class='badge-" + c.cls.toLowerCase() + "'>" + c.cls + "</span> <span class='muted'>" + c.decision + " b" + c.blast + "</span></button>";
      }).join("");
    wrap.innerHTML = "<div class='section'><h2>Live feed</h2><p class='muted'>Intercepted calls, newest first. Select a row for detail.</p>" +
      "<div class='toolbar'><button class='btn-pearl' id='lv-pause'>" + (paused ? "Resume" : "Pause") + "</button>" +
      "<select id='lv-filter' aria-label='Filter'>" +
      ["all", "R0", "R1", "R2", "R3", "hold", "forward"].map(function (o) {
        return "<option" + (o === filter ? " selected" : "") + ">" + o + "</option>";
      }).join("") + "</select>" +
      "<button class='btn-pearl' id='lv-reset'>Reset</button>" +
      "<span class='muted small'>" + list.length + " shown</span></div>" + body + "<div id='lv-detail'></div></div>";
    wrap.querySelector("#lv-pause").onclick = function () { paused = !paused; paint(); };
    wrap.querySelector("#lv-filter").onchange = function (e) { filter = e.target.value; paint(); };
    wrap.querySelector("#lv-reset").onclick = function () { extra = 0; paint(); };
    function openDetail(btn) {
      var c = list[parseInt(btn.getAttribute("data-i"), 10)];
      wrap.querySelector("#lv-detail").innerHTML = "<div class='feed-detail'><b>" + c.tool + "</b> <span class='mono'>" + c.target + "</span><br>" +
        "Class " + c.cls + ", decision " + c.decision + ", blast radius " + c.blast + ".<br>" +
        "<span class='muted'>" + c.note + "</span></div>";
    }
    wrap.querySelectorAll(".feed-row").forEach(function (btn) {
      btn.onclick = function () { openDetail(btn); };
      btn.onkeydown = function (e) { if (e.key === "Enter") openDetail(btn); };
    });
  }

  paint();
  root.appendChild(wrap);
  function stop() { if (timer) clearInterval(timer); timer = null; }
  window.VOID_LIVE_STOP = stop;
  if (!reduce) {
    timer = setInterval(function () { if (!paused && document.body.contains(wrap) && extra < 30) { extra++; paint(); } }, 3000);
  }
};
