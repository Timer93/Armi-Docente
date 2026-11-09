import { createSectionSessionSchedule } from '../sectionSessionSchedule.js';
import { createEvidenceTemplateRoutes } from './evidenceTemplates.routes.js';
import { automaticSectionWindow, effectiveSectionWindow,splitSessionSections } from '../shared/sectionSessionDates.js';
import {templateScheduleState} from '../evidenceTemplateSchedule.js';
import express from 'express';
import { buildStudentGradebook, resolveStudentGradingMode } from '../studentGradebook.js';
import { teacherGradeRecords } from '../shared/teacherGradeSource.js';
import { resolveSessionCriterionRows } from '../shared/sessionCriterionIdentity.js';
import { numericScoreToRegisterLevel } from '../shared/registerAggregation.generated.js';
import { getPortalRequestedEvidences, readRequestedEvidence, resolvePortalRequestedEvidence } from '../shared/portalRequestedEvidences.js';
import { createStudentJournalRoutes } from './studentJournal.routes.js';
import { createStudentTeacherMessageRoutes } from './studentTeacherMessages.routes.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import db, {
  getPortalSessionToken,
  setPortalSessionToken,
  touchPortalSessionToken,
  deletePortalSessionToken,
  cleanupExpiredPortalSessions,
  ensureSyncChangeTracking,
} from '../db.js';
import { appRoot, uploadsRoot, tempRoot, ensureDir } from '../paths.js';
import {
  saveEvidenceTempFile,
  saveEvidenceDataUrl,
  uploadEvidenceMiddleware,
  resolveEvidenceFilePath,
  mapEvidenceRow,
  persistEvidencePortableMetadata,
  getEvidenceStorageRoot,
  requireLocalTeacherRequest,
  removeEvidenceFileWithOriginals,
} from '../evidenceStorage.js';
import { disconnectStudentPresence, touchStudentPresence, getStudentPresenceSummary } from '../remote-access/studentPresenceService.js';
import { getRemoteAccessDeadline } from '../remote-access/remoteAccessService.js';
import { ensureSessionResourceVariantLinks } from '../sessionResourceStorage.js';
import {
  assembleResumableUpload,
  cancelResumableUpload,
  completeResumableUpload,
  getResumableUploadStatus,
  initializeResumableUpload,
  receiveUploadChunk,
  UPLOAD_CONFIG,
} from '../remote-access/resumableUploadService.js';
import { streamPortfolioPdf, streamPortfolioZip } from '../studentPortfolio.js';
import { ensureMirrorResourceAvailable } from '../sync.js';
import { encryptStudentPassword } from '../studentPasswordVault.js';
import { EVIDENCE_EXTENSION_SET } from '../evidenceFormats.js';
import {
  levelFromScore,
  normalizeInteractiveResult,
  sandboxInteractiveHtml,
  validateStoredInteractiveActivity,
} from '../interactiveHtml.js';
import { createInteractiveAttemptStore, isMobilePracticeDevice } from '../interactiveAttemptStore.js';
import { supportsPracticeRecovery } from '../interactivePracticeRuntime.js';
import { createStudentForumRoutes } from './studentForum.routes.js';
import { readPracticeImages, bindPracticeImages, practiceImagesRoot } from '../interactiveImageLibrary.js';

const router = express.Router();
const practiceAttempts = createInteractiveAttemptStore(db);
router.get('/interactive-images', requireLocalTeacherRequest, async (_req, res) => {
  try {
    const library = await readPracticeImages();
    res.json({ success: true, data: { folder: library.folder, images: library.images.map(({ name, key }) => ({ name, key })), warnings: library.warnings } });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
});
router.post('/interactive-images/bind', requireLocalTeacherRequest, async (req, res) => {
  try {
    if (!validateStoredInteractiveActivity({ id: 'import', enabled: true, criterionId: 'import', html: req.body.html })) throw new Error('El HTML no cumple el contrato ARMI.');
    const data = await bindPracticeImages(req.body.html);
    res.json({ success: true, data });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
});
router.post('/interactive-images', requireLocalTeacherRequest, async (req, res) => {
  try {
    const name = String(req.body.name || '');
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*\.(jpg|jpeg|png|gif|svg|webp)$/iu.test(name)) throw new Error('Usa un nombre descriptivo sin espacios y un formato admitido.');
    const encoded = String(req.body.dataUrl || '').match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i)?.[1];
    if (!encoded || encoded.length > 2_800_000) throw new Error('Imagen inválida o mayor de 2 MB.');
    ensureDir(practiceImagesRoot);
    // Validate in isolation before modifying the user's library.
    const temp = fs.mkdtempSync(path.join(tempRoot, 'practice-image-'));
    try {
      fs.writeFileSync(path.join(temp, name), Buffer.from(encoded, 'base64'));
      const checked = await readPracticeImages(temp);
      if (!checked.images.length) throw new Error(checked.warnings.join(' '));
      const target = path.join(practiceImagesRoot, name);
      if (fs.existsSync(target)) throw new Error('Ya existe una imagen con ese nombre. Usa otro nombre o reemplázala desde la carpeta.');
      const library = await readPracticeImages();
      if (library.images.some((image) => image.key === checked.images[0].key)) throw new Error('Ya existe ese estado con otro formato.');
      fs.copyFileSync(path.join(temp, name), target, fs.constants.COPYFILE_EXCL);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
});
const studentChatUploadsFolder = path.join(uploadsRoot, 'student-chat-local');
ensureDir(studentChatUploadsFolder);
const STUDENT_CHAT_MAX_FILE_SIZE = 15 * 1024 * 1024;

const isPathInside = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveStudentChatFile = (storedPath) => {
  const raw = String(storedPath || '').trim();
  if (!raw) return '';
  const candidates = [
    path.isAbsolute(raw) ? raw : '',
    path.resolve(uploadsRoot, raw),
    path.resolve(appRoot, raw),
  ].filter(Boolean);
  return candidates.find((candidate) => isPathInside(studentChatUploadsFolder, candidate) && fs.existsSync(candidate)) || '';
};

const removeStudentChatFiles = (rows = []) => rows.forEach((row) => {
  const target = resolveStudentChatFile(row.file_path);
  if (!target) return;
  try { fs.rmSync(target, { force: true }); } catch {}
});

const storeStudentChatUpload = async (file, groupId) => {
  if (!file?.path) return { relativePath: '', fileName: '', fileType: '', fileSize: 0 };
  const fileName = path.basename(file.originalname || 'archivo').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180) || 'archivo';
  const fileType = String(file.mimetype || 'application/octet-stream').slice(0, 150);
  const fileSize = Number(file.size || 0);
  if (fileSize > STUDENT_CHAT_MAX_FILE_SIZE) {
    try { await fs.promises.rm(file.path, { force: true }); } catch {}
    const error = new Error('El archivo supera 15 MB.');
    error.statusCode = 413;
    throw error;
  }
  const folder = path.join(studentChatUploadsFolder, String(groupId));
  ensureDir(folder);
  const storedPath = path.join(folder, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`);
  try {
    await fs.promises.copyFile(file.path, storedPath);
  } finally {
    try { await fs.promises.rm(file.path, { force: true }); } catch {}
  }
  return {
    relativePath: path.relative(uploadsRoot, storedPath).replace(/\\/g, '/'),
    fileName,
    fileType,
    fileSize,
  };
};

const streamStudentChatFile = (res, message) => {
  const target = resolveStudentChatFile(message?.file_path);
  if (!target) return res.status(404).json({ success: false, message: 'El archivo ya no esta disponible en esta computadora.' });
  const fileName = path.basename(String(message.file_name || path.basename(target))).replace(/[\r\n"]/g, '_');
  const fileType = String(message.file_type || 'application/octet-stream');
  const canOpenInBrowser = /^(image|audio|video)\//i.test(fileType) || fileType === 'application/pdf' || fileType.startsWith('text/');
  res.setHeader('Content-Type', fileType);
  res.setHeader('Content-Length', fs.statSync(target).size);
  res.setHeader('Content-Disposition', `${canOpenInBrowser ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return fs.createReadStream(target).pipe(res);
};

const deleteStudentChatGroup = (groupId) => {
  removeStudentChatFiles(db.prepare("SELECT file_path FROM student_chat_messages WHERE group_id=? AND file_path<>''").all(groupId));
  db.transaction(() => {
    db.prepare('DELETE FROM student_chat_messages WHERE group_id=?').run(groupId);
    db.prepare('DELETE FROM student_chat_members WHERE group_id=?').run(groupId);
    db.prepare('DELETE FROM student_chat_groups WHERE id=?').run(groupId);
  })();
};

const STUDENT_PORTAL_TOKEN_TTL_MS = 1000 * 60 * 10;
const STUDENT_PORTAL_MAX_SESSIONS = Math.max(200, Number(process.env.ARMI_STUDENT_MAX_SESSIONS) || 500);
const STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION = 10;
const STUDENT_LOGIN_WINDOW_MS = 1000 * 60 * 15;
const STUDENT_LOGIN_DNI_LIMIT = 8;
const STUDENT_LOGIN_ADDRESS_LIMIT = 60;
const studentPortalLoginAttempts = new Map();

const normalizeEvidenceLink = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 1000) { const error = new Error('El enlace es demasiado largo.'); error.statusCode = 400; throw error; }
  let parsed;
  try { parsed = new URL(raw); } catch { const error = new Error('Escribe un enlace completo que empiece con http:// o https://.'); error.statusCode = 400; throw error; }
  if (!['http:', 'https:'].includes(parsed.protocol)) { const error = new Error('El enlace debe empezar con http:// o https://.'); error.statusCode = 400; throw error; }
  return parsed.toString();
};

/* =====================================================
   UTILIDADES DEL PORTAL
===================================================== */

const normalizePortalText = (str) => String(str || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/g, '')
  .trim();

const normalizePortalCriteriaText = (str) => String(str || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stripPortalHtml = (value) => String(value || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();

const splitPortalSections = (value) => String(value || '')
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9\s,/-]/g, ' ')
  .replace(/[,/-]/g, ' ')
  .replace(/\bY\b/g, ' ').split(/\s+/).filter(Boolean);

const portalSectionsOverlap = (left, right) => {
  const a = splitPortalSections(left);
  const b = splitPortalSections(right);
  return a.some((item) => b.includes(item));
};

const getPortalBimester = (unitNumber) => {
  const unit = Number(String(unitNumber || '').replace(/\D+/g, ''));
  if (unit <= 2) return 'I';
  if (unit <= 4) return 'II';
  if (unit <= 6) return 'III';
  return 'IV';
};

const getPortalSummaryId = (sessionData) => {
  const competency = String(sessionData?.competenciaPrio?.comp || '').trim();
  return competency ? `summary::primary::${normalizePortalCriteriaText(competency)}` : '';
};

const parsePortalDate = (value, endOfDay = false) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const localDateMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  const normalized = localDateMatch
    ? `${localDateMatch[3]}-${String(localDateMatch[2]).padStart(2, '0')}-${String(localDateMatch[1]).padStart(2, '0')}T${endOfDay ? '23:59:59' : '00:00:00'}`
    : /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? `${raw}T${endOfDay ? '23:59:59' : '00:00:00'}`
      : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getPortalDateKey = (value) => {
  const parsed = parsePortalDate(value);
  if (!parsed) return '';
  return [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, '0'), String(parsed.getDate()).padStart(2, '0')].join('-');
};

const sectionSchedule = createSectionSessionSchedule(db);
const getPortalStudentSessionDateValues = (sessionData, row, studentSection = '') => sectionSchedule.dates(row, sessionData, studentSection);
const getPortalSessionDateKeys = (sessionData, row, studentSection = '') => (
  [...new Set(getPortalStudentSessionDateValues(sessionData, row, studentSection).map(getPortalDateKey).filter(Boolean))]
);

