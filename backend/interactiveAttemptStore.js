import crypto from 'node:crypto';

export const PRACTICE_PERIOD_MS = 5 * 60 * 1000;
export const isMobilePracticeDevice = (userAgent = '', device = {}) =>
  /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(userAgent)
  || device.mobile === true
  || /Android|iOS|iPadOS/i.test(String(device.platform || ''))
  || (/arm|aarch64/i.test(String(device.platform || '')) && Number(device.maxTouchPoints) > 0)
  || (Number(device.maxTouchPoints) > 1 && /Macintosh/i.test(userAgent))
  || (Number(device.maxTouchPoints) > 0 && Number(device.screenShortSide) > 0 && Number(device.screenShortSide) <= 600);

export const createInteractiveAttemptStore = (db, { now = Date.now, periodMs = PRACTICE_PERIOD_MS } = {}) => {
  db.exec(`CREATE TABLE IF NOT EXISTS interactive_activity_attempts (
    session_id TEXT NOT NULL, activity_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_key TEXT NOT NULL,
    status TEXT NOT NULL, stage INTEGER NOT NULL DEFAULT 1, deadline_ms INTEGER NOT NULL,
    token TEXT NOT NULL, checkpoint_json TEXT NOT NULL DEFAULT '{}', close_reason TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL, PRIMARY KEY(session_id,activity_id,scope_type,scope_key)
  )`);
  const args = (key) => [key.sessionId, key.activityId, key.mode, key.scopeKey];
  const read = (key) => db.prepare('SELECT * FROM interactive_activity_attempts WHERE session_id=? AND activity_id=? AND scope_type=? AND scope_key=?').get(...args(key));
  const update = (key, status, reason = '') => db.prepare('UPDATE interactive_activity_attempts SET status=?,close_reason=?,updated_at=? WHERE session_id=? AND activity_id=? AND scope_type=? AND scope_key=?')
    .run(status, reason, new Date(now()).toISOString(), ...args(key));
  const get = (key) => {
    let row = read(key);
    if (row?.status === 'running' && now() >= row.deadline_ms) {
      update(key, row.stage === 1 ? 'paused' : 'expired', row.stage === 1 ? 'first-period-ended' : 'time-ended');
      row = read(key);
    }
    return row;
  };
  const publicState = (row, includeToken = false) => row ? {
    status: row.status, stage: row.stage, deadline: row.deadline_ms, serverNow: now(),
    checkpoint: JSON.parse(row.checkpoint_json), reason: row.close_reason,
    ...(includeToken ? { token: row.token } : {}),
  } : { status: 'ready', stage: 1, serverNow: now(), checkpoint: {} };
  const fail = (message) => { const error = new Error(message); error.statusCode = 409; throw error; };
  const requireRunning = (key, token) => {
    const row = get(key);
    if (!row || row.token !== token) fail('Este intento no pertenece a esta ventana.');
    if (row.status !== 'running') fail('El intento ya terminó o agotó su tiempo. No puede reiniciarse.');
    return row;
  };
  const start = db.transaction((key) => {
    if (get(key)) fail('La práctica ya fue iniciada. No se permite comenzar de nuevo.');
    db.prepare(`INSERT INTO interactive_activity_attempts(session_id,activity_id,scope_type,scope_key,status,stage,deadline_ms,token,updated_at)
      VALUES(?,?,?,?,'running',1,?,?,?)`).run(...args(key), now() + periodMs, crypto.randomUUID(), new Date(now()).toISOString());
    return publicState(read(key), true);
  });
  const save = (key, token, checkpoint) => {
    requireRunning(key, token);
    const encoded = JSON.stringify(checkpoint);
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint) || Buffer.byteLength(encoded) > 100_000) fail('El avance recibido no es válido o supera 100 KB.');
    db.prepare('UPDATE interactive_activity_attempts SET checkpoint_json=?,updated_at=? WHERE session_id=? AND activity_id=? AND scope_type=? AND scope_key=?')
      .run(encoded, new Date(now()).toISOString(), ...args(key));
    return publicState(read(key));
  };
  const grant = db.transaction((key) => {
    const row = get(key);
    if (row?.status !== 'paused' || row.stage !== 1) fail('Solo se pueden ampliar una vez los primeros 5 minutos agotados.');
    db.prepare("UPDATE interactive_activity_attempts SET status='extension_ready',stage=2,updated_at=? WHERE session_id=? AND activity_id=? AND scope_type=? AND scope_key=?")
      .run(new Date(now()).toISOString(), ...args(key));
    return publicState(read(key));
  });
  const resume = db.transaction((key) => {
    if (get(key)?.status !== 'extension_ready') fail('No hay una ampliación autorizada.');
    db.prepare("UPDATE interactive_activity_attempts SET status='running',deadline_ms=?,token=?,updated_at=? WHERE session_id=? AND activity_id=? AND scope_type=? AND scope_key=?")
      .run(now() + periodMs, crypto.randomUUID(), new Date(now()).toISOString(), ...args(key));
    return publicState(read(key), true);
  });
  const complete = (key, token) => { requireRunning(key, token); update(key, 'completed', 'submitted'); };
  const abandon = (key, token) => {
    const row = get(key);
    if (!row || row.token !== token) fail('Este intento no pertenece a esta ventana.');
    if (['running', 'paused', 'extension_ready'].includes(row.status)) update(key, 'abandoned', 'student-left');
    return publicState(read(key));
  };
  const reset = (key) => db.prepare('DELETE FROM interactive_activity_attempts WHERE session_id=? AND activity_id=? AND scope_type=? AND scope_key=?').run(...args(key));
  return { get, publicState, start, save, grant, resume, complete, abandon, reset, requireRunning };
};
