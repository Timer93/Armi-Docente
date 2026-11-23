import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createWorker } from '../src/worker.js';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0001_identity.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0002_responsables.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0003_academic_snapshots.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0004_academic_edits.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0005_planning_edits.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0006_web_configuration.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0007_ai_student_portal.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0008_web_instruments.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0009_web_evaluation.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0010_teacher_portal_registry.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0011_student_passwords.sql', import.meta.url), 'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../migrations/0012_drive_connection.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  function prepare(sql, args = []) {
    return {
      bind(...values) { return prepare(sql, values); },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() {
        const results = sqlite.prepare(sql).all(...args);
        const writes = /^\s*(?:INSERT|UPDATE|DELETE)/i.test(sql) ? results.length : 0;
        return { success: true, results, meta: { rows_read: results.length, rows_written: writes } };
      },
      async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes), rows_read: 0, rows_written: Number(result.changes) } }; },
    };
  }
  let now = Date.parse('2026-11-21T17:00:00Z');
  const calls = [];
  const analyticsQueries = [];
  const analyticsResponse = { totals: [], accounts: [] };
  const ai={calls:[],respond:async()=>Response.json({candidates:[{content:{parts:[{text:'{"title":"Generado"}'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}})};
  const users = {
    docenteA: { username: 'docenteA', displayName: 'Docente A', institutionName: 'Colegio A', estado: 'Habilitad@', active: true, password: 'not-for-browser' },
    docenteB: { username: 'docenteB', displayName: 'Docente B', institutionName: 'Colegio B', subscriptionStatus: 'active', subscriptionActive: true },
  };
  const env = {
    DB: { prepare, async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } },
    ARMI_AUTH_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    ARMI_AI_ENCRYPTION_KEY:'ab'.repeat(32),
    ASSETS: { fetch: async () => new Response('<html>ARMI</html>', { headers: { 'content-type': 'text/html' } }) },
  };
  const requester = async (url, options) => {
    if(String(url).startsWith('https://generativelanguage.googleapis.com/')||String(url).startsWith('https://api.openai.com/')){ai.calls.push({url,options});return ai.respond(url,options);}
    if (String(url).startsWith('https://api.cloudflare.com/')) {
      analyticsQueries.push({ url, options });
      return Response.json({ data: options.body.includes('GROUP BY') ? analyticsResponse.accounts : analyticsResponse.totals });
    }
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return Response.json(body.password === 'correct' && users[body.username]
      ? { success: true, data: users[body.username] }
      : { success: false, message: 'Remote details must stay private' });
  };
  const worker = createWorker({ requester, clock: () => now });
  const call = (path, { method = 'GET', body, cookie = '', origin = 'https://app.armi.test', ip = '192.0.2.1', headers = {} } = {}) => worker.fetch(new Request(`https://app.armi.test${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': ip, cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const login = async (username = 'docenteA', extra = {}) => {
    const response = await call('/api/auth/login', { method: 'POST', body: { username, password: 'correct' }, ...extra });
    assert.equal(response.status, 200, await response.clone().text());
    return { response, cookie: response.headers.get('set-cookie').split(';')[0], data: (await response.json()).data };
  };
  return { sqlite, env, worker, call, login, calls, users, requester, analyticsQueries, analyticsResponse, ai, advance: ms => { now += ms; } };
}

test('Drive callback displays safe recovery pages without bypassing authentication', async t => {
  const f=fixture(t);
  const direct=await f.call('/api/drive/oauth/callback');
  assert.equal(direct.status,200);
  assert.match(direct.headers.get('content-type'),/text\/html/);
  assert.match(await direct.text(),/Conecta tu Google Drive/);
  const expired=await f.call('/api/drive/oauth/callback?code=private-code&state=private-state&error_description=%3Cscript%3E');
  assert.equal(expired.status,401);
  const html=await expired.text();
  assert.match(html,/Vuelve a iniciar sesión/);
  assert.ok(!html.includes('private-code')&&!html.includes('private-state')&&!html.includes('<script>'));
  assert.equal(expired.headers.get('referrer-policy'),'no-referrer');
  assert.equal(expired.headers.get('cache-control'),'no-store');
  const {cookie}=await f.login();
  const unconfigured=await f.call('/api/drive/oauth/callback?code=secret',{cookie});
  assert.equal(unconfigured.status,503);
  assert.match(await unconfigured.text(),/No se completó la conexión/);
  assert.equal((await f.call('/api/drive/profile')).status,401);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM drive_connections').get().n,0);
});

test('real SQLite schema: two teachers retain independent profiles; identity is derived from the session', async t => {
  const f = fixture(t);
  const a = await f.login();
  const b = await f.login('docenteB');
  assert.notEqual(a.data.user.id, b.data.user.id);
  const result = await f.call('/api/profile', { method: 'PUT', cookie: a.cookie, body: { displayName: 'Nombre A', institutionName: 'Nueva escuela' } });
  assert.equal(result.status, 200);
  const sessionA = (await (await f.call('/api/auth/session', { cookie: a.cookie })).json()).data;
  const sessionB = (await (await f.call('/api/auth/session', { cookie: b.cookie })).json()).data;
  assert.equal(sessionA.user.displayName, 'Nombre A');
  assert.equal(sessionB.user.displayName, 'Docente B');
  assert.equal(sessionB.user.institutionName, 'Colegio B');
  const spoof = await f.call('/api/profile', { method: 'PUT', cookie: a.cookie, body: { teacherId: b.data.user.id, displayName: 'Intruso', institutionName: '' } });
  assert.equal(spoof.status, 400);
  assert.equal(f.calls.length, 2, 'Session and profile operations do not query Apps Script');
  const again = await f.login();
  assert.equal(again.data.user.displayName, 'Nombre A', 'Login preserves profile edits');
});

test('shared Responsables module: tenant isolation, bounded fields and concurrent edit protection', async t => {
  const f = fixture(t);
  const endpoint = '/api/datos-generales/responsables';
  assert.equal((await f.call(endpoint)).status, 401);
  const a = await f.login();
  const b = await f.login('docenteB');
  const read = async cookie => (await (await f.call(endpoint, { cookie })).json()).data;
  const empty = await read(a.cookie);
  assert.equal(empty.revision, 0);
  const values = { ...empty.values, teacher: ' Docente A ', director: 'Directora A' };
  const write = (cookie, body) => f.call(endpoint, { method: 'PUT', cookie, body });
  assert.equal((await write(a.cookie, { values, revision: 0 })).status, 200);
  assert.equal((await read(a.cookie)).values.teacher, 'Docente A');
  assert.equal((await read(b.cookie)).values.director, '');
  assert.equal((await write(a.cookie, { values, revision: 0 })).status, 409, 'A second first-save cannot overwrite the first');
  assert.equal((await write(a.cookie, { values, revision: 1 })).status, 200);
  assert.equal((await write(a.cookie, { values: { ...values, director: 'Edición vieja' }, revision: 1 })).status, 409);
  assert.equal((await read(a.cookie)).values.director, 'Directora A');
  for (const body of [
    { values, revision: 2, teacherId: b.data.user.id },
    { values: { ...values, teacherId: b.data.user.id }, revision: 2 },
    { values: { ...values, director: 'a'.repeat(201) }, revision: 2 },
    { values: {}, revision: 2 },
    { values, revision: -1 },
  ]) assert.equal((await write(a.cookie, body)).status, 400);
  assert.equal((await write(b.cookie, { values: { ...empty.values, director: 'Director B' }, revision: 0 })).status, 200);
  assert.equal((await read(a.cookie)).values.director, 'Directora A');
  assert.equal(f.calls.length, 2, 'Module operations do not query Google');
  await f.call('/api/auth/logout', { method: 'POST', cookie: a.cookie, body: {} });
  assert.equal((await f.call(endpoint, { cookie: a.cookie })).status, 401);
  assert.equal((await read(b.cookie)).values.director, 'Director B');
});

test('Responsables reports a missing migration without exposing database errors', async t => {
  const f = fixture(t);
  const a = await f.login();
  f.sqlite.exec('DROP TABLE teacher_responsables');
  const response = await f.call('/api/datos-generales/responsables', { cookie: a.cookie });
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /migración 0002/);
});

test('credentials and tokens: HttpOnly cookie, only hashed session stored, no upstream password leakage', async t => {
  const f = fixture(t);
  const { response, cookie, data } = await f.login();
  const header = response.headers.get('set-cookie');
  for (const value of ['__Host-armi_web=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(header.includes(value));
  const stored = f.sqlite.prepare('SELECT * FROM web_sessions').get();
  assert.notEqual(stored.token_hash, cookie.split('=')[1]);
  assert.ok(!JSON.stringify(data).includes('not-for-browser'));
  assert.ok(!JSON.stringify(data).includes('correct'));
  assert.ok(!JSON.stringify(data).includes('script.google.com'));
  assert.equal(f.calls[0].body.Placa, '');
  assert.equal(f.calls[0].body['Contraseña'], 'correct');
  assert.equal(f.calls[0].body.action, 'Login');
  const forged = await f.call('/api/auth/session', { cookie: '__Host-armi_web=' + 'a'.repeat(64) });
  assert.equal(forged.status, 401);
});

test('sessions expire, rotate on login and revoke on logout without affecting other teachers', async t => {
  const f = fixture(t);
  const a = await f.login();
  const b = await f.login('docenteB');
  const rotated = await f.login('docenteA', { cookie: a.cookie });
  assert.equal((await f.call('/api/auth/session', { cookie: a.cookie })).status, 401);
  assert.equal((await f.call('/api/auth/logout', { method: 'POST', cookie: rotated.cookie, body: {} })).status, 200);
  assert.equal((await f.call('/api/auth/session', { cookie: rotated.cookie })).status, 401);
  assert.equal((await f.call('/api/auth/session', { cookie: b.cookie })).status, 200);
  f.advance(31 * 60_000);
  assert.equal((await f.call('/api/auth/session', { cookie: b.cookie })).status, 401);
  await f.worker.scheduled({}, f.env);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM web_sessions').get().n, 0);
});

test('inactive, pending, missing-status, expired and malformed memberships cannot get a session', async t => {
  const f = fixture(t);
  for (const overrides of [
    { estado: 'Pendiente' }, { estado: 'Bloqueado' }, { estado: '' }, { active: 'false' },
    { expiresAt: '2026-11-20T00:00:00Z' }, { expiresAt: 'not-a-date' },
  ]) {
    f.users.docenteA = { username: 'docenteA', estado: 'Habilitad@', active: true, ...overrides };
    const response = await f.call('/api/auth/login', { method: 'POST', body: { username: 'docenteA', password: 'correct' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM web_sessions').get().n, 0);
});

test('membership expiry caps session duration', async t => {
  const f = fixture(t);
  f.users.docenteA.expiresAt = '2026-11-21T17:05:00Z';
  const a = await f.login();
  assert.equal(a.data.sessionExpiresAt, f.users.docenteA.expiresAt.replace('Z', '.000Z'));
  f.advance(6 * 60_000);
  assert.equal((await f.call('/api/auth/session', { cookie: a.cookie })).status, 401);
});

test('cross-origin writes, non-JSON and oversized bodies fail before reaching Apps Script', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', origin: 'https://otro.test', body: { username: 'docenteA', password: 'correct' } })).status, 403);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { junk: 'x'.repeat(5000) } })).status, 413);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.call('/api/profile', { method: 'PUT', body: { displayName: 'X', institutionName: '' } })).status, 401);
});

test('login throttling persists across Worker instances sharing D1', async t => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { username: 'docenteA', password: 'wrong' } })).status, 401);
  }
  const replica = createWorker({ requester: f.requester, clock: () => Date.parse('2026-11-21T17:00:00Z') });
  const response = await replica.fetch(new Request('https://app.armi.test/api/auth/login', {
    method: 'POST', headers: { origin: 'https://app.armi.test', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
    body: JSON.stringify({ username: 'docenteA', password: 'correct' }),
  }), f.env);
  assert.equal(response.status, 429);
  assert.equal(f.calls.length, 10);
  f.advance(61_000);
  await f.login();
});

test('global login slots protect Apps Script and release after an upstream failure', async t => {
  const f = fixture(t);
  const now = Date.parse('2026-11-21T17:00:00Z');
  for (let i = 0; i < 5; i++) f.sqlite.prepare('INSERT INTO auth_leases(id,expires_at) VALUES(?,?)').run(String(i), now + 20_000);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { username: 'docenteA', password: 'correct' } })).status, 429);
  assert.equal(f.calls.length, 0);
  f.advance(21_000);
  const failing = createWorker({ requester: async () => { throw new Error('secret-upstream-detail'); }, clock: () => now + 21_000 });
  const response = await failing.fetch(new Request('https://app.armi.test/api/auth/login', {
    method: 'POST', headers: { origin: 'https://app.armi.test', 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'docenteA', password: 'correct' }),
  }), f.env);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('secret-upstream-detail'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_leases WHERE expires_at > ?').get(now + 21_000).n, 0);
});

test('configuration fails closed and static responses carry browser security headers', async t => {
  const f = fixture(t);
  for (const url of ['https://evil.test/macros/s/x/exec', 'http://script.google.com/macros/s/x/exec', 'https://script.google.com/macros/s/x/dev']) {
    f.env.ARMI_AUTH_APPS_SCRIPT_URL = url;
    assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { username: 'docenteA', password: 'correct' } })).status, 503);
  }
  assert.equal(f.calls.length, 0);
  const response = await f.call('/');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal((await f.call('/.dev.vars')).status, 404);
});

test('usage administration is checked on server; regular teachers cannot query other accounts', async t => {
  const f = fixture(t);
  f.env.ARMI_ADMIN_USERNAMES = 'Timer';
  f.users.Timer = { username: 'Timer', estado: 'Habilitad@', displayName: 'Timer' };
  const teacher = await f.login();
  const admin = await f.login('Timer');
  assert.equal(teacher.data.admin.canViewUsage, false);
  assert.equal(admin.data.admin.canViewUsage, true);
  assert.equal((await f.call('/api/admin/usage')).status, 401);
  assert.equal((await f.call('/api/admin/usage', { cookie: teacher.cookie })).status, 403);
  assert.equal(f.analyticsQueries.length, 0);
  const pending = await f.call('/api/admin/usage', { cookie: admin.cookie });
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).data.available, false, 'Unconfigured measurement must not appear as zero consumption');
  f.env.ARMI_CF_ACCOUNT_ID = 'a'.repeat(32);
  f.env.ARMI_ANALYTICS_READ_TOKEN = 'read-only-secret';
  f.env.USAGE_ANALYTICS = { writeDataPoint() {} };
  f.analyticsResponse.totals = [{ requests: '87000', rowsRead: '200', rowsWritten: '50' }];
  f.analyticsResponse.accounts = [{ teacherId: teacher.data.user.id, requests: '20', rowsRead: '30', rowsWritten: '2' }];
  const result = await f.call('/api/admin/usage?day=2026-11-21', { cookie: admin.cookie });
  assert.equal(result.status, 200);
  const report = (await result.json()).data;
  assert.equal(report.estimated, true);
  assert.equal(report.referenceUsage.find(value => value.metric === 'requests').level, 'high');
  assert.equal(report.accounts[0].username, 'docenteA');
  assert.ok(!JSON.stringify(report).includes('read-only-secret'));
  assert.equal(f.analyticsQueries.length, 2);
  await f.call('/api/admin/usage?day=2026-11-21', { cookie: admin.cookie });
  assert.equal(f.analyticsQueries.length, 2, 'Manual refreshes share a short per-isolate report cache');
  assert.equal((await f.call('/api/admin/usage?day=2026-11-21%27', { cookie: admin.cookie })).status, 400);
  f.env.ARMI_ADMIN_USERNAMES = '';
  assert.equal((await f.call('/api/admin/usage', { cookie: admin.cookie })).status, 403, 'Removing admin access applies even to an existing session');
});

test('telemetry is tenant-attributed, avoids a D1 counter write per read, and never includes credentials', async t => {
  const f = fixture(t);
  const points = [];
  f.env.USAGE_ANALYTICS = { writeDataPoint(point) { points.push(point); } };
  const a = await f.login();
  const before = f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  await f.call('/api/auth/session', { cookie: a.cookie });
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n, before, 'A session read must not write a counter to D1');
  assert.equal(points.at(-1).indexes[0], a.data.user.id);
  assert.equal(points.at(-1).blobs[1], '/api/auth/session');
  assert.equal(points.at(-1).doubles[3], 1);
  assert.equal(points.at(-1).doubles[4], 0, 'Session read does not authenticate against Google again');
  assert.ok(!JSON.stringify(points).includes('correct'));
  assert.ok(!JSON.stringify(points).includes(a.cookie.split('=')[1]));
  const count = points.length;
  await f.call('/');
  assert.equal(points.length, count, 'Static pages do not emit API usage points');
  f.env.USAGE_ANALYTICS = { writeDataPoint() { throw new Error('analytics unavailable'); } };
  assert.equal((await f.call('/api/profile', { method: 'PUT', cookie: a.cookie, body: { displayName: 'Guardado', institutionName: '' } })).status, 200);
});

test('academic copies isolate identical desktop IDs, hide incomplete imports and resume batches safely', async t => {
  const f = fixture(t); const a = await f.login(); const b = await f.login('docenteB');
  const records = name => [{ dataset: 'general', id: 'general', value: { teacher: name } }, { dataset: 'students', id: '1', value: { id: 1, name } }];
  const start = async (cookie, username, fingerprint) => {
    const result = await f.call('/api/academic/imports', { method:'POST', cookie, body: { ownerUsername:username, fingerprint:fingerprint.repeat(64), counts:{general:1,students:1,annual:0,units:0,sessions:0,frontend:0} } });
    assert.equal(result.status,200,await result.clone().text());return (await result.json()).data.importId;
  };
  const chunk = (cookie,id,sequence,data) => f.call(`/api/academic/imports/${id}/chunks`,{method:'POST',cookie,body:{sequence,records:data}});
  const commit = (cookie,id) => f.call(`/api/academic/imports/${id}/commit`,{method:'POST',cookie,body:{}});
  const read = async cookie => (await (await f.call('/api/academic/records?dataset=students',{cookie})).json()).data;
  assert.equal((await f.call('/api/academic/status')).status,401);
  const idA=await start(a.cookie,'docenteA','a');
  assert.equal((await chunk(a.cookie,idA,0,records('Alumno A').slice(0,1))).status,200);
  assert.equal((await commit(a.cookie,idA)).status,409);
  assert.deepEqual((await read(a.cookie)).records,[]);
  assert.equal((await chunk(a.cookie,idA,1,records('Alumno A').slice(1))).status,200);
  assert.equal((await chunk(a.cookie,idA,1,records('Alumno A').slice(1))).status,200);
  assert.equal((await chunk(a.cookie,idA,1,records('Cambió').slice(1))).status,409);
  assert.equal((await commit(a.cookie,idA)).status,200);
  assert.equal((await commit(a.cookie,idA)).status,200);
  assert.equal((await read(a.cookie)).revision,1);
  assert.equal((await read(a.cookie)).records[0].value.name,'Alumno A');
  assert.deepEqual((await read(b.cookie)).records,[]);
  assert.equal((await chunk(b.cookie,idA,2,records('Ataque'))).status,404);
  assert.equal((await chunk(a.cookie,idA,2,records('Tardío'))).status,409);
  const idB=await start(b.cookie,'docenteB','a');
  assert.equal((await chunk(b.cookie,idB,0,records('Alumno B'))).status,200);
  assert.equal((await commit(b.cookie,idB)).status,200);
  assert.equal((await read(b.cookie)).records[0].value.name,'Alumno B');
  assert.equal((await read(a.cookie)).records[0].value.name,'Alumno A');
  assert.equal((await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{ownerUsername:'docenteB'}})).status,403);
});

test('academic activation protects the current copy from competing replacements; private fields are refused', async t => {
  const f=fixture(t); const a=await f.login();
  const counts={general:1,students:0,annual:0,units:0,sessions:0,frontend:0};
  const start=async fingerprint=>{const r=await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{ownerUsername:'docenteA',fingerprint:fingerprint.repeat(64),counts}});assert.equal(r.status,200);return(await r.json()).data.importId;};
  const first=await start('b'); const second=await start('c');
  const upload=(id,value,extra={})=>f.call(`/api/academic/imports/${id}/chunks`,{method:'POST',cookie:a.cookie,body:{sequence:0,records:[{dataset:'general',id:'general',value}],...extra}});
  assert.equal((await upload(first,{api_key:'private'})).status,400);
  assert.equal((await upload(first,{accessToken:'private'})).status,400);
  assert.equal((await upload(first,{teacher:'A'}, {teacherId:'other'})).status,400);
  assert.equal((await upload(first,{teacher:'A'})).status,200);
  assert.equal((await upload(second,{teacher:'B'})).status,200);
  const commit=id=>f.call(`/api/academic/imports/${id}/commit`,{method:'POST',cookie:a.cookie,body:{}});
  assert.equal((await commit(first)).status,200);
  assert.equal((await commit(second)).status,409);
  const current=await f.call('/api/academic/records?dataset=general',{cookie:a.cookie});
  assert.equal((await current.json()).data.records[0].value.teacher,'A');
  assert.equal((await f.call('/api/academic/records?dataset=general&snapshot='+second,{cookie:a.cookie})).status,409);
  assert.equal((await f.call('/api/academic/records?dataset=unknown',{cookie:a.cookie})).status,400);
});

test('academic record pagination stays scoped to the active account and snapshot', async t => {
  const f=fixture(t);const a=await f.login();
  const values=[{dataset:'general',id:'general',value:{teacher:'A'}},...Array.from({length:25},(_,index)=>({dataset:'students',id:String(index+1),value:{id:index+1,name:'Alumno'}}))];
  const result=await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{ownerUsername:'docenteA',fingerprint:'d'.repeat(64),counts:{general:1,students:25,annual:0,units:0,sessions:0,frontend:0}}});
  const id=(await result.json()).data.importId;
  for(let offset=0;offset<values.length;offset+=20) assert.equal((await f.call(`/api/academic/imports/${id}/chunks`,{method:'POST',cookie:a.cookie,body:{sequence:offset/20,records:values.slice(offset,offset+20)}})).status,200);
  assert.equal((await f.call(`/api/academic/imports/${id}/commit`,{method:'POST',cookie:a.cookie,body:{}})).status,200);
  let cursor='';const ids=[];
  do {const page=await(await f.call('/api/academic/records?'+new URLSearchParams({dataset:'students',cursor,snapshot:id}),{cookie:a.cookie})).json();assert.equal(page.success,true);assert(page.data.records.length<=10);ids.push(...page.data.records.map(row=>row.id));cursor=page.data.nextCursor||'';}while(cursor);
  assert.equal(ids.length,25);assert.equal(new Set(ids).size,25);
});

test('web edits: create without import, tenant isolation, stale tab protection, deletion and private field rejection', async t => {
  const f=fixture(t);const a=await f.login();const b=await f.login('docenteB');
  const write=(cookie,overrides={})=>f.call('/api/academic/edit',{method:'PUT',cookie,body:{dataset:'students',id:'web-student-1',changes:{name:'Alumno A',grade:'1ro',section:'A'},action:'save',expectedRevision:0,snapshotId:null,operationId:crypto.randomUUID(),...overrides}});
  const read=async(cookie,dataset='students')=>(await(await f.call('/api/academic/records?dataset='+dataset,{cookie})).json()).data;
  assert.equal((await write('')).status,401);
  assert.equal((await write(a.cookie,{changes:{name:'A',password:'hidden'}})).status,400);
  assert.equal((await write(a.cookie,{teacherId:b.data.user.id})).status,400);
  const first=await write(a.cookie);assert.equal(first.status,200,await first.clone().text());
  assert.equal((await read(a.cookie)).records[0].revision,1);
  assert.deepEqual((await read(b.cookie)).records,[]);
  assert.equal((await write(b.cookie)).status,200,'Same ID is isolated by account');
  assert.equal((await write(a.cookie)).status,409,'Stale tab cannot overwrite');
  assert.equal((await write(a.cookie,{expectedRevision:1,changes:{name:'Nombre actualizado'}})).status,200);
  assert.equal((await read(a.cookie)).records[0].value.grade,'1ro','Patch preserves other fields');
  assert.equal((await read(b.cookie)).records[0].value.name,'Alumno A');
  assert.equal((await write(a.cookie,{expectedRevision:2,changes:{},action:'delete'})).status,200);
  assert.deepEqual((await read(a.cookie)).records,[]);
  assert.equal((await write(a.cookie,{expectedRevision:3})).status,409,'Deletion cannot be undone by stale autosave');
  assert.equal((await write(a.cookie,{dataset:'general',id:'general',changes:{teacher:'Docente editado'}})).status,200);
  assert.equal((await read(a.cookie,'general')).records[0].value.teacher,'Docente editado');
  const revision=(await read(a.cookie,'general')).revision;
  assert.equal((await f.call('/api/academic/records?dataset=students&revision='+(revision-1),{cookie:a.cookie})).status,409);
  assert.equal((await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{}})).status,409,'Imports cannot replace web edits');
});

test('web edits preserve imported payloads and handle repeated acknowledgements and old schema safely', async t => {
  const f=fixture(t);const a=await f.login();
  const start=await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{ownerUsername:'docenteA',fingerprint:'f'.repeat(64),counts:{general:1,students:1,annual:0,units:0,sessions:0,frontend:0}}});
  const id=(await start.json()).data.importId;
  const rows=[{dataset:'general',id:'general',value:{teacher:'Original'}},{dataset:'students',id:'1',value:{id:1,name:'Original',grade:'2do',section:'A',evaluations:{test:{level:'A'}}}}];
  await f.call(`/api/academic/imports/${id}/chunks`,{method:'POST',cookie:a.cookie,body:{sequence:0,records:rows}});
  await f.call(`/api/academic/imports/${id}/commit`,{method:'POST',cookie:a.cookie,body:{}});
  const body={dataset:'students',id:'1',changes:{name:'Editado'},action:'save',expectedRevision:0,snapshotId:id,operationId:crypto.randomUUID()};
  const put=body=>f.call('/api/academic/edit',{method:'PUT',cookie:a.cookie,body});
  assert.equal((await put({...body,snapshotId:'e'.repeat(64)})).status,409);
  assert.equal((await put(body)).status,200);
  assert.equal((await put(body)).status,200,'Acknowledgement can be fetched again');
  assert.equal((await put({...body,changes:{name:'Otro'}})).status,409);
  const read=(await(await f.call('/api/academic/records?dataset=students',{cookie:a.cookie})).json()).data;
  assert.equal(read.records[0].value.name,'Editado');assert.equal(read.records[0].value.evaluations.test.level,'A');
  assert.equal(JSON.parse(f.sqlite.prepare("SELECT payload_json FROM academic_records WHERE dataset='students'").get().payload_json).name,'Original');
  f.sqlite.exec('DROP TABLE academic_edits');
  const status=(await(await f.call('/api/academic/status',{cookie:a.cookie})).json()).data;
  assert.equal(status.editable,false);assert.equal((await put(body)).status,503);
});

test('planning: nested content persists per account; canonical identity, stale saves and secret/file rejection', async t => {
  const f=fixture(t);const a=await f.login();const b=await f.login('docenteB');
  const metadata={year:'2026',areaId:'ept',grade:'1ro',section:'A y B'};
  const write=(dataset,id,changes,extra={},cookie=a.cookie)=>f.call('/api/academic/edit',{method:'PUT',cookie,body:{dataset,id,changes,action:'save',expectedRevision:0,snapshotId:null,operationId:crypto.randomUUID(),...extra}});
  for (const [dataset,id,content] of [
    ['annual','2026-ept-1ro-A y B',{matrixChecks:{comp:{u1:true}},didacticUnits:{0:{title:'Unidad nueva'}},resourceFields:{medios:'Texto'}}],
    ['units','2026-ept-1ro-A y B-U1',{unitNumber:'1',title:'Mi unidad',criterios:{C1:['Criterio']},sesiones:[{id:1,title:'Sesión vinculada'}]}],
    ['sessions','2026-ept-1ro-A y B-U1-S1',{unitNumber:'1',sessionNumber:'1',title:'Mi sesión',secuencia:{inicio:{saberes:'<p>Texto</p>'}},assessmentModel:{criterios:[{text:'Criterio',levelDescriptors:{c:'Inicial',b:'Proceso',a:'Logrado',ad:'Destacado'}}]}}],
  ]) {
    const result=await write(dataset,id,{...metadata,...content});assert.equal(result.status,200,await result.clone().text());
    const records=(await(await f.call('/api/academic/records?dataset='+dataset,{cookie:a.cookie})).json()).data.records;
    assert.equal(records.length,1);assert.equal(records[0].value.id,id);assert.equal(records[0].revision,1);
    assert.deepEqual((await(await f.call('/api/academic/records?dataset='+dataset,{cookie:b.cookie})).json()).data.records,[]);
    assert.equal((await write(dataset,id,{title:'Otra pestaña'})).status,409);
    const changed=await write(dataset,id,{title:'Actualizado'},{expectedRevision:1});assert.equal(changed.status,200);
    const saved=(await changed.json()).data.value;assert.equal(saved.areaId,'ept');
    for (const key of Object.keys(content).filter(key=>key!=='title')) assert.deepEqual(saved[key],content[key]);
    assert.equal((await write(dataset,id,{areaId:'other'},{expectedRevision:2})).status,400);
    assert.equal((await write(dataset,id,{nested:{api_key:'secret'}},{expectedRevision:2})).status,400);
    assert.equal((await write(dataset,id,{nested:{faceDescriptor:[1,2,3]}},{expectedRevision:2})).status,400);
    assert.equal((await write(dataset,id,{nested:{levelDescriptors:{faceDescriptor:'private'}}},{expectedRevision:2})).status,400);
    assert.equal((await write(dataset,id,{photo:'data:image/png;base64,secret'},{expectedRevision:2})).status,400);
    assert.equal((await write(dataset,id,{text:'x'.repeat(256_001)},{expectedRevision:2})).status,400);
  }
  assert.equal((await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{}})).status,409);
});

test('planning deletion is persistent; only an explicit restore with the tombstone revision can recreate it', async t => {
  const f=fixture(t);const a=await f.login();const id='2026-ept-1ro-A-U1';
  const write=(action,revision,changes={})=>f.call('/api/academic/edit',{method:'PUT',cookie:a.cookie,body:{dataset:'units',id,changes,action,expectedRevision:revision,snapshotId:null,operationId:crypto.randomUUID()}});
  assert.equal((await write('save',0,{year:'2026',areaId:'ept',grade:'1ro',section:'A',unitNumber:'1',title:'Original'})).status,200);
  assert.equal((await write('delete',1)).status,200);
  assert.equal((await write('save',1,{title:'Stale tab'})).status,409);
  assert.equal((await write('save',2,{title:'Implicit restore'})).status,409);
  const read=async suffix=>(await(await f.call('/api/academic/records?dataset=units'+suffix,{cookie:a.cookie})).json()).data.records;
  assert.deepEqual(await read(''),[]);
  assert.deepEqual(await read('&includeDeleted=1'),[{id,value:{},revision:2,deleted:true}]);
  assert.equal((await write('restore',2,{title:'Recreada'})).status,200);
  assert.equal((await read(''))[0].value.title,'Recreada');
  assert.equal((await read(''))[0].revision,3);
});

test('missing planning migration preserves old module editing and planning consultation', async t => {
  const f=fixture(t);const a=await f.login();
  f.sqlite.exec('DROP TABLE planning_edits');
  const status=(await(await f.call('/api/academic/status',{cookie:a.cookie})).json()).data;
  assert.equal(status.editable,true);assert.equal(status.planningEditable,false);
  assert.equal((await f.call('/api/academic/records?dataset=annual',{cookie:a.cookie})).status,200);
  const rejected=await f.call('/api/academic/edit',{method:'PUT',cookie:a.cookie,body:{dataset:'annual'}});
  assert.equal(rejected.status,503);assert.match((await rejected.json()).message,/0005_planning_edits/);
});

test('web configuration: a new teacher can persist setup without import; settings are isolated and one batch has one revision',async t=>{
  const f=fixture(t);const a=await f.login();const b=await f.login('docenteB');
  const values={armi_areas:[{id:'8',name:'Educación para el Trabajo'}],armi_assignments:[{id:'a1',areaId:'8',areaName:'Educación para el Trabajo',grade:'1ro',section:'A',studentCharacterization:'Mi grupo'}],armi_calendar_state:{'2026-03-10':'A'},armi_holidays_v7:[{date:'2026-04-02',name:'Feriado'}],armi_schedule_config:{startTime:'07:30',totalHours:7,breaks:[]},armi_schedule_entries:[{id:'1',day:1,hourIndex:0,areaId:'8',grade:'1ro',section:'A'}]};
  const body={changes:values,removed:[],expectedRevision:0,snapshotId:null,operationId:crypto.randomUUID()};
  const put=(cookie,data=body)=>f.call('/api/academic/settings',{method:'PUT',cookie,body:data});
  assert.equal((await put('')).status,401);
  const result=await put(a.cookie);assert.equal(result.status,200,await result.clone().text());
  const saved=(await result.json()).data;assert.equal(saved.settingsRevision,1);assert.equal(saved.records.length,6);
  const read=async cookie=>(await(await f.call('/api/academic/records?dataset=frontend',{cookie})).json()).data;
  assert.deepEqual(Object.fromEntries((await read(a.cookie)).records.map(row=>[row.id,row.value])),values);
  assert.deepEqual((await read(b.cookie)).records,[]);
  assert.equal((await put(b.cookie,{...body,changes:{armi_areas:[{id:'9',name:'Otra área'}]}})).status,200);
  assert.equal((await read(a.cookie)).records.find(row=>row.id==='armi_areas').value[0].id,'8');
  const before=f.sqlite.prepare('SELECT revision FROM academic_heads WHERE teacher_id=?').get(a.data.user.id).revision;
  assert.equal((await put(a.cookie)).status,200,'Same acknowledgement is idempotent');
  assert.equal(f.sqlite.prepare('SELECT revision FROM academic_heads WHERE teacher_id=?').get(a.data.user.id).revision,before);
  assert.equal((await put(a.cookie,{...body,changes:{armi_areas:[]}})).status,409,'A reused operation cannot change its contents');
  const stale={...body,operationId:crypto.randomUUID(),changes:{armi_areas:[],armi_assignments:[]}};
  assert.equal((await put(a.cookie,stale)).status,409);
  assert.equal((await read(a.cookie)).records.find(row=>row.id==='armi_assignments').value.length,1,'No partial update on conflict');
  assert.equal((await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{}})).status,409,'Imports cannot replace web setup');
});

test('configuration rejects credential keys, nested secrets, invalid shapes and foreign identities before changing saved state',async t=>{
  const f=fixture(t);const a=await f.login();
  const put=extra=>f.call('/api/academic/settings',{method:'PUT',cookie:a.cookie,body:{changes:{armi_areas:[]},removed:[],expectedRevision:0,snapshotId:null,operationId:crypto.randomUUID(),...extra}});
  for(const extra of [{changes:{armi_auth_session_v1:{username:'fake'}}},{teacherId:'other'},{changes:{armi_areas:[{id:'1',name:'Área',api_key:'private'}]}},{changes:{armi_calendar_state:{photo:'data:image/png;base64,secret'}}},{changes:{armi_areas:{}}},{changes:{armi_areas:[{id:'1',name:'A'},{id:'1',name:'B'}]}},{changes:{armi_areas:[]},removed:['armi_areas']}])assert.equal((await put(extra)).status,400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM web_configurations').get().n,0);
});

test('configuration overlays and removals preserve imported records; another tab cannot overwrite the group',async t=>{
  const f=fixture(t);const a=await f.login();
  const started=await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{ownerUsername:'docenteA',fingerprint:'e'.repeat(64),counts:{general:1,students:0,annual:0,units:0,sessions:0,frontend:2}}});
  const snapshot=(await started.json()).data.importId;
  const records=[{dataset:'general',id:'general',value:{teacher:'A'}},{dataset:'frontend',id:'armi_areas',value:[{id:'1',name:'Importada'}]},{dataset:'frontend',id:'armi_schedule_config',value:{startTime:'08:00'}}];
  await f.call(`/api/academic/imports/${snapshot}/chunks`,{method:'POST',cookie:a.cookie,body:{sequence:0,records}});
  await f.call(`/api/academic/imports/${snapshot}/commit`,{method:'POST',cookie:a.cookie,body:{}});
  const put=(changes,removed=[],revision=0,snapshotId=snapshot)=>f.call('/api/academic/settings',{method:'PUT',cookie:a.cookie,body:{changes,removed,expectedRevision:revision,snapshotId,operationId:crypto.randomUUID()}});
  assert.equal((await put({armi_areas:[]},[],0,null)).status,409);
  assert.equal((await put({armi_areas:[{id:'2',name:'Editada'}]},['armi_schedule_config'])).status,200);
  const read=async()=>(await(await f.call('/api/academic/records?dataset=frontend',{cookie:a.cookie})).json()).data;
  assert.equal((await read()).records.length,1);assert.equal((await read()).records[0].value[0].name,'Editada');
  assert.equal(JSON.parse(f.sqlite.prepare("SELECT payload_json FROM academic_records WHERE dataset='frontend' AND record_id='armi_areas'").get().payload_json)[0].name,'Importada');
  assert.equal((await put({armi_schedule_config:{startTime:'09:00'}},[],1)).status,200);
  assert.equal((await read()).records.length,2);assert.equal((await read()).settingsRevision,2);
  assert.equal((await put({armi_areas:[]},[],1)).status,409);
});

test('missing setup migration leaves the previous modules and imported configuration readable',async t=>{
  const f=fixture(t);const a=await f.login();f.sqlite.exec('DROP TABLE web_configurations');
  const status=(await(await f.call('/api/academic/status',{cookie:a.cookie})).json()).data;
  assert.equal(status.settingsEditable,false);assert.equal(status.editable,true);assert.equal(status.planningEditable,true);
  assert.equal((await f.call('/api/academic/records?dataset=frontend',{cookie:a.cookie})).status,200);
  const response=await f.call('/api/academic/settings',{method:'PUT',cookie:a.cookie,body:{}});
  assert.equal(response.status,503);assert.match((await response.json()).message,/0006_web_configuration/);
});

test('AI credentials are encrypted per teacher; proxy uses headers, not browser secrets or query keys',async t=>{
 const f=fixture(t),a=await f.login(),b=await f.login('docenteB'),key='test-key-owned-by-A-not-real';
 const put=body=>f.call('/api/ai/credentials',{method:'PUT',cookie:a.cookie,body});
 assert.equal((await put({provider:'gemini',key,teacherId:b.data.user.id})).status,400);
 const connected=await put({provider:'gemini',key});assert.equal(connected.status,200,await connected.clone().text());
 assert.ok(!(await connected.text()).includes(key));
 const row=f.sqlite.prepare('SELECT * FROM ai_credentials WHERE teacher_id=?').get(a.data.user.id);
 assert.ok(!JSON.stringify(row).includes(key));assert.equal(row.iv.length,24);
 const profile=(await(await f.call('/api/ai/profile',{cookie:b.cookie})).json()).data;assert.equal(profile.providers.gemini,undefined);
 const body={provider:'gemini',model:'gemini-test',prompt:'Genera un JSON de prueba'};
 assert.equal((await f.call('/api/ai/generate',{method:'POST',cookie:b.cookie,body})).status,400);
 const generated=await f.call('/api/ai/generate',{method:'POST',cookie:a.cookie,body});assert.equal(generated.status,200,await generated.clone().text());assert.equal((await generated.json()).data.text,'{"title":"Generado"}');
 assert.equal(f.ai.calls.length,1);assert.equal(f.ai.calls[0].options.headers['x-goog-api-key'],key);assert.ok(!f.ai.calls[0].url.includes(key));
 assert.equal((await f.call('/api/ai/generate',{method:'POST',cookie:a.cookie,body:{...body,model:'../../other'}})).status,400);
 assert.equal((await f.call('/api/ai/generate',{method:'POST',cookie:a.cookie,body:{...body,config:{tools:[{}]}}})).status,400);
 f.sqlite.prepare('INSERT INTO ai_credentials(teacher_id,provider,cipher,iv,updated_at) VALUES(?,?,?,?,0)').run(b.data.user.id,'gemini',row.cipher,row.iv);
 assert.equal((await f.call('/api/ai/generate',{method:'POST',cookie:b.cookie,body})).status,503,'Ciphertext is bound to teacher and provider');
 assert.equal(f.ai.calls.length,1);
 delete f.env.ARMI_AI_ENCRYPTION_KEY;
 assert.equal((await(await f.call('/api/ai/profile',{cookie:a.cookie})).json()).data.ready,false);
 assert.equal((await put({provider:'gemini',key})).status,503);
});

test('AI errors do not expose provider secrets, do not trigger retries, and release the generation lease',async t=>{
 const f=fixture(t),a=await f.login(),key='test-key-provider-error-private';
 await f.call('/api/ai/credentials',{method:'PUT',cookie:a.cookie,body:{provider:'openai',key}});
 f.ai.respond=async()=>Response.json({error:{message:key}},{status:429});
 const body={provider:'openai',model:'gpt-test',prompt:'Genera JSON'};
 const result=await f.call('/api/ai/generate',{method:'POST',cookie:a.cookie,body});assert.equal(result.status,429);assert.ok(!(await result.text()).includes(key));assert.equal(f.ai.calls.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_leases').get().n,0);
 assert.equal(JSON.parse(f.ai.calls[0].options.body).store,false);
 f.sqlite.prepare('UPDATE ai_usage SET calls=100 WHERE teacher_id=?').run(a.data.user.id);
 assert.equal((await f.call('/api/ai/generate',{method:'POST',cookie:a.cookie,body})).status,429);assert.equal(f.ai.calls.length,1);
});

async function schoolPortal(f,user,fingerprint='a') {
 const metadata={year:'2026',areaId:'ept',grade:'1ro',unitNumber:'1',sessionNumber:'1'};
 const rows=[{dataset:'general',id:'general',value:{teacher:user.data.user.username}},...['A','B'].map(section=>({dataset:'students',id:section,value:{id:section,name:'Alumno '+section,grade:'1ro',section,estado:'A',dni:section==='A'?'00123456':'87654321'}})),...['A','B'].map(section=>({dataset:'sessions',id:`2026-ept-1ro-${section}-U1-S1`,value:{...metadata,section,title:'Sesión '+section,purpose:'Propósito',situation:'Situación',secuencia:{proceso:{aplicacion:'Actividad'}},evaluationRecords:'private-evaluations'}}))];
 const start=await f.call('/api/academic/imports',{method:'POST',cookie:user.cookie,body:{ownerUsername:user.data.user.username,fingerprint:fingerprint.repeat(64),counts:{general:1,students:2,annual:0,units:0,sessions:2,frontend:0}}});const id=(await start.json()).data.importId;
 await f.call(`/api/academic/imports/${id}/chunks`,{method:'POST',cookie:user.cookie,body:{sequence:0,records:rows}});await f.call(`/api/academic/imports/${id}/commit`,{method:'POST',cookie:user.cookie,body:{}});
 const put=body=>f.call('/api/portal',{method:'PUT',cookie:user.cookie,body});
 assert.equal((await put({open:true,revision:0})).status,200);
 const get=async()=>(await(await f.call('/api/portal',{cookie:user.cookie})).json()).data;
 const state=await get();
 return {id,state,get,put,slug:new URL(state.url).pathname.split('/')[2],issue:async studentId=>(await(await f.call('/api/portal/access',{method:'POST',cookie:user.cookie,body:{studentId}})).json()).data.code,publish:sessionId=>f.call('/api/portal/publications',{method:'PUT',cookie:user.cookie,body:{sessionId,published:true}})};
}
async function studentLogin(f,portal,code) {
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),x=>x.toString(16).padStart(2,'0')).join('');
 const access=f.sqlite.prepare('SELECT teacher_id,student_id FROM student_access WHERE code_hash=?').get(hash);assert.ok(access);
 const student=f.sqlite.prepare("SELECT payload_json FROM academic_records WHERE teacher_id=? AND dataset='students' AND record_id=?").get(access.teacher_id,access.student_id);
 const dni=JSON.parse(student.payload_json).dni;
 const result=await f.call('/api/student/login',{method:'POST',body:{portal,dni,password:Boolean(f.sqlite.prepare('SELECT 1 FROM student_passwords WHERE teacher_id=? AND student_id=?').get(access.teacher_id,access.student_id))?'Personal123':dni}});
 assert.equal(result.status,200,await result.clone().text());const cookie=result.headers.get('set-cookie').split(';')[0];
 if((await result.json()).data.requiresPasswordChange){const changed=await f.call('/api/student/change-password?portal='+portal,{method:'POST',cookie,body:{password:'Personal123',confirmation:'Personal123'}});assert.equal(changed.status,200,await changed.clone().text());}
 return cookie;
}


test('student portal: personal codes, grade isolation, teacher separation, no roster/private data and text submissions',async t=>{
 const f=fixture(t),a=await f.login(),b=await f.login('docenteB');
 assert.equal((await(await f.call('/api/portal',{cookie:a.cookie})).json()).data.open,false);
 const portal=await schoolPortal(f,a),other=await schoolPortal(f,b,'b'),sidA='2026-ept-1ro-A-U1-S1',sidB='2026-ept-1ro-B-U1-S1';
 await portal.publish(sidA);await portal.publish(sidB);
 const code=await portal.issue('A'),student=await studentLogin(f,portal.slug,code);
 assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT * FROM student_access').all()).includes(code));
 assert.match(student,/__Host-armi_student=/);
 const data=await f.call('/api/student/data?portal='+portal.slug,{cookie:student});assert.equal(data.status,200);const text=await data.text();assert.ok(!/private-dni|private-evaluations|Alumno B/.test(text));assert.equal(JSON.parse(text).data.lessons.length,1);assert.equal(JSON.parse(text).data.lessons[0].id,sidA);
 assert.equal((await f.call('/api/student/data?portal='+other.slug,{cookie:student})).status,401);
 assert.equal((await f.call('/api/portal',{cookie:student})).status,401);
 assert.equal((await f.call('/api/student/data?portal='+portal.slug,{cookie:a.cookie})).status,401);
 assert.equal((await f.call('/api/student/login',{method:'POST',body:{portal:other.slug,code}})).status,400);
 const send=sessionId=>f.call('/api/student/submit?portal='+portal.slug,{method:'POST',cookie:student,body:{sessionId,text:'Mi respuesta'}});
 assert.equal((await send(sidB)).status,403);assert.equal((await send(sidA)).status,200);
 const inbox=(await(await f.call('/api/portal/inbox',{cookie:a.cookie})).json()).data;assert.equal(inbox.submissions.length,1);
 assert.equal((await(await f.call('/api/portal/inbox',{cookie:b.cookie})).json()).data.submissions.length,0);
 const studentB=await studentLogin(f,portal.slug,await portal.issue('B'));
 assert.equal((await(await f.call('/api/student/data?portal='+portal.slug,{cookie:studentB})).json()).data.lessons[0].id,sidB);
});
test('closing and reopening a portal, rotating a code, and revoking access invalidate existing student sessions',async t=>{
 const f=fixture(t),a=await f.login(),portal=await schoolPortal(f,a),code=await portal.issue('A');
 const student=await studentLogin(f,portal.slug,code),read=cookie=>f.call('/api/student/data?portal='+portal.slug,{cookie});
 assert.equal((await portal.put({open:false,revision:1})).status,200);assert.equal((await read(student)).status,401);
 assert.equal((await portal.put({open:true,revision:1})).status,409);
 assert.equal((await portal.put({open:true,revision:2})).status,200);assert.equal((await read(student)).status,401);
 const second=await studentLogin(f,portal.slug,code);assert.equal((await read(second)).status,200);
 const rotated=await portal.issue('A');assert.equal((await read(second)).status,401);assert.equal((await f.call('/api/student/login',{method:'POST',body:{portal:portal.slug,code}})).status,400);
 const third=await studentLogin(f,portal.slug,rotated);assert.equal((await read(third)).status,200);
 await f.call('/api/portal/access',{method:'DELETE',cookie:a.cookie,body:{studentId:'A'}});assert.equal((await read(third)).status,401);
 assert.equal((await f.call('/api/academic/imports',{method:'POST',cookie:a.cookie,body:{}})).status,409,'A replacement copy cannot reassign issued access codes');
});

test('one AI generation at a time per teacher; another teacher can generate independently',async t=>{
 const f=fixture(t),a=await f.login(),b=await f.login('docenteB');
 for(const user of [a,b])await f.call('/api/ai/credentials',{method:'PUT',cookie:user.cookie,body:{provider:'gemini',key:'test-fixture-own-key-not-real'}});
 let release,entered;const started=new Promise(resolve=>{entered=resolve;});
 const held=new Promise(resolve=>{release=resolve;});let first=true;
 f.ai.respond=async()=>{if(first){first=false;entered();await held;}return Response.json({candidates:[{content:{parts:[{text:'{}'}]}}]});};
 const body={provider:'gemini',model:'gemini-test',prompt:'Generate JSON'};
 const pending=f.call('/api/ai/generate',{method:'POST',cookie:a.cookie,body});
 try {
  await started;
  assert.equal((await f.call('/api/ai/generate',{method:'POST',cookie:a.cookie,body})).status,429);
  assert.equal((await f.call('/api/ai/generate',{method:'POST',cookie:b.cookie,body})).status,200);
 }finally{release();}
 assert.equal((await pending).status,200);assert.equal(f.ai.calls.length,2);
});

test('student publication pagination includes fused sections and membership expiry invalidates existing access',async t=>{
 const f=fixture(t),a=await f.login(),portal=await schoolPortal(f,a);
 const base=JSON.parse(f.sqlite.prepare("SELECT payload_json FROM academic_records WHERE dataset='sessions' AND record_id='2026-ept-1ro-A-U1-S1'").get().payload_json);
 for(let n=1;n<=23;n++){
  const id=`2026-ept-1ro-A y B-U1-S${n}`;
  f.sqlite.prepare("INSERT INTO planning_edits(teacher_id,dataset,record_id,payload_json,revision,deleted,updated_at,operation_id,operation_hash) VALUES(?,'sessions',?,?,1,0,0,'fixture','fixture')").run(a.data.user.id,id,JSON.stringify({...base,section:'A y B',sessionNumber:String(n),title:'Published '+n}));
  await portal.publish(id);
 }
 const student=await studentLogin(f,portal.slug,await portal.issue('A'));
 const read=async cursor=>(await(await f.call('/api/student/data?portal='+portal.slug+(cursor?'&cursor='+encodeURIComponent(cursor):''),{cookie:student})).json()).data;
 const first=await read();assert.equal(first.lessons.length,20);assert.ok(first.nextCursor);
 const second=await read(first.nextCursor);assert.equal(second.lessons.length,3);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.lessons,...second.lessons].map(row=>row.id)).size,23);
 f.sqlite.prepare('UPDATE student_portals SET membership_until=? WHERE teacher_id=?').run(Date.parse('2026-11-21T16:59:59Z'),a.data.user.id);
 assert.equal((await f.call('/api/student/data?portal='+portal.slug,{cookie:student})).status,401);
});

const sampleInstrument=(type='rubrica')=>({year:'2026',areaId:'8',grade:'1ro',section:'A',type,name:'Mi instrumento',structure:{criteria:[{text:'Comunica su propuesta',levels:{a:'Explica con claridad'}}],layout:{rows:1,cols:1,texts:{'0-0':'Criterio propio'},styles:{'0-0':{bg:'#ffffff',bold:true}},merges:[]}},version:1});
test('instruments: all four types persist custom layout, scope filters and teacher isolation',async t=>{
 const f=fixture(t),a=await f.login(),b=await f.login('docenteB');
 const save=(user,body)=>f.call('/api/instruments',{method:'PUT',cookie:user.cookie,body});
 const ids=[];
 for(const type of ['rubrica','lista_cotejo','escala_valoracion','guia_observacion']) {
  const body={id:'web-'+crypto.randomUUID(),value:sampleInstrument(type),expectedRevision:0,operationId:crypto.randomUUID()};ids.push(body.id);
  const response=await save(a,body);assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual((await response.json()).data.record.structure,body.value.structure);
  assert.equal((await save(a,body)).status,200,'Duplicate acknowledgement does not create another instrument');
 }
 const list=async(user,query='')=>(await(await f.call('/api/instruments'+query,{cookie:user.cookie})).json()).data;
 assert.equal((await list(a)).records.length,4);assert.equal((await list(b)).records.length,0);
 assert.equal((await list(a,'?year=2026&areaId=8&grade=1ro&section=A&type=lista_cotejo')).records.length,1);
 assert.equal((await list(a,'?grade=2do')).records.length,0);
 assert.equal((await save(b,{id:ids[0],value:sampleInstrument(),expectedRevision:1,operationId:crypto.randomUUID()})).status,409);
 assert.equal((await save(a,{id:'web-'+crypto.randomUUID(),value:sampleInstrument(),expectedRevision:0,operationId:crypto.randomUUID(),teacherId:b.data.user.id})).status,400);
 assert.equal((await f.call('/api/instruments',{cookie:a.cookie,origin:'https://foreign.test',method:'PUT',body:{}})).status,403);
});

test('instrument revision prevents stale overwrites and deletion resurrection; rejected data never saves',async t=>{
 const f=fixture(t),a=await f.login(),id='web-'+crypto.randomUUID(),value=sampleInstrument();
 const put=(revision,patch={})=>f.call('/api/instruments',{method:'PUT',cookie:a.cookie,body:{id,value:{...value,...patch},expectedRevision:revision,operationId:crypto.randomUUID()}});
 assert.equal((await put(0)).status,200);
 assert.equal((await put(1,{name:'Editado'})).status,200);
 assert.equal((await put(1,{name:'Viejo'})).status,409);
 const del=revision=>f.call('/api/instruments',{method:'DELETE',cookie:a.cookie,body:{id,expectedRevision:revision,operationId:crypto.randomUUID()}});
 assert.equal((await del(1)).status,409);assert.equal((await del(2)).status,200);
 assert.equal((await put(3)).status,409);
 assert.equal((await(await f.call('/api/instruments',{cookie:a.cookie})).json()).data.records.length,0);
 assert.equal(f.sqlite.prepare('SELECT deleted,revision FROM web_instruments WHERE teacher_id=? AND id=?').get(a.data.user.id,id).revision,3);
 for(const patch of [{type:'unknown'},{name:''},{year:'2026-invalid'},{structure:{api_key:'private'}},{structure:{image:'data:image/png;base64,bad'}},{structure:{path:'C:\\Private\\file'}}]) {
  const response=await f.call('/api/instruments',{method:'PUT',cookie:a.cookie,body:{id:'web-'+crypto.randomUUID(),value:{...value,...patch},expectedRevision:0,operationId:crypto.randomUUID()}});
  assert.equal(response.status,400,await response.clone().text());
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM web_instruments').get().n,1);
});

test('instrument lists page at 50 and missing migration keeps academic modules readable',async t=>{
 const f=fixture(t),a=await f.login(),value=sampleInstrument();
 const insert=f.sqlite.prepare('INSERT INTO web_instruments(teacher_id,id,year,area_id,grade,section,payload_json,revision,operation_id,operation_hash,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,0)');
 const ids=Array.from({length:53},()=> 'web-'+crypto.randomUUID()).sort();
 for(const id of ids)insert.run(a.data.user.id,id,value.year,value.areaId,value.grade,value.section,JSON.stringify(value),crypto.randomUUID(),'fixture');
 const first=(await(await f.call('/api/instruments?year=2026',{cookie:a.cookie})).json()).data;
 assert.equal(first.records.length,50);assert.equal(first.nextCursor,ids[49]);
 const last=(await(await f.call('/api/instruments?cursor='+first.nextCursor,{cookie:a.cookie})).json()).data;
 assert.deepEqual(last.records.map(row=>row.id),ids.slice(50));assert.equal(last.nextCursor,null);
 f.sqlite.exec('DROP TABLE web_instruments');
 assert.equal((await f.call('/api/instruments',{cookie:a.cookie})).status,503);
 const status=(await(await f.call('/api/academic/status',{cookie:a.cookie})).json()).data;
 assert.equal(status.instrumentsEditable,false);assert.equal(status.editable,true);assert.equal(status.planningEditable,true);
});

const gradeRow=(student='A',level='Logrado')=>({student_id:student,session_id:'2026-ept-1ro-A-U1-S1',unit_id:'2026-ept-1ro-A-U1',instrument_id:null,criteria_id:'1',level,observation:'Avanza en el criterio'});
const conclusionContext={year:'2026',areaId:'ept',grade:'1ro',section:'A',scopeType:'unit',scopeValue:'1'};
const conclusionRow=(student='A',conclusionText='Explica su propuesta con claridad.')=>({studentId:student,competencyKey:'primary::gestiona proyectos',competencyName:'Gestiona proyectos',competencySource:'primary',conclusionText});
async function gradeRead(f,user,id=gradeRow().session_id) {
 const response=await f.call('/api/evaluation/grades?sessionId='+encodeURIComponent(id),{cookie:user.cookie});assert.equal(response.status,200,await response.clone().text());return (await response.json()).data;
}
test('web grades persist owned student cells, isolate teachers and reject stale batches atomically',async t=>{
 const f=fixture(t),a=await f.login(),b=await f.login('docenteB');await schoolPortal(f,a);await schoolPortal(f,b,'b');
 const read=await gradeRead(f,a),body={sessionId:gradeRow().session_id,sourceVersion:read.sourceVersion,expectedRevision:0,operationId:crypto.randomUUID(),changes:[gradeRow()]};
 const put=(user,payload)=>f.call('/api/evaluation/grades',{cookie:user.cookie,method:'PUT',body:payload});
 assert.equal((await put(a,body)).status,200);assert.equal((await put(a,body)).status,200);
 assert.equal((await gradeRead(f,a)).records[0].level,'Logrado');assert.equal((await gradeRead(f,b)).records.length,0);
 assert.equal((await put(b,{...body,expectedRevision:1})).status,409);
 assert.equal((await put(a,{...body,expectedRevision:1,operationId:crypto.randomUUID(),changes:[gradeRow('A','Destacado')]})).status,200);
 assert.equal((await put(a,{...body,operationId:crypto.randomUUID(),changes:[gradeRow('A','Inicio')]})).status,409);
 const wrongGroup={...body,expectedRevision:2,operationId:crypto.randomUUID(),changes:[gradeRow('A','Inicio'),gradeRow('B','Proceso')]};
 assert.equal((await put(a,wrongGroup)).status,403);assert.equal((await gradeRead(f,a)).records[0].level,'Destacado');
 const all=(await(await f.call('/api/evaluation/grades',{cookie:a.cookie})).json()).data;assert.equal(all.records.length,1);
 assert.equal((await put(a,{...body,teacherId:b.data.user.id})).status,400);
});

test('grades reject changed planning, invalid levels and students moved during the final write',async t=>{
 const f=fixture(t),a=await f.login();await schoolPortal(f,a);const read=await gradeRead(f,a);
 const body={sessionId:gradeRow().session_id,sourceVersion:read.sourceVersion,expectedRevision:0,operationId:crypto.randomUUID(),changes:[gradeRow()]};
 const put=value=>f.call('/api/evaluation/grades',{cookie:a.cookie,method:'PUT',body:value});
 for(const changes of [[gradeRow('A','21')],[gradeRow(),gradeRow()],[{...gradeRow(),session_id:'other'}],[{...gradeRow(),unit_id:'other'}],[{...gradeRow(),instrument_id:{secret:'private'}}]])assert.equal((await put({...body,changes})).status,400);
 f.sqlite.prepare("INSERT INTO planning_edits(teacher_id,dataset,record_id,payload_json,revision,operation_id,operation_hash,updated_at) VALUES(?,'units','2026-ept-1ro-A-U1','{}',1,'fixture','fixture',0)").run(a.data.user.id);
 assert.equal((await put(body)).status,409,'Unit changes invalidate a grading view loaded with old criteria');
 const fresh=await gradeRead(f,a);body.sourceVersion=fresh.sourceVersion;
 const batch=f.env.DB.batch.bind(f.env.DB);
 f.env.DB.batch=async statements=>{f.sqlite.prepare("UPDATE academic_records SET payload_json=json_set(payload_json,'$.grade','2do') WHERE teacher_id=? AND dataset='students' AND record_id='A'").run(a.data.user.id);return batch(statements);};
 assert.equal((await put(body)).status,409,'The INSERT checks the roster again after validation');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM web_evaluation').get().n,0);
});

test('conclusions keep unit and bimester scopes separate, retain explicit clearing and protect revisions',async t=>{
 const f=fixture(t),a=await f.login(),b=await f.login('docenteB');await schoolPortal(f,a);await schoolPortal(f,b,'b');
 const read=async(user,context=conclusionContext)=>(await(await f.call('/api/evaluation/conclusions?'+new URLSearchParams(context),{cookie:user.cookie})).json()).data;
 const body={context:conclusionContext,expectedRevision:0,operationId:crypto.randomUUID(),changes:[conclusionRow()]};
 const put=value=>f.call('/api/evaluation/conclusions',{cookie:a.cookie,method:'PUT',body:value});
 assert.equal((await put(body)).status,200);assert.equal((await read(a)).records[0].conclusionText,conclusionRow().conclusionText);
 assert.equal((await read(b)).records.length,0);
 const bimester={...conclusionContext,scopeType:'bimester',scopeValue:'I'};
 assert.equal((await read(a,bimester)).records.length,0);
 assert.equal((await put({...body,context:bimester,operationId:crypto.randomUUID()})).status,200);
 assert.equal((await put({...body,expectedRevision:1,operationId:crypto.randomUUID(),changes:[conclusionRow('A','')]})).status,200);
 assert.equal((await read(a)).records[0].conclusionText,'');assert.equal((await read(a,bimester)).records[0].conclusionText,conclusionRow().conclusionText);
 assert.equal((await put({...body,operationId:crypto.randomUUID()})).status,409);
 assert.equal((await put({...body,expectedRevision:2,operationId:crypto.randomUUID(),changes:[conclusionRow('B')]})).status,403);
 assert.equal((await put({...body,expectedRevision:2,operationId:crypto.randomUUID(),changes:[conclusionRow('A','x'.repeat(251))]})).status,400);
});

test('grade lists are paginated and missing evaluation migration does not disable the previous modules',async t=>{
 const f=fixture(t),a=await f.login();await schoolPortal(f,a);
 const insert=f.sqlite.prepare("INSERT INTO web_evaluation(teacher_id,kind,scope_id,scope_json,payload_json,revision,operation_id,operation_hash,updated_at) VALUES(?,'grades',?,'{}',?,1,'fixture','fixture',0)");
 for(let i=0;i<7;i++)insert.run(a.data.user.id,'session-'+i,JSON.stringify([{...gradeRow(),session_id:'session-'+i}]));
 const first=(await(await f.call('/api/evaluation/grades',{cookie:a.cookie})).json()).data;assert.equal(first.records.length,5);assert.ok(first.nextCursor);
 const last=(await(await f.call('/api/evaluation/grades?cursor='+first.nextCursor,{cookie:a.cookie})).json()).data;assert.equal(last.records.length,2);assert.equal(last.nextCursor,null);
 f.sqlite.prepare('UPDATE academic_heads SET revision=revision+1 WHERE teacher_id=?').run(a.data.user.id);
 assert.equal((await f.call('/api/evaluation/grades?cursor='+first.nextCursor+'&revision='+first.revision,{cookie:a.cookie})).status,409);
 f.sqlite.exec('DROP TABLE web_evaluation');
 assert.equal((await f.call('/api/evaluation/grades',{cookie:a.cookie})).status,503);
 const status=(await(await f.call('/api/academic/status',{cookie:a.cookie})).json()).data;
 assert.equal(status.evaluationEditable,false);assert.equal(status.editable,true);assert.equal(status.instrumentsEditable,true);
});


test('Sheets registry aliases remain stable and cannot be claimed by another account',async t=>{
 const f=fixture(t);f.users.docenteA.portalIdentity={teacherRegistryNumber:45};
 const a=await f.login(),portal=await schoolPortal(f,a);
 assert.equal(portal.slug,'d45-profe-docentea');assert.equal(portal.state.registryNumber,45);
 const old=f.sqlite.prepare('SELECT public_id FROM student_portals WHERE teacher_id=?').get(a.data.user.id).public_id;
 const redirect=await f.call('/estudiantes/'+old);assert.equal(redirect.status,302);assert.equal(new URL(redirect.headers.get('location'),'https://app.armi.test').pathname,'/estudiantes/'+portal.slug);
 f.users.docenteA.portalIdentity.teacherRegistryNumber=99;await f.login();assert.equal((await portal.get()).url,portal.state.url);
 f.users.docenteB.portalIdentity={teacherRegistryNumber:45};f.users.docenteB.displayName=f.users.docenteA.displayName;
 const b=await f.login('docenteB'),other=await schoolPortal(f,b,'b');
 assert.match(other.slug,/^[a-f0-9]{32}$/);assert.ok(other.state.registryMessage);assert.equal((await portal.get()).url,portal.state.url);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM teacher_portal_registry').get().n,1);
});

test('missing alias setup preserves existing login and portals; untrusted browser numbers are ignored',async t=>{
 const f=fixture(t);const result=await f.call('/api/auth/login',{method:'POST',body:{username:'docenteA',password:'correct',teacherRegistryNumber:45}});assert.equal(result.status,200);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM teacher_portal_registry').get().n,0);
 f.sqlite.exec('DROP TABLE teacher_portal_registry');f.users.docenteA.portalIdentity={teacherRegistryNumber:45};
 const a=await f.login(),portal=await schoolPortal(f,a);assert.match(portal.slug,/^[a-f0-9]{32}$/);assert.match(portal.state.registryMessage,/0010/);
});

function setPortalDni(f,teacher,id,dni){f.sqlite.prepare("UPDATE academic_records SET payload_json=json_set(payload_json,'$.dni',?) WHERE teacher_id=? AND dataset='students' AND record_id=?").run(dni,teacher,id);}
const dniLogin=(f,portal,dni)=>f.call('/api/student/login',{method:'POST',body:{portal,dni,password:dni}});

test('DNI entry needs no teacher-issued code, preserves leading zero and isolates same-DNI students by teacher',async t=>{
 const f=fixture(t);f.users.docenteA.portalIdentity={teacherRegistryNumber:45};f.users.docenteB.portalIdentity={teacherRegistryNumber:46};
 const a=await f.login(),b=await f.login('docenteB'),portal=await schoolPortal(f,a),other=await schoolPortal(f,b,'b');
 for(const teacher of [a,b])setPortalDni(f,teacher.data.user.id,'A','00123456');
 setPortalDni(f,a.data.user.id,'B','87654321');
 await portal.publish('2026-ept-1ro-A-U1-S1');await portal.publish('2026-ept-1ro-B-U1-S1');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM student_access').get().n,0);
 const response=await dniLogin(f,portal.slug,'00123456');assert.equal(response.status,200,await response.clone().text());const cookie=response.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.call('/api/student/change-password?portal='+portal.slug,{method:'POST',cookie,body:{password:'Personal123',confirmation:'Personal123'}})).status,200);
 const data=await f.call('/api/student/data?portal='+portal.slug,{cookie});assert.equal(data.status,200);const text=await data.text();assert.ok(!/00123456|Alumno B|private-evaluations/.test(text));assert.equal(JSON.parse(text).data.lessons.length,1);
 assert.equal((await f.call('/api/student/data?portal='+other.slug,{cookie})).status,401);
 const legacy=f.sqlite.prepare('SELECT public_id FROM student_portals WHERE teacher_id=?').get(a.data.user.id).public_id;
 assert.equal((await f.call('/api/student/data?portal='+legacy,{cookie})).status,200,'Legacy and friendly links identify the same owner');
 assert.equal((await dniLogin(f,other.slug,'00123456')).status,200,'Same DNI with another teacher has an independent session');
 assert.equal((await dniLogin(f,portal.slug,'1234567')).status,400);assert.equal((await dniLogin(f,portal.slug,'99999999')).status,401);
 assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT bucket FROM web_service_limits').all()).includes('00123456'),'Rate limiting never stores a raw DNI');
});

test('DNI blocks apply before first login, reenable invalidates old sessions, close/reopen requires a new login',async t=>{
 const f=fixture(t),a=await f.login(),portal=await schoolPortal(f,a);setPortalDni(f,a.data.user.id,'A','00123456');
 const manage=(method)=>f.call('/api/portal/access',{method,cookie:a.cookie,body:{studentId:'A',...(method==='POST'?{enabled:true}:{})}});
 assert.equal((await manage('DELETE')).status,200);assert.equal((await dniLogin(f,portal.slug,'00123456')).status,401);
 const enabled=await manage('POST');assert.deepEqual((await enabled.json()).data,{enabled:true});
 const response=await dniLogin(f,portal.slug,'00123456');assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
 await manage('DELETE');assert.equal((await f.call('/api/student/data?portal='+portal.slug,{cookie})).status,401);
 await manage('POST');assert.equal((await f.call('/api/student/data?portal='+portal.slug,{cookie})).status,401);
 await portal.put({open:false,revision:1});assert.equal((await dniLogin(f,portal.slug,'00123456')).status,401);await portal.put({open:true,revision:2});assert.equal((await dniLogin(f,portal.slug,'00123456')).status,200);
});

test('duplicate, changed, inactive and deleted DNI records cannot select an arbitrary or stale student',async t=>{
 const f=fixture(t),a=await f.login(),portal=await schoolPortal(f,a);setPortalDni(f,a.data.user.id,'A','00123456');setPortalDni(f,a.data.user.id,'B','00123456');
 assert.equal((await dniLogin(f,portal.slug,'00123456')).status,401);
 const edit={id:'B',name:'Alumno B',dni:'87654321',grade:'1ro',section:'B',estado:'A'};
 f.sqlite.prepare("INSERT INTO academic_edits(teacher_id,dataset,record_id,payload_json,deleted,revision,operation_id,operation_hash,updated_at) VALUES(?,'students','B',?,0,1,'fixture','fixture',0)").run(a.data.user.id,JSON.stringify(edit));
 assert.equal((await dniLogin(f,portal.slug,'00123456')).status,200,'An edited DNI replaces its imported value');assert.equal((await dniLogin(f,portal.slug,'87654321')).status,200);
 f.sqlite.prepare("UPDATE academic_edits SET deleted=1 WHERE teacher_id=? AND record_id='B'").run(a.data.user.id);assert.equal((await dniLogin(f,portal.slug,'87654321')).status,401);
 f.sqlite.prepare("UPDATE academic_records SET payload_json=json_set(payload_json,'$.estado','R') WHERE teacher_id=? AND dataset='students' AND record_id='A'").run(a.data.user.id);assert.equal((await dniLogin(f,portal.slug,'00123456')).status,401);
});


test('passwords: first DNI password grants only setup access; personal password is hashed and enforced',async t=>{
 const f=fixture(t),a=await f.login(),portal=await schoolPortal(f,a);
 const attempt=password=>f.call('/api/student/login',{method:'POST',body:{portal:portal.slug,dni:'00123456',...(password===undefined?{}:{password})}});
 assert.equal((await attempt()).status,400);assert.equal((await attempt('wrong')).status,401);
 const first=await attempt('00123456');assert.equal(first.status,200);assert.equal((await first.clone().json()).data.requiresPasswordChange,true);const cookie=first.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.call('/api/student/data?portal='+portal.slug,{cookie})).status,403);
 assert.equal((await f.call('/api/student/submit?portal='+portal.slug,{method:'POST',cookie,body:{sessionId:'2026-ept-1ro-A-U1-S1',text:'bypass'}})).status,403);
 const second=await attempt('00123456'),stale=second.headers.get('set-cookie').split(';')[0];
 const change=(password,confirmation=password)=>f.call('/api/student/change-password?portal='+portal.slug,{method:'POST',cookie,body:{password,confirmation}});
 for(const pair of [['00123456','00123456'],['short1','short1'],['Personal123','different']])assert.equal((await change(...pair)).status,400);
 assert.equal((await change('Personal123')).status,200);const stored=f.sqlite.prepare('SELECT * FROM student_passwords').get();assert.match(stored.password_hash,/^pbkdf2-sha256\$100000\$/);assert.ok(!stored.password_hash.includes('Personal123'));
 assert.equal((await f.call('/api/student/data?portal='+portal.slug,{cookie})).status,200);
 assert.equal((await f.call('/api/student/data?portal='+portal.slug,{cookie:stale})).status,401);
 assert.equal((await attempt('00123456')).status,401);const again=await attempt('Personal123');assert.equal(again.status,200);assert.equal((await again.json()).data.requiresPasswordChange,false);
 assert.equal((await change('Changed456')).status,200);assert.equal((await attempt('Personal123')).status,401);
 assert.equal((await attempt('Changed456')).status,200);
});

test('password changes recheck the portal gate at final save; missing schema disables all student entry',async t=>{
 const f=fixture(t),a=await f.login(),portal=await schoolPortal(f,a);
 const first=await dniLogin(f,portal.slug,'00123456'),cookie=first.headers.get('set-cookie').split(';')[0];
 const prepare=f.env.DB.prepare;f.env.DB.prepare=(sql,...args)=>{if(sql.startsWith('INSERT INTO student_passwords('))f.sqlite.exec('UPDATE student_portals SET is_open=0');return prepare(sql,...args);};
 assert.equal((await f.call('/api/student/change-password?portal='+portal.slug,{method:'POST',cookie,body:{password:'Personal123',confirmation:'Personal123'}})).status,409);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM student_passwords').get().n,0);
 f.env.DB.prepare=prepare;f.sqlite.exec('DROP TABLE student_password_sessions');
 assert.equal((await dniLogin(f,portal.slug,'00123456')).status,503);
 assert.equal((await (await f.call('/api/portal',{cookie:a.cookie})).json()).data.passwordReady,false);
});


test('Drive routes require the teacher session and same-origin writes; Google remains the source of login and mirror identity',async t=>{
 const f=fixture(t);assert.equal((await f.call('/api/drive/profile')).status,401);
 f.users.docenteA.syncUserKey='original-mirror-identity';f.users.docenteA.driveFolderUrl='https://drive.google.com/drive/folders/fixtureFolder12345';
 const a=await f.login();assert.equal(a.data.membership.syncUserKey,'original-mirror-identity');
 const profile=await f.call('/api/drive/profile',{cookie:a.cookie});assert.equal(profile.status,200);const data=(await profile.json()).data;
 assert.equal(data.suggestedFolder,'https://drive.google.com/drive/folders/fixtureFolder12345');assert.equal(data.configured,false);assert.equal(data.connected,false);
 assert.equal((await f.call('/api/drive/connect',{method:'POST',cookie:a.cookie,origin:'https://other.test',body:{}})).status,403);
 assert.equal(f.calls.length,1,'Opening the Drive panel does not query Apps Script again');
 const normal=await f.call('/');assert.ok(!normal.headers.get('content-security-policy').includes('apis.google.com'));
 const picker=await f.call('/api/drive/picker');assert.equal(picker.status,401);
 assert.ok(picker.headers.get('content-security-policy').includes('https://docs.google.com'));
});
