const root = document.getElementById('agent-workbench');
if (root) {
  const byId = id => document.getElementById(id);
  let active;
  let catalog = [];
  const presets = {
    openrouter: ['https://openrouter.ai/api/v1', 'openai'], openai: ['https://api.openai.com/v1', 'openai'], anthropic: ['https://api.anthropic.com/v1', 'anthropic'],
    google: ['https://generativelanguage.googleapis.com/v1beta/openai', 'openai'], groq: ['https://api.groq.com/openai/v1', 'openai'], deepseek: ['https://api.deepseek.com', 'openai'],
    gateway: ['https://ai-gateway.vercel.sh/v1', 'openai'], ollama: ['http://localhost:11434/v1', 'openai'], lmstudio: ['http://localhost:1234/v1', 'openai'], custom: ['', 'openai'],
  };
  byId('provider-preset').addEventListener('change', () => { byId('provider-url').value = presets[byId('provider-preset').value][0]; byId('provider-key').value = ''; });
  let initialSelection = true;
  let renderedEvents = "";
  let stopped = false;
  let refreshing = false;
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(path, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? `Request failed (${response.status}). Connect your workspace and retry.`);
    return result;
  };
  const status = text => { byId('session-status').textContent = text; };
  function models(items) {
    if (items) catalog = items;
    const chosen = byId('session-model').value || localStorage.getItem('void-model');
    const query = byId('model-search').value.toLowerCase();
    byId('session-model').replaceChildren(...catalog.filter(m => `${m.name} ${m.id}`.toLowerCase().includes(query)).map(model => {
      const option = document.createElement('option'); option.value = model.id; option.textContent = model.name; return option;
    }));
    if ([...byId('session-model').options].some(o => o.value === chosen)) byId('session-model').value = chosen;
  }
  byId('model-search').addEventListener('input', () => models());
  byId('session-model').addEventListener('change', () => localStorage.setItem('void-model', byId('session-model').value));
  async function provider() {
    try {
      const state = await api('/api/provider');
      models(state.models);
      for (const value of ['ollama', 'lmstudio']) byId('provider-preset').querySelector(`option[value=${value}]`).disabled = state.keyStorage === 'encrypted-cloud';
      byId('session-retention').textContent = state.keyStorage === 'encrypted-cloud' ? 'Sessions, documents and signed evidence are saved in your cloud workspace.' : 'Sessions, documents and keys are encrypted on this device. History survives restarting the app.';
      if (state.baseUrl) { byId('provider-url').value = state.baseUrl; byId('provider-preset').value = Object.entries(presets).find(([, p]) => p[0] === state.baseUrl)?.[0] ?? 'custom'; }
      byId('provider-status').textContent = state.connected ? 'Connected. Model catalog loaded; generation depends on model access and your provider balance.' : 'Choose a provider and connect it to start your agent.';
      byId('provider-settings').open = !state.connected;
      byId('session-submit').disabled = !state.connected;
    } catch (error) { byId('provider-status').textContent = error.message; }
  }
  function show(session) {
    status(`${session.status} / ${session.title ?? session.model}`);
    window.dispatchEvent(new CustomEvent('void-session', { detail: session }));
    byId('session-submit').disabled = session.status !== 'idle';
    byId('session-model').disabled = true; byId('model-search').disabled = true;
    if (!catalog.some(m => m.id === session.model)) models([...catalog, { id: session.model, name: session.model }]);
    byId('session-model').value = session.model;
    byId('session-cancel').disabled = session.status !== 'running';
    const eventKey = `${session.id}:${session.events.length}:${session.events.at(-1)?.seq}`;
    if (eventKey !== renderedEvents) {
    const transcript = byId('session-transcript');
    const follow = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48;
    transcript.replaceChildren(...session.events.map(event => {
      const article = document.createElement('article'); article.className = 'session-event'; article.dataset.kind = event.kind;
      const label = document.createElement('p'); label.className = 'event-label'; label.textContent = `[${event.kind}] ${new Date(event.at).toLocaleTimeString()}`;
      const body = document.createElement('p'); body.textContent = event.text;
      article.append(label, body); return article;
    }));
    renderedEvents = eventKey;
    if (follow) transcript.scrollTop = transcript.scrollHeight;
    }
    const ledger = byId('session-ledger'); ledger.href = `ledger.html?${new URLSearchParams({ workspace: session.workspace })}`; ledger.hidden = false;
    const approvals = byId('session-approvals'); approvals.href = `approvals.html?${new URLSearchParams({ workspace: session.workspace })}`; approvals.hidden = false;
    byId('new-session').disabled = session.status === 'running';
  }
  async function refresh() {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      const result = await api('/api/sessions');
      if (initialSelection) {
        const workspace = new URLSearchParams(location.search).get('workspace');
        active = (result.sessions.find(session => session.workspace === workspace) ?? [...result.sessions].reverse().find(session => session.status === 'running'))?.id;
        initialSelection = false;
      }
      const list = byId('session-list');
      const focused = document.activeElement?.dataset?.session;
      list.replaceChildren(...result.sessions.filter(session => `${session.title ?? ''} ${session.model}`.toLowerCase().includes(byId('session-search').value.toLowerCase())).map(session => {
        const button = document.createElement('button'); button.className = 'session-choice'; button.dataset.session = session.id;
        button.textContent = `${session.status === 'running' ? '[>]' : '[.]'} ${session.title ?? session.model}`;
        button.setAttribute('aria-pressed', String(session.id === active));
        button.addEventListener('click', () => { active = session.id; void refresh(); });
        return button;
      }));
      if (!result.sessions.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Your sessions will appear here.'; list.append(p); }
      if (focused) [...list.querySelectorAll('button')].find(button => button.dataset.session === focused)?.focus();
      if (active) show((await api(`/api/sessions/${active}`)).session);
    } catch (error) { status(error.message); }
    finally { refreshing = false; }
  }
  byId('provider-form').addEventListener('submit', async event => {
    event.preventDefault();
    byId('provider-status').textContent = 'Validating provider and loading models...';
    const key = byId('provider-key');
    try {
      const result = await api('/api/provider', 'POST', { baseUrl: byId('provider-url').value, apiKey: key.value, kind: presets[byId('provider-preset').value][1] });
      key.value = ''; models(result.models); byId('provider-status').textContent = result.keyStorage === 'encrypted-cloud' ? 'Provider validated. Key encrypted in your cloud workspace.' : 'Provider connected. Key encrypted on this device.';
      byId('session-submit').disabled = false; byId('provider-settings').open = false;
    } catch (error) { key.value = ''; byId('provider-status').textContent = error.message; }
  });
  byId('provider-remove').addEventListener('click', async () => {
    try { await api('/api/provider', 'DELETE'); models([]); byId('provider-status').textContent = 'Provider key removed from new sessions. Cancel active sessions to stop their provider access.'; byId('session-submit').disabled = true; }
    catch (error) { byId('provider-status').textContent = error.message; }
  });
  byId('session-form').addEventListener('submit', async event => {
    event.preventDefault();
    const prompt = byId('session-prompt'); byId('session-submit').disabled = true;
    try {
      if (active) await api(`/api/sessions/${active}`, 'POST', { prompt: prompt.value });
      else active = (await api('/api/sessions', 'POST', { prompt: prompt.value, model: byId('session-model').value })).session.id;
      localStorage.setItem('void-model', byId('session-model').value); prompt.value = ''; await refresh();
    } catch (error) { status(error.message); byId('session-submit').disabled = false; }
  });
  byId('session-cancel').addEventListener('click', async () => {
    if (!active) return;
    try { await api(`/api/sessions/${active}`, 'DELETE'); await refresh(); }
    catch (error) { status(error.message); }
  });
  byId('new-session').addEventListener('click', () => {
    active = undefined; renderedEvents = ''; byId('session-model').disabled = false; byId('model-search').disabled = false; window.dispatchEvent(new CustomEvent('void-session', { detail: null })); byId('session-transcript').replaceChildren(); byId('session-ledger').hidden = true; byId('session-approvals').hidden = true;
    byId('session-submit').disabled = !byId('session-model').options.length; status('Ready for a new session.'); byId('session-prompt').focus();
  });
  byId('session-search').addEventListener('input', refresh);
  window.addEventListener('void-refresh', refresh);
  const timer = setInterval(refresh, 2000);
  window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); }, { once: true });
  window.addEventListener("void-connected", () => { void provider(); void refresh(); });
  void provider(); void refresh();
}
