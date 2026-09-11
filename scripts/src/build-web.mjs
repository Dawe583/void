import { mkdir, copyFile, readdir } from 'node:fs/promises';
const source = new URL('../../apps/control-plane/web/', import.meta.url);
const output = new URL('../../dist/web/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) {
  if (!name.includes('.test.') && /\.(html|css|js|svg|webmanifest)$/.test(name)) await copyFile(new URL(name, source), new URL(name, output));
}
console.log('VOID web build ready: dist/web');
