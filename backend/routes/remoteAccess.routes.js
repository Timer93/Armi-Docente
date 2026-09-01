import express from 'express';
import { requireLocalTeacherRequest } from '../evidenceStorage.js';
import {
  configureRemoteAccess,
  getRemoteAccessSnapshot,
  restartRemoteAccess,
  startRemoteAccess,
  stopRemoteAccess,
} from '../remote-access/remoteAccessService.js';
import { getStudentPresenceSummary } from '../remote-access/studentPresenceService.js';

const router = express.Router();

const respond = async (res, operation) => {
  try {
    const data = await operation();
    const success = data.tunnelStatus !== 'ERROR';
    return res.status(success ? 200 : 503).json({
      success,
      data,
      message: success ? '' : data.lastError || 'No se pudo completar la operacion.',
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      success: false,
      message: error?.message || 'No se pudo completar la operacion.',
    });
  }
};

const acceptBackgroundOperation = (res, operation, message) => {
  const pending = operation();
  setImmediate(async () => {
    try {
      const data = await getRemoteAccessSnapshot();
      if (!res.headersSent) res.status(202).json({ success: true, data, message });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: error?.message || 'No se pudo iniciar la operacion.' });
      }
    }
  });
  void pending.catch(() => {});
};

router.get('/remote-access/status', requireLocalTeacherRequest, (_req, res) => (
  respond(res, () => getRemoteAccessSnapshot({ refresh: true }))
));

router.get('/remote-access/students', requireLocalTeacherRequest, (_req, res) => {
  res.json({ success: true, data: getStudentPresenceSummary() });
});

router.post('/remote-access/config', requireLocalTeacherRequest, (req, res) => (
  respond(res, () => configureRemoteAccess(req.body || {}))
));

router.post('/remote-access/start', requireLocalTeacherRequest, (_req, res) => {
  acceptBackgroundOperation(res, startRemoteAccess, 'ARMI esta creando y verificando el enlace por Internet.');
});

router.post('/remote-access/restart', requireLocalTeacherRequest, (_req, res) => {
  acceptBackgroundOperation(res, restartRemoteAccess, 'ARMI esta intentando crear un nuevo enlace por Internet.');
});

router.post('/remote-access/stop', requireLocalTeacherRequest, (_req, res) => (
  respond(res, stopRemoteAccess)
));

export default router;
