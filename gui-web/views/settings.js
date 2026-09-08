window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.settings = function (root) {
  root.innerHTML = "";
  var F = window.VOID_FIXTURES;
  if (!F.channels) F.channels = [
    { name: "CLI (open source)", state: "on" },
    { name: "Control plane", state: "on" },
    { name: "Slack webhook", state: "needs URL" },
    { name: "Teams", state: "flagged off" }
  ];
  var wrap = document.createElement("div");
  wrap.className = "section";
  var obs = false;

  function paint() {
    wrap.innerHTML = "<h2>Settings</h2><p class='muted'>Posture, keys, policy source, approval channels. Mock edits stay in this page.</p>" +
      "<div class='card'><h3>Posture</h3><p>Fail closed: unknown tool, unclassified call, ledger failure, or bad policy file denies. Observe only is an explicit opt in, never a fallback.</p>" +
      "<div class='toolbar'><button class='btn-pearl' id='st-obs'>Observe only: " + (obs ? "on, nothing enforced" : "off") + "</button></div></div>" +
      "<div class='card' style='margin-top:16px'><h3>Signing keys</h3><div class='table-wrap'><table class='table'><thead><tr><th>Key</th><th>Algorithm</th><th>State</th><th>Note</th></tr></thead><tbody>" +
      F.keys.map(function (k) {
        return "<tr><td class='mono'>" + k.id + "</td><td class='mono'>" + k.alg + "</td><td>" + k.state + "</td><td>" + k.note + "</td></tr>";
      }).join("") + "</tbody></table></div><div class='toolbar'><button class='btn-ghost btn-small' id='st-rot'>Rotate key (mock)</button></div></div>" +
      "<div class='card' style='margin-top:16px'><h3>Policy source</h3><p class='muted small'>Strict YAML: version 1, ordered rules with stable ids, at most five match keys. Unknown key is a load error, never ignored.</p>" +
      "<textarea id='st-yaml' rows='8' style='width:100%;font-family:monospace;font-size:14px' aria-label='Policy YAML'>version: 1\nrules:\n  - id: allow-reads\n    match: {class: [R0]}\n    decision: forward\n  - id: hold-mitigable\n    match: {class: [R2]}\n    decision: hold\n  - id: hold-irreversible\n    match: {class: [R3]}\n    decision: hold\n</textarea>" +
      "<div class='toolbar'><button class='btn-primary btn-small' id='st-val'>Validate</button></div><p id='st-out' class='muted small'></p></div>" +
      "<div class='card' style='margin-top:16px'><h3>Approval channels</h3><div class='table-wrap'><table class='table'><thead><tr><th>Channel</th><th>State</th></tr></thead><tbody>" +
      F.channels.map(function (c) { return "<tr><td>" + c.name + "</td><td>" + c.state + "</td></tr>"; }).join("") +
      "</tbody></table></div>" +
      "<div class='toolbar'><input type='text' id='st-hook' placeholder='Slack webhook URL (mock)' aria-label='Slack webhook'><button class='btn-pearl' id='st-save'>Save</button></div></div>";
    wrap.querySelector("#st-obs").onclick = function () {
      obs = !obs;
      if (window.VOID_TOAST) window.VOID_TOAST(obs ? "Observe only on, mock." : "Fail closed restored, mock.");
      paint();
    };
    wrap.querySelector("#st-rot").onclick = function () {
      F.keys.forEach(function (k) { if (k.state === "active") k.state = "retired"; });
      F.keys.unshift({ id: "dev-02", alg: "ed25519", state: "active", note: "Rotated just now, mock." });
      if (window.VOID_TOAST) window.VOID_TOAST("Rotation done: dev-02 active, mock.");
      paint();
    };
    wrap.querySelector("#st-val").onclick = function () {
      var v = wrap.querySelector("#st-yaml").value;
      var ok = v.indexOf("version: 1") >= 0 && v.indexOf("rules:") >= 0;
      wrap.querySelector("#st-out").textContent = ok ? "Policy parses: 3 rules, terminal catch all present, mock check." : "Policy invalid: version 1 and rules required.";
    };
    wrap.querySelector("#st-save").onclick = function () {
      var v = wrap.querySelector("#st-hook").value.trim();
      if (v) {
        F.channels.forEach(function (c) { if (c.name === "Slack webhook") c.state = "on"; });
        if (window.VOID_TOAST) window.VOID_TOAST("Slack channel on, mock. Real secret never leaves the server.");
      } else if (window.VOID_TOAST) window.VOID_TOAST("Paste a webhook URL first.");
      paint();
    };
  }

  paint();
  root.appendChild(wrap);
};