const getPortalWeekRange = (reference = new Date()) => {
  const start = new Date(reference);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const getPortalDeliveryWindow = (sessionRow, sessionData, now = new Date(), studentSection = '') => {
  const explicit = sectionSchedule.explicit(sessionRow.id_sesion, studentSection);
  const { start: weekStart, end: weekEnd } = getPortalWeekRange(now);
  const dates = getPortalStudentSessionDateValues(sessionData, sessionRow, studentSection);
  const sessionDate = parsePortalDate(dates[0]);
  const automatic = automaticSectionWindow(dates) || automaticSectionWindow([getPortalDateKey(weekStart)]);
  const effective = effectiveSectionWindow(automatic, explicit);
  const openAt = effective.openAt, onTimeClose = automatic.onTimeCloseAt;
  const defaultClose = automatic.closeAt, closeAt = effective.closeAt;
  const inCurrentWeek = !!sessionDate && sessionDate >= weekStart && sessionDate <= weekEnd;
  const explicitlyEnabled = explicit ? Number(explicit.enabled) === 1 : false;
  const available = explicit
    ? explicitlyEnabled && now >= openAt && now <= closeAt
    : now >= openAt && now <= closeAt;
  const phase = now < openAt
    ? 'upcoming'
    : now <= onTimeClose
      ? 'on_time'
      : now <= closeAt
        ? 'late'
        : 'closed';
  return {
    configured: !!explicit,
    exceptional: Number(explicit?.exceptional || 0) === 1,
    enabled: explicit ? explicitlyEnabled : available,
    available,
    inCurrentWeek,
    openAt: openAt.toISOString(),
    onTimeCloseAt: onTimeClose.toISOString(),
    defaultCloseAt: defaultClose.toISOString(),
    closeAt: closeAt.toISOString(),
    phase,
    isBeforeOpen: now < openAt,
    isClosed: now > closeAt || (explicit && !explicitlyEnabled)
  };
};

const portalLevelCode = (value) => {
  const level = normalizePortalText(value);
  if (level === 'c' || level.includes('inicio') || level.includes('deficiente')) return 'c';
  if (level === 'b' || level.includes('proceso') || level.includes('regular')) return 'b';
  if (level === 'ad' || level.includes('destacad') || level.includes('muy bueno')) return 'ad';
  if (level === 'a' || level.includes('lograd') || level.includes('bueno')) return 'a';
  return '';
};

const getPortalFeedback = (sessionRow, studentId, sessionData, recordsOverride = null) => {
  const storedRecords = teacherGradeRecords(recordsOverride ?? db.prepare(`
    SELECT * FROM evaluacion_registros
    WHERE student_id = ? AND session_id = ?
    ORDER BY updated_at DESC
  `).all(String(studentId), String(sessionRow.id_sesion)));
  const mode = resolveStudentGradingMode({
    modes: db.prepare('SELECT * FROM evaluacion_modos_calificacion WHERE year=? ORDER BY updated_at DESC').all(String(sessionRow.year)),
    areaId: sessionRow.area_id, grade: sessionRow.grade, section: sessionRow.section,
    defaultMode: db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_active_grading_mode_v1'").get()?.value,
    sectionsOverlap: portalSectionsOverlap,
  });
  const scopedRounding = sessionData?.numericAverageRounding === 'nearest_integer' && (recordsOverride
    ? recordsOverride.some(record=>record.grading_mode==='hybrid_vigesimal')
    : db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_active_grading_mode_v1'").get()?.value==='hybrid_vigesimal');
  const records = storedRecords.filter(record=>(record.grading_mode || 'literal_traditional')===mode);
  const scoreForLevel = score => scopedRounding && Number.isFinite(score) ? Math.round(score) : score;
  const storedRows = Array.isArray(sessionData?.sessionAssessmentModel?.rows)
    ? sessionData.sessionAssessmentModel.rows
    : [];
  const instrumentRows = Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : [];
  const rows = resolveSessionCriterionRows(sessionData, storedRows.length ? storedRows : instrumentRows.map(row=>({
    id:row.id,source:row.source || 'primary',competencyName:row.competencia,capacityName:row.capacidad,criterionText:row.criterio
  })));
  const instrumentRowById = new Map(instrumentRows.map((row) => [String(row?.id || ''), row]));
  const summary = records.find((record) => String(record.criteria_id || '').startsWith('summary::primary::'));
  const criteria = rows
    .map(row=>({row,record:row.recordIds.map(id=>records.find(record=>String(record.criteria_id)===id)).find(Boolean)}))
    .filter(item=>item.record)
    .map(({record,row}) => {
      const code = portalLevelCode(record.level);
      const instrumentRow = instrumentRowById.get(String(record.criteria_id || ''));
      return {
        criteriaId: record.criteria_id,
        criterion: String(row?.criterionText || `Criterio ${record.criteria_id}`),
        source: String(row?.source || 'primary'),
        competencyName: String(row?.competencyName || sessionData?.competenciaPrio?.comp || ''),
        capacityName: String(row?.capacityName || ''),
        level: record.level || '',
        numericScore: Number.isFinite(Number(record.numeric_score)) && record.numeric_score !== null
          ? Number(record.numeric_score)
          : null,
        descriptor: String(row?.levelDescriptors?.[code] || instrumentRow?.[code] || ''),
        observation: record.observation || ''
      };
    })
    .filter((item) => item.level || item.observation || Number.isFinite(item.numericScore));
  const primaryCriteria = criteria.filter((item) => item.source !== 'transversal');
  const levelCodes = primaryCriteria.map((item) => portalLevelCode(item.level)).filter(Boolean);
  const levelWeights = { c: 1, b: 2, a: 3, ad: 4 };
  const orderedLevels = levelCodes
    .map((code) => levelWeights[code])
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const middle = Math.floor(orderedLevels.length / 2);
  const medianLevel = orderedLevels.length
    ? (orderedLevels.length % 2 ? orderedLevels[middle] : Math.round((orderedLevels[middle - 1] + orderedLevels[middle]) / 2))
    : null;
  const aggregateCode = Object.entries(levelWeights).find(([, weight]) => weight === medianLevel)?.[0] || '';
  const summaryCode = portalLevelCode(summary?.level);
  const summaryNumeric = summary?.numeric_score === null || summary?.numeric_score === undefined
    ? null
    : Number(summary.numeric_score);
  const criteriaNumeric = primaryCriteria.map((item) => item.numericScore).filter(Number.isFinite);
  const numericScore = Number.isFinite(summaryNumeric)
    ? summaryNumeric
    : (criteriaNumeric.length ? criteriaNumeric.reduce((sum, value) => sum + value, 0) / criteriaNumeric.length : null);
  const literalGrade = String(scopedRounding && Number.isFinite(numericScore) ? numericScoreToRegisterLevel(scoreForLevel(numericScore)) : summaryCode || aggregateCode || '').toUpperCase();
  const conclusions = db.prepare(`
    SELECT conclusion_text, section FROM evaluacion_conclusiones
    WHERE student_id = ? AND year = ? AND area_id = ? AND grade = ?
      AND scope_type = 'session'
      AND (scope_value = ? OR scope_value = ?)
    ORDER BY updated_at DESC
  `).all(
    String(studentId), String(sessionRow.year), String(sessionRow.area_id),
    String(sessionRow.grade), String(sessionRow.id_sesion),
    String(sessionRow.session_number)
  ).filter((item) => !item.section || portalSectionsOverlap(item.section, sessionRow.section))
    .map((item) => String(item.conclusion_text || '').trim()).filter(Boolean);
  const buildTransversalFeedback = (competencyName) => {
    const normalizedName = normalizePortalCriteriaText(competencyName);
    const competencySummary = records.find((record) => (
      String(record.criteria_id || '') === `summary::transversal::${normalizedName}`
    ));
    const competencyCriteria = criteria.filter((item) => (
      item.source === 'transversal'
      && normalizePortalCriteriaText(item.competencyName) === normalizedName
    ));
    const codes = competencyCriteria.map((item) => portalLevelCode(item.level)).filter(Boolean);
    const weights = codes.map((code) => levelWeights[code]).filter(Number.isFinite).sort((left, right) => left - right);
    const center = Math.floor(weights.length / 2);
    const median = weights.length
      ? (weights.length % 2 ? weights[center] : Math.round((weights[center - 1] + weights[center]) / 2))
      : null;
    const aggregate = Object.entries(levelWeights).find(([, weight]) => weight === median)?.[0] || '';
    const summaryLevel = portalLevelCode(competencySummary?.level);
    const summaryScore = competencySummary?.numeric_score === null || competencySummary?.numeric_score === undefined
      ? null
      : Number(competencySummary.numeric_score);
    const numericValues = competencyCriteria.map((item) => item.numericScore).filter(Number.isFinite);
    const competencyNumeric = Number.isFinite(summaryScore)
      ? summaryScore
      : (numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length : null);
    return {
      name: competencyName,
      reviewed: !!(
        String(competencySummary?.level || '').trim()
        || String(competencySummary?.observation || '').trim()
        || Number.isFinite(summaryScore)
        || competencyCriteria.length
      ),
      level: competencySummary?.level || '',
      literalGrade: String(scopedRounding && Number.isFinite(competencyNumeric) ? numericScoreToRegisterLevel(scoreForLevel(competencyNumeric)) : summaryLevel || aggregate || '').toUpperCase(),
      numericScore: competencyNumeric,
      observation: competencySummary?.observation || '',
      criteria: competencyCriteria,
      reviewedAt: competencySummary?.updated_at || ''
    };
  };
  const transversalNames = [...new Set(rows
    .filter((row) => String(row?.source || '') === 'transversal')
    .map((row) => String(row?.competencyName || '').trim())
    .filter(Boolean))];
  (Array.isArray(sessionData?.competenciasTrans) ? sessionData.competenciasTrans : []).forEach((item) => {
    const name = String(item?.comp || '').trim();
    if (name && !transversalNames.some((current) => normalizePortalCriteriaText(current) === normalizePortalCriteriaText(name))) {
      transversalNames.push(name);
    }
  });
  const transversalCompetencies = transversalNames.map(buildTransversalFeedback);
  return {
    reviewed: !!(
      String(summary?.level || '').trim()
      || String(summary?.observation || '').trim()
      || (summary?.numeric_score !== null && summary?.numeric_score !== undefined && Number.isFinite(Number(summary.numeric_score)))
      || primaryCriteria.length > 0
      || conclusions.length > 0
    ),
    level: summary?.level || '',
    competencyName: String(sessionData?.competenciaPrio?.comp || primaryCriteria[0]?.competencyName || '').trim(),
    literalGrade,
    numericScore,
    observation: summary?.observation || '',
    criteria: primaryCriteria,
    conclusions,
    reviewedAt: summary?.updated_at || records[0]?.updated_at || '',
    transversalCompetencies
  };
};

const getPortalSubmissionState = (sessionRow, studentId, sessionData, deliveryWindow) => {
  const evidences = db.prepare(`
    SELECT * FROM evaluacion_evidencias
    WHERE student_id = ? AND session_id = ? AND is_latest = 1
    ORDER BY COALESCE(submitted_at, updated_at) DESC
  `).all(String(studentId), String(sessionRow.id_sesion));
  const studentEvidenceCount = evidences.filter((item) => ['student_portal', 'evidence_template'].includes(String(item.source || ''))).length;
  const feedback = getPortalFeedback(sessionRow, studentId, sessionData);
  const latestSubmittedAt = evidences[0]?.submitted_at || evidences[0]?.updated_at || '';
  const submittedDate = parsePortalDate(latestSubmittedAt);
  const late = !!submittedDate && submittedDate > new Date(deliveryWindow.onTimeCloseAt || deliveryWindow.closeAt);
  let status = 'pending';
  if (feedback.reviewed) status = 'reviewed';
  else if (evidences.length) status = late ? 'delivered_late' : 'delivered';
  else if (deliveryWindow.isClosed) status = 'not_submitted';
  else if (deliveryWindow.isBeforeOpen) status = 'upcoming';
  return { status, late, evidenceCount: evidences.length, studentEvidenceCount, latestSubmittedAt, feedback };
};

const getPortalToken = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

const getStudentRequestAddress = (req) => {
  const cloudflareAddress = String(req.headers['cf-connecting-ip'] || '').trim();
  const forwardedAddress = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (cloudflareAddress || forwardedAddress || req.socket?.remoteAddress || 'unknown').slice(0, 128);
};

const studentLoginAttemptKey = (kind, value) => `${kind}:${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;

const readStudentLoginAttempt = (key, now = Date.now()) => {
  const entry = studentPortalLoginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    if (entry) studentPortalLoginAttempts.delete(key);
    return null;
  }
  return entry;
};

const registerStudentLoginFailure = (key, now = Date.now()) => {
  const current = readStudentLoginAttempt(key, now);
  const next = current
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt: now + STUDENT_LOGIN_WINDOW_MS };
  studentPortalLoginAttempts.set(key, next);
  return next;
};

const getStudentLoginBlock = (dniKey, addressKey, now = Date.now()) => {
  const dniAttempt = readStudentLoginAttempt(dniKey, now);
  const addressAttempt = readStudentLoginAttempt(addressKey, now);
  const blockedAttempt = dniAttempt?.count >= STUDENT_LOGIN_DNI_LIMIT
    ? dniAttempt
    : addressAttempt?.count >= STUDENT_LOGIN_ADDRESS_LIMIT
      ? addressAttempt
      : null;
  if (!blockedAttempt) return null;
  return { retryAfter: Math.max(1, Math.ceil((blockedAttempt.resetAt - now) / 1000)) };
};

const hashStudentPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
};

const verifyStudentPassword = (password, storedHash) => {
  const [salt, expectedHex] = String(storedHash || '').split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const normalizePortalBirthDate = (value) => {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const calculatePortalAge = (birthDate) => {
  const normalized = normalizePortalBirthDate(birthDate);
  if (!normalized) return null;
  const birth = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

const daysUntilBirthday = (birthDate) => {
  const normalized = normalizePortalBirthDate(birthDate);
  if (!normalized) return null;
  const [, month, day] = normalized.split('-').map(Number);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < start) next = new Date(today.getFullYear() + 1, month - 1, day);
  return Math.round((next.getTime() - start.getTime()) / 86_400_000);
};

const isValidOptionalEmail = (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const mapPortalStudent = (student) => {
  const face = db.prepare(`SELECT image_data FROM asistencia_rostros WHERE student_id = ? ORDER BY CASE WHEN source = 'student_profile_front' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).get(String(student.id));
  const teacherName = String(db.prepare('SELECT teacher FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.teacher || 'tu profesor/a').trim();
  const birthDate = normalizePortalBirthDate(student.fecha_nacimiento);
  const birthdayDays = daysUntilBirthday(birthDate);
  return {
    id: student.id,
    name: student.estudiantes,
    grade: student.grado,
    section: student.secc,
    group: String(student.grupo || '').trim(),
    email: student.gmail || '',
    microsoft: student.outlook || '',
    birthDate,
    age: calculatePortalAge(birthDate) ?? student.edad ?? null,
    birthday: birthdayDays === 0 ? {
      isToday: true,
      teacherName,
      message: `Hoy celebramos tu día y todo lo genial que eres. Me alegra acompañarte en este camino de aprender y crecer. Que esta nueva vuelta al sol venga llena de aprendizajes, risas, metas cumplidas y muchas notas de 20/20. Con mucho cariño, tu profesor ${teacherName}.`,
    } : null,
    notificationsEnabled: true,
    profilePhoto: face?.image_data || '',
  };
};

export const requireStudentPortalAuth = (req, res, next) => {
  const token = getPortalToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Falta el token de autenticación.' });
  }

  const session = getPortalSessionToken(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) deletePortalSessionToken(token);
    return res.status(401).json({ success: false, message: 'La sesión venció. Ingresa nuevamente con tu DNI.' });
  }

  touchPortalSessionToken(token, STUDENT_PORTAL_TOKEN_TTL_MS);
  req.studentPortal = session;
  req.studentPortalToken = token;
  touchStudentPresence({
    token,
    studentId: session.studentId,
    activity: req.body?.currentActivity,
    uploadStatus: req.body?.uploadStatus,
    source: req.headers['cf-ray'] || req.headers['cf-connecting-ip'] ? 'remote' : 'lan',
  });

  const passwordChangeAllowed = ['/change-password', '/logout', '/ping'].some((suffix) => req.path.endsWith(suffix));
  if (session.mustChangePassword && !passwordChangeAllowed) {
    return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Cambia la contraseña inicial antes de continuar.' });
  }
  return next();
};

