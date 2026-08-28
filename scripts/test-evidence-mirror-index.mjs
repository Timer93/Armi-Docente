import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { reconcileEvidenceMirrorIndex, writeEvidenceTombstone } from '../backend/evidenceMirrorIndex.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-evidence-index-test-'));
const createDb = () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE db_estudiantes (id INTEGER PRIMARY KEY, dni TEXT, grado TEXT, secc TEXT, estudiantes TEXT);
    CREATE TABLE evaluacion_evidencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_key TEXT, student_id TEXT, session_id TEXT,
      criteria_id TEXT, file_path TEXT, file_type TEXT, observation TEXT, year TEXT, area_id TEXT,
      grade TEXT, section TEXT, bimester TEXT, unit_number TEXT, session_number TEXT,
      student_ids TEXT, student_names TEXT, file_name TEXT, file_size INTEGER, relative_path TEXT,
      source TEXT, version_group_id TEXT, version_number INTEGER, is_latest INTEGER,
      submitted_at TEXT, submission_ip TEXT, submission_user_agent TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_test_evidence_key ON evaluacion_evidencias(evidence_key)
      WHERE evidence_key IS NOT NULL AND TRIM(evidence_key) <> '';
  `);
  return database;
};

try {
  const relativePath = '2026/area/5to/B/U5/S1/archivo.pdf';
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('evidencia-segura'));

  const origin = createDb();
  origin.prepare('INSERT INTO db_estudiantes (id, dni, grado, secc, estudiantes) VALUES (?, ?, ?, ?, ?)')
    .run(52, '70000052', '5to', 'B', 'Estudiante Prueba');
  origin.prepare(`
    INSERT INTO evaluacion_evidencias (
      student_id, session_id, criteria_id, file_path, file_type, observation, year, area_id,
      grade, section, bimester, unit_number, session_number, student_ids, student_names,
      file_name, file_size, relative_path, source, version_group_id, version_number, is_latest,
      submitted_at, submission_ip, submission_user_agent, updated_at
    ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
  `).run(
    '52', 'sesion-5b-1', 'criterio-1', 'application/pdf', 'Trabajo del estudiante', '2026',
    'area', '5to', 'B', 'III', '5', '1', '["52"]', '["Estudiante Prueba"]',
    'archivo.pdf', fs.statSync(filePath).size, relativePath, 'student_portal', 'grupo-1',
    '2026-08-27 16:30:00', '192.168.0.25', 'Navegador de prueba', '2026-08-27 16:30:00'
  );

  const published = reconcileEvidenceMirrorIndex({ db: origin, root });
  assert.equal(published.exported, 1);

  const destination = createDb();
  const recovered = reconcileEvidenceMirrorIndex({ db: destination, root });
  assert.equal(recovered.imported, 1);
  const row = destination.prepare('SELECT * FROM evaluacion_evidencias').get();
  assert.equal(row.student_id, '52');
  assert.equal(row.session_id, 'sesion-5b-1');
  assert.equal(row.section, 'B');
  assert.equal(row.unit_number, '5');
  assert.equal(row.session_number, '1');
  assert.equal(row.relative_path, relativePath);

  const secondPass = reconcileEvidenceMirrorIndex({ db: destination, root });
  assert.equal(secondPass.imported, 0);
  assert.equal(destination.prepare('SELECT COUNT(*) AS total FROM evaluacion_evidencias').get().total, 1);

  writeEvidenceTombstone({ root, row });
  const deletion = reconcileEvidenceMirrorIndex({ db: destination, root });
  assert.equal(deletion.deletedLinks, 1);
  assert.equal(destination.prepare('SELECT COUNT(*) AS total FROM evaluacion_evidencias').get().total, 0);

  origin.close();
  destination.close();
  console.log('OK: indice portatil de evidencias probado con publicacion, recuperacion idempotente y borrado seguro.');
} finally {
  const safeTempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  if (resolved.startsWith(`${safeTempRoot}${path.sep}`) && path.basename(resolved).startsWith('armi-evidence-index-test-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
