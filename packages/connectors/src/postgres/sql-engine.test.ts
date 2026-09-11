import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { captureBeforeImage } from './capture.ts';
import { parseStatement } from './parse.ts';
import { buildInverse } from './inverse.ts';
import { applyInverse, type ReplayExecutor } from './replay.ts';

test('PostgreSQL engine restores parent and cascade children without selecting unrelated ids', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table orders (id integer primary key, status text);
    create table items (id integer primary key, order_id integer references orders(id) on delete cascade);
    create table notes (id integer primary key, item_id integer references items(id) on delete cascade);
    insert into orders values (1, 'delete'), (10, 'keep');
    insert into items values (100, 1), (1, 10), (200, 10);
    insert into notes values (300, 100), (100, 200);
  `);
  const exec: ReplayExecutor = {
    query: async <T>(sql: string, params?: readonly unknown[]) => (await db.query<T>(sql, params ? [...params] : [])).rows,
    begin: async () => { await db.exec('begin'); }, commit: async () => { await db.exec('commit'); }, rollback: async () => { await db.exec('rollback'); },
  };
  const image = await captureBeforeImage(exec, parseStatement('delete from public.orders where id = 1'), { tables: ['orders', 'items', 'notes'].map(table => ({ table: `public.${table}`, primaryKey: ['id'] })) });
  assert.deepEqual(image.rows.map(row => [row.table, row.key.id]), [['public.orders', '1'], ['public.items', '100'], ['public.notes', '300']]);
  await db.exec('delete from orders where id = 1');
  const report = await applyInverse(exec, buildInverse(image.statement, image), image);
  assert.deepEqual(report.refused, []);
  assert.deepEqual((await db.query('select id from items order by id')).rows, [{ id: 1 }, { id: 100 }, { id: 200 }]);
  assert.deepEqual((await db.query('select id from notes order by id')).rows, [{ id: 100 }, { id: 300 }]);
  const duplicate = await applyInverse(exec, buildInverse(image.statement, image), image);
  assert.equal(duplicate.refused[0]?.reason, 'drift');
});
