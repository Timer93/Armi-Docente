import express from 'express';
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
} from '../db.js';
import { appRoot, uploadsRoot, ensureDir } from '../paths.js';
import {
  saveEvidenceTempFile,
  saveEvidenceDataUrl,
  uploadEvidenceMiddleware,
  resolveEvidenceFilePath,
  mapEvidenceRow,
  persistEvidencePortableMetadata,
  getEvidenceStorageRoot,
  requireLocalTeacherRequest,
} from '../evidenceStorage.js';
import { streamPortfolioPdf, streamPortfolioZip } from '../studentPortfolio.js';
import { ensureMirrorResourceAvailable } from '../sync.js';

const router = express.Router();
const studentChatUploadsFolder = path.join(uploadsRoot, 'student-chat-local');
ensureDir(studentChatUploadsFolder);

const STUDENT_PORTAL_TOKEN_TTL_MS = 1000 * 60 * 10;
const STUDENT_PORTAL_MAX_SESSIONS = Math.max(200, Number(process.env.ARMI_STUDENT_MAX_SESSIONS) || 500);
const STUDENT_LOGIN_WINDOW_MS = 1000 * 60 * 15;
const STUDENT_LOGIN_DNI_LIMIT = 8;
const STUDENT_LOGIN_ADDRESS_LIMIT = 60;
const studentPortalLoginAttempts = new Map();

/* =====================================================
   UTILIDADES DEL PORTAL
===================================================== */

const normalizePortalText = (str) => String(str || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/g, '')
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
  .replace(/\by\b/g, ' ').split(/\s+/).filter(Boolean);

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
  return competency ? `summary::primary::${normalizePortalText(competency)}` : '';
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

const getPortalSessionDateKeys = (sessionData) => {
  const values = Array.isArray(sessionData?.sessionDateOptions)
    ? sessionData.sessionDateOptions.map((item) => item?.value)
    : [sessionData?.date || sessionData?.selectedSessionDate];
  return [...new Set(values.map(getPortalDateKey).filter(Boolean))];
};

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

