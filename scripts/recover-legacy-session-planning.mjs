import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { findPlanningUnit } from '../backend/unitSessionPlanningSync.js';
import { buildUnitSessionPlanning } from '../backend/shared/unitSessionPlanning.js';
import { recoverLegacySessionPlanning } from '../backend/shared/sessionPlanningRecovery.js';

const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const databasePath = path.resolve(argument('--database') || path.join(process.env.ARMI_DATA_ROOT || '.', 'database', 'armi.db'));
const sourcePath = argument('--source');
if (!sourcePath) throw new Error('Indica --source con el respaldo anterior a la vinculación.');
if (path.resolve(sourcePath) === databasePath) throw new Error('La fuente y el destino deben ser distintos.');
const apply = process.argv.includes('--apply');
const seedBaselines = process.argv.includes('--seed-baselines');
const db = new Database(databasePath, { readonly: !apply, fileMustExist: true });
const source = new Database(path.resolve(sourcePath), { readonly: true, fileMustExist: true });
db.pragma('busy_timeout=10000');
const scan = () => {
  const changes = [];
  let recovered = 0, baselined = 0, fieldCount = 0;
  for (const lesson of db.prepare('SELECT * FROM sesiones').all()) {
    const saved = JSON.parse(lesson.session_data);
    const previous = source.prepare('SELECT session_data FROM sesiones WHERE id_sesion=?').get(lesson.id_sesion);
    const unit = findPlanningUnit(db, lesson);
    const planning = buildUnitSessionPlanning(unit, lesson.session_number);
    let { data, fields } = previous ? recoverLegacySessionPlanning(saved, JSON.parse(previous.session_data), planning) : { data: saved, fields: [] };
    if (fields.length) { recovered++; fieldCount += fields.length; }
    // Adopt the exact current unit baseline, without merging any lesson text.
    // This also prevents the old installed reader from performing a destructive
    // first link before the application receives the updated implementation.
    if (seedBaselines && planning && !saved.unitPlanningSnapshot) {
      data = { ...data, unitPlanningSnapshot: planning };
      baselined++;
    }
    if (data !== saved) changes.push({ id: lesson.id_sesion, data, fields });
  }
  return { changes, recovered, baselined, fieldCount };
};
const protectedDigest = () => {
  const hash = crypto.createHash('sha256');
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'armi_sync_%' AND name NOT LIKE '%sync%' AND name <> 'sesiones' ORDER BY name").all()) {
    hash.update(JSON.stringify([name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]));
  }
  return hash.digest('hex');
};
try {
  const plan = scan();
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', databasePath, recoveredSessions: plan.recovered, restoredFields: plan.fieldCount, baselineOnlySessions: plan.baselined, recovered: plan.changes.filter(row => row.fields.length).map(row => ({ id: row.id, restored: row.fields.length })) }));
  if (apply && plan.changes.length) {
    const directory = path.join(path.dirname(databasePath), 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(directory, `armi-before-planning-recovery-${stamp}.db`);
    await db.backup(backupPath);
    const applied = db.transaction(() => {
      const before = protectedDigest();
      const fresh = scan();
      const update = db.prepare('UPDATE sesiones SET session_data=?, updated_at=CURRENT_TIMESTAMP WHERE id_sesion=?');
      for (const row of fresh.changes) update.run(JSON.stringify(row.data), row.id);
      if (before !== protectedDigest()) throw new Error('Cambió otra tabla. Se revierte toda la recuperación.');
      if (scan().changes.length) throw new Error('La reparación no es idempotente. Se revierte.');
      return { recoveredSessions: fresh.recovered, restoredFields: fresh.fieldCount, baselineOnlySessions: fresh.baselined, audit: fresh.changes.map(({ id, fields }) => ({ id, fields })), protectedDigest: before };
    }).immediate();
    fs.writeFileSync(path.join(directory, `planning-recovery-${stamp}.json`), JSON.stringify({ sourcePath: path.resolve(sourcePath), backupPath, ...applied }, null, 2));
    console.log(JSON.stringify({ backupPath, recoveredSessions: applied.recoveredSessions, restoredFields: applied.restoredFields, initializedBaselines: applied.baselineOnlySessions, otherTablesUnchanged: true }));
  }
} finally { source.close(); db.close(); }
