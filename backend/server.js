
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import db from './db.js';
import { appRoot, uploadsRoot, ensureDir } from './paths.js';
import programacionRoutes from './routes/programacionAnual.routes.js';
import programacionWordRoutes from './routes/programacionWord.routes.js';
import unidadWordRoutes from './routes/unidadWord.routes.js';
import sesionWordRoutes from './routes/sesionWord.routes.js';
import { checkPurchaseStatus, getAuthProviderInfo, getPurchaseConfig, loginUser, submitPurchase } from './auth.js';
import { applyCloudArtifact, clearCloudVersionHistory, discardPendingLocalBackup, getSyncStatus, markPendingLocalBackup, mergeAttendanceFromCloudArtifact, mergeStudentsFromCloudArtifact, pullCloudArtifact, pullFromCloud, pushToCloud, resolveCloudConflict, saveFrontendStateSnapshot, updateSyncConfig } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootFolder = appRoot;
const uploadsFolder = uploadsRoot;
const evidenceUploadsFolder = path.join(uploadsFolder, 'evaluacion-evidencias');
const remoteCameraSessions = new Map();
const REMOTE_CAMERA_TTL_MS = 1000 * 60 * 45;

ensureDir(evidenceUploadsFolder);

const getLanIpv4Addresses = () => {
  try {
    const interfaces = os.networkInterfaces();
    return Object.values(interfaces)
      .flat()
      .filter(Boolean)
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address);
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
  const app = express();
  const PORT = 3000;

// InicializaciÃ³n de tabla de plantillas si no existe
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
  "AMAZONAS", "ÃNCASH", "APURÃMAC", "AREQUIPA", "AYACUCHO", "CAJAMARCA",
  "CALLAO", "CUSCO", "HUANCAVELICA", "HUÃNUCO", "ICA", "JUNÃN",
  "LA LIBERTAD", "LAMBAYEQUE", "LIMA", "LORETO", "MADRE DE DIOS",
  "MOQUEGUA", "PASCO", "PIURA", "PUNO", "SAN MARTÃN",
  "TACNA", "TUMBES", "UCAYALI"
];

const superNormalize = (str) => {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9 Ã¡Ã©Ã­Ã³ÃºÃ±]/gi, "")
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
  return path.join(uploadsFolder, 'user-assets', 'profiles', safeUser, 'profile');
};

/* =========================
   MIDDLEWARE
========================= */

app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use('/uploads', express.static(uploadsFolder));

