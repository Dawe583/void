import pg from 'pg';
import type { ReplayExecutor } from '../../connectors/src/postgres/replay.ts';

/** One connection owns the entire replay transaction. SERIALIZABLE rejects a
 * concurrent write between drift inspection and restore, including phantoms. */
export async function postgresExecutor(url: string): Promise<ReplayExecutor & { close(): Promise<void> }> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  try { await client.connect(); }
  catch { await client.end().catch(() => {}); throw new Error('Postgres connection failed. Check VOID_PG_URL and target availability.'); }
  return {
    async query<T>(sql: string, params?: readonly unknown[]) { return (await client.query(sql, params ? [...params] : undefined)).rows as T[]; },
    async begin() { await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); },
    async commit() { await client.query('COMMIT'); },
    async rollback() { await client.query('ROLLBACK'); },
    async close() { await client.end(); },
  };
}
