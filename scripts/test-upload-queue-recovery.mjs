import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-upload-queue-'));
const databaseRoot = path.join(testRoot, 'database');
fs.mkdirSync(databaseRoot, { recursive: true });
fs.writeFileSync(path.join(databaseRoot, 'armi.db'), '');
process.env.ARMI_DATA_ROOT = testRoot;

const { default: db } = await import('../backend/db.js');
const {
  UPLOAD_CONFIG,
  cancelResumableUpload,
  initializeResumableUpload,
  runUploadQueueMaintenance,
  runUploadMaintenanceSafely,
} = await import('../backend/remote-access/resumableUploadService.js');

const created = [];
const init = (studentId, fileName = `${studentId}.pdf`) => {
  const status = initializeResumableUpload({
    studentId,
    sessionId: '__queue_session__',
    fileName,
    fileType: 'application/pdf',
    totalSize: 207 * 1024,
    sha256: '',
  });
  created.push([status.uploadId, studentId]);
  return status;
};

try {
  const first = init('__queue_student_0__', 'evidencia.pdf');
  assert.equal(first.status, 'UPLOADING');

  const retry1 = init('__queue_student_0__', 'evidencia.pdf');
  const retry2 = init('__queue_student_0__', 'evidencia.pdf');
  assert.equal(retry1.uploadId, first.uploadId);
  assert.equal(retry2.uploadId, first.uploadId);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM portal_evidence_uploads WHERE student_id=? AND status IN ('QUEUED','UPLOADING','PAUSED')").get('__queue_student_0__').total, 1);

  const switchedFrom = init('__queue_switch__', 'anterior.pdf');
  const switchedTo = init('__queue_switch__', 'nueva.pdf');
  assert.notEqual(switchedTo.uploadId, switchedFrom.uploadId);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM portal_evidence_uploads WHERE student_id=? AND status IN ('QUEUED','UPLOADING','PAUSED')").get('__queue_switch__').total, 1);
  cancelResumableUpload(switchedTo.uploadId, '__queue_switch__');

  for (let index = 1; index < UPLOAD_CONFIG.maxConcurrentUploads; index += 1) init(`__queue_student_${index}__`);
  const queued = init('__queue_waiting__');
  assert.equal(queued.status, 'QUEUED');

  db.prepare("UPDATE portal_evidence_uploads SET updated_at=? WHERE status='UPLOADING'").run(Date.now() - UPLOAD_CONFIG.uploadTimeoutMs - 1_000);
  runUploadQueueMaintenance();

  const recovered = init('__queue_recovered__');
  assert.equal(recovered.status, 'UPLOADING');
  const resumed = init('__queue_student_0__', 'evidencia.pdf');
  assert.equal(resumed.uploadId, first.uploadId);
  assert.notEqual(resumed.status, 'PAUSED');

  const locker = new Database(db.name);
  const timeoutBefore = db.pragma('busy_timeout', { simple: true });
  db.prepare("UPDATE portal_evidence_uploads SET updated_at=0 WHERE status='UPLOADING'").run();
  try {
    locker.exec('BEGIN IMMEDIATE');
    const started = Date.now();
    assert.equal(runUploadMaintenanceSafely(), false, 'A real write lock must defer maintenance instead of crashing the server');
    assert.ok(Date.now() - started < 500, 'Background maintenance must not block requests on a SQLite lock');
    assert.equal(db.pragma('busy_timeout', { simple: true }), timeoutBefore);
    locker.exec('ROLLBACK');
    assert.equal(runUploadMaintenanceSafely(), true, 'The next maintenance tick must recover once the lock is released');
  } finally { if (locker.inTransaction) locker.exec('ROLLBACK'); locker.close(); }
  console.log('OK: upload retries, abandoned slots, real SQLite lock without blocking/crash, and maintenance recovery.');
} finally {
  for (const [uploadId, studentId] of new Map(created.map((entry) => [entry[0], entry])).values()) {
    try { cancelResumableUpload(uploadId, studentId); } catch {}
  }
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
