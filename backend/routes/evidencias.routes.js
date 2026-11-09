import { createSectionSessionSchedule } from '../sectionSessionSchedule.js';
import { automaticSectionWindow, effectiveSectionWindow, sectionWindowKey, splitSessionSections } from '../shared/sectionSessionDates.js';
import express from 'express';
import { buildSessionEvidenceReview } from '../sessionEvidenceReview.js';
import { evidenceStudentResolverForDatabase } from '../evidenceStudentIdentity.js';
import { filterEvidenceByCompetency } from '../evidenceCompetencyScope.js';
import { readRequestedEvidence } from '../shared/portalRequestedEvidences.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';
import db, { getPortalSessionToken } from '../db.js';
import { tempRoot, ensureDir } from '../paths.js';
import {
  saveEvidenceTempFile,
  saveEvidenceDataUrl,
  uploadEvidenceMiddleware,
  resolveEvidenceFilePath,
  mapEvidenceRow,
  persistEvidencePortableMetadata,
  evidenceRelativePathFromRow,
  getEvidenceStorageContext,
  requireLocalTeacherRequest,
  removeEvidenceFileWithOriginals,
} from '../evidenceStorage.js';
import { writeEvidenceTombstone } from '../evidenceMirrorIndex.js';
import {
  canPreviewEvidence,
  evidencePreviewKind,
  mustUseSandboxedEvidencePreview,
  safeEvidenceLink,
  HTML_EVIDENCE_PREVIEW_POLICY,
} from '../evidenceFormats.js';

const router = express.Router();

const evidenceThumbnailRoot = path.join(tempRoot, 'evidence-thumbnails-v1');
ensureDir(evidenceThumbnailRoot);
const thumbnailJobs = new Map();

const safeJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const evidenceVersionToken = (row) => crypto
  .createHash('sha1')
  .update(`${row?.id || ''}|${row?.updated_at || ''}|${row?.file_size || ''}|${row?.relative_path || ''}`)
  .digest('hex')
  .slice(0, 12);

const isImageEvidence = (row) => {
  const mime = String(row?.file_type || '').toLowerCase();
  const ext = path.extname(String(row?.file_name || row?.relative_path || '')).toLowerCase();
  return mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'].includes(ext);
};

const isVideoEvidence = (row) => {
  const mime = String(row?.file_type || '').toLowerCase();
  const ext = path.extname(String(row?.file_name || row?.relative_path || '')).toLowerCase();
  return mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'].includes(ext);
};

const hasEvidenceThumbnail = (row) => isImageEvidence(row) || isVideoEvidence(row);

const mapEvidenceRowFast = (row, deliveryTiming = null) => {
  const versionToken = evidenceVersionToken(row);
  return {
    id: row.id,
    year: row.year || '',
    areaId: row.area_id || '',
    grade: row.grade || '',
    section: row.section || '',
    bimester: row.bimester || '',
    unitNumber: row.unit_number || '',
    sessionNumber: row.session_number || '',
    sessionId: row.session_id || '',
    studentId: row.student_id || '',
    criteriaId: row.criteria_id || '',
    requestedEvidence: readRequestedEvidence(row.requested_evidence),
    observation: row.observation || '',
    evidenceLink: safeEvidenceLink(row.evidence_link),
    teacherComment: row.teacher_comment || '',
    teacherCommentedAt: row.teacher_commented_at || '',
    studentIds: safeJsonArray(row.student_ids),
    studentNames: safeJsonArray(row.student_names),
    fileName: row.file_name || path.basename(row.file_path || ''),
    renamedBy: row.renamed_by || '',
    fileSize: Number(row.file_size || 0),
    fileType: row.file_type || '',
    previewKind: evidencePreviewKind(row.file_name || row.relative_path, row.file_type),
    filePath: '',
    fileUrl: `/api/evaluacion/evidencias/${row.id}/file?v=${versionToken}`,
    previewUrl: canPreviewEvidence(row.file_name || row.relative_path, row.file_type)
      ? `/api/evaluacion/evidencias/${row.id}/preview?v=${versionToken}&viewer=2`
      : '',
    thumbnailUrl: hasEvidenceThumbnail(row)
      ? `/api/evaluacion/evidencias/${row.id}/thumbnail?v=${versionToken}`
      : '',
    source: row.source || 'teacher',
    versionGroupId: row.version_group_id || `legacy-${row.id}`,
    versionNumber: Number(row.version_number || 1),
    isLatest: Number(row.is_latest ?? 1) === 1,
    submittedAt: row.submitted_at || row.updated_at,
    deliveryTiming: deliveryTiming?.status || (row.source === 'student_portal' ? 'unknown' : 'teacher'),
    lateByMs: Number(deliveryTiming?.lateByMs || 0),
    onTimeCloseAt: deliveryTiming?.onTimeCloseAt || '',
    submissionIp: row.submission_ip || '',
    submissionUserAgent: row.submission_user_agent || '',
    available: Boolean(row.relative_path || row.file_path),
    availabilitySource: 'indexed',
    portable: Boolean(row.relative_path),
    updatedAt: row.updated_at,
  };
};

