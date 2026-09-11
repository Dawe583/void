import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Workbench } from './index.ts';
import { canonicalJson } from '../../ledger/src/canonical.ts';
import { sha256Hex } from '../../ledger/src/sign.ts';

test('default agent writes a captured document, restarts, verifies evidence and explicitly undoes it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'void-default-agent-'));
  const secret = 'default-agent-test-private-api-key';
  let turns = 0;
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal((options?.headers as Record<string, string>).authorization, `Bearer ${secret}`);
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'test-tool-model' }] });
    const request = JSON.parse(String(options?.body));
    turns++;
    if (turns === 1) {
      const tool = request.tools.find((item: { function: { description: string } }) => item.function.description.startsWith('void_workspace_write:'));
      assert.ok(tool, 'default document tools must be available without an MCP server');
      return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'write-document', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ path: 'notes/plan.md', content: 'A real managed document.' }) } }] } }] });
    }
    const result = JSON.parse(request.messages.at(-1).content);
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).completed, true);
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'The document was created.' } }] });
  };
  const env = { VOID_DATA_DIR: directory };
  let workbench = new Workbench(env, fetcher);
  t.after(async () => { workbench.close(); await rm(directory, { recursive: true, force: true }); });
  await workbench.configure({ baseUrl: 'https://provider.test/v1', apiKey: secret });
  const session = await workbench.start('Create a plan in the workspace.', 'test-tool-model');
  const deadline = Date.now() + 10000;
  while (workbench.get(session.id)?.status === 'running' && Date.now() < deadline) await delay(10);
  assert.equal(workbench.get(session.id)?.status, 'idle');
  assert.equal(turns, 2);
  const operation = workbench.workspace(session.id).operations[0]!;
  assert.equal(operation.before, null);
  assert.equal(operation.after, 'A real managed document.');
  workbench.close();

  workbench = new Workbench(env, fetcher);
  assert.equal((await workbench.providerState()).connected, true);
  assert.equal(workbench.get(session.id)?.status, 'idle');
  assert.equal(workbench.workspace(session.id).files['notes/plan.md'], 'A real managed document.');
  const evidence = await workbench.ledger(session.workspace);
  assert.equal(evidence?.result.ok, true);
  const captured = evidence!.entries.find(entry => (entry.body as Record<string, unknown>).operationId === operation.id);
  assert.ok(captured);
  assert.equal((captured.body as Record<string, unknown>).captureDigest, await sha256Hex(canonicalJson(operation)));
  const restoredOperation = workbench.workspace(session.id).operations[0]! as { before: string | null; digest: string };
  const savedBefore = restoredOperation.before, savedDigest = restoredOperation.digest;
  restoredOperation.before = 'A forged before-image';
  restoredOperation.digest = (captured.body as Record<string, unknown>).captureDigest as string;
  await assert.rejects(workbench.undoPreview(session.id, operation.id), /signed evidence/);
  restoredOperation.before = savedBefore; restoredOperation.digest = savedDigest;
  const preview = await workbench.undoPreview(session.id, operation.id);
  assert.equal(preview.canApply, true);
  assert.equal(preview.before, 'A real managed document.');
  assert.equal(preview.after, null);
  await workbench.undo(session.id, operation.id);
  assert.deepEqual(workbench.workspace(session.id).files, {});
  assert.equal((await workbench.ledger(session.workspace))?.result.ok, true);
  workbench.close();

  workbench = new Workbench(env, fetcher);
  assert.deepEqual(workbench.workspace(session.id).files, {});
  assert.equal(workbench.workspace(session.id).operations.length, 2);
  assert.equal((await workbench.undoPreview(session.id, operation.id)).canApply, false);
  for (const file of await readdir(directory, { recursive: true })) {
    const path = join(directory, file);
    if ((await stat(path)).isFile()) assert.equal((await readFile(path)).includes(Buffer.from(secret)), false, `Secret leaked to ${file}`);
  }
  assert.equal((await stat(join(directory, 'workspace.enc'))).mode & 0o077, 0);
});
