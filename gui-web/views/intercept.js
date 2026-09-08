window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.intercept = function (root) {
  var F = window.VOID_FIXTURES;
  var tools = Object.keys(F.registryCases);
  var tool = "db.query";
  var wrap = document.createElement("div");
  wrap.className = "section";

  function policyFor(cls) {
    for (var i = 0; i < F.policyRules.length; i++) {
      var r = F.policyRules[i];
      if (!r.on) continue;
      if (r.match.toLowerCase().indexOf(cls.toLowerCase()) >= 0) return r;
    }
    return { name: "default, no rule matched", action: "hold" };
  }

  function paint() {
    var cases = F.registryCases[tool];
    var html = "<h2>Intercept simulator</h2><p class='muted'>One call through the full path: classify, policy, ledger preview. Mock, nothing executes.</p>" +
      "<div class='toolbar'><select id='ic-tool' aria-label='Tool'>" +
      tools.map(function (t) { return "<option" + (t === tool ? " selected" : "") + ">" + t + "</option>"; }).join("") +
      "</select></div>" +
      "<div class='card'><h3>1. Declared facts</h3><p class='muted small'>Tick facts that hold for the target.</p><div id='ic-facts'>" +
      cases.map(function (c, i) {
        return "<label style='display:block;padding:8px 0'><input type='checkbox' data-i='" + i + "'" + (i === 0 ? " checked" : "") + "> " + c.pre + "</label>";
      }).join("") + "</div></div>" +
      "<div class='card' style='margin-top:16px'><h3>2. Classification</h3><p id='ic-class'></p></div>" +
      "<div class='card' style='margin-top:16px'><h3>3. Policy</h3><p id='ic-pol'></p><p class='muted small'>First match wins by file order. No match means hold. Unknown call is R3.</p></div>" +
      "<div class='card' style='margin-top:16px'><h3>4. Ledger entry preview</h3><pre class='canonical' id='ic-json'></pre>" +
      "<div class='cta-row'><button class='btn-primary btn-small' id='ic-append'>Append to mock ledger</button></div></div>";
    wrap.innerHTML = html;
    wrap.querySelector("#ic-tool").onchange = function (e) { tool = e.target.value; paint(); };

    function evaluate() {
      var idx = -1;
      wrap.querySelectorAll("#ic-facts input").forEach(function (box) {
        if (box.checked && idx < 0) idx = parseInt(box.getAttribute("data-i"), 10);
      });
      var c = idx >= 0 ? cases[idx] : { pre: "no fact holds", cls: "R3", decision: "hold" };
      var rule = policyFor(c.cls);
      wrap.querySelector("#ic-class").innerHTML = "Case " + (idx >= 0 ? idx + 1 : "none") + " wins: <span class='badge-" + c.cls.toLowerCase() + "'>" + c.cls + "</span> " + c.decision;
      wrap.querySelector("#ic-pol").innerHTML = "Rule <b>" + rule.name + "</b> decides <b>" + rule.action + "</b>.";
      wrap.querySelector("#ic-json").textContent = JSON.stringify({ seq: F.ledgerEntries.length + 1, prev: F.ledgerEntries[F.ledgerEntries.length - 1].hash, tool: tool, class: c.cls, decision: rule.action, sig: "ed25519 mock" }, null, 2);
      return { cls: c.cls, rule: rule };
    }

    wrap.querySelectorAll("#ic-facts input").forEach(function (b) { b.onchange = evaluate; });
    var res = evaluate();
    wrap.querySelector("#ic-append").onclick = function () {
      var r = evaluate();
      var seq = F.ledgerEntries.length + 1;
      var prev = F.ledgerEntries[F.ledgerEntries.length - 1].hash;
      var hash = "m" + seq + "k" + String(seq * 7).padStart(2, "0");
      F.ledgerEntries.push({ seq: seq, hash: hash, prev: prev, sig: "OK", cls: r.cls, tool: tool, decision: r.rule.action });
      if (window.VOID_TOAST) window.VOID_TOAST("Mock entry " + seq + " appended.");
    };
  }

  paint();
  root.appendChild(wrap);
};
