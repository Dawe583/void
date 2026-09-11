import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { makeConnector } from './registry.ts';
import { LocalSnapshotStore } from './snapshot/local.ts';
import { manifestWriter, manifestReader } from './manifest.ts';
import { applyInverse, type ReplayExecutor } from './postgres/replay.ts';
import { buildInverse } from './postgres/inverse.ts';
import { captureBeforeImage } from './postgres/capture.ts';
import { parseStatement } from './postgres/parse.ts';
import { interceptCall } from '../../proxy/src/forward/tools.ts';
import { jsonlStore } from '../../ledger/src/store.ts';
import { devKeyProvider } from '../../ledger/src/sign.ts';
import { verifyLedgerFile } from '../../ledger/src/verify.ts';

test('40 concurrent independent manifest writers retain every capture', async t => {
  const dir=await mkdtemp(join(tmpdir(),'void-manifest-race-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await Promise.all(Array.from({length:40},(_,i)=>manifestWriter(dir).write({tool:'postgres.row.update',digest:String(i),reference:{namespace:'test',digest:`sha256:${'a'.repeat(64)}`,uri:'file:///test'}})));
  assert.equal((await manifestReader(dir)).length,40);
  await writeFile(join(dir,'manifest.jsonl.lock'),'other-owner');
  await assert.rejects(manifestWriter(dir).write({tool:'test',digest:'blocked',reference:{namespace:'test',digest:`sha256:${'a'.repeat(64)}`,uri:'file:///test'}}),/EEXIST/);
  assert.equal((await manifestReader(dir)).length,40);
});

test('cross-layer fixture: captured PostgreSQL update, policy receipt, forward, restart inverse, signed verification',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'void-reverse-'));const db=new PGlite();t.after(async()=>{await db.close();await rm(dir,{recursive:true,force:true});});
  await db.exec("create table account(id int primary key, balance int);insert into account values(1,10),(2,90)");
  const exec:ReplayExecutor={query:async<T>(sql:string,params?:readonly unknown[])=>(await db.query<T>(sql,params?[...params]:[])).rows,begin:async()=>{await db.exec('begin')},commit:async()=>{await db.exec('commit')},rollback:async()=>{await db.exec('rollback')}};
  const store=LocalSnapshotStore(join(dir,'snapshots')),key=await devKeyProvider({dir:join(dir,'keys'),env:{}}),ledger=jsonlStore(key,{dir:join(dir,'ledger')}),call={tool:'postgres.row.update',connector:'postgres' as const,workspace:'isolated',arguments:{sql:'update public.account set balance = 20 where id = 1',schema:{tables:[{table:'public.account',primaryKey:['id']}]}}};
  const connector=makeConnector({store,exec}).postgres,captured=await connector.capture(call);
  const verdict=await interceptCall({tool:call.tool,connector:'postgres',workspace:'isolated',args:call.arguments},{classify:()=>({outcome:'classified',tone:'r1',entry: {} } as never),policy:()=>({kind:'allow'} as never),hold:async()=>{throw new Error('unexpected hold')},ledger:async entry=>{await ledger.append({...entry,workspace:'isolated'});}});
  assert.equal(verdict.kind,'allow');await exec.query(call.arguments.sql);
  await ledger.append({workspace:'isolated',at:new Date().toISOString(),tool:call.tool,klass:'r1',decision:'execute:completed',captureDigest:captured.reference.digest,argsDigest:'fixture'});
  const fresh=makeConnector({store,exec}).postgres,plan=await fresh.inverse(captured.reference);
  // Mutating a caller-held implementation detail must not redirect restoration.
  (plan as unknown as {postgres:{image:{rows:{row:Record<string,unknown>}[]}}}).postgres.image.rows[0]!.row.balance=999;
  const report=await fresh.apply(plan);assert.deepEqual(report.refused,[]);
  assert.deepEqual((await db.query('select * from account order by id')).rows,[{id:1,balance:10},{id:2,balance:90}]);
  assert.equal((await verifyLedgerFile(join(dir,'ledger/isolated.jsonl'),{publicKey:id=>key.publicKey(id)})).ok,true);
  const repeated=await fresh.apply(await fresh.inverse(captured.reference));assert.equal(repeated.refused[0]?.reason,'drift');
  const tampered=await fresh.inverse(captured.reference);(tampered.steps[0] as unknown as {target:string}).target='public.unrelated';await assert.rejects(fresh.apply(tampered),/differs/);
});

test('real PostgreSQL constraint failure rolls back all inverse steps; missing transaction refuses before queries',async t=>{
  const db=new PGlite();t.after(()=>db.close());await db.exec('create table sample(id int primary key, value int);insert into sample values(1,10),(2,20)');
  const exec:ReplayExecutor={query:async<T>(sql:string,params?:readonly unknown[])=>(await db.query<T>(sql,params?[...params]:[])).rows,begin:async()=>{await db.exec('begin')},commit:async()=>{await db.exec('commit')},rollback:async()=>{await db.exec('rollback')}};
  const image=await captureBeforeImage(exec,parseStatement('delete from public.sample'),{tables:[{table:'public.sample',primaryKey:['id']}]});await db.exec('delete from sample;alter table sample add constraint forbid_second check(id<>2)');
  const report=await applyInverse(exec,buildInverse(image.statement,image),image);assert.equal(report.refused[0]?.reason,'internal_error');assert.deepEqual((await db.query('select * from sample')).rows,[]);
  let queries=0;const unsafe=await applyInverse({query:async()=>{queries++;return[]}},buildInverse(image.statement,image),image);assert.equal(queries,0);assert.equal(unsafe.refused[0]?.stepId,'transaction');
});

test('ledger failure prevents an allowed proxy call from being forwarded',async()=>{
  const verdict=await interceptCall({tool:'postgres.row.delete',connector:'postgres',args:{}},{classify:()=>({outcome:'classified',tone:'r1'} as never),policy:()=>({kind:'allow'} as never),hold:async()=>{throw new Error('unexpected')},ledger:async()=>{throw new Error('disk unavailable')}});
  assert.equal(verdict.kind,'deny');
});

test('two concurrent Undo attempts sharing a PostgreSQL connection perform one restore',async t=>{
  const db=new PGlite();t.after(()=>db.close());await db.exec('create table item(id int primary key,value int);insert into item values(1,10)');
  const exec:ReplayExecutor={query:async<T>(sql:string,params?:readonly unknown[])=>(await db.query<T>(sql,params?[...params]:[])).rows,begin:async()=>{await db.exec('begin')},commit:async()=>{await db.exec('commit')},rollback:async()=>{await db.exec('rollback')}};
  const image=await captureBeforeImage(exec,parseStatement('update public.item set value = 20 where id = 1'),{tables:[{table:'public.item',primaryKey:['id']}]});await db.exec('update item set value=20 where id=1');
  const results=await Promise.all([applyInverse(exec,buildInverse(image.statement,image),image),applyInverse(exec,buildInverse(image.statement,image),image)]);
  assert.equal(results.filter(r=>r.applied.length===1).length,1);assert.equal(results.filter(r=>r.refused[0]?.reason==='drift').length,1);assert.deepEqual((await db.query('select * from item')).rows,[{id:1,value:10}]);
});

test('oversized capture refuses without evicting the existing inverse',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'void-capture-budget-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=LocalSnapshotStore(dir,{maxBytes:4}),prior=await store.put('isolated',new Uint8Array([1,2,3]));
  await assert.rejects(store.put('isolated',new Uint8Array(5)),/exceeds/);assert.deepEqual([...await store.get(prior.reference)],[1,2,3]);
});