const runFfmpegThumbnail = (source, target) => new Promise((resolve, reject) => {
  const configured = String(ffmpegStatic || '').replace(/app\.asar([\\/])/i, 'app.asar.unpacked$1');
  const command = fs.existsSync(configured) ? configured : String(ffmpegStatic || '');
  if (!command) return reject(new Error('FFmpeg no está disponible.'));
  const child = spawn(command, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '00:00:00.100', '-i', source, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-f', 'image2', target], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let details = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('La miniatura de video tardó demasiado.')); }, 2 * 60_000);
  child.stderr.on('data', (chunk) => { details = `${details}${chunk}`.slice(-2000); });
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(details || `FFmpeg terminó con código ${code}.`)); });
});

const ensureEvidenceThumbnail = async (row) => {
  if (!row || !hasEvidenceThumbnail(row)) return '';
  const versionToken = evidenceVersionToken(row);
  const target = path.join(evidenceThumbnailRoot, `${row.id}-${versionToken}.webp`);
  if (fs.existsSync(target)) return target;

  const jobKey = `${row.id}:${versionToken}`;
  const existingJob = thumbnailJobs.get(jobKey);
  if (existingJob) return existingJob;

  const job = (async () => {
    const source = resolveEvidenceFilePath(row);
    if (!source) return '';
    const partial = `${target}.${process.pid}.${crypto.randomUUID()}.partial`;
    const videoFrame = `${partial}.jpg`;
    try {
      if (isVideoEvidence(row)) await runFfmpegThumbnail(source, videoFrame);
      await sharp(isVideoEvidence(row) ? videoFrame : source)
        .rotate()
        .resize({ width: 480, height: 320, fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 72, effort: 1 })
        .toFile(partial);
      await fs.promises.rename(partial, target);
      return target;
    } finally {
      try { await fs.promises.rm(partial, { force: true }); } catch {}
      try { await fs.promises.rm(videoFrame, { force: true }); } catch {}
    }
  })().finally(() => thumbnailJobs.delete(jobKey));

  thumbnailJobs.set(jobKey, job);
  return job;
};

const sectionSchedule = createSectionSessionSchedule(db);
const getAutomaticEvidenceWindow = (sessionRow, sessionData, section = '') => automaticSectionWindow(sectionSchedule.dates(sessionRow, sessionData, section));