app.use((req, res, next) => {
  console.log(`ðŸ“© [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

app.post('/api/remote-camera/session', (req, res) => {
  cleanupRemoteCameraSessions();
  const sessionId = crypto.randomBytes(5).toString('hex');
  const addresses = getLanIpv4Addresses();
  const primaryAddress = addresses[0] || 'localhost';
  const phoneUrl = `http://${primaryAddress}:${PORT}/remote-camera/${sessionId}`;
  const createdAt = new Date().toISOString();
  remoteCameraSessions.set(sessionId, {
    id: sessionId,
    createdAt,
    updatedAt: Date.now(),
    lastFrameAt: null,
    imageData: '',
    width: 0,
    height: 0,
  });
  res.json({
    success: true,
    data: {
      sessionId,
      phoneUrl,
      lanAddresses: addresses,
      createdAt,
    },
  });
});

app.get('/api/remote-camera/session/:sessionId', (req, res) => {
  cleanupRemoteCameraSessions();
  const session = remoteCameraSessions.get(String(req.params.sessionId || ''));
  if (!session) {
    return res.status(404).json({ success: false, message: 'La sesion remota ya no existe o vencio.' });
  }
  return res.json({
    success: true,
    data: {
      sessionId: session.id,
      connected: Boolean(session.imageData),
      imageData: session.imageData || '',
      width: session.width || 0,
      height: session.height || 0,
      createdAt: session.createdAt,
      lastFrameAt: session.lastFrameAt,
    },
  });
});

app.post('/api/remote-camera/session/:sessionId/frame', (req, res) => {
  cleanupRemoteCameraSessions();
  const session = remoteCameraSessions.get(String(req.params.sessionId || ''));
  if (!session) {
    return res.status(404).json({ success: false, message: 'Sesion remota no encontrada.' });
  }
  const imageData = String(req.body?.imageData || '');
  if (!imageData.startsWith('data:image/')) {
    return res.status(400).json({ success: false, message: 'Frame invalido.' });
  }
  session.imageData = imageData;
  session.width = Number(req.body?.width || 0);
  session.height = Number(req.body?.height || 0);
  session.lastFrameAt = new Date().toISOString();
  session.updatedAt = Date.now();
  remoteCameraSessions.set(session.id, session);
  return res.json({ success: true, data: { lastFrameAt: session.lastFrameAt } });
});

app.delete('/api/remote-camera/session/:sessionId', (req, res) => {
  remoteCameraSessions.delete(String(req.params.sessionId || ''));
  return res.json({ success: true });
});

app.get('/remote-camera/:sessionId', (req, res) => {
  cleanupRemoteCameraSessions();
  const sessionId = String(req.params.sessionId || '');
  if (!remoteCameraSessions.has(sessionId)) {
    return res.status(404).send('<h1>Sesion remota no disponible</h1><p>Vuelve a generarla desde la PC.</p>');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(buildRemoteCameraHtml(sessionId));
});

app.get('/api/ip-camera/proxy', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ success: false, message: 'URL de camara invalida. Usa http:// o https://.' });
  }
  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'ARMI-Docente-IP-Camera',
      },
    });
  } catch (error) {
    return res.status(502).json({ success: false, message: 'No se pudo conectar con la camara IP del celular.' });
  }
  if (!upstream.ok || !upstream.body) {
    return res.status(502).json({ success: false, message: `La camara IP respondio con HTTP ${upstream.status}.` });
  }
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (contentType) res.setHeader('Content-Type', contentType);
  const cacheControl = upstream.headers.get('cache-control') || 'no-store, no-cache, must-revalidate';
  res.setHeader('Cache-Control', cacheControl);
  const fromWeb = Readable.fromWeb(upstream.body);
  fromWeb.on('error', () => {
    if (!res.headersSent) res.status(502).end();
    else res.end();
  });
  fromWeb.pipe(res);
});

  app.use('/api', programacionRoutes);
  app.use('/api', programacionWordRoutes);
  app.use('/api', unidadWordRoutes);
  app.use('/api', sesionWordRoutes);

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

