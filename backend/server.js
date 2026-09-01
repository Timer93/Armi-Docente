import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import db, { deleteStudentPortalSessions, setPortalSessionToken } from './db.js';
import { appRoot, uploadsRoot, ensureDir } from './paths.js';
import programacionRoutes from './routes/programacionAnual.routes.js';
import programacionWordRoutes from './routes/programacionWord.routes.js';
import unidadWordRoutes from './routes/unidadWord.routes.js';
import sesionWordRoutes from './routes/sesionWord.routes.js';
import studentPortalRoutes from './routes/studentPortal.routes.js';
import evidenciasRoutes from './routes/evidencias.routes.js';
import remoteAccessRoutes from './routes/remoteAccess.routes.js';
import remoteCameraRoutes, { remoteCameraPublicRoutes } from './routes/remoteCamera.routes.js';
import { initializeRemoteAccess, shutdownRemoteAccess } from './remote-access/remoteAccessService.js';
import { createSessionResourceVariants, ensureSessionResourceVariantLinks } from './sessionResourceStorage.js';
import {
  getEvidenceStorageContext,
  evidenceRelativePathFromRow,
  resolveEvidenceCandidate,
  evidenceFileMatchesRecord,
  resolveEvidenceFilePathDetailed,
  reconcilePortableEvidenceIndex,
  copyEvidenceToMirrorSafely,
} from './evidenceStorage.js';
import { checkPurchaseStatus, getAuthProviderInfo, getPurchaseConfig, loginUser, submitPurchase } from './auth.js';
import { applyCloudArtifact, clearCloudVersionHistory, discardPendingLocalBackup, ensureMirrorResourceAvailable, getDriveMirrorEvidenceStorage, getLocalSyncStatus, getResourceDeliveryStatus, getSyncStatus, markPendingLocalBackup, mergeAttendanceFromCloudArtifact, mergeStudentsFromCloudArtifact, pullCloudArtifact, pullFromCloud, pushToCloud, requestContinuousMirrorSync, resolveCloudConflict, saveFrontendStateSnapshot, startContinuousMirrorSync, updateSyncConfig } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootFolder = appRoot;
const uploadsFolder = uploadsRoot;
const STUDENT_PORTAL_MAX_SESSIONS = Math.max(200, Number(process.env.ARMI_STUDENT_MAX_SESSIONS) || 500);
const STUDENT_PORTAL_MAX_CONNECTIONS = Math.max(200, Number(process.env.ARMI_STUDENT_MAX_CONNECTIONS) || 500);
let primaryHttpServer = null;
let studentHttpServer = null;
let evidenceReconciliationTimer = null;
let stopContinuousSync = null;
let serverShutdownPromise = null;

const GENERAL_DATA_COLUMN_DEFINITIONS = {
  b1_start: 'TEXT',
  b1_end: 'TEXT',
  b2_start: 'TEXT',
  b2_end: 'TEXT',
  b3_start: 'TEXT',
  b3_end: 'TEXT',
  b4_start: 'TEXT',
  b4_end: 'TEXT',
  vac_start: 'TEXT',
  vac_end: 'TEXT',
  u1_start: 'TEXT',
  u1_end: 'TEXT',
  u2_start: 'TEXT',
  u2_end: 'TEXT',
  u3_start: 'TEXT',
  u3_end: 'TEXT',
  u4_start: 'TEXT',
  u4_end: 'TEXT',
  u5_start: 'TEXT',
  u5_end: 'TEXT',
  u6_start: 'TEXT',
  u6_end: 'TEXT',
  u7_start: 'TEXT',
  u7_end: 'TEXT',
  u8_start: 'TEXT',
  u8_end: 'TEXT',
  u_vac_start: 'TEXT',
  u_vac_end: 'TEXT',
  ie_anniversary_date: 'TEXT',
  achievement_day_1_date: 'TEXT',
  community_anniversary_date: 'TEXT',
  achievement_day_2_date: 'TEXT',
  province_anniversary_date: 'TEXT',
  other_important_date: 'TEXT',
  gemini_api_key: 'TEXT',
  openai_api_key: 'TEXT',
  ai_provider: "TEXT DEFAULT 'gemini'",
  gemini_model: 'TEXT',
  openai_model: 'TEXT',
  ai_pedagogical_route: "TEXT DEFAULT ''",
  ai_institutional_problems: "TEXT DEFAULT ''",
  ai_unit_pedagogical_focus: "TEXT DEFAULT ''",
  year_name: 'TEXT',
  evidence_storage_path: "TEXT DEFAULT ''",
};

const ensureGeneralDataColumn = (col, type) => {
  const info = db.prepare(`PRAGMA table_info(datos_generales)`).all();
  if (!info.some((column) => column.name === col)) {
    db.exec(`ALTER TABLE datos_generales ADD COLUMN ${col} ${type}`);
  }
};

const ensureGeneralDataReady = () => {
  Object.entries(GENERAL_DATA_COLUMN_DEFINITIONS).forEach(([column, type]) => {
    ensureGeneralDataColumn(column, type);
  });

  const row = db.prepare('SELECT id FROM datos_generales ORDER BY id ASC LIMIT 1').get();
  if (!row) {
    db.prepare(`
      INSERT INTO datos_generales (
        year,
        lugar,
        school_shift,
        level,
        motto,
        year_name,
        management_weeks_u1,
        context_description,
        gemini_api_key,
        openai_api_key,
        ai_provider,
        gemini_model,
        openai_model,
        ai_pedagogical_route,
        ai_institutional_problems,
        ai_unit_pedagogical_focus,
        updated_at
      ) VALUES (
        @year,
        '',
        '',
        '',
        '',
        '',
        '0',
        '',
        '',
        '',
        'gemini',
        '',
        '',
        '',
        '',
        '',
        CURRENT_TIMESTAMP
      )
    `).run({
      year: new Date().getFullYear().toString(),
    });
  }
};



const getLanIpv4Addresses = () => {
  try {
    const interfaces = os.networkInterfaces();
    const addresses = Object.values(interfaces)
      .flat()
      .filter(Boolean)
      .filter((entry) => (entry.family === 'IPv4' || entry.family === 4) && !entry.internal)
      .map((entry) => String(entry.address || '').trim())
      .filter((address) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address))
      .filter((address) => !address.startsWith('127.') && !address.startsWith('169.254.'));
    return [...new Set(addresses)].sort((left, right) => {
      const priority = (address) => address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : 2;
      return priority(left) - priority(right);
    });
  } catch {
    return [];
  }
};

const cleanupRemoteCameraSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of remoteCameraSessions.entries()) {
    if ((session?.updatedAt || session?.createdAt || 0) + REMOTE_CAMERA_TTL_MS < now) {
      remoteCameraSessions.delete(sessionId);
    }
  }
};

const buildRemoteCameraHtml = (sessionId) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ARMI Camara remota</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: linear-gradient(180deg, #eaf2ff 0%, #f8fbff 100%);
      color: #13213c;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    .card {
      width: min(100%, 520px);
      background: rgba(255,255,255,0.96);
      border: 1px solid #d8e3ff;
      border-radius: 28px;
      box-shadow: 0 24px 64px rgba(17, 55, 120, 0.12);
      overflow: hidden;
    }
    .hero {
      background: linear-gradient(135deg, #2f6fe8 0%, #4b87f3 100%);
      color: white;
      padding: 20px 22px 18px;
    }
    .hero h1 { margin: 0; font-size: 22px; line-height: 1.1; }
    .hero p { margin: 8px 0 0; font-size: 14px; opacity: 0.92; }
    .body { padding: 18px; }
    video {
      width: 100%;
      border-radius: 22px;
      background: #08111f;
      aspect-ratio: 3 / 4;
      object-fit: cover;
    }
    .status {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 18px;
      background: #eff6ff;
      color: #31558d;
      font-size: 13px;
      font-weight: 700;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }
    button {
      flex: 1;
      border: 0;
      border-radius: 18px;
      padding: 14px 16px;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
    }
    .primary { background: #2f6fe8; color: white; }
    .secondary { background: #eef2f7; color: #223554; }
    .meta {
      margin-top: 14px;
      display: grid;
      gap: 8px;
      font-size: 12px;
      color: #60718f;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="hero">
      <h1>Camara remota ARMI</h1>
      <p>Tu celular enviara video en tiempo real a la PC para reconocimiento facial o registro guiado.</p>
    </div>
    <div class="body">
      <video id="preview" playsinline autoplay muted></video>
      <div id="status" class="status">Preparando conexion con la camara del celular...</div>
      <div class="actions">
        <button id="startBtn" class="primary" type="button">Iniciar transmision</button>
        <button id="stopBtn" class="secondary" type="button">Detener</button>
      </div>
      <div class="meta">
        <div>Sesion: ${sessionId}</div>
        <div>Mantén esta pantalla abierta y el celular en la misma red Wi-Fi que la PC.</div>
      </div>
    </div>
  </div>
  <script>
    const sessionId = ${JSON.stringify(sessionId)};
    const preview = document.getElementById('preview');
    const statusNode = document.getElementById('status');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const canvas = document.createElement('canvas');
    let stream = null;
    let timer = null;
    let busy = false;

    const setStatus = (message) => { statusNode.textContent = message; };

    const stopStreaming = () => {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      preview.srcObject = null;
      setStatus('Transmision detenida.');
    };

    const sendFrame = async () => {
      if (!stream || busy || !preview.videoWidth || !preview.videoHeight) return;
      busy = true;
      try {
        const width = preview.videoWidth;
        const height = preview.videoHeight;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(preview, 0, 0, width, height);
        const imageData = canvas.toDataURL('image/jpeg', 0.72);
        const response = await fetch('/api/remote-camera/session/' + encodeURIComponent(sessionId) + '/frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData, width, height }),
        });
        if (!response.ok) {
          setStatus('No se pudo enviar la imagen a la PC.');
          return;
        }
        setStatus('Transmitiendo en tiempo real a la PC...');
      } catch (error) {
        setStatus('Se perdió la transmision. Revisa la red Wi-Fi.');
      } finally {
        busy = false;
      }
    };

    const startStreaming = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Este navegador del celular no puede abrir la camara desde un enlace HTTP de red local. Para streaming en tiempo real se necesita HTTPS valido o una app puente.');
        return;
      }
      try {
        stopStreaming();
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 960 },
            height: { ideal: 720 }
          },
          audio: false
        });
        preview.srcObject = stream;
        await preview.play();
        setStatus('Camara lista. Enviando video a la PC...');
        await sendFrame();
        timer = window.setInterval(sendFrame, 280);
      } catch (error) {
        setStatus('No se pudo abrir la camara del celular. Si esta pagina esta en HTTP local, el navegador puede estar bloqueandola por seguridad.');
      }
    };

    startBtn.addEventListener('click', startStreaming);
    stopBtn.addEventListener('click', stopStreaming);
    window.addEventListener('beforeunload', stopStreaming);
    startStreaming();
  </script>
