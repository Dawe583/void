// Artifact drawer. One drawer at a time on the right side. Esc and the
// Close button close it. Focus lands on Close so keyboard users can
// dismiss immediately. Styling uses existing tokens and classes only.
// The head also carries two toggles: Lines (line numbers, on by
// default) and Wrap (soft wrap, off by default). Numbers are CSS
// counters on span.line, so the pre keeps textContent exactly equal
// to the artifact text and Copy, Download and manual selection never
// pick the numbers up.
window.VOID_ARTIFACTS = (function () {
  var STYLE_ID = "void-artifact-style";

  // This file owns no stylesheet, so the toggle classes pre.ln,
  // pre.wrap, pre.nowrap and span.line get their rules from one small
  // sheet injected here. Canonical tokens only, no colour literals,
  // nothing animated, so both themes and reduced motion stay honest.
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      ".artifact-drawer pre.ln{counter-reset:voidline}" +
      ".artifact-drawer pre.ln span.line{counter-increment:voidline}" +
      ".artifact-drawer pre.ln span.line::before{content:counter(voidline);" +
        "display:inline-block;min-width:var(--void-ln-w,3ch);margin-right:2ch;" +
        "text-align:right;color:var(--dim);-webkit-user-select:none;user-select:none}" +
      ".artifact-drawer pre.wrap{white-space:pre-wrap;" +
        "overflow-wrap:break-word;overflow-wrap:anywhere}" +
      ".artifact-drawer pre.nowrap{white-space:pre}";
    document.head.appendChild(st);
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    // Capture phase so an open drawer swallows Esc before the app level
    // handler that stops chat generation.
    e.stopPropagation();
    close();
  }

  function close() {
    var d = document.querySelector(".artifact-drawer");
    if (d) d.remove();
    document.removeEventListener("keydown", onKey, true);
  }

  function copyText(t) {
    function done() { if (window.VOID_TOAST) window.VOID_TOAST("Artifact copied."); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { if (window.VOID_TOAST) window.VOID_TOAST("Copy failed, select manually."); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, fallback);
    } else fallback();
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name; // exactly as given, no extension guessing
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (window.VOID_TOAST) window.VOID_TOAST("Artifact saved, check downloads.");
  }

  function open(art) {
    if (!art) return;
    close(); // one drawer at a time, replace any existing
    ensureStyles();
    var drawer = document.createElement("div");
    drawer.className = "artifact-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Artifact " + (art.name || "untitled"));
    drawer.style.cssText =
      "position:fixed;top:0;right:0;bottom:0;width:min(560px,92vw);" +
      "background:var(--canvas);border-left:1px solid var(--hairline);" +
      "z-index:300;display:flex;flex-direction:column;gap:16px;padding:20px;";

    var head = document.createElement("div");
    head.className = "artifact-head";
    head.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;";
    var nameEl = document.createElement("span");
    nameEl.className = "mono";
    nameEl.textContent = art.name || "untitled";
    var langEl = document.createElement("span");
    langEl.className = "muted small";
    langEl.textContent = art.lang || "text";
    var spacer = document.createElement("span");
    spacer.style.flex = "1";
    var linesBtn = document.createElement("button");
    linesBtn.className = "btn-pearl btn-small";
    linesBtn.textContent = "Lines on";
    var wrapBtn = document.createElement("button");
    wrapBtn.className = "btn-pearl btn-small";
    wrapBtn.textContent = "Wrap off";
    var copyBtn = document.createElement("button");
    copyBtn.className = "btn-pearl btn-small";
    copyBtn.textContent = "Copy";
    var dlBtn = document.createElement("button");
    dlBtn.className = "btn-pearl btn-small";
    dlBtn.textContent = "Download";
    var closeBtn = document.createElement("button");
    closeBtn.className = "btn-ghost btn-small";
    closeBtn.textContent = "Close";
    head.appendChild(nameEl);
    head.appendChild(langEl);
    head.appendChild(spacer);
    head.appendChild(linesBtn);
    head.appendChild(wrapBtn);
    head.appendChild(copyBtn);
    head.appendChild(dlBtn);
    head.appendChild(closeBtn);

    var pre = document.createElement("pre");
    pre.style.cssText = "flex:1;overflow:auto;margin:0;";
    var raw = art.text == null ? "" : String(art.text);
    var lines = raw.split("\n");
    // Gutter width follows the line count so numbers stay right
    // aligned from 9 lines to 9000, instead of a fixed width that
    // misaligns on big files.
    pre.style.setProperty("--void-ln-w", String(lines.length).length + "ch");
    // One span.line per rendered line, "\n" text nodes between them,
    // so pre.textContent stays exactly the artifact text and the Copy
    // and Download handlers below keep working unchanged.
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) pre.appendChild(document.createTextNode("\n"));
      var lineEl = document.createElement("span");
      lineEl.className = "line";
      lineEl.textContent = lines[i];
      pre.appendChild(lineEl);
    }

    // Defaults per open: numbers on, wrap off. The class string is
    // rebuilt whole so pre.ln, pre.wrap and pre.nowrap can never drift
    // from the button labels or the aria-pressed state.
    var linesOn = true;
    var wrapOn = false;
    function sync() {
      // canonical keeps the existing dark tile style, scrolls on its
      // own; ln, wrap and nowrap are the toggle classes.
      pre.className = "canonical" + (linesOn ? " ln" : "") +
        (wrapOn ? " wrap" : " nowrap");
      linesBtn.textContent = linesOn ? "Lines on" : "Lines off";
      linesBtn.setAttribute("aria-pressed", linesOn ? "true" : "false");
      wrapBtn.textContent = wrapOn ? "Wrap on" : "Wrap off";
      wrapBtn.setAttribute("aria-pressed", wrapOn ? "true" : "false");
    }
    linesBtn.onclick = function () { linesOn = !linesOn; sync(); };
    wrapBtn.onclick = function () { wrapOn = !wrapOn; sync(); };
    sync();

    copyBtn.onclick = function () { copyText(pre.textContent); };
    dlBtn.onclick = function () { download(art.name || "artifact", pre.textContent); };
    closeBtn.onclick = close;

    drawer.appendChild(head);
    drawer.appendChild(pre);
    document.body.appendChild(drawer);
    document.addEventListener("keydown", onKey, true);
    closeBtn.focus();
  }

  return { open: open, close: close };
})();
