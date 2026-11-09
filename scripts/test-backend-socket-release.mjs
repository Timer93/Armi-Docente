import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('backend/server.js', 'utf8');
const code = source.slice(source.indexOf('const shutdownServer = async'), source.indexOf('const handleProcessShutdown ='));
const closed = [];
let releaseWorker;
const blockedWorker = new Promise(resolve => { releaseWorker = resolve; });
const env = {
  serverShutdownPromise: null, studentHttpServer: 'student', primaryHttpServer: 'teacher',
  closeHttpServer: server => { closed.push(server); return Promise.resolve(); },
  studentAgentPruneTimer: 1, clearInterval() {},
  studentDiscovery: { close: () => closed.push('discovery') },
  studentAgentService: { close: () => closed.push('agent') },
  accessExtensionService: { close: () => closed.push('extension') },
  evidenceReconciliationTimer: 2,
  shutdownEvidenceReconciliation: () => blockedWorker,
  evidenceRecoveryStatusWorker: { terminate: () => blockedWorker },
  stopContinuousSync: () => {}, shutdownRemoteAccess: async () => { closed.push('tunnel'); },
};
const shutdown = new Function('env', `with(env){${code};return shutdownServer;}`)(env);
let done = false;
const pending = shutdown().then(() => { done = true; });
await Promise.resolve();
assert.deepEqual(closed, ['student', 'teacher', 'discovery', 'agent', 'extension', 'tunnel']);
assert.equal(done, false, 'The fixture must still have blocked filesystem workers');
void shutdown();
assert.equal(closed.length, 6, 'Repeated shutdown must share the cleanup');
releaseWorker(); await pending;
assert.equal(done, true);
console.log('OK: both HTTP listeners, discovery and tunnel close before waiting for stuck filesystem workers.');
