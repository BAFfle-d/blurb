/**
 * Make sure the Electron app binary is actually downloaded.
 *
 * Electron's package downloads its binary in an install script. Newer npm
 * versions block dependency install scripts until you approve them, which
 * leaves Electron half-installed ("Error: Electron uninstall"). This runs that
 * download on demand before `npm run dev:desktop`, so a fresh copy just works.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let dir;
try {
  dir = path.dirname(require.resolve('electron/package.json'));
} catch {
  console.error('Electron is not installed yet. Run `npm install` first.');
  process.exit(1);
}

const pathTxt = path.join(dir, 'path.txt');
if (fs.existsSync(pathTxt)) {
  const exe = fs.readFileSync(pathTxt, 'utf8').trim();
  if (exe && fs.existsSync(path.join(dir, 'dist', exe))) process.exit(0);
}

console.log('Downloading Electron (one time, about 100 MB)…');
const r = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit', cwd: dir });
if (r.status !== 0) {
  console.error('Electron download failed. Check your connection and try again (or set ELECTRON_MIRROR).');
}
process.exit(r.status ?? 1);
