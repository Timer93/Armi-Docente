import { AuthError, authenticateWithAppsScript, configuredAuthUrl } from './apps-script-auth.js';
import { canViewUsage, createMeasurement, createUsageReader, measureDatabase, recordUsage } from './usage.js';
import { academicRoute,validateRecord } from './academic.js';
import {instrumentsRoute} from './instruments.js';
import {aiRoute} from './ai.js';
import {portalReady,teacherPortal,studentPortal} from './portal.js';
import {servicesReady} from './ai.js';

const SESSION_MS = 30 * 60_000;
const MAX_BODY_BYTES = 4096;
const securityHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const fail = (message, status = 400) => { throw new AuthError(message, status); };
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');

function cookiePolicy(request, env) {
  const url = new URL(request.url);
  const local = env.ARMI_ENV === 'local' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  return { name: local ? 'armi_web_local' : '__Host-armi_web', secure: local ? '' : '; Secure' };
}
function cookieHeader(request, env, value, seconds) {
  const policy = cookiePolicy(request, env);
  return `${policy.name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${policy.secure}`;
}
function sessionToken(request, env) {
  const name = cookiePolicy(request, env).name;
  return (request.headers.get('cookie') || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) fail('Envía una solicitud JSON.', 415);
  if (Number(request.headers.get('content-length') || 0) > maxBytes) fail('Solicitud demasiado grande.', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('Faltan los datos de la solicitud.');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); fail('Solicitud demasiado grande.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch { fail('La solicitud no contiene JSON válido.'); }
}
async function currentSession(request, env, now, measurement) {
  const token = sessionToken(request, env);
  if (!/^[a-f0-9]{64}$/.test(token)) fail('Inicia sesión para continuar.', 401);
  const row = await env.DB.prepare(`SELECT s.token_hash, s.expires_at, s.membership_json,
    t.id, t.provider_username, t.display_name, t.institution_name
    FROM web_sessions s JOIN teachers t ON t.id = s.teacher_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await digest(token), now).first();
  if (!row) fail('Tu sesión venció. Inicia sesión nuevamente.', 401);
  if (measurement) measurement.teacherId = row.id;
  return row;
}
function publicSession(row, env) {
  return {
    user: { id: row.id, username: row.provider_username, displayName: row.display_name, institutionName: row.institution_name },
    membership: JSON.parse(row.membership_json),
    sessionExpiresAt: new Date(row.expires_at).toISOString(),
    admin: { canViewUsage: canViewUsage(row.provider_username, env) },
  };
}
async function takeLoginSlot(request, env, now) {
  const minute = Math.floor(now / 60_000);
  const ipHash = await digest(`login:${request.headers.get('cf-connecting-ip') || 'local'}`);
  const row = await env.DB.prepare(`INSERT INTO auth_rate_limits(bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`)
    .bind(`${minute}:${ipHash}`, (minute + 2) * 60_000).first();
  if (row.attempts > 10) fail('Demasiados intentos. Espera un minuto para volver a intentar.', 429);
  const leaseId = randomToken();
  const lease = await env.DB.prepare(`INSERT INTO auth_leases(id, expires_at)
    SELECT ?, ? WHERE (SELECT COUNT(*) FROM auth_leases WHERE expires_at > ?) < 5`)
    .bind(leaseId, now + 20_000, now).run();
  if (!lease.meta.changes) fail('El servicio de acceso está ocupado. Intenta nuevamente en unos momentos.', 429);
  return leaseId;
}

export function createWorker({ requester = fetch, clock = Date.now } = {}) {
  const readUsage = createUsageReader({ requester });
  return {
    async fetch(request, env) {
      const startedAt = performance.now();
      const measurement = createMeasurement();
      const measuredEnv = { ...env, DB: measureDatabase(env.DB, measurement) };
      let response;
      try {
        response = await route(request, measuredEnv, requester, clock(), measurement, readUsage);
      } catch (error) {
        response = json({ success: false, message: error instanceof AuthError ? error.message : 'No se pudo completar la operación. Intenta nuevamente.' },
          error instanceof AuthError ? error.status : 503, error?.status === 429 ? { 'retry-after': '60' } : {});
      }
      recordUsage(env, request, response, measurement, performance.now() - startedAt);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    },
    async scheduled(_event, env) {
      const now = clock();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM web_sessions WHERE expires_at <= ?').bind(now),
        env.DB.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ?').bind(now),
        env.DB.prepare('DELETE FROM auth_leases WHERE expires_at <= ?').bind(now),
      ]);
      if(await servicesReady(env.DB))await env.DB.batch([
        env.DB.prepare('DELETE FROM web_service_limits WHERE expires_at<=?').bind(now),
        env.DB.prepare('DELETE FROM ai_leases WHERE expires_at<=?').bind(now),
        env.DB.prepare('DELETE FROM student_web_sessions WHERE expires_at<=?').bind(now),
      ]);
    },
  };
}

async function route(request, env, requester, now, measurement, readUsage) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
      fail('La solicitud debe realizarse desde ARMI Web.', 403);
    }
  }
  if (path === '/api/health' && request.method === 'GET') {
    const configured = Boolean(env.DB && configuredAuthUrl(env));
    return json({ success: true, service: 'armi-web', configured });
  }
  if (!path.startsWith('/api/')) {
    if(/^\/estudiantes\/[a-f0-9]{32}\/?$/.test(path)&&request.method==='GET')return env.ASSETS.fetch(new Request(new URL('/student.html',url),request));
    if (!['/', '/favicon.ico'].includes(path) || !['GET', 'HEAD'].includes(request.method)) {
      return json({ success: false, message: 'Página no disponible.' }, 404);
    }
    return env.ASSETS.fetch(request);
  }
  if (!env.DB) fail('La base web todavía no está configurada.', 503);
  if(path==='/api/instruments') {
    const teacher=await currentSession(request,env,now,measurement);
    return json({success:true,data:await instrumentsRoute(request,env,teacher,{readJson,digest,now,validateRecord})});
  }
  if(path.startsWith('/api/student/'))return studentPortal(request,env,{readJson,digest,randomToken,now,measurement});
  if(path==='/api/portal'||path.startsWith('/api/portal/')) {
    const teacher=await currentSession(request,env,now,measurement);
    return json({success:true,data:await teacherPortal(request,env,teacher,{readJson,digest,randomToken,now})});
  }
  if(path.startsWith('/api/ai/')) {
    const teacher=await currentSession(request,env,now,measurement);
    return json({success:true,data:await aiRoute(request,env,teacher,{readJson,digest,randomToken,now,requester})});
  }
  if (path.startsWith('/api/academic/')) {
    const teacher = await currentSession(request, env, now, measurement);
    return academicRoute(request, env, teacher, { readJson, digest, randomToken, now });
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    if (!configuredAuthUrl(env)) fail('El acceso web todavía no está configurado.', 503);
    const credentials = await readJson(request);
    if (typeof credentials.username !== 'string' || !credentials.username.trim() || credentials.username.length > 160
      || typeof credentials.password !== 'string' || !credentials.password || credentials.password.length > 512) {
      fail('Ingresa tu usuario y contraseña.', 400);
    }
    const leaseId = await takeLoginSlot(request, env, now);
    let identity;
    measurement.authCalls++;
    try { identity = await authenticateWithAppsScript(env, credentials, requester, now); }
    finally { await env.DB.prepare('DELETE FROM auth_leases WHERE id = ?').bind(leaseId).run(); }
    const teacherId = await digest(`apps-script:${identity.username}`);
    measurement.teacherId = teacherId;
    const token = randomToken();
    const tokenHash = await digest(token);
    const expiresAt = Math.min(now + SESSION_MS, identity.membership.expiresAt ?? Infinity);
    const statements = [
      env.DB.prepare(`INSERT INTO teachers(id, provider_username, display_name, institution_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .bind(teacherId, identity.username, identity.displayName, identity.institutionName, now, now),
      env.DB.prepare('INSERT INTO web_sessions(token_hash, teacher_id, membership_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(tokenHash, teacherId, JSON.stringify(identity.membership), now, expiresAt),
    ];
    if(await portalReady(env.DB))statements.push(env.DB.prepare('UPDATE student_portals SET membership_until=? WHERE teacher_id=? AND membership_until IS NOT ?').bind(identity.membership.expiresAt??null,teacherId,identity.membership.expiresAt??null));
    // Rotar una sesión previa de este navegador; otros dispositivos conservan su sesión.
    const previous = sessionToken(request, env);
    if (/^[a-f0-9]{64}$/.test(previous)) statements.push(env.DB.prepare('DELETE FROM web_sessions WHERE token_hash = ?').bind(await digest(previous)));
    await env.DB.batch(statements);
    const row = await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(teacherId).first();
    return json({ success: true, data: publicSession({ ...row, membership_json: JSON.stringify(identity.membership), expires_at: expiresAt }, env) }, 200,
      { 'set-cookie': cookieHeader(request, env, token, Math.max(1, Math.floor((expiresAt - now) / 1000))) });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = sessionToken(request, env);
    if (/^[a-f0-9]{64}$/.test(token)) {
      const row = await env.DB.prepare('DELETE FROM web_sessions WHERE token_hash = ? RETURNING teacher_id').bind(await digest(token)).first();
      if (row) measurement.teacherId = row.teacher_id;
    }
    return json({ success: true }, 200, { 'set-cookie': cookieHeader(request, env, '', 0) });
  }
  if (path === '/api/auth/session' && request.method === 'GET') {
    return json({ success: true, data: publicSession(await currentSession(request, env, now, measurement), env) });
  }
  if (path === '/api/admin/usage' && request.method === 'GET') {
    const session = await currentSession(request, env, now, measurement);
    if (!canViewUsage(session.provider_username, env)) fail('Acceso exclusivo del administrador.', 403);
    const report = await readUsage(env, now, url.searchParams.get('day'));
    const ids = report.accounts?.map(row => row.teacherId).filter(Boolean) || [];
    const users = ids.length ? (await env.DB.prepare(`SELECT id, provider_username FROM teachers WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results : [];
    const labels = new Map(users.map(user => [user.id, user.provider_username]));
    return json({ success: true, data: { ...report, accounts: report.accounts?.map(row => ({ ...row, username: row.teacherId ? labels.get(row.teacherId) || row.teacherId.slice(0, 12) : 'Sin sesión / no atribuido' })) } });
  }
  if (path === '/api/profile' && request.method === 'PUT') {
    const session = await currentSession(request, env, now, measurement);
    const body = await readJson(request);
    if (Object.keys(body).some(key => !['displayName', 'institutionName'].includes(key))
      || typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.length > 120
      || typeof body.institutionName !== 'string' || body.institutionName.length > 200) fail('Revisa el nombre y la institución.');
    await env.DB.prepare('UPDATE teachers SET display_name = ?, institution_name = ?, updated_at = ? WHERE id = ?')
      .bind(body.displayName.trim(), body.institutionName.trim(), now, session.id).run();
    return json({ success: true });
  }
  if (path === '/api/datos-generales/responsables' && ['GET', 'PUT'].includes(request.method)) {
    const session = await currentSession(request, env, now, measurement);
    const fields = ['teacher', 'director', 'subdirector', 'pedagogical_coordinator', 'toe_coordinator'];
    const empty = Object.fromEntries(fields.map(key => [key, '']));
    try {
      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT data_json, revision FROM teacher_responsables WHERE teacher_id = ?').bind(session.id).first();
        return json({ success: true, data: { values: row ? JSON.parse(row.data_json) : empty, revision: row?.revision || 0 } });
      }
      const body = await readJson(request);
      if (Object.keys(body).some(key => !['values', 'revision'].includes(key))
        || !Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER
        || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)
        || Object.keys(body.values).length !== fields.length
        || Object.keys(body.values).some(key => !fields.includes(key))
        || fields.some(key => typeof body.values[key] !== 'string' || body.values[key].length > 200)) {
        fail('Revisa los responsables: cada nombre admite hasta 200 caracteres.');
      }
      const values = Object.fromEntries(fields.map(key => [key, body.values[key].trim()]));
      const data = JSON.stringify(values);
      const row = body.revision === 0
        ? await env.DB.prepare(`INSERT INTO teacher_responsables(teacher_id, data_json, revision, updated_at)
            VALUES (?, ?, 1, ?) ON CONFLICT(teacher_id) DO NOTHING RETURNING revision`).bind(session.id, data, now).first()
        : await env.DB.prepare(`UPDATE teacher_responsables SET data_json = ?, revision = revision + 1, updated_at = ?
            WHERE teacher_id = ? AND revision = ? RETURNING revision`).bind(data, now, session.id, body.revision).first();
      if (!row) fail('Los datos cambiaron en otra pestaña. Recarga los responsables antes de guardar.', 409);
      return json({ success: true, data: { values, revision: row.revision } });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (String(error?.message).includes('no such table')) fail('Falta preparar las tablas de Responsables. El administrador debe aplicar la migración 0002.', 503);
      throw error;
    }
  }
  return json({ success: false, message: 'Operación no disponible.' }, 404);
}

export default createWorker();