const splitEvidenceSections = (value) => String(value || '')
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9\s,/-]/g, ' ')
  .replace(/[,/-]/g, ' ')
  .replace(/\bY\b/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

const parseEvidenceLocalDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const localDateMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  const normalized = localDateMatch
    ? `${localDateMatch[3]}-${String(localDateMatch[2]).padStart(2, '0')}-${String(localDateMatch[1]).padStart(2, '0')}T00:00:00`
    : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseEvidenceSubmittedAt = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getEvidenceStudentSessionDate = (sessionRow, sessionData, studentSection) => sectionSchedule.dates(sessionRow, sessionData, studentSection)[0] || '';

const getEvidenceDeliveryTiming = (row, sessionCache, studentSectionCache) => {
  if (row.source !== 'student_portal') return { status: 'teacher', lateByMs: 0, onTimeCloseAt: '' };
  const sessionId = String(row.session_id || '');
  if (!sessionId) return { status: 'unknown', lateByMs: 0, onTimeCloseAt: '' };

  if (!sessionCache.has(sessionId)) {
    const session = db.prepare('SELECT id_sesion, year, area_id, grade, section, unit_number, session_number, session_data FROM sesiones WHERE id_sesion = ?').get(sessionId);
    let data={};
    try { data=JSON.parse(session?.session_data || '{}'); } catch {}
    sessionCache.set(sessionId,session ? {...session,data} : null);
  }
  const sessionRow = sessionCache.get(sessionId);
  if (!sessionRow) return { status: 'unknown', lateByMs: 0, onTimeCloseAt: '' };

  const studentId = String(row.student_id || '');
  if (!studentSectionCache.has(studentId)) {
    const student = studentId ? db.prepare('SELECT secc FROM db_estudiantes WHERE id = ?').get(studentId) : null;
    studentSectionCache.set(studentId, student?.secc || row.section || '');
  }

  const sessionData = sessionRow.data;
  const sessionDate = parseEvidenceLocalDate(getEvidenceStudentSessionDate(
    sessionRow,
    sessionData,
    studentSectionCache.get(studentId),
  ));
  const submittedAt = parseEvidenceSubmittedAt(row.submitted_at || row.updated_at);
  if (!sessionDate || !submittedAt) return { status: 'unknown', lateByMs: 0, onTimeCloseAt: '' };

  const onTimeCloseAt = new Date(sessionDate);
  onTimeCloseAt.setDate(onTimeCloseAt.getDate() + 1);
  onTimeCloseAt.setHours(23, 59, 59, 999);
  const lateByMs = Math.max(0, submittedAt.getTime() - onTimeCloseAt.getTime());
  return {
    status: lateByMs > 0 ? 'late' : 'on_time',
    lateByMs,
    onTimeCloseAt: onTimeCloseAt.toISOString(),
  };
};

const requireStudentEvidenceFileAccess = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;
  if (token) {
    const session = getPortalSessionToken(token);
    if (session) {
      const evidence = db.prepare('SELECT student_id, student_ids FROM evaluacion_evidencias WHERE id = ?').get(Number(req.params.id));
      if (!evidence) return res.status(404).send('Evidencia no encontrada.');
      let studentIds = [];
      try { studentIds = JSON.parse(evidence.student_ids || '[]').map(String); } catch {}
      const ownsEvidence = String(evidence.student_id || '') === String(session.studentId)
        || studentIds.includes(String(session.studentId));
      if (!ownsEvidence) return res.status(403).send('No tienes permiso para ver esta evidencia.');
      return next();
    }
  }
  const remote = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (remote === '127.0.0.1' || remote === '::1' || remote === 'localhost') return next();
  return res.status(401).send('Debes iniciar sesión para abrir esta evidencia.');
};

