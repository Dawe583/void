import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const desktop = fileURLToPath(new URL('../', import.meta.url));
// Avoid Finder AppleScript automation during DMG creation. The installer still
// contains the application and Applications shortcut, without interactive layout.
const child = spawn(fileURLToPath(new URL('../node_modules/.bin/tauri', import.meta.url)), ['build', ...process.argv.slice(2)], {
  cwd: desktop,
  env: { ...process.env, CI: 'true' },
  stdio: 'inherit',
});
child.once('error', error => { console.error(`Could not start the desktop build: ${error.message}`); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