const getPortalSessionForStudent = (sessionId, student) => {
  const row = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(String(sessionId || ''));
  if (!row) return null;
  const sameGrade = normalizePortalText(row.grade) === normalizePortalText(student.grado);
  const sameSection = portalSectionsOverlap(row.section, student.secc);
  return sameGrade && sameSection ? row : null;
};

const PORTAL_RESOURCE_DEFINITIONS = {
  instructive: { title: 'Instructivo informativo', typeLabel: 'Instructivo' },
  annex1: { title: 'Anexo 1 · Motivación', typeLabel: 'Motivación' },
  annex2: { title: 'Anexo 2 · Evidencia', typeLabel: 'Actividad' },
};

const normalizePortalExternalUrl = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
};

const mapPortalEvidenceTemplates=(row,data,studentSection)=>{
  const section=splitSessionSections(studentSection)[0] || '',automatic=sectionSchedule.windows(row,data,section);
  const requested=new Set(getPortalRequestedEvidences(data).map(e=>e.id));
  return db.prepare('SELECT id,evidence_id,mode,requested_json,close_overrides FROM evidence_templates WHERE session_id=? AND enabled=1').all(String(row.id_sesion)).filter(t=>requested.has(t.evidence_id)).map(t=>{
    const override=JSON.parse(t.close_overrides || '{}')[section];
    return {id:t.id,evidence_id:t.evidence_id,mode:t.mode,requested:JSON.parse(t.requested_json),window:templateScheduleState(override?[override]:automatic)};
  });
};
const mapPortalLearningResources = (row, sessionData, studentSection='', publishedTemplates=null) => {
  const visualResources = Object.entries(PORTAL_RESOURCE_DEFINITIONS).map(([key, definition]) => {
    const resource = sessionData?.learningResources?.[key] || {};
    const hasImage = Boolean(String(resource.imageUrl || '').trim());
    const externalUrl = normalizePortalExternalUrl(resource.metadata?.url);
    return {
      key,
      title: String(resource.title || definition.title),
      typeLabel: definition.typeLabel,
      kind: String(resource.kind || ''),
      imageUrl: hasImage
        ? `/api/student-portal/session-resources/${encodeURIComponent(String(row.id_sesion))}/${key}`
        : '',
      externalUrl,
    };
  }).filter((resource) => resource.imageUrl || resource.externalUrl);
  const interactiveResources = (Array.isArray(sessionData?.interactiveActivities) ? sessionData.interactiveActivities : [])
    .filter(validateStoredInteractiveActivity)
    .map((activity) => ({
      key: `interactive-${activity.id}`,
      title: String(activity.title || 'Actividad HTML interactiva'),
      typeLabel: 'Juego interactivo',
      kind: 'interactive_html',
      imageUrl: '',
      externalUrl: `armi-activity:${encodeURIComponent(String(row.id_sesion))}:${encodeURIComponent(String(activity.id))}`,
    }));
  const templates = (publishedTemplates || mapPortalEvidenceTemplates(row,sessionData,studentSection))
    .map(t=>({key:`template-${t.id}`,title:t.requested.text,typeLabel:`Plantilla de evidencia${t.window.status==='open'?' · En horario de clase':t.window.status==='upcoming'?' · Programada':t.window.status==='closed'?' · Horario finalizado':' · Horario pendiente'}`,kind:'evidence_template',imageUrl:'',externalUrl:`armi-template:${encodeURIComponent(String(row.id_sesion))}:${encodeURIComponent(t.id)}`}));
  return [...visualResources, ...interactiveResources, ...templates];
};

