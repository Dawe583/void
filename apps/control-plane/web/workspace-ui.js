(() => {
  const el = id => document.getElementById(id);
  let session, state, selectedPath, pending;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`/api/sessions/${session.id}/${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load workspace.'); return data;
  };
  function download(name, content, type = 'text/plain') { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  el('settings-open').addEventListener('click', () => el('settings-dialog').showModal());
  el('documents-toggle').addEventListener('click', () => { el('documents-panel').hidden = !el('documents-panel').hidden; el('documents-toggle').setAttribute('aria-expanded', String(!el('documents-panel').hidden)); });
  el('starter-prompt')?.addEventListener('click', () => { el('session-prompt').value = 'Create a concise project plan in plan.md using the VOID document workspace.'; el('session-prompt').focus(); });
  el('session-prompt').addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !el('session-submit').disabled) { event.preventDefault(); el('session-form').requestSubmit(); } });
  el('session-export').addEventListener('click', () => { if (session) download(`void-${session.id}.json`, JSON.stringify(session, null, 2), 'application/json'); });
  el('document-download').addEventListener('click', () => { if (state && selectedPath) download(selectedPath.split('/').at(-1), state.files[selectedPath]); });
  function select(path) { selectedPath = path; el('document-content').textContent = state.files[path] ?? ''; el('document-download').disabled = !Object.hasOwn(state.files, path); }
  let revision = '';
  async function refresh() {
    if (!session) return;
    const id = session.id;
    try {
      const result = await request('workspace'); if (session?.id !== id) return;
      state = result.workspace;
      const key = `${id}:${state.operations.length}`; if (key === revision) return; revision = key;
      el('documents-status').textContent = `${Object.keys(state.files).length} documents / ${state.operations.length} recorded changes`;
      el('document-list').replaceChildren(...Object.keys(state.files).sort().map(path => { const button = document.createElement('button'); button.className = 'secondary document-choice'; button.textContent = path; button.addEventListener('click', () => select(path)); return button; }));
      select(Object.hasOwn(state.files, selectedPath ?? '') ? selectedPath : Object.keys(state.files)[0] ?? '');
      el('changes-list').replaceChildren(...[...state.operations].reverse().map(operation => {
        const row = document.createElement('article'); row.className = 'change-item';
        const label = document.createElement('p'); label.textContent = `${operation.kind} / ${operation.path}`;
        const date = document.createElement('p'); date.className = 'caption'; date.textContent = new Date(operation.at).toLocaleString(); row.append(label, date);
        if (operation.kind !== 'undo') { const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Preview Undo'; button.addEventListener('click', async () => {
          try { const preview = await request(`undo/${encodeURIComponent(operation.id)}`); pending = { session: session.id, operation: operation.id }; el('undo-title').textContent = `Undo ${operation.path}`; el('undo-description').textContent = preview.canApply ? 'The captured inverse matches signed evidence. Review the restored content before applying.' : preview.reason;
            el('undo-current').textContent = preview.before ?? '(Document does not exist)'; el('undo-restored').textContent = preview.after ?? '(Document will be removed)'; el('undo-status').textContent = ''; el('undo-confirm').disabled = !preview.canApply || session.status === 'running'; el('undo-dialog').showModal();
          } catch (error) { el('documents-status').textContent = error.message; }
        }); row.append(button); }
        return row;
      }));
    } catch (error) { el('documents-status').textContent = error.message; }
  }
  el('undo-confirm').addEventListener('click', async () => {
    if (!pending || session?.id !== pending.session) return;
    el('undo-confirm').disabled = true;
    try { await request(`undo/${encodeURIComponent(pending.operation)}`, 'POST', { confirm: pending.operation }); el('undo-status').textContent = 'Change undone and recorded in the signed ledger.'; revision = ''; await refresh(); window.dispatchEvent(new Event('void-refresh')); }
    catch (error) { el('undo-status').textContent = error.message; }
  });
  window.addEventListener('void-session', event => { session = event.detail; el('session-export').disabled = !session; if (session) void refresh(); else { revision = ''; state = undefined; el('documents-status').textContent = 'Start a session to create documents.'; el('document-list').replaceChildren(); el('changes-list').replaceChildren(); el('document-content').textContent = ''; el('document-download').disabled = true; } });
})();
