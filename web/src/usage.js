import { AuthError } from './apps-script-auth.js';

// References for the Free tier, not an entitlement or an enforcement mechanism.
export const FREE_DAILY_REFERENCE = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000 };
export const canViewUsage = (username, env) => String(env.ARMI_ADMIN_USERNAMES || '')
  .split(',').map(value => value.trim()).filter(Boolean).includes(username);

export function createMeasurement() {
  return { teacherId: '', rowsRead: 0, rowsWritten: 0, statements: 0, authCalls: 0, incompleteMetadata: false };
}

export function measureDatabase(db, measurement) {
  if (!db) return db;
  const originals = new WeakMap();
  const record = result => {
    measurement.statements++;
    const meta = result?.meta;
    if (Number.isFinite(meta?.rows_read) && Number.isFinite(meta?.rows_written)) {
      measurement.rowsRead += meta.rows_read;
      measurement.rowsWritten += meta.rows_written;
    } else measurement.incompleteMetadata = true;
    return result;
  };
  const wrap = statement => {
    const measured = {
      bind(...values) { return wrap(statement.bind(...values)); },
      async run() { return record(await statement.run()); },
      async all() { return record(await statement.all()); },
      async first(column) {
        // D1's first() discards metadata. all() executes the same statement once
        // and preserves metadata; these queries return at most one row.
        const result = record(await statement.all());
        const row = result.results?.[0] ?? null;
        if (column === undefined || row === null) return row;
        if (!(column in row)) throw new Error('Unknown result column');
        return row[column];
      },
    };
    originals.set(measured, statement);
    return measured;
  };
  return {
    prepare(sql) { return wrap(db.prepare(sql)); },
    async batch(statements) {
      const results = await db.batch(statements.map(statement => originals.get(statement) || statement));
      results.forEach(record);
      return results;
    },
  };
}

export function recordUsage(env, request, response, measurement, elapsedMs) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return;
  const route = ['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/profile', '/api/datos-generales/responsables', '/api/admin/usage', '/api/health', '/api/academic/status', '/api/academic/records', '/api/academic/imports'].includes(path)
    ? path : path.startsWith('/api/academic/imports/') ? '/api/academic/import-batch' : '/api/other';
  try {
    env.USAGE_ANALYTICS?.writeDataPoint({
      indexes: [measurement.teacherId || 'anonymous'],
      blobs: [measurement.teacherId, route, request.method],
      doubles: [1, measurement.rowsRead, measurement.rowsWritten, measurement.statements,
        measurement.authCalls, response.status >= 400 ? 1 : 0, Math.max(0, elapsedMs), measurement.incompleteMetadata ? 1 : 0],
    });
  } catch { /* Telemetry availability must not break a saved profile or login. */ }
}

function normalizeTotals(row = {}) {
  return Object.fromEntries(['requests', 'rowsRead', 'rowsWritten', 'statements', 'authCalls', 'errors', 'incompleteMetadata']
    .map(key => [key, Math.max(0, Number(row[key]) || 0)]));
}
const metricsSql = `SUM(_sample_interval * double1) AS requests,
  SUM(_sample_interval * double2) AS rowsRead, SUM(_sample_interval * double3) AS rowsWritten,
  SUM(_sample_interval * double4) AS statements, SUM(_sample_interval * double5) AS authCalls,
  SUM(_sample_interval * double6) AS errors, SUM(_sample_interval * double8) AS incompleteMetadata`;

export function createUsageReader({ requester = fetch } = {}) {
  // A short best-effort cache is local to each isolate; there is no polling timer.
  const cache = new Map();
  return async (env, now, requestedDay) => {
    const day = requestedDay || new Date(now).toISOString().slice(0, 10);
    const start = Date.parse(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(start)
      || new Date(start).toISOString().slice(0, 10) !== day || start > now || now - start > 89 * 86400_000) {
      throw new AuthError('Elige una fecha válida de los últimos 89 días.', 400);
    }
    const accountId = String(env.ARMI_CF_ACCOUNT_ID || '');
    if (!/^[a-f0-9]{32}$/i.test(accountId) || !env.ARMI_ANALYTICS_READ_TOKEN || !env.USAGE_ANALYTICS) {
      return { available: false, day, message: 'El monitoreo está preparado. Falta conectar Analytics Engine y su permiso de lectura en Cloudflare.' };
    }
    const key = `${accountId}:${day}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < 60_000) return hit.value;
    const query = async sql => {
      let result;
      try {
        const response = await requester(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
          method: 'POST', headers: { authorization: `Bearer ${env.ARMI_ANALYTICS_READ_TOKEN}`, 'content-type': 'text/plain' },
          body: sql, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error();
        result = await response.json();
        if (!Array.isArray(result.data)) throw new Error();
      } catch { throw new AuthError('No fue posible consultar las mediciones. Revisa la conexión de Analytics Engine.', 503); }
      return result.data;
    };
    const where = `timestamp >= toDateTime(${Math.floor(start / 1000)}) AND timestamp < toDateTime(${Math.floor(start / 1000) + 86400})`;
    const [totalRows, accountRows] = await Promise.all([
      query(`SELECT ${metricsSql} FROM armi_web_usage WHERE ${where} FORMAT JSON`),
      query(`SELECT blob1 AS teacherId, ${metricsSql} FROM armi_web_usage WHERE ${where} GROUP BY blob1 ORDER BY requests DESC LIMIT 100 FORMAT JSON`),
    ]);
    const totals = normalizeTotals(totalRows[0]);
    const accounts = accountRows.filter(row => row.teacherId === '' || /^[a-f0-9]{64}$/.test(row.teacherId))
      .map(row => ({ teacherId: row.teacherId, ...normalizeTotals(row) }));
    const referenceUsage = Object.entries(FREE_DAILY_REFERENCE).map(([metric, limit]) => {
      const percentage = totals[metric] / limit * 100;
      return { metric, limit, percentage, level: percentage >= 95 ? 'critical' : percentage >= 85 ? 'high' : percentage >= 70 ? 'warning' : 'normal' };
    });
    const value = { available: true, estimated: true, source: 'analytics-engine', day,
      measuredAt: new Date(now).toISOString(), totals, accounts, referenceUsage, accountLimit: 100,
      note: 'Mediciones de las API de ARMI, sujetas a muestreo y demora. No incluyen otros Workers, accesos externos a D1, CPU ni facturación. Las consultas fallidas pueden no devolver metadatos. Verifica las cuotas globales en Cloudflare.' };
    if (cache.size > 100) cache.clear();
    cache.set(key, { at: now, value });
    return value;
  };
}
