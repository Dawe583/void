window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.settings = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var html = "<h2>Settings</h2><p class='muted'>Posture, keys, policy source, approval channels. Mock edits stay in this page.</p>" +
    "<div class='card'><h3>Posture</h3><p>Fail closed: unknown tool, unclassified call, ledger failure, or bad policy file denies. Observe only is an explicit opt in, never a fallback.</p>" +
    "<div class='toolbar'><button class='btn-pearl' id='st-obs'>Observe only: off</button></div></div>" +
    "<div class='card' style='margin-top:16px'><h3>Signing keys</h3><table class='table'><tr><th>Key</th><th>Algorithm</th><th>State</th><th>Note</th></tr>" +
    F.keys.map(function (k) {
      return "<tr><td class='mono'>" + k.id + "</td><td class='mono'>" + k.alg + "</td><td>" + k.state + "</td><td>" + k.note + "</td></tr>";
    }).join("") + "</table><div class='toolbar'><button class='btn-ghost btn-small' id='st-rot'>Rotate key (mock)</button></div></div>" +
    "<div class='card' style='margin-top:16px'><h3>Policy source</h3><p class='muted small'>Strict YAML: version 1, ordered rules with stable ids, at most five match keys. Unknown key is a load error, never ignored.</p>" +
    "<textarea id='st-yaml' rows='8' style='width:100%;font-family:monospace;font-size:14px' aria-label='Policy YAML'>version: 1\nrules:\n  - id: allow-reads\n    match: {class: [R0]}\n    decision: forward\n  - id: hold-mitigable\n    match: {class: [R2]}\n    decision: hold\n  - id: hold-irreversible\n    match: {class: [R3]}\n    decision: hold\n</textarea>" +
    "<div class='toolbar'><button class='btn-primary btn-small' id='st-val'>Validate</button></div><p id='st-out' class='muted small'></p></div>" +
    "<div class='card' style='margin-top:16px'><h3>Approval channels</h3><table class='table'><tr><th>Channel</th><th>State</th></tr>" +
    "<tr><td>CLI (open source)</td><td>on</td></tr><tr><td>Control plane</td><td>on</td></tr><tr><td>Slack webhook</td><td>needs URL</td></tr><tr><td>Teams</td><td>flagged off</td></tr></table>" +
    "<div class='toolbar'><input type='text' id='st-hook' placeholder='Slack webhook URL (mock)' aria-label='Slack webhook'><button class='btn-pearl' id='st-save'>Save</button></div></div>";
  wrap.innerHTML = html;
  var obs = false;
  wrap.querySelector("#st-obs").onclick = function () {
    obs = !obs;
    wrap.querySelector("#st-obs").textContent = "Observe only: " + (obs ? "on, nothing enforced" : "off");
    if (window.VOID_TOAST) window.VOID_TOAST(obs ? "Observe only on, mock." : "Fail closed restored, mock.");
  };
  wrap.querySelector("#st-rot").onclick = function () {
    if (window.VOID_TOAST) window.VOID_TOAST("Rotation planned: dev-02, mock.");
  };
  wrap.querySelector("#st-val").onclick = function () {
    var v = wrap.querySelector("#st-yaml").value;
    var ok = v.indexOf("version: 1") >= 0 && v.indexOf("rules:") >= 0;
    wrap.querySelector("#st-out").textContent = ok ? "Policy parses: 3 rules, terminal catch all present, mock check." : "Policy invalid: version 1 and rules required.";
  };
  wrap.querySelector("#st-save").onclick = function () {
    if (window.VOID_TOAST) window.VOID_TOAST("Channel saved, mock. Real secret never leaves the server.");
    wrap.querySelector("#st-hook").value = "";
  };
  root.appendChild(wrap);
};
