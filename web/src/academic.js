import { AuthError } from './apps-script-auth.js';

export const DATASETS = ['general', 'students', 'annual', 'units', 'sessions', 'frontend'];
export const FRONTEND_KEYS = ['armi_areas', 'armi_assignments', 'armi_calendar_state', 'armi_holidays_v7', 'armi_schedule_config', 'armi_schedule_entries', 'armi_schedule_color_settings', 'armi_pa_pinned_didactic_units_global', 'armi_pa_pinned_matrix_global'];
const response = data => Response.json({ success: true, data });
const fail = (message, status = 400) => { throw new AuthError(message, status); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, permitted) => object(value) && Object.keys(value).every(key => permitted.includes(key));
const byteLength = value => new TextEncoder().encode(value).byteLength;
const privateKey = /password|contrase|api[_-]?key|private[_-]?key|recovery[_-]?cipher|token|secret|credential|descriptor|(?:^|_)face(?:$|_)/i;
function validateValue(value, depth = 0) {
  if (depth > 18) fail('La copia tiene estructuras demasiado profundas.');
  if (typeof value === 'string') {
    if (/data:(?:image|application|audio|video)\//i.test(value) || /(?:[A-Z]:\\|\\\\[^\\]+\\)/.test(value)) fail('La copia incluye archivos incrustados o rutas locales. Exporta nuevamente los datos.');
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (privateKey.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('La copia incluye campos privados no admitidos.');
      validateValue(child, depth + 1);
    }
  }
}
export function validateRecord(record) {
  if (!keys(record, ['dataset', 'id', 'value']) || !DATASETS.includes(record.dataset)
    || typeof record.id !== 'string' || !record.id || record.id.length > 250 || ['__proto__', 'constructor', 'prototype'].includes(record.id) || /[\x00-\x1f]/.test(record.id)
    || (!object(record.value) && record.dataset !== 'frontend')) fail('Registro de importación no válido.');
  if (record.dataset === 'frontend' && !FRONTEND_KEYS.includes(record.id)) fail('Configuración local no admitida en la web.');
  const payload = JSON.stringify(record.value);
  if (byteLength(payload) > 256_000) fail('Un registro supera el tamaño admitido para esta importación.');
  validateValue(record.value);
  return payload;
}
async function head(db, teacherId) {
  return await db.prepare('SELECT active_import_id, revision FROM academic_heads WHERE teacher_id = ?').bind(teacherId).first()
    || { active_import_id: null, revision: 0 };
}

export async function academicRoute(request, env, teacher, { readJson, digest, randomToken, now }) {
  const url = new URL(request.url);
  const db = env.DB;
  const teacherId = teacher.id; // Exclusivamente de la sesión comprobada en servidor.
  try {
    if (url.pathname === '/api/academic/status' && request.method === 'GET') {
      const current = await head(db, teacherId);
      const counts = current.active_import_id
        ? (await db.prepare('SELECT dataset, COUNT(*) AS count FROM academic_records WHERE teacher_id = ? AND import_id = ? GROUP BY dataset').bind(teacherId, current.active_import_id).all()).results : [];
      return response({ ready: true, snapshotId: current.active_import_id, revision: current.revision, counts: Object.fromEntries(counts.map(row => [row.dataset, row.count])) });
    }
    if (url.pathname === '/api/academic/records' && request.method === 'GET') {
      const dataset = url.searchParams.get('dataset');
      const cursor = url.searchParams.get('cursor') || '';
      if (!DATASETS.includes(dataset) || cursor.length > 250 || /[\x00-\x1f]/.test(cursor)) fail('Consulta no válida.');
      const current = await head(db, teacherId);
      const requestedSnapshot = url.searchParams.get('snapshot');
      if (requestedSnapshot && requestedSnapshot !== current.active_import_id) fail('La copia activa cambió. Recarga la página.', 409);
      if (!current.active_import_id) return response({ records: [], nextCursor: null, snapshotId: null, revision: 0 });
      // Diez registros por página limitan la respuesta y evitan barridos globales.
      const rows = (await db.prepare(`SELECT record_id, payload_json FROM academic_records
        WHERE teacher_id = ? AND import_id = ? AND dataset = ? AND record_id > ? ORDER BY record_id LIMIT 11`)
        .bind(teacherId, current.active_import_id, dataset, cursor).all()).results;
      const page = rows.slice(0, 10);
      return response({ records: page.map(row => ({ id: row.record_id, value: JSON.parse(row.payload_json) })), nextCursor: rows.length > 10 ? page.at(-1).record_id : null, snapshotId: current.active_import_id, revision: current.revision });
    }
    if (url.pathname === '/api/academic/imports' && request.method === 'POST') {
      const body = await readJson(request);
      if (!keys(body, ['ownerUsername', 'fingerprint', 'counts']) || body.ownerUsername !== teacher.provider_username) fail('La copia corresponde a otra cuenta. Inicia sesión con el usuario indicado en el archivo.', 403);
      if (!/^[a-f0-9]{64}$/.test(body.fingerprint || '') || !keys(body.counts, DATASETS)
        || Object.keys(body.counts).length !== DATASETS.length || DATASETS.some(key => !Number.isSafeInteger(body.counts[key]) || body.counts[key] < 0)
        || body.counts.general !== 1 || Object.values(body.counts).reduce((a, b) => a + b, 0) > 10_000) fail('Resumen de la copia no válido.');
      const existing = await db.prepare('SELECT id, status FROM academic_imports WHERE teacher_id = ? AND fingerprint = ?').bind(teacherId, body.fingerprint).first();
      if (existing) return response({ importId: existing.id, status: existing.status });
      const count = await db.prepare('SELECT COUNT(*) AS count FROM academic_imports WHERE teacher_id = ?').bind(teacherId).first();
      if (count.count >= 5) fail('Esta cuenta alcanzó el límite de copias de prueba. Contacta al administrador.', 429);
      const current = await head(db, teacherId);
      const id = randomToken();
      await db.batch([
        db.prepare('INSERT INTO academic_heads(teacher_id, revision) VALUES (?, 0) ON CONFLICT(teacher_id) DO NOTHING').bind(teacherId),
        db.prepare('INSERT INTO academic_imports(teacher_id, id, fingerprint, counts_json, base_revision, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(teacherId, id, body.fingerprint, JSON.stringify(body.counts), current.revision, now),
      ]);
      return response({ importId: id, status: 'pending' });
    }
    const match = /^\/api\/academic\/imports\/([a-f0-9]{64})\/(chunks|commit)$/.exec(url.pathname);
    if (match && request.method === 'POST') {
      const [, importId, action] = match;
      const imported = await db.prepare('SELECT * FROM academic_imports WHERE teacher_id = ? AND id = ?').bind(teacherId, importId).first();
      if (!imported) fail('Copia no encontrada para esta cuenta.', 404);
      const current = await head(db, teacherId);
      if (action === 'commit' && current.active_import_id === importId) return response({ snapshotId: importId, revision: current.revision });
      if (imported.status !== 'pending') fail('Esta copia ya no admite cambios.', 409);
      if (action === 'chunks') {
        const body = await readJson(request, 400_000);
        if (!keys(body, ['sequence', 'records']) || !Number.isSafeInteger(body.sequence) || body.sequence < 0 || body.sequence >= 1000
          || !Array.isArray(body.records) || !body.records.length || body.records.length > 20) fail('Lote de importación no válido.');
        const payloads = body.records.map(validateRecord);
        const hash = await digest(JSON.stringify(body.records));
        const receipt = await db.prepare('SELECT digest FROM academic_import_chunks WHERE teacher_id = ? AND import_id = ? AND sequence = ?').bind(teacherId, importId, body.sequence).first();
        if (receipt) {
          if (receipt.digest !== hash) fail('El lote cambió. Usa el mismo archivo para reintentar.', 409);
          return response({ accepted: body.records.length });
        }
        const declaredTotal = Object.values(JSON.parse(imported.counts_json)).reduce((a, b) => a + b, 0);
        const chunkBytes = byteLength(JSON.stringify(body.records));
        const count = await db.prepare('SELECT COALESCE(SUM(record_count), 0) AS count, COALESCE(SUM(body_bytes), 0) AS bytes FROM academic_import_chunks WHERE teacher_id = ? AND import_id = ?').bind(teacherId, importId).first();
        if (count.count + body.records.length > declaredTotal || count.bytes + chunkBytes > 20_000_000) fail('La copia supera el número de registros o el límite de 20 MB.');
        await db.batch([
          db.prepare(`INSERT INTO academic_import_chunks(teacher_id, import_id, sequence, digest, record_count, body_bytes)
            SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM academic_imports WHERE teacher_id = ? AND id = ? AND status = 'pending')
            AND (SELECT COALESCE(SUM(record_count), 0) FROM academic_import_chunks WHERE teacher_id = ? AND import_id = ?) + ? <= ?
            AND (SELECT COALESCE(SUM(body_bytes), 0) FROM academic_import_chunks WHERE teacher_id = ? AND import_id = ?) + ? <= 20000000
            ON CONFLICT DO NOTHING`).bind(teacherId, importId, body.sequence, hash, body.records.length, chunkBytes, teacherId, importId, teacherId, importId, body.records.length, declaredTotal, teacherId, importId, chunkBytes),
          ...body.records.map((record, index) => db.prepare(`INSERT INTO academic_records(teacher_id, import_id, dataset, record_id, payload_json)
            SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM academic_import_chunks c JOIN academic_imports i ON i.teacher_id = c.teacher_id AND i.id = c.import_id
              WHERE c.teacher_id = ? AND c.import_id = ? AND c.sequence = ? AND c.digest = ? AND i.status = 'pending')
            ON CONFLICT(teacher_id, import_id, dataset, record_id) DO NOTHING`).bind(teacherId, importId, record.dataset, record.id, payloads[index], teacherId, importId, body.sequence, hash)),
        ]);
        const stored = await db.prepare('SELECT digest FROM academic_import_chunks WHERE teacher_id = ? AND import_id = ? AND sequence = ?').bind(teacherId, importId, body.sequence).first();
        if (!stored || stored.digest !== hash) fail('El lote cambió durante la importación.', 409);
        return response({ accepted: body.records.length });
      }
      const counts = Object.fromEntries((await db.prepare('SELECT dataset, COUNT(*) AS count FROM academic_records WHERE teacher_id = ? AND import_id = ? GROUP BY dataset').bind(teacherId, importId).all()).results.map(row => [row.dataset, row.count]));
      const expected = JSON.parse(imported.counts_json);
      if (DATASETS.some(key => (counts[key] || 0) !== expected[key])) fail('La copia todavía está incompleta. Reintenta con el mismo archivo.', 409);
      await db.batch([
        db.prepare(`UPDATE academic_heads SET active_import_id = ?, revision = revision + 1 WHERE teacher_id = ? AND revision = ?
          AND (SELECT COUNT(*) FROM academic_records WHERE teacher_id = ? AND import_id = ?) = ?`).bind(importId, teacherId, imported.base_revision, teacherId, importId, Object.values(expected).reduce((a, b) => a + b, 0)),
        db.prepare(`UPDATE academic_imports SET status = 'active' WHERE teacher_id = ? AND id = ?
          AND EXISTS (SELECT 1 FROM academic_heads WHERE teacher_id = ? AND active_import_id = ?)`).bind(teacherId, importId, teacherId, importId),
      ]);
      const activated = await head(db, teacherId);
      if (activated.active_import_id !== importId) fail('Se activó otra copia mientras importabas. No se reemplazaron esos datos.', 409);
      return response({ snapshotId: importId, revision: activated.revision });
    }
    return Response.json({ success: false, message: 'Operación no disponible.' }, { status: 404 });
  } catch (error) {
    if (String(error?.message).includes('no such table')) {
      const message = 'Falta preparar la base académica. El administrador debe ejecutar el archivo 0003_academic_snapshots.sql en D1.';
      if (url.pathname === '/api/academic/status') return response({ ready: false, message });
      fail(message, 503);
    }
    throw error;
  }
}
