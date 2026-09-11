import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export function matchesToken(value: string | undefined, token: string): boolean {
  const a = Buffer.from(value ?? '');
  const b = Buffer.from(token);
  return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

export function authorizedRemote(request: IncomingMessage, env: Readonly<NodeJS.ProcessEnv>): boolean {
  const token = env.VOID_CONTROL_TOKEN;
  if (!token || token.length < 32) return false;
  // Remote access is opt-in and bearer-only. A gateway attaches the credential
  // server-side; untrusted websites never get a cross-origin cookie authority.
  if (request.headers.origin !== undefined) return false;
  return matchesToken(request.headers.authorization?.replace(/^Bearer /, ''), token);
}
