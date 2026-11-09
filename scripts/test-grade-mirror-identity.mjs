import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import ts from 'typescript';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-grade-identity-'));
const mirror = path.join(root, 'mirror'); fs.mkdirSync(mirror);
const databases = [];
const make = name => {
  const db = new Database(':memory:'); databases.push(db);
  db.exec(`CREATE TABLE evaluacion_registros (id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, session_id TEXT, unit_id TEXT, instrument_id INTEGER,
    criteria_id TEXT, grading_mode TEXT DEFAULT 'literal_traditional', level TEXT, observation TEXT)`);
  const engine = createIncrementalMirrorSync({ db, runtimeFolder: path.join(root, name), getDeviceId: () => name,
    getSourceSignature: () => JSON.stringify(db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all()) });
  const save = (student, level, mode = 'literal_traditional') => {
    db.prepare('DELETE FROM evaluacion_registros WHERE student_id = ? AND grading_mode = ?').run(student, mode);
    db.prepare(`INSERT INTO evaluacion_registros (student_id,session_id,unit_id,instrument_id,criteria_id,grading_mode,level,observation)
      VALUES (?, 'session', 'unit', NULL, 'criterion', ?, ?, '')`).run(student, mode, level);
  };
  return { db, engine, save };
};
try {
  const a = make('pc-a'), b = make('pc-b');
  a.save('student-a', 'A'); b.save('student-b', 'B'); // Both have id=1.
  await a.engine.run({ mirrorPath: mirror }); await b.engine.run({ mirrorPath: mirror });
  await a.engine.run({ mirrorPath: mirror });
  const rows = pc => pc.db.prepare('SELECT student_id,grading_mode,level FROM evaluacion_registros ORDER BY student_id,grading_mode').all();
  assert.deepEqual(rows(a), rows(b)); assert.equal(rows(a).length, 2);
  b.save('student-a', 'AD'); // Reinsert gets a different internal id.
  await b.engine.run({ mirrorPath: mirror }); await a.engine.run({ mirrorPath: mirror });
  assert.deepEqual(rows(a), rows(b)); assert.equal(rows(a)[0].level, 'AD');
  a.save('student-a', '15', 'hybrid_vigesimal');
  await a.engine.run({ mirrorPath: mirror }); await b.engine.run({ mirrorPath: mirror });
  assert.deepEqual(rows(a), rows(b)); assert.equal(rows(a).length, 3, 'Grading modes are independent');
  b.db.prepare("DELETE FROM evaluacion_registros WHERE student_id = 'student-b'").run();
  await b.engine.run({ mirrorPath: mirror }); await a.engine.run({ mirrorPath: mirror });
  assert.deepEqual(rows(a), rows(b)); assert.equal(rows(a).length, 2, 'Clearing one grade reaches the other PC');

  const legacyEvents = path.join(mirror, '.armi-sync', 'incremental-v1', 'devices', 'legacy', 'events');
  fs.mkdirSync(legacyEvents, { recursive: true });
  fs.writeFileSync(path.join(legacyEvents, 'legacy-grade.json'), JSON.stringify({ format: 1, batchId: 'legacy-grade', deviceId: 'legacy', operations: [
    { table: 'evaluacion_registros', key: '[["id"],[1]]', keyColumns: ['id'], keyValues: [1], action: 'upsert', version: 1,
      row: { id: 1, student_id: 'legacy-student', session_id: 'session', unit_id: 'unit', instrument_id: null, criteria_id: 'criterion', level: 'B', observation: '' } },
  ] }));
  await a.engine.run({ mirrorPath: mirror }); await b.engine.run({ mirrorPath: mirror });
  assert.deepEqual(rows(a), rows(b)); assert.equal(rows(a).length, 3, 'Legacy upserts must also use the shared student key');
  const statePath = path.join(root, 'pc-a', 'incremental-identity-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')); delete state.identityRevision;
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.unlinkSync(path.join(root, 'pc-a', 'incremental-identity-fast-state.json'));
  const migrated = await a.engine.run({ mirrorPath: mirror });
  assert.equal(migrated.success, true); assert.ok(migrated.data.publishedOperations > 0, 'Existing PCs republish grades on upgrade');
  await b.engine.run({ mirrorPath: mirror }); assert.deepEqual(rows(a), rows(b));

  const source = ts.transpileModule(fs.readFileSync('utils/sessionGradeChanges.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const { selectChangedSessionGrades } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const snapshot = JSON.stringify([['a::c', 'A', ''], ['b::c', 'B', 'comment']]);
  const records = [
    { student_id: 'a', criteria_id: 'c', level: 'A', observation: '' },
    { student_id: 'b', criteria_id: 'c', level: '', observation: '' },
    { student_id: 'new', criteria_id: 'c', level: '', observation: '' },
  ];
  assert.deepEqual(selectChangedSessionGrades(records, snapshot), [records[1]], 'Stale unchanged rows must not be written; explicit clearing must be written');
  console.log('OK: null instruments, colliding PC ids, reinsertion, grading modes, clearing and delta-only saves.');
} finally {
  databases.forEach(db => db.close()); fs.rmSync(root, { recursive: true, force: true });
}
