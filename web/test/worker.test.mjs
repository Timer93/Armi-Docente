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
    ASSETS: { fetch: async () => new Response('<html>ARMI</html>', { headers: { 'content-type': 'text/html' } }) },
  };
  const requester = async (url, options) => {
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
  return { sqlite, env, worker, call, login, calls, users, requester, analyticsQueries, analyticsResponse, advance: ms => { now += ms; } };
}

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