const getPortalAreaName = (row) => {
  const sessionArea = String(row?.area_curricular || '').trim();
  if (sessionArea) return sessionArea;
  const program = db.prepare(`
    SELECT area_curricular FROM programacion_anual
    WHERE CAST(area_id AS TEXT) = ?
      AND TRIM(grade) = TRIM(?) AND TRIM(section) = TRIM(?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(String(row?.area_id || ''), row?.grade, row?.section);
  if (String(program?.area_curricular || '').trim()) return String(program.area_curricular).trim();
  const fallbackProgram = db.prepare(`
    SELECT area_curricular FROM programacion_anual
    WHERE CAST(area_id AS TEXT) = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(String(row?.area_id || ''));
  if (String(fallbackProgram?.area_curricular || '').trim()) return String(fallbackProgram.area_curricular).trim();
  const catalogArea = db.prepare('SELECT area FROM db_areas WHERE CAST(id AS TEXT) = ?').get(String(row?.area_id || ''));
  return String(catalogArea?.area || row?.area_id || 'Área').trim();
};

const getPortalUnitInfo = (row) => {
  const unit = db.prepare(`
    SELECT title, purpose FROM unidades_didacticas
    WHERE CAST(year AS TEXT) = CAST(? AS TEXT)
      AND CAST(area_id AS TEXT) = ?
      AND TRIM(grade) = TRIM(?) AND TRIM(section) = TRIM(?)
      AND CAST(unit_number AS TEXT) = CAST(? AS TEXT)
    ORDER BY updated_at DESC LIMIT 1
  `).get(String(row?.year || ''), String(row?.area_id || ''), row?.grade, row?.section, String(row?.unit_number || ''));
  return {
    title: String(unit?.title || row?.titulo_de_unidad || `Unidad ${row?.unit_number || ''}`).trim(),
    purpose: stripPortalHtml(unit?.purpose || ''),
  };
};

const getStudentPortfolioRows = (studentId) => db.prepare(`
  SELECT e.*, s.session_data
  FROM evaluacion_evidencias e
  LEFT JOIN sesiones s ON s.id_sesion = e.session_id
  WHERE e.student_id = ? AND e.is_latest = 1
  ORDER BY CAST(e.unit_number AS INTEGER), CAST(e.session_number AS INTEGER), COALESCE(e.submitted_at, e.updated_at), e.id
`).all(String(studentId)).map((row) => {
  let sessionData = {};
  try { sessionData = JSON.parse(row.session_data || '{}'); } catch {}
  return { ...row, session_title: String(sessionData?.title || 'Sesión de aprendizaje') };
});

const parseDataUrlImage = (value) => {
  const match = String(value || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
};

/* =====================================================
   RUTAS DEL PORTAL ESTUDIANTIL
===================================================== */

router.get('/student-portal/session-resources/:sessionId/:resourceKey', requireStudentPortalAuth, async (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    if (!student) return res.status(401).json({ success: false, message: 'Estudiante no encontrado.' });
    const resourceKey = String(req.params.resourceKey || '');
    if (!PORTAL_RESOURCE_DEFINITIONS[resourceKey]) return res.status(404).send('Recurso no encontrado.');
    const row = getPortalSessionForStudent(req.params.sessionId, student);
    if (!row) return res.status(404).send('Recurso no encontrado.');
    let sessionData = {};
    try { sessionData = JSON.parse(row.session_data || '{}'); } catch {}
    const repairedResources = await ensureSessionResourceVariantLinks({
      sessionData,
      sessionId: row.id_sesion,
      uploadsRoot,
    });
    sessionData = repairedResources.sessionData;
    if (repairedResources.changed) {
      db.prepare('UPDATE sesiones SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id_sesion = ?')
        .run(JSON.stringify(sessionData), row.id_sesion);
    }
    const resource = sessionData?.learningResources?.[resourceKey] || {};
    const imageUrl = String(resource.imageUrl || '').trim();
    if (!imageUrl) return res.status(404).send('Este recurso no tiene un archivo visual.');

    const dataImage = parseDataUrlImage(imageUrl);
    if (dataImage) {
      res.type(dataImage.mimeType);
      return res.send(Buffer.from(dataImage.base64, 'base64'));
    }

    const cleanUrlPath = decodeURIComponent(imageUrl.split(/[?#]/)[0]).replace(/\\/g, '/');
    if (!cleanUrlPath.startsWith('/uploads/session-resources/')) {
      return res.status(404).send('La ruta del recurso no es válida.');
    }
    const relativeToUploads = cleanUrlPath.replace(/^\/uploads\//, '');
    const absolutePath = path.resolve(uploadsRoot, relativeToUploads);
    const pathCheck = path.relative(uploadsRoot, absolutePath);
    if (pathCheck.startsWith('..') || path.isAbsolute(pathCheck)) {
      return res.status(404).send('La ruta del recurso no es válida.');
    }
    const delivery = await ensureMirrorResourceAvailable(cleanUrlPath.replace(/^\//, ''));
    if (!delivery.success && delivery.code !== 'unknown-resource') {
      res.setHeader('Retry-After', '5');
      return res.status(503).json(delivery);
    }
    if (!fs.existsSync(absolutePath)) return res.status(404).send('El recurso todavía no está disponible en esta PC.');
    res.type(path.extname(absolutePath));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absolutePath))}`);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'No se pudo abrir el recurso.' });
  }
});

const getInteractiveActivityForStudent = (sessionId, activityId, student) => {
  const row = getPortalSessionForStudent(sessionId, student);
  if (!row) return null;
  let sessionData = {};
  try { sessionData = JSON.parse(row.session_data || '{}'); } catch { return null; }
  const activity = (Array.isArray(sessionData?.interactiveActivities) ? sessionData.interactiveActivities : [])
    .find((item) => String(item?.id || '') === String(activityId || ''));
  if (!validateStoredInteractiveActivity(activity)) return null;
  const criterion = (Array.isArray(sessionData?.sessionAssessmentModel?.rows) ? sessionData.sessionAssessmentModel.rows : [])
    .find((item) => String(item?.id || '') === String(activity.criterionId || ''));
  if (!criterion) return null;
  return { row, sessionData, activity, criterion };
};

const getInteractiveActivityForTeacher = (sessionId, activityId) => {
  const row = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(String(sessionId || ''));
  if (!row) return null;
  let sessionData = {};
  try { sessionData = JSON.parse(row.session_data || '{}'); } catch { return null; }
  const activity = (Array.isArray(sessionData?.interactiveActivities) ? sessionData.interactiveActivities : [])
    .find((item) => String(item?.id || '') === String(activityId || ''));
  if (!activity?.id || !activity?.criterionId) return null;
  const criterion = (Array.isArray(sessionData?.sessionAssessmentModel?.rows) ? sessionData.sessionAssessmentModel.rows : [])
    .find((item) => String(item?.id || '') === String(activity.criterionId || ''));
  return { row, sessionData, activity, criterion: criterion || { id: activity.criterionId } };
};

const isActivePortalStudent = (student) => {
  const status = normalizePortalText(student?.estado);
  return !(status === 'r' || status.includes('retir') || status === 't' || status.includes('traslad'));
};

const studentsForInteractiveSession = (row) => db.prepare('SELECT * FROM db_estudiantes ORDER BY estudiantes COLLATE NOCASE')
  .all()
  .filter((student) => isActivePortalStudent(student)
    && normalizePortalText(student.grado) === normalizePortalText(row.grade)
    && portalSectionsOverlap(student.secc, row.section));

const interactiveActivityMode = (activity) => activity?.mode === 'group' ? 'group' : 'individual';
const parseInteractiveStudentIds = (value) => {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { return []; }
};

const persistInteractiveResult = (found, student, result, existingAttempt, beforeWrite = () => {}) => {
    const sessionId = String(found.row.id_sesion), activityId = String(found.activity.id), criterionId = String(found.criterion.id);
    const mode = interactiveActivityMode(found.activity), groupName = String(student.grupo || '').trim();
    const scopeKey = mode === 'group' ? normalizePortalText(groupName) : String(student.id);
    const participants = mode === 'group' ? studentsForInteractiveSession(found.row).filter((item) => normalizePortalText(item.grupo) === scopeKey) : [student];
    const level = levelFromScore(result.score);
    const protectedCount = participants.filter(participant => teacherGradeRecords(db.prepare(
      'SELECT * FROM evaluacion_registros WHERE student_id=? AND session_id=? AND criteria_id=?'
    ).all(String(participant.id), sessionId, criterionId)).length > 0).length;
    db.transaction(() => {
      beforeWrite();
      db.prepare(`
        INSERT INTO interactive_activity_results
          (session_id, activity_id, scope_type, scope_key, student_id, group_name, student_ids, attempt_number,
           score, level, answers_summary, completed_at, reset_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id, activity_id, scope_type, scope_key) DO UPDATE SET
          student_id = excluded.student_id, group_name = excluded.group_name, student_ids = excluded.student_ids,
          score = excluded.score, level = excluded.level, answers_summary = excluded.answers_summary,
          completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      `).run(sessionId, activityId, mode, scopeKey, mode === 'individual' ? String(student.id) : null,
        mode === 'group' ? groupName : null, JSON.stringify(participants.map((item) => String(item.id))),
        Number(existingAttempt?.attempt_number || 1), result.score, level, result.answersSummary);

    })();
    return { recorded: true, gradeRecorded: false, protectedTeacherGrade: protectedCount > 0, score: result.score, level, mode,
      participantCount: participants.length, gradedCount: 0,
      message: `Resultado de práctica registrado: ${result.score}/20 (${level}). No es una calificación docente.${protectedCount ? ' Se conservaron las calificaciones manuales del docente.' : ''}` };
};

const practiceContext = (req) => {
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  const found = student && getInteractiveActivityForStudent(req.params.sessionId, req.params.activityId, student);
  if (!found) { const error = new Error('La práctica no está disponible para este estudiante.'); error.statusCode = 404; throw error; }
  const mode = interactiveActivityMode(found.activity);
  const scopeKey = mode === 'group' ? normalizePortalText(student.grupo) : String(student.id);
  if (!scopeKey) { const error = new Error('Pide al docente que te asigne a un grupo.'); error.statusCode = 409; throw error; }
  return { found, student, key: { sessionId: String(found.row.id_sesion), activityId: String(found.activity.id), mode, scopeKey } };
};
const previousPracticeResult = (key) => db.prepare('SELECT * FROM interactive_activity_results WHERE session_id=? AND activity_id=? AND scope_type=? AND scope_key=?')
  .get(key.sessionId, key.activityId, key.mode, key.scopeKey);
const settleClosedPractice = ({ found, student, key }) => {
  const row = practiceAttempts.get(key);
  const existing = previousPracticeResult(key);
  if (row && ['expired', 'abandoned'].includes(row.status) && !existing?.completed_at) {
    const checkpoint = JSON.parse(row.checkpoint_json);
    const partial = normalizeInteractiveResult({ type: 'armi:activity-result', version: 1, completed: true,
      score: checkpoint.score, maxScore: checkpoint.maxScore, answersSummary: checkpoint.answersSummary });
    persistInteractiveResult(found, student, { score: partial?.score || 0,
      answersSummary: `${row.status === 'expired' ? 'Tiempo agotado' : 'Salida definitiva'}. ${partial?.answersSummary || 'Se conservó el avance parcial.'}` }, existing);
  }
  return row;
};
const rejectMobilePractice = (req) => {
  if (isMobilePracticeDevice(req.get('user-agent'), req.body?.device || {})) {
    const error = new Error('Esta práctica se resuelve en una computadora del aula. No está habilitada para celulares o tabletas, incluso en modo escritorio.');
    error.statusCode = 403; throw error;
  }
};

router.get('/student-portal/interactive-activities/:sessionId/:activityId', requireStudentPortalAuth, (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    if (!student) return res.status(401).json({ success: false, message: 'Estudiante no encontrado.' });
    const found = getInteractiveActivityForStudent(req.params.sessionId, req.params.activityId, student);
    if (!found) return res.status(404).json({ success: false, message: 'La actividad no existe, no está publicada o dejó de ser compatible.' });
    const context = practiceContext(req);
    const attempt = settleClosedPractice(context);
    const completed = previousPracticeResult(context.key)?.completed_at;
    return res.json({
      success: true,
      data: {
        id: found.activity.id,
        title: found.activity.title,
        mode: interactiveActivityMode(found.activity),
        recoverySupported: supportsPracticeRecovery(found.activity.html),
        attempt: completed && !attempt ? { status: 'completed' } : practiceAttempts.publicState(attempt, ['paused', 'extension_ready'].includes(attempt?.status)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'No se pudo abrir la actividad.' });
  }
});

router.post('/student-portal/interactive-activities/:sessionId/:activityId/attempt', requireStudentPortalAuth, (req, res) => {
  try {
    const context = practiceContext(req), { key, found } = context;
    let attempt;
    const action = String(req.body?.action || 'status');
    if (['start', 'continue'].includes(action)) {
      rejectMobilePractice(req);
      if (previousPracticeResult(key)?.completed_at) throw Object.assign(new Error('Esta práctica ya fue entregada y no puede repetirse.'), { statusCode: 409 });
      if (!supportsPracticeRecovery(found.activity.html)) throw Object.assign(new Error('Este HTML usa el contrato anterior. El docente debe actualizarlo con el nuevo prompt para conservar el avance.'), { statusCode: 409 });
      if (action === 'start') attempt = practiceAttempts.start(key);
      else attempt = db.transaction(() => {
        if (practiceAttempts.get(key)?.status === 'paused') practiceAttempts.grant(key);
        return practiceAttempts.resume(key);
      })();
    } else if (action === 'progress') {
      attempt = practiceAttempts.save(key, req.body?.attemptToken, req.body?.checkpoint);
    } else if (action === 'abandon') {
      attempt = practiceAttempts.abandon(key, req.body?.attemptToken);
      settleClosedPractice(context);
    } else if (action === 'status') {
      const row = settleClosedPractice(context);
      attempt = practiceAttempts.publicState(row, ['paused', 'extension_ready'].includes(row?.status));
    } else return res.status(400).json({ success: false, message: 'Acción de práctica no válida.' });
    return res.json({ success: true, data: { attempt,
      ...(['start', 'continue'].includes(action) ? { html: sandboxInteractiveHtml(found.activity.html, attempt) } : {}) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post('/student-portal/interactive-activities/:sessionId/:activityId/result', requireStudentPortalAuth, (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    if (!student) return res.status(401).json({ success: false, message: 'Estudiante no encontrado.' });
    const found = getInteractiveActivityForStudent(req.params.sessionId, req.params.activityId, student);
    if (!found) return res.status(404).json({ success: false, message: 'La actividad no existe, no está publicada o dejó de ser compatible.' });
    const result = normalizeInteractiveResult(req.body);
    if (!result) return res.status(400).json({ success: false, message: 'El resultado recibido no cumple el contrato ARMI.' });
    rejectMobilePractice(req);

    const sessionId = String(found.row.id_sesion);
    const activityId = String(found.activity.id);
    const criterionId = String(found.criterion.id);
    const mode = interactiveActivityMode(found.activity);
    const groupName = String(student.grupo || '').trim();
    if (mode === 'group' && !groupName) {
      return res.status(409).json({ success: false, message: 'Esta actividad es grupal, pero todavía no perteneces a un grupo. Pide al docente que actualice tu grupo.' });
    }
    const scopeKey = mode === 'group' ? normalizePortalText(groupName) : String(student.id);
    const participants = mode === 'group'
      ? studentsForInteractiveSession(found.row).filter((item) => normalizePortalText(item.grupo) === scopeKey)
      : [student];
    if (!participants.length) return res.status(409).json({ success: false, message: 'No se encontraron integrantes activos para registrar este resultado.' });

    const existingAttempt = db.prepare(`SELECT * FROM interactive_activity_results
      WHERE session_id = ? AND activity_id = ? AND scope_type = ? AND scope_key = ?`)
      .get(sessionId, activityId, mode, scopeKey);
    if (existingAttempt?.completed_at) {
      return res.status(409).json({
        success: false,
        code: 'ACTIVITY_ALREADY_COMPLETED',
        message: mode === 'group'
          ? 'Tu grupo ya completó esta actividad. El docente puede reiniciarla si necesitan otro intento.'
          : 'Ya completaste esta actividad. El docente puede reiniciarla si necesitas otro intento.',
      });
    }

    const key = { sessionId, activityId, mode, scopeKey };
    practiceAttempts.requireRunning(key, req.body?.attemptToken);
    const recorded = persistInteractiveResult(found, student, result, existingAttempt, () => practiceAttempts.complete(key, req.body.attemptToken));
    return res.json({ success: true, data: recorded });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error?.message || 'No se pudo registrar el resultado.' });
  }
});

router.get('/interactive-activities/:sessionId/:activityId/results', requireLocalTeacherRequest, (req, res) => {
  try {
    const found = getInteractiveActivityForTeacher(req.params.sessionId, req.params.activityId);
    if (!found) return res.status(404).json({ success: false, message: 'No se encontró la actividad en la sesión guardada.' });
    const runtimeRows = db.prepare('SELECT * FROM interactive_activity_attempts WHERE session_id=? AND activity_id=?').all(String(found.row.id_sesion), String(found.activity.id));
    const sessionStudents = studentsForInteractiveSession(found.row);
    runtimeRows.forEach((row) => {
      const student = sessionStudents.find((item) => row.scope_type === 'group' ? normalizePortalText(item.grupo) === row.scope_key : String(item.id) === row.scope_key);
      if (student) settleClosedPractice({ found, student, key: { sessionId: row.session_id, activityId: row.activity_id, mode: row.scope_type, scopeKey: row.scope_key } });
    });
    const students = db.prepare('SELECT id, estudiantes FROM db_estudiantes').all();
    const namesById = new Map(students.map((student) => [String(student.id), String(student.estudiantes || 'Estudiante')]));
    const rows = db.prepare(`SELECT * FROM interactive_activity_results
      WHERE session_id = ? AND activity_id = ? ORDER BY completed_at IS NULL, score DESC, updated_at DESC`)
      .all(String(found.row.id_sesion), String(found.activity.id));
    return res.json({ success: true, data: rows.map((row) => {
      const studentIds = parseInteractiveStudentIds(row.student_ids);
      return {
        scopeType: row.scope_type,
        scopeKey: row.scope_key,
        targetId: row.scope_type === 'group' ? row.scope_key : String(row.student_id || row.scope_key),
        targetName: row.scope_type === 'group' ? String(row.group_name || row.scope_key) : (namesById.get(String(row.student_id || row.scope_key)) || 'Estudiante'),
        studentIds,
        participantNames: studentIds.map((id) => namesById.get(id)).filter(Boolean),
        attemptNumber: Number(row.attempt_number || 1),
        score: row.score,
        level: row.level,
        answersSummary: row.answers_summary || '',
        completedAt: row.completed_at,
        resetAt: row.reset_at,
      };
    }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'No se pudieron consultar los resultados.' });
  }
});

router.post('/interactive-activities/:sessionId/:activityId/reset', requireLocalTeacherRequest, (req, res) => {
  try {
    const found = getInteractiveActivityForTeacher(req.params.sessionId, req.params.activityId);
    if (!found) return res.status(404).json({ success: false, message: 'No se encontró la actividad en la sesión guardada.' });
    const mode = interactiveActivityMode(found.activity);
    const requestedMode = req.body?.scopeType === 'group' ? 'group' : 'individual';
    if (requestedMode !== mode) return res.status(400).json({ success: false, message: `Esta actividad está configurada como ${mode === 'group' ? 'grupal' : 'individual'}.` });
    const targetId = String(req.body?.targetId || '').trim();
    if (!targetId) return res.status(400).json({ success: false, message: 'Selecciona un estudiante o grupo.' });
    const scopeKey = mode === 'group' ? normalizePortalText(targetId) : targetId;
    const sessionId = String(found.row.id_sesion);
    const activityId = String(found.activity.id);
    const attempt = db.prepare(`SELECT * FROM interactive_activity_results
      WHERE session_id = ? AND activity_id = ? AND scope_type = ? AND scope_key = ?`)
      .get(sessionId, activityId, mode, scopeKey);
    const runtimeKey = { sessionId, activityId, mode, scopeKey };
    if (!attempt?.completed_at) {
      const reset = Boolean(practiceAttempts.get(runtimeKey));
      practiceAttempts.reset(runtimeKey);
      return res.json({ success: true, data: { reset, message: reset ? 'Intento habilitado de nuevo por el docente.' : 'Ese estudiante o grupo no tiene un intento iniciado.' } });
    }

    const currentStudents = studentsForInteractiveSession(found.row);
    const currentTargetIds = mode === 'group'
      ? currentStudents.filter((student) => normalizePortalText(student.grupo) === scopeKey).map((student) => String(student.id))
      : [targetId];
    const affectedStudentIds = [...new Set([...parseInteractiveStudentIds(attempt.student_ids), ...currentTargetIds])];
    const nextAttempt = Number(attempt.attempt_number || 1) + 1;
    let removedGrades = 0;
    db.transaction(() => {
      practiceAttempts.reset(runtimeKey);
      db.prepare(`UPDATE interactive_activity_results SET student_ids = '[]', score = NULL, level = NULL,
        answers_summary = NULL, completed_at = NULL, attempt_number = ?, reset_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nextAttempt, attempt.id);
    })();
    return res.json({
      success: true,
      data: {
        reset: true,
        attemptNumber: nextAttempt,
        affectedStudents: affectedStudentIds.length,
        removedGrades,
        message: mode === 'group'
          ? `Actividad reiniciada para el grupo. Ya pueden realizar el intento ${nextAttempt}.`
          : `Actividad reiniciada para el estudiante. Ya puede realizar el intento ${nextAttempt}.`,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'No se pudo reiniciar la actividad.' });
  }
});

router.get('/student-portal/info', (req, res) => {
  const root = getEvidenceStorageRoot();
  cleanupExpiredPortalSessions();
  res.json({
    success: true,
    data: {
      institution: db.prepare('SELECT institution FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.institution || 'Institución educativa',
      storageReady: fs.existsSync(root),
      maxStudentSessions: STUDENT_PORTAL_MAX_SESSIONS,
      remoteAccessEndsAt: getRemoteAccessDeadline(),
      serverNow: new Date().toISOString(),
    },
  });
});

router.post('/student-portal/login', (req, res) => {
  const dni = String(req.body?.dni || '').replace(/\D+/g, '');
  if (!dni) return res.status(400).json({ success: false, message: 'Escribe tu DNI.' });
  const password = String(req.body?.password || '');
  if (!password) return res.status(400).json({ success: false, message: 'Escribe tu contraseña. En el primer ingreso es tu DNI.' });
  const now = Date.now();
  const dniAttemptKey = studentLoginAttemptKey('dni', dni);
  const addressAttemptKey = studentLoginAttemptKey('address', getStudentRequestAddress(req));
  const existingBlock = getStudentLoginBlock(dniAttemptKey, addressAttemptKey, now);
  if (existingBlock) {
    res.setHeader('Retry-After', String(existingBlock.retryAfter));
    return res.status(429).json({ success: false, message: 'Hubo demasiados intentos. Espera unos minutos antes de volver a ingresar.' });
  }
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE TRIM(dni) = ? LIMIT 1').get(dni);
  if (!student) {
    registerStudentLoginFailure(dniAttemptKey, now);
    registerStudentLoginFailure(addressAttemptKey, now);
    return res.status(401).json({ success: false, message: 'No pudimos validar el DNI o la contraseña.' });
  }
  const estado = normalizePortalText(student.estado);
  if (estado === 'r' || estado.includes('retir') || estado === 't' || estado.includes('traslad')) {
    return res.status(403).json({ success: false, message: 'Tu registro no está activo. Consulta con tu docente.' });
  }
  const requiresPasswordChange = !String(student.password_hash || '').trim();
  const passwordIsValid = requiresPasswordChange ? password === dni : verifyStudentPassword(password, student.password_hash);
  if (!passwordIsValid) {
    registerStudentLoginFailure(dniAttemptKey, now);
    registerStudentLoginFailure(addressAttemptKey, now);
    return res.status(401).json({ success: false, message: 'No pudimos validar el DNI o la contraseña.' });
  }
  if (!requiresPasswordChange) {
    // Tras validar una clave histórica, conservar una copia cifrada local permite
    // que el docente pueda consultarla sin cambiarla ni debilitar el hash scrypt.
    db.prepare('UPDATE db_estudiantes SET password_recovery_cipher = ? WHERE id = ?')
      .run(encryptStudentPassword(password), student.id);
  }
  studentPortalLoginAttempts.delete(dniAttemptKey);
  const token = crypto.randomBytes(32).toString('hex');

  setPortalSessionToken(token, {
    studentId: String(student.id),
    mustChangePassword: requiresPasswordChange,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + STUDENT_PORTAL_TOKEN_TTL_MS,
  });
  touchStudentPresence({
    token,
    studentId: student.id,
    activity: 'Inicio de sesión',
    source: req.headers['cf-ray'] || req.headers['cf-connecting-ip'] ? 'remote' : 'lan',
  });

  return res.json({
    success: true,
    data: {
      token,
      requiresPasswordChange,
      student: mapPortalStudent(student),
    },
  });
});

router.post('/student-portal/change-password', requireStudentPortalAuth, (req, res) => {
  const password = String(req.body?.password || '');
  const confirmation = String(req.body?.confirmation || '');
  if (password !== confirmation) return res.status(400).json({ success: false, message: 'Las contraseñas no coinciden.' });
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ success: false, message: 'Usa al menos 8 caracteres, incluyendo letras y números.' });
  const student = db.prepare('SELECT dni FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  if (password === String(student?.dni || '')) return res.status(400).json({ success: false, message: 'La nueva contraseña debe ser diferente de tu DNI.' });
  db.prepare('UPDATE db_estudiantes SET password_hash = ?, password_recovery_cipher = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hashStudentPassword(password), encryptStudentPassword(password), req.studentPortal.studentId);

  const token = getPortalToken(req);
  setPortalSessionToken(token, {
    ...req.studentPortal,
    mustChangePassword: false,
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + STUDENT_PORTAL_TOKEN_TTL_MS,
  });

  return res.json({ success: true, data: { changed: true } });
});

router.get('/student-portal/profile', requireStudentPortalAuth, (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    return res.json({ success: true, data: mapPortalStudent(student) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/student-portal/profile', requireStudentPortalAuth, uploadEvidenceMiddleware, async (req, res) => {
  const notificationsEnabled = 1;
  const email = String(req.body?.email || '').trim().slice(0, 160);
  const microsoft = String(req.body?.microsoft || '').trim().slice(0, 160);
  if (!isValidOptionalEmail(email) || !isValidOptionalEmail(microsoft)) {
    return res.status(400).json({ success: false, message: 'Revisa los correos: deben tener un formato válido, por ejemplo nombre@dominio.com.' });
  }
  db.prepare('UPDATE db_estudiantes SET gmail = ?, outlook = ?, notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(email, microsoft, notificationsEnabled, req.studentPortal.studentId);
  let imageData = String(req.body?.profilePhoto || '');
  if (req.file) {
    if (Number(req.file.size || 0) > 8 * 1024 * 1024) {
      await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
      return res.status(413).json({ success: false, message: 'La foto no debe superar 8 MB.' });
    }
    try {
      const optimized = await sharp(req.file.path)
        .rotate()
        .resize({ width: 640, height: 640, fit: 'cover', position: 'attention', withoutEnlargement: true })
        .webp({ quality: 80, effort: 3 })
        .toBuffer();
      imageData = `data:image/webp;base64,${optimized.toString('base64')}`;
    } catch {
      return res.status(400).json({ success: false, message: 'No se pudo procesar la foto seleccionada.' });
    } finally {
      await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    }
  }
  if (imageData) {
    if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(imageData) || imageData.length > 8_000_000) {
      return res.status(400).json({ success: false, message: 'La foto debe ser JPG, PNG o WebP y no superar aproximadamente 5 MB.' });
    }
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    db.prepare("DELETE FROM asistencia_rostros WHERE student_id = ? AND source = 'student_profile_front'").run(String(student.id));
    db.prepare(`INSERT INTO asistencia_rostros (student_id, student_name, grade, section, image_data, descriptor, source, updated_at) VALUES (?, ?, ?, ?, ?, '', 'student_profile_front', CURRENT_TIMESTAMP)`).run(String(student.id), student.estudiantes, student.grado, student.secc, imageData);
  }
  const updated = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  return res.json({ success: true, data: mapPortalStudent(updated) });
});

router.post('/student-portal/logout', requireStudentPortalAuth, (req, res) => {
  const token = getPortalToken(req);
  disconnectStudentPresence(token);
  deletePortalSessionToken(token);
  return res.json({ success: true });
});

router.post('/student-portal/ping', requireStudentPortalAuth, (req, res) => {
  return res.json({ success: true, data: { active: true, heartbeatIntervalMs: 20_000, serverTime: Date.now() } });
});

router.post('/student-portal/disconnect', requireStudentPortalAuth, (req, res) => {
  disconnectStudentPresence(getPortalToken(req));
  return res.json({ success: true });
});

router.get('/student-portal/sessions', requireStudentPortalAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  if (!student) return res.status(401).json({ success: false, message: 'Estudiante no encontrado.' });
  const general = db.prepare('SELECT year FROM datos_generales ORDER BY id DESC LIMIT 1').get();
  const rows = db.prepare('SELECT * FROM sesiones WHERE year = ? ORDER BY updated_at DESC').all(String(general?.year || new Date().getFullYear()));
  const matchingRows = rows.filter((row) => (
    normalizePortalText(row.grade) === normalizePortalText(student.grado)
    && portalSectionsOverlap(row.section, student.secc)
  ));
  const now = new Date();
  const prepared = matchingRows.map((row) => {
    const sessionData = JSON.parse(row.session_data || '{}');
    const deliveryWindow = getPortalDeliveryWindow(row, sessionData, now, student.secc);
    return { row, sessionData, deliveryWindow };
  });
  const data = prepared.map(({ row, sessionData, deliveryWindow }) => {
    const submission = getPortalSubmissionState(row, student.id, sessionData, deliveryWindow);
    const unitInfo = getPortalUnitInfo(row);
    const publishedTemplates=mapPortalEvidenceTemplates(row,sessionData,student.secc);
    const deliveryGroup = deliveryWindow.isClosed
      ? (submission.evidenceCount > 0 ? 'history' : 'closed')
      : (deliveryWindow.inCurrentWeek && deliveryWindow.available ? 'week' : 'unit');
    return {
      id: row.id_sesion,
      year: row.year,
      areaId: String(row.area_id || ''),
      areaName: getPortalAreaName(row),
      grade: row.grade,
      section: row.section,
      unitNumber: row.unit_number,
      unitTitle: unitInfo.title,
      unitPurpose: unitInfo.purpose,
      sessionNumber: row.session_number,
      bimester: getPortalBimester(row.unit_number),
      title: String(sessionData.title || 'Sesión de aprendizaje'),
      purpose: stripPortalHtml(sessionData.purpose || ''),
      evidence: stripPortalHtml(sessionData?.competenciaPrio?.evidence || ''),
      requestedEvidences: getPortalRequestedEvidences(sessionData),
      evidenceTemplates: publishedTemplates,
      date: getPortalSessionDateKeys(sessionData, row, student.secc)[0] || '',
      dates: getPortalSessionDateKeys(sessionData, row, student.secc),
      resources: mapPortalLearningResources(row, sessionData, student.secc, publishedTemplates),
      criteriaId: getPortalSummaryId(sessionData),
      available: deliveryWindow.available,
      deliveryGroup,
      maxStudentEvidences: STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION,
      deliveryWindow,
      status: submission.status,
      late: submission.late,
      evidenceCount: submission.evidenceCount,
      studentEvidenceCount: submission.studentEvidenceCount,
      latestSubmittedAt: submission.latestSubmittedAt,
      feedback: submission.feedback,
    };
  });
  return res.json({ success: true, data });
});

router.get('/student-portal/grades', requireStudentPortalAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const studentRow = db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(req.studentPortal.studentId);
    if (!studentRow) return res.status(401).json({ success: false, message: 'Estudiante no encontrado.' });
    const year = String(db.prepare('SELECT year FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.year || new Date().getFullYear());
    const rows = db.prepare('SELECT * FROM sesiones WHERE year=? ORDER BY CAST(unit_number AS INTEGER), CAST(session_number AS INTEGER)').all(year)
      .filter(row => normalizePortalText(row.grade) === normalizePortalText(studentRow.grado) && portalSectionsOverlap(row.section, studentRow.secc));
    const sessions = rows.map(row => {
      const sessionData = JSON.parse(row.session_data || '{}');
      return { id: row.id_sesion, year, areaId: String(row.area_id || ''), areaName: getPortalAreaName(row), grade: row.grade, section: row.section, unitNumber: String(row.unit_number), sessionNumber: String(row.session_number), bimesterLabel: getPortalBimester(row.unit_number), title: String(sessionData.title || 'Sesión de aprendizaje'), unitTitle: getPortalUnitInfo(row).title, date: getPortalSessionDateKeys(sessionData, row, studentRow.secc)[0] || '', sessionData, row };
    });
    const modes = db.prepare('SELECT * FROM evaluacion_modos_calificacion WHERE year=? ORDER BY updated_at DESC').all(year);
    const defaultMode = db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_active_grading_mode_v1'").get()?.value;
    const records = db.prepare('SELECT * FROM evaluacion_registros WHERE student_id=? ORDER BY updated_at ASC, id ASC').all(String(studentRow.id));
    const result = buildStudentGradebook({
      student: { id: studentRow.id, name: studentRow.estudiantes, grade: studentRow.grado, section: studentRow.secc, estado: studentRow.estado }, sessions, records,
      modeForArea: areaId => resolveStudentGradingMode({ modes, areaId, grade: studentRow.grado, section: studentRow.secc, defaultMode, sectionsOverlap: portalSectionsOverlap }),
      feedbackForSession: (session, sessionRecords) => getPortalFeedback(session.row, studentRow.id, session.sessionData, [...sessionRecords].reverse()),
    });
    return res.json({ success: true, data: { year, ...result } });
  } catch (error) { return res.status(500).json({ success: false, message: 'No se pudieron cargar tus calificaciones. Inténtalo nuevamente.' }); }
});

router.get('/student-portal/academic-overview', requireStudentPortalAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  const general = db.prepare('SELECT year FROM datos_generales ORDER BY id DESC LIMIT 1').get();
  const rows = db.prepare('SELECT * FROM sesiones WHERE year = ? ORDER BY CAST(unit_number AS INTEGER), CAST(session_number AS INTEGER)').all(String(general?.year || new Date().getFullYear()));
  const sessions = rows.filter((row) => normalizePortalText(row.grade) === normalizePortalText(student.grado) && portalSectionsOverlap(row.section, student.secc)).map((row) => {
    let data = {}; try { data = JSON.parse(row.session_data || '{}'); } catch {}
    const areaName = getPortalAreaName(row);
    const unitInfo = getPortalUnitInfo(row);
    const evidenceCount = Number(db.prepare('SELECT COUNT(*) AS total FROM evaluacion_evidencias WHERE student_id = ? AND session_id = ? AND is_latest = 1').get(String(student.id), String(row.id_sesion))?.total || 0);
    return { id: row.id_sesion, year: String(row.year || ''), areaId: String(row.area_id || ''), areaName, unitNumber: String(row.unit_number), unitTitle: unitInfo.title, unitPurpose: unitInfo.purpose, sessionNumber: String(row.session_number), bimester: getPortalBimester(row.unit_number), title: String(data.title || 'Sesión de aprendizaje'), purpose: stripPortalHtml(data.purpose || ''), evidence: stripPortalHtml(data?.competenciaPrio?.evidence || ''), dates: getPortalSessionDateKeys(data, row, student.secc), evidenceCount, resources: mapPortalLearningResources(row, data, student.secc) };
  });
  const programmedHours = db.prepare('SELECT area_id, area_curricular, grade, section, horas_sem FROM programacion_anual').all()
    .filter((row) => normalizePortalText(row.grade) === normalizePortalText(student.grado) && portalSectionsOverlap(row.section, student.secc))
    .reduce((acc, row) => {
      const key = String(row.area_id || row.area_curricular || '');
      const hours = Number.parseFloat(String(row.horas_sem || '').replace(',', '.').match(/[\d.]+/)?.[0] || '0');
      acc[key] = Math.max(Number(acc[key] || 0), Number.isFinite(hours) ? hours : 0);
      return acc;
    }, {});
  const areaLoads = Object.values(sessions.reduce((acc, item) => {
    const key = item.areaId || item.areaName;
    acc[key] ||= { areaId: item.areaId, areaName: item.areaName, sessionCount: 0, weeklyHours: Number(programmedHours[key] || 0) };
    acc[key].sessionCount += 1;
    return acc;
  }, {})).sort((a, b) => b.weeklyHours - a.weeklyHours || b.sessionCount - a.sessionCount);
  const manualPoints = db.prepare('SELECT COALESCE(SUM(points),0) AS total FROM student_achievement_points WHERE student_id = ? AND year = ?').get(String(student.id), String(general?.year || ''))?.total || 0;
  let firstDeliveryCount = 0;
  sessions.forEach((session) => {
    const first = db.prepare(`SELECT student_id FROM evaluacion_evidencias WHERE session_id=? AND source='student_portal' AND is_latest=1 ORDER BY COALESCE(submitted_at,updated_at) ASC LIMIT 1`).get(session.id);
    if (String(first?.student_id || '') === String(student.id)) firstDeliveryCount += 1;
  });
  const firstDeliveryPoints = Math.min(1, firstDeliveryCount * 0.1);
  let firstUnitCompletionPoints = 0;
  const units = [...new Set(sessions.map((item) => item.unitNumber))];
  units.forEach((unitNumber) => {
    const unitSessions = sessions.filter((item) => item.unitNumber === unitNumber);
    if (!unitSessions.length || !unitSessions.every((item) => item.evidenceCount > 0)) return;
    const ids = unitSessions.map((item) => item.id);
    const placeholders = ids.map(() => '?').join(',');
    const finishers = db.prepare(`SELECT student_id, COUNT(DISTINCT session_id) completed, MAX(COALESCE(submitted_at,updated_at)) finished_at FROM evaluacion_evidencias WHERE session_id IN (${placeholders}) AND source='student_portal' AND is_latest=1 GROUP BY student_id HAVING completed=? ORDER BY finished_at ASC`).all(...ids, ids.length);
    if (String(finishers[0]?.student_id || '') === String(student.id)) firstUnitCompletionPoints += 1;
  });
  const achievements = { firstDeliveryCount, firstDeliveryPoints, firstUnitCompletionPoints, manualPoints: Number(manualPoints), totalPoints: firstDeliveryPoints + firstUnitCompletionPoints + Number(manualPoints) };
  return res.json({ success: true, data: { sessions, areaLoads, achievements } });
});

router.get('/student-portal/portfolio-items', requireStudentPortalAuth, (req, res) => {
  const rows = getStudentPortfolioRows(req.studentPortal.studentId).map((row) => ({
    ...mapEvidenceRow(row),
    sessionTitle: row.session_title,
    unitNumber: row.unit_number,
    sessionNumber: row.session_number,
  }));
  return res.json({ success: true, data: rows });
});

router.get('/student-portal/chat/peers', requireStudentPortalAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  const peers = db.prepare("SELECT id, estudiantes AS name FROM db_estudiantes WHERE grado = ? AND secc = ? AND estado = 'A' AND id <> ? ORDER BY estudiantes").all(student.grado, student.secc, student.id);
  return res.json({ success: true, data: peers });
});

router.get('/student-portal/chat/groups', requireStudentPortalAuth, (req, res) => {
  const groups = db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM student_chat_members m2 WHERE m2.group_id=g.id) AS member_count FROM student_chat_groups g JOIN student_chat_members m ON m.group_id=g.id WHERE m.student_id=? ORDER BY g.updated_at DESC`).all(String(req.studentPortal.studentId));
  return res.json({ success: true, data: groups.map((g) => ({ id: g.id, name: g.name, portfolioUrl: g.portfolio_url || '', memberCount: g.member_count, canDelete: String(g.created_by_student_id) === String(req.studentPortal.studentId), updatedAt: g.updated_at })) });
});

router.post('/student-portal/chat/groups', requireStudentPortalAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const memberIds = [...new Set([String(student.id), ...(Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(String) : [])])];
  if (name.length < 3) return res.status(400).json({ success: false, message: 'Escribe un nombre de grupo de al menos 3 caracteres.' });
  const allowed = new Set(db.prepare("SELECT id FROM db_estudiantes WHERE grado=? AND secc=? AND estado='A'").all(student.grado, student.secc).map((r) => String(r.id)));
  const validMembers = memberIds.filter((id) => allowed.has(id));
  if (validMembers.length < 3) return res.status(400).json({ success: false, message: 'Un chat grupal debe tener al menos tres integrantes. Selecciona a otros dos estudiantes.' });
  const result = db.prepare('INSERT INTO student_chat_groups (name,year,grade,section,created_by_student_id) VALUES (?,?,?,?,?)').run(name, String(new Date().getFullYear()), student.grado, student.secc, String(student.id));
  const add = db.prepare('INSERT OR IGNORE INTO student_chat_members (group_id,student_id) VALUES (?,?)');
  db.transaction(() => validMembers.forEach((id) => add.run(result.lastInsertRowid, id)))();
  return res.json({ success: true, data: { id: Number(result.lastInsertRowid) } });
});

router.delete('/student-portal/chat/groups/:id', requireStudentPortalAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM student_chat_groups WHERE id=?').get(Number(req.params.id));
  if (!group || String(group.created_by_student_id) !== String(req.studentPortal.studentId)) return res.status(403).json({ success: false, message: 'Solo quien creó el grupo puede eliminarlo.' });
  deleteStudentChatGroup(group.id);
  return res.json({ success: true });
});

router.get('/student-portal/chat/groups/:id/messages', requireStudentPortalAuth, (req, res) => {
  const groupId = Number(req.params.id);
  const member = db.prepare('SELECT 1 FROM student_chat_members WHERE group_id=? AND student_id=?').get(groupId, String(req.studentPortal.studentId));
  if (!member) return res.status(403).json({ success: false, message: 'No perteneces a este grupo.' });
  const rows = db.prepare('SELECT * FROM student_chat_messages WHERE group_id=? ORDER BY id ASC LIMIT 500').all(groupId);
  return res.json({
    success: true,
    data: rows.map((m) => ({
      id: m.id,
      senderType: m.sender_type,
      senderId: m.sender_id,
      senderName: m.sender_name,
      text: m.message_text,
      fileName: m.file_name,
      fileType: m.file_type,
      fileSize: m.file_size,
      fileUrl: m.file_path ? `/api/student-portal/chat/messages/${m.id}/file` : '',
      createdAt: m.created_at,
    })),
  });
});

router.get('/student-portal/chat/messages/:messageId/file', requireStudentPortalAuth, (req, res) => {
  const message = db.prepare(`
    SELECT message.*
    FROM student_chat_messages message
    JOIN student_chat_members member ON member.group_id = message.group_id
    WHERE message.id = ? AND member.student_id = ?
  `).get(Number(req.params.messageId), String(req.studentPortal.studentId));
  if (!message || !message.file_path) return res.status(404).json({ success: false, message: 'Archivo de chat no encontrado.' });
  return streamStudentChatFile(res, message);
});

router.post('/student-portal/chat/groups/:id/messages', requireStudentPortalAuth, uploadEvidenceMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(req.studentPortal.studentId);
  const member = db.prepare('SELECT 1 FROM student_chat_members WHERE group_id=? AND student_id=?').get(groupId, String(student.id));
  if (!member) return res.status(403).json({ success: false, message: 'No perteneces a este grupo.' });

  const text = String(req.body?.text || '').trim().slice(0, 4000);
  let relativePath = '', fileName = '', fileType = '', fileSize = 0;

  if (req.file) {
    try {
      ({ relativePath, fileName, fileType, fileSize } = await storeStudentChatUpload(req.file, groupId));
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'No se pudo guardar el archivo del chat.' });
    }
  } else if (req.body?.dataUrl) {
    const match = String(req.body.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ success: false, message: 'Archivo de chat inválido.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > STUDENT_CHAT_MAX_FILE_SIZE) return res.status(413).json({ success: false, message: 'El archivo supera 15 MB.' });
    fileName = path.basename(String(req.body?.fileName || 'archivo')).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    fileType = match[1];
    fileSize = buffer.length;
    const folder = path.join(studentChatUploadsFolder, String(groupId));
    ensureDir(folder);
    const stored = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`;
    fs.writeFileSync(path.join(folder, stored), buffer);
    relativePath = path.relative(uploadsRoot, path.join(folder, stored)).replace(/\\/g, '/');
  }

  if (!text && !relativePath) return res.status(400).json({ success: false, message: 'Escribe un mensaje o adjunta un archivo.' });

  db.prepare('INSERT INTO student_chat_messages (group_id,sender_type,sender_id,sender_name,message_text,file_path,file_name,file_type,file_size) VALUES (?,\'student\',?,?,?,?,?,?,?)')
    .run(groupId, String(student.id), student.estudiantes, text, relativePath, fileName, fileType, fileSize);
  db.prepare('UPDATE student_chat_groups SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(groupId);

  return res.json({ success: true });
});

router.get('/student-portal/evidences', requireStudentPortalAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM evaluacion_evidencias WHERE student_id = ? AND session_id = ? ORDER BY updated_at DESC')
    .all(req.studentPortal.studentId, String(req.query.sessionId || ''));
  res.json({ success: true, data: rows.map(mapEvidenceRow) });
});

