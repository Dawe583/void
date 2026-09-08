// Artifact drawer. One drawer at a time on the right side. Esc and the
// Close button close it. Focus lands on Close so keyboard users can
// dismiss immediately. Styling uses existing tokens and classes only.
window.VOID_ARTIFACTS = (function () {
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
    head.appendChild(copyBtn);
    head.appendChild(dlBtn);
    head.appendChild(closeBtn);

    var pre = document.createElement("pre");
    pre.className = "canonical"; // existing dark tile style, scrolls on its own
    pre.style.cssText = "flex:1;overflow:auto;margin:0;";
    pre.textContent = art.text == null ? "" : String(art.text);

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
