import assert from 'assert/strict';
import crypto from 'crypto';
import { Readable } from 'stream';
import db from '../backend/db.js';
import {
  assembleResumableUpload,
  cancelResumableUpload,
  completeResumableUpload,
  getResumableUploadStatus,
  initializeResumableUpload,
  receiveUploadChunk,
} from '../backend/remote-access/resumableUploadService.js';

const payload = crypto.randomBytes(1024 * 1024);
const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
let uploadId = '';

try {
  const initialized = initializeResumableUpload({
    studentId: '__test_student__',
    sessionId: '__test_session__',
    fileName: 'evidencia-prueba.pdf',
    fileType: 'application/pdf',
    totalSize: payload.length,
    sha256: expectedHash,
  });
  uploadId = initialized.uploadId;
  assert.equal(initialized.totalChunks, 1);
  assert.equal(initialized.status, 'UPLOADING');

  const received = await receiveUploadChunk({
    uploadId,
    studentId: '__test_student__',
    chunkIndex: 0,
    request: Readable.from(payload),
    expectedChunkHash: expectedHash,
  });
  assert.deepEqual(received.missingChunks, []);
  assert.equal(received.confirmedBytes, payload.length);

  const assembled = await assembleResumableUpload(uploadId, '__test_student__');
  assert.equal(assembled.sha256, expectedHash);
  await completeResumableUpload(uploadId);
  assert.equal(getResumableUploadStatus(uploadId, '__test_student__').status, 'COMPLETED');
  console.log('Subida reanudable de 1 MB: OK');
} finally {
  if (uploadId) db.prepare('DELETE FROM portal_evidence_uploads WHERE upload_id = ?').run(uploadId);
}

const lanPayload = crypto.randomBytes(128 * 1024);
let lanUploadId = '';
try {
  const initialized = initializeResumableUpload({
    studentId: '__test_lan_http__',
    sessionId: '__test_session__',
    fileName: 'evidencia-lan.pdf',
    fileType: 'application/pdf',
    totalSize: lanPayload.length,
    sha256: '',
  });
  lanUploadId = initialized.uploadId;
  await receiveUploadChunk({
    uploadId: lanUploadId,
    studentId: '__test_lan_http__',
    chunkIndex: 0,
    request: Readable.from(lanPayload),
    expectedChunkHash: '',
  });
  const assembled = await assembleResumableUpload(lanUploadId, '__test_lan_http__');
  assert.equal(assembled.sha256, crypto.createHash('sha256').update(lanPayload).digest('hex'));
  await completeResumableUpload(lanUploadId);
  console.log('Subida LAN HTTP sin Web Crypto: OK');
} finally {
  if (lanUploadId) db.prepare('DELETE FROM portal_evidence_uploads WHERE upload_id = ?').run(lanUploadId);
}

const resumePayload = crypto.randomBytes(12 * 1024 * 1024);
const resumeHash = crypto.createHash('sha256').update(resumePayload).digest('hex');
let resumeId = '';
try {
  let status = initializeResumableUpload({ studentId: '__test_resume__', sessionId: '__test_session__', fileName: 'video-prueba.mp4', fileType: 'video/mp4', totalSize: resumePayload.length, sha256: resumeHash });
  resumeId = status.uploadId;
  assert.equal(status.totalChunks, 3);
  const first = resumePayload.subarray(0, status.chunkSize);
  status = await receiveUploadChunk({ uploadId: resumeId, studentId: '__test_resume__', chunkIndex: 0, request: Readable.from(first), expectedChunkHash: crypto.createHash('sha256').update(first).digest('hex') });
  assert.deepEqual(status.missingChunks, [1, 2]);
  status = getResumableUploadStatus(resumeId, '__test_resume__');
  for (const index of status.missingChunks) {
    const part = resumePayload.subarray(index * status.chunkSize, Math.min(resumePayload.length, (index + 1) * status.chunkSize));
    await receiveUploadChunk({ uploadId: resumeId, studentId: '__test_resume__', chunkIndex: index, request: Readable.from(part), expectedChunkHash: crypto.createHash('sha256').update(part).digest('hex') });
  }
  const assembled = await assembleResumableUpload(resumeId, '__test_resume__');
  assert.equal(assembled.sha256, resumeHash);
  await completeResumableUpload(resumeId);
  console.log('Corte y reanudación de 12 MB: OK');
} finally {
  if (resumeId) db.prepare('DELETE FROM portal_evidence_uploads WHERE upload_id = ?').run(resumeId);
}

const original = crypto.randomBytes(1024 * 1024);
const altered = Buffer.from(original);
altered[0] ^= 0xff;
let corruptId = '';
try {
  const status = initializeResumableUpload({ studentId: '__test_integrity__', sessionId: '__test_session__', fileName: 'integridad.pdf', fileType: 'application/pdf', totalSize: original.length, sha256: crypto.createHash('sha256').update(original).digest('hex') });
  corruptId = status.uploadId;
  await receiveUploadChunk({ uploadId: corruptId, studentId: '__test_integrity__', chunkIndex: 0, request: Readable.from(altered), expectedChunkHash: crypto.createHash('sha256').update(altered).digest('hex') });
  await assert.rejects(() => assembleResumableUpload(corruptId, '__test_integrity__'), /incompleto|alterado/i);
  assert.equal(getResumableUploadStatus(corruptId, '__test_integrity__').status, 'FAILED_INTEGRITY');
  cancelResumableUpload(corruptId, '__test_integrity__');
  console.log('Corrupción de archivo detectada por SHA-256: OK');
} finally {
  if (corruptId) db.prepare('DELETE FROM portal_evidence_uploads WHERE upload_id = ?').run(corruptId);
}
