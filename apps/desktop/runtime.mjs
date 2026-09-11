/** The desktop owns this process through stdin. No provider or policy logic lives here. */
import { existsSync } from 'node:fs';
import { mkdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';

process.umask(0o077);
const dataDir = process.env.VOID_DATA_DIR;
if (!dataDir || !process.env.VOID_DESKTOP_WEB_ROOT) throw new Error('Desktop runtime requires explicit data and web directories.');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await chmod(dataDir, 0o700);
// A desktop instance is loopback-only and does not inherit cloud operator credentials.
delete process.env.VOID_CONTROL_TOKEN;
process.env.VOID_DATA_DIR = resolve(dataDir);
process.env.VOID_LEDGER_DIR ??= join(dataDir, 'ledger');
const packaged = new URL('./backend.mjs', import.meta.url);
const backend = existsSync(packaged) ? packaged : new URL('../control-plane/api/server.ts', import.meta.url);
const { createControlPlaneServer } = await import(backend.href);
const server = createControlPlaneServer({ env: process.env, webRoot: process.env.VOID_DESKTOP_WEB_ROOT });
// The workbench consumes this key synchronously; MCP child processes never inherit it.
delete process.env.VOID_WORKSPACE_KEY;
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Desktop runtime did not bind loopback.');
process.stdout.write(`${JSON.stringify({ port: address.port, pid: process.pid })}\n`);
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 4000).unref();
}
process.stdin.resume();
process.stdin.once('end', stop);
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
