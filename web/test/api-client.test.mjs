import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../public/api-client.js';

test('simultaneous reads share one request; writes are never merged or retried', async () => {
  let finish;
  let calls = 0;
  const client = createApiClient({ fetcher: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = client.request('/api/profile');
  const second = client.request('/api/profile');
  assert.equal(calls, 1);
  finish(Response.json({ success: true, data: { name: 'A' } }));
  assert.deepEqual(await first, { name: 'A' });
  assert.deepEqual(await second, { name: 'A' });
  const pending = client.request('/api/profile');
  assert.equal(calls, 2, 'Completed reads are not reused as stale data');
  finish(Response.json({ success: true, data: { name: 'B' } }));
  assert.deepEqual(await pending, { name: 'B' });
  let mutations = 0;
  const writer = createApiClient({ fetcher: async () => { mutations++; return Response.json({ success: false }, { status: 503 }); } });
  await Promise.allSettled([writer.request('/api/profile', 'PUT', {}), writer.request('/api/profile', 'PUT', {})]);
  assert.equal(mutations, 2);
});

test('changing identity invalidates pending reads; errors release the request slot', async () => {
  let finish;
  const client = createApiClient({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const old = client.request('/api/auth/session');
  client.reset();
  finish(Response.json({ success: true, data: { username: 'old-account' } }));
  await assert.rejects(old, /sesión cambió/);
  let attempts = 0;
  const retry = createApiClient({ fetcher: async () => {
    attempts++;
    return attempts === 1 ? Response.json({ success: false, message: 'Offline' }, { status: 503 }) : Response.json({ success: true, data: 'Online' });
  } });
  await assert.rejects(retry.request('/api/health'), /Offline/);
  assert.equal(await retry.request('/api/health'), 'Online');
  assert.equal(attempts, 2);
});
