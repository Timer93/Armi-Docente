import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryStorage, installWebRuntime, getWebIdentity, setWebIdentity } from '../frontend/runtime.js';

test('web transport allows real login but never sends unmigrated operations or external requests', async () => {
  const calls = [];
  const win = { location: { href: 'https://web.armiapp.com/', origin: 'https://web.armiapp.com' }, fetch: async (...args) => { calls.push(args); return Response.json({ success: true }); } };
  const reset = installWebRuntime(win);
  for (const [url, method] of [['/api/datos-generales', 'POST'], ['/api/estudiantes', 'GET'], ['/api/auth/session', 'PUT'], ['/api/cloud/push', 'POST'], ['http://127.0.0.1:3000/api/estudiantes', 'GET'], ['https://external.test/api', 'POST']]) {
    const result = await win.fetch(url, { method });
    assert.equal(result.status, 404);
    assert.equal((await result.json()).success, false);
  }
  assert.equal(calls.length, 0, 'Unsupported operations consume no Cloudflare or localhost requests');
  await win.fetch('/api/auth/login', { method: 'POST' });
  await win.fetch('/api/auth/session');
  await win.fetch('/api/auth/logout', { method: 'POST' });
  assert.equal(calls.length, 3);
  win.localStorage.setItem('armi_student_list', 'private draft');
  win.sessionStorage.setItem('armi_auth_session_v1', 'forged browser identity');
  setWebIdentity({ user: { id: 'a' } });
  reset();
  assert.equal(win.localStorage.length, 0);
  assert.equal(win.sessionStorage.length, 0);
  assert.equal(getWebIdentity(), null);
});

test('temporary storage preserves browser storage semantics without persistence', () => {
  const a = createMemoryStorage();
  const b = createMemoryStorage();
  assert.equal(a.getItem('missing'), null);
  a.setItem('key', 123);
  assert.equal(a.getItem('key'), '123');
  assert.equal(a.key(0), 'key');
  assert.equal(a.key(1), null);
  assert.equal(a.length, 1);
  assert.equal(b.getItem('key'), null);
  a.removeItem('key');
  assert.equal(a.length, 0);
});
