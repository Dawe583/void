window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.shortcuts = function (root) {
  // Grouped keymap. Keep in sync with app.js and views/holds.js.
  var groups = [
    { title: "Chat", rows: [
      ["Cmd or Ctrl K", "Command palette"],
      ["Cmd or Ctrl N", "New chat"],
      ["Enter", "Send message"],
      ["Shift Enter", "Newline in composer"],
      ["Esc", "Stop generation, close palette or drawer"],
      ["/", "Type a slash command in the composer"],
      ["Mic button", "Voice input to composer"],
      ["+ button, drop, paste", "Attach images, PDF, DOCX, text, code"]
    ]},
    { title: "Navigation", rows: [
      ["Cmd or Ctrl 1", "Chat"],
      ["Cmd or Ctrl 2", "Holds"],
      ["Cmd or Ctrl 3", "Ledger"],
      ["Cmd or Ctrl 4", "Replay"],
      ["?", "This cheatsheet"],
      ["Up Down in palette", "Move selection, Enter confirms"]
    ]},
    { title: "Holds", rows: [
      ["j", "Next hold"],
      ["k", "Previous hold"],
      ["a", "Approve current hold"],
      ["d", "Refuse current hold"]
    ]},
    { title: "Files", rows: [
      ["Download on code block", "Generate a file with matching extension"],
      ["Download in artifact drawer", "Save the artifact with its own name"],
      ["Save file on reply", "Download the reply as markdown"]
    ]}
  ];
  var html = "<div class='section'><h2>Shortcuts</h2><p class='muted'>Keys work when the related view is active and no field has focus.</p>";
  html += groups.map(function (g) {
    return "<h3>" + g.title + "</h3><div class='card'><table class='table'><tr><th>Keys</th><th>Action</th></tr>" +
      g.rows.map(function (r) { return "<tr><td class='mono'>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") +
      "</table></div>";
  }).join("");
  root.innerHTML = html + "</div>";
};
