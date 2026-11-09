import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('backend/public/student-portal.html', 'utf8');
const code = html.slice(html.indexOf('    const api=async'), html.indexOf('    const compactGradeText='));
const create = fetch => {
  let requests = 0, logouts = 0, delays = 0;
  const state = { token: 'saved-session' };
  const api = new Function('fetch', 'state', 'performLogout', 'setTimeout', 'clearTimeout', `${code};return api;`)(
    (...args) => { requests++; return fetch(...args); }, state, async () => { logouts++; state.token = ''; },
    (callback, ms) => { if (ms < 15000) { delays++; queueMicrotask(callback); } return 1; }, () => {},
  );
  return { api, state, counts: () => ({ requests, logouts, delays }) };
};
const response = (status = 200) => new Response(JSON.stringify({ success: status === 200, data: ['lesson'], message: 'Temporary error' }), { status });
let attempt = 0;
const transient = create(async () => ++attempt < 3 ? response(503) : response());
assert.deepEqual(await transient.api('/sessions'), ['lesson']);
assert.deepEqual(transient.counts(), { requests: 3, logouts: 0, delays: 2 });
const healthy = create(async () => response());
await healthy.api('/sessions');
assert.equal(healthy.counts().delays, 0, 'Successful reads must not add retry delay');
const write = create(async () => response(503));
await assert.rejects(write.api('/evidence', { method: 'POST', body: '{}' }));
assert.deepEqual(write.counts(), { requests: 1, logouts: 0, delays: 0 }, 'Writes must never be duplicated');
attempt = 0;
const network = create(async () => { if (!attempt++) throw new TypeError('fetch failed'); return response(); });
await network.api('/sessions'); assert.equal(network.counts().requests, 2);
const outage = create(async () => response(503));
await assert.rejects(outage.api('/info'));
assert.equal(outage.state.token, 'saved-session', 'A network error must preserve authentication');
const forbidden = create(async () => response(403));
await assert.rejects(forbidden.api('/sessions')); assert.equal(forbidden.counts().requests, 1);
const expired = create(async () => response(401));
await assert.rejects(expired.api('/sessions')); assert.equal(expired.counts().logouts, 1);
const abort = create(async () => response());
const controller = new AbortController(); controller.abort();
await assert.rejects(abort.api('/sessions', { signal: controller.signal }));
assert.equal(abort.counts().requests, 0);
console.log('OK: bounded GET retries, no healthy-read delay, no duplicate writes, session preserved on outage, 401 logout, and cancellation.');
