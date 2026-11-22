import { AuthError } from './apps-script-auth.js';
import { fieldsFor } from './edit-fields.js';
const fail = (message, status = 400) => { throw new AuthError(message, status); };
export async function editsReady(db) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'academic_edits'").first());
}
export async function hasEdits(db, teacherId) {
  return await editsReady(db) && Boolean(await db.prepare('SELECT 1 FROM academic_edits WHERE teacher_id = ? LIMIT 1').bind(teacherId).first());
}
export async function editAcademic(request, db, teacher, { readJson, digest, now }) {
  if (!await editsReady(db)) fail('Falta preparar el guardado web. Aplica 0004_academic_edits.sql en D1.', 503);
  const body = await readJson(request, 90_000);
  if (!body || Object.keys(body).some(key => !['dataset','id','changes','expectedRevision','snapshotId','operationId','action'].includes(key))) fail('Operación no válida.');
  const {dataset, id, changes, expectedRevision, snapshotId, operationId, action} = body;
  if (!fieldsFor(dataset).length || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)
    || (dataset === 'general' && id !== 'general') || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !(snapshotId === null || /^[a-f0-9]{64}$/.test(snapshotId)) || !/^[a-f0-9-]{36}$/.test(operationId || '')
    || !['save','delete'].includes(action) || (action === 'delete' && dataset !== 'students')) fail('Operación no válida.');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('Campos no válidos.');
  for (const [key, value] of Object.entries(changes)) {
    const limit = key === 'context_description' ? 60_000 : 1000;
    if (!fieldsFor(dataset).includes(key) || !['string','number'].includes(typeof value)
      || String(value).length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(String(value))) fail('Hay campos no admitidos o demasiado largos.');
  }
  if (action === 'delete' && Object.keys(changes).length) fail('El borrado no admite campos.');
  const hash = await digest(JSON.stringify(body));
  const previous = await db.prepare('SELECT * FROM academic_edits WHERE teacher_id = ? AND dataset = ? AND record_id = ?').bind(teacher.id, dataset, id).first();
  if (previous?.operation_id === operationId) {
    if (previous.operation_hash !== hash) fail('La operación ya fue utilizada con otros datos.', 409);
    return { id, value: JSON.parse(previous.payload_json), revision: previous.revision, deleted: Boolean(previous.deleted) };
  }
  const head = await db.prepare('SELECT active_import_id FROM academic_heads WHERE teacher_id = ?').bind(teacher.id).first();
  if ((head?.active_import_id || null) !== snapshotId || (previous?.revision || 0) !== expectedRevision || previous?.deleted) fail('Estos datos cambiaron en otra pestaña. Recarga antes de continuar.', 409);
  const base = !previous && snapshotId ? await db.prepare('SELECT payload_json FROM academic_records WHERE teacher_id = ? AND import_id = ? AND dataset = ? AND record_id = ?').bind(teacher.id, snapshotId, dataset, id).first() : null;
  if (action === 'delete' && !previous && !base) fail('Estudiante no encontrado.', 404);
  if (!previous && !base && dataset === 'students' && !id.startsWith('web-')) fail('Estudiante no encontrado.', 404);
  const value = {...JSON.parse(previous?.payload_json || base?.payload_json || '{}'), ...changes};
  if (dataset === 'students') {
    value.id ??= id;
    if (action === 'save' && ['name','grade','section'].some(key => !String(value[key] || '').trim())) fail('Completa nombre, grado y sección.');
  }
  await db.batch([
    db.prepare('INSERT INTO academic_heads(teacher_id, revision) VALUES (?, 0) ON CONFLICT(teacher_id) DO NOTHING').bind(teacher.id),
    db.prepare(`INSERT INTO academic_edits(teacher_id,dataset,record_id,payload_json,deleted,revision,operation_id,operation_hash,updated_at)
      SELECT ?,?,?,?,?,1,?,?,? WHERE EXISTS (SELECT 1 FROM academic_heads WHERE teacher_id = ? AND active_import_id IS ?)
      AND (? = 0 OR EXISTS (SELECT 1 FROM academic_edits WHERE teacher_id = ? AND dataset = ? AND record_id = ? AND revision = ?))
      ON CONFLICT(teacher_id,dataset,record_id) DO UPDATE SET payload_json=excluded.payload_json,deleted=excluded.deleted,
      revision=academic_edits.revision+1,operation_id=excluded.operation_id,operation_hash=excluded.operation_hash,updated_at=excluded.updated_at
      WHERE academic_edits.revision = ? AND academic_edits.deleted = 0`)
      .bind(teacher.id,dataset,id,JSON.stringify(value),Number(action === 'delete'),operationId,hash,now,teacher.id,snapshotId,expectedRevision,teacher.id,dataset,id,expectedRevision,expectedRevision),
    db.prepare(`UPDATE academic_heads SET revision = revision+1 WHERE teacher_id = ? AND changes() > 0 AND EXISTS
      (SELECT 1 FROM academic_edits WHERE teacher_id = ? AND dataset = ? AND record_id = ? AND operation_id = ?)`)
      .bind(teacher.id,teacher.id,dataset,id,operationId),
  ]);
  const saved = await db.prepare('SELECT * FROM academic_edits WHERE teacher_id = ? AND dataset = ? AND record_id = ?').bind(teacher.id,dataset,id).first();
  if (saved?.operation_id !== operationId) fail('Estos datos cambiaron. Recarga antes de continuar.', 409);
  return { id, value: JSON.parse(saved.payload_json), revision: saved.revision, deleted: Boolean(saved.deleted) };
}
