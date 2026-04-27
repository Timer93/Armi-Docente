import { spawn } from 'child_process';

const backendPort = 3000;
const backendHealthUrl = `http://127.0.0.1:${backendPort}/api/health`;
const startupTimeoutMs = 30000;
const pollIntervalMs = 400;

const childProcesses = new Set();
let shuttingDown = false;
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const prefixStream = (stream, prefix, target) => {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach((line) => {
      if (line.length === 0) {
        target.write(`${prefix}\n`);
        return;
      }
      target.write(`${prefix}${line}\n`);
    });
  });
  stream.on('end', () => {
    if (buffer.length > 0) {
      target.write(`${prefix}${buffer}\n`);
    }
  });
};

const spawnChild = (command, args, label) => {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env },
  });

  childProcesses.add(child);
  prefixStream(child.stdout, `[${label}] `, process.stdout);
  prefixStream(child.stderr, `[${label}] `, process.stderr);

  child.on('exit', (code, signal) => {
    childProcesses.delete(child);
    if (shuttingDown) return;

    if (label === 'backend') {
      console.error(`[dev] El backend terminó inesperadamente (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`);
      shutdown(typeof code === 'number' ? code : 1);
      return;
    }

    shutdown(typeof code === 'number' ? code : 0);
  });

  child.on('error', (error) => {
    console.error(`[dev] No pude iniciar ${label}: ${error.message}`);
    shutdown(1);
  });

  return child;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runPreflight = (command, args, label) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env },
  });

  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`[dev] ${label} fallo con code=${code ?? 'null'}.`));
  });

  child.on('error', (error) => {
    reject(new Error(`[dev] No pude iniciar ${label}: ${error.message}`));
  });
});

const canLoadBetterSqliteForNode = async () => {
  const script = [
    "const { createRequire } = require('module');",
    "const requireFromHere = createRequire(process.cwd() + '\\\\');",
    "requireFromHere('better-sqlite3');",
    "process.stdout.write('OK');",
  ].join(' ');

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env },
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('exit', (code) => {
      resolve({
        ok: code === 0,
        error: stderr.trim(),
      });
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        error: error.message,
      });
    });
  });
};

const isBackendReady = async () => {
  try {
    const response = await fetch(backendHealthUrl);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForBackend = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (await isBackendReady()) return true;
    await wait(pollIntervalMs);
  }
  return false;
};

const shutdown = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of childProcesses) {
    try {
      child.kill('SIGTERM');
    } catch {}
  }

  setTimeout(() => process.exit(exitCode), 150);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const sqliteProbe = await canLoadBetterSqliteForNode();
if (!sqliteProbe.ok) {
  process.stdout.write('[dev] better-sqlite3 no coincide con Node actual. Recompilando...\n');
  await runPreflight(npmCmd, ['run', 'rebuild:native:node'], 'rebuild:native:node');
} else {
  process.stdout.write('[dev] better-sqlite3 ya esta listo para Node. Continuo sin recompilar.\n');
}

const backend = spawnChild('node', ['backend/server.js'], 'backend');
const backendReady = await waitForBackend();

if (!backendReady) {
  console.error(`[dev] El backend no respondió en ${startupTimeoutMs / 1000}s: ${backendHealthUrl}`);
  shutdown(1);
} else {
  process.stdout.write('[dev] Backend listo. Iniciando frontend...\n');
  spawnChild('npm', ['run', 'dev:frontend'], 'frontend');
}
