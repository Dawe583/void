import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, executeWorkspaceTool, applyWorkspaceUndo, previewWorkspaceUndo, workspaceToolClass, type WorkspaceState } from './workspace.ts';

function write(state: WorkspaceState, id: string, content: string, path = 'notes/task.md') {
  return executeWorkspaceTool(state, { id, name: 'void_workspace_write', arguments: { path, content } });
}

test('managed workspace captures create, replace and delete and restores across JSON persistence', () => {
  const initial = createWorkspace();
  const created = write(initial, 'create', 'first');
  assert.equal(initial.files['notes/task.md'], undefined);
  assert.equal(created.operation?.before, null);
  const updated = write(created.state, 'update', 'second');
  const deleted = executeWorkspaceTool(updated.state, { id: 'delete', name: 'void_workspace_delete', arguments: { path: 'notes/task.md' } });
  assert.equal(deleted.operation?.before, 'second');
  let state = JSON.parse(JSON.stringify(deleted.state)) as WorkspaceState;
  for (const operationId of ['delete', 'update', 'create']) {
    assert.equal(previewWorkspaceUndo(state, operationId).canApply, true);
    const undone = applyWorkspaceUndo(state, { id: `undo-${operationId}`, operationId });
    assert.equal(undone.result.isError, undefined);
    state = undone.state;
  }
  assert.deepEqual(state.files, {});
  assert.equal(state.operations.length, 6);
});

test('undo refuses newer changes and ABA even when the content matches again', () => {
  const first = write(createWorkspace(), 'first', 'A');
  const second = write(first.state, 'second', 'B');
  const third = write(second.state, 'third', 'A');
  assert.equal(previewWorkspaceUndo(third.state, 'first').canApply, false);
  const refused = applyWorkspaceUndo(third.state, { id: 'undo-first', operationId: 'first' });
  assert.equal(refused.result.isError, true);
  assert.equal(refused.state, third.state);
  const drift = { ...first.state, files: { 'notes/task.md': 'external edit' } };
  assert.equal(previewWorkspaceUndo(drift, 'first').canApply, false);
});

test('write and undo IDs are idempotent and cannot be rebound to another request', () => {
  const first = write(createWorkspace(), 'one', 'A');
  assert.equal(write(first.state, 'one', 'A').state, first.state);
  assert.equal(write(first.state, 'one', 'B').result.isError, true);
  const undone = applyWorkspaceUndo(first.state, { id: 'undo-one', operationId: 'one' });
  assert.equal(applyWorkspaceUndo(undone.state, { id: 'undo-one', operationId: 'one' }).state, undone.state);
  assert.equal(applyWorkspaceUndo(undone.state, { id: 'undo-again', operationId: 'one' }).result.isError, true);
  assert.equal(previewWorkspaceUndo(undone.state, 'undo-one').canApply, false);
  const longId = 'a'.repeat(160);
  const long = write(createWorkspace(), longId, 'A');
  assert.equal(applyWorkspaceUndo(long.state, { id: `undo-${longId}`, operationId: longId }).result.isError, undefined);
});

test('document namespace rejects traversal, prototype paths and oversized content', () => {
  const state = createWorkspace();
  for (const path of ['../secrets', '/etc/passwd', 'x/../../bad', '__proto__', 'a/constructor', 'a\\b', 'a//b', 'a\0b']) {
    const response = write(state, 'one', 'text', path);
    assert.equal(response.result.isError, true, path);
    assert.equal(response.state, state);
  }
  assert.equal(write(state, 'too-large', 'ü'.repeat(128001)).result.isError, true);
});

test('read tools are nonmutating and independent document changes do not block undo', () => {
  const first = write(createWorkspace(), 'one', 'A');
  const second = write(first.state, 'two', 'B', 'other.md');
  const read = executeWorkspaceTool(second.state, { id: 'read', name: 'void_workspace_read', arguments: { path: 'notes/task.md' } });
  assert.equal(JSON.parse(read.result.content[0]!.text).content, 'A');
  assert.equal(read.state, second.state);
  assert.equal(previewWorkspaceUndo(second.state, 'one').canApply, true);
  assert.equal(workspaceToolClass('void_workspace_read'), 'r0');
  assert.equal(workspaceToolClass('void_workspace_write'), 'r1');
  assert.equal(workspaceToolClass('shell'), undefined);
});

test('mutation capacity reserves room for undo instead of trapping the latest changes', () => {
  let state = createWorkspace();
  for (let i = 0; i < 250; i++) state = write(state, `write-${i}`, String(i)).state;
  assert.equal(write(state, 'overflow', 'lost').result.isError, true);
  for (let i = 249; i >= 0; i--) {
    const undone = applyWorkspaceUndo(state, { id: `undo-${i}`, operationId: `write-${i}` });
    assert.equal(undone.result.isError, undefined);
    state = undone.state;
  }
  assert.deepEqual(state.files, {});
  assert.equal(state.operations.length, 500);
});
