import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { createAccessControlStore, normalizeBlockedDomain, validateAccessControl } from '../backend/accessControl.js';
import { createAccessControlRouter } from '../backend/routes/accessControl.routes.js';

const db = new Database(':memory:');
db.exec('CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
const store = createAccessControlStore(db);
const config = { version: 1, groups: [{ id: 'class3', name: '3ro U' }], devices: [{ id: 'pc01', name: 'PC 01', groupId: 'class3' }],
  rules: [{ id: 'rule1', name: 'Redes sociales', enabled: true, domains: ['https://www.facebook.com/watch', 'facebook.com'], scope: 'group', groupId: 'class3', deviceIds: [] }] };
assert.equal(store.read().revision, 'empty');
assert.equal(db.prepare('SELECT count(*) AS n FROM armi_frontend_state').get().n, 0, 'Opening an empty panel must not publish empty defaults');
const saved = store.save(config, 'empty');
assert.deepEqual(saved.config.rules[0].domains, ['facebook.com']);
assert.deepEqual(createAccessControlStore(db).read(), saved, 'Configuration survives reopening');
assert.deepEqual(store.save(saved.config, saved.revision), saved, 'Unchanged saves do not emit writes');
assert.throws(() => store.save(config, 'empty'), error => error.status === 409);
assert.equal(store.read().revision, saved.revision, 'A stale write cannot replace current rules');
for (const domain of ['javascript:alert(1)', 'https://user:pass@example.com', 'example.com:8080', 'https://bad_domain.com', '', 'localhost']) assert.throws(() => normalizeBlockedDomain(domain));
assert.equal(normalizeBlockedDomain('HTTPS://WWW.Example.COM/a'), 'example.com');
assert.throws(() => validateAccessControl({ ...config, groups: [] }));
assert.throws(() => validateAccessControl({ ...config, rules: [{ ...config.rules[0], scope: 'devices', deviceIds: ['unknown'] }] }));
assert.deepEqual(validateAccessControl({ ...config, rules: [{ ...config.rules[0], scope: 'devices', deviceIds: ['pc01'] }] }).rules[0].deviceIds, ['pc01']);
assert.equal(validateAccessControl({ ...config, rules: [{ ...config.rules[0], scope: 'all' }] }).rules[0].groupId, null);

const app = express(); app.use(express.json());
const server = http.createServer(app), studentServer = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => studentServer.listen(0, '127.0.0.1', resolve));
app.use('/api/admin/access-control', createAccessControlRouter({ db, teacherPort: server.address().port }));
const url = `http://127.0.0.1:${server.address().port}/api/admin/access-control`;
try {
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(url, { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'CF-Connecting-IP': '203.0.113.1' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.1' } })).status, 403);
  assert.equal((await fetch(url, { headers: { Origin: 'http://localhost:5173', 'X-Forwarded-For': '127.0.0.1' } })).status, 200, 'Local Vite proxy must work');
  assert.equal((await fetch(`http://127.0.0.1:${studentServer.address().port}/api/admin/access-control`)).status, 403);
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: saved.config, revision: 'stale' }) });
  assert.equal(response.status, 409);
  console.log('OK: persistent groups/devices/rules, domain validation, individual/group/all scopes, conflict protection and teacher-only API.');
} finally { await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => studentServer.close(resolve))]); db.close(); }
