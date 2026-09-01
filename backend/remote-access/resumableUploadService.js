import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import db from '../db.js';
import { ensureDir, tempRoot } from '../paths.js';

const MB = 1024 * 1024;
export const UPLOAD_CONFIG = Object.freeze({
  maxFileSize: 2 * 1024 * MB,
  smallFileLimit: 10 * MB,
  mediumFileLimit: 50 * MB,
  largeFileLimit: 500 * MB,
  mediumChunkSize: 5 * MB,
  largeChunkSize: 10 * MB,
  hugeChunkSize: 20 * MB,
  // Quick Tunnel admite 200 solicitudes en vuelo. Ocho transferencias activas
  // dejan margen amplio para login, heartbeat, estado, recursos y reintentos.
  maxConcurrentUploads: 8,
  maxUploadsPerUser: 1,
  retryCount: 3,
  uploadTimeoutMs: 2 * 60_000,
  temporaryUploadExpirationMs: 24 * 60 * 60_000,
});

const uploadRoot = path.join(tempRoot, 'resumable-evidence-uploads');
ensureDir(uploadRoot);
const activeUploads = new Set();

const allowedExtensions = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','mp4','webm','mov','avi','mkv','m4v','mp3','wav','m4a','aac','ogg','flac','pdf','doc','docx','odt','xls','xlsx','ods','ppt','pptx','odp','armi']);
const safeFileName = (value) => path.basename(String(value || 'evidencia')).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180) || 'evidencia';
const parseChunks = (value) => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isInteger) : []; } catch { return []; } };
const uploadFolder = (uploadId) => path.join(uploadRoot, uploadId);
const chunkPath = (uploadId, index) => path.join(uploadFolder(uploadId), `chunk_${String(index).padStart(6, '0')}.part`);

export const chooseChunkSize = (size) => {
  if (size <= UPLOAD_CONFIG.smallFileLimit) return Math.max(1, size);
  if (size <= UPLOAD_CONFIG.mediumFileLimit) return UPLOAD_CONFIG.mediumChunkSize;
  if (size <= UPLOAD_CONFIG.largeFileLimit) return UPLOAD_CONFIG.largeChunkSize;
  return UPLOAD_CONFIG.hugeChunkSize;
};

const findUpload = (uploadId) => db.prepare('SELECT * FROM portal_evidence_uploads WHERE upload_id = ?').get(String(uploadId || ''));
const assertOwnedUpload = (uploadId, studentId) => {
  const row = findUpload(uploadId);
  if (!row) { const error = new Error('La transferencia ya no existe o expiró.'); error.statusCode = 404; throw error; }
  if (String(row.student_id) !== String(studentId)) { const error = new Error('No tienes permiso para usar esta transferencia.'); error.statusCode = 403; throw error; }
  return row;
};

const activeCountForStudent = (studentId) => [...activeUploads].filter((id) => String(findUpload(id)?.student_id) === String(studentId)).length;
const queueRows = () => db.prepare("SELECT * FROM portal_evidence_uploads WHERE status = 'QUEUED' ORDER BY created_at, upload_id").all();

const allocateQueue = () => {
  for (const row of queueRows()) {
    if (activeUploads.size >= UPLOAD_CONFIG.maxConcurrentUploads) break;
    if (activeCountForStudent(row.student_id) >= UPLOAD_CONFIG.maxUploadsPerUser) continue;
    activeUploads.add(row.upload_id);
    db.prepare("UPDATE portal_evidence_uploads SET status = 'UPLOADING', updated_at = ? WHERE upload_id = ?").run(Date.now(), row.upload_id);
  }
};

const queuePosition = (uploadId) => {
  const index = queueRows().findIndex((row) => row.upload_id === uploadId);
  return index < 0 ? 0 : index + 1;
};

const confirmedBytes = (row, received) => received.reduce((total, index) => {
  try { return total + fs.statSync(chunkPath(row.upload_id, index)).size; } catch { return total; }
}, 0);

