import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const execute = promisify(execFile);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const resources = join(desktop, 'src-tauri/resources');
const cache = join(desktop, '.cache');
const version = '24.21.0';
const checksums = {
  'darwin-arm64': 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
  'darwin-x64': '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
};
const target = `${process.platform}-${process.arch}`;
if (!checksums[target]) throw new Error(`Desktop packaging is currently verified for macOS arm64/x64; unsupported host: ${target}`);
await mkdir(cache, { recursive: true });
const archive = `node-v${version}-${target}.tar.gz`;
const archivePath = join(cache, archive);
let bytes;
try { bytes = await readFile(archivePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!bytes) {
  const response = await fetch(`https://nodejs.org/dist/v${version}/${archive}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== checksums[target]) throw new Error('Bundled Node SHA-256 does not match the pinned official release.');
await writeFile(archivePath, bytes);
await execute('tar', ['-xzf', archivePath, '-C', cache, `node-v${version}-${target}/bin/node`, `node-v${version}-${target}/LICENSE`]);
await rm(resources, { recursive: true, force: true });
await mkdir(join(resources, 'runtime'), { recursive: true });
await mkdir(join(resources, 'bin'), { recursive: true });
await copyFile(join(cache, `node-v${version}-${target}/bin/node`), join(resources, 'bin/node'));
await chmod(join(resources, 'bin/node'), 0o755);
await copyFile(join(cache, `node-v${version}-${target}/LICENSE`), join(resources, 'bin/NODE-LICENSE'));
await copyFile(join(desktop, 'runtime.mjs'), join(resources, 'runtime/runtime.mjs'));
await build({
  entryPoints: [join(root, 'apps/control-plane/api/server.ts')],
  outfile: join(resources, 'runtime/backend.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['pg-native'],
  banner: { js: "import { createRequire as __voidCreateRequire } from 'node:module'; const require = __voidCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
await cp(join(root, 'apps/control-plane/web'), join(resources, 'web'), { recursive: true, filter: source => !source.includes('.test.') });
await cp(join(root, 'packages/policy/packs'), join(resources, 'packs'), { recursive: true });
await execute(join(desktop, 'node_modules/.bin/tauri'), ['icon', join(root, 'apps/control-plane/web/icon.svg'), '-o', join(desktop, 'src-tauri/icons')], { cwd: desktop });
console.log(`VOID desktop resources prepared with verified Node ${version} (${target}).`);