router.patch('/student-portal/evidences/:evidenceId/name', requireStudentPortalAuth, (req, res) => {
  try {
    const evidenceId = Number(req.params.evidenceId || 0);
    const row = db.prepare(`
      SELECT * FROM evaluacion_evidencias
      WHERE id = ? AND student_id = ? AND source = 'student_portal' AND is_latest = 1
    `).get(evidenceId, String(req.studentPortal.studentId));
    if (!row) return res.status(404).json({ success: false, message: 'No se encontró una evidencia tuya que pueda renombrarse.' });

    const requested = path.basename(String(req.body?.name || '')).replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
    const currentExtension = path.extname(String(row.file_name || row.relative_path || '')).slice(0, 16);
    const requestedBase = path.basename(requested, path.extname(requested)).replace(/[. ]+$/g, '').trim().slice(0, 120);
    if (!requestedBase) return res.status(400).json({ success: false, message: 'Escribe un nombre válido para la evidencia.' });

    const fileName = `${requestedBase}${currentExtension}`;
    db.prepare("UPDATE evaluacion_evidencias SET file_name = ?, renamed_by = 'student', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(fileName, evidenceId);
    const updated = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(evidenceId);
    persistEvidencePortableMetadata(updated);
    return res.json({ success: true, data: mapEvidenceRow(updated) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

const validatePortalUploadTarget = (student, sessionId, replaceEvidenceId = 0, requestedEvidenceId = '') => {
  const sessionRow = getPortalSessionForStudent(sessionId, student);
  if (!sessionRow) { const error = new Error('Esa sesión no corresponde a tu grado y sección.'); error.statusCode = 403; throw error; }
  const sessionData = JSON.parse(sessionRow.session_data || '{}');
  const deliveryWindow = getPortalDeliveryWindow(sessionRow, sessionData, new Date(), student.secc);
  if (!deliveryWindow.available) { const error = new Error(deliveryWindow.isClosed ? 'El plazo de entrega de esta sesión está cerrado.' : 'Esta sesión todavía no está habilitada para recibir evidencias.'); error.statusCode = 403; throw error; }
  let previous = null;
  if (replaceEvidenceId) {
    previous = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=? AND student_id=? AND session_id=? AND is_latest=1').get(Number(replaceEvidenceId), String(student.id), String(sessionRow.id_sesion));
    if (!previous) { const error = new Error('No se encontró la evidencia que deseas reemplazar.'); error.statusCode = 404; throw error; }
  } else {
    const currentCount = Number(db.prepare("SELECT COUNT(*) AS total FROM evaluacion_evidencias WHERE student_id=? AND session_id=? AND source='student_portal' AND is_latest=1").get(String(student.id), String(sessionRow.id_sesion))?.total || 0);
    if (currentCount >= STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION) { const error = new Error(`Ya alcanzaste el máximo de ${STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION} evidencias para esta sesión. Puedes reemplazar una entrega existente.`); error.statusCode = 409; throw error; }
  }
  return { sessionRow, sessionData, requestedEvidence: resolvePortalRequestedEvidence(sessionData, requestedEvidenceId, previous) };
};

router.post('/student-portal/uploads/init', requireStudentPortalAuth, (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(req.studentPortal.studentId);
    const { requestedEvidence } = validatePortalUploadTarget(student, req.body?.sessionId, Number(req.body?.replaceEvidenceId || 0), req.body?.requestedEvidenceId);
    const data = initializeResumableUpload({
      studentId: student.id,
      sessionId: req.body?.sessionId,
      replaceEvidenceId: req.body?.replaceEvidenceId,
      fileName: req.body?.fileName,
      fileType: req.body?.fileType,
      totalSize: req.body?.totalSize,
      chunkSizeLimit: 1024 * 1024,
      sha256: req.body?.sha256,
      observation: req.body?.observation,
      evidenceLink: normalizeEvidenceLink(req.body?.evidenceLink),
      requestedEvidence,
    });
    return res.json({ success: true, data: { ...data, config: { retryCount: UPLOAD_CONFIG.retryCount } } });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ success: false, message: error.message });
  }
});

router.get('/student-portal/uploads/:uploadId/status', requireStudentPortalAuth, (req, res) => {
  try { return res.json({ success: true, data: getResumableUploadStatus(req.params.uploadId, req.studentPortal.studentId) }); }
  catch (error) { return res.status(Number(error.statusCode) || 500).json({ success: false, message: error.message }); }
});

router.put('/student-portal/uploads/:uploadId/chunks/:chunkIndex', requireStudentPortalAuth, async (req, res) => {
  try {
    const data = await receiveUploadChunk({ uploadId: req.params.uploadId, studentId: req.studentPortal.studentId, chunkIndex: req.params.chunkIndex, request: req, expectedChunkHash: req.headers['x-chunk-sha256'] });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ success: false, code: error.code, data: error.data, message: error.message });
  }
});

const finalizePortalUpload = async (req) => {
  let savedFile = null;
  let fileCommitted = false;
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(req.studentPortal.studentId);
    db.prepare('UPDATE portal_evidence_uploads SET observation=?, evidence_link=?, updated_at=? WHERE upload_id=? AND student_id=?').run(
      String(req.body?.observation || '').slice(0, 4000),
      normalizeEvidenceLink(req.body?.evidenceLink),
      Date.now(),
      String(req.params.uploadId),
      String(student.id),
    );
    const assembled = await assembleResumableUpload(req.params.uploadId, student.id);
    const sessionRow = getPortalSessionForStudent(assembled.row.session_id, student);
    const requestedEvidence = readRequestedEvidence(assembled.row.requested_evidence);
    if (!sessionRow) { const error = new Error('La sesión de esta transferencia ya no está disponible.'); error.statusCode = 403; throw error; }
    const sessionData = JSON.parse(sessionRow.session_data || '{}');
    savedFile = await saveEvidenceTempFile({
      tempFilePath: assembled.assembledPath,
      fileName: assembled.row.original_file_name,
      year: sessionRow.year,
      areaId: sessionRow.area_id,
      grade: student.grado || sessionRow.grade,
      section: student.secc || sessionRow.section,
      unitNumber: sessionRow.unit_number,
      sessionNumber: sessionRow.session_number,
      mimeType: assembled.row.file_type,
    });
    let replacedPreviousId = 0;
    const saved = db.transaction(() => {
      if (!Number(assembled.row.replace_evidence_id || 0)) {
        const used = Number(db.prepare("SELECT COUNT(*) AS total FROM evaluacion_evidencias WHERE student_id=? AND session_id=? AND source='student_portal' AND is_latest=1").get(String(student.id), sessionRow.id_sesion).total);
        if (used >= STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION) { const error = new Error('Ya alcanzaste el límite de archivos de esta sesión.'); error.statusCode = 409; throw error; }
      }
      const replaceEvidenceId = Number(assembled.row.replace_evidence_id || 0);
      let versionGroupId = crypto.randomUUID(), versionNumber = 1;
      let criteriaId = requestedEvidence?.criteriaId || getPortalSummaryId(sessionData);
      if (replaceEvidenceId) {
        const previous = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=? AND student_id=? AND session_id=? AND is_latest=1').get(replaceEvidenceId, String(student.id), String(sessionRow.id_sesion));
        if (!previous) { const error = new Error('No se encontró la evidencia que deseas reemplazar.'); error.statusCode = 404; throw error; }
        criteriaId = requestedEvidence?.criteriaId || previous.criteria_id || criteriaId;
        versionGroupId = String(previous.version_group_id || `legacy-${previous.id}`);
        versionNumber = Number(db.prepare('SELECT MAX(version_number) AS max_version FROM evaluacion_evidencias WHERE student_id=? AND session_id=? AND version_group_id=?').get(String(student.id), String(sessionRow.id_sesion), versionGroupId)?.max_version || 0) + 1;
        db.prepare('UPDATE evaluacion_evidencias SET is_latest=0 WHERE student_id=? AND session_id=? AND version_group_id=?').run(String(student.id), String(sessionRow.id_sesion), versionGroupId);
        replacedPreviousId = Number(previous.id);
      }
      const result = db.prepare(`INSERT INTO evaluacion_evidencias (student_id,session_id,criteria_id,file_path,file_type,observation,evidence_link,year,area_id,grade,section,bimester,unit_number,session_number,student_ids,student_names,file_name,file_size,relative_path,source,version_group_id,version_number,is_latest,submitted_at,submission_ip,submission_user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,?,?)`).run(
        String(student.id), sessionRow.id_sesion, criteriaId, savedFile.absolutePath, savedFile.detectedMime || assembled.row.file_type, assembled.row.observation || '', normalizeEvidenceLink(assembled.row.evidence_link), sessionRow.year, String(sessionRow.area_id), student.grado || sessionRow.grade, student.secc || sessionRow.section, getPortalBimester(sessionRow.unit_number), String(sessionRow.unit_number), String(sessionRow.session_number), JSON.stringify([student.id]), JSON.stringify([student.estudiantes]), savedFile.fileName, savedFile.size, savedFile.relativePath, 'student_portal', versionGroupId, versionNumber, String(req.ip || req.socket?.remoteAddress || ''), String(req.headers['user-agent'] || '').slice(0, 500),
      );
      db.prepare('UPDATE evaluacion_evidencias SET requested_evidence=? WHERE id=?').run(requestedEvidence ? JSON.stringify(requestedEvidence) : '', result.lastInsertRowid);
      const saved = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=?').get(result.lastInsertRowid);
      db.prepare("UPDATE portal_evidence_uploads SET completed_evidence_id=?, status='COMPLETED',updated_at=? WHERE upload_id=? AND student_id=?").run(saved.id, Date.now(), req.params.uploadId, String(student.id));
      return saved;
    })();
    fileCommitted = true;
    if (replacedPreviousId) persistEvidencePortableMetadata(db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=?').get(replacedPreviousId));
    persistEvidencePortableMetadata(saved);
    await completeResumableUpload(req.params.uploadId);
    touchStudentPresence({ token: req.studentPortalToken, studentId: student.id, activity: 'Evidencia recibida', uploadStatus: 'IDLE', source: req.headers['cf-ray'] ? 'remote' : 'lan' });
    return mapEvidenceRow(saved);
  } catch (error) {
    if (savedFile?.absolutePath && !fileCommitted) removeEvidenceFileWithOriginals(savedFile.absolutePath);
    throw error;
  }
};

// One finalization per upload. Conversion and portable storage outlive an HTTP
// request; clients can poll the durable status without submitting the video again.
const uploadCompletions = new Map();
router.post('/student-portal/uploads/:uploadId/complete', requireStudentPortalAuth, async (req, res) => {
  try {
    const studentId = req.studentPortal.studentId, uploadId = req.params.uploadId;
    const status = getResumableUploadStatus(uploadId, studentId);
    if (status.completedEvidenceId) {
      const saved = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=? AND student_id=?').get(status.completedEvidenceId, String(studentId));
      if (!saved) throw new Error('No se encontro la evidencia confirmada.');
      return res.json({ success: true, data: mapEvidenceRow(saved) });
    }
    if (status.missingChunks.length) return res.status(409).json({ success: false, message: 'Todavia faltan partes del archivo.', data: status });
    let pending = uploadCompletions.get(uploadId);
    if (!pending) {
      db.prepare("UPDATE portal_evidence_uploads SET status='ASSEMBLING',last_error='',updated_at=? WHERE upload_id=?").run(Date.now(), uploadId);
      pending = Promise.resolve().then(() => finalizePortalUpload(req)).catch(error => {
        try { db.prepare("UPDATE portal_evidence_uploads SET status='FAILED_FINALIZATION',last_error=?,updated_at=? WHERE upload_id=? AND status<>'COMPLETED'").run(String(error.message || error).slice(0,500), Date.now(), uploadId); } catch {}
        throw error;
      }).finally(() => uploadCompletions.delete(uploadId));
      uploadCompletions.set(uploadId, pending);
      void pending.catch(() => {});
    }
    if (req.body?.background === true) return res.status(202).json({ success: true, data: getResumableUploadStatus(uploadId, studentId) });
    return res.json({ success: true, data: await pending });
  } catch (error) {
    return res.status(Number(error.statusCode) || 500).json({ success: false, data: error.data, message: error.message });
  }
});

router.delete('/student-portal/uploads/:uploadId', requireStudentPortalAuth, (req, res) => {
  try { cancelResumableUpload(req.params.uploadId, req.studentPortal.studentId); return res.json({ success: true }); }
  catch (error) { return res.status(Number(error.statusCode) || 500).json({ success: false, message: error.message }); }
});

router.post('/student-portal/evidences', requireStudentPortalAuth, uploadEvidenceMiddleware, async (req, res) => {
  let savedFile = null;
  let fileCommitted = false;
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    const sessionId = req.body?.sessionId;
    const sessionRow = getPortalSessionForStudent(sessionId, student);
    if (!sessionRow) return res.status(403).json({ success: false, message: 'Esa sesión no corresponde a tu grado y sección.' });

    const sessionData = JSON.parse(sessionRow.session_data || '{}');
    const deliveryWindow = getPortalDeliveryWindow(sessionRow, sessionData, new Date(), student.secc);
    if (!deliveryWindow.available) {
      return res.status(403).json({
        success: false,
        message: deliveryWindow.isClosed
          ? 'El plazo de entrega de esta sesión está cerrado.'
          : 'Esta sesión todavía no está habilitada para recibir evidencias.',
      });
    }

    const replaceEvidenceId = Number(req.body?.replaceEvidenceId || 0);
    if (!replaceEvidenceId) {
      const currentCount = Number(db.prepare(`
        SELECT COUNT(*) AS total FROM evaluacion_evidencias
        WHERE student_id = ? AND session_id = ? AND source = 'student_portal' AND is_latest = 1
      `).get(String(student.id), String(sessionRow.id_sesion))?.total || 0);
      if (currentCount >= STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION) {
        return res.status(409).json({ success: false, message: `Ya alcanzaste el máximo de ${STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION} evidencias para esta sesión. Puedes reemplazar una entrega existente.` });
      }
    }

    const previousDelivery = replaceEvidenceId ? db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=? AND student_id=? AND session_id=? AND is_latest=1').get(replaceEvidenceId, String(student.id), sessionRow.id_sesion) : null;
    if (replaceEvidenceId && !previousDelivery) return res.status(404).json({ success: false, message: 'No se encontró la entrega actual que deseas reemplazar.' });
    const requestedEvidence = resolvePortalRequestedEvidence(sessionData, req.body?.requestedEvidenceId, previousDelivery);
    const criteriaId = requestedEvidence?.criteriaId || previousDelivery?.criteria_id || getPortalSummaryId(sessionData);
    const originalFileName = path.basename(String(req.file?.originalname || req.body?.fileName || 'evidencia'));
    const evidenceLink = normalizeEvidenceLink(req.body?.evidenceLink);
    const extension = path.extname(originalFileName).slice(1).toLowerCase();
    if (!EVIDENCE_EXTENSION_SET.has(extension)) {
      return res.status(400).json({ success: false, message: 'Ese formato de archivo no está permitido.' });
    }

    if (req.file) {
      savedFile = await saveEvidenceTempFile({
        tempFilePath: req.file.path,
        fileName: originalFileName,
        year: sessionRow.year,
        areaId: sessionRow.area_id,
        grade: student.grado || sessionRow.grade,
        section: student.secc || sessionRow.section,
        unitNumber: sessionRow.unit_number,
        sessionNumber: sessionRow.session_number,
        mimeType: req.file.mimetype,
      });
    } else if (req.body?.dataUrl) {
      savedFile = await saveEvidenceDataUrl({
        dataUrl: req.body.dataUrl,
        fileName: originalFileName,
        year: sessionRow.year,
        areaId: sessionRow.area_id,
        grade: student.grado || sessionRow.grade,
        section: student.secc || sessionRow.section,
        unitNumber: sessionRow.unit_number,
        sessionNumber: sessionRow.session_number,
      });
    } else {
      return res.status(400).json({ success: false, message: 'No se recibió ningún archivo de evidencia.' });
    }

    let replacedPreviousId = 0;
    const saved = db.transaction(() => {
      let versionGroupId = crypto.randomUUID();
      let versionNumber = 1;
      if (!replaceEvidenceId) {
        const used = Number(db.prepare("SELECT COUNT(*) AS total FROM evaluacion_evidencias WHERE student_id=? AND session_id=? AND source='student_portal' AND is_latest=1").get(String(student.id), sessionRow.id_sesion).total);
        if (used >= STUDENT_PORTAL_MAX_EVIDENCES_PER_SESSION) { const error = new Error('Ya alcanzaste el límite de archivos de esta sesión.'); error.statusCode = 409; throw error; }
      }

      if (replaceEvidenceId) {
        const previous = db.prepare(`
          SELECT * FROM evaluacion_evidencias
          WHERE id = ? AND student_id = ? AND session_id = ? AND is_latest = 1
        `).get(replaceEvidenceId, String(student.id), String(sessionRow.id_sesion));
        if (!previous) {
          const error = new Error('No se encontró la entrega actual que deseas reemplazar.'); error.statusCode = 404; throw error;
        }
        versionGroupId = String(previous.version_group_id || `legacy-${previous.id}`);
        versionNumber = Number(db.prepare(`
          SELECT MAX(version_number) AS max_version FROM evaluacion_evidencias
          WHERE student_id = ? AND session_id = ? AND version_group_id = ?
        `).get(String(student.id), String(sessionRow.id_sesion), versionGroupId)?.max_version || 0) + 1;
        db.prepare(`
          UPDATE evaluacion_evidencias SET is_latest = 0
          WHERE student_id = ? AND session_id = ? AND version_group_id = ?
        `).run(String(student.id), String(sessionRow.id_sesion), versionGroupId);
        replacedPreviousId = Number(previous.id || 0);
      }

      const result = db.prepare(`
        INSERT INTO evaluacion_evidencias (
          student_id, session_id, criteria_id, file_path, file_type, observation, evidence_link,
          year, area_id, grade, section, bimester, unit_number, session_number,
          student_ids, student_names, file_name, file_size, relative_path, source,
          version_group_id, version_number, is_latest, submitted_at,
          submission_ip, submission_user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?, ?)
      `).run(
        String(student.id), sessionRow.id_sesion, criteriaId, savedFile.absolutePath,
        String(savedFile.detectedMime || req.body?.fileType || ''), String(req.body?.observation || ''), evidenceLink,
        sessionRow.year, String(sessionRow.area_id), student.grado || sessionRow.grade, student.secc || sessionRow.section, getPortalBimester(sessionRow.unit_number),
        String(sessionRow.unit_number), String(sessionRow.session_number), JSON.stringify([student.id]), JSON.stringify([student.estudiantes]),
        savedFile.fileName || originalFileName, savedFile.size, savedFile.relativePath, 'student_portal', versionGroupId, versionNumber,
        String(req.ip || req.socket?.remoteAddress || ''), String(req.headers['user-agent'] || '').slice(0, 500)
      );

      db.prepare('UPDATE evaluacion_evidencias SET requested_evidence=? WHERE id=?').run(requestedEvidence ? JSON.stringify(requestedEvidence) : '', result.lastInsertRowid);
      const saved = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(result.lastInsertRowid);
      return saved;
    })();
    fileCommitted = true;
    if (replacedPreviousId) {
      persistEvidencePortableMetadata(db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(replacedPreviousId));
    }
    persistEvidencePortableMetadata(saved);

    return res.json({ success: true, data: mapEvidenceRow(saved) });
  } catch (error) {
    if (savedFile?.absolutePath && !fileCommitted) removeEvidenceFileWithOriginals(savedFile.absolutePath);
    return res.status(Number(error.statusCode) || 500).json({ success: false, message: error.message });
  }
});

