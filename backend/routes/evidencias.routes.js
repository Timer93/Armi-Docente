import express from 'express';
import path from 'path';
import fs from 'fs';
import db, { getPortalSessionToken } from '../db.js';
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
} from '../evidenceStorage.js';
import { writeEvidenceTombstone } from '../evidenceMirrorIndex.js';

const router = express.Router();

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
  const { year, areaId, grade, section, bimester, unitNumber, sessionNumber, studentId, criteriaId } = req.query;
  try {
    let sql = 'SELECT * FROM evaluacion_evidencias WHERE 1=1';
    const params = [];
    if (year) { sql += ' AND year = ?'; params.push(year); }
    if (areaId) { sql += ' AND area_id = ?'; params.push(areaId); }
    if (grade) { sql += ' AND grade = ?'; params.push(grade); }
    if (section) { sql += ' AND section = ?'; params.push(section); }
    if (bimester) { sql += ' AND bimester = ?'; params.push(bimester); }
    if (unitNumber) { sql += ' AND unit_number = ?'; params.push(unitNumber); }
    if (sessionNumber) { sql += ' AND session_number = ?'; params.push(sessionNumber); }
    if (studentId) { sql += ' AND student_id = ?'; params.push(String(studentId)); }
    if (criteriaId) { sql += ' AND criteria_id = ?'; params.push(String(criteriaId)); }
    sql += ' ORDER BY updated_at DESC';

    const rows = db.prepare(sql).all(...params).map(mapEvidenceRow);
    res.json({ success: true, data: rows });
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
    const sessionId = `${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`;

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
        try { fs.unlinkSync(previousPath); } catch {}
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

    res.json({
      success: true,
      data: mapEvidenceRow(saved),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/evaluacion/evidencias/:id/file', requireStudentEvidenceFileAccess, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).send('Evidencia no encontrada.');
    const resolvedPath = resolveEvidenceFilePath(row);
    if (!resolvedPath) return res.status(404).send('El archivo no existe en la carpeta de almacenamiento.');
    if (row.file_type) res.type(row.file_type);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || path.basename(resolvedPath))}`);
    return res.sendFile(resolvedPath);
  } catch (e) {
    return res.status(500).send(e.message);
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

    db.prepare('DELETE FROM evaluacion_evidencias WHERE id = ?').run(id);

    if (resolvedPathBeforeDelete && fs.existsSync(resolvedPathBeforeDelete)) {
      try { fs.unlinkSync(resolvedPathBeforeDelete); } catch {}
    }

    const context = getEvidenceStorageContext();
    if (context.automaticMirror) {
      try { writeEvidenceTombstone({ root: context.effectivePath, row }); } catch {}
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
    const explicit = db.prepare('SELECT * FROM evaluacion_ventanas_entrega WHERE session_id = ?').get(sessionRow.id_sesion);
    return res.json({ success: true, data: { explicit: explicit || null } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/evaluacion/ventana-entrega/:sessionId', requireLocalTeacherRequest, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '');
    const sessionRow = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(sessionId);
    if (!sessionRow) return res.status(404).json({ success: false, message: 'Sesión no encontrada.' });
    const enabled = req.body?.enabled === false ? 0 : 1;
    const exceptional = req.body?.exceptional === false ? 0 : 1;
    const openFrom = String(req.body?.openFrom || '').trim() || null;
    const closeAt = String(req.body?.closeAt || '').trim() || null;
    if (openFrom && closeAt && new Date(openFrom) > new Date(closeAt)) {
      return res.status(400).json({ success: false, message: 'La fecha de apertura no puede ser posterior al cierre.' });
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
    `).run(sessionId, enabled, openFrom, closeAt, exceptional);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/evaluacion/ventana-entrega/:sessionId', requireLocalTeacherRequest, (req, res) => {
  try {
    db.prepare('DELETE FROM evaluacion_ventanas_entrega WHERE session_id = ?').run(String(req.params.sessionId || ''));
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/evaluacion/revision-pendientes/:sessionId', requireLocalTeacherRequest, (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '');
    const submissions = db.prepare(`
      SELECT student_id, MAX(COALESCE(submitted_at, updated_at)) AS latest_submission
      FROM evaluacion_evidencias
      WHERE session_id = ? AND source = 'student_portal' AND is_latest = 1
      GROUP BY student_id
    `).all(sessionId);
    const reviewedStatement = db.prepare(`
      SELECT MAX(updated_at) AS reviewed_at
      FROM evaluacion_registros
      WHERE session_id = ? AND student_id = ?
        AND (TRIM(COALESCE(level, '')) <> '' OR TRIM(COALESCE(observation, '')) <> '')
    `);
    const data = submissions.map((submission) => {
      const reviewedAt = reviewedStatement.get(sessionId, String(submission.student_id))?.reviewed_at || '';
      const submittedTime = Date.parse(String(submission.latest_submission || '').replace(' ', 'T') + 'Z') || 0;
      const reviewedTime = Date.parse(String(reviewedAt || '').replace(' ', 'T') + 'Z') || 0;
      return {
        studentId: String(submission.student_id),
        latestSubmissionAt: submission.latest_submission || '',
        reviewedAt,
        pending: !reviewedTime || submittedTime > reviewedTime,
      };
    });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export { requireStudentEvidenceFileAccess };
export default router;
