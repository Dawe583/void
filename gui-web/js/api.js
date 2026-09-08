// Real provider client. OpenAI compatible endpoints (OpenRouter, Ollama, direct).
// Keys live in localStorage only, never logged, never rendered back.
window.VOID_API = (function () {
  var LS_KEY = "void.provider.v1";
  var LS_MODELS = "void.models.cache.v1";

  function getConfig() {
    var base = "https://openrouter.ai/api/v1";
    var key = "";
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var c = JSON.parse(raw);
        if (c.base) base = c.base;
        if (c.key) key = c.key;
      }
    } catch (e) { /* storage unavailable, use defaults */ }
    return { base: base.replace(/\/+$/, ""), key: key };
  }

  function setConfig(base, key) {
    localStorage.setItem(LS_KEY, JSON.stringify({ base: base, key: key }));
  }

  function headers() {
    var c = getConfig();
    var h = { "Content-Type": "application/json" };
    if (c.key) h["Authorization"] = "Bearer " + c.key;
    h["HTTP-Referer"] = location.href;
    h["X-Title"] = "VOID Workbench";
    return h;
  }

  function hasKey() { return getConfig().key.length > 0; }

  function testConnection(timeoutMs) {
    var c = getConfig();
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    var t0 = performance.now();
    return fetch(c.base + "/models", { headers: headers(), signal: ctrl.signal }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var n = (j && j.data) ? j.data.length : 0;
      return { ok: true, ms: Math.round(performance.now() - t0), models: n };
    }).catch(function (e) {
      clearTimeout(timer);
      return { ok: false, error: String((e && e.message) || e) };
    });
  }

  function fetchModels() {
    try {
      var raw = localStorage.getItem(LS_MODELS);
      if (raw) {
        var cached = JSON.parse(raw);
        if (Date.now() - cached.at < 3600000) return Promise.resolve(cached.models);
      }
    } catch (e) { /* ignore */ }
    var c = getConfig();
    return fetch(c.base + "/models", { headers: headers() }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var ids = ((j && j.data) || []).map(function (m) { return m.id; }).sort();
      try { localStorage.setItem(LS_MODELS, JSON.stringify({ at: Date.now(), models: ids })); } catch (e) { /* ignore */ }
      return ids;
    });
  }

  function parseSSE(chunk, onToken) {
    var lines = chunk.split("\n");
    var text = "";
    lines.forEach(function (line) {
      line = line.trim();
      if (line.indexOf("data:") !== 0) return;
      var data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        var j = JSON.parse(data);
        var delta = j && j.choices && j.choices[0] && j.choices[0].delta;
        var piece = delta ? (delta.content || "") : "";
        text += piece;
        if (piece && onToken) onToken(piece);
      } catch (e) { /* partial chunk, skip */ }
    });
    return text;
  }

  // Streams assistant text. Resolves {text, usage}. Rejects on HTTP or abort.
  function chat(opts) {
    var c = getConfig();
    var body = {
      model: opts.model,
      messages: opts.messages,
      stream: true
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    return fetch(c.base + "/chat/completions", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: opts.signal
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error("HTTP " + r.status + ": " + t.slice(0, 200));
        });
      }
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var full = "";
      var usage = null;
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) return { text: full, usage: usage };
          var piece = parseSSE(decoder.decode(res.value, { stream: true }), function (tok) {
            full += "";
            if (opts.onToken) opts.onToken(tok);
          });
          full += piece;
          return pump();
        });
      }
      // Note: some gateways send usage in a final non delta chunk; best effort parse.
      return pump();
    });
  }

  function estimateTokens(s) { return Math.max(1, Math.round(s.length / 4)); }

  function priceFor(modelId) {
    var F = window.VOID_FIXTURES;
    if (!F || !F.models) return null;
    var m = F.models.find(function (x) { return x.id === modelId; });
    if (!m) return null;
    var parts = m.price.split("/");
    return { inp: parseFloat(parts[0]) || 0, out: parseFloat(parts[1]) || 0 };
  }

  function estimateCost(modelId, inTok, outTok) {
    var p = priceFor(modelId);
    if (!p) return null;
    return (inTok / 1000000) * p.inp + (outTok / 1000000) * p.out;
  }

  return {
    getConfig: getConfig,
    setConfig: setConfig,
    hasKey: hasKey,
    testConnection: testConnection,
    fetchModels: fetchModels,
    chat: chat,
    estimateTokens: estimateTokens,
    estimateCost: estimateCost
  };
})();
