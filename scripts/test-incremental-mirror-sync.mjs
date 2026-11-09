import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';
import { writeEvidenceTombstone } from '../backend/evidenceMirrorIndex.js';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-incremental-test-'));
const mirrorRoot = path.join(testRoot, 'mirror');
const currentRoot = path.join(mirrorRoot, '.armi-sync', 'current', 'database');
fs.mkdirSync(currentRoot, { recursive: true });

const createDatabase = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE asistencia_registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_date TEXT,
      grade TEXT,
      section TEXT,
      student_id TEXT,
      status TEXT,
      updated_at TEXT,
      UNIQUE(attendance_date, grade, section, student_id)
    );
    CREATE TABLE db_estudiantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dni TEXT,
      estudiantes TEXT,
      grado TEXT,
      secc TEXT,
      estado TEXT,
      updated_at TEXT
    );
    CREATE TABLE student_deletion_tombstones (
      student_id TEXT PRIMARY KEY,
      dni TEXT,
      student_name TEXT,
      deleted_at TEXT
    );
    CREATE TABLE evaluacion_evidencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_key TEXT UNIQUE,
      student_id TEXT,
      session_id TEXT,
      relative_path TEXT,
      file_size INTEGER,
      updated_at TEXT
    );
  `);
  db.prepare(`INSERT INTO asistencia_registros
    (attendance_date, grade, section, student_id, status, updated_at)
    VALUES ('2026-08-28', '5', 'B', 'BASE', 'P', '2026-08-28 08:00:00')`).run();
  return db;
};

const baseDump = {
  tables: {
    asistencia_registros: [{
      id: 1,
      attendance_date: '2026-08-28',
      grade: '5',
      section: 'B',
      student_id: 'BASE',
      status: 'P',
      updated_at: '2026-08-28 08:00:00',
    }],
    evaluacion_evidencias: [],
    db_estudiantes: [],
    student_deletion_tombstones: [],
  },
};
fs.writeFileSync(path.join(currentRoot, 'database-dump.json'), JSON.stringify(baseDump));

const createEngine = (db, name) => createIncrementalMirrorSync({
  db,
  runtimeFolder: path.join(testRoot, `runtime-${name}`),
  excludedTables: [],
  getDeviceId: () => name,
});
const run = (engine) => engine.run({
  mirrorPath: mirrorRoot,
  mirrorDatabaseDumpPath: path.join(currentRoot, 'database-dump.json'),
});

try {
  const pc1 = createDatabase();
  const pc2 = createDatabase();
  const pc3 = createDatabase();
  const engine1 = createEngine(pc1, 'pc1');
  const engine2 = createEngine(pc2, 'pc2');
  const engine3 = createEngine(pc3, 'pc3');

  pc2.prepare(`INSERT INTO asistencia_registros
    (attendance_date, grade, section, student_id, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('2026-08-28', '5', 'B', 'EST-2', 'P', '2026-08-28 15:00:00');
  pc2.prepare(`INSERT INTO evaluacion_evidencias
    (evidence_key, student_id, session_id, relative_path, file_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('ev-pc2', 'EST-2', 'SES-1', '5B/ev-pc2.pdf', 1234, '2026-08-28 15:01:00');
  assert.equal((await run(engine2)).success, true);

  assert.equal((await run(engine1)).success, true);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM asistencia_registros WHERE student_id = 'EST-2'").get().total, 1);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM evaluacion_evidencias WHERE evidence_key = 'ev-pc2'").get().total, 1);

  pc3.prepare(`INSERT INTO asistencia_registros
    (attendance_date, grade, section, student_id, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('2026-08-28', '5', 'B', 'EST-3', 'T', '2026-08-28 15:05:00');
  assert.equal((await run(engine3)).success, true);
  assert.equal(pc3.prepare("SELECT COUNT(*) total FROM asistencia_registros WHERE student_id = 'EST-2'").get().total, 1);

  assert.equal((await run(engine1)).success, true);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM asistencia_registros WHERE student_id = 'EST-3'").get().total, 1);
  assert.equal(pc1.prepare('SELECT COUNT(*) total FROM asistencia_registros').get().total, 3);

  pc1.prepare(`INSERT INTO db_estudiantes
    (dni, estudiantes, grado, secc, estado, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('70000001', 'Estudiante recuperable', '5', 'A', 'A', '2026-08-28 16:00:00');
  pc1.prepare(`INSERT INTO evaluacion_evidencias
    (evidence_key, student_id, session_id, relative_path, file_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('ev-recovery', '70000001', 'SES-2', '5A/ev-recovery.pdf', 4321, '2026-08-28 16:01:00');
  assert.equal((await run(engine1)).success, true);
  assert.equal((await run(engine2)).success, true);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE dni = '70000001'").get().total, 1);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").get().total, 1);

  // Simula una PC cuya base quedo incompleta pese a haber marcado el lote como
  // aplicado. El catalogo de recuperacion debe reponer la union sin reemplazarla.
  pc2.prepare("DELETE FROM db_estudiantes WHERE dni = '70000001'").run();
  pc2.prepare("DELETE FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").run();
  assert.equal((await run(engine2)).success, true);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE dni = '70000001'").get().total, 1);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").get().total, 1);

  // Un estudiante eliminado desde la interfaz deja una marca persistente. Los
  // catalogos de recuperacion antiguos no deben volver a insertarlo y el borrado
  // debe llegar a las demas PC.
  const studentToDelete = pc2.prepare("SELECT id, dni, estudiantes FROM db_estudiantes WHERE dni = '70000001'").get();
  pc2.transaction(() => {
    pc2.prepare(`INSERT INTO student_deletion_tombstones (student_id, dni, student_name, deleted_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)`).run(String(studentToDelete.id), studentToDelete.dni, studentToDelete.estudiantes);
    pc2.prepare('DELETE FROM db_estudiantes WHERE id = ?').run(studentToDelete.id);
  })();
  assert.equal((await run(engine2)).success, true);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE dni = '70000001'").get().total, 0);
  assert.equal((await run(engine1)).success, true);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE dni = '70000001'").get().total, 0);
  assert.equal((await run(engine2)).success, true);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE dni = '70000001'").get().total, 0);

  // Los DNI provisionales pueden repetirse. En ese caso la identidad estable es
  // el id y eliminar una fila no debe borrar ni restaurar su homonima.
  pc1.prepare(`INSERT INTO db_estudiantes
    (dni, estudiantes, grado, secc, estado, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('0000...', 'Duplicado uno', '5', 'A', 'A', '2026-08-28 17:00:00');
  pc1.prepare(`INSERT INTO db_estudiantes
    (dni, estudiantes, grado, secc, estado, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('0000...', 'Duplicado dos', '5', 'A', 'A', '2026-08-28 17:01:00');
  assert.equal((await run(engine1)).success, true);
  assert.equal((await run(engine2)).success, true);
  const provisionalToDelete = pc2.prepare("SELECT id, dni, estudiantes FROM db_estudiantes WHERE estudiantes = 'Duplicado uno'").get();
  pc2.transaction(() => {
    pc2.prepare(`INSERT INTO student_deletion_tombstones (student_id, dni, student_name, deleted_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)`).run(String(provisionalToDelete.id), provisionalToDelete.dni, provisionalToDelete.estudiantes);
    pc2.prepare('DELETE FROM db_estudiantes WHERE id = ?').run(provisionalToDelete.id);
  })();
  assert.equal((await run(engine2)).success, true);
  assert.equal((await run(engine1)).success, true);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE estudiantes = 'Duplicado uno'").get().total, 0);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE estudiantes = 'Duplicado dos'").get().total, 1);
  assert.equal((await run(engine2)).success, true);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE estudiantes = 'Duplicado uno'").get().total, 0);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM db_estudiantes WHERE estudiantes = 'Duplicado dos'").get().total, 1);

  // Una instalación anterior no tenía la huella del catálogo. Al abrir ARMI,
  // inspect debe pedir por sí solo la verificación, sin pulsar Actualizar.
  const pc2FastStatePath = path.join(testRoot, 'runtime-pc2', 'incremental-identity-fast-state.json');
  const pc2FastState = JSON.parse(fs.readFileSync(pc2FastStatePath, 'utf8'));
  delete pc2FastState.recoverySetSignature;
  fs.writeFileSync(pc2FastStatePath, JSON.stringify(pc2FastState));
  assert.equal(engine2.inspect({ mirrorPath: mirrorRoot }).pending, true);
  assert.equal((await run(engine2)).success, true);
  assert.equal(engine2.inspect({ mirrorPath: mirrorRoot }).pending, false);

  // Un borrado deliberado lleva tombstone: no debe ser recuperado por ningun
  // catalogo antiguo y debe propagarse al resto de equipos.
  const evidenceToDelete = pc2.prepare("SELECT * FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").get();
  assert.ok(evidenceToDelete);
  const evidenceRoot = path.join(mirrorRoot, 'Evidencias de estudiantes');
  writeEvidenceTombstone({ root: evidenceRoot, row: evidenceToDelete });
  pc2.prepare("DELETE FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").run();
  assert.equal((await run(engine2)).success, true);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").get().total, 0);
  assert.equal((await run(engine1)).success, true);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").get().total, 0);
  assert.equal((await run(engine2)).success, true);
  assert.equal(pc2.prepare("SELECT COUNT(*) total FROM evaluacion_evidencias WHERE evidence_key = 'ev-recovery'").get().total, 0);

  pc2.prepare("DELETE FROM asistencia_registros WHERE student_id = 'EST-2'").run();
  assert.equal((await run(engine2)).success, true);
  assert.equal((await run(engine1)).success, true);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM asistencia_registros WHERE student_id = 'EST-2'").get().total, 0);

  console.log('OK: sincronizacion incremental validada entre PC1, PC2 y PC3.');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

