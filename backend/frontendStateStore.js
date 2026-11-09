import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const excluded = new Set(['armi_auth_session_v1', 'armi_auth_session_runtime_v1', 'armi_purchase_request_v1', 'armi_purchase_config_v1', 'armi_cloud_sync_show_version_history']);
const allowed = (key) => key.startsWith('armi_') && !excluded.has(key) && key !== 'armi_profile_image' && !key.startsWith('armi_profile_image::');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file);
};

// Academic settings (timetable, assignments, calendar) must participate in the
// same per-row replication as the academic database, not only in manual ZIPs.
export const createFrontendStateStore = (db, snapshotPath) => {
  const observedPath = `${snapshotPath}.observed.json`;
  db.exec('CREATE TABLE IF NOT EXISTS armi_frontend_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)');
  const put = db.prepare('INSERT INTO armi_frontend_state(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE value IS NOT excluded.value');
  const insert = db.prepare('INSERT OR IGNORE INTO armi_frontend_state(key,value,updated_at) VALUES (?,?,?)');
  const importMissing = (snapshot) => {
    const stamp = snapshot?.exportedAt || new Date().toISOString();
    let imported = 0;
    db.transaction(() => {
      for (const [key, value] of Object.entries(snapshot?.keys || {})) {
        if (allowed(key) && typeof value === 'string' && !['', '[]', '{}', 'null'].includes(value.trim())) imported += insert.run(key, value, stamp).changes;
      }
    })();
    return imported;
  };
  const initial = read(snapshotPath, { keys: {} });
  if (Object.keys(initial.keys || {}).length && !fs.existsSync(`${snapshotPath}.before-portable.json`)) write(`${snapshotPath}.before-portable.json`, initial);
  importMissing(initial);
  if (!fs.existsSync(observedPath)) write(observedPath, initial);

  const snapshot = () => {
    const previous = read(snapshotPath, { keys: {} });
    const keys = {};
    for (const row of db.prepare('SELECT key,value FROM armi_frontend_state ORDER BY key').all()) {
      if (allowed(row.key) && row.value !== null) keys[row.key] = row.value;
    }
    if (JSON.stringify(previous.keys) === JSON.stringify(keys)) return { ...previous, unchanged: true };
    const result = { exportedAt: new Date().toISOString(), keys };
    write(snapshotPath, result);
    return result;
  };
  const observe = (keys, changedKeys = []) => {
    const previous = read(observedPath, { keys: {} }).keys || {};
    const explicit = new Set(changedKeys.filter(allowed));
    let changed = false;
    db.transaction(() => {
      for (const key of new Set([...Object.keys(keys), ...explicit])) {
        if (!allowed(key)) continue;
        const value = typeof keys[key] === 'string' ? keys[key] : null;
        if (!explicit.has(key) && (value === null || value === previous[key])) continue;
        // A new browser's empty defaults must not clear a populated remote key.
        if (!explicit.has(key) && ['', '[]', '{}', 'null'].includes(value?.trim())) continue;
        changed = put.run(key, value, new Date().toISOString()).changes > 0 || changed;
      }
    })();
    write(observedPath, { keys });
    return { ...snapshot(), unchanged: !changed };
  };
  const acknowledge = (keys) => write(observedPath, { keys });
  return { importMissing, snapshot, observe, acknowledge };
};