router.get('/student-portal/portfolio.zip', requireStudentPortalAuth, (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    if (!student) return res.status(404).json({ success: false, message: 'Estudiante no encontrado.' });
    return streamPortfolioZip({ res, student, rows: getStudentPortfolioRows(student.id), resolveEvidenceFilePath });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/student-portal/portfolio.pdf', requireStudentPortalAuth, (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    if (!student) return res.status(404).json({ success: false, message: 'Estudiante no encontrado.' });
    const rows = getStudentPortfolioRows(student.id);
    const feedbackBySession = new Map();
    [...new Set(rows.map((row) => String(row.session_id)))].forEach((sessionId) => {
      const sessionRow = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(sessionId);
      if (!sessionRow) return;
      let sessionData = {};
      try { sessionData = JSON.parse(sessionRow.session_data || '{}'); } catch {}
      feedbackBySession.set(sessionId, getPortalFeedback(sessionRow, student.id, sessionData));
    });
    const institution = db.prepare('SELECT institution FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.institution || 'Institución educativa';
    return streamPortfolioPdf({ res, student, rows, institution, feedbackBySession, resolveEvidenceFilePath });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* =====================================================
   RUTAS DE CHAT PARA DOCENTE
===================================================== */

router.get('/student-chat/teacher/groups', requireLocalTeacherRequest, (_req, res) => {
  const rows = db.prepare('SELECT *, (SELECT COUNT(*) FROM student_chat_members m WHERE m.group_id=g.id) member_count FROM student_chat_groups g ORDER BY updated_at DESC').all();
  return res.json({ success: true, data: rows });
});

router.put('/student-chat/teacher/groups/:id', requireLocalTeacherRequest, (req, res) => {
  const groupId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM student_chat_groups WHERE id=?').get(groupId)) return res.status(404).json({ success: false, message: 'Grupo no encontrado.' });
  const rawUrl = String(req.body?.portfolioUrl || '').trim();
  let portfolioUrl = '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      portfolioUrl = parsed.href;
    } catch {
      return res.status(400).json({ success: false, message: 'Escribe un enlace web válido que comience con http:// o https://.' });
    }
  }
  db.prepare('UPDATE student_chat_groups SET portfolio_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(portfolioUrl, groupId);
  return res.json({ success: true, data: { portfolioUrl } });
});

router.get('/student-chat/teacher/groups/:id/messages', requireLocalTeacherRequest, (req, res) => {
  const rows = db.prepare('SELECT * FROM student_chat_messages WHERE group_id=? ORDER BY id ASC LIMIT 1000').all(Number(req.params.id));
  return res.json({
    success: true,
    data: rows.map((message) => ({
      ...message,
      file_url: message.file_path ? `/api/student-chat/teacher/messages/${message.id}/file` : '',
    })),
  });
});

router.get('/student-chat/teacher/messages/:messageId/file', requireLocalTeacherRequest, (req, res) => {
  const message = db.prepare('SELECT * FROM student_chat_messages WHERE id=?').get(Number(req.params.messageId));
  if (!message || !message.file_path) return res.status(404).json({ success: false, message: 'Archivo de chat no encontrado.' });
  return streamStudentChatFile(res, message);
});

router.post('/student-chat/teacher/groups/:id/messages', requireLocalTeacherRequest, uploadEvidenceMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM student_chat_groups WHERE id=?').get(groupId)) return res.status(404).json({ success: false, message: 'Grupo no encontrado.' });
  const name = String(req.body?.teacherName || 'Docente').trim();
  const text = String(req.body?.text || '').trim().slice(0, 4000);
  let stored = { relativePath: '', fileName: '', fileType: '', fileSize: 0 };
  if (req.file) {
    try { stored = await storeStudentChatUpload(req.file, groupId); }
    catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'No se pudo guardar el archivo del chat.' }); }
  }
  if (!text && !stored.relativePath) return res.status(400).json({ success: false, message: 'Escribe un mensaje o adjunta un archivo.' });
  db.prepare("INSERT INTO student_chat_messages (group_id,sender_type,sender_id,sender_name,message_text,file_path,file_name,file_type,file_size) VALUES (?,'teacher','teacher',?,?,?,?,?,?)")
    .run(groupId, name, text, stored.relativePath, stored.fileName, stored.fileType, stored.fileSize);
  db.prepare('UPDATE student_chat_groups SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(groupId);
  return res.json({ success: true });
});

