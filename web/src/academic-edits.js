import { AuthError } from './apps-script-auth.js';
import { fieldsFor, isPlanning, planningId } from './edit-fields.js';
import {configurationReady} from './web-configuration.js';
const fail = (message, status = 400) => { throw new AuthError(message, status); };
export async function editsReady(db, planning = false) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(planning ? 'planning_edits' : 'academic_edits').first());
}
export async function hasEdits(db, teacherId) {
  for (const planning of [false,true]) if (await editsReady(db,planning) && await db.prepare(`SELECT 1 FROM ${planning ? 'planning_edits' : 'academic_edits'} WHERE teacher_id = ? LIMIT 1`).bind(teacherId).first()) return true;
  if(await configurationReady(db) && await db.prepare('SELECT 1 FROM web_configurations WHERE teacher_id=?').bind(teacherId).first()) return true;
  return false;
}
export async function editAcademic(request, db, teacher, { readJson, digest, now, validateRecord }) {
  const body = await readJson(request, 400_000);
  if (!body || Object.keys(body).some(key => !['dataset','id','changes','expectedRevision','snapshotId','operationId','action'].includes(key))) fail('Operación no válida.');
  const {dataset, id, changes, expectedRevision, snapshotId, operationId, action} = body;
  const planning = isPlanning(dataset);
  const table = planning ? 'planning_edits' : 'academic_edits';
  if (!await editsReady(db,planning)) fail(`Falta preparar el guardado web. Aplica ${planning ? '0005_planning_edits.sql' : '0004_academic_edits.sql'} en D1.`, 503);
  if ((!planning && !fieldsFor(dataset).length) || typeof id !== 'string' || !id || id.length > 250 || /[\x00-\x1f]/.test(id) || ['__proto__','constructor','prototype'].includes(id)
    || (dataset === 'general' && id !== 'general') || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !(snapshotId === null || /^[a-f0-9]{64}$/.test(snapshotId)) || !/^[a-f0-9-]{36}$/.test(operationId || '')
    || !['save','delete','restore'].includes(action) || (action === 'restore' && !planning) || (action === 'delete' && dataset !== 'students' && !planning)) fail('Operación no válida.');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('Campos no válidos.');
  for (const [key, value] of Object.entries(changes)) {
    const limit = key === 'context_description' ? 60_000 : 1000;
    if (!planning && (!fieldsFor(dataset).includes(key) || !['string','number'].includes(typeof value)
      || String(value).length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(String(value)))) fail('Hay campos no admitidos o demasiado largos.');
  }
  if (action === 'delete' && Object.keys(changes).length) fail('El borrado no admite campos.');
  const hash = await digest(JSON.stringify(body));
  const previous = await db.prepare(`SELECT * FROM ${table} WHERE teacher_id = ? AND dataset = ? AND record_id = ?`).bind(teacher.id, dataset, id).first();
  if (previous?.operation_id === operationId) {
    if (previous.operation_hash !== hash) fail('La operación ya fue utilizada con otros datos.', 409);
    return { id, value: JSON.parse(previous.payload_json), revision: previous.revision, deleted: Boolean(previous.deleted) };
  }
  const head = await db.prepare('SELECT active_import_id FROM academic_heads WHERE teacher_id = ?').bind(teacher.id).first();
  if ((head?.active_import_id || null) !== snapshotId || (previous?.revision || 0) !== expectedRevision || (previous?.deleted && action !== 'restore') || (action === 'restore' && !previous?.deleted)) fail('Estos datos cambiaron en otra pestaña. Recarga antes de continuar.', 409);
  const base = !previous && snapshotId ? await db.prepare('SELECT payload_json FROM academic_records WHERE teacher_id = ? AND import_id = ? AND dataset = ? AND record_id = ?').bind(teacher.id, snapshotId, dataset, id).first() : null;
  if (action === 'delete' && !previous && !base) fail('Registro no encontrado.', 404);
  if (!previous && !base && dataset === 'students' && !id.startsWith('web-')) fail('Estudiante no encontrado.', 404);
  const value = {...JSON.parse(previous?.payload_json || base?.payload_json || '{}'), ...changes};
  if (planning) {
    if (dataset === 'annual' && value.year === undefined) value.year = id.slice(0,4);
    if (!/^\d{4}$/.test(String(value.year)) || ['areaId','grade','section'].some(key => typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 80)
      || (dataset !== 'annual' && !/^\d{1,3}$/.test(String(value.unitNumber)))
      || (dataset === 'sessions' && !/^\d{1,3}$/.test(String(value.sessionNumber))) || planningId(dataset,value) !== id) fail('La identificación de la planificación no coincide. Revisa año, área, grado, sección y número.');
    value.id = id;
    validateRecord({dataset,id,value});
  }
  if (dataset === 'students') {
    value.id ??= id;
    if (action === 'save' && ['name','grade','section'].some(key => !String(value[key] || '').trim())) fail('Completa nombre, grado y sección.');
  }
  await db.batch([
    db.prepare('INSERT INTO academic_heads(teacher_id, revision) VALUES (?, 0) ON CONFLICT(teacher_id) DO NOTHING').bind(teacher.id),
    db.prepare(`INSERT INTO ${table}(teacher_id,dataset,record_id,payload_json,deleted,revision,operation_id,operation_hash,updated_at)
      SELECT ?,?,?,?,?,1,?,?,? WHERE EXISTS (SELECT 1 FROM academic_heads WHERE teacher_id = ? AND active_import_id IS ?)
      AND (? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE teacher_id = ? AND dataset = ? AND record_id = ? AND revision = ?))
      ON CONFLICT(teacher_id,dataset,record_id) DO UPDATE SET payload_json=excluded.payload_json,deleted=excluded.deleted,
      revision=${table}.revision+1,operation_id=excluded.operation_id,operation_hash=excluded.operation_hash,updated_at=excluded.updated_at
      WHERE ${table}.revision = ? AND (${table}.deleted = 0 OR ? = 1)`)
      .bind(teacher.id,dataset,id,JSON.stringify(value),Number(action === 'delete'),operationId,hash,now,teacher.id,snapshotId,expectedRevision,teacher.id,dataset,id,expectedRevision,expectedRevision,Number(action === 'restore')),
    db.prepare(`UPDATE academic_heads SET revision = revision+1 WHERE teacher_id = ? AND changes() > 0 AND EXISTS
      (SELECT 1 FROM ${table} WHERE teacher_id = ? AND dataset = ? AND record_id = ? AND operation_id = ?)`)
      .bind(teacher.id,teacher.id,dataset,id,operationId),
  ]);
  const saved = await db.prepare(`SELECT * FROM ${table} WHERE teacher_id = ? AND dataset = ? AND record_id = ?`).bind(teacher.id,dataset,id).first();
  if (saved?.operation_id !== operationId) fail('Estos datos cambiaron. Recarga antes de continuar.', 409);
  return { id, value: JSON.parse(saved.payload_json), revision: saved.revision, deleted: Boolean(saved.deleted) };
}
