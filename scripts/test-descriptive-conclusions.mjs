import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { composeDescriptiveConclusion, draftGroundedConclusion } from '../backend/shared/descriptiveConclusions.js';
import { draftBimesterConclusions } from './draft-bimester-conclusions.mjs';
import { applyBimesterConclusions } from './apply-bimester-conclusions.mjs';

const parts = { logros: 'Avanza en la formulación de metas', dificultades: 'Debe afianzar la organización de sus estrategias', sugerencias: 'Se sugiere planificar tareas y tiempos' };
const composed = composeDescriptiveConclusion(parts);
assert.ok(composed.includes('metas. Debe afianzar') && composed.endsWith('tiempos.') && composed.length <= 250);
assert.equal(composeDescriptiveConclusion({ ...parts, sugerencias: 'palabra '.repeat(60) }), '', 'An overlong paragraph must not be cut');
assert.equal(composeDescriptiveConclusion({ ...parts, dificultades: '' }), '');
const competency = { key: 'x', competencyName: 'Gestiona su aprendizaje de manera autónoma', source: 'transversal', code: 'b' };
const student = { estado: '', capacities: [
  { key: 'x::metas', competencyName: competency.competencyName, source: 'transversal', capacityName: 'Define metas de aprendizaje', code: 'a', numericScore: 15 },
  { key: 'x::organiza', competencyName: competency.competencyName, source: 'transversal', capacityName: 'Organiza acciones estratégicas para alcanzar sus metas', code: 'c', numericScore: 10 },
] };
const before = structuredClone(student);
const draft = draftGroundedConclusion({ student, competency });
assert.equal(draft.kind, 'pedagogical');
assert.match(draft.text, /Demuestra logros en la formulación de metas.*Necesita reforzar la organización.*Se sugiere planificar/);
assert.deepEqual(student, before, 'Drafting must never mutate grades');
assert.equal(draftGroundedConclusion({ student, competency: { ...competency, pending: true } }).kind, 'pending');
assert.equal(draftGroundedConclusion({ student: { ...student, estado: 'R' }, competency }).text, 'Estudiante retirado.');
assert.equal(draftGroundedConclusion({ student, competency: { ...competency, code: 'ne' } }).kind, 'missing');

// End-to-end transaction tests use an isolated SQLite snapshot, never the source.
const sourcePath = process.argv[2];
if (sourcePath) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-conclusion-test-'));
  const copy = path.join(folder, 'test.db');
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  await source.backup(copy); source.close();
  const db = new Database(copy);
  const plan = draftBimesterConclusions(db);
  assert.equal(plan.summary.review, 0);
  assert.ok(plan.rows.every(row => row.text.length <= 250 && row.text.endsWith('.')));
  assert.ok(plan.rows.filter(row => row.kind === 'pedagogical').every(row => row.parts.logros && row.parts.dificultades && row.parts.sugerencias));
  const gradesBefore = db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
  const conclusionsBefore = db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all();
  const tampered = structuredClone(plan); tampered.rows[0].text = 'Texto alterado.';
  await assert.rejects(applyBimesterConclusions({ databasePath: copy, proposal: tampered, backupRoot: folder }), /no coincide/);
  assert.deepEqual(db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all(), conclusionsBefore);
  db.exec('CREATE TRIGGER test_grade_guard AFTER INSERT ON evaluacion_conclusiones BEGIN UPDATE evaluacion_registros SET numeric_score=99 WHERE id=(SELECT min(id) FROM evaluacion_registros); END');
  await assert.rejects(applyBimesterConclusions({ databasePath: copy, proposal: plan, backupRoot: folder }), /Cambio no autorizado/);
  assert.deepEqual(db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all(), conclusionsBefore, 'All changes must roll back');
  assert.deepEqual(db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(), gradesBefore);
  db.exec('DROP TRIGGER test_grade_guard');
  const report = await applyBimesterConclusions({ databasePath: copy, proposal: plan, backupRoot: folder });
  assert.equal(report.gradesChanged, 0);
  assert.equal(report.changes.length, plan.rows.length);
  assert.deepEqual(db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(), gradesBefore);
  const backup = new Database(report.backup, { readonly: true });
  assert.deepEqual(backup.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all(), conclusionsBefore); backup.close();
  db.close();
  // All paths below are created under this verified temporary test directory.
  assert.ok(folder.startsWith(path.join(os.tmpdir(), 'armi-conclusion-test-')));
  fs.rmSync(folder, { recursive: true, force: true });
}
console.log('Conclusiones: estructura, límite, estados, respaldo, aislamiento y reversión correctos.');
