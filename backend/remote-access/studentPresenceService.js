import crypto from 'crypto';
import db from '../db.js';
import { setRemoteAccessActivity } from './remoteAccessService.js';

export const PRESENCE_CONFIG = Object.freeze({
  heartbeatIntervalMs: 20_000,
  offlineTimeoutMs: 60_000,
  recentTimeoutMs: 5 * 60_000,
});

const presenceBySession = new Map();

const sessionKey = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const cleanText = (value, maxLength = 80) => String(value || '').trim().slice(0, maxLength);

const readStudent = (studentId) => db.prepare(`
  SELECT id, dni, estudiantes, grado, secc
  FROM db_estudiantes WHERE id = ? LIMIT 1
`).get(String(studentId));

const publishCounts = () => {
  const now = Date.now();
  const online = [...presenceBySession.values()].filter((entry) => now - entry.lastHeartbeat <= PRESENCE_CONFIG.offlineTimeoutMs);
  const activeUploads = online.filter((entry) => entry.uploadStatus === 'UPLOADING').length;
  const queuedUploads = online.filter((entry) => entry.uploadStatus === 'QUEUED').length;
  setRemoteAccessActivity({
    connectedStudents: online.length,
    activeUploads,
    queuedUploads,
    activeTransfers: activeUploads,
  });
};

export const touchStudentPresence = ({ token, studentId, activity = '', uploadStatus = '', source = '' }) => {
  if (!token || !studentId) return null;
  const key = sessionKey(token);
  const now = Date.now();
  const existing = presenceBySession.get(key);
  const student = existing || readStudent(studentId);
  if (!student) return null;
  const entry = {
    sessionId: key.slice(0, 16),
    userId: String(studentId),
    dni: cleanText(existing?.dni || student.dni, 16),
    names: cleanText(existing?.names || student.estudiantes, 140),
    grade: cleanText(existing?.grade || student.grado, 30),
    section: cleanText(existing?.section || student.secc, 30),
    connectedAt: existing?.connectedAt || now,
    lastHeartbeat: now,
    currentActivity: cleanText(activity || existing?.currentActivity || 'Portal estudiantil', 80),
    uploadStatus: ['IDLE', 'UPLOADING', 'QUEUED', 'VERIFYING'].includes(uploadStatus)
      ? uploadStatus
      : existing?.uploadStatus || 'IDLE',
    source: source === 'remote' ? 'remote' : existing?.source || 'lan',
  };
  presenceBySession.set(key, entry);
  publishCounts();
  return { ...entry, online: true };
};

export const disconnectStudentPresence = (token) => {
  if (!token) return false;
  const removed = presenceBySession.delete(sessionKey(token));
  if (removed) publishCounts();
  return removed;
};

export const getStudentPresenceSummary = () => {
  const now = Date.now();
  const students = [...presenceBySession.values()]
    .map((entry) => ({
      ...entry,
      online: now - entry.lastHeartbeat <= PRESENCE_CONFIG.offlineTimeoutMs,
      lastHeartbeatAt: new Date(entry.lastHeartbeat).toISOString(),
      connectedAt: new Date(entry.connectedAt).toISOString(),
    }))
    .filter((entry) => entry.online || now - Date.parse(entry.lastHeartbeatAt) <= PRESENCE_CONFIG.recentTimeoutMs)
    .sort((left, right) => left.grade.localeCompare(right.grade, 'es') || left.section.localeCompare(right.section, 'es') || left.names.localeCompare(right.names, 'es'));
  const online = students.filter((entry) => entry.online);
  return {
    heartbeatIntervalMs: PRESENCE_CONFIG.heartbeatIntervalMs,
    offlineTimeoutMs: PRESENCE_CONFIG.offlineTimeoutMs,
    onlineCount: online.length,
    activeUploads: online.filter((entry) => entry.uploadStatus === 'UPLOADING').length,
    queuedUploads: online.filter((entry) => entry.uploadStatus === 'QUEUED').length,
    students,
  };
};

export const cleanupStudentPresence = () => {
  const cutoff = Date.now() - PRESENCE_CONFIG.recentTimeoutMs;
  for (const [key, entry] of presenceBySession.entries()) {
    if (entry.lastHeartbeat < cutoff) presenceBySession.delete(key);
  }
  publishCounts();
};

const cleanupTimer = setInterval(cleanupStudentPresence, 30_000);
cleanupTimer.unref?.();
