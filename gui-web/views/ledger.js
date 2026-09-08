window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.ledger = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var q = "";

  function filtered() {
    if (!q) return F.ledgerEntries;
    return F.ledgerEntries.filter(function (e) {
      return (e.tool + e.hash + e.cls + e.decision).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });
  }

  function paint(detail) {
    var list = filtered();
    var head = F.ledgerEntries[F.ledgerEntries.length - 1];
    var html = "<h2>Ledger</h2><p class='muted'>Append only, hash chained, per entry signed. Exposes append and read, never update.</p>" +
      "<div class='grid grid-3'><div class='card'><div class='stat-num'>" + F.ledgerEntries.length + "</div><div class='muted'>height</div></div>" +
      "<div class='card'><div class='mono'>" + head.hash + "</div><div class='muted'>head hash</div></div>" +
      "<div class='card'><div class='stat-num' style='color:var(--ok)'>OK</div><div class='muted'>signatures</div></div></div>" +
      "<div class='toolbar'><input type='text' id='lg-q' placeholder='Filter tool, hash, class' value='" + q + "'>" +
      "<button class='btn-pearl' id='lg-verify'>Verify chain</button></div>" +
      "<div class='card'><table class='table'><tr><th>Seq</th><th>Hash</th><th>Prev</th><th>Sig</th><th>Class</th><th>Tool</th></tr>" +
      list.map(function (e) {
        return "<tr data-seq='" + e.seq + "' style='cursor:pointer'><td class='mono'>" + e.seq + "</td><td class='mono'>" + e.hash + "</td>" +
          "<td class='mono'>" + e.prev + "</td><td>" + e.sig + "</td>" +
          "<td><span class='badge-" + e.cls.toLowerCase() + "'>" + e.cls + "</span></td><td class='mono'>" + e.tool + "</td></tr>";
      }).join("") + "</table></div><div id='lg-detail' style='margin-top:16px'></div>";
    wrap.innerHTML = html;
    var input = wrap.querySelector("#lg-q");
    input.oninput = function (e) { q = e.target.value; var pos = e.target.selectionStart; paint(); var n = wrap.querySelector("#lg-q"); n.focus(); n.setSelectionRange(pos, pos); };
    wrap.querySelector("#lg-verify").onclick = function () {
      var ok = true;
      for (var i = 1; i < F.ledgerEntries.length; i++) {
        if (F.ledgerEntries[i].prev !== F.ledgerEntries[i - 1].hash) { ok = false; break; }
      }
      if (window.VOID_TOAST) window.VOID_TOAST(ok ? "Chain links verified, mock check." : "Chain link broken.");
    };
    wrap.querySelectorAll("tr[data-seq]").forEach(function (tr) {
      tr.onclick = function () {
        var e = F.ledgerEntries.find(function (x) { return x.seq === parseInt(tr.getAttribute("data-seq"), 10); });
        wrap.querySelector("#lg-detail").innerHTML = "<div class='card'><h3>Entry " + e.seq + "</h3>" +
          "<pre class='canonical'>{\n  \"seq\": " + e.seq + ",\n  \"hash\": \"" + e.hash + "\",\n  \"prev\": \"" + e.prev + "\",\n  \"sig\": \"" + e.sig + "\",\n  \"class\": \"" + e.cls + "\",\n  \"tool\": \"" + e.tool + "\"\n}</pre>" +
          "<p class='muted small'>Taint: entry " + e.seq + " orders after entry " + Math.max(1, e.seq - 1) + ". Mock linkage only.</p></div>";
      };
    });
    if (detail) { var t = wrap.querySelector("tr[data-seq='" + detail + "']"); if (t) t.click(); }
  }

  paint();
  root.appendChild(wrap);
};