const getPortalDeliveryWindow = (sessionRow, sessionData, now = new Date()) => {
  const explicit = db.prepare('SELECT * FROM evaluacion_ventanas_entrega WHERE session_id = ?').get(sessionRow.id_sesion);
  const { start: weekStart, end: weekEnd } = getPortalWeekRange(now);
  const sessionDate = parsePortalDate(sessionData?.date || sessionData?.selectedSessionDate);
  const defaultOpen = weekStart;
  const defaultClose = weekEnd;
  const openAt = parsePortalDate(explicit?.open_from) || defaultOpen;
  const closeAt = parsePortalDate(explicit?.close_at, true) || defaultClose;
  const inCurrentWeek = !!sessionDate && sessionDate >= weekStart && sessionDate <= weekEnd;
  const explicitlyEnabled = explicit ? Number(explicit.enabled) === 1 : false;
  const available = explicit
    ? explicitlyEnabled && now >= openAt && now <= closeAt
    : inCurrentWeek && now >= openAt && now <= closeAt;
  return {
    configured: !!explicit,
    exceptional: Number(explicit?.exceptional || 0) === 1,
    enabled: explicit ? explicitlyEnabled : inCurrentWeek,
    available,
    inCurrentWeek,
    openAt: openAt.toISOString(),
    closeAt: closeAt.toISOString(),
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

const getPortalFeedback = (sessionRow, studentId, sessionData) => {
  const records = db.prepare(`
    SELECT * FROM evaluacion_registros
    WHERE student_id = ? AND session_id = ?
    ORDER BY updated_at DESC
  `).all(String(studentId), String(sessionRow.id_sesion));
  const rows = Array.isArray(sessionData?.sessionAssessmentModel?.rows)
    ? sessionData.sessionAssessmentModel.rows
    : [];
  const rowById = new Map();
  rows.forEach((row) => {
    const id = String(row?.id || '');
    rowById.set(id, row);
    rowById.set(id.replace(/^primary-/, ''), row);
  });
  const summary = records.find((record) => String(record.criteria_id || '').startsWith('summary::primary::'))
    || records.find((record) => String(record.criteria_id || '').startsWith('summary::'));
  const criteria = records
    .filter((record) => !String(record.criteria_id || '').startsWith('summary::'))
    .map((record) => {
      const row = rowById.get(String(record.criteria_id || ''));
      const code = portalLevelCode(record.level);
      return {
        criteriaId: record.criteria_id,
        criterion: String(row?.criterionText || `Criterio ${record.criteria_id}`),
        level: record.level || '',
        numericScore: Number.isFinite(Number(record.numeric_score)) && record.numeric_score !== null
          ? Number(record.numeric_score)
          : null,
        descriptor: String(row?.levelDescriptors?.[code] || ''),
        observation: record.observation || ''
      };
    })
    .filter((item) => item.level || item.observation || Number.isFinite(item.numericScore));
  const levelCodes = criteria.map((item) => portalLevelCode(item.level)).filter(Boolean);
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
  const literalGrade = String(summaryCode || aggregateCode || '').toUpperCase();
  const summaryNumeric = summary?.numeric_score === null || summary?.numeric_score === undefined
    ? null
    : Number(summary.numeric_score);
  const criteriaNumeric = criteria.map((item) => item.numericScore).filter(Number.isFinite);
  const numericScore = Number.isFinite(summaryNumeric)
    ? summaryNumeric
    : (criteriaNumeric.length ? criteriaNumeric.reduce((sum, value) => sum + value, 0) / criteriaNumeric.length : null);
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
  return {
    reviewed: !!(
      String(summary?.level || '').trim()
      || String(summary?.observation || '').trim()
      || (summary?.numeric_score !== null && summary?.numeric_score !== undefined && Number.isFinite(Number(summary.numeric_score)))
      || criteria.length > 0
      || conclusions.length > 0
    ),
    level: summary?.level || '',
    literalGrade,
    numericScore,
    observation: summary?.observation || '',
    criteria,
    conclusions,
    reviewedAt: summary?.updated_at || records[0]?.updated_at || ''
  };
};

const getPortalSubmissionState = (sessionRow, studentId, sessionData, deliveryWindow) => {
  const evidences = db.prepare(`
    SELECT * FROM evaluacion_evidencias
    WHERE student_id = ? AND session_id = ? AND is_latest = 1
    ORDER BY COALESCE(submitted_at, updated_at) DESC
  `).all(String(studentId), String(sessionRow.id_sesion));
  const studentEvidenceCount = evidences.filter((item) => String(item.source || '') === 'student_portal').length;
  const feedback = getPortalFeedback(sessionRow, studentId, sessionData);
  const latestSubmittedAt = evidences[0]?.submitted_at || evidences[0]?.updated_at || '';
  const submittedDate = parsePortalDate(latestSubmittedAt);
  const late = !!submittedDate && submittedDate > new Date(deliveryWindow.closeAt);
  let status = 'pending';
  if (feedback.reviewed) status = 'reviewed';
  else if (evidences.length) status = late ? 'delivered_late' : 'delivered';
  else if (deliveryWindow.isClosed) status = 'overdue';
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

const mapPortalStudent = (student) => {
  const face = db.prepare(`SELECT image_data FROM asistencia_rostros WHERE student_id = ? ORDER BY CASE WHEN source = 'student_profile_front' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).get(String(student.id));
  return {
    id: student.id,
    name: student.estudiantes,
    grade: student.grado,
    section: student.secc,
    email: student.gmail || '',
    notificationsEnabled: !!student.notifications_enabled,
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

const mapPortalLearningResources = (row, sessionData) => Object.entries(PORTAL_RESOURCE_DEFINITIONS)
  .map(([key, definition]) => {
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
  })
  .filter((resource) => resource.imageUrl || resource.externalUrl);

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

router.get('/student-portal/info', (req, res) => {
  const root = getEvidenceStorageRoot();
  cleanupExpiredPortalSessions();
  res.json({
    success: true,
    data: {
      institution: db.prepare('SELECT institution FROM datos_generales ORDER BY id DESC LIMIT 1').get()?.institution || 'Institución educativa',
      storageReady: fs.existsSync(root),
      maxStudentSessions: STUDENT_PORTAL_MAX_SESSIONS,
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
  studentPortalLoginAttempts.delete(dniAttemptKey);
  const token = crypto.randomBytes(32).toString('hex');

  setPortalSessionToken(token, {
    studentId: String(student.id),
    mustChangePassword: requiresPasswordChange,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + STUDENT_PORTAL_TOKEN_TTL_MS,
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
  db.prepare('UPDATE db_estudiantes SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashStudentPassword(password), req.studentPortal.studentId);

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
  const notificationsEnabled = req.body?.notificationsEnabled ? 1 : 0;
  db.prepare('UPDATE db_estudiantes SET notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(notificationsEnabled, req.studentPortal.studentId);
  let imageData = String(req.body?.profilePhoto || '');
  if (req.file) {
    if (Number(req.file.size || 0) > 8 * 1024 * 1024) {
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
  deletePortalSessionToken(getPortalToken(req));
  return res.json({ success: true });
});

router.post('/student-portal/ping', requireStudentPortalAuth, (_req, res) => {
  return res.json({ success: true, data: { active: true } });
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
    const deliveryWindow = getPortalDeliveryWindow(row, sessionData, now);
    return { row, sessionData, deliveryWindow };
  });
  const activeUnits = new Set(prepared
    .filter((item) => item.deliveryWindow.inCurrentWeek || (item.deliveryWindow.configured && item.deliveryWindow.available))
    .map((item) => String(item.row.unit_number)));
  if (!activeUnits.size && prepared.length) {
    const nearest = [...prepared].sort((left, right) => {
      const leftDate = parsePortalDate(left.sessionData?.date || left.sessionData?.selectedSessionDate)?.getTime() || 0;
      const rightDate = parsePortalDate(right.sessionData?.date || right.sessionData?.selectedSessionDate)?.getTime() || 0;
      return Math.abs(leftDate - now.getTime()) - Math.abs(rightDate - now.getTime());
    })[0];
    activeUnits.add(String(nearest.row.unit_number));
  }
  const data = prepared.filter((item) => (
    activeUnits.has(String(item.row.unit_number)) || item.deliveryWindow.configured
  )).map(({ row, sessionData, deliveryWindow }) => {
    const submission = getPortalSubmissionState(row, student.id, sessionData, deliveryWindow);
    const unitInfo = getPortalUnitInfo(row);
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
      date: getPortalDateKey(sessionData.date || sessionData.selectedSessionDate),
      dates: getPortalSessionDateKeys(sessionData),
      resources: mapPortalLearningResources(row, sessionData),
      criteriaId: getPortalSummaryId(sessionData),
      available: deliveryWindow.available,
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

router.get('/student-portal/academic-overview', requireStudentPortalAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
  const general = db.prepare('SELECT year FROM datos_generales ORDER BY id DESC LIMIT 1').get();
  const rows = db.prepare('SELECT * FROM sesiones WHERE year = ? ORDER BY CAST(unit_number AS INTEGER), CAST(session_number AS INTEGER)').all(String(general?.year || new Date().getFullYear()));
  const sessions = rows.filter((row) => normalizePortalText(row.grade) === normalizePortalText(student.grado) && portalSectionsOverlap(row.section, student.secc)).map((row) => {
    let data = {}; try { data = JSON.parse(row.session_data || '{}'); } catch {}
    const areaName = getPortalAreaName(row);
    const unitInfo = getPortalUnitInfo(row);
    const evidenceCount = Number(db.prepare('SELECT COUNT(*) AS total FROM evaluacion_evidencias WHERE student_id = ? AND session_id = ? AND is_latest = 1').get(String(student.id), String(row.id_sesion))?.total || 0);
    return { id: row.id_sesion, areaId: String(row.area_id || ''), areaName, unitNumber: String(row.unit_number), unitTitle: unitInfo.title, unitPurpose: unitInfo.purpose, sessionNumber: String(row.session_number), bimester: getPortalBimester(row.unit_number), title: String(data.title || 'Sesión de aprendizaje'), purpose: stripPortalHtml(data.purpose || ''), evidence: stripPortalHtml(data?.competenciaPrio?.evidence || ''), dates: getPortalSessionDateKeys(data), evidenceCount, resources: mapPortalLearningResources(row, data) };
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
  const files = db.prepare("SELECT file_path FROM student_chat_messages WHERE group_id=? AND file_path<>''").all(group.id);
  files.forEach((row) => {
    try {
      const target = path.resolve(appRoot, String(row.file_path));
      if (target.startsWith(path.resolve(studentChatUploadsFolder))) fs.unlinkSync(target);
    } catch {}
  });
  db.transaction(() => {
    db.prepare('DELETE FROM student_chat_messages WHERE group_id=?').run(group.id);
    db.prepare('DELETE FROM student_chat_members WHERE group_id=?').run(group.id);
    db.prepare('DELETE FROM student_chat_groups WHERE id=?').run(group.id);
  })();
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
      fileUrl: m.file_path ? `/${String(m.file_path).replace(/\\/g, '/')}` : '',
      createdAt: m.created_at,
    })),
  });
});

router.post('/student-portal/chat/groups/:id/messages', requireStudentPortalAuth, uploadEvidenceMiddleware, async (req, res) => {
  const groupId = Number(req.params.id);
  const student = db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(req.studentPortal.studentId);
  const member = db.prepare('SELECT 1 FROM student_chat_members WHERE group_id=? AND student_id=?').get(groupId, String(student.id));
  if (!member) return res.status(403).json({ success: false, message: 'No perteneces a este grupo.' });

  const text = String(req.body?.text || '').trim().slice(0, 4000);
  let relativePath = '', fileName = '', fileType = '', fileSize = 0;

  if (req.file) {
    fileName = path.basename(req.file.originalname || 'archivo').replace(/[^\p{L}\p{N}._ -]/gu, '_');
    fileType = req.file.mimetype || '';
    fileSize = Number(req.file.size || 0);
    if (fileSize > 15 * 1024 * 1024) {
      try { await fs.promises.rm(req.file.path, { force: true }); } catch {}
      return res.status(413).json({ success: false, message: 'El archivo supera 15 MB.' });
    }
    const folder = path.join(studentChatUploadsFolder, String(groupId));
    ensureDir(folder);
    const stored = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`;
    const storedPath = path.join(folder, stored);
    try {
      await fs.promises.copyFile(req.file.path, storedPath);
    } finally {
      try { await fs.promises.rm(req.file.path, { force: true }); } catch {}
    }
    relativePath = path.relative(appRoot, storedPath);
  } else if (req.body?.dataUrl) {
    const match = String(req.body.dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ success: false, message: 'Archivo de chat inválido.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 15 * 1024 * 1024) return res.status(413).json({ success: false, message: 'El archivo supera 15 MB.' });
    fileName = path.basename(String(req.body?.fileName || 'archivo')).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    fileType = match[1];
    fileSize = buffer.length;
    const folder = path.join(studentChatUploadsFolder, String(groupId));
    ensureDir(folder);
    const stored = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`;
    fs.writeFileSync(path.join(folder, stored), buffer);
    relativePath = path.relative(appRoot, path.join(folder, stored));
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

router.post('/student-portal/evidences', requireStudentPortalAuth, uploadEvidenceMiddleware, async (req, res) => {
  try {
    const student = db.prepare('SELECT * FROM db_estudiantes WHERE id = ?').get(req.studentPortal.studentId);
    const sessionId = req.body?.sessionId;
    const sessionRow = getPortalSessionForStudent(sessionId, student);
    if (!sessionRow) return res.status(403).json({ success: false, message: 'Esa sesión no corresponde a tu grado y sección.' });

    const sessionData = JSON.parse(sessionRow.session_data || '{}');
    const deliveryWindow = getPortalDeliveryWindow(sessionRow, sessionData);
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
      if (currentCount >= 5) {
        return res.status(409).json({ success: false, message: 'Ya alcanzaste el máximo de 5 evidencias para esta sesión. Puedes reemplazar una entrega existente.' });
      }
    }

    const originalFileName = path.basename(String(req.file?.originalname || req.body?.fileName || 'evidencia'));
    const allowed = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'pdf', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'armi']);
    const extension = path.extname(originalFileName).slice(1).toLowerCase();
    if (!allowed.has(extension)) {
      return res.status(400).json({ success: false, message: 'Ese formato de archivo no está permitido.' });
    }

    let savedFile = null;
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

    const criteriaId = getPortalSummaryId(sessionData);
    let versionGroupId = crypto.randomUUID();
    let versionNumber = 1;
    let replacedPreviousId = 0;

    if (replaceEvidenceId) {
      const previous = db.prepare(`
        SELECT * FROM evaluacion_evidencias
        WHERE id = ? AND student_id = ? AND session_id = ?
      `).get(replaceEvidenceId, String(student.id), String(sessionRow.id_sesion));
      if (!previous) {
        try { fs.unlinkSync(savedFile.absolutePath); } catch {}
        return res.status(404).json({ success: false, message: 'No se encontró la evidencia que deseas reemplazar.' });
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
        student_id, session_id, criteria_id, file_path, file_type, observation,
        year, area_id, grade, section, bimester, unit_number, session_number,
        student_ids, student_names, file_name, file_size, relative_path, source,
        version_group_id, version_number, is_latest, submitted_at,
        submission_ip, submission_user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?, ?)
    `).run(
      String(student.id), sessionRow.id_sesion, criteriaId, savedFile.absolutePath,
      String(savedFile.detectedMime || req.body?.fileType || ''), String(req.body?.observation || 'Evidencia enviada por el estudiante'),
      sessionRow.year, String(sessionRow.area_id), student.grado || sessionRow.grade, student.secc || sessionRow.section, getPortalBimester(sessionRow.unit_number),
      String(sessionRow.unit_number), String(sessionRow.session_number), JSON.stringify([student.id]), JSON.stringify([student.estudiantes]),
      savedFile.fileName || originalFileName, savedFile.size, savedFile.relativePath, 'student_portal', versionGroupId, versionNumber,
      String(req.ip || req.socket?.remoteAddress || ''), String(req.headers['user-agent'] || '').slice(0, 500)
    );

    const saved = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(result.lastInsertRowid);
    if (replacedPreviousId) {
      persistEvidencePortableMetadata(db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(replacedPreviousId));
    }
    persistEvidencePortableMetadata(saved);

    return res.json({ success: true, data: mapEvidenceRow(saved) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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
  db.prepare('UPDATE student_chat_groups SET portfolio_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(req.body?.portfolioUrl || '').trim(), Number(req.params.id));
  return res.json({ success: true });
});

router.get('/student-chat/teacher/groups/:id/messages', requireLocalTeacherRequest, (req, res) => {
  const rows = db.prepare('SELECT * FROM student_chat_messages WHERE group_id=? ORDER BY id ASC LIMIT 1000').all(Number(req.params.id));
  return res.json({
    success: true,
    data: rows.map((message) => ({
      ...message,
      file_url: message.file_path ? `/${String(message.file_path).replace(/\\/g, '/')}` : '',
    })),
  });
});

router.post('/student-chat/teacher/groups/:id/messages', requireLocalTeacherRequest, (req, res) => {
  const name = String(req.body?.teacherName || 'Docente').trim();
  db.prepare("INSERT INTO student_chat_messages (group_id,sender_type,sender_id,sender_name,message_text) VALUES (?,'teacher','teacher',?,?)").run(Number(req.params.id), name, String(req.body?.text || '').trim().slice(0, 4000));
  return res.json({ success: true });
});

export default router;
