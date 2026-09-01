import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';

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

  pc2.prepare("DELETE FROM asistencia_registros WHERE student_id = 'EST-2'").run();
  assert.equal((await run(engine2)).success, true);
  assert.equal((await run(engine1)).success, true);
  assert.equal(pc1.prepare("SELECT COUNT(*) total FROM asistencia_registros WHERE student_id = 'EST-2'").get().total, 0);

  console.log('OK: sincronizacion incremental validada entre PC1, PC2 y PC3.');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

