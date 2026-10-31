// Starts the yfinance API server, finding a working Python and installing
// dependencies on first run. Used by `npm run server` / `npm run dev`.
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'pipe' });

const python = ['python3', 'python', 'py'].find((c) => run(c, ['--version']).status === 0);
if (!python) {
  console.error('[api] Python 3 was not found. Install it from https://www.python.org/downloads/ and retry.');
  process.exit(1);
}

if (run(python, ['-c', 'import flask, flask_cors, yfinance']).status !== 0) {
  console.log('[api] Installing Python dependencies (first run only)...');
  const pip = spawnSync(python, ['-m', 'pip', 'install', '-r', path.join(dir, 'requirements.txt')], {
    stdio: 'inherit',
  });
  if (pip.status !== 0) {
    console.error('[api] pip install failed. Run: pip install -r server/requirements.txt');
    process.exit(1);
  }
}

console.log(`[api] Starting yfinance server on http://127.0.0.1:8000 (using ${python})`);
const child = spawn(python, [path.join(dir, 'app.py')], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