const serializeStatus = (row) => {
  const receivedChunks = [...new Set(parseChunks(row.received_chunks))].sort((a, b) => a - b);
  const receivedSet = new Set(receivedChunks);
  const missingChunks = Array.from({ length: Number(row.total_chunks) }, (_, index) => index).filter((index) => !receivedSet.has(index));
  return {
    uploadId: row.upload_id,
    status: row.status,
    originalFileName: row.original_file_name,
    totalSize: Number(row.total_size),
    chunkSize: Number(row.chunk_size),
    totalChunks: Number(row.total_chunks),
    receivedChunks,
    missingChunks,
    confirmedBytes: confirmedBytes(row, receivedChunks),
    queuePosition: row.status === 'QUEUED' ? queuePosition(row.upload_id) : 0,
    retryCount: UPLOAD_CONFIG.retryCount,
    lastError: row.last_error || '',
  };
};

export const initializeResumableUpload = ({ studentId, sessionId, replaceEvidenceId = 0, fileName, fileType = '', totalSize, sha256 = '', observation = '' }) => {
  const size = Number(totalSize);
  const cleanName = safeFileName(fileName);
  const extension = path.extname(cleanName).slice(1).toLowerCase();
  if (!Number.isSafeInteger(size) || size <= 0 || size > UPLOAD_CONFIG.maxFileSize) { const error = new Error('El tamaño del archivo no está permitido.'); error.statusCode = 413; throw error; }
  if (!allowedExtensions.has(extension)) { const error = new Error('Ese formato de archivo no está permitido.'); error.statusCode = 400; throw error; }
  if (sha256 && !/^[a-f0-9]{64}$/i.test(String(sha256))) { const error = new Error('La verificación del archivo no es válida.'); error.statusCode = 400; throw error; }
  const chunkSize = chooseChunkSize(size);
  const uploadId = crypto.randomUUID();
  const now = Date.now();
  ensureDir(uploadFolder(uploadId));
  db.prepare(`INSERT INTO portal_evidence_uploads (upload_id,student_id,session_id,replace_evidence_id,original_file_name,file_type,total_size,chunk_size,total_chunks,received_chunks,client_sha256,observation,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,'[]',?,?, 'QUEUED',?,?,?)`).run(
    uploadId, String(studentId), String(sessionId), Number(replaceEvidenceId || 0), cleanName, String(fileType || '').slice(0, 120), size, chunkSize, Math.ceil(size / chunkSize), String(sha256 || '').toLowerCase(), String(observation || '').slice(0, 4000), now, now, now + UPLOAD_CONFIG.temporaryUploadExpirationMs,
  );
  allocateQueue();
  return serializeStatus(findUpload(uploadId));
};

export const getResumableUploadStatus = (uploadId, studentId) => serializeStatus(assertOwnedUpload(uploadId, studentId));

export const receiveUploadChunk = async ({ uploadId, studentId, chunkIndex, request, expectedChunkHash = '' }) => {
  const row = assertOwnedUpload(uploadId, studentId);
  if (row.status === 'QUEUED') { const error = new Error('Tu evidencia está esperando un turno para comenzar.'); error.statusCode = 409; error.code = 'UPLOAD_QUEUED'; error.data = serializeStatus(row); throw error; }
  if (row.status !== 'UPLOADING') { const error = new Error('Esta transferencia no está lista para recibir fragmentos.'); error.statusCode = 409; throw error; }
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index >= Number(row.total_chunks)) { const error = new Error('Parte de archivo no válida.'); error.statusCode = 400; throw error; }
  const maximumSize = index === Number(row.total_chunks) - 1 ? Number(row.total_size) - (index * Number(row.chunk_size)) : Number(row.chunk_size);
  const temporary = `${chunkPath(uploadId, index)}.${crypto.randomUUID()}.partial`;
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const meter = async function* (source) { for await (const chunk of source) { bytes += chunk.length; if (bytes > maximumSize) throw new Error('La parte recibida supera el tamaño esperado.'); hash.update(chunk); yield chunk; } };
  try {
    await pipeline(Readable.from(meter(request)), fs.createWriteStream(temporary, { flags: 'wx' }));
    if (bytes !== maximumSize) throw new Error('La parte recibida está incompleta.');
    const actualHash = hash.digest('hex');
    if (expectedChunkHash && actualHash !== String(expectedChunkHash).toLowerCase()) throw new Error('La parte recibida no superó la verificación de integridad.');
    await fs.promises.rm(chunkPath(uploadId, index), { force: true });
    await fs.promises.rename(temporary, chunkPath(uploadId, index));
    const received = [...new Set([...parseChunks(row.received_chunks), index])].sort((a, b) => a - b);
    db.prepare("UPDATE portal_evidence_uploads SET received_chunks=?, updated_at=?, expires_at=?, last_error='' WHERE upload_id=?").run(JSON.stringify(received), Date.now(), Date.now() + UPLOAD_CONFIG.temporaryUploadExpirationMs, uploadId);
    return serializeStatus(findUpload(uploadId));
  } catch (error) {
    try { await fs.promises.rm(temporary, { force: true }); } catch {}
    db.prepare('UPDATE portal_evidence_uploads SET last_error=?, updated_at=? WHERE upload_id=?').run(String(error.message || error).slice(0, 500), Date.now(), uploadId);
    error.statusCode ||= 400;
    throw error;
  }
};

