import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { portableEvidenceKey, reconcileEvidenceMirrorIndex } from '../backend/evidenceMirrorIndex.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-evidence-startup-'));
const dataRoot = path.join(root, 'local');
const mirrorRoot = path.join(root, 'mirror');
const evidenceRoot = path.join(mirrorRoot, 'Evidencias de estudiantes');
const localDatabasePath = path.join(dataRoot, 'database', 'armi.db');
const originDatabasePath = path.join(root, 'origin.db');
let origin = null;
let local = null;

try {
  fs.mkdirSync(path.dirname(localDatabasePath), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'sync-runtime'), { recursive: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.copyFileSync(path.resolve('database/armi.db'), localDatabasePath);
  fs.copyFileSync(localDatabasePath, originDatabasePath);
  fs.writeFileSync(
    path.join(dataRoot, 'sync-runtime', 'sync-config.json'),
    JSON.stringify({ mode: 'drive_mirror', mirrorPath: mirrorRoot, syncUserKey: 'startup-test' }),
  );

  origin = new Database(originDatabasePath);
  const student = origin.prepare("SELECT id, dni FROM db_estudiantes WHERE dni IS NOT NULL AND TRIM(dni) <> '' LIMIT 1").get();
  assert.ok(student, 'La base de prueba necesita un estudiante con DNI.');
  const uniqueName = `startup-${crypto.randomUUID()}`;
  const relativePath = `2026/prueba/${uniqueName}.pdf`;
  const evidenceKey = portableEvidenceKey(relativePath);
  const physicalPath = path.join(evidenceRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(physicalPath), { recursive: true });
  fs.writeFileSync(physicalPath, Buffer.from('evidencia recuperada al iniciar'));
  origin.prepare(`
    INSERT INTO evaluacion_evidencias (
      evidence_key, student_id, session_id, file_path, file_type, year, area_id,
      grade, section, unit_number, session_number, file_name, file_size,
      relative_path, source, version_group_id, version_number, is_latest,
      submitted_at, updated_at
    ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    evidenceKey, String(student.id), 'startup-session', 'application/pdf', '2026', 'startup-area',
    '5to', 'A', '1', '1', `${uniqueName}.pdf`, fs.statSync(physicalPath).size,
    relativePath, 'student_portal', evidenceKey,
  );
  const published = reconcileEvidenceMirrorIndex({ db: origin, root: evidenceRoot });
  assert.equal(published.exported, 1);
  origin.close(); origin = null;

  process.env.ARMI_DATA_ROOT = dataRoot;
  process.env.ARMI_DISABLE_DRIVE_LAUNCH = '1';
  const { reconcileEvidenceState, shutdownEvidenceReconciliation } = await import('../backend/evidenceReconciliationService.js');
  const result = await reconcileEvidenceState();
  await shutdownEvidenceReconciliation();
  assert.equal(result.enabled, true);
  assert.equal(result.imported, 1, JSON.stringify(result));

  local = new Database(localDatabasePath, { readonly: true });
  assert.ok(local.prepare('SELECT 1 FROM evaluacion_evidencias WHERE evidence_key = ?').get(evidenceKey));
  console.log('OK: al iniciar, la base local incorpora silenciosamente una evidencia disponible en el espejo.');
} finally {
  if (origin?.open) origin.close();
  if (local?.open) local.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
