import express from 'express';
import crypto from 'crypto';
import os from 'os';
import { Readable } from 'stream';

const router = express.Router();
const publicRouter = express.Router();
const remoteCameraSessions = new Map();
const REMOTE_CAMERA_TTL_MS = 1000 * 60 * 45;

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

publicRouter.get('/remote-camera/:sessionId', (req, res) => {
  cleanupRemoteCameraSessions();
  const sessionId = String(req.params.sessionId || '');
  if (!remoteCameraSessions.has(sessionId)) {
    return res.status(404).send('La sesión remota ya no existe o venció.');
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.type('html').send(buildRemoteCameraHtml(sessionId));
});

router.post('/remote-camera/session', (req, res) => {
  cleanupRemoteCameraSessions();
  const sessionId = crypto.randomBytes(5).toString('hex');
  const addresses = getLanIpv4Addresses();
  const primaryAddress = addresses[0] || 'localhost';
  const PORT = Number(process.env.ARMI_BACKEND_PORT || 3000);
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

router.get('/remote-camera/session/:sessionId', (req, res) => {
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

router.post('/remote-camera/session/:sessionId/frame', (req, res) => {
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

router.delete('/remote-camera/session/:sessionId', (req, res) => {
  remoteCameraSessions.delete(String(req.params.sessionId || ''));
  return res.json({ success: true });
});

router.get('/ip-camera/proxy', async (req, res) => {
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

export { buildRemoteCameraHtml, cleanupRemoteCameraSessions, remoteCameraSessions, publicRouter as remoteCameraPublicRoutes };
export default router;
