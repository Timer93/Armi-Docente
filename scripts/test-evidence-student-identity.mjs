import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';
import { createEvidenceStudentResolver, planEvidenceStudentRepairs, applyEvidenceStudentRepairs } from '../backend/evidenceStudentIdentity.js';
import { portableEvidenceKey, reconcileEvidenceMirrorIndex } from '../backend/evidenceMirrorIndex.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-evidence-identity-'));
const mirror = path.join(root, 'mirror');
const evidenceRoot = path.join(mirror, 'Evidencias de estudiantes');
fs.mkdirSync(evidenceRoot, { recursive: true });
const schemaDb = new Database('database/armi.db', { readonly: true });
const schema = schemaDb.prepare("SELECT sql FROM sqlite_master WHERE name = 'evaluacion_evidencias'").get().sql;
schemaDb.close();
const pcs = [];
const studentName = 'CARBAJAL RUIZ, Madeleine Dayana';
const make = (device, studentId, otherId) => {
  const db = new Database(path.join(root, `${device}.db`));
  pcs.push(db);
  db.exec(`CREATE TABLE db_estudiantes (id INTEGER PRIMARY KEY, dni TEXT, estudiantes TEXT, grado TEXT, secc TEXT); ${schema}`);
  if (!db.prepare('PRAGMA table_info(evaluacion_evidencias)').all().some(column => column.name === 'requested_evidence')) {
    db.exec("ALTER TABLE evaluacion_evidencias ADD COLUMN requested_evidence TEXT DEFAULT ''");
  }
  db.prepare('INSERT INTO db_estudiantes VALUES (?, ?, ?, ?, ?)').run(studentId, '61805282', studentName, '4to', 'U');
  db.prepare('INSERT INTO db_estudiantes VALUES (?, ?, ?, ?, ?)').run(otherId, '12345678', 'Otro estudiante', '2do', 'B');
  const engine = createIncrementalMirrorSync({ db, runtimeFolder: path.join(root, device), getDeviceId: () => device,
    excludedTables: ['db_estudiantes'], getSourceSignature: () => JSON.stringify(db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all()) });
  return { db, engine, studentId };
};
const add = (pc, unit, session, foreignId) => {
  const relative = `2026/ept/4to/U/U${unit}/S${session}/evidence-${unit}-${session}.txt`;
  const key = portableEvidenceKey(relative);
  const file = path.join(evidenceRoot, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `Evidence ${unit}/${session}`);
  pc.db.prepare(`INSERT INTO evaluacion_evidencias (evidence_key, student_id, student_ids, student_names,
    session_id, relative_path, year, grade, section, unit_number, session_number, source, updated_at,
    submitted_at, teacher_comment, file_size, file_name, observation)
    VALUES (?, ?, ?, ?, ?, ?, '2026', '2do', 'B', ?, ?, 'student_portal',
      '2026-10-09 18:00:00', '2026-10-08 12:00:00', 'Comentario conservado', ?, ?, 'pendiente')`)
    .run(key, String(foreignId), JSON.stringify([String(foreignId)]), JSON.stringify([studentName]),
      `session-${unit}-${session}`, relative, String(unit), String(session), fs.statSync(file).size, path.basename(file));
  pc.db.prepare('UPDATE evaluacion_evidencias SET requested_evidence=? WHERE evidence_key=?')
    .run(JSON.stringify({ id: `requested-${unit}-${session}`, text: `Producto ${unit}/${session}`, source: 'transversal', competency: 'Entornos virtuales', color: '#007c59' }), key);
  return key;
};
const verify = pc => {
  const rows = pc.db.prepare('SELECT * FROM evaluacion_evidencias').all();
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.student_id, String(pc.studentId));
    assert.deepEqual(JSON.parse(row.student_ids), [String(pc.studentId)]);
    assert.equal(row.grade, '4to'); assert.equal(row.section, 'U');
    assert.equal(row.updated_at, '2026-10-09 18:00:00');
    assert.equal(row.submitted_at, '2026-10-08 12:00:00');
    assert.equal(row.teacher_comment, 'Comentario conservado');
    assert.equal(row.observation, 'pendiente');
    assert.equal(JSON.parse(row.requested_evidence).id, `requested-${row.unit_number}-${row.session_number}`);
    assert.equal(fs.readFileSync(path.join(evidenceRoot, row.relative_path), 'utf8'), `Evidence ${row.unit_number}/${row.session_number}`);
  }
};
try {
  const a = make('pc1', 106, 172), b = make('pc2', 172, 106);
  add(a, 5, 3, 172); add(a, 5, 4, 172);
  add(b, 6, 1, 106); add(b, 6, 2, 106);
  await a.engine.run({ mirrorPath: mirror }); await b.engine.run({ mirrorPath: mirror });
  await a.engine.run({ mirrorPath: mirror }); verify(a); verify(b);
  for (const pc of [a, b]) reconcileEvidenceMirrorIndex({ db: pc.db, root: evidenceRoot });
  const c = make('pc-index-only', 800, 900);
  reconcileEvidenceMirrorIndex({ db: c.db, root: evidenceRoot });
  verify(c); // Physical files + portable metadata must restore categories on another PC.
  const row = a.db.prepare('SELECT * FROM evaluacion_evidencias LIMIT 1').get();
  a.db.prepare("UPDATE evaluacion_evidencias SET student_id = '172', student_ids = '[\"172\"]', grade = '2do', section = 'B' WHERE id = ?").run(row.id);
  const original = a.db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(row.id);
  const plan = planEvidenceStudentRepairs(a.db);
  assert.equal(plan.length, 1); assert.equal(applyEvidenceStudentRepairs(a.db, plan), 1);
  const repaired = a.db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(row.id);
  for (const field of Object.keys(original).filter(field => !plan[0].fields.includes(field))) assert.deepEqual(repaired[field], original[field]);
  verify(a);
  const beforeIndex = fs.readFileSync(path.join(evidenceRoot, '.armi-evidence-index', 'records', `${row.evidence_key}.json`), 'utf8');
  reconcileEvidenceMirrorIndex({ db: b.db, root: evidenceRoot });
  assert.equal(fs.readFileSync(path.join(evidenceRoot, '.armi-evidence-index', 'records', `${row.evidence_key}.json`), 'utf8'), beforeIndex,
    'Switching PC must not rewrite unchanged portable metadata');
  await a.engine.run({ mirrorPath: mirror }); await b.engine.run({ mirrorPath: mirror });
  const steady = await a.engine.run({ mirrorPath: mirror });
  assert.equal(steady.data.publishedOperations, 0, 'Different local ids must not cause repeated publications');
  const resolver = createEvidenceStudentResolver([
    { id: 1, dni: '87654321', estudiantes: 'Persona A', grado: '4to', secc: 'U' },
    { id: 2, dni: '12348765', estudiantes: 'Persona B', grado: '4to', secc: 'U' },
  ]);
  const group = resolver({ student_id: '100', student_ids: '["100","200"]', student_names: '["Persona A","Persona B"]', grade: '4to', section: 'U' });
  assert.deepEqual(JSON.parse(group.student_ids), ['1', '2']);
  assert.deepEqual(JSON.parse(group.student_dnis), ['87654321', '12348765']);
  const wrongDni = resolver({ student_id: '2', student_dni: '12348765', student_names: '["Persona A"]',
    student_ids: '["2"]', grade: '4to', section: 'U' });
  assert.equal(wrongDni.student_id, '1', 'A foreign id must not attach another student\'s DNI to an evidence');
  assert.equal(wrongDni.student_dni, '87654321', 'A conflicting DNI is checked against the submitted name');
  const ambiguous = createEvidenceStudentResolver([{ id: 1, estudiantes: 'Igual', grado: '4to', secc: 'U' }, { id: 2, estudiantes: 'Igual', grado: '4to', secc: 'U' }]);
  assert.equal(ambiguous({ student_id: '1', student_names: '["Igual"]', grade: '4to', section: 'U' }).student_dni, undefined);
  console.log('OK: Madeleine U5/S3-S4 and U6/S1-S2, colliding student ids, equal timestamps, group ownership, ambiguity and preserved files/comments.');
} finally {
  pcs.forEach(db => db.close());
  fs.rmSync(root, { recursive: true, force: true });
}
