import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createAccessControlStore } from './accessControl.js';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const error = (status, message, code) => Object.assign(new Error(message), { status, code });
const cleanCode = value => String(value || '').replace(/[-\s]/g, '').toUpperCase();
export function effectiveAccessPolicy(config, deviceId) {
  const device = config.devices.find(row => row.id === deviceId);
  if (!device) throw error(401, 'El equipo ya no está autorizado.', 'extension-unauthorized');
  const domains = [...new Set(config.rules.filter(rule => rule.enabled && (rule.scope === 'all'
    || (rule.scope === 'group' && rule.groupId === device.groupId)
    || (rule.scope === 'devices' && rule.deviceIds.includes(device.id)))).flatMap(rule => rule.domains))].sort();
  if (domains.length > 10000) throw error(409, 'El equipo supera el máximo de 10.000 dominios. Reduce las reglas.', 'policy-too-large');
  const revision = sha(JSON.stringify({ protocol: 1, deviceId, domains }));
  return { protocol: 1, deviceId, deviceName: device.name, revision, domains, pollSeconds: 30 };
}

export function createAccessExtensionService({ db, runtimeFolder, localDatabase, now = Date.now }) {
  if (!localDatabase) fs.mkdirSync(runtimeFolder, { recursive: true });
  const local = localDatabase || new Database(path.join(runtimeFolder, 'access-extension.sqlite'));
  local.pragma('journal_mode = WAL');
  local.exec(`CREATE TABLE IF NOT EXISTS credentials (
    device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, paired_at INTEGER NOT NULL,
    last_seen_at INTEGER, applied_revision TEXT, applied_count INTEGER, extension_version TEXT, last_error TEXT);
    CREATE TABLE IF NOT EXISTS pairing_codes(code_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
  const store = createAccessControlStore(db);
  const readDevice = deviceId => effectiveAccessPolicy(store.read().config, deviceId);
  const generatePairing = deviceId => {
    readDevice(deviceId);
    const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = now() + 10 * 60_000;
    local.transaction(() => {
      local.prepare('DELETE FROM pairing_codes WHERE device_id=? OR expires_at<=?').run(deviceId, now());
      local.prepare('INSERT INTO pairing_codes VALUES(?,?,?)').run(sha(raw), deviceId, expiresAt);
    }).immediate();
    return { code: raw.match(/.{4}/g).join('-'), deviceId, expiresAt: new Date(expiresAt).toISOString() };
  };
  const pair = value => {
    const raw = cleanCode(value);
    if (!/^[A-F0-9]{12}$/.test(raw)) throw error(403, 'Código incorrecto, utilizado o vencido.', 'invalid-pairing-code');
    return local.transaction(() => {
      const code = local.prepare('SELECT * FROM pairing_codes WHERE code_hash=? AND expires_at>?').get(sha(raw), now());
      if (!code) throw error(403, 'Código incorrecto, utilizado o vencido.', 'invalid-pairing-code');
      const policy = readDevice(code.device_id);
      const token = crypto.randomBytes(32).toString('base64url');
      local.prepare('INSERT INTO credentials(device_id,token_hash,paired_at,last_seen_at) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET token_hash=excluded.token_hash,paired_at=excluded.paired_at,last_seen_at=excluded.last_seen_at,applied_revision=NULL,applied_count=NULL,last_error=NULL')
        .run(code.device_id, sha(token), now(), now());
      local.prepare('DELETE FROM pairing_codes WHERE device_id=?').run(code.device_id);
      return { token, policy };
    }).immediate();
  };
  const authenticate = token => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw error(401, 'Vinculación revocada o no válida.', 'extension-unauthorized');
    const credential = local.prepare('SELECT * FROM credentials WHERE token_hash=?').get(sha(token));
    if (!credential) throw error(401, 'Vinculación revocada o no válida.', 'extension-unauthorized');
    return { credential, policy: readDevice(credential.device_id) };
  };
  const policy = token => {
    const result = authenticate(token);
    local.prepare('UPDATE credentials SET last_seen_at=? WHERE device_id=?').run(now(), result.credential.device_id);
    return result.policy;
  };
  const acknowledge = (token, body) => {
    const { credential, policy: current } = authenticate(token);
    const version = String(body?.extensionVersion || '').slice(0, 30);
    if (body?.error) {
      local.prepare('UPDATE credentials SET last_seen_at=?,last_error=?,extension_version=? WHERE device_id=?').run(now(), String(body.error).slice(0, 300), version, credential.device_id);
      return { accepted: false };
    }
    if (body?.revision !== current.revision || body?.blockedCount !== current.domains.length) throw error(409, 'Hay una revisión nueva; vuelve a sincronizar.', 'policy-changed');
    local.prepare('UPDATE credentials SET last_seen_at=?,applied_revision=?,applied_count=?,extension_version=?,last_error=NULL WHERE device_id=?')
      .run(now(), current.revision, current.domains.length, version, credential.device_id);
    return { accepted: true };
  };
  const status = () => {
    const config = store.read().config;
    return config.devices.map(device => {
      const credential = local.prepare('SELECT * FROM credentials WHERE device_id=?').get(device.id);
      let current;
      try { current = effectiveAccessPolicy(config, device.id); }
      catch (e) { return { deviceId: device.id, paired: !!credential, online: false, state: 'error', error: e.message }; }
      return { deviceId: device.id, paired: !!credential, online: !!credential?.last_seen_at && now() - credential.last_seen_at < 120000,
        state: !credential ? 'unpaired' : credential.last_error ? 'error' : credential.applied_revision === current.revision ? 'applied' : 'pending',
        lastSeenAt: credential?.last_seen_at ? new Date(credential.last_seen_at).toISOString() : null,
        blockedCount: credential?.applied_count || 0, expectedCount: current.domains.length,
        extensionVersion: credential?.extension_version || null, error: credential?.last_error || null };
    });
  };
  const revoke = deviceId => local.transaction(() => {
    local.prepare('DELETE FROM credentials WHERE device_id=?').run(deviceId);
    local.prepare('DELETE FROM pairing_codes WHERE device_id=?').run(deviceId);
  }).immediate();
  return { generatePairing, pair, policy, acknowledge, status, revoke, close: () => { if (!localDatabase) local.close(); } };
}