router.delete('/student-chat/teacher/messages/:messageId', requireLocalTeacherRequest, (req, res) => {
  const message = db.prepare('SELECT * FROM student_chat_messages WHERE id=?').get(Number(req.params.messageId));
  if (!message) return res.status(404).json({ success: false, message: 'Mensaje no encontrado.' });
  removeStudentChatFiles([message]);
  db.prepare('DELETE FROM student_chat_messages WHERE id=?').run(message.id);
  return res.json({ success: true });
});

router.delete('/student-chat/teacher/groups/:id/messages', requireLocalTeacherRequest, (req, res) => {
  const groupId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM student_chat_groups WHERE id=?').get(groupId)) return res.status(404).json({ success: false, message: 'Grupo no encontrado.' });
  removeStudentChatFiles(db.prepare("SELECT file_path FROM student_chat_messages WHERE group_id=? AND file_path<>''").all(groupId));
  db.prepare('DELETE FROM student_chat_messages WHERE group_id=?').run(groupId);
  return res.json({ success: true });
});

router.delete('/student-chat/teacher/groups/:id', requireLocalTeacherRequest, (req, res) => {
  const groupId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM student_chat_groups WHERE id=?').get(groupId)) return res.status(404).json({ success: false, message: 'Grupo no encontrado.' });
  deleteStudentChatGroup(groupId);
  return res.json({ success: true });
});

