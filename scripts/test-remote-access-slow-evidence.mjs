import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-remote-slow-evidence-'));
process.env.ARMI_DATA_ROOT = root;
let reconciliationCalls = 0;
globalThis.armiSlowEvidenceReconciliation = () => {
  reconciliationCalls += 1;
  return new Promise(() => {}); // A Drive placeholder that never finishes reading.
};
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/backend/evidenceReconciliationService.js')) return {
      format: 'module', shortCircuit: true,
      source: 'export const reconcileEvidenceState = () => globalThis.armiSlowEvidenceReconciliation();',
    };
    return nextLoad(url, context);
  },
});

let service;
try {
  const { CloudflareTunnelProvider } = await import('../backend/remote-access/CloudflareTunnelProvider.js');
  const prototype = CloudflareTunnelProvider.prototype;
  prototype.initialize = async function () { this.status = 'DISABLED'; };
  prototype.resolveExecutable = async () => 'test-cloudflared';
  prototype.start = async function () { this.status = 'CONNECTED'; this.publicUrl = 'https://test.invalid'; };
  prototype.stop = async function () { this.status = 'DISCONNECTED'; this.publicUrl = ''; };
  prototype.getStatus = async function () { return this.status; };
  prototype.isRunning = function () { return this.status === 'CONNECTED'; };

  service = await import('../backend/remote-access/remoteAccessService.js');
  const withDeadline = async (operation) => {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Remote access waited for the blocked evidence index')), 1500);
      })]);
    } finally { clearTimeout(timer); }
  };
  const started = await withDeadline(service.startRemoteAccess(new Date(Date.now() + 60_000).toISOString()));
  assert.equal(started.tunnelStatus, 'CONNECTED');
  assert.equal(started.publicUrl, 'https://test.invalid');
  assert.ok(Date.parse(started.accessEndsAt) > Date.now(), 'Countdown starts after the portal connects');
  const restarted = await withDeadline(service.restartRemoteAccess());
  assert.equal(restarted.tunnelStatus, 'CONNECTED');
  assert.equal(reconciliationCalls, 2, 'Evidence reconciliation continues in the background');
  await service.stopRemoteAccess();
  assert.equal((await service.getRemoteAccessSnapshot()).enabledByTeacher, false);
  console.log('OK: iniciar, reiniciar y detener el enlace no esperan una lectura bloqueada de Drive.');
} finally {
  await service?.shutdownRemoteAccess();
  hooks.deregister();
  delete globalThis.armiSlowEvidenceReconciliation;
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  fs.rmSync(resolved, { recursive: true, force: true });
}
