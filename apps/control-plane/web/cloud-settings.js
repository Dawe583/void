(() => {
  const byId = id => document.getElementById(id);
  if (!byId('upstream-form')) return;
  byId('upstream-policy').value = 'version: 1\nrules:\n  - match:\n      class: r0\n    decision: allow\n  - match: {}\n    decision: hold\n    seconds: 300\n    notify: [cli]\n';
  async function request(path = '', method = 'GET', body) {
    const response = await fetch(`/api/connectors${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Connector unavailable.');
    return result;
  }
  async function load() {
    try {
      const state = await request();
      byId('connector-list').replaceChildren(...state.connectors.map(item => {
        const row = document.createElement('article'); row.className = 'connector-item';
        const title = document.createElement('h4'); title.textContent = `[${item.builtin ? '+' : '~'}] ${item.name}`;
        const detail = document.createElement('p'); detail.textContent = `${item.tools.length} tools / ${item.undo ? 'Captured history and Undo' : 'External tools, no automatic inverse'}`;
        const tools = document.createElement('details'), summary = document.createElement('summary'), names = document.createElement('p');
        summary.textContent = 'Available tools'; names.textContent = item.tools.join(', '); tools.append(summary, names); row.append(title, detail, tools);
        if (!item.builtin) { const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = 'Disconnect'; remove.addEventListener('click', async () => { try { await request(`/${item.id}`, 'DELETE'); await load(); } catch (e) { byId('upstream-status').textContent = e.message; } }); row.append(remove); }
        return row;
      }));
    } catch (error) { byId('upstream-status').textContent = error.message; }
  }
  byId('upstream-form').addEventListener('submit', async event => {
    event.preventDefault(); const status = byId('upstream-status'); status.textContent = 'Connecting and discovering tools...';
    const button = event.submitter; button.disabled = true;
    try { await request('', 'POST', { name: byId('upstream-name').value, url: byId('upstream-url').value, token: byId('upstream-token').value, policy: byId('upstream-policy').value, facts: JSON.parse(byId('upstream-facts').value), mapping: JSON.parse(byId('upstream-mapping').value) }); status.textContent = 'Connected. Tools are available in new sessions.'; await load(); }
    catch (error) { status.textContent = error.message; }
    finally { byId('upstream-token').value = ''; button.disabled = false; }
  });
  window.addEventListener('void-connected', load); void load();
})();
