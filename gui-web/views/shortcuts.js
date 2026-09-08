window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.shortcuts = function (root) {
  var rows = [
    ["Cmd or Ctrl K", "Command palette"],
    ["Cmd or Ctrl N", "New chat"],
    ["Enter", "Send message"],
    ["Shift Enter", "Newline in composer"],
    ["Esc", "Stop generation, close palette"],
    ["?", "This cheatsheet"],
    ["Up arrows in palette", "Move selection, Enter confirms"],
    ["+ button, drop, paste", "Attach images, PDF, DOCX, text, code"],
    ["Download on code block", "Generate a file with matching extension"],
    ["Save file on reply", "Download the reply as markdown"]
  ];
  root.innerHTML = "<div class='section'><h2>Shortcuts</h2><div class='card'><table class='table'><tr><th>Keys</th><th>Action</th></tr>" +
    rows.map(function (r) { return "<tr><td class='mono'>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") +
    "</table></div></div>";
};
