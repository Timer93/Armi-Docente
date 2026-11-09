import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { createAccessControlStore } from '../backend/accessControl.js';
import { createAccessExtensionService } from '../backend/accessExtension.js';
import { createAccessExtensionRouter } from '../backend/routes/accessExtension.routes.js';
import { createAccessControlRouter } from '../backend/routes/accessControl.routes.js';
import { createController } from '../extensions/armi-student-access/controller.js';
import { compilePolicy, normalizeServerUrl, permissionPattern, sameRules } from '../extensions/armi-student-access/policy.js';

const db = new Database(':memory:'), local = new Database(':memory:');
db.exec('CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
const store = createAccessControlStore(db);
let time = Date.now();
const service = createAccessExtensionService({ db, localDatabase: local, now: () => time });
const config = { version: 1, groups: [{ id: 'g1', name: '3ro U' }, { id: 'g2', name: '4to U' }],
  devices: [{ id: 'pc1', name: 'PC 01', groupId: 'g1' }, { id: 'pc2', name: 'PC 02', groupId: 'g1' }, { id: 'pc3', name: 'PC 03', groupId: 'g2' }],
  rules: [
    { id: 'all', name: 'Todos', enabled: true, domains: ['common.example'], scope: 'all', groupId: null, deviceIds: [] },
    { id: 'group', name: 'Grupo', enabled: true, domains: ['games.example'], scope: 'group', groupId: 'g1', deviceIds: [] },
    { id: 'one', name: 'Individual', enabled: true, domains: ['social.example'], scope: 'devices', groupId: null, deviceIds: ['pc2'] },
    { id: 'off', name: 'Deshabilitada', enabled: false, domains: ['disabled.example'], scope: 'all', groupId: null, deviceIds: [] },
  ] };
store.save(config, 'empty');
const app = express(); app.use(express.json());
app.use('/api/access-extension', createAccessExtensionRouter(service, { now: () => time }));
const teacher = http.createServer(app), student = http.createServer(app);
await new Promise(resolve => teacher.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => student.listen(0, '127.0.0.1', resolve));
app.use('/api/admin/access-control', createAccessControlRouter({ db, teacherPort: teacher.address().port, studentPort: student.address().port, extensionService: service }));
const origin = `http://127.0.0.1:${student.address().port}`;
const teacherUrl = `http://127.0.0.1:${teacher.address().port}/api/admin/access-control`;
let state = {}, rules = [], failDnr = false, writes = 0;
const reloadedTabs = [];
const restartedNavigations = [];
const api = { storage: { local: { get: async () => ({ armiConnection: structuredClone(state) }), set: async value => { state = structuredClone(value.armiConnection); } } },
  runtime: { getManifest: () => ({ version: '1.0.0' }) },
  tabs: { query: async () => [{ id: 1, url: 'https://child.games.example/watch' }, { id: 2, url: 'https://allowed.example' }, { id: 3, url: origin },
    { id: 4, url: 'https://allowed.example', pendingUrl: 'https://games.example/starting' }],
    reload: async id => { reloadedTabs.push(id); }, update: async (id, options) => { restartedNavigations.push([id, options.url]); } },
  declarativeNetRequest: {
    getDynamicRules: async () => structuredClone(rules),
    updateDynamicRules: async change => { if (failDnr) throw new Error('Simulated DNR failure'); writes++; rules = structuredClone(change.addRules); },
  } };
const controller = createController(api, fetch, () => time);
try {
  assert.equal((await fetch(`${origin}/api/admin/access-control/extension`)).status, 403, 'Student port cannot generate pairing codes');
  const generated = await (await fetch(`${teacherUrl}/devices/pc1/pairing`, { method: 'POST' })).json();
  const pairedCode = generated.data.code;
  await controller.pair(origin, pairedCode);
  assert.equal((await controller.status()).state, 'applied');
  assert.deepEqual(rules.filter(rule => rule.action.type === 'block').flatMap(rule => rule.condition.requestDomains), ['common.example', 'games.example']);
  assert.equal(service.status().find(device => device.deviceId === 'pc1').state, 'applied');
  assert.deepEqual(reloadedTabs, [1], 'Only already-open pages affected by the new policy should reload');
  assert.deepEqual(restartedNavigations, [[4,'https://games.example/starting']], 'An in-flight forbidden navigation must be reevaluated against the new rules');
  assert.equal(JSON.stringify(await controller.status()).includes(state.token), false, 'Popup status must not expose credentials');
  assert.equal(local.prepare('SELECT token_hash FROM credentials WHERE device_id=?').get('pc1').token_hash.includes(state.token), false);
  assert.throws(() => service.pair(pairedCode), /utilizado/);
  const unchangedRevision = store.read().revision;
  const firstWrites = writes;
  await controller.sync(); await controller.sync();
  assert.equal(writes, firstWrites, 'An unchanged policy must not rebuild browser rules');
  assert.deepEqual(reloadedTabs, [1], 'Unchanged polls must not interrupt open pages');
  assert.equal(store.read().revision, unchangedRevision, 'Presence and acknowledgements must not rewrite synchronized academic state');
  const other = service.pair(service.generatePairing('pc2').code);
  assert.deepEqual(other.policy.domains, ['common.example', 'games.example', 'social.example']);
  const third = service.pair(service.generatePairing('pc3').code);
  assert.deepEqual(third.policy.domains, ['common.example']);
  assert.throws(() => service.acknowledge(other.token, { revision: 'stale', blockedCount: 3 }), err => err.status === 409);
  const current = store.read(); store.save({ ...current.config, rules: current.config.rules.map(rule => rule.id === 'group' ? { ...rule, enabled: false } : rule) }, current.revision);
  assert.equal(service.status().find(device => device.deviceId === 'pc1').state, 'pending');
  await controller.sync();
  assert.deepEqual(rules.filter(rule => rule.action.type === 'block').flatMap(rule => rule.condition.requestDomains), ['common.example']);
  const cached = structuredClone(rules);
  const offline = createController(api, async () => { throw new Error('Sin red'); }, () => time);
  await offline.sync(); assert.deepEqual(rules, cached); assert.equal((await offline.status()).state, 'offline');
  await controller.sync();
  const next = store.read(); store.save({ ...next.config, rules: next.config.rules.map(rule => ({ ...rule, enabled: false })) }, next.revision);
  failDnr = true; await controller.sync(); assert.deepEqual(rules, cached); assert.equal(service.status().find(device => device.deviceId === 'pc1').state, 'error');
  failDnr = false; await controller.sync(); assert.equal(rules.filter(rule => rule.action.type === 'block').length, 0);
  service.revoke('pc1'); await controller.sync(); assert.equal(rules.length, 0); assert.equal((await controller.status()).paired, false);
  const expired = service.generatePairing('pc1'); time += 10 * 60_000 + 1; assert.throws(() => service.pair(expired.code), /vencido/);
  for (let i = 0; i < 25; i++) {
    const code = service.generatePairing('pc1').code;
    const response = await fetch(`${origin}/api/access-extension/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(response.status, 200, 'Many students on the same network can pair successfully'); await response.json();
  }
  for (let i = 0; i < 21; i++) {
    const response = await fetch(`${origin}/api/access-extension/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '0000-0000-0000' }) });
    assert.equal(response.status, i < 20 ? 403 : 429); await response.json();
  }
  assert.equal(normalizeServerUrl('http://192.168.1.5:3001/estudiante'), 'http://192.168.1.5:3001');
  assert.equal(permissionPattern('http://192.168.1.5:3001'), 'http://192.168.1.5/*');
  assert.throws(() => normalizeServerUrl('http://public.example'));
  assert.throws(() => normalizeServerUrl('https://user:pass@public.example'));
  assert.throws(() => compilePolicy({ protocol: 1, deviceId: 'pc1', revision: 'a'.repeat(64), domains: ['evil.example/path'] }, origin));
  const sample = compilePolicy({ protocol: 1, deviceId: 'pc1', revision: 'a'.repeat(64), domains: ['example.com'] }, origin);
  assert.equal(sameRules(sample, sample), true);
  assert.equal(sameRules(sample.map(rule => ({ ...rule, condition: { ...rule.condition, excludedRequestDomains: ['a.example.com'] } })), sample), false);
  let nativeSnapshot={paired:true,server:origin,policy:{protocol:1,deviceId:'pc1',deviceName:'PC nativa',revision:'a'.repeat(64),domains:['native.example']}};
  api.runtime.sendNativeMessage=async(name,message)=>{assert.equal(name,'org.armi.student');assert.equal(message.type,'policy');return {success:true,data:nativeSnapshot};};
  const nativeController=createController(api,()=>{throw new Error('Native mode must not request a browser pairing code or perform HTTP calls');},()=>time);
  await nativeController.sync();assert.equal((await nativeController.status()).paired,true);assert.equal((await nativeController.status()).native,true);assert.equal(state.token,undefined);assert.deepEqual(rules.filter(r=>r.action.type==='block').flatMap(r=>r.condition.requestDomains),['native.example']);
  const nativeRules=structuredClone(rules);api.runtime.sendNativeMessage=async()=>{throw new Error('Host offline');};await nativeController.sync();assert.deepEqual(rules,nativeRules);assert.equal((await nativeController.status()).state,'offline');
  api.runtime.sendNativeMessage=async()=>({success:true,data:{paired:false,policy:{revoked:true}}});await nativeController.sync();assert.equal(rules.length,0);assert.equal((await nativeController.status()).paired,false);
  console.log('OK: pairing, expiring one-use codes, hashed credentials, effective individual/group/all rules, real HTTP synchronization and acknowledgements, offline retention, failed application, revocation and brute-force limits.');
} finally { await Promise.all([new Promise(resolve => teacher.close(resolve)), new Promise(resolve => student.close(resolve))]); local.close(); db.close(); }