router.use(createStudentForumRoutes({ db, requireStudentAuth: requireStudentPortalAuth, requireTeacher: requireLocalTeacherRequest, recoverFile: ensureMirrorResourceAvailable,
  deliveryWindow: getPortalDeliveryWindow, resolveEvidence: resolveEvidenceFilePath,
  sessionsForStudent: (student, year) => db.prepare('SELECT * FROM sesiones WHERE year=?').all(year).filter((row) => normalizePortalText(row.grade) === normalizePortalText(student.grado) && portalSectionsOverlap(row.section, student.secc))
}));
router.use(createStudentJournalRoutes({ db, requireStudentAuth: requireStudentPortalAuth, sessionForStudent: getPortalSessionForStudent, mapEvidence: row => mapEvidenceRow(row) }));
router.use(createStudentTeacherMessageRoutes({ db, requireStudentAuth: requireStudentPortalAuth, requireTeacher: requireLocalTeacherRequest, presence: getStudentPresenceSummary }));
router.use(createEvidenceTemplateRoutes({ db, requireStudentAuth:requireStudentPortalAuth, requireTeacher:requireLocalTeacherRequest,
  sessionForStudent:getPortalSessionForStudent, studentsForSession:studentsForInteractiveSession, schedule:sectionSchedule,
  saveEvidenceDataUrl,persistEvidencePortableMetadata,removeEvidenceFileWithOriginals,readImages:readPracticeImages }));
ensureSyncChangeTracking();
export default router;