app.post('/api/assets/image-file', (req, res) => {
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

    const extension = imageExtensionFromMime(parsed.mimeType);
    const baseTarget = resolveImageAssetTarget({ kind, userKey });
    const absolutePath = `${baseTarget}.${extension}`;
    ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, Buffer.from(parsed.base64, 'base64'));

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

/* =====================================================
   PLANTILLAS DE ÃREA (NUEVO)
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

app.get('/api/sesiones', (req, res) => {
  const { year, areaId, grade, section, unitNumber, sessionNumber } = req.query;
  try {
    if (year && areaId && grade && section && unitNumber && sessionNumber) {
        const id_sesion = `${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`;
        const row = db.prepare('SELECT * FROM sesiones WHERE id_sesion = ?').get(id_sesion);
        return res.json({ success: true, data: row ? JSON.parse(row.session_data) : null });
    }
    
    // Si no hay filtros especÃ­ficos, devolver lista para el gestor
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
            title: parsed.title || 'Sin TÃ­tulo'
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
   UNIDADES DIDÃCTICAS
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
          title: row.title || 'Sin TÃ­tulo'
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
   UBIGEO â€“ DATOS GENERALES â€“ ESTUDIANTES â€“ DIAGNÃ“STICO
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
    const data = db.prepare('SELECT * FROM datos_generales ORDER BY id DESC LIMIT 1').get();
    res.json({ success: true, data: data || {} });
  } catch { res.json({ success: true, data: {} }); }
});

app.post('/api/datos-generales', (req, res) => {
  try {
    const data = req.body;
    const dgColumns = db.prepare(`PRAGMA table_info(datos_generales)`).all();
    const hasManagementWeeksColumn = dgColumns.some(column => column.name === 'management_weeks_u1');
    if (!hasManagementWeeksColumn && Object.prototype.hasOwnProperty.call(data, 'management_weeks_u1')) {
      db.exec(`ALTER TABLE datos_generales ADD COLUMN management_weeks_u1 TEXT DEFAULT '0';`);
    }
    const ensureGeneralDataColumn = (col, type) => {
      const info = db.prepare(`PRAGMA table_info(datos_generales)`).all();
      if (!info.some((column) => column.name === col)) {
        db.exec(`ALTER TABLE datos_generales ADD COLUMN ${col} ${type}`);
      }
    };
    if (Object.prototype.hasOwnProperty.call(data, 'ai_pedagogical_route')) {
      ensureGeneralDataColumn('ai_pedagogical_route', `TEXT DEFAULT ''`);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'ai_institutional_problems')) {
      ensureGeneralDataColumn('ai_institutional_problems', `TEXT DEFAULT ''`);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'ai_unit_pedagogical_focus')) {
      ensureGeneralDataColumn('ai_unit_pedagogical_focus', `TEXT DEFAULT ''`);
    }
    const check = db.prepare('SELECT id FROM datos_generales LIMIT 1').get();
    if (check) {
      const keys = Object.keys(data).filter(k => k !== 'id');
      const setClause = keys.map(k => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE datos_generales SET ${setClause} WHERE id = @id`).run({ ...data, id: check.id });
    } else {
      const keys = Object.keys(data).filter(k => k !== 'id');
      const cols = keys.join(', ');
      const vals = keys.map(k => `@${k}`).join(', ');
      db.prepare(`INSERT INTO datos_generales (${cols}) VALUES (${vals})`).run(data);
    }
    try { db.prepare('UPDATE estado_modulos SET datos_generales = 1 WHERE id = 1').run(); } catch {}
    res.json({ success: true, message: 'Guardado OK' });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
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
      email: r.gmail, microsoft: r.outlook, estado: r.estado, group: r.grupo, sexo: r.sexo, edad: r.edad
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
   MÃ“DULO EVALUACIÃ“N (NUEVO)
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
      return res.status(400).json({ success: false, message: 'ID invÃ¡lido' });
    }
    const result = db.prepare('DELETE FROM evaluacion_instrumentos WHERE id = ?').run(id);
    res.json({ success: true, deleted: result.changes || 0 });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/evaluacion/registros', (req, res) => {
  const { studentId, sessionId, unitId } = req.query;
  try {
    let sql = 'SELECT * FROM evaluacion_registros WHERE 1=1';
    const params = [];
    if (studentId) { sql += ' AND student_id = ?'; params.push(studentId); }
    if (sessionId) { sql += ' AND session_id = ?'; params.push(sessionId); }
    if (unitId) { sql += ' AND unit_id = ?'; params.push(unitId); }
    const rows = db.prepare(sql).all(...params);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/evaluacion/registros', (req, res) => {
  const { records } = req.body;
  try {
    const transaction = db.transaction((list) => {
      const del = db.prepare('DELETE FROM evaluacion_registros WHERE student_id = ? AND session_id = ? AND criteria_id = ?');
      const ins = db.prepare('INSERT INTO evaluacion_registros (student_id, session_id, unit_id, instrument_id, criteria_id, level, observation) VALUES (?, ?, ?, ?, ?, ?, ?)');
      
      for (const r of list) {
        del.run(r.student_id, r.session_id, r.criteria_id);
        const hasLevel = String(r.level || '').trim().length > 0;
        const hasObservation = String(r.observation || '').trim().length > 0;
        if (hasLevel || hasObservation) {
          ins.run(r.student_id, r.session_id, r.unit_id, r.instrument_id, r.criteria_id, r.level, r.observation);
        }
      }
    });
    transaction(records);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/evaluacion/evidencias', (req, res) => {
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

    const rows = db.prepare(sql).all(...params).map((row) => ({
      id: row.id,
      year: row.year || '',
      areaId: row.area_id || '',
      grade: row.grade || '',
      section: row.section || '',
      bimester: row.bimester || '',
      unitNumber: row.unit_number || '',
      sessionNumber: row.session_number || '',
      studentId: row.student_id || '',
      criteriaId: row.criteria_id || '',
      observation: row.observation || '',
      studentIds: JSON.parse(row.student_ids || '[]'),
      studentNames: JSON.parse(row.student_names || '[]'),
      fileName: row.file_name || path.basename(row.file_path || ''),
      fileSize: Number(row.file_size || 0),
      fileType: row.file_type || '',
      filePath: row.file_path || '',
      fileUrl: row.file_path ? fileUrlFromAbsolutePath(row.file_path) : '',
      updatedAt: row.updated_at
    }));

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/evaluacion/evidencias', (req, res) => {
  const {
    id,
    year,
    areaId,
    grade,
    section,
    bimester,
    unitNumber,
    sessionNumber,
    studentIds,
    studentNames,
    criteriaId,
    fileName,
    fileType,
    fileSize,
    dataUrl,
    observation
  } = req.body || {};

  try {
    if (!year || !areaId || !grade || !section || !bimester || !unitNumber || !sessionNumber) {
      return res.status(400).json({ success: false, message: 'Faltan metadatos obligatorios.' });
    }
    if (!fileName || !dataUrl) {
      return res.status(400).json({ success: false, message: 'Falta el archivo de evidencia.' });
    }

    const match = String(dataUrl).match(/^data:(.*?);base64,(.*)$/);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Archivo invÃ¡lido.' });
    }

    const base64Data = match[2];
    const ext = path.extname(fileName) || '';
    const subFolder = path.join(
      evidenceUploadsFolder,
      safeSlug(year),
      safeSlug(areaId),
      safeSlug(grade),
      safeSlug(section),
      `U${safeSlug(unitNumber)}`,
      `S${safeSlug(sessionNumber)}`
    );
    fs.mkdirSync(subFolder, { recursive: true });

    let previous = null;
    if (id) previous = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);

    const finalName = `${Date.now()}-${safeSlug(path.basename(fileName, ext))}${ext}`;
    const absoluteFilePath = path.join(subFolder, finalName);
    fs.writeFileSync(absoluteFilePath, Buffer.from(base64Data, 'base64'));

    const firstStudentId = Array.isArray(studentIds) && studentIds.length > 0 ? String(studentIds[0]) : '';
    const sessionId = `${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`;

    if (id && previous) {
      db.prepare(`
        UPDATE evaluacion_evidencias SET
          student_id = ?, session_id = ?, criteria_id = ?,
          file_path = ?, file_type = ?, observation = ?,
          year = ?, area_id = ?, grade = ?, section = ?,
          bimester = ?, unit_number = ?, session_number = ?,
          student_ids = ?, student_names = ?, file_name = ?, file_size = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        firstStudentId,
        sessionId,
        String(criteriaId || ''),
        absoluteFilePath,
        fileType || '',
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
        fileName,
        Number(fileSize || 0),
        id
      );

      if (previous.file_path && previous.file_path !== absoluteFilePath && fs.existsSync(previous.file_path)) {
        try { fs.unlinkSync(previous.file_path); } catch {}
      }
    } else {
      db.prepare(`
        INSERT INTO evaluacion_evidencias (
          student_id, session_id, criteria_id,
          file_path, file_type, observation,
          year, area_id, grade, section, bimester, unit_number, session_number,
          student_ids, student_names, file_name, file_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        firstStudentId,
        sessionId,
        String(criteriaId || ''),
        absoluteFilePath,
        fileType || '',
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
        fileName,
        Number(fileSize || 0)
      );
    }

    const saved = id
      ? db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id)
      : db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = last_insert_rowid()').get();

    res.json({
      success: true,
      data: {
        id: saved.id,
        year: saved.year || '',
        areaId: saved.area_id || '',
        grade: saved.grade || '',
        section: saved.section || '',
        bimester: saved.bimester || '',
        unitNumber: saved.unit_number || '',
        sessionNumber: saved.session_number || '',
        studentId: saved.student_id || '',
        criteriaId: saved.criteria_id || '',
        observation: saved.observation || '',
        studentIds: JSON.parse(saved.student_ids || '[]'),
        studentNames: JSON.parse(saved.student_names || '[]'),
        fileName: saved.file_name || path.basename(saved.file_path || ''),
        fileSize: Number(saved.file_size || 0),
        fileType: saved.file_type || '',
        filePath: saved.file_path || '',
        fileUrl: saved.file_path ? fileUrlFromAbsolutePath(saved.file_path) : '',
        updatedAt: saved.updated_at
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/evaluacion/evidencias/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: 'ID invÃ¡lido' });
    }
    const row = db.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(id);
    if (!row) {
      return res.json({ success: true, deleted: 0 });
    }
    db.prepare('DELETE FROM evaluacion_evidencias WHERE id = ?').run(id);
    if (row.file_path && fs.existsSync(row.file_path)) {
      try { fs.unlinkSync(row.file_path); } catch {}
    }
    res.json({ success: true, deleted: 1 });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
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
app.post('/api/sync/push', async (req, res) => {
  try {
    res.json(await pushToCloud());
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
    res.json(await pullFromCloud(req.body || {}));
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`âœ… SERVIDOR ACTIVO EN http://0.0.0.0:${PORT}`);
});
}

startServer();

