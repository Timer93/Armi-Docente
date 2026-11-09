import assert from 'node:assert/strict';
import { createInternetConnectivityMonitor } from '../backend/internetConnectivity.js';

let time = 1000, calls = 0, mode = 'online';
const transitions = [];
const monitor = createInternetConnectivityMonitor({ now: () => time, onChange: change => transitions.push(change),
  requester: async (url, options) => {
    calls += 1;
    assert.equal(options.method, 'HEAD');
    if (mode === 'offline') throw new TypeError('fetch failed', { cause: { code: 'ENETUNREACH' } });
    if (!url.includes('cloudflare')) throw new TypeError('blocked Google host');
    return new Response(null, { status: 403 });
  },
});
const first = await Promise.all([monitor.check(), monitor.check(), monitor.check()]);
assert.ok(first.every(result => result.online === true), 'A blocked provider or non-204 status is not an outage');
assert.equal(calls, 3, 'Concurrent checks share one probe batch');
assert.equal(first[0].checking, false);
mode = 'offline';
await monitor.check();
assert.equal(calls, 3, 'A short cache prevents an HTTP storm');
time += 3001;
assert.equal((await monitor.check()).online, false);
mode = 'online';
assert.equal((await monitor.check({ force: true })).online, true, 'Network events bypass the stale outage cache');
assert.deepEqual(transitions.map(change => change.online), [true, false, true]);

const unknown = createInternetConnectivityMonitor({ requester: async () => new Response(null, { status: 503 }) });
assert.equal((await unknown.check()).online, null, 'Service failures must not be called a disconnection');
const slow = createInternetConnectivityMonitor({ timeoutMs: 30, requester: (_, { signal }) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
}) });
assert.equal((await slow.check({ wait: false })).checking, true, 'Local status does not wait on network probes');
const startedAt = Date.now();
assert.equal((await slow.check()).online, null);
assert.ok(Date.now() - startedAt < 500, 'All slow providers are bounded by one shared timeout');
console.log('OK: conexion, desconexion, recuperacion inmediata, proveedor bloqueado, cache y timeout.');
