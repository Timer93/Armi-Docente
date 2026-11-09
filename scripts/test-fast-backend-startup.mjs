import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-startup-check-'));
const databaseFolder = path.join(root, 'database');
fs.mkdirSync(databaseFolder, { recursive: true });
fs.copyFileSync(path.join(process.cwd(), 'database', 'armi.db'), path.join(databaseFolder, 'armi.db'));
const port = 35_000 + (process.pid % 500);
const startedAt = Date.now();
const child = spawn(process.execPath, ['backend/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ARMI_DATA_ROOT: root,
    ARMI_BACKEND_PORT: String(port),
    ARMI_STUDENT_PORTAL_PORT: String(port + 1),
    NODE_ENV: 'production',
    ARMI_USE_VITE_MIDDLEWARE: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverLogs = '';
child.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
child.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });

let readyMs = 0;
let maxHealthLatencyMs = 0;
try {
  const startupDeadline = Date.now() + 30_000;
  while (Date.now() < startupDeadline) {
    assert.equal(child.exitCode, null, `El backend termino antes de iniciar.\n${serverLogs}`);
    try {
      const requestStartedAt = Date.now();
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      maxHealthLatencyMs = Math.max(maxHealthLatencyMs, Date.now() - requestStartedAt);
      if (response.ok) {
        readyMs = Date.now() - startedAt;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(readyMs > 0, `El backend no respondio dentro de 30 segundos.\n${serverLogs}`);

  // Incluye el momento en que arranca el mantenimiento diferido y su worker.
  const maintenanceDeadline = Date.now() + 8_000;
  while (Date.now() < maintenanceDeadline) {
    const requestStartedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.ok, true);
    maxHealthLatencyMs = Math.max(maxHealthLatencyMs, Date.now() - requestStartedAt);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(maxHealthLatencyMs < 2_000, `El mantenimiento bloqueo el servidor durante ${maxHealthLatencyMs} ms.`);
  const startResponse = await fetch(`http://127.0.0.1:${port}/api/sync/bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: {}, background: true, requestId: 'startup-integration' }),
  });
  assert.equal(startResponse.status, 202, 'Startup must return a receipt instead of waiting for recovery.');
  const receipt = (await startResponse.json()).data.job;
  let completed = null;
  const recoveryDeadline = Date.now() + 10_000;
  while (Date.now() < recoveryDeadline) {
    const status = await (await fetch(`http://127.0.0.1:${port}/api/sync/bootstrap/${receipt.id}`)).json();
    if (status.data?.job?.status === 'completed') { completed = status.data.job.result; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(completed?.success, true, 'Polling must deliver the recovered state.');
  assert.ok(completed.data.frontendState.keys);
  console.log(`OK: backend listo en ${readyMs} ms; latencia maxima durante mantenimiento ${maxHealthLatencyMs} ms.`);
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}
