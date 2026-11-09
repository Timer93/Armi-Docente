import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-sync-status-'));
const mirror = path.join(root, 'mirror');
const databaseFolder = path.join(root, 'database');
const runtimeFolder = path.join(root, 'sync-runtime');
fs.mkdirSync(databaseFolder, { recursive: true });
fs.mkdirSync(path.join(mirror, '.armi-sync', 'current'), { recursive: true });
fs.mkdirSync(runtimeFolder, { recursive: true });
fs.copyFileSync(path.join(process.cwd(), 'database', 'armi.db'), path.join(databaseFolder, 'armi.db'));
fs.writeFileSync(path.join(runtimeFolder, 'sync-config.json'), JSON.stringify({
  mode: 'drive_mirror',
  mirrorPath: mirror,
  autoSyncOnClose: true,
  syncUserKey: 'performance-test',
  syncUserLabel: 'Performance Test',
}), 'utf8');
fs.writeFileSync(path.join(mirror, '.armi-sync-root.json'), JSON.stringify({ format: 1, syncUserKey: 'performance-test' }), 'utf8');
fs.writeFileSync(path.join(mirror, '.armi-sync', 'current', 'manifest.json'), JSON.stringify({
  version: 2,
  digest: 'test',
  generatedAt: new Date().toISOString(),
  summary: { entities: {} },
  files: [],
}), 'utf8');

const port = 36_000 + (process.pid % 500);
const child = spawn(process.execPath, ['backend/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ARMI_DATA_ROOT: root,
    ARMI_DISABLE_DRIVE_LAUNCH: '1',
    ARMI_BACKEND_PORT: String(port),
    ARMI_STUDENT_PORTAL_PORT: String(port + 1),
    NODE_ENV: 'production',
    ARMI_USE_VITE_MIDDLEWARE: '0',
  },
  stdio: process.env.ARMI_TEST_LOGS === '1' ? 'inherit' : 'ignore',
  windowsHide: true,
});

try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/sync/status`);
  const latencyMs = Date.now() - startedAt;
  assert.equal(response.ok, true);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.ok(latencyMs < 2_000, `Consultar el estado bloqueo ${latencyMs} ms.`);
  let maxHealthLatencyMs = 0;
  // Include initial capture, legacy-grade preparation and batch publication;
  // checking only the first few seconds can miss a later blocking phase.
  const backgroundDeadline = Date.now() + 20_000;
  while (Date.now() < backgroundDeadline) {
    const healthStartedAt = Date.now();
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    maxHealthLatencyMs = Math.max(maxHealthLatencyMs, Date.now() - healthStartedAt);
    assert.equal(health.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(maxHealthLatencyMs < 2_000, `La cola incremental bloqueo el servidor ${maxHealthLatencyMs} ms.`);
  const visualState = { armi_performance_probe: 'x'.repeat(450_000) };
  const saveResponse = await fetch(`http://127.0.0.1:${port}/api/sync/frontend-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: visualState }),
  });
  assert.equal(saveResponse.ok, true);
  const duplicateResponse = await fetch(`http://127.0.0.1:${port}/api/sync/frontend-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: visualState }),
  });
  const duplicatePayload = await duplicateResponse.json();
  assert.equal(duplicatePayload.data?.unchanged, true, 'El mismo estado visual se volvio a escribir innecesariamente.');
  const closeStartedAt = Date.now();
  const localStatus = await fetch(`http://127.0.0.1:${port}/api/sync/status/local`);
  const closeLatencyMs = Date.now() - closeStartedAt;
  assert.equal(localStatus.ok, true);
  assert.ok(closeLatencyMs < 3_000, `Preparar el cierre bloqueo ${closeLatencyMs} ms.`);
  console.log(`OK: estado ${latencyMs} ms; salud ${maxHealthLatencyMs} ms; cierre ${closeLatencyMs} ms.`);
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}
