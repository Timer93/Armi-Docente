import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { reconcileSessionCapacities } from '../backend/shared/sessionCapacityReconciliation.js';

// Dry run by default. Only labels inside session_data are updated; planning,
// criterion identity and every external grade/evidence table remain untouched.
const apply = process.argv.includes('--apply');
const databasePath = path.resolve(process.env.ARMI_DATA_ROOT || '.', 'database', 'armi.db');
const db = new Database(databasePath, { readonly: !apply, fileMustExist: true });
db.pragma('busy_timeout = 10000');
const scan = () => {
  const changes = [];
  let total = 0;
  for (const row of db.prepare('SELECT id_sesion, session_data FROM sesiones').all()) {
    total++;
    const data = JSON.parse(row.session_data || '{}');
    const repaired = reconcileSessionCapacities(data);
    if (JSON.stringify(data) !== JSON.stringify(repaired)) changes.push({ id: row.id_sesion, data: repaired });
  }
  return { total, changes };
};
const protectedDigest = () => {
  const hash = crypto.createHash('sha256');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'evaluacion_%' ORDER BY name").all();
  for (const { name } of tables) hash.update(JSON.stringify([name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]));
  return hash.digest('hex');
};
try {
  const initial = scan();
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', databasePath, total: initial.total, affected: initial.changes.length }));
  if (apply && initial.changes.length) {
    const directory = path.join(path.dirname(databasePath), 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(directory, `armi-before-session-capacities-${stamp}.db`);
    await db.backup(backupPath);
    const result = db.transaction(() => {
      const before = protectedDigest();
      // Re-read under the write transaction; do not replace a concurrent edit.
      const current = scan();
      const update = db.prepare('UPDATE sesiones SET session_data=?, updated_at=CURRENT_TIMESTAMP WHERE id_sesion=?');
      for (const row of current.changes) update.run(JSON.stringify(row.data), row.id);
      if (protectedDigest() !== before) throw new Error('Cambió una tabla de evaluación; se revierte la reparación.');
      if (scan().changes.length) throw new Error('La reparación no es idempotente; se revierte.');
      return { updated: current.changes.length, ids: current.changes.map(row => row.id), evaluationDigest: before };
    }).immediate();
    fs.writeFileSync(path.join(directory, `session-capacities-${stamp}.json`), JSON.stringify({ backupPath, ...result }, null, 2));
    console.log(JSON.stringify({ backupPath, updated: result.updated, evaluationTablesUnchanged: true, pendingSafeRepairs: 0 }));
  }
} finally {
  db.close();
}
