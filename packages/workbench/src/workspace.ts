import { createHash } from 'node:crypto';

/** Managed text documents, never paths on the host filesystem. Persistence and
 * authorization belong to the caller, which must serialize state transitions. */
export type WorkspaceOperation = {
  readonly id: string;
  readonly kind: 'write' | 'delete' | 'undo';
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly at: string;
  readonly digest: string;
  readonly undoes?: string;
};
export type WorkspaceState = {
  readonly version: 1;
  readonly files: Readonly<Record<string, string>>;
  readonly operations: readonly WorkspaceOperation[];
};
export type WorkspaceResult = { readonly isError?: boolean; readonly content: readonly { readonly type: 'text'; readonly text: string }[] };
export type WorkspaceTransition = { readonly state: WorkspaceState; readonly result: WorkspaceResult; readonly operation?: WorkspaceOperation };
export type WorkspaceUndoPreview = { readonly operationId: string; readonly path: string; readonly canApply: boolean; readonly reason?: string; readonly before: string | null; readonly after: string | null };

export const WORKSPACE_LIMITS = { files: 100, fileBytes: 256_000, totalBytes: 2_000_000, mutations: 250, operations: 500 } as const;
export const workspaceTools = [
  { name: 'void_workspace_list', description: 'List documents in the managed VOID workspace. These are not files on the host computer.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'void_workspace_read', description: 'Read a managed VOID document.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'void_workspace_write', description: 'Create or replace a managed VOID text document. VOID captures its prior content for operator-controlled undo.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'void_workspace_delete', description: 'Delete a managed VOID document. VOID captures its prior content for operator-controlled undo.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
] as const;

export function createWorkspace(): WorkspaceState { return { version: 1, files: {}, operations: [] }; }

export function workspaceToolClass(name: string): 'r0' | 'r1' | undefined {
  if (name === 'void_workspace_list' || name === 'void_workspace_read') return 'r0';
  if (name === 'void_workspace_write' || name === 'void_workspace_delete') return 'r1';
  return undefined;
}

export function executeWorkspaceTool(state: WorkspaceState, input: { readonly id: string; readonly name: string; readonly arguments: Readonly<Record<string, unknown>>; readonly at?: string }): WorkspaceTransition {
  try {
    if (!workspaceTools.some(tool => tool.name === input.name)) throw new Error('Unknown managed workspace tool.');
    if (input.name === 'void_workspace_list') return { state, result: result({ files: Object.keys(state.files).sort().map(path => ({ path, bytes: bytes(state.files[path]!) })) }) };
    const path = validPath(input.arguments.path);
    const before = Object.hasOwn(state.files, path) ? state.files[path]! : null;
    if (input.name === 'void_workspace_read') {
      if (before === null) throw new Error('Document does not exist.');
      return { state, result: result({ path, content: before }) };
    }
    const kind = input.name === 'void_workspace_write' ? 'write' : 'delete';
    const after = kind === 'write' ? validContent(input.arguments.content) : null;
    const digest = hash([kind, path, after]);
    const prior = duplicate(state, input.id, digest);
    if (prior) return transition(state, prior);
    if (kind === 'delete' && before === null) throw new Error('Document does not exist.');
    return commit(state, { id: input.id, kind, path, before, after, digest, at: timestamp(input.at) });
  } catch (error) { return { state, result: failure(error) }; }
}

export function previewWorkspaceUndo(state: WorkspaceState, operationId: string): WorkspaceUndoPreview {
  const operation = state.operations.find(item => item.id === operationId);
  if (!operation) return { operationId, path: '', canApply: false, reason: 'Operation not found.', before: null, after: null };
  const current = Object.hasOwn(state.files, operation.path) ? state.files[operation.path]! : null;
  const undone = new Set(state.operations.flatMap(item => item.undoes ? [item.undoes] : []));
  const latest = [...state.operations].reverse().find(item => item.path === operation.path && item.kind !== 'undo' && !undone.has(item.id));
  const reason = operation.kind === 'undo' ? 'Undo operations cannot themselves be undone.'
    : undone.has(operationId) ? 'Operation has already been undone.'
    : current !== operation.after || latest?.id !== operationId ? 'Document changed after this operation. Undo refused to preserve newer changes.'
    : undefined;
  return { operationId, path: operation.path, canApply: reason === undefined, ...(reason ? { reason } : {}), before: current, after: operation.before };
}

/** Do not expose this as a model tool. The operator explicitly approves undo. */
export function applyWorkspaceUndo(state: WorkspaceState, input: { readonly id: string; readonly operationId: string; readonly at?: string }): WorkspaceTransition {
  try {
    const digest = hash(['undo', input.operationId]);
    const prior = duplicate(state, input.id, digest, 200);
    if (prior) return transition(state, prior);
    const preview = previewWorkspaceUndo(state, input.operationId);
    if (!preview.canApply) throw new Error(preview.reason);
    return commit(state, { id: input.id, kind: 'undo', path: preview.path, before: preview.before, after: preview.after, digest, at: timestamp(input.at), undoes: input.operationId });
  } catch (error) { return { state, result: failure(error) }; }
}

function duplicate(state: WorkspaceState, id: string, digest: string, maxLength = 160): WorkspaceOperation | undefined {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(id) || id.length > maxLength) throw new Error('A valid operation ID is required.');
  const prior = state.operations.find(item => item.id === id);
  if (prior && prior.digest !== digest) throw new Error('Operation ID already belongs to a different request.');
  return prior;
}
function commit(state: WorkspaceState, operation: WorkspaceOperation): WorkspaceTransition {
  // Reserve one history slot per mutation so a full workspace can still undo.
  if (operation.kind !== 'undo' && state.operations.filter(item => item.kind !== 'undo').length >= WORKSPACE_LIMITS.mutations) throw new Error('Workspace mutation capacity reached. Undo remains available; export and create another workspace for new changes.');
  if (state.operations.length >= WORKSPACE_LIMITS.operations) throw new Error('Workspace history is full. Export it and create another workspace.');
  const files = { ...state.files };
  if (operation.after === null) delete files[operation.path];
  else files[operation.path] = operation.after;
  if (Object.keys(files).length > WORKSPACE_LIMITS.files || Object.values(files).reduce((sum, text) => sum + bytes(text), 0) > WORKSPACE_LIMITS.totalBytes) throw new Error('Workspace document capacity reached.');
  return transition({ version: 1, files, operations: [...state.operations, operation] }, operation);
}
function transition(state: WorkspaceState, operation: WorkspaceOperation): WorkspaceTransition {
  return { state, operation, result: result({ operationId: operation.id, path: operation.path, action: operation.kind, completed: true, undoAvailable: operation.kind !== 'undo' }) };
}
function result(value: unknown): WorkspaceResult { return { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
function failure(error: unknown): WorkspaceResult { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Managed workspace operation failed.' }] }; }
function validPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240 || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Use a relative document path without traversal or reserved segments.');
  return value;
}
function validContent(value: unknown): string {
  if (typeof value !== 'string' || bytes(value) > WORKSPACE_LIMITS.fileBytes) throw new Error('Document must be text within the 256 KB limit.');
  return value;
}
function bytes(value: string): number { return Buffer.byteLength(value, 'utf8'); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function timestamp(value?: string): string {
  const at = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid operation timestamp.');
  return at;
}