</body>
</html>`;

async function startServer() {
  await initializeRemoteAccess();
  const app = express();
  const PORT = Number(process.env.ARMI_BACKEND_PORT || 3000);
  const STUDENT_PORTAL_PORT = Number(process.env.ARMI_STUDENT_PORTAL_PORT || (PORT + 1));

  const initialEvidenceReconciliation = reconcilePortableEvidenceIndex();
  if (initialEvidenceReconciliation?.enabled) {
    const { exported, imported, updated, pendingFiles } = initialEvidenceReconciliation;
    console.log(`[evidencias] Indice portatil listo: ${exported} fichas publicadas, ${imported} recuperadas, ${updated} actualizadas, ${pendingFiles} esperando archivo.`);
  }
  // Las altas y cambios escriben su ficha portátil inmediatamente. Este barrido
  // es solo una red de seguridad y no necesita recorrer Drive cada 15 segundos.
  evidenceReconciliationTimer = setInterval(reconcilePortableEvidenceIndex, 60_000);
  evidenceReconciliationTimer.unref?.();
  stopContinuousSync = startContinuousMirrorSync();

// Inicialización de tabla de plantillas si no existe
db.prepare(`
  CREATE TABLE IF NOT EXISTS plantillas_area (
    id_plantilla TEXT PRIMARY KEY,
    area_id TEXT,
    grade TEXT,
    section TEXT,
    session_data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

/* =========================
   UTILIDADES
========================= */

const DEPARTAMENTOS_PERU = [
  "AMAZONAS", "ÁNCASH", "APURÍMAC", "AREQUIPA", "AYACUCHO", "CAJAMARCA",
  "CALLAO", "CUSCO", "HUANCAVELICA", "HUÁNUCO", "ICA", "JUNÍN",
  "LA LIBERTAD", "LAMBAYEQUE", "LIMA", "LORETO", "MADRE DE DIOS",
  "MOQUEGUA", "PASCO", "PIURA", "PUNO", "SAN MARTÍN",
  "TACNA", "TUMBES", "UCAYALI"
];

const superNormalize = (str) => {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9 áéíóúñ]/gi, "")
    .trim();
};

const safeSlug = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '') || 'general';

const fileUrlFromAbsolutePath = (absolutePath) => {
  const relative = path.relative(uploadsFolder, absolutePath).split(path.sep).join('/');
  return `/uploads/${relative}`;
};

const parseDataUrlImage = (value) => {
  const match = String(value || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64: match[2],
  };
};

const imageExtensionFromMime = (mimeType) => {
  const clean = String(mimeType || '').toLowerCase();
  if (clean.includes('svg')) return 'svg';
  if (clean.includes('png')) return 'png';
  if (clean.includes('jpeg') || clean.includes('jpg')) return 'jpg';
  if (clean.includes('webp')) return 'webp';
  if (clean.includes('gif')) return 'gif';
  if (clean.includes('bmp')) return 'bmp';
  return 'png';
};

const resolveImageAssetTarget = ({ kind, userKey }) => {
  const safeUser = safeSlug(userKey || 'default-user');
  if (kind === 'general_insignia') {
    return path.join(uploadsFolder, 'user-assets', 'general', 'insignia');
  }
  if (kind === 'general_logo') {
    return path.join(uploadsFolder, 'user-assets', 'general', 'logo');
  }
  if (kind === 'session_resource') {
    return path.join(uploadsFolder, 'session-resources', safeUser);
  }
  return path.join(uploadsFolder, 'user-assets', 'profiles', safeUser, 'profile');
};

/* =========================
   MIDDLEWARE
========================= */

const isStudentGatewayRequest = (req) => Number(req.socket?.localPort || 0) === STUDENT_PORTAL_PORT;
app.use((req, res, next) => {
  if (!isStudentGatewayRequest(req)) return next();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-ARMI-Portal', 'student-only');

  const pathname = String(req.path || '/');
  const method = String(req.method || 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const allowed = pathname.startsWith('/estudiante')
    || pathname.startsWith('/estudiante-assets/')
    || pathname.startsWith('/estudiante-iconos/')
    || pathname.startsWith('/api/student-portal/')
    || (isRead && pathname.startsWith('/api/evaluacion/evidencias/') && pathname.endsWith('/file'))
    || (isRead && pathname === '/api/health');

  if (allowed) return next();
  const acceptsHtml = String(req.headers.accept || '').includes('text/html');
  if (isRead && (pathname === '/' || acceptsHtml)) return res.redirect(302, '/estudiante');
  return res.status(404).json({ success: false, message: 'Esta direccion publica solo permite el portal estudiantil.' });
});
app.use(cors((req, callback) => {
  callback(null, isStudentGatewayRequest(req) ? { origin: false } : { origin: '*' });
}));
app.use(bodyParser.json({ limit: '100mb' }));
app.use(['/api/student-portal', '/estudiante'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use('/uploads', async (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  try {
    const requestedPath = `uploads/${decodeURIComponent(req.path).replace(/^\/+/, '')}`;
    const result = await ensureMirrorResourceAvailable(requestedPath);
    if (result.success || result.code === 'unknown-resource') return next();
    if (result.code === 'waiting-for-drive-upload') {
      res.setHeader('Retry-After', '5');
      return res.status(503).json(result);
    }
    return next();
  } catch (error) {
    return res.status(503).json({
      success: false,
      code: 'resource-download-failed',
      message: error?.message || 'No se pudo preparar el recurso desde Drive.',
    });
  }
});
app.use('/uploads', express.static(uploadsFolder));

app.use((req, res, next) => {
  const verboseHttp = process.env.ARMI_VERBOSE_HTTP === '1';
  const routineRequest = req.method === 'GET'
    || req.path.endsWith('/ping')
    || req.path.endsWith('/frame')
    || req.path === '/api/sync/frontend-state'
    || req.path === '/api/sync/status';
  if (verboseHttp || !routineRequest) {
    console.log(`📩 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  }
  next();
});

app.use('/api', programacionRoutes);
app.use('/api', programacionWordRoutes);
app.use('/api', unidadWordRoutes);
app.use('/api', sesionWordRoutes);
app.use('/api', studentPortalRoutes);
app.use('/api', evidenciasRoutes);
app.use('/api', remoteAccessRoutes);
app.use('/api', remoteCameraRoutes);
app.use(remoteCameraPublicRoutes);

app.get('/api/auth/provider', (req, res) => {
  try {
    res.json(getAuthProviderInfo());
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    res.json(await loginUser(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/auth/purchase', async (req, res) => {
  try {
    res.json(await submitPurchase(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/auth/purchase/status', async (req, res) => {
  try {
    res.json(await checkPurchaseStatus(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/auth/purchase/config', async (req, res) => {
  try {
    res.json(await getPurchaseConfig());
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/assets/image-file', async (req, res) => {
  try {
    const imageData = String(req.body?.imageData || '').trim();
    const kind = String(req.body?.kind || '').trim();
    const userKey = String(req.body?.userKey || '').trim();

    if (!imageData || !kind) {
      return res.status(400).json({ success: false, message: 'Faltan datos para guardar la imagen.' });
    }

    const parsed = parseDataUrlImage(imageData);
    if (!parsed) {
      return res.status(400).json({ success: false, message: 'El formato de imagen no es válido.' });
    }

    const baseTarget = resolveImageAssetTarget({ kind, userKey });
    const sourceBuffer = Buffer.from(parsed.base64, 'base64');

    if (kind === 'session_resource') {
      const variants = await createSessionResourceVariants({ sourceBuffer, baseTarget });
      requestContinuousMirrorSync({ delayMs: 500 });
      return res.json({
        success: true,
        data: {
          fileUrl: fileUrlFromAbsolutePath(variants.webpPath),
          relativePath: path.relative(uploadsFolder, variants.webpPath).split(path.sep).join('/'),
          wordFileUrl: fileUrlFromAbsolutePath(variants.wordPath),
          wordRelativePath: path.relative(uploadsFolder, variants.wordPath).split(path.sep).join('/'),
          storage: {
            fingerprint: variants.fingerprint,
            width: variants.width,
            height: variants.height,
            originalBytes: variants.originalBytes,
            webpBytes: variants.webpBytes,
            wordBytes: variants.wordBytes,
          },
        },
      });
    }

    const extension = imageExtensionFromMime(parsed.mimeType);
    const absolutePath = `${baseTarget}.${extension}`;
    ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, sourceBuffer);
    requestContinuousMirrorSync({ delayMs: 500 });

    return res.json({
      success: true,
      data: {
        fileUrl: fileUrlFromAbsolutePath(absolutePath),
        relativePath: path.relative(uploadsFolder, absolutePath).split(path.sep).join('/'),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/resources/youtube/verify', async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    const idMatch = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
    if (!idMatch) {
      return res.status(400).json({ success: false, message: 'El enlace de YouTube no es válido.' });
    }
    const videoId = idMatch[1];
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const upstream = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, {
      headers: { 'User-Agent': 'Armi-Docente/11.1' },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      return res.status(422).json({ success: false, message: 'YouTube no confirmó que el video esté disponible públicamente.' });
    }
    const metadata = await upstream.json();
    return res.json({
      success: true,
      data: {
        platform: 'YouTube',
        url: canonicalUrl,
        videoId,
        title: String(metadata?.title || '').trim(),
        authorName: String(metadata?.author_name || '').trim(),
        thumbnailUrl: String(metadata?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`).trim(),
      },
    });
  } catch (error) {
    return res.status(502).json({ success: false, message: error?.message || 'No se pudo verificar el video de YouTube.' });
  }
});

/* =====================================================
   PLANTILLAS DE ÁREA (NUEVO)
===================================================== */

