import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { registerHooks } from 'node:module';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-sync-completion-'));
process.env.ARMI_DATA_ROOT = root;
process.env.ARMI_DISABLE_DRIVE_LAUNCH = '1';
const mirror = path.join(root, 'mirror');
fs.mkdirSync(path.join(root, 'database'), { recursive: true });
fs.mkdirSync(path.join(root, 'sync-runtime'), { recursive: true });
fs.mkdirSync(mirror);
new Database(path.join(root, 'database/armi.db')).close();
fs.writeFileSync(path.join(root, 'sync-runtime/sync-config.json'), JSON.stringify({ mode: 'drive_mirror', mirrorPath: mirror, syncUserKey: 'completion-test' }));
fs.writeFileSync(path.join(mirror, '.armi-sync-root.json'), JSON.stringify({ format: 1, syncUserKey: 'completion-test' }));
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/backend/driveDesktopLauncher.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createDriveDesktopLauncher = () => ({ observe: async () => ({ processRunning: true, starting: false, launchAttempted: false }) });' };
  if (url.endsWith('/backend/internetConnectivity.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createInternetConnectivityMonitor = () => ({ check: async () => ({ online: true, checking: false }), snapshot: () => ({ online: true, checking: false }) });' };
  return nextLoad(url, context);
} });
let db, stop;
try {
  const sync = await import('../backend/sync.js');
  db = (await import('../backend/db.js')).default;
  stop = sync.startContinuousMirrorSync({ initialDelayMs: 500, intervalMs: 60_000 });
  // Let startup and its own initial filesystem notifications settle.
  await new Promise(resolve => setTimeout(resolve, 2000));
  const waitUntilDone = async () => {
    const deadline = Date.now() + 10_000;
    let result;
    while (Date.now() < deadline) {
      result = (await sync.getLocalSyncStatus()).data;
      if (result.continuousSync.state === 'in-sync' && !result.hasUnsyncedChanges) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Synchronization never completed: ${JSON.stringify(result?.continuousSync)}`);
  };
  const finished = await waitUntilDone();
  for (let i = 0; i < 8; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 200));
    const polled = (await sync.getLocalSyncStatus()).data;
    assert.equal(polled.continuousSync.state, 'in-sync', 'Reading a completed status must not restart a transfer');
    assert.equal(polled.continuousSync.lastSuccessAt, finished.continuousSync.lastSuccessAt);
    assert.equal(polled.hasUnsyncedChanges, false);
  }
  db.prepare('UPDATE datos_generales SET teacher = ? WHERE id = 1').run('Cambio de prueba');
  const pending = (await sync.getLocalSyncStatus()).data;
  assert.equal(pending.hasUnsyncedChanges, true, 'A real edit must wake the queue and progress indicator');
  const updated = await waitUntilDone();
  assert.notEqual(updated.continuousSync.lastSuccessAt, finished.continuousSync.lastSuccessAt);
  assert.equal(updated.incrementalSync.pendingOperations, 0);
  console.log('OK: la sincronizacion termina, consultar no la reinicia y los cambios reales vuelven a sincronizarse.');
} finally {
  stop?.();
  db?.close();
  hooks.deregister();
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  fs.rmSync(resolved, { recursive: true, force: true });
}
