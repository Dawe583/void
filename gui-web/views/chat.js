// Chat workbench: real OpenAI compatible chat with streaming, local history.
// Store: localStorage void.chats.v1. Keys stay in js/api.js storage.
window.VOID_CHATS = (function () {
  var LS = "void.chats.v1";

  function load() {
    try {
      var raw = localStorage.getItem(LS);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return [];
  }
  function save(all) {
    try { localStorage.setItem(LS, JSON.stringify(all)); }
    catch (e) {
      try {
        var lite = all.map(function (c) {
          var msgs = c.msgs.map(function (m) {
            if (m.images) { m.images = []; m.attMeta = (m.attMeta || []).concat([{ name: "images stripped, over browser quota", size: 0, kind: "note" }]); }
            return m;
          });
          c.msgs = msgs;
          return c;
        });
        localStorage.setItem(LS, JSON.stringify(lite));
      } catch (e2) { /* storage full, history stays in memory */ }
    }
  }
  function uid() { return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  function create(model) {
    var all = load();
    var c = { id: uid(), title: "New chat", model: model, pinned: false, archived: false, created: Date.now(), msgs: [] };
    all.unshift(c);
    save(all);
    return c;
  }
  function get(id) { return load().find(function (c) { return c.id === id; }); }
  function update(chat) {
    var all = load();
    var i = all.findIndex(function (c) { return c.id === chat.id; });
    if (i >= 0) { all[i] = chat; save(all); }
  }
  function remove(id) { save(load().filter(function (c) { return c.id !== id; })); }
  function sorted() {
    return load().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.created - a.created;
    });
  }
  return { load: load, save: save, create: create, get: get, update: update, remove: remove, sorted: sorted };
})();

