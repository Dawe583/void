window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.ledger = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var q = "";
  var focus = false;
  var focusIdx = 0;

  function filtered() {
    if (!q) return F.ledgerEntries;
    return F.ledgerEntries.filter(function (e) {
      return (e.tool + e.hash + e.cls + e.decision).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });
  }

  function paint() {
    var list = filtered();
    if (focusIdx >= list.length) focusIdx = list.length - 1;
    if (focusIdx < 0) focusIdx = 0;
    var head = F.ledgerEntries[F.ledgerEntries.length - 1];
    var rows = list.length === 0
      ? "<tr><td colspan='6' class='muted'>No entries match.</td></tr>"
      : list.map(function (e) {
        return "<tr data-seq='" + e.seq + "' tabindex='0' style='cursor:pointer'><td class='mono'>" + e.seq + "</td><td class='mono'>" + e.hash + "</td>" +
          "<td class='mono'>" + e.prev + "</td><td>" + e.sig + "</td>" +
          "<td><span class='badge-" + e.cls.toLowerCase() + "'>" + e.cls + "</span></td><td class='mono'>" + e.tool + "</td></tr>";
      }).join("");
    wrap.innerHTML = "<h2>Ledger</h2><p class='muted'>Append only, hash chained, per entry signed. Exposes append and read, never update.</p>" +
      "<div class='grid grid-3'><div class='card'><div class='stat-num'>" + F.ledgerEntries.length + "</div><div class='muted'>height</div></div>" +
      "<div class='card'><div class='mono'>" + head.hash + "</div><div class='muted'>head hash</div></div>" +
      "<div class='card'><div class='stat-num' style='color:var(--ok)'>OK</div><div class='muted'>signatures</div></div></div>" +
      "<div class='toolbar'><input type='text' id='lg-q' placeholder='Filter tool, hash, class' value='" + q.replace(/"/g, "&quot;") + "'>" +
      "<button class='btn-pearl' id='lg-verify'>Verify chain</button>" +
      "<button class='btn-pearl' id='lg-focus'>Focus mode " + (focus ? "on" : "off") + "</button></div>";
    if (focus && list.length > 0) {
      wrap.innerHTML += "<p class='small muted'>Entry " + (focusIdx + 1) + " of " + list.length + "</p>" +
        "<div class='toolbar'><button class='btn-pearl btn-small' id='lg-prev'>Prev</button>" +
        "<button class='btn-pearl btn-small' id='lg-next'>Next</button></div>";
    }
    wrap.innerHTML += "<div class='card'><div class='table-wrap'><table class='table'><thead><tr><th>Seq</th><th>Hash</th><th>Prev</th><th>Sig</th><th>Class</th><th>Tool</th></tr></thead><tbody>" +
      rows + "</tbody></table></div></div><div id='lg-detail' style='margin-top:16px'></div>";
    var input = wrap.querySelector("#lg-q");
    input.oninput = function (e) {
      q = e.target.value;
      var pos = e.target.selectionStart;
      paint();
      var n = wrap.querySelector("#lg-q");
      n.focus();
      try { n.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
    };
    wrap.querySelector("#lg-focus").onclick = function () {
      focus = !focus;
      focusIdx = 0;
      paint();
      if (focus) showFocus();
    };
    var prev = wrap.querySelector("#lg-prev");
    if (prev) prev.onclick = function () {
      var n = filtered().length;
      focusIdx = (focusIdx - 1 + n) % n;
      paint();
      showFocus();
    };
    var next = wrap.querySelector("#lg-next");
    if (next) next.onclick = function () {
      var n = filtered().length;
      focusIdx = (focusIdx + 1) % n;
      paint();
      showFocus();
    };
    function showFocus() {
      var l = filtered();
      if (focus && l.length) show(l[focusIdx].seq);
    }
    wrap.querySelector("#lg-verify").onclick = function () {
      var bad = -1;
      for (var i = 1; i < F.ledgerEntries.length; i++) {
        if (F.ledgerEntries[i].prev !== F.ledgerEntries[i - 1].hash) { bad = F.ledgerEntries[i].seq; break; }
      }
      var msg = bad < 0
        ? "Chain links verified: " + F.ledgerEntries.length + " entries, mock check."
        : "Chain link broken at entry " + bad + ".";
      window.VOID_LAST_VERIFY = bad < 0 ? "chain verify OK" : "chain BROKEN at " + bad;
      if (window.VOID_TOAST) window.VOID_TOAST(msg);
      wrap.querySelector("#lg-detail").innerHTML = "<div class='card'><p>" + msg + "</p></div>";
      if (window.updateStatus) window.updateStatus();
      else {
        var ch = document.getElementById("status-chain");
        if (ch) ch.textContent = window.VOID_LAST_VERIFY;
      }
    };
    function show(seq) {
      var e = F.ledgerEntries.find(function (x) { return x.seq === seq; });
      if (!e) return;
      wrap.querySelector("#lg-detail").innerHTML = "<div class='card'><h3>Entry " + e.seq + "</h3>" +
        "<pre class='canonical'>{\n  \"seq\": " + e.seq + ",\n  \"hash\": \"" + e.hash + "\",\n  \"prev\": \"" + e.prev + "\",\n  \"sig\": \"" + e.sig + "\",\n  \"class\": \"" + e.cls + "\",\n  \"tool\": \"" + e.tool + "\"\n}</pre>" +
        "<p class='muted small'>Taint: entry " + e.seq + " orders after entry " + Math.max(1, e.seq - 1) + ". Mock linkage only.</p></div>";
    }
    wrap.querySelectorAll("tr[data-seq]").forEach(function (tr) {
      tr.onclick = function () { show(parseInt(tr.getAttribute("data-seq"), 10)); };
      tr.onkeydown = function (e) { if (e.key === "Enter") show(parseInt(tr.getAttribute("data-seq"), 10)); };
    });
  }

  paint();
  root.appendChild(wrap);
};
