import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadPending, writeDecision } from '../../../packages/policy/src/approvals.ts';
import type { ApprovalBroker } from './server.ts';

/** Queue decisions for the existing proxy; never create a second broker that
 * would overwrite its pending state or claim a held call has been released. */
export function localApprovals(env: Readonly<NodeJS.ProcessEnv>): ApprovalBroker {
  const workspace = env.VOID_WORKSPACE ?? 'default';
  if (!/^[A-Za-z0-9_-]+$/.test(workspace)) throw new Error('invalid approval workspace');
  const dir = env.VOID_APPROVALS_DIR ?? join(homedir(), '.void', 'approvals', workspace);
  return {
    listPending() {
      try { return loadPending(dir).filter(record => record.expiresAt > Date.now()); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    decide(id, decision) {
      writeDecision(dir, id, decision);
      return { queued: true };
    },
  };
}