app.get('/api/plantillas-area', (req, res) => {
  const { areaId, grade, section } = req.query;
  try {
    const id = `${areaId}-${grade}-${section}`;
    const row = db.prepare('SELECT * FROM plantillas_area WHERE id_plantilla = ?').get(id);
    res.json({ success: true, data: row ? JSON.parse(row.session_data) : null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/plantillas-area', (req, res) => {
  const { areaId, grade, section, sessionData } = req.body;
  try {
    const id = `${areaId}-${grade}-${section}`;
    db.prepare(`
      INSERT INTO plantillas_area (id_plantilla, area_id, grade, section, session_data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id_plantilla) DO UPDATE SET
        session_data = excluded.session_data,
        updated_at = CURRENT_TIMESTAMP
    `).run(id, areaId, grade, section, JSON.stringify(sessionData));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/* =====================================================
   SESIONES DE APRENDIZAJE
===================================================== */

app.get('/api/sesiones', async (req, res) => {
  const { year, areaId, grade, section, unitNumber, sessionNumber } = req.query;
  try {
    if (year && areaId && grade && section && unitNumber && sessionNumber) {
        const id_sesion = `${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`;
        const row = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(id_sesion);
        if (!row) return res.json({ success: true, data: null });
        const repaired = await ensureSessionResourceVariantLinks({
          sessionData: JSON.parse(row.session_data || '{}'),
          sessionId: row.id_sesion,
          uploadsRoot: uploadsFolder,
        });
        if (repaired.changed) {
          db.prepare('UPDATE sesiones SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id_sesion = ?')
            .run(JSON.stringify(repaired.sessionData), row.id_sesion);
        }
        return res.json({ success: true, data: repaired.sessionData });
    }
    
    // Si no hay filtros específicos, devolver lista para el gestor
    const rows = db.prepare('SELECT * FROM sesiones ORDER BY updated_at DESC').all();
    const dataMap = {};
    rows.forEach(r => {
        const parsed = JSON.parse(r.session_data);
        dataMap[r.id_sesion] = {
            id: r.id_sesion,
            year: r.year,
            areaId: r.area_id,
            grade: r.grade,
            section: r.section,
            unitNumber: r.unit_number,
            sessionNumber: r.session_number,
            title: parsed.title || 'Sin Título',
            thematicField: parsed?.competenciaPrio?.field || '',
            learningResources: parsed?.learningResources || null
        };
    });
    res.json({ success: true, data: dataMap });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/sesiones', (req, res) => {
  const { year, areaId, grade, section, unitNumber, sessionNumber, date, sessionData } = req.body;
  try {
    const id_sesion = `${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`;
    const normalizedSessionData = {
      ...(sessionData || {}),
      date: typeof date === 'string' ? date : (sessionData?.date || '')
    };
    const existing = db.prepare('SELECT id FROM sesiones WHERE id_sesion = ? LIMIT 1').get(id_sesion);

    if (existing?.id) {
      db.prepare(`
        UPDATE sesiones
        SET year = ?, area_id = ?, grade = ?, section = ?, unit_number = ?, session_number = ?,
            session_data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        year,
        areaId,
        grade,
        section,
        unitNumber,
        sessionNumber,
        JSON.stringify(normalizedSessionData),
        existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO sesiones (id_sesion, year, area_id, grade, section, unit_number, session_number, session_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id_sesion, year, areaId, grade, section, unitNumber, sessionNumber, JSON.stringify(normalizedSessionData));
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/sesiones/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM sesiones WHERE id_sesion = ?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/* =====================================================
   UNIDADES DIDÁCTICAS
===================================================== */

app.get('/api/unidades-didacticas', (req, res) => {
  const { year, areaId, grade, section, unitNumber } = req.query;
  try {
    if (!year && !areaId && !grade && !section && !unitNumber) {
      const rows = db.prepare(`
        SELECT
          u.*,
          COALESCE(
            pa.area_curricular,
            a.area,
            u.area_id
          ) AS area_name
        FROM unidades_didacticas u
        LEFT JOIN programacion_anual pa
          ON pa.area_id = u.area_id
          AND pa.grade = u.grade
          AND pa.section = u.section
        LEFT JOIN db_areas a
          ON a.id = u.area_id
        ORDER BY u.updated_at DESC
      `).all();
      const dataMap = {};
      rows.forEach((row) => {
        dataMap[row.id_unidad] = {
          id: row.id_unidad,
          year: row.year,
          areaId: row.area_id,
          areaName: row.area_name || row.area_id,
          grade: row.grade,
          section: row.section,
          unitNumber: row.unit_number,
          title: row.title || 'Sin Título'
        };
      });
      return res.json({ success: true, data: dataMap });
    }

    const id_unidad = `${year}-${areaId}-${grade}-${section}-U${unitNumber}`;
    const row = db.prepare(
      'SELECT * FROM unidades_didacticas WHERE id_unidad = ?'
    ).get(id_unidad);

    if (!row) return res.json({ success: true, data: null });

    res.json({
      success: true,
      data: {
        ...row,
        criterios: JSON.parse(row.criterios || '{}'),
        evidencias: JSON.parse(row.evidencias || '{}'),
        instrumentos: JSON.parse(row.instrumentos || '{}'),
        criteriosTrans: JSON.parse(row.criterios_trans || '{}'),
        evidenciasTrans: JSON.parse(row.evidencias_trans || '{}'),
        instrumentosTrans: JSON.parse(row.instrumentos_trans || '{}'),
        sesiones: JSON.parse(row.sesiones || '[]'),
        recursos: JSON.parse(row.recursos || '{}'),
        bibliografia: JSON.parse(row.bibliografia || '{}')
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/unidades-didacticas', (req, res) => {
  const d = req.body;
  try {
    const id_unidad = `${d.year}-${d.areaId}-${d.grade}-${d.section}-U${d.unitNumber}`;

    db.prepare(`
      INSERT INTO unidades_didacticas (
        id_unidad, year, area_id, grade, section, unit_number,
        title, purpose, product, situation,
        criterios, evidencias, instrumentos,
        criterios_trans, evidencias_trans, instrumentos_trans,
        sesiones, recursos, bibliografia, evaluacion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id_unidad) DO UPDATE SET
        title = excluded.title,
        purpose = excluded.purpose,
        product = excluded.product,
        situation = excluded.situation,
        criterios = excluded.criterios,
        evidencias = excluded.evidencias,
        instrumentos = excluded.instrumentos,
        criterios_trans = excluded.criterios_trans,
        evidencias_trans = excluded.evidencias_trans,
        instrumentos_trans = excluded.instrumentos_trans,
        sesiones = excluded.sesiones,
        recursos = excluded.recursos,
        bibliografia = excluded.bibliografia,
        evaluacion = excluded.evaluacion,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id_unidad, d.year, d.areaId, d.grade, d.section, d.unitNumber,
      d.title, d.purpose, d.product, d.situation,
      JSON.stringify(d.criterios || {}),
      JSON.stringify(d.evidencias || {}),
      JSON.stringify(d.instrumentos || {}),
      JSON.stringify(d.criteriosTrans || {}),
      JSON.stringify(d.evidenciasTrans || {}),
      JSON.stringify(d.instrumentosTrans || {}),
      JSON.stringify(d.sesiones || []),
      JSON.stringify(d.recursos || {}),
      JSON.stringify(d.bibliografia || {}),
      d.evaluacion || ''
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/unidades-didacticas/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM unidades_didacticas WHERE id_unidad = ?').run(req.params.id);
    res.json({ success: true, deleted: result.changes || 0 });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/* =====================================================
   METAS DE APRENDIZAJE
===================================================== */

app.get('/api/metas-aprendizaje', (req, res) => {
  const { area, grado, anio } = req.query;
  try {
    const rows = db.prepare(`
      SELECT * FROM metas_aprendizaje
      WHERE TRIM(UPPER(area)) = TRIM(UPPER(?))
        AND TRIM(UPPER(grado)) = TRIM(UPPER(?))
        AND TRIM(UPPER(anio)) = TRIM(UPPER(?))
    `).all(area, grado, anio);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/metas-aprendizaje/stats', (req, res) => {
  try {
    const { area, grado, nivel } = req.query;
    const year = String(req.query['año'] || req.query['aÃ±o'] || req.query['anio'] || req.query['year'] || '').trim();
    const prevYear = String(Number(year) - 1);
    const tableDiag = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'resultados_diagn%'").get();
    if (!tableDiag?.name) {
      return res.json({ success: true, data: { diagStats: [], lineaBaseStats: [] } });
    }

    const diagRows = db.prepare(`SELECT * FROM "${tableDiag.name}"`).all();
    const norm = (value) => String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[?¿�]/g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const buildStats = (targetYear) => {
      const exactRows = diagRows.filter((row) =>
        norm(row.area) === norm(area) &&
        norm(row.grado) === norm(grado) &&
        norm(row.nivel) === norm(nivel) &&
        String(row['año'] || '').trim() === String(targetYear || '').trim()
      );

      const fallbackRows = !targetYear
        ? exactRows
        : exactRows.length > 0
          ? exactRows
          : diagRows.filter((row) =>
              norm(row.area) === norm(area) &&
              norm(row.grado) === norm(grado) &&
              norm(row.nivel) === norm(nivel) &&
              !String(row['año'] || '').trim()
            );

      const grouped = new Map();
      fallbackRows.forEach((row) => {
        const key = [row.seccion, row.competencia, row.nivel_logro].map((item) => norm(item)).join('|');
        if (!grouped.has(key)) {
          grouped.set(key, {
            seccion: row.seccion,
            competencia: row.competencia,
            nivel_logro: row.nivel_logro,
            cantidad: 0,
          });
        }
        grouped.get(key).cantidad += 1;
      });
      return Array.from(grouped.values());
    };

    const diagStats = buildStats(year);
    const lineaBaseStats = buildStats(prevYear);

    /*
    const diagStats = db.prepare(`
      SELECT
        seccion,
        competencia,
        nivel_logro,
        COUNT(*) AS cantidad
      FROM "resultados_diagnóstico"
      WHERE TRIM(UPPER(area)) = TRIM(UPPER(?))
        AND TRIM(UPPER(grado)) = TRIM(UPPER(?))
        AND TRIM(UPPER(nivel)) = TRIM(UPPER(?))
        AND TRIM("año") = TRIM(?)
      GROUP BY seccion, competencia, nivel_logro
    `).all(area, grado, nivel, year);

    const lineaBaseStats = db.prepare(`
      SELECT
        seccion,
        competencia,
        nivel_logro,
        COUNT(*) AS cantidad
      FROM "resultados_diagnóstico"
      WHERE TRIM(UPPER(area)) = TRIM(UPPER(?))
        AND TRIM(UPPER(grado)) = TRIM(UPPER(?))
        AND TRIM(UPPER(nivel)) = TRIM(UPPER(?))
        AND TRIM("año") = TRIM(?)
      GROUP BY seccion, competencia, nivel_logro
    `).all(area, grado, nivel, prevYear);
    */

    res.json({
      success: true,
      data: {
        diagStats,
        lineaBaseStats,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/metas-aprendizaje', (req, res) => {
  try {
    const { meta } = req.body;
    db.prepare(`
      INSERT INTO metas_aprendizaje 
      (anio, area, grado, seccion, competencia, tipo,
       cant_destacado, cant_esperado, cant_proceso, cant_inicio, cant_no_evaluado)
      VALUES (@anio, @area, @grado, @seccion, @competencia, @tipo,
              @cant_destacado, @cant_esperado, @cant_proceso, @cant_inicio, @cant_no_evaluado)
      ON CONFLICT(anio, area, grado, seccion, competencia, tipo)
      DO UPDATE SET
        cant_destacado = excluded.cant_destacado,
        cant_esperado = excluded.cant_esperado,
        cant_proceso = excluded.cant_proceso,
        cant_inicio = excluded.cant_inicio,
        cant_no_evaluado = excluded.cant_no_evaluado,
        updated_at = CURRENT_TIMESTAMP
    `).run(meta);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/* =====================================================
   UBIGEO – DATOS GENERALES – ESTUDIANTES – DIAGNÓSTICO
===================================================== */

app.get('/api/ubigeo/departamentos', (req, res) => {
  let data = [...DEPARTAMENTOS_PERU];
  try {
    const checkTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='padron_colegios'")
      .get();
    if (checkTable) {
      const rows = db
        .prepare("SELECT DISTINCT d_dpto FROM padron_colegios WHERE d_dpto IS NOT NULL ORDER BY d_dpto")
        .all();
      if (rows && rows.length > 0) {
        const dbList = rows.map(r => Object.values(r)[0]).filter(val => val && typeof val === 'string' && val.trim().length > 0).sort();
        if (dbList.length > 0) { data = dbList; }
      }
    }
  } catch (error) {}
  res.json({ success: true, data });
});

app.get('/api/ubigeo/provincias', (req, res) => {
  const { dpto } = req.query;
  if (!dpto) return res.json({ success: true, data: [] });
  try {
    const rows = db.prepare("SELECT DISTINCT d_prov FROM padron_colegios WHERE d_dpto = ? ORDER BY d_prov").all(dpto);
    res.json({ success: true, data: rows.map(r => Object.values(r)[0]).filter(v => v) });
  } catch (error) { res.json({ success: true, data: [] }); }
});

app.get('/api/ubigeo/distritos', (req, res) => {
  const { dpto, prov } = req.query;
  if (!dpto || !prov) return res.json({ success: true, data: [] });
  try {
    const rows = db.prepare("SELECT DISTINCT d_dist FROM padron_colegios WHERE d_dpto = ? AND d_prov = ? ORDER BY d_dist").all(dpto, prov);
    res.json({ success: true, data: rows.map(r => Object.values(r)[0]).filter(v => v) });
  } catch (error) { res.json({ success: true, data: [] }); }
});

app.get('/api/ubigeo/colegios', (req, res) => {
  try {
    const { dpto, prov, dist, nivel } = req.query;
    let sql = `SELECT id, cod_mod, nombre_ie, d_dreugel, nivel FROM padron_colegios WHERE d_dpto = ? AND d_prov = ? AND d_dist = ?`;
    const params = [dpto, prov, dist];
    if (nivel) { sql += " AND UPPER(TRIM(nivel)) = ?"; params.push(nivel.trim().toUpperCase()); }
    sql += " ORDER BY nombre_ie";
    res.json({ success: true, data: db.prepare(sql).all(...params) });
  } catch (error) { res.json({ success: true, data: [] }); }
});

app.get('/api/datos-generales', (req, res) => {
  try {
    ensureGeneralDataReady();
    const data = db.prepare('SELECT * FROM datos_generales ORDER BY id DESC LIMIT 1').get();
    res.json({ success: true, data: data || {} });
  } catch { res.json({ success: true, data: {} }); }
});

app.post('/api/datos-generales', (req, res) => {
  try {
    ensureGeneralDataReady();
    const data = req.body;
    if (Object.prototype.hasOwnProperty.call(data, 'management_weeks_u1')) {
      ensureGeneralDataColumn('management_weeks_u1', `TEXT DEFAULT '0'`);
    }
    Object.keys(data).forEach((key) => {
      if (key === 'id') return;
      const columnType = GENERAL_DATA_COLUMN_DEFINITIONS[key];
      if (columnType) {
        ensureGeneralDataColumn(key, columnType);
      }
    });
    const validColumns = new Set(db.prepare(`PRAGMA table_info(datos_generales)`).all().map((column) => column.name));
    const sanitizedData = Object.fromEntries(
      Object.entries(data || {}).filter(([key]) => key === 'id' || validColumns.has(key))
    );
    const check = db.prepare('SELECT id FROM datos_generales LIMIT 1').get();
    if (check) {
      const keys = Object.keys(sanitizedData).filter(k => k !== 'id');
      const setClause = keys.map(k => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE datos_generales SET ${setClause} WHERE id = @id`).run({ ...sanitizedData, id: check.id });
    } else {
      const keys = Object.keys(sanitizedData).filter(k => k !== 'id');
      const cols = keys.join(', ');
      const vals = keys.map(k => `@${k}`).join(', ');
      db.prepare(`INSERT INTO datos_generales (${cols}) VALUES (${vals})`).run(sanitizedData);
    }
    try { db.prepare('UPDATE estado_modulos SET datos_generales = 1 WHERE id = 1').run(); } catch {}
    res.json({ success: true, message: 'Guardado OK' });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

const getStudentPortalUrls = (port = STUDENT_PORTAL_PORT) =>
  getLanIpv4Addresses().map((address) => `http://${address}:${port}/estudiante`);

const requireLocalTeacherRequest = (req, res, next) => {
  const remote = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (remote === '127.0.0.1' || remote === '::1') return next();
  return res.status(403).json({ success: false, message: 'Esta operación solo puede realizarse desde el equipo docente.' });
};

const ensureEvidenceMirrorRoot = (context = getEvidenceStorageContext()) => {
  if (!context.automaticMirror) return;
  ensureDir(context.effectivePath);
  const markerPath = path.join(context.effectivePath, '.armi-evidence-storage.json');
  if (!fs.existsSync(markerPath)) {
    fs.writeFileSync(markerPath, JSON.stringify({
      format: 1,
      application: 'ARMI Docente',
      purpose: 'Evidencias de estudiantes compartidas entre computadoras',
      createdAt: new Date().toISOString(),
      warning: 'No elimine ni cambie de nombre esta carpeta mientras ARMI use el modo espejo.',
    }, null, 2), 'utf8');
  }
};

const getEvidenceRecoveryStatus = () => {
  const context = getEvidenceStorageContext();
  const rows = db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all();
  let sharedFiles = 0;
  let recoverableHere = 0;
  let missingFiles = 0;
  let sharedBytes = 0;
  let recoverableBytes = 0;
  const missingItems = [];
  rows.forEach((row) => {
    const relative = evidenceRelativePathFromRow(row);
    const canonical = context.automaticMirror
      ? resolveEvidenceCandidate(context.effectivePath, relative)
      : '';
    if (evidenceFileMatchesRecord(row, canonical)) {
      sharedFiles += 1;
      sharedBytes += Number(row.file_size || fs.statSync(canonical).size || 0);
      return;
    }
    const resolved = resolveEvidenceFilePathDetailed(row);
    if (context.automaticMirror && resolved.path && resolved.source !== 'drive-mirror') {
      recoverableHere += 1;
      recoverableBytes += Number(row.file_size || fs.statSync(resolved.path).size || 0);
      return;
    }
    missingFiles += 1;
    if (missingItems.length < 30) {
      missingItems.push({ id: row.id, fileName: row.file_name || '', studentId: row.student_id || '', relativePath: relative });
    }
  });
  return {
    automaticMirror: context.automaticMirror,
    effectivePath: context.effectivePath,
    legacyConfiguredPath: context.legacyConfiguredPath,
    totalRecords: rows.length,
    sharedFiles,
    sharedBytes,
    recoverableHere,
    recoverableBytes,
    missingFiles,
    missingItems,
  };
};

const getEvidenceRecoveryStatusSafely = () => {
  try {
    return getEvidenceRecoveryStatus();
  } catch (error) {
    const context = getEvidenceStorageContext();
    console.warn(`[evidencias] No se pudo calcular el estado de recuperacion: ${error?.message || error}`);
    return {
      automaticMirror: context.automaticMirror,
      effectivePath: context.effectivePath,
      totalRecords: 0,
      sharedFiles: 0,
      recoverableHere: 0,
      missingFiles: 0,
      statusUnavailable: true,
      message: 'El portal sigue disponible, pero no se pudo calcular temporalmente el estado de los archivos.',
    };
  }
};

app.get('/api/evidence-storage/config', (req, res) => {
  try {
    ensureGeneralDataReady();
    const context = getEvidenceStorageContext();
    ensureEvidenceMirrorRoot(context);
    res.json({
      success: true,
      data: {
        configuredPath: context.automaticMirror ? context.effectivePath : context.configuredPath,
        effectivePath: context.effectivePath,
        legacyConfiguredPath: context.legacyConfiguredPath,
        isConfigured: context.automaticMirror || !!context.configuredPath,
        automaticMirror: context.automaticMirror,
        exists: fs.existsSync(context.effectivePath),
        portalUrls: getStudentPortalUrls(),
        recovery: getEvidenceRecoveryStatusSafely(),
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/evidence-storage/config', (req, res) => {
  try {
    ensureGeneralDataReady();
    const currentContext = getEvidenceStorageContext();
    if (currentContext.automaticMirror) {
      ensureEvidenceMirrorRoot(currentContext);
      return res.json({
        success: true,
        message: 'El modo espejo administra automaticamente la carpeta de evidencias.',
        data: {
          configuredPath: currentContext.effectivePath,
          effectivePath: currentContext.effectivePath,
          automaticMirror: true,
          exists: true,
          portalUrls: getStudentPortalUrls(),
          recovery: getEvidenceRecoveryStatusSafely(),
        },
      });
    }
    const requestedPath = String(req.body?.path || '').trim();
    if (!requestedPath) return res.status(400).json({ success: false, message: 'Selecciona una carpeta.' });
    const resolved = path.resolve(requestedPath);
    ensureDir(resolved);
    const testFile = path.join(resolved, `.armi-write-test-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    const row = db.prepare('SELECT id FROM datos_generales ORDER BY id DESC LIMIT 1').get();
    db.prepare('UPDATE datos_generales SET evidence_storage_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(resolved, row.id);
    res.json({ success: true, data: { configuredPath: resolved, effectivePath: resolved, exists: true, portalUrls: getStudentPortalUrls() } });
  } catch (error) {
    res.status(500).json({ success: false, message: `No se puede usar esa carpeta: ${error.message}` });
  }
});

app.post('/api/evidence-storage/recover-to-mirror', requireLocalTeacherRequest, (req, res) => {
  try {
    const context = getEvidenceStorageContext();
    if (!context.automaticMirror) {
      return res.status(400).json({ success: false, message: 'Activa primero la sincronizacion por carpeta espejo.' });
    }
    ensureEvidenceMirrorRoot(context);
    const rows = db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all();
    const updatePortableReference = db.prepare(`
      UPDATE evaluacion_evidencias
      SET file_path = '', relative_path = ?, file_size = ?, updated_at = updated_at
      WHERE id = ?
    `);
    let recoveredFiles = 0;
    let recoveredBytes = 0;
    let alreadyShared = 0;
    const failures = [];

    rows.forEach((row) => {
      const relative = evidenceRelativePathFromRow(row);
      if (!relative) {
        failures.push({ id: row.id, fileName: row.file_name || '', reason: 'El registro no contiene una ruta relativa recuperable.' });
        return;
      }
      let portableRelative = relative;
      let destinationPath = path.resolve(context.effectivePath, portableRelative);
      const destinationCheck = path.relative(context.effectivePath, destinationPath);
      if (destinationCheck.startsWith('..') || path.isAbsolute(destinationCheck)) {
        failures.push({ id: row.id, fileName: row.file_name || '', reason: 'La ruta relativa no es segura.' });
        return;
      }
      if (fs.existsSync(destinationPath)) {
        const expectedSize = Number(row.file_size || 0);
        if (!expectedSize || Number(fs.statSync(destinationPath).size) === expectedSize) {
          updatePortableReference.run(relative, Number(fs.statSync(destinationPath).size), row.id);
          alreadyShared += 1;
          return;
        }
        const extension = path.extname(relative);
        const baseName = path.basename(relative, extension);
        portableRelative = path.join(path.dirname(relative), `${baseName}-recuperado-${row.id}${extension}`);
        destinationPath = path.resolve(context.effectivePath, portableRelative);
      }
      const source = resolveEvidenceFilePathDetailed(row);
      if (!source.path || source.source === 'drive-mirror') {
        failures.push({
          id: row.id,
          fileName: row.file_name || '',
          reason: 'El archivo original no esta disponible en esta PC. Ejecuta esta recuperacion en la PC donde los estudiantes lo subieron.',
        });
        return;
      }
      try {
        copyEvidenceToMirrorSafely(source.path, destinationPath);
        const copiedSize = Number(fs.statSync(destinationPath).size);
        updatePortableReference.run(portableRelative, copiedSize, row.id);
        recoveredFiles += 1;
        recoveredBytes += copiedSize;
      } catch (error) {
        failures.push({ id: row.id, fileName: row.file_name || '', reason: error?.message || 'No se pudo copiar.' });
      }
    });

    return res.json({
      success: failures.length === 0 || recoveredFiles > 0 || alreadyShared > 0,
      message: failures.length
        ? `Se protegieron ${recoveredFiles + alreadyShared} archivos; ${failures.length} siguen pendientes y sus enlaces se conservaron. Google Drive puede continuar subiendo las copias recuperadas.`
        : `Las ${recoveredFiles + alreadyShared} evidencias quedaron enlazadas a la carpeta espejo sin borrar los originales. Espera a que Google Drive indique que esta actualizado antes de apagar la PC.`,
      data: {
        recoveredFiles,
        recoveredBytes,
        alreadyShared,
        failures,
        recovery: getEvidenceRecoveryStatus(),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: `No se pudo recuperar las evidencias: ${error.message}` });
  }
});

app.get('/api/evidence-storage/pick-folder', (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ success: false, message: 'Selector nativo disponible solo en Windows.' });
  }
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$owner = New-Object System.Windows.Forms.Form',
    "$owner.Text = 'ARMI_EvidenceFolderOwner'",
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.Size = New-Object System.Drawing.Size(1, 1)',
    '$owner.ShowInTaskbar = $false',
    '$owner.TopMost = $true',
    '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
    '$owner.Opacity = 0.01',
    '$owner.Show()',
    '$owner.Activate()',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Seleccione la carpeta de evidencias de estudiantes'",
    '$dialog.ShowNewFolderButton = $true',
    '$result = $dialog.ShowDialog($owner)',
    '$owner.Close()',
    '$owner.Dispose()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }'
  ].join('; ');
  execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
    if (error) return res.status(500).json({ success: false, message: error.message });
    const selectedPath = String(stdout || '').trim();
    if (!selectedPath) return res.json({ success: false, cancelled: true });
    return res.json({ success: true, path: selectedPath });
  });
});



app.get('/api/sync/status/local', async (req, res) => {
  try {
    res.json(await getLocalSyncStatus());
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/estado-modulos', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM estado_modulos WHERE id = 1').get();
    const status = {};
    if (row) { Object.keys(row).forEach(k => { if (k !== 'id') status[k] = row[k] === 1; }); }
    res.json({ success: true, data: status });
  } catch { res.json({ success: true, data: {} }); }
});

app.post('/api/estado-modulos', (req, res) => {
  try {
    const updates = req.body;
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      const setClause = keys.map(k => `${k} = @${k}`).join(', ');
      const params = {};
      keys.forEach(k => params[k] = updates[k] ? 1 : 0);
      db.prepare(`UPDATE estado_modulos SET ${setClause} WHERE id = 1`).run(params);
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

const normalizeBirthDate = (value) => {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const calculateAgeFromBirthDate = (birthDate) => {
  const normalized = normalizeBirthDate(birthDate);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDiff = today.getMonth() - parsed.getMonth();
  const dayDiff = today.getDate() - parsed.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age >= 0 ? age : null;
};

app.get('/api/estudiantes', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM db_estudiantes ORDER BY estudiantes ASC').all();
    res.json({ success: true, data: rows.map(r => ({
      id: r.id, nivel: r.nivel, dni: r.dni, name: r.estudiantes, grade: r.grado, section: r.secc,
      fechaNacimiento: r.fecha_nacimiento || '',
      email: r.gmail, microsoft: r.outlook, estado: r.estado, group: r.grupo, sexo: r.sexo,
      edad: calculateAgeFromBirthDate(r.fecha_nacimiento) ?? r.edad,
      portalPasswordConfigured: Boolean(String(r.password_hash || '').trim())
    })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/estudiantes', (req, res) => {
  try {
    const s = req.body;
    const fechaNacimiento = normalizeBirthDate(s.fechaNacimiento);
    const edadCalculada = calculateAgeFromBirthDate(fechaNacimiento);
    const edad = edadCalculada ?? (String(s.edad || '').trim() ? Number(s.edad) : null);
    const mapped = {
      nivel: s.nivel,
      dni: s.dni,
      estudiantes: s.name,
      grado: s.grade,
      secc: s.section,
      fecha_nacimiento: fechaNacimiento,
      gmail: s.email,
      outlook: s.microsoft,
      estado: s.estado,
      grupo: s.group,
      sexo: s.sexo,
      edad,
    };
    if (s.id && !String(s.id).startsWith('import') && !String(s.id).startsWith('new-')) {
      const cols = Object.keys(mapped);
      const setClause = cols.map(c => `${c} = ?`).join(', ');
      db.prepare(`UPDATE db_estudiantes SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...Object.values(mapped), s.id);
    } else {
      const cols = Object.keys(mapped).join(', ');
      const placeholders = Object.keys(mapped).map(() => '?').join(', ');
      db.prepare(`INSERT INTO db_estudiantes (${cols}) VALUES (${placeholders})`).run(...Object.values(mapped));
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/estudiantes/:id/reset-portal-password', (req, res) => {
  try {
    const student = db.prepare('SELECT id, dni FROM db_estudiantes WHERE id = ?').get(req.params.id);
    if (!student) return res.status(404).json({ success: false, message: 'No se encontro el estudiante.' });
    const dni = String(student.dni || '').replace(/\D+/g, '');
    if (!dni) return res.status(400).json({ success: false, message: 'El estudiante necesita un DNI antes de restablecer su clave.' });
    db.prepare(`
      UPDATE db_estudiantes
      SET password_hash = NULL, password_changed_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(student.id);
    deleteStudentPortalSessions(student.id);
    return res.json({
      success: true,
      data: {
        studentId: student.id,
        initialPassword: dni,
        requiresPasswordChange: true,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/estudiantes/:id/open-test-portal', (req, res) => {
  try {
    const remoteAddress = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1') {
      return res.status(403).json({ success: false, message: 'El acceso de prueba solo puede iniciarse desde la PC del docente.' });
    }
    const student = db.prepare('SELECT id FROM db_estudiantes WHERE id = ?').get(req.params.id);
    if (!student) return res.status(404).json({ success: false, message: 'No se encontro el estudiante.' });
    const now = Date.now();
    const token = crypto.randomBytes(32).toString('hex');
    setPortalSessionToken(token, {
      studentId: String(student.id),
      mustChangePassword: false,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 10 * 60 * 1000,
    });
    return res.json({
      success: true,
      data: {
        url: `http://127.0.0.1:${STUDENT_PORTAL_PORT}/estudiante#teacherAccess=${encodeURIComponent(token)}`,
        expiresInMinutes: 10,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/estudiantes/:id', (req, res) => {
  try { db.prepare('DELETE FROM db_estudiantes WHERE id = ?').run(req.params.id); res.json({ success: true }); } 
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/egresados', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = db.prepare('SELECT * FROM db_egresados ORDER BY egresado_at DESC, estudiantes ASC').all();
    const mapped = rows.map((r) => ({
      id: r.id,
      sourceId: r.estudiante_id_origen,
      nivel: r.nivel,
      dni: r.dni,
      name: r.estudiantes,
      grade: r.grado,
      section: r.secc,
      fechaNacimiento: r.fecha_nacimiento || '',
      email: r.gmail,
      microsoft: r.outlook,
      estado: r.estado,
      group: r.grupo,
      sexo: r.sexo,
      edad: r.edad,
      egresadoAt: r.egresado_at
    }));
    const filtered = !q ? mapped : mapped.filter((row) =>
      String(row.dni || '').toLowerCase().includes(q) ||
      String(row.name || '').toLowerCase().includes(q)
    );
    res.json({ success: true, data: filtered });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/estudiantes/egresar', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id)) : [];
  if (ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron estudiantes para egresar.' });
  }
  try {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT * FROM db_estudiantes WHERE id IN (${placeholders})`).all(...ids);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No se encontraron estudiantes para egresar.' });
    }

    const insertGraduate = db.prepare(`
      INSERT INTO db_egresados (
        estudiante_id_origen, nivel, dni, estudiantes, grado, secc, fecha_nacimiento, gmail, outlook, estado, grupo, sexo, edad
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteStudent = db.prepare('DELETE FROM db_estudiantes WHERE id = ?');

    const tx = db.transaction((items) => {
      for (const row of items) {
        insertGraduate.run(
          String(row.id),
          row.nivel || '',
          row.dni || '',
          row.estudiantes || '',
          row.grado || '',
          row.secc || '',
          row.fecha_nacimiento || '',
          row.gmail || '',
          row.outlook || '',
          row.estado || '',
          row.grupo || '',
          row.sexo || '',
          row.edad ?? null
        );
        deleteStudent.run(row.id);
      }
    });

    tx(rows);
    res.json({ success: true, moved: rows.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/asistencia/rostros', (req, res) => {
  try {
    const grade = String(req.query.grade || '').trim();
    const section = String(req.query.section || '').trim();
    let sql = 'SELECT * FROM asistencia_rostros';
    const where = [];
    const params = [];
    if (grade) { where.push('grade = ?'); params.push(grade); }
    if (section) { where.push('section = ?'); params.push(section); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY student_name ASC, updated_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name,
        grade: r.grade,
        section: r.section,
        imageData: r.image_data,
        descriptor: r.descriptor,
        source: r.source,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/asistencia/rostros', (req, res) => {
  try {
    const body = req.body || {};
    const studentId = String(body.studentId || '').trim();
    const studentName = String(body.studentName || '').trim();
    const grade = String(body.grade || '').trim();
    const section = String(body.section || '').trim();
    const imageData = String(body.imageData || '').trim();
    const descriptor = String(body.descriptor || '').trim();
    const source = String(body.source || 'manual_capture').trim();
    if (!studentId || !studentName || !grade || !section || !imageData) {
      return res.status(400).json({ success: false, message: 'Faltan datos para registrar el rostro.' });
    }
    db.prepare(`
      INSERT INTO asistencia_rostros (
        student_id, student_name, grade, section, image_data, descriptor, source, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(studentId, studentName, grade, section, imageData, descriptor, source);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/asistencia/rostros/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'ID invalido para eliminar la muestra facial.' });
    }
    const result = db.prepare('DELETE FROM asistencia_rostros WHERE id = ?').run(id);
    res.json({ success: true, deleted: result.changes || 0 });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/asistencia/rostros', (req, res) => {
  try {
    const studentId = String(req.query.studentId || '').trim();
    const grade = String(req.query.grade || '').trim();
    const section = String(req.query.section || '').trim();
    if (!studentId || !grade || !section) {
      return res.status(400).json({ success: false, message: 'Faltan datos para reiniciar la base facial del estudiante.' });
    }
    const result = db.prepare('DELETE FROM asistencia_rostros WHERE student_id = ? AND grade = ? AND section = ?').run(studentId, grade, section);
    res.json({ success: true, deleted: result.changes || 0 });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/asistencia/registros', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    const grade = String(req.query.grade || '').trim();
    const section = String(req.query.section || '').trim();
    let sql = 'SELECT * FROM asistencia_registros';
    const where = [];
    const params = [];
    if (date) { where.push('attendance_date = ?'); params.push(date); }
    if (grade) { where.push('grade = ?'); params.push(grade); }
    if (section) { where.push('section = ?'); params.push(section); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY student_name ASC';
    const rows = db.prepare(sql).all(...params);
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        attendanceDate: r.attendance_date,
        grade: r.grade,
        section: r.section,
        studentId: r.student_id,
        studentName: r.student_name,
        dni: r.dni,
        status: r.status,
        markedAt: r.marked_at,
        source: r.source,
        notes: r.notes
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/asistencia/registros', (req, res) => {
  try {
    const body = req.body || {};
    const attendanceDate = String(body.attendanceDate || '').trim();
    const grade = String(body.grade || '').trim();
    const section = String(body.section || '').trim();
    const studentId = String(body.studentId || '').trim();
    const studentName = String(body.studentName || '').trim();
    const dni = String(body.dni || '').trim();
    const status = String(body.status || 'P').trim().toUpperCase();
    const source = String(body.source || 'manual').trim();
    const notes = String(body.notes || '').trim();
    if (!attendanceDate || !grade || !section || !studentId || !studentName) {
      return res.status(400).json({ success: false, message: 'Faltan datos para guardar la asistencia.' });
    }
    db.prepare(`
      INSERT INTO asistencia_registros (
        attendance_date, grade, section, student_id, student_name, dni, status, source, notes, marked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(attendance_date, grade, section, student_id) DO UPDATE SET
        student_name = excluded.student_name,
        dni = excluded.dni,
        status = excluded.status,
        source = excluded.source,
        notes = excluded.notes,
        marked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).run(attendanceDate, grade, section, studentId, studentName, dni, status, source, notes);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/resultados-diagnostico', (req, res) => {
  try {
    const { area, grado, seccion, anio, nivel } = req.query;
    const year = req.query['año'] || req.query['aÃ±o'] || req.query['anio'] || anio;
    const rows = db.prepare(`SELECT * FROM "resultados_diagnóstico" WHERE area = ? AND grado = ? AND seccion = ? AND "año" = ? AND nivel = ?`).all(area, grado, seccion, year, nivel);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/resultados-diagnostico', (req, res) => {
  try {
    const { results } = req.body;
    if (!results || !Array.isArray(results)) return res.json({ success: true, message: "Sin datos" });
    const transaction = db.transaction((list) => {
      const deleteOld = db.prepare(`DELETE FROM "resultados_diagnóstico" WHERE estudiante_id = ? AND area = ? AND competencia = ? AND "año" = ?`);
      const insert = db.prepare(`INSERT INTO "resultados_diagnóstico" (estudiante_id, estudiante_nombre, area, grado, seccion, nivel, competencia, nivel_logro, conclusion_descriptiva, "año") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of list) {
        const rYear = r?.['año'] ?? r?.['aÃ±o'] ?? r?.anio ?? r?.year;
        deleteOld.run(r.estudiante_id, r.area, r.competencia, rYear);
        insert.run(
          String(r.estudiante_id),
          r.estudiante_nombre,
          r.area,
          r.grado,
          r.seccion,
          r.nivel,
          r.competencia,
          r.nivel_logro || 'NE',
          r.conclusion_descriptiva || '',
          rYear
        );
      }
    });
    transaction(results);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/resultados-diagnostico', (req, res) => {
  try {
    const { area, grado, seccion, anio, nivel } = req.query;
    const year = req.query['año'] || req.query['aÃ±o'] || req.query['anio'] || anio;
    db.prepare(`DELETE FROM "resultados_diagnóstico" WHERE area = ? AND grado = ? AND seccion = ? AND "año" = ? AND nivel = ?`)
      .run(area, grado, seccion, year, nivel);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/* =====================================================
   MÓDULO EVALUACIÓN (NUEVO)
===================================================== */

const EVAL_DEFAULT_LAYOUT_STYLE = {
  bg: '#ffffff',
  color: '#0f172a',
  bold: false,
  italic: false,
  underline: false,
  orientation: 'normal',
  borderTop: true,
  borderRight: true,
  borderBottom: true,
  borderLeft: true,
  borderColor: '#cbd5e1',
  borderStyle: 'solid',
  borderWidth: 1,
  borderTopWidth: 1,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderLeftWidth: 1,
  align: 'left',
  vAlign: 'top'
};
const evalClamp = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};
const evalCellId = (r, c) => `${r}:${c}`;
const normalizeEvalStyle = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const align = ['left', 'center', 'right', 'justify'].includes(src.align) ? src.align : EVAL_DEFAULT_LAYOUT_STYLE.align;
  const vAlign = ['top', 'middle', 'bottom'].includes(src.vAlign) ? src.vAlign : EVAL_DEFAULT_LAYOUT_STYLE.vAlign;
  const orientation = ['normal', 'angle_up', 'angle_down', 'vertical', 'up', 'down'].includes(src.orientation)
    ? src.orientation
    : EVAL_DEFAULT_LAYOUT_STYLE.orientation;
  return {
    ...EVAL_DEFAULT_LAYOUT_STYLE,
    ...src,
    align,
    vAlign,
    orientation
  };
};
const normalizeEvalLayout = (rawLayout, wantedRows, wantedCols, expandStyles = false) => {
  const raw = rawLayout && typeof rawLayout === 'object' ? rawLayout : {};
  const rows = evalClamp(raw.rows, wantedRows, 2, 80);
  const cols = evalClamp(raw.cols, wantedCols, 2, 40);
  const rawTexts = raw.texts && typeof raw.texts === 'object' ? raw.texts : {};
  const rawStyles = raw.styles && typeof raw.styles === 'object' ? raw.styles : {};
  const texts = {};
  Object.entries(rawTexts).forEach(([key, val]) => {
    const [rs, cs] = String(key).split(':');
    const r = Number(rs);
    const c = Number(cs);
    if (Number.isFinite(r) && Number.isFinite(c) && r >= 0 && c >= 0 && r < rows && c < cols) {
      texts[evalCellId(r, c)] = String(val ?? '');
    }
  });
  const styles = {};
  Object.entries(rawStyles).forEach(([key, val]) => {
    const [rs, cs] = String(key).split(':');
    const r = Number(rs);
    const c = Number(cs);
    if (Number.isFinite(r) && Number.isFinite(c) && r >= 0 && c >= 0 && r < rows && c < cols) {
      styles[evalCellId(r, c)] = normalizeEvalStyle(val);
    }
  });
  if (expandStyles) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const id = evalCellId(r, c);
        if (!styles[id]) styles[id] = { ...EVAL_DEFAULT_LAYOUT_STYLE };
      }
    }
  }
  const merges = Array.isArray(raw.merges)
    ? raw.merges
        .map((m) => ({
          sr: evalClamp(m?.sr, 0, 0, rows - 1),
          sc: evalClamp(m?.sc, 0, 0, cols - 1),
          er: evalClamp(m?.er, 0, 0, rows - 1),
          ec: evalClamp(m?.ec, 0, 0, cols - 1)
        }))
        .map((m) => ({ ...m, sr: Math.min(m.sr, m.er), sc: Math.min(m.sc, m.ec), er: Math.max(m.sr, m.er), ec: Math.max(m.sc, m.ec) }))
    : [];
  return { rows, cols, texts, styles, merges };
};
const normalizeEvalInstrumentStructure = (type, rawStructure, expandStyles = false) => {
  const structure = rawStructure && typeof rawStructure === 'object' ? { ...rawStructure } : {};
  const safeType = String(type || structure.type || '').trim();
  const levels = Array.isArray(structure.levels) ? structure.levels : [];
  const criteria = Array.isArray(structure.criteria) ? structure.criteria : [];
  const items = Array.isArray(structure.items) ? structure.items : [];
  const aspects = Array.isArray(structure.aspects) ? structure.aspects : [];
  const scaleLabels = Array.isArray(structure?.scale?.labels) ? structure.scale.labels.filter(Boolean) : [];
  const capacitiesCount = evalClamp(
    structure.capacitiesCount ?? structure.aspectsCount ?? aspects.length,
    4,
    1,
    8
  );
  let wantedRows = 6;
  let wantedCols = 6;
  if (safeType === 'rubrica') {
    wantedRows = Math.max(2, criteria.length + 1);
    wantedCols = Math.max(3, levels.length + 2);
  } else if (safeType === 'lista_cotejo') {
    wantedRows = Math.max(2, items.length + 1);
    wantedCols = Math.max(5, Number(structure?.layout?.cols || 0));
  } else if (safeType === 'escala_valoracion') {
    wantedRows = Math.max(3, criteria.length + 2);
    wantedCols = Math.max(3, scaleLabels.length + 2);
  } else if (safeType === 'guia_observacion') {
    wantedRows = Math.max(3, Number(structure?.layout?.rows || 0), aspects.length + 2);
    wantedCols = Math.max(3, 2 + (capacitiesCount * 4) + 1);
  }
  const layout = normalizeEvalLayout(structure.layout, wantedRows, wantedCols, expandStyles);
  const texts = { ...(layout.texts || {}) };
  if (safeType === 'rubrica') {
    if (!texts[evalCellId(0, 0)]) texts[evalCellId(0, 0)] = 'Nro';
    if (!texts[evalCellId(0, 1)]) texts[evalCellId(0, 1)] = 'CRITERIO';
  } else if (safeType === 'lista_cotejo') {
    if (!texts[evalCellId(0, 0)]) texts[evalCellId(0, 0)] = 'Nro';
    if (!texts[evalCellId(0, 1)]) texts[evalCellId(0, 1)] = 'CRITERIOS OBSERVABLES';
    if (!texts[evalCellId(0, 2)]) texts[evalCellId(0, 2)] = 'Si';
    if (!texts[evalCellId(0, 3)]) texts[evalCellId(0, 3)] = 'NO';
    if (!texts[evalCellId(0, 4)]) texts[evalCellId(0, 4)] = 'OBSERVACIONES';
  } else if (safeType === 'escala_valoracion') {
    if (!texts[evalCellId(0, 0)]) texts[evalCellId(0, 0)] = 'Nro';
    if (!texts[evalCellId(0, 1)]) texts[evalCellId(0, 1)] = 'CRITERIOS';
  }
  return {
    ...structure,
    layout: {
      ...layout,
      texts
    }
  };
};
app.get('/api/evaluacion/instrumentos', (req, res) => {
  const { year, areaId, grade, section } = req.query;
  try {
    let sql = 'SELECT * FROM evaluacion_instrumentos WHERE 1=1';
    const params = [];
    if (year) { sql += ' AND year = ?'; params.push(year); }
    if (areaId) { sql += ' AND area_id = ?'; params.push(areaId); }
    if (grade) { sql += ' AND grade = ?'; params.push(grade); }
    if (section) { sql += ' AND section = ?'; params.push(section); }
    const rows = db.prepare(sql).all(...params);
    res.json({ success: true, data: rows.map((r) => ({ ...r, structure: normalizeEvalInstrumentStructure(r.type, JSON.parse(r.structure || '{}'), true) })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/evaluacion/instrumentos', (req, res) => {
  const { id, year, areaId, grade, section, type, name, structure, version } = req.body;
  const normalizedStructure = normalizeEvalInstrumentStructure(type, structure, false);
  try {
    if (id) {
      db.prepare(`
        UPDATE evaluacion_instrumentos SET
          year = ?, area_id = ?, grade = ?, section = ?,
          type = ?, name = ?, structure = ?, version = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(year, areaId, grade, section, type, name, JSON.stringify(normalizedStructure), version, id);
    } else {
      db.prepare(`
        INSERT INTO evaluacion_instrumentos (year, area_id, grade, section, type, name, structure, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(year, areaId, grade, section, type, name, JSON.stringify(normalizedStructure), version || 1);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/evaluacion/instrumentos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    const result = db.prepare('DELETE FROM evaluacion_instrumentos WHERE id = ?').run(id);
    res.json({ success: true, deleted: result.changes || 0 });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/evaluacion/registros', (req, res) => {
  const { studentId, sessionId, unitId } = req.query;
  const gradingMode = String(req.query.gradingMode || 'literal_traditional').trim();
  try {
    let sql = 'SELECT * FROM evaluacion_registros WHERE grading_mode = ?';
    const params = [gradingMode];
    if (studentId) { sql += ' AND student_id = ?'; params.push(studentId); }
    if (sessionId) { sql += ' AND session_id = ?'; params.push(sessionId); }
    if (unitId) { sql += ' AND unit_id = ?'; params.push(unitId); }
    const rows = db.prepare(sql).all(...params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/evaluacion/registros', (req, res) => {
  const { records } = req.body;
  const requestGradingMode = String(req.body?.gradingMode || 'literal_traditional').trim();
  try {
    const transaction = db.transaction((list) => {
      const del = db.prepare('DELETE FROM evaluacion_registros WHERE student_id = ? AND session_id = ? AND criteria_id = ? AND grading_mode = ?');
      const ins = db.prepare('INSERT INTO evaluacion_registros (student_id, session_id, unit_id, instrument_id, criteria_id, level, observation, grading_mode, numeric_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      
      for (const r of list) {
        const gradingMode = String(r.grading_mode || r.gradingMode || requestGradingMode || 'literal_traditional').trim();
        const numericScore = r.numeric_score === null || r.numeric_score === undefined || String(r.numeric_score).trim() === ''
          ? null
          : Number(r.numeric_score);
        if (numericScore !== null && (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 20)) {
          throw new Error(`La nota vigesimal debe estar entre 0 y 20 (estudiante ${r.student_id}, criterio ${r.criteria_id}).`);
        }

        del.run(r.student_id, r.session_id, r.criteria_id, gradingMode);
        const hasLevel = String(r.level || '').trim().length > 0;
        const hasObservation = String(r.observation || '').trim().length > 0;
        if (hasLevel || hasObservation || numericScore !== null) {
          ins.run(r.student_id, r.session_id, r.unit_id, r.instrument_id, r.criteria_id, r.level, r.observation, gradingMode, numericScore);
        }
      }
    });
    transaction(Array.isArray(records) ? records : []);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

const VALID_GRADING_MODES = new Set(['literal_traditional', 'criterial_predominance', 'hybrid_vigesimal']);

app.get('/api/evaluacion/modo-calificacion', (req, res) => {
  const year = String(req.query.year || '').trim();
  const areaId = String(req.query.areaId || '').trim();
  const grade = String(req.query.grade || '').trim();
  const section = String(req.query.section || '').trim();

  if (!year || !areaId) {
    return res.status(400).json({ success: false, message: 'Año y área son obligatorios.' });
  }

  try {
    const candidates = db.prepare(`
      SELECT *
      FROM evaluacion_modos_calificacion
      WHERE year = ? AND area_id = ?
        AND (grade = ? OR grade = '')
        AND (section = ? OR section = '')
      ORDER BY
        CASE WHEN grade = ? THEN 1 ELSE 0 END DESC,
        CASE WHEN section = ? THEN 1 ELSE 0 END DESC,
        updated_at DESC
      LIMIT 1
    `).get(year, areaId, grade, section, grade, section);

    res.json({
      success: true,
      data: candidates ? {
        year: candidates.year,
        areaId: candidates.area_id,
        grade: candidates.grade,
        section: candidates.section,
        gradingMode: candidates.grading_mode,
        effectiveFrom: candidates.effective_from || '',
        updatedAt: candidates.updated_at
      } : {
        year,
        areaId,
        grade,
        section,
        gradingMode: 'literal_traditional',
        effectiveFrom: ''
      }
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/evaluacion/modo-calificacion', (req, res) => {
  const year = String(req.body?.year || '').trim();
  const areaId = String(req.body?.areaId || '').trim();
  const grade = String(req.body?.grade || '').trim();
  const section = String(req.body?.section || '').trim();
  const gradingMode = String(req.body?.gradingMode || '').trim();
  const effectiveFrom = String(req.body?.effectiveFrom || '').trim() || null;

  if (!year || !areaId || !VALID_GRADING_MODES.has(gradingMode)) {
    return res.status(400).json({ success: false, message: 'Configuración de calificación inválida.' });
  }

  try {
    db.prepare(`
      INSERT INTO evaluacion_modos_calificacion (year, area_id, grade, section, grading_mode, effective_from)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(year, area_id, grade, section) DO UPDATE SET
        grading_mode = excluded.grading_mode,
        effective_from = excluded.effective_from,
        updated_at = CURRENT_TIMESTAMP
    `).run(year, areaId, grade, section, gradingMode, effectiveFrom);

    res.json({ success: true, data: { year, areaId, grade, section, gradingMode, effectiveFrom: effectiveFrom || '' } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/evaluacion/conclusiones', (req, res) => {
  const { year, areaId, grade, section, scopeType, scopeValue, studentId } = req.query;
  try {
    let sql = 'SELECT * FROM evaluacion_conclusiones WHERE 1=1';
    const params = [];
    if (year) { sql += ' AND year = ?'; params.push(String(year)); }
    if (areaId) { sql += ' AND area_id = ?'; params.push(String(areaId)); }
    if (grade) { sql += ' AND grade = ?'; params.push(String(grade)); }
    if (section) { sql += ' AND section = ?'; params.push(String(section)); }
    if (scopeType) { sql += ' AND scope_type = ?'; params.push(String(scopeType)); }
    if (scopeValue) { sql += ' AND scope_value = ?'; params.push(String(scopeValue)); }
    if (studentId) { sql += ' AND student_id = ?'; params.push(String(studentId)); }
    sql += ' ORDER BY student_id, competency_name, competency_key';

    const rows = db.prepare(sql).all(...params).map((row) => ({
      id: row.id,
      year: row.year || '',
      areaId: row.area_id || '',
      grade: row.grade || '',
      section: row.section || '',
      scopeType: row.scope_type || '',
      scopeValue: row.scope_value || '',
      studentId: row.student_id || '',
      competencyKey: row.competency_key || '',
      competencyName: row.competency_name || '',
      competencySource: row.competency_source || '',
      conclusionText: row.conclusion_text || '',
      updatedAt: row.updated_at || ''
    }));

    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/evaluacion/conclusiones', (req, res) => {
  const { records } = req.body || {};
  try {
    const list = Array.isArray(records) ? records : [];
    const transaction = db.transaction((items) => {
      const del = db.prepare(`
        DELETE FROM evaluacion_conclusiones
        WHERE year = ? AND area_id = ? AND grade = ? AND section = ?
          AND scope_type = ? AND scope_value = ? AND student_id = ? AND competency_key = ?
      `);
      const ins = db.prepare(`
        INSERT INTO evaluacion_conclusiones (
          year, area_id, grade, section, scope_type, scope_value,
          student_id, competency_key, competency_name, competency_source, conclusion_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        const year = String(item?.year || '').trim();
        const areaId = String(item?.areaId || '').trim();
        const grade = String(item?.grade || '').trim();
        const section = String(item?.section || '').trim();
        const scopeType = String(item?.scopeType || '').trim();
        const scopeValue = String(item?.scopeValue || '').trim();
        const studentId = String(item?.studentId || '').trim();
        const competencyKey = String(item?.competencyKey || '').trim();
        const competencyName = String(item?.competencyName || '').trim();
        const competencySource = String(item?.competencySource || '').trim();
        const conclusionText = String(item?.conclusionText || '').trim();

        if (!year || !areaId || !grade || !section || !scopeType || !scopeValue || !studentId || !competencyKey) {
          continue;
        }

        del.run(year, areaId, grade, section, scopeType, scopeValue, studentId, competencyKey);
        if (conclusionText) {
          ins.run(year, areaId, grade, section, scopeType, scopeValue, studentId, competencyKey, competencyName, competencySource, conclusionText);
        }
      }
    });

    transaction(list);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});



app.get('/api/evaluacion/configuracion', (req, res) => {
  const { year, areaId } = req.query;
  try {
    const row = db.prepare('SELECT * FROM evaluacion_configuracion WHERE year = ? AND area_id = ?').get(year, areaId);
    if (row) {
      res.json({
        success: true,
        data: {
          ...row,
          scale_data: JSON.parse(row.scale_data),
          weights: JSON.parse(row.weights)
        }
      });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/evaluacion/configuracion', (req, res) => {
  const { year, areaId, scaleType, scaleData, weights } = req.body;
  try {
    db.prepare(`
      INSERT INTO evaluacion_configuracion (year, area_id, scale_type, scale_data, weights)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(year, area_id) DO UPDATE SET
        scale_type = excluded.scale_type,
        scale_data = excluded.scale_data,
        weights = excluded.weights,
        updated_at = CURRENT_TIMESTAMP
    `).run(year, areaId, scaleType, JSON.stringify(scaleData), JSON.stringify(weights));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/programacion-anual', (req, res) => {
    try {
        const programs = db.prepare('SELECT * FROM programacion_anual').all();
        const dataMap = {};
        for (const p of programs) {
            const didacticUnits = {};
            for (let i = 1; i <= 8; i++) didacticUnits[i - 1] = { title: p[`titulo_u${i}`] || '', situation: p[`st_cont_u${i}`] || '' };
            const rec = db.prepare('SELECT * FROM programacion_recursos WHERE id_programa = ?').get(p.id_programa) || {};
            dataMap[p.id_programa] = { 
                id: p.id_programa, 
                nroPa: p.nro_pa || '', 
                areaId: p.area_id, 
                areaName: p.area_curricular, 
                grade: p.grade, 
                section: p.section, 
                matrixChecks: JSON.parse(p.matrix_checks || '{}'), 
                didacticUnits: didacticUnits, 
                areaPurpose: p.area_purpose || '', 
                areaEnfoque: p.area_enfoque || '',
                areaStandards: p.area_standards || '', 
                metas_datos: p.metas_datos || null,
                resourceFields: { medios: rec.medios || '', materiales: rec.materiales || '', recursos: rec.recursos || '', espacios: rec.espacios || '', apps: rec.apps || '', softwares: rec.softwares || '', plataformas: rec.plataformas || '' }, 
                bibliographyFields: { referencias: rec.referencias || '', linkografia: rec.linkografia || '' } 
            };
        }
        res.json({ success: true, data: dataMap });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/programacion-anual', (req, res) => {
    const d = req.body;
    const transaction = db.transaction(() => {
        const u = d.didacticUnits || {};
        const matrixStr = JSON.stringify(d.matrixChecks || {});
        const tempCurrStr = JSON.stringify(d.temp_curr_area || {});
        const metasDatosStr = d.metas_datos ? JSON.stringify(d.metas_datos) : null;
        
        db.prepare(`
            INSERT INTO programacion_anual (id_programa, nro_pa, area_id, area_curricular, grade, section, ugel, ie, lugar, duracion, docente, coord_ped, director, sub_director, coord_tut, area_purpose, area_enfoque, area_standards, caracterizacion_context, caracterizacion_adolecente, temp_curr_area, matrix_checks, resources_checks, inicio_bim_i, inicio_bim_ii, inicio_bim_iii, inicio_bim_iv, fin_bim_i, fin_bim_ii, fin_bim_iii, fin_bim_iv, titulo_u1, titulo_u2, titulo_u3, titulo_u4, titulo_u5, titulo_u6, titulo_u7, titulo_u8, st_cont_u1, st_cont_u2, st_cont_u3, st_cont_u4, st_cont_u5, st_cont_u6, st_cont_u7, st_cont_u8, alumnos, ciclo, horas_sem, metas_datos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id_programa) DO UPDATE SET nro_pa = excluded.nro_pa, area_id = excluded.area_id, area_curricular = excluded.area_curricular, ugel = excluded.ugel, ie = excluded.ie, lugar = excluded.lugar, duracion = excluded.duracion, docente = excluded.docente, coord_ped = excluded.coord_ped, director = excluded.director, sub_director = excluded.sub_director, coord_tut = excluded.coord_tut, area_purpose = excluded.area_purpose, area_enfoque = excluded.area_enfoque, area_standards = excluded.area_standards, caracterizacion_context = excluded.caracterizacion_context, caracterizacion_adolecente = excluded.caracterizacion_adolecente, temp_curr_area = excluded.temp_curr_area, matrix_checks = excluded.matrix_checks, inicio_bim_i = excluded.inicio_bim_i, inicio_bim_ii = excluded.inicio_bim_ii, inicio_bim_iii = excluded.inicio_bim_iii, inicio_bim_iv = excluded.inicio_bim_iv, fin_bim_i = excluded.fin_bim_i, fin_bim_ii = excluded.fin_bim_ii, fin_bim_iii = excluded.fin_bim_iii, fin_bim_iv = excluded.fin_bim_iv, titulo_u1=excluded.titulo_u1, titulo_u2=excluded.titulo_u2, titulo_u3=excluded.titulo_u3, titulo_u4=excluded.titulo_u4, titulo_u5=excluded.titulo_u5, titulo_u6=excluded.titulo_u6, titulo_u7=excluded.titulo_u7, titulo_u8=excluded.titulo_u8, st_cont_u1=excluded.st_cont_u1, st_cont_u2=excluded.st_cont_u2, st_cont_u3=excluded.st_cont_u3, st_cont_u4=excluded.st_cont_u4, st_cont_u5=excluded.st_cont_u5, st_cont_u6=excluded.st_cont_u6, st_cont_u7=excluded.st_cont_u7, st_cont_u8=excluded.st_cont_u8, alumnos = excluded.alumnos, ciclo = excluded.ciclo, horas_sem = excluded.horas_sem, metas_datos = excluded.metas_datos, updated_at = CURRENT_TIMESTAMP
        `).run(d.id, d.nroPa || '', d.areaId, d.areaName || '', d.grade, d.section, d.ugel || '', d.ie || '', d.lugar || '', d.duracion || '', d.docente || '', d.coord_ped || '', d.director || '', d.sub_director || '', d.coord_tut || '', d.areaPurpose || '', d.areaEnfoque || '', d.areaStandards || '', d.caracterizacion_context || '', d.caracterizacion_adolecente || '', tempCurrStr, matrixStr, JSON.stringify(d.resourcesChecks || {}), d.inicio_bim_i || '', d.inicio_bim_ii || '', d.inicio_bim_iii || '', d.inicio_bim_iv || '', d.fin_bim_i || '', d.fin_bim_ii || '', d.fin_bim_iii || '', d.fin_bim_iv || '', u[0]?.title || '', u[1]?.title || '', u[2]?.title || '', u[3]?.title || '', u[4]?.title || '', u[5]?.title || '', u[6]?.title || '', u[7]?.title || '', u[0]?.situation || '', u[1]?.situation || '', u[2]?.situation || '', u[3]?.situation || '', u[4]?.situation || '', u[5]?.situation || '', u[6]?.situation || '', u[7]?.situation || '', d.alumnos || 0, d.ciclo || '', d.horas_sem || 0, metasDatosStr);
        
        const rf = d.resourceFields || {}; const bf = d.bibliographyFields || {};
        db.prepare(`INSERT INTO programacion_recursos (id_programa, medios, materiales, recursos, espacios, apps, softwares, plataformas, referencias, linkografia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id_programa) DO UPDATE SET medios=excluded.medios, materiales=excluded.materiales, recursos=excluded.recursos, espacios=excluded.espacios, apps=excluded.apps, softwares=excluded.softwares, plataformas=excluded.plataformas, referencias=excluded.referencias, linkografia=excluded.linkografia`).run(d.id, rf.medios || '', rf.materiales || '', rf.recursos || '', rf.espacios || '', rf.apps || '', rf.softwares || '', rf.plataformas || '', bf.referencias || '', bf.linkografia || '');
    });
    try { transaction(); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ success: true, status: 'online' }));
app.get('/api/sync/status', async (req, res) => {
  try {
    res.json(await getSyncStatus());
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/frontend-state', (req, res) => {
  try {
    const snapshot = saveFrontendStateSnapshot(req.body?.state || {});
    res.json({ success: true, data: snapshot });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/config', async (req, res) => {
  try {
    res.json(await updateSyncConfig(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.get('/api/sync/resources/status', (_req, res) => {
  res.json(getResourceDeliveryStatus());
});
app.get('/api/sync/pick-folder', (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ success: false, message: 'El selector de carpetas esta disponible en Windows.' });
  }
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Selecciona Mi unidad de Google Drive o una carpeta dentro de ella para ARMI Docente'",
    '$dialog.ShowNewFolderButton = $true',
    '$result = $dialog.ShowDialog()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
    '$dialog.Dispose()'
  ].join('; ');
  execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
  }, (error, stdout) => {
    if (error) return res.status(500).json({ success: false, message: error.message });
    const selectedPath = String(stdout || '').trim();
    if (!selectedPath) return res.json({ success: false, cancelled: true });
    return res.json({ success: true, path: selectedPath });
  });
});
app.post('/api/sync/push', async (req, res) => {
  try {
    const evidenceIndex = reconcilePortableEvidenceIndex();
    const result = await pushToCloud(req.body || {});
    res.json({ ...result, data: result?.data ? { ...result.data, evidenceIndex } : result?.data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/pending/mark', async (req, res) => {
  try {
    res.json(await markPendingLocalBackup(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/pending/discard', async (req, res) => {
  try {
    res.json(await discardPendingLocalBackup());
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/pull', async (req, res) => {
  try {
    const result = await pullFromCloud(req.body || {});
    const evidenceIndex = result?.success ? reconcilePortableEvidenceIndex() : null;
    res.json({ ...result, data: result?.data ? { ...result.data, evidenceIndex } : result?.data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/artifact/pull', async (req, res) => {
  try {
    res.json(await pullCloudArtifact(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/artifact/apply', async (req, res) => {
  try {
    res.json(await applyCloudArtifact(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/artifact/merge-attendance', async (req, res) => {
  try {
    res.json(await mergeAttendanceFromCloudArtifact(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/artifact/merge-students', async (req, res) => {
  try {
    res.json(await mergeStudentsFromCloudArtifact(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/history/clear', async (req, res) => {
  try {
    res.json(await clearCloudVersionHistory());
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post('/api/sync/conflict/resolve', async (req, res) => {
  try {
    res.json(await resolveCloudConflict(req.body || {}));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.get('/api/admin/tables', (req, res) => { try { const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(); res.json({ success: true, data: rows.map(r => r.name) }); } catch (e) { res.status(500).json({ success: false }); } });
app.get('/api/admin/table-data', (req, res) => { const { table } = req.query; try { const rows = db.prepare(`SELECT * FROM "${table}" LIMIT 2000`).all(); res.json({ success: true, data: rows }); } catch (e) { res.status(500).json({ success: false }); } });
app.delete('/api/admin/delete-row', (req, res) => { const { table, id } = req.body; try { const pk = table === 'programacion_anual' ? 'id_programa' : table === 'sesiones' ? 'id_sesion' : table === 'unidades_didacticas' ? 'id_unidad' : 'id'; db.prepare(`DELETE FROM "${table}" WHERE ${pk} = ?`).run(id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });
app.post('/api/admin/update-row', (req, res) => { const { table, id, data } = req.body; try { const pk = table === 'programacion_anual' ? 'id_programa' : table === 'sesiones' ? 'id_sesion' : 'id'; const cols = Object.keys(data).filter(k => k !== pk && k !== 'updated_at'); const setClause = cols.map(c => `"${c}" = ?`).join(', '); const vals = cols.map(c => typeof data[c] === 'object' ? JSON.stringify(data[c]) : data[c]); db.prepare(`UPDATE "${table}" SET ${setClause} WHERE ${pk} = ?`).run(...vals, id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, message: e.message }); } });
app.delete('/api/admin/clear-table', (req, res) => { const { table } = req.body; try { db.prepare(`DELETE FROM "${table}"`).run(); if (table !== 'programacion_anual' && table !== 'programacion_recursos' && table !== 'sesiones') db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, message: e.message }); } });
app.post('/api/admin/bulk-import', (req, res) => {
    const { table, data } = req.body;
    if (!data || !Array.isArray(data) || data.length === 0) {
        return res.status(400).json({ success: false, message: 'No hay datos para importar.' });
    }

    try {
        const tableColumns = db.prepare(`PRAGMA table_info("${table}")`).all().map((col) => String(col.name));
        const normalizedColumnMap = new Map(
            tableColumns.map((column) => [
                superNormalize(column).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
                column
            ])
        );

        const aliasMapByTable = {
            db_enfoques: {
                'se demuestra cuando': 'se_demuestra_cuando',
                'se demuestra cuando:': 'se_demuestra_cuando',
                'se demuestra, cuando': 'se_demuestra_cuando',
                'se demuestra, cuando:': 'se_demuestra_cuando',
                'sedemuestracuando': 'se_demuestra_cuando'
            }
        };

        const aliasMap = aliasMapByTable[table] || {};
        const mapIncomingColumn = (incomingKey) => {
            const rawKey = String(incomingKey || '').trim();
            const normalizedKey = superNormalize(rawKey)
                .replace(/[_:;,.-]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (aliasMap[normalizedKey]) return aliasMap[normalizedKey];
            if (normalizedColumnMap.has(normalizedKey)) return normalizedColumnMap.get(normalizedKey);
            return null;
        };

        const mappedRows = data.map((row) => {
            const mapped = {};
            Object.entries(row || {}).forEach(([key, value]) => {
                const targetColumn = mapIncomingColumn(key);
                if (!targetColumn) return;
                mapped[targetColumn] = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
            });
            return mapped;
        }).filter((row) => Object.keys(row).length > 0);

        if (mappedRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Los encabezados del archivo no coinciden con la estructura de la tabla.' });
        }

        const columns = Object.keys(mappedRows[0]).filter((column) => tableColumns.includes(column));
        if (columns.length === 0) {
            return res.status(400).json({ success: false, message: 'No se detectaron columnas válidas para importar.' });
        }

        const stmt = db.prepare(
            `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`
        );
        const trans = db.transaction((rows) => {
            for (const row of rows) {
                stmt.run(...columns.map((column) => row[column] ?? null));
            }
        });
        trans(mappedRows);

        res.json({ success: true, message: `Importados ${mappedRows.length} registros.` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/competencias', (req, res) => { const { grado, area } = req.query; try { let rows = db.prepare('SELECT * FROM db_competencias').all(); if (grado) rows = rows.filter(r => superNormalize(r.grado).includes(superNormalize(grado))); if (area) rows = rows.filter(r => superNormalize(r.area).includes(superNormalize(area)) || superNormalize(r.competencias).includes(superNormalize(area))); res.json({ success: true, data: rows }); } catch (e) { res.status(500).json({ success: false }); } });
app.get('/api/estandares', (req, res) => { const { grado, area } = req.query; try { let rows = db.prepare('SELECT * FROM db_estandares').all(); if (grado) rows = rows.filter(r => superNormalize(r.grado || '').includes(superNormalize(grado))); if (area) rows = rows.filter(r => superNormalize(r.area || '').includes(superNormalize(area)) || superNormalize(r.competencias || '').includes(superNormalize(area))); res.json({ success: true, data: rows }); } catch (e) { res.status(500).json({ success: false }); } });
app.get('/api/areas', (req, res) => { try { res.json({ success: true, data: db.prepare('SELECT * FROM db_areas').all() }); } catch (e) { res.status(500).json({ success: false }); } });

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(`Error en ${req.method} ${req.path}:`, error);
  return res.status(500).json({ success: false, message: error?.message || 'Error interno del servidor.' });
});

app.get('/estudiante-assets/Logo_bar.ico', (_req, res) => res.sendFile(path.join(appRoot, 'src', 'Logo_bar.ico')));
app.use('/estudiante-iconos', express.static(path.join(appRoot, 'src', 'student-portal-icons'), { fallthrough: true, maxAge: 0 }));
app.use('/estudiante-assets', express.static(path.join(__dirname, 'public'), { fallthrough: false, maxAge: 0 }));
app.get(/^\/estudiante(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student-portal.html'));
});

// Vite middleware for development
const isProduction = process.env.NODE_ENV === 'production';
const useEmbeddedVite = process.env.ARMI_USE_VITE_MIDDLEWARE !== '0';
if (!isProduction && useEmbeddedVite) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else if (isProduction) {
  // Serve static files in production
  app.use(express.static(path.join(__dirname, '../dist')));
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

primaryHttpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVIDOR ACTIVO EN http://0.0.0.0:${PORT}`);
  console.log(`Portal estudiantil protegido en http://0.0.0.0:${STUDENT_PORTAL_PORT}/estudiante para hasta ${STUDENT_PORTAL_MAX_SESSIONS} sesiones activas.`);
});
primaryHttpServer.maxConnections = STUDENT_PORTAL_MAX_CONNECTIONS;
primaryHttpServer.keepAliveTimeout = 65_000;
primaryHttpServer.headersTimeout = 66_000;
if (STUDENT_PORTAL_PORT !== PORT) {
  studentHttpServer = app.listen(STUDENT_PORTAL_PORT, '0.0.0.0');
  studentHttpServer.maxConnections = STUDENT_PORTAL_MAX_CONNECTIONS;
  studentHttpServer.keepAliveTimeout = 65_000;
  studentHttpServer.headersTimeout = 66_000;
  studentHttpServer.requestTimeout = 10 * 60_000;
  studentHttpServer.on('error', (error) => {
    console.error(`No se pudo iniciar el portal estudiantil protegido en el puerto ${STUDENT_PORTAL_PORT}:`, error.message);
  });
}
}

const closeHttpServer = (server) => new Promise((resolve) => {
  if (!server?.listening) return resolve();
  server.close(() => resolve());
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    resolve();
  }, 4_000).unref?.();
});

const shutdownServer = async () => {
  if (serverShutdownPromise) return serverShutdownPromise;
  serverShutdownPromise = (async () => {
    if (evidenceReconciliationTimer) clearInterval(evidenceReconciliationTimer);
    evidenceReconciliationTimer = null;
    stopContinuousSync?.();
    stopContinuousSync = null;
    await shutdownRemoteAccess();
    await Promise.all([
      closeHttpServer(studentHttpServer),
      closeHttpServer(primaryHttpServer),
    ]);
    studentHttpServer = null;
    primaryHttpServer = null;
  })();
  return serverShutdownPromise;
};

const handleProcessShutdown = () => {
  void shutdownServer().finally(() => process.exit(0));
};

process.once('SIGTERM', handleProcessShutdown);
process.once('SIGINT', handleProcessShutdown);

startServer();

export { shutdownRemoteAccess, shutdownServer };