export const assembleResumableUpload = async (uploadId, studentId) => {
  const row = assertOwnedUpload(uploadId, studentId);
  const status = serializeStatus(row);
  if (status.missingChunks.length) { const error = new Error('Todavía faltan partes del archivo.'); error.statusCode = 409; error.data = status; throw error; }
  db.prepare("UPDATE portal_evidence_uploads SET status='ASSEMBLING',updated_at=? WHERE upload_id=?").run(Date.now(), uploadId);
  const assembledPath = path.join(uploadFolder(uploadId), 'assembled.upload');
  const source = async function* () { for (let index = 0; index < Number(row.total_chunks); index += 1) { for await (const chunk of fs.createReadStream(chunkPath(uploadId, index))) yield chunk; } };
  await pipeline(Readable.from(source()), fs.createWriteStream(assembledPath, { flags: 'w' }));
  db.prepare("UPDATE portal_evidence_uploads SET status='VERIFYING',updated_at=? WHERE upload_id=?").run(Date.now(), uploadId);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(assembledPath)) hash.update(chunk);
  const actualHash = hash.digest('hex');
  if (row.client_sha256 && actualHash !== row.client_sha256) {
    db.prepare("UPDATE portal_evidence_uploads SET status='FAILED_INTEGRITY',last_error=?,updated_at=? WHERE upload_id=?").run('El archivo reconstruido no coincide con el original.', Date.now(), uploadId);
    activeUploads.delete(uploadId); allocateQueue();
    const error = new Error('El archivo llegó incompleto o alterado. Vuelve a intentarlo.'); error.statusCode = 422; throw error;
  }
  return { row, assembledPath, sha256: actualHash };
};

export const completeResumableUpload = async (uploadId) => {
  db.prepare("UPDATE portal_evidence_uploads SET status='COMPLETED',updated_at=?,expires_at=? WHERE upload_id=?").run(Date.now(), Date.now() + 60 * 60_000, uploadId);
  activeUploads.delete(uploadId); allocateQueue();
  try { fs.rmSync(uploadFolder(uploadId), { recursive: true, force: true }); } catch {}
};

export const cancelResumableUpload = (uploadId, studentId) => {
  assertOwnedUpload(uploadId, studentId);
  db.prepare("UPDATE portal_evidence_uploads SET status='CANCELLED',updated_at=? WHERE upload_id=?").run(Date.now(), uploadId);
  activeUploads.delete(uploadId); allocateQueue();
  try { fs.rmSync(uploadFolder(uploadId), { recursive: true, force: true }); } catch {}
};

export const cleanupExpiredUploads = () => {
  const expired = db.prepare("SELECT upload_id FROM portal_evidence_uploads WHERE expires_at <= ? AND status <> 'COMPLETED'").all(Date.now());
  for (const row of expired) { activeUploads.delete(row.upload_id); try { fs.rmSync(uploadFolder(row.upload_id), { recursive: true, force: true }); } catch {} }
  db.prepare("DELETE FROM portal_evidence_uploads WHERE expires_at <= ?").run(Date.now());
  allocateQueue();
};

db.prepare("UPDATE portal_evidence_uploads SET status='QUEUED' WHERE status IN ('UPLOADING','ASSEMBLING','VERIFYING')").run();
cleanupExpiredUploads();
allocateQueue();
const cleanupTimer = setInterval(cleanupExpiredUploads, 30 * 60_000);
cleanupTimer.unref?.();
