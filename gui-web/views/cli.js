window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.cli = function (root) {
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "section";
  var html = "<h2>CLI builder</h2><p class='muted'>Compose void commands. Human output by default, JSON with flag. The CLI never prints a secret.</p>" +
    "<div class='card'><div class='toolbar'><select id='cl-cmd' aria-label='Command'>" +
    F.cliCommands.map(function (c, i) { return "<option value='" + i + "'>" + c.cmd + "</option>"; }).join("") +
    "</select><label><input type='checkbox' id='cl-json'> --json</label>" +
    "<button class='btn-pearl' id='cl-copy'>Copy</button></div>" +
    "<p id='cl-desc'></p><pre class='canonical' id='cl-out'></pre>" +
    "<p class='muted small'>Exit codes: 0 verified or done, nonzero on failed verify or refused replay. Verify on a dev key reports development key.</p></div>" +
    "<div class='card' style='margin-top:16px'><h3>All commands</h3><table class='table'><tr><th>Command</th><th>What</th><th>Example</th></tr>" +
    F.cliCommands.map(function (c) {
      return "<tr><td class='mono'>" + c.cmd + "</td><td>" + c.desc + "</td><td class='mono'>" + c.ex + "</td></tr>";
    }).join("") + "</table></div>";
  wrap.innerHTML = html;
  function paint() {
    var c = F.cliCommands[parseInt(wrap.querySelector("#cl-cmd").value, 10)];
    var json = wrap.querySelector("#cl-json").checked ? " --json" : "";
    wrap.querySelector("#cl-desc").textContent = c.desc;
    wrap.querySelector("#cl-out").textContent = c.ex + json;
  }
  wrap.querySelector("#cl-cmd").onchange = paint;
  wrap.querySelector("#cl-json").onchange = paint;
  wrap.querySelector("#cl-copy").onclick = function () {
    var t = wrap.querySelector("#cl-out").textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(t);
    if (window.VOID_TOAST) window.VOID_TOAST("Command copied.");
  };
  paint();
  root.appendChild(wrap);
};