window.VOID_VIEWS = window.VOID_VIEWS || {};
window.VOID_VIEWS.chat = function (root) {
  var API = window.VOID_API;
  var F = window.VOID_FIXTURES;
  var wrap = document.createElement("div");
  wrap.className = "chat-wrap";
  var openId = location.hash.split("?")[1] || (window.VOID_CHATS.sorted().filter(function (c) { return !c.archived; })[0] || {}).id || null;
  var chat = (openId && window.VOID_CHATS.get(openId)) || null;
  var aborter = null;
  var queued = [];
  var pendingAtt = [];
  var curMsg = -1;

  var EXT = { python: "py", py: "py", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx", html: "html", css: "css", json: "json", markdown: "md", md: "md", bash: "sh", sh: "sh", shell: "sh", zsh: "sh", sql: "sql", yaml: "yml", yml: "yml", toml: "toml", xml: "xml", java: "java", c: "c", h: "h", cpp: "cpp", rust: "rs", rs: "rs", go: "go", ruby: "rb", rb: "rb", php: "php", swift: "swift", kotlin: "kt", kt: "kt", r: "r", csv: "csv", tsv: "tsv", text: "txt", plain: "txt", plaintext: "txt", code: "txt", diff: "diff", dockerfile: "dockerfile", ini: "ini", swiftui: "swift" };

  function extFor(lang) {
    var e = EXT[(lang || "").toLowerCase()];
    return e || "txt";
  }

  function downloadFile(name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function md(src) {
    var h = esc(src);
    var blocks = [];
    h = h.replace(/```(\w*)\n([\s\S]*?)(```|$)/g, function (m, lang, code) {
      blocks.push({ lang: lang || "code", code: code.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") });
      return "\u0000" + (blocks.length - 1) + "\u0000";
    });
    h = h.replace(/^### (.*)$/gm, "<b>$1</b>").replace(/^## (.*)$/gm, "<b>$1</b>");
    h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
    h = h.split(/\n{2,}|\n/).map(function (ln) { return ln.trim() ? "<p>" + ln + "</p>" : ""; }).join("");
    h = h.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      var b = blocks[parseInt(i, 10)];
      return "<div class='codeblock'><div class='codehead'><span>" + esc(b.lang) + "</span><span><button class='btn-pearl btn-small' data-copycode='" + i + "'>Copy</button> <button class='btn-pearl btn-small' data-dlcode='" + curMsg + ":" + i + "'>Download</button></span></div><pre>" + esc(b.code) + "</pre></div>";
    });
    return h;
  }
  window.VOID_COPYBLOCKS = [];

  function costLine(model, msgs, reply) {
    var inp = msgs.reduce(function (n, m) {
      var t = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      var imgs = m.images ? m.images.length * 1500 * 4 : 0;
      return n + API.estimateTokens(t) + Math.round(imgs / 4);
    }, 0);
    var out = API.estimateTokens(reply);
    var cost = API.estimateCost(model, inp, out);
    return "~" + (inp + out) + " tokens" + (cost !== null ? ", $" + cost.toFixed(4) : "");
  }

  var MAX_FILES = 20;
  var MAX_IMAGE = 5 * 1024 * 1024;
  var MAX_FILE = 30 * 1024 * 1024;
  var MAX_TEXT_INLINE = 200 * 1024;
  var IMG_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  function attChips(m) {
    if (!m.attMeta || !m.attMeta.length) return "";
    return "<div class='att-row'>" + m.attMeta.map(function (a) {
      return "<span class='att-chip'>" + esc(a.name) + " " + fmtSize(a.size) + "</span>";
    }).join("") + "</div>";
  }

  function downscaleImage(file) {
    return createImageBitmap(file).then(function (bmp) {
      var max = 1568;
      var scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      var cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * scale);
      cv.height = Math.round(bmp.height * scale);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) {
        cv.toBlob(function (b) { b ? res(b) : rej(new Error("encode")); }, "image/jpeg", 0.85);
      });
    }).then(function (blob) {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res(r.result); };
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
    });
  }

  function pdfText(buf) {
    if (typeof pdfjsLib === "undefined") return Promise.reject(new Error("PDF engine offline"));
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return pdfjsLib.getDocument({ data: buf }).promise.then(function (pdf) {
      if (pdf.numPages > 1000) throw new Error("PDF over 1000 pages");
      var pages = Math.min(pdf.numPages, 100);
      var jobs = [];
      for (var i = 1; i <= pages; i++) {
        jobs.push(pdf.getPage(i).then(function (pg) {
          return pg.getTextContent().then(function (tc) {
            return tc.items.map(function (it) { return it.str; }).join(" ");
          });
        }));
      }
      return Promise.all(jobs).then(function (texts) {
        return { pages: pdf.numPages, text: texts.join("\n\n") };
      });
    });
  }

  function docxText(buf) {
    if (typeof mammoth === "undefined") return Promise.reject(new Error("DOCX engine offline"));
    return mammoth.extractRawText({ arrayBuffer: buf }).then(function (r) { return r.value; });
  }

  function processFile(file) {
    if (file.size > MAX_FILE) {
      if (window.VOID_TOAST) window.VOID_TOAST(file.name + " over 30 MB, skipped.");
      return Promise.resolve(null);
    }
    if (IMG_TYPES.includes(file.type)) {
      if (file.size > MAX_IMAGE) {
        if (window.VOID_TOAST) window.VOID_TOAST(file.name + " over 5 MB, skipped.");
        return Promise.resolve(null);
      }
      return downscaleImage(file).then(function (url) {
        return { kind: "image", name: file.name, size: file.size, dataUrl: url };
      }).catch(function () {
        if (window.VOID_TOAST) window.VOID_TOAST(file.name + " could not be read.");
        return null;
      });
    }
    var lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      return file.arrayBuffer().then(pdfText).then(function (r) {
        var note = r.pages > 100 ? " (first 100 of " + r.pages + " pages)" : "";
        return { kind: "text", name: file.name, size: file.size, text: "File " + file.name + note + ":\n" + r.text };
      }).catch(function (e) {
        if (window.VOID_TOAST) window.VOID_TOAST(file.name + ": " + e.message + ".");
        return null;
      });
    }
    if (lower.endsWith(".docx")) {
      return file.arrayBuffer().then(docxText).then(function (t) {
        return { kind: "text", name: file.name, size: file.size, text: "File " + file.name + ":\n" + t };
      }).catch(function (e) {
        if (window.VOID_TOAST) window.VOID_TOAST(file.name + ": " + e.message + ".");
        return null;
      });
    }
    if (file.size > MAX_TEXT_INLINE) {
      var input = wrap.querySelector("#ch-in");
      if (input) input.value += "\n[" + file.name + ", " + fmtSize(file.size) + ": too large to inline, reference only]\n";
      if (window.VOID_TOAST) window.VOID_TOAST(file.name + " inserted as reference (too large).");
      return Promise.resolve(null);
    }
    return file.text().then(function (t) {
      if (t.includes("\u0000")) {
        var input = wrap.querySelector("#ch-in");
        if (input) input.value += "\n[" + file.name + ", " + fmtSize(file.size) + ": binary, reference only]\n";
        if (window.VOID_TOAST) window.VOID_TOAST(file.name + " inserted as reference (binary).");
        return null;
      }
      return { kind: "text", name: file.name, size: file.size, text: "File " + file.name + ":\n```\n" + t.slice(0, MAX_TEXT_INLINE) + "\n```" };
    }).catch(function () {
      if (window.VOID_TOAST) window.VOID_TOAST(file.name + " could not be read.");
      return null;
    });
  }

  function paintChips() {
    var box = wrap.querySelector("#ch-chips");
    if (!box) return;
    box.innerHTML = pendingAtt.map(function (a, i) {
      return "<span class='att-chip'>" + esc(a.name) + " " + fmtSize(a.size) + " <button data-rm='" + i + "' aria-label='Remove'>x</button></span>";
    }).join("");
    box.querySelectorAll("button[data-rm]").forEach(function (b) {
      b.onclick = function () { pendingAtt.splice(parseInt(b.getAttribute("data-rm"), 10), 1); paintChips(); };
    });
  }

  function addFiles(files) {
    var room = MAX_FILES - chat.msgs.reduce(function (n, m) { return n + ((m.attMeta || []).length); }, 0) - pendingAtt.length;
    var list = Array.prototype.slice.call(files, 0, Math.max(0, room));
    if (files.length > list.length && window.VOID_TOAST) window.VOID_TOAST("Max 20 files per chat.");
    var jobs = list.map(processFile);
    Promise.all(jobs).then(function (res) {
      res.forEach(function (a) { if (a) pendingAtt.push(a); });
      paintChips();
    });
  }

  function paint() {
    if (!chat) {
      wrap.innerHTML = "<div class='section'><h2>Chat</h2><div class='card'><p>No conversation yet.</p>" +
        "<div class='cta-row'><button class='btn-primary btn-small' id='ch-new'>New chat</button></div>" +
        (API.hasKey() ? "" : "<p class='muted small'>No provider key set. <a href='#/providers'>Add one in Providers</a>, then chat for real.</p>") + "</div></div>";
      wrap.querySelector("#ch-new").onclick = newChat;
      root.innerHTML = "";
      root.appendChild(wrap);
      paintSidebar();
      return;
    }
    var modelOpts = modelOptions(chat.model);
    var html = "<div class='chat-head'><select id='ch-model' aria-label='Model'>" + modelOpts + "</select>" +
      "<span class='muted small'>" + esc(chat.title) + "</span><span class='chat-head-sp'></span>" +
      "<input id='ch-find' type='text' placeholder='Find' aria-label='Find in conversation' style='max-width:140px'>" +
      "<button class='btn-pearl btn-small' id='ch-exp-md'>Export md</button>" +
      "<button class='btn-pearl btn-small' id='ch-exp-json'>JSON</button>" +
      "<button class='btn-pearl btn-small' id='ch-rename'>Rename</button>" +
      "<button class='btn-pearl btn-small' id='ch-del'>Delete</button></div>" +
      "<div id='ch-offline' class='offline-banner' hidden>Offline. Messages queue and send on reconnect.</div>" +
      "<div class='chat-msgs' id='ch-msgs'></div>" +
      "<div id='ch-chips' class='att-row'></div>" +
      "<div class='composer' id='ch-drop'><button class='btn-pearl btn-small' id='ch-attach' aria-label='Attach files'>+</button>" +
      "<input id='ch-file' type='file' multiple hidden accept='image/jpeg,image/png,image/gif,image/webp,.pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.xml,.yml,.yaml,.toml,.ini,.js,.ts,.jsx,.tsx,.py,.rb,.php,.java,.c,.h,.cpp,.rs,.go,.swift,.kt,.sql,.sh,.css,.r'>" +
      "<textarea id='ch-in' rows='2' placeholder='Message, Enter sends. Drop files or paste images.' aria-label='Message'></textarea>" +
      "<button class='btn-primary btn-small' id='ch-send'>Send</button>" +
      "<button class='btn-ghost btn-small' id='ch-stop' hidden>Stop</button></div>";
    wrap.innerHTML = html;
    root.innerHTML = "";
    root.appendChild(wrap);
    paintMsgs();
    wire();
    paintChips();
    paintSidebar();
    updateOffline();
  }

  function modelOptions(sel) {
    var seen = {};
    var opts = [];
    (F.models || []).forEach(function (m) {
      seen[m.id] = true;
      opts.push("<option value='" + m.id + "'" + (m.id === sel ? " selected" : "") + ">" + m.id + " (" + m.ctx + ", " + m.price + ")</option>");
    });
    (window.VOID_REMOTE_MODELS || []).forEach(function (id) {
      if (!seen[id]) opts.push("<option value='" + id + "'" + (id === sel ? " selected" : "") + ">" + id + " (remote)</option>");
    });
    if (sel && !seen[sel] && !(window.VOID_REMOTE_MODELS || []).includes(sel)) {
      opts.push("<option selected>" + sel + "</option>");
    }
    return opts.join("");
  }

  function paintMsgs() {
    var box = wrap.querySelector("#ch-msgs");
    if (!box) return;
    if (chat.msgs.length === 0) {
      box.innerHTML = "<div class='card'><p>Ask anything. This chat calls your configured provider for real.</p>" +
        "<p class='muted small'>Enter sends, Shift Enter is a newline, Esc stops.</p></div>";
      return;
    }
    box.innerHTML = chat.msgs.map(function (m, i) {
      var body;
      if (m.role === "user") {
        body = "<p>" + esc(m.content || "").replace(/\n/g, "<br>") + "</p>" + attChips(m);
      } else {
        curMsg = i;
        body = md(m.content);
      }
      var foot = m.role === "assistant" && m.meta ? "<div class='muted small'>" + esc(m.meta) + "</div>" : "";
      var ops = m.role === "user"
        ? "<button class='btn-pearl btn-small' data-op='edit' data-i='" + i + "'>Edit</button>"
        : "<button class='btn-pearl btn-small' data-op='copy' data-i='" + i + "'>Copy</button> " +
          "<button class='btn-pearl btn-small' data-op='save' data-i='" + i + "'>Save file</button>" +
          (i === chat.msgs.length - 1 ? " <button class='btn-pearl btn-small' data-op='retry'>Retry</button>" : "");
      return "<div class='msg " + m.role + "'><div class='msg-role muted small'>" + m.role + (m.model ? " " + esc(m.model) : "") + "</div>" +
        "<div class='msg-body' data-i='" + i + "'>" + body + "</div>" + foot +
        "<div class='msg-ops'>" + ops + "</div></div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll("button[data-op]").forEach(function (b) {
      var i = parseInt(b.getAttribute("data-i"), 10);
      var op = b.getAttribute("data-op");
      if (op === "copy") b.onclick = function () { copyText(chat.msgs[i].content, "Message copied."); };
      if (op === "save") b.onclick = function () {
        downloadFile("reply-" + i + ".md", chat.msgs[i].content, "text/markdown");
        if (window.VOID_TOAST) window.VOID_TOAST("Reply saved as file.");
      };
      if (op === "retry") b.onclick = retry;
      if (op === "edit") b.onclick = function () { editMsg(i); };
    });
    box.querySelectorAll("button[data-copycode]").forEach(function (b) {
      b.onclick = function () {
        var pre = b.parentElement.nextElementSibling;
        copyText(pre ? pre.textContent : "", "Code copied.");
      };
    });
    box.querySelectorAll("button[data-dlcode]").forEach(function (b) {
      b.onclick = function () {
        var parts = b.getAttribute("data-dlcode").split(":");
        var pre = b.parentElement.nextElementSibling;
        var lang = (b.parentElement.querySelector("span") || {}).textContent || "txt";
        downloadFile("snippet-" + parts[0] + "-" + parts[1] + "." + extFor(lang), pre ? pre.textContent : "", "text/plain");
        if (window.VOID_TOAST) window.VOID_TOAST("File generated, check downloads.");
      };
    });
  }

  function copyText(t, okMsg) {
    function done() { if (window.VOID_TOAST) window.VOID_TOAST(okMsg); }
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

  function wire() {
    var input = wrap.querySelector("#ch-in");
    wrap.querySelector("#ch-send").onclick = send;
    wrap.querySelector("#ch-stop").onclick = stop;
    wrap.querySelector("#ch-attach").onclick = function () { wrap.querySelector("#ch-file").click(); };
    wrap.querySelector("#ch-file").onchange = function (e) { addFiles(e.target.files); e.target.value = ""; };
    var dz = wrap.querySelector("#ch-drop");
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("drag"); });
    dz.addEventListener("drop", function (e) {
      e.preventDefault();
      dz.classList.remove("drag");
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    input.addEventListener("paste", function (e) {
      var files = (e.clipboardData && e.clipboardData.files) || [];
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    wrap.querySelector("#ch-model").onchange = function (e) {
      chat.model = e.target.value;
      window.VOID_CHATS.update(chat);
    };
    wrap.querySelector("#ch-find").onkeydown = function (e) {
      if (e.key === "Enter" && e.target.value) {
        try { window.find(e.target.value); } catch (err) { /* unsupported */ }
      }
    };
    wrap.querySelector("#ch-exp-md").onclick = function () { download(chat.title + ".md", toMarkdown(), "text/markdown"); };
    wrap.querySelector("#ch-exp-json").onclick = function () { download(chat.title + ".json", JSON.stringify(chat, null, 2), "application/json"); };
    wrap.querySelector("#ch-rename").onclick = function () {
      var v = prompt("Rename conversation:", chat.title);
      if (v) { chat.title = v; window.VOID_CHATS.update(chat); paint(); }
    };
    wrap.querySelector("#ch-del").onclick = function () {
      if (!confirm("Delete this conversation?")) return;
      window.VOID_CHATS.remove(chat.id);
      chat = window.VOID_CHATS.sorted().filter(function (c) { return !c.archived; })[0] || null;
      paint();
    };
    input.focus();
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[^\w\- ]+/g, "").slice(0, 60) || "chat";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function toMarkdown() {
    return "# " + chat.title + "\n\n" + chat.msgs.map(function (m) {
      var atts = (m.attMeta || []).map(function (a) { return a.name; }).join(", ");
      return (m.role === "user" ? "## You" : "## Assistant" + (m.model ? " (" + m.model + ")" : "")) + "\n\n" +
        (atts ? "_Attachments: " + atts + "_\n\n" : "") + m.content + "\n";
    }).join("\n");
  }

  function newChat() {
    var def = (F.routing && F.routing.def) || ((F.models || [])[0] || {}).id || "z-ai/glm-5.3";
    chat = window.VOID_CHATS.create(def);
    location.hash = "#/chat?" + chat.id;
    paint();
  }

  function toAPIContent(m) {
    if (m.images && m.images.length) {
      var parts = [{ type: "text", text: m.content || "Describe these images." }];
      m.images.forEach(function (url) { parts.push({ type: "image_url", image_url: { url: url } }); });
      return parts;
    }
    return m.content;
  }

  function send() {
    var input = wrap.querySelector("#ch-in");
    var text = input.value.trim();
    if ((!text && pendingAtt.length === 0) || aborter) return;
    if (!API.hasKey()) {
      if (window.VOID_TOAST) window.VOID_TOAST("Set a provider key first.");
      location.hash = "#/providers";
      return;
    }
    if (!navigator.onLine) {
      queued.push(text);
      input.value = "";
      if (window.VOID_TOAST) window.VOID_TOAST("Offline, queued.");
      updateOffline();
      return;
    }
    var texts = [];
    if (text) texts.push(text);
    pendingAtt.forEach(function (a) { if (a.kind === "text") texts.push(a.text); });
    var images = pendingAtt.filter(function (a) { return a.kind === "image"; }).map(function (a) { return a.dataUrl; });
    var meta = pendingAtt.map(function (a) { return { name: a.name, size: a.size, kind: a.kind }; });
    var full = texts.join("\n\n");
    chat.msgs.push({ role: "user", content: full, images: images, attMeta: meta });
    if (chat.msgs.length === 1) chat.title = (text || meta[0].name).slice(0, 40);
    input.value = "";
    pendingAtt = [];
    window.VOID_CHATS.update(chat);
    paintMsgs();
    paintChips();
    runAssistant();
  }

  function runAssistant() {
    var history = chat.msgs.filter(function (m) { return m.role === "user" || m.role === "assistant"; })
      .map(function (m) { return m.role === "assistant" ? { role: m.role, content: m.content } : { role: m.role, content: toAPIContent(m) }; });
    var acc = "";
    var box = wrap.querySelector("#ch-msgs");
    var streamEl = document.createElement("div");
    streamEl.className = "msg assistant";
    streamEl.innerHTML = "<div class='msg-role muted small'>assistant " + esc(chat.model) + "</div><div class='msg-body'></div>";
    box.appendChild(streamEl);
    var body = streamEl.querySelector(".msg-body");
    wrap.querySelector("#ch-send").hidden = true;
    wrap.querySelector("#ch-stop").hidden = false;
    aborter = new AbortController();
    window.VOID_STOP = stop;
    API.chat({
      model: chat.model,
      messages: history,
      signal: aborter.signal,
      onToken: function (tok) {
        acc += tok;
        body.innerHTML = md(acc) + "<span class='caret'></span>";
        box.scrollTop = box.scrollHeight;
      }
    }).then(function (res) {
      finish(res.text);
    }).catch(function (e) {
      if (e && e.name === "AbortError") {
        finish(acc, "stopped");
      } else {
        streamEl.remove();
        if (window.VOID_TOAST) window.VOID_TOAST("Request failed: " + String((e && e.message) || e).slice(0, 120));
        resetComposer();
      }
    });

    function finish(text, meta) {
      aborter = null;
      window.VOID_STOP = null;
      streamEl.remove();
      if (text) {
        chat.msgs.push({ role: "assistant", content: text, model: chat.model, meta: meta || costLine(chat.model, history, text) });
        window.VOID_CHATS.update(chat);
      }
      paintMsgs();
      resetComposer();
    }
  }

  function resetComposer() {
    aborter = null;
    window.VOID_STOP = null;
    var s = wrap.querySelector("#ch-send");
    var st = wrap.querySelector("#ch-stop");
    if (s) s.hidden = false;
    if (st) st.hidden = true;
  }

  function stop() {
    if (aborter) aborter.abort();
  }

  function retry() {
    if (aborter) return;
    while (chat.msgs.length && chat.msgs[chat.msgs.length - 1].role === "assistant") chat.msgs.pop();
    window.VOID_CHATS.update(chat);
    paintMsgs();
    runAssistant();
  }

  function editMsg(i) {
    if (aborter) return;
    var box = wrap.querySelector("#ch-msgs");
    var body = box.querySelector(".msg-body[data-i='" + i + "']");
    var cur = chat.msgs[i].content;
    body.innerHTML = "<textarea id='ch-edit' rows='4'>" + esc(cur) + "</textarea>" +
      "<div class='cta-row'><button class='btn-primary btn-small' id='ch-save'>Save and resend</button>" +
      "<button class='btn-pearl btn-small' id='ch-cancel'>Cancel</button></div>";
    wrap.querySelector("#ch-cancel").onclick = paintMsgs;
    wrap.querySelector("#ch-save").onclick = function () {
      var v = wrap.querySelector("#ch-edit").value.trim();
      if (!v) return;
      chat.msgs[i].content = v;
      chat.msgs = chat.msgs.slice(0, i + 1);
      window.VOID_CHATS.update(chat);
      paintMsgs();
      runAssistant();
    };
  }

  function updateOffline() {
    var b = wrap.querySelector("#ch-offline");
    if (b) b.hidden = navigator.onLine;
  }
  window.addEventListener("online", function () {
    updateOffline();
    if (queued.length && chat) {
      var input = wrap.querySelector("#ch-in");
      if (input) input.value = queued.shift();
      send();
    }
  });
  window.addEventListener("offline", updateOffline);

  function paintSidebar() {
    var el = document.getElementById("side-chats");
    if (!el) return;
    var q = (document.getElementById("side-search") || {}).value || "";
    var list = window.VOID_CHATS.sorted().filter(function (c) {
      if (c.archived) return false;
      return !q || c.title.toLowerCase().indexOf(q.toLowerCase()) >= 0;
    }).slice(0, 8);
    el.innerHTML = list.map(function (c) {
      return "<button class='side-chat" + (chat && c.id === chat.id ? " active" : "") + "' data-id='" + c.id + "'>" +
        (c.pinned ? "[pinned] " : "") + esc(c.title) + "</button>";
    }).join("") || "<p class='muted small'>No chats yet.</p>";
    el.querySelectorAll(".side-chat").forEach(function (b) {
      b.onclick = function () { location.hash = "#/chat?" + b.getAttribute("data-id"); };
    });
  }
  window.VOID_PAINT_SIDEBAR = paintSidebar;

  paint();
};