router.get('/evaluacion/evidencias', requireLocalTeacherRequest, (req, res) => {
  const { sessionId, year, areaId, grade, section, bimester, unitNumber, sessionNumber, studentId, criteriaId } = req.query;
  try {
    let sql = 'SELECT * FROM evaluacion_evidencias WHERE 1=1';
    const params = [];
    if (sessionId) {
      // A combined class can have session section "A y B", while each student
      // evidence correctly keeps its real section (for example, "B"). The
      // portable session id is therefore the authoritative relationship.
      sql += ' AND session_id = ?';
      params.push(String(sessionId));
    } else {
      // Compatibility with the Evidence Bank and legacy callers.
      if (year) { sql += ' AND year = ?'; params.push(year); }
      if (areaId) { sql += ' AND area_id = ?'; params.push(areaId); }
      if (grade) { sql += ' AND grade = ?'; params.push(grade); }
      if (section) { sql += ' AND section = ?'; params.push(section); }
      if (bimester) { sql += ' AND bimester = ?'; params.push(bimester); }
      if (unitNumber) { sql += ' AND unit_number = ?'; params.push(unitNumber); }
      if (sessionNumber) { sql += ' AND session_number = ?'; params.push(sessionNumber); }
    }
    // Membership and portable identities are resolved below, just as in the
    // register's evidence counter. The primary submitter is not the whole group.
    if (criteriaId && !sessionId) {
        sql += ' AND criteria_id = ?';
        params.push(String(criteriaId));
    }
    sql += ' ORDER BY updated_at DESC';

    const resolveStudent = studentId ? evidenceStudentResolverForDatabase(db) : row => row;
    let rows = db.prepare(sql).all(...params).map(resolveStudent).filter(row => !studentId
      || String(row.student_id) === String(studentId)
      || safeJsonArray(row.student_ids).map(String).includes(String(studentId)));
    if (criteriaId && sessionId) {
      const session = db.prepare('SELECT session_data FROM sesiones WHERE id_sesion=?').get(String(sessionId));
      let sessionData = {};
      try { sessionData = JSON.parse(session?.session_data || '{}'); } catch {}
      rows = filterEvidenceByCompetency(rows, String(criteriaId), sessionData);
    }
    const sessionCache = new Map();
    const studentSectionCache = new Map();
    const data = rows.map((row) => mapEvidenceRowFast(
      row,
      getEvidenceDeliveryTiming(row, sessionCache, studentSectionCache),
    ));
    res.json({ success: true, data });

    setImmediate(() => {
      rows.slice(0, 24).forEach((row) => {
        if (hasEvidenceThumbnail(row)) void ensureEvidenceThumbnail(row).catch(() => {});
      });
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/evaluacion/evidencias', requireLocalTeacherRequest, uploadEvidenceMiddleware, async (req, res) => {
  const body = req.body || {};
  const {
    id,
    year,
    areaId,
    grade,
    section,
    bimester,
    unitNumber,
    sessionNumber,
    sessionId: requestedSessionId,
    criteriaId,
    observation,
  } = body;

  let studentIds = [];
  let studentNames = [];
  try {
    studentIds = typeof body.studentIds === 'string' ? JSON.parse(body.studentIds) : (body.studentIds || []);
    studentNames = typeof body.studentNames === 'string' ? JSON.parse(body.studentNames) : (body.studentNames || []);
  } catch {}

  try {
    if (!year || !areaId || !grade || !section || !bimester || !unitNumber || !sessionNumber) {
      return res.status(400).json({ success: false, message: 'Faltan metadatos obligatorios de año, área o grado.' });
    }

    let savedFile = null;
    let originalFileName = body.fileName || req.file?.originalname || 'evidencia';
    let fileType = body.fileType || req.file?.mimetype || '';

    if (req.file) {
      savedFile = await saveEvidenceTempFile({
        tempFilePath: req.file.path,
        fileName: originalFileName,
        year,
        areaId,
        grade,
        section,
        unitNumber,
        sessionNumber,
        mimeType: fileType,
      });
    } else if (body.dataUrl) {
      savedFile = await saveEvidenceDataUrl({
        dataUrl: body.dataUrl,
        fileName: originalFileName,
        year,
        areaId,
        grade,
        section,
        unitNumber,
        sessionNumber,
      });
    } else {
      return res.status(400).json({ success: false, message: 'Falta el archivo de evidencia.' });
    }

    const absoluteFilePath = savedFile.absolutePath;
    const firstStudentId = Array.isArray(studentIds) && studentIds.length > 0 ? String(studentIds[0]) : '';
    const sessionId = String(requestedSessionId || '').trim()
      || `${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`;

    let previous = null;
    if (id) previous = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);

    if (id && previous) {
      db.prepare(`
        UPDATE evaluacion_evidencias SET
          evidence_key = NULL,
          student_id = ?, session_id = ?, criteria_id = ?,
          file_path = ?, file_type = ?, observation = ?,
          year = ?, area_id = ?, grade = ?, section = ?,
          bimester = ?, unit_number = ?, session_number = ?,
          student_ids = ?, student_names = ?, file_name = ?, file_size = ?,
          relative_path = ?, source = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        firstStudentId,
        sessionId,
        String(criteriaId || ''),
        absoluteFilePath,
        savedFile.detectedMime || fileType || '',
        String(observation || ''),
        year,
        areaId,
        grade,
        section,
        bimester,
        String(unitNumber),
        String(sessionNumber),
        JSON.stringify(Array.isArray(studentIds) ? studentIds : []),
        JSON.stringify(Array.isArray(studentNames) ? studentNames : []),
        savedFile.fileName || originalFileName,
        savedFile.size,
        savedFile.relativePath,
        'teacher',
        id
      );

      const previousPath = resolveEvidenceFilePath(previous);
      if (previousPath && previousPath !== absoluteFilePath && fs.existsSync(previousPath)) {
        removeEvidenceFileWithOriginals(previousPath);
      }
    } else {
      db.prepare(`
        INSERT INTO evaluacion_evidencias (
          student_id, session_id, criteria_id,
          file_path, file_type, observation,
          year, area_id, grade, section, bimester, unit_number, session_number,
          student_ids, student_names, file_name, file_size, relative_path, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        firstStudentId,
        sessionId,
        String(criteriaId || ''),
        absoluteFilePath,
        savedFile.detectedMime || fileType || '',
        String(observation || ''),
        year,
        areaId,
        grade,
        section,
        bimester,
        String(unitNumber),
        String(sessionNumber),
        JSON.stringify(Array.isArray(studentIds) ? studentIds : []),
        JSON.stringify(Array.isArray(studentNames) ? studentNames : []),
        savedFile.fileName || originalFileName,
        savedFile.size,
        savedFile.relativePath,
        'teacher'
      );
    }

    const saved = id
      ? db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id)
      : db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = last_insert_rowid()').get();

    if (previous && evidenceRelativePathFromRow(previous) !== evidenceRelativePathFromRow(saved)) {
      const context = getEvidenceStorageContext();
      if (context.automaticMirror) {
        try { writeEvidenceTombstone({ root: context.effectivePath, row: previous }); } catch {}
      }
    }
    persistEvidencePortableMetadata(saved);

    const responseData = mapEvidenceRowFast(saved);
    res.json({
      success: true,
      data: responseData,
    });
    if (hasEvidenceThumbnail(saved)) {
      setImmediate(() => { void ensureEvidenceThumbnail(saved).catch(() => {}); });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/evaluacion/evidencias/:id/thumbnail', requireStudentEvidenceFileAccess, async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).send('Evidencia no encontrada.');
    if (!hasEvidenceThumbnail(row)) return res.status(415).send('La evidencia no admite miniatura.');

    const thumbnail = await ensureEvidenceThumbnail(row);
    if (!thumbnail) return res.status(404).send('La imagen no esta disponible.');

    res.type('image/webp');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return res.sendFile(thumbnail);
  } catch (error) {
    return res.status(500).send(error?.message || 'No se pudo generar la miniatura.');
  }
});

router.get('/evaluacion/evidencias/:id/file', requireStudentEvidenceFileAccess, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).send('Evidencia no encontrada.');
    const resolvedPath = resolveEvidenceFilePath(row);
    if (!resolvedPath) return res.status(404).send('El archivo no existe en la carpeta de almacenamiento.');
    const fileName = row.file_name || path.basename(resolvedPath);
    const previewKind = evidencePreviewKind(fileName, row.file_type);
    if (row.file_type) res.type(row.file_type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const canOpenDirectly = req.query.download !== '1' && ['image', 'video', 'audio', 'pdf'].includes(previewKind);
    res.setHeader('Content-Disposition', `${canOpenDirectly ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.sendFile(resolvedPath);
  } catch (e) {
    return res.status(500).send(e.message);
  }
});

router.get('/evaluacion/evidencias/:id/preview', requireStudentEvidenceFileAccess, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).send('Evidencia no encontrada.');
    const resolvedPath = resolveEvidenceFilePath(row);
    if (!resolvedPath) return res.status(404).send('El archivo no existe en la carpeta de almacenamiento.');
    const fileName = row.file_name || path.basename(resolvedPath);
    if (!canPreviewEvidence(fileName, row.file_type)) return res.status(415).send('Este formato se descarga y no tiene vista previa.');

    const kind = evidencePreviewKind(fileName, row.file_type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    if (mustUseSandboxedEvidencePreview(fileName, row.file_type)) {
      const sandboxPolicy = kind === 'html'
        ? HTML_EVIDENCE_PREVIEW_POLICY
        : "sandbox; default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; navigate-to 'none'";
      res.setHeader('Content-Security-Policy', sandboxPolicy);
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    }
    if (kind === 'html') res.type('text/html; charset=utf-8');
    else if (kind === 'text') res.type('text/plain; charset=utf-8');
    else if (kind === 'svg') res.type('image/svg+xml');
    else if (row.file_type) res.type(row.file_type);
    return res.sendFile(resolvedPath);
  } catch (error) {
    return res.status(500).send(error.message);
  }
});

router.patch('/evaluacion/evidencias/:id/name', requireLocalTeacherRequest, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'ID inválido.' });
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Evidencia no encontrada.' });
    const requested = path.basename(String(req.body?.name || '')).replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
    const currentExtension = path.extname(String(row.file_name || row.relative_path || '')).slice(0, 16);
    const requestedBase = path.basename(requested, path.extname(requested)).replace(/[. ]+$/g, '').trim().slice(0, 120);
    if (!requestedBase) return res.status(400).json({ success: false, message: 'Escribe un nombre válido para la evidencia.' });
    const fileName = `${requestedBase}${currentExtension}`;
    db.prepare("UPDATE evaluacion_evidencias SET file_name = ?, renamed_by = 'teacher', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(fileName, id);
    const updated = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);
    persistEvidencePortableMetadata(updated);
    return res.json({ success: true, data: mapEvidenceRowFast(updated) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/evaluacion/evidencias/:id/feedback', requireLocalTeacherRequest, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'ID inválido.' });
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, message: 'Evidencia no encontrada.' });
    const teacherComment = String(req.body?.teacherComment || '').trim().slice(0, 4000);
    db.prepare(`
      UPDATE evaluacion_evidencias
      SET teacher_comment = ?, teacher_commented_at = CASE WHEN ? = '' THEN NULL ELSE CURRENT_TIMESTAMP END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(teacherComment, teacherComment, id);
    const updated = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);
    persistEvidencePortableMetadata(updated);
    return res.json({ success: true, data: mapEvidenceRowFast(updated) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/evaluacion/evidencias/:id', requireLocalTeacherRequest, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido.' });
    }
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);
    if (!row) {
      return res.json({ success: true, deleted: 0 });
    }
    const resolvedPathBeforeDelete = resolveEvidenceFilePath(row);
    if (!resolvedPathBeforeDelete && req.query.forceMissing !== 'true') {
      return res.status(409).json({
        success: false,
        code: 'EVIDENCE_FILE_PENDING_RECOVERY',
        message: 'No se puede eliminar la evidencia porque su archivo físico no está disponible.',
      });
    }

    const context = getEvidenceStorageContext();
    if (context.automaticMirror) {
      try {
        const tombstone = writeEvidenceTombstone({ root: context.effectivePath, row });
        if (!tombstone) throw new Error('La evidencia no tiene una identidad portatil valida.');
      } catch (error) {
        return res.status(503).json({
          success: false,
          code: 'EVIDENCE_DELETE_NOT_RECORDED',
          message: `No se pudo registrar el borrado en la carpeta sincronizada: ${error.message}`,
        });
      }
    }

    db.prepare('DELETE FROM evaluacion_evidencias WHERE id = ?').run(id);

    if (resolvedPathBeforeDelete && fs.existsSync(resolvedPathBeforeDelete)) {
      removeEvidenceFileWithOriginals(resolvedPathBeforeDelete);
    }

    return res.json({ success: true, deleted: 1 });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/evaluacion/ventana-entrega/:sessionId', requireLocalTeacherRequest, (req, res) => {
  try {
    const sessionRow = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(String(req.params.sessionId || ''));
    if (!sessionRow) return res.status(404).json({ success: false, message: 'Sesión no encontrada.' });
    const sessionData = JSON.parse(sessionRow.session_data || '{}');
    const section = String(req.query.section || '');
    const explicit = sectionSchedule.explicit(sessionRow.id_sesion, section);
    const automatic = getAutomaticEvidenceWindow(sessionRow, sessionData, section);
    const effective = effectiveSectionWindow(automatic, explicit);
    return res.json({
      success: true,
      data: {
        explicit: explicit || null,
        enabled: explicit ? Number(explicit.enabled) === 1 : true,
        section,
        openAt: effective?.openAt?.toISOString() || '',
        onTimeCloseAt: automatic?.onTimeCloseAt?.toISOString() || '',
        defaultCloseAt: automatic?.closeAt?.toISOString() || '',
        closeAt: effective?.closeAt?.toISOString() || explicit?.close_at || ''
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/evaluacion/ventana-entrega/:sessionId', requireLocalTeacherRequest, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '');
    const sessionRow = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(sessionId);
    if (!sessionRow) return res.status(404).json({ success: false, message: 'Sesión no encontrada.' });
    const sessionData = JSON.parse(sessionRow.session_data || '{}');
    const section = String(req.body?.section || '');
    const taught = splitSessionSections(sessionRow.section);
    if (section && (!splitSessionSections(section).length || splitSessionSections(section).some(item => !taught.includes(item)))) return res.status(400).json({ success: false, message: 'La sección no pertenece a esta sesión.' });
    const automatic = getAutomaticEvidenceWindow(sessionRow, sessionData, section);
    const enabled = req.body?.enabled === false ? 0 : 1;
    const exceptional = req.body?.exceptional === false ? 0 : 1;
    const openFrom = String(req.body?.openFrom || '').trim() || null;
    const closeAt = String(req.body?.closeAt || '').trim() || null;
    const requestedClose = closeAt ? new Date(closeAt) : null;
    if (closeAt && Number.isNaN(requestedClose.getTime())) return res.status(400).json({ success: false, message: 'La fecha de cierre no es válida.' });
    if (requestedClose && !Number.isNaN(requestedClose.getTime())) requestedClose.setSeconds(59, 999);
    if (openFrom && closeAt && new Date(openFrom) > new Date(closeAt)) {
      return res.status(400).json({ success: false, message: 'La fecha de apertura no puede ser posterior al cierre.' });
    }
    if (enabled && automatic && (!requestedClose || Number.isNaN(requestedClose.getTime()) || requestedClose < automatic.closeAt)) {
      return res.status(400).json({ success: false, message: 'La ampliación manual no puede reducir el plazo automático de tres días tardíos.' });
    }
    db.prepare(`
      INSERT INTO evaluacion_ventanas_entrega (session_id, enabled, open_from, close_at, exceptional, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        enabled = excluded.enabled,
        open_from = excluded.open_from,
        close_at = excluded.close_at,
        exceptional = excluded.exceptional,
        updated_at = CURRENT_TIMESTAMP
    `).run(sectionWindowKey(sessionId, section), enabled, automatic?.openAt?.toISOString() || openFrom, requestedClose?.toISOString() || closeAt, exceptional);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/evaluacion/ventana-entrega/:sessionId', requireLocalTeacherRequest, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || ''), section = String(req.query.section || '');
    const key = sectionWindowKey(sessionId, section);
    db.prepare('DELETE FROM evaluacion_ventanas_entrega WHERE session_id = ?').run(key);
    // Resetting B restores B's automatic window even if an older shared
    // exception still applies to A. No other section's override is removed.
    if (key !== sessionId && sectionSchedule.explicit(sessionId, '')) {
      db.prepare('INSERT INTO evaluacion_ventanas_entrega(session_id,enabled,open_from,close_at,exceptional) VALUES(?,1,NULL,NULL,1)').run(key);
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/evaluacion/revision-pendientes/:sessionId', requireLocalTeacherRequest, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '');
    const resolveStudent = evidenceStudentResolverForDatabase(db);
    const evidences = db.prepare('SELECT * FROM evaluacion_evidencias WHERE session_id=? AND COALESCE(is_latest,1)=1').all(sessionId).map(resolveStudent);
    const records = db.prepare('SELECT student_id,criteria_id,level,observation,updated_at FROM evaluacion_registros WHERE session_id=?').all(sessionId);
    const session = db.prepare('SELECT session_data FROM sesiones WHERE id_sesion=?').get(sessionId);
    let sessionData = {};
    try { sessionData = JSON.parse(session?.session_data || '{}'); } catch {}
    const data = buildSessionEvidenceReview({ evidences, records, sessionData });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export { requireStudentEvidenceFileAccess };
export default router;
