import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldRecoverTunnel } from '../backend/remote-access/tunnelRecovery.js';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-quick-tunnel-'));
process.env.ARMI_DATA_ROOT = testRoot;

const [{ CloudflareTunnelProvider }, { TUNNEL_STATUS }] = await Promise.all([
  import('../backend/remote-access/CloudflareTunnelProvider.js'),
  import('../backend/remote-access/TunnelProvider.js'),
]);

const provider = new CloudflareTunnelProvider({ config: { mode: 'quick' } });
provider.child = { killed: false, exitCode: null };
provider.status = TUNNEL_STATUS.STARTING;
provider.publicUrl = 'https://armi-regression-test.trycloudflare.com';
provider.checkConnectorReady = async () => true;
provider.checkLocalServer = async () => true;
const sample = () => { provider.lastHealthCheckAt = 0; provider.lastSuccessfulHealthAt = 0; return provider.getStatus(); };
let publicChecks = 0;
provider.checkPublicServer = async () => { publicChecks += 1; return false; };
provider.checkPublicDnsPublished = async () => false;

assert.equal(await sample(), TUNNEL_STATUS.STARTING);
assert.equal(publicChecks, 0, 'Do not query normal DNS before Cloudflare publishes the hostname');
provider.checkPublicDnsPublished = async () => true;

assert.equal(
  await sample(),
  TUNNEL_STATUS.STARTING,
  'Publicar el DNS no basta para anunciar que el portal esta conectado.',
);
assert.equal(publicChecks, 1, 'Verify the public portal as soon as Cloudflare publishes DNS');
assert.equal(provider.getPublicUrl(), '', 'Do not expose the URL while normal DNS cannot open it');
provider.status = TUNNEL_STATUS.CONNECTED;
assert.equal(await sample(), TUNNEL_STATUS.CONNECTED);
assert.equal(await sample(), TUNNEL_STATUS.CONNECTED);
assert.equal(await sample(), TUNNEL_STATUS.DISCONNECTED);
provider.checkPublicServer = async () => true;
assert.equal(await sample(), TUNNEL_STATUS.CONNECTED);
assert.equal(provider.getPublicUrl(), provider.publicUrl);
const originalFetch = globalThis.fetch;
// Concurrent status panels share one probe and cannot spend the failure budget.
provider.lastHealthCheckAt = 0; provider.lastSuccessfulHealthAt = 0;
provider.consecutiveHealthFailures = 0;
let finishProbe;
provider.checkPublicServer = () => { publicChecks++; return new Promise(resolve => { finishProbe = resolve; }); };
const concurrent = Array.from({ length: 12 }, () => provider.getStatus());
await new Promise(resolve => setImmediate(resolve));
const checksDuringProbe = publicChecks;
finishProbe(false); await Promise.all(concurrent);
assert.equal(provider.consecutiveHealthFailures, 1, 'One shared failure is one sample');
await Promise.all(Array.from({ length: 12 }, () => provider.getStatus()));
assert.equal(publicChecks, checksDuringProbe, 'UI polling must honor the health-check interval even after failure');
provider.publicFailureKind = 'dns'; provider.consecutiveHealthFailures = 2;
provider.checkPublicServer = async () => false;
await sample();
assert.equal(provider.getConnectionInfo().automaticRecoveryAllowed, false, 'Changing the tunnel cannot repair local DNS');
provider.checkPublicServer = CloudflareTunnelProvider.prototype.checkPublicServer.bind(provider);
try {
  globalThis.fetch = async (url) => String(url).endsWith('/api/health')
    ? new Response(JSON.stringify({ success: true }), { headers: { 'x-armi-portal': 'student-only' } })
    : new Response('Missing portal', { status: 404 });
  assert.equal(await provider.checkPublicServer(), false, 'Health alone must not hide a broken student page');
  globalThis.fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); };
  assert.equal(await provider.checkPublicServer(), false);
  assert.equal(provider.publicFailureKind, 'dns');
  assert.match(provider.publicFailureMessage(), /DNS/);
  globalThis.fetch = async (url) => String(url).endsWith('/api/health')
    ? new Response(JSON.stringify({ success: true }), { headers: { 'x-armi-portal': 'student-only' } })
    : new Response('<title>ARMI Estudiantes</title>');
  assert.equal(await provider.checkPublicServer(), true);
  assert.equal(provider.publicFailureKind, '');
} finally { globalThis.fetch = originalFetch; }

const recovery = { state: { enabledByTeacher: true, tunnelStatus: 'DISCONNECTED' },
  disconnectedSince: 1000, lastRestartAt: 1000, attempts: 0, now: 200000 };
assert.equal(shouldRecoverTunnel(recovery), true, 'Recover even if the process is still running');
assert.equal(shouldRecoverTunnel({ ...recovery, state: { ...recovery.state, automaticRecoveryAllowed: false } }), false);
assert.equal(shouldRecoverTunnel({ ...recovery, attempts: 3 }), false, 'Bound retries');
assert.equal(shouldRecoverTunnel({ ...recovery, now: 2000 }), false, 'Wait for propagation');
for (const field of ['connectedStudents', 'activeUploads', 'queuedUploads', 'activeTransfers']) {
  assert.equal(shouldRecoverTunnel({ ...recovery, state: { ...recovery.state, [field]: 1 } }), false);
}
assert.equal(shouldRecoverTunnel({ ...recovery, state: { enabledByTeacher: false, tunnelStatus: 'DISCONNECTED' } }), false);
assert.equal(shouldRecoverTunnel({ ...recovery, state: { ...recovery.state, tunnelStatus: 'STARTING' } }), false);

fs.rmSync(testRoot, { recursive: true, force: true });
console.log('OK: el enlace solo figura conectado cuando responde el portal publico.');
