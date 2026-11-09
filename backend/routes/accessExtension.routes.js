import { Router } from 'express';

export function createAccessExtensionRouter(service, { now = Date.now } = {}) {
  const router = Router();
  const attempts = new Map();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  if (!service) {
    router.use((_req, res) => res.status(503).json({ success: false, code: 'extension-unavailable', message: 'El servicio de extensiones no está disponible. Se conservan las reglas anteriores.' }));
    return router;
  }
  const failure = (res, err) => res.status(err.status || 500).json({ success: false, code: err.code || 'extension-error', message: err.status ? err.message : 'No se pudo atender la extensión.' });
  router.post('/pair', (req, res) => {
    const address = String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    const source = ['127.0.0.1', '::1'].includes(address) ? String(req.headers['cf-connecting-ip'] || address) : address;
    for (const [key, value] of attempts) if (value.expiresAt <= now()) attempts.delete(key);
    if (!attempts.has(source) && attempts.size >= 5000) return res.status(429).json({ success: false, message: 'Espera antes de volver a intentar.' });
    const entry = attempts.get(source) || { count: 0, expiresAt: now() + 300000 };
    if (entry.count >= 20) return res.status(429).json({ success: false, message: 'Demasiados intentos. Espera cinco minutos.' });
    try { const data = service.pair(req.body?.code); res.json({ success: true, data }); }
    catch (error) { entry.count++; attempts.set(source, entry); failure(res, error); }
  });
  const token = req => String(req.headers.authorization || '').replace(/^Bearer /, '');
  router.get('/policy', (req, res) => {
    try { res.json({ success: true, data: service.policy(token(req)) }); }
    catch (error) { failure(res, error); }
  });
  router.post('/ack', (req, res) => {
    try { res.json({ success: true, data: service.acknowledge(token(req), req.body) }); }
    catch (error) { failure(res, error); }
  });
  return router;
}
