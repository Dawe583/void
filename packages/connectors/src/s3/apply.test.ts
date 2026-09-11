import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRestore } from './apply.ts';
import type { S3Client } from './classify.ts';
import { sha256 } from './capture.ts';

test('a concurrent S3 writer makes conditional restoration refuse instead of overwrite', async () => {
  const bytes = new TextEncoder().encode('before');
  const reference = { namespace: 's3', uri: 'memory://before', digest: sha256(bytes) };
  const client: S3Client = {
    getObject: async () => ({ body: bytes, etag: 'known-etag' }),
    putObject: async input => {
      assert.equal(input.ifMatch, 'known-etag');
      throw { $metadata: { httpStatusCode: 412 } };
    },
    deleteObject: async () => ({}), getBucketVersioning: async () => ({}),
  };
  const result = await applyRestore({ get: async () => bytes, put: async () => ({ reference, digest: reference.digest }) }, client, { stepId: 'restore', call: { bucket: 'fixture', key: 'fixture' }, reference, capturedEtag: 'known-etag' });
  assert.deepEqual(result, { applied: [], refused: [{ stepId: 'restore', reason: 'drift', changed: [] }] });
});

test('S3 read failures refuse without leaking upstream credentials or performing writes',async()=>{
  let writes=0;const client:S3Client={getObject:async()=>{throw Object.assign(new Error('private-service-credential'),{statusCode:403})},putObject:async()=>{writes++;return{}},deleteObject:async()=>({}),getBucketVersioning:async()=>({})};
  const bytes=new Uint8Array(),reference={namespace:'test',uri:'memory://test',digest:sha256(bytes)};
  const report=await applyRestore({get:async()=>bytes,put:async()=>({reference,digest:reference.digest})},client,{stepId:'restore',call:{bucket:'fixture',key:'fixture'},reference});
  assert.equal(writes,0);assert.equal(report.refused[0]?.reason,'permission_denied');assert.doesNotMatch(JSON.stringify(report),/private-service/);
});
