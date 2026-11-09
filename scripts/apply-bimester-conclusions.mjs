import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { conclusionIdentity, draftBimesterConclusions } from './draft-bimester-conclusions.mjs';

const identity = row => [row.year, row.area_id, row.grade, row.section, row.scope_type, row.scope_value, row.student_id, row.competency_key].join('::');
const cacheKey = row => `armi_register_conclusions_bimester_${row.year}_${row.areaId}_${row.grade}_${row.section}_III`;
const digest = (db, table) => {
  const hash = crypto.createHash('sha256');
  for (const row of db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).iterate()) hash.update(JSON.stringify(row));
  return hash.digest('hex');
};

export async function applyBimesterConclusions({ databasePath, proposal, backupRoot }) {
  assert.ok(backupRoot, 'Se requiere una carpeta de respaldo.');
  assert.ok(proposal.rows.length > 0 && !proposal.summary.review, 'Hay casos sin resolver.');
  assert.ok(proposal.rows.every(row => row.year === '2026' && row.areaId === '1774917929135' && row.text && row.text.length <= 250));
  const db = new Database(databasePath, { fileMustExist: true, timeout: 10000 });
  let snapshot;
  try {
    const folder = path.resolve(backupRoot, `conclusiones-III-2026-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(folder, { recursive: true });
    const backup = path.join(folder, 'armi-before.db');
    await db.backup(backup);
    snapshot = new Database(backup, { readonly: true });
    const report = db.transaction(() => {
      const current = draftBimesterConclusions(db);
      assert.equal(current.signature, proposal.signature, 'Los datos cambiaron desde la propuesta. Vuelva a preparar el informe.');
      assert.deepEqual(current.rows, proposal.rows, 'La propuesta no coincide con los datos y reglas revisados.');
      const before = db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all();
      assert.deepEqual(before, snapshot.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all(), 'Las conclusiones cambiaron durante el respaldo.');
      const statesBefore = db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
      assert.deepEqual(statesBefore, snapshot.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all(), 'El estado cambió durante el respaldo.');
      const protectedTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('evaluacion_conclusiones','armi_frontend_state','sync_change_clock')").all().map(row => row.name);
      const protectedBefore = Object.fromEntries(protectedTables.map(table => [table, digest(db, table)]));
      const targetIds = new Set(proposal.rows.map(conclusionIdentity));
      const caches = new Map();
      const changes = proposal.rows.map(row => ({ identity: conclusionIdentity(row), student: row.studentName, competency: row.competencyName,
        before: before.find(item => identity(item) === conclusionIdentity(row)) || null, after: row.text, kind: row.kind }));
      fs.writeFileSync(path.join(folder, 'before.json'), JSON.stringify({ signature: proposal.signature, changes, cacheBefore: statesBefore.filter(row => proposal.rows.some(item => cacheKey(item) === row.key)) }, null, 2));
      const upsert = db.prepare(`INSERT INTO evaluacion_conclusiones (year,area_id,grade,section,scope_type,scope_value,student_id,competency_key,competency_name,competency_source,conclusion_text,updated_at)
        VALUES (@year,@areaId,@grade,@section,'bimester','III',@studentId,@competencyKey,@competencyName,@source,@text,@now)
        ON CONFLICT(year,area_id,grade,section,scope_type,scope_value,student_id,competency_key) DO UPDATE SET competency_name=excluded.competency_name,competency_source=excluded.competency_source,conclusion_text=excluded.conclusion_text,updated_at=excluded.updated_at`);
      const now = new Date().toISOString();
      for (const row of proposal.rows) {
        upsert.run({ ...row, now });
        const key = cacheKey(row);
        if (!caches.has(key)) caches.set(key, {});
        caches.get(key)[`${row.studentId}::${row.competencyKey}`] = row.text;
      }
      const saveCache = db.prepare('INSERT INTO armi_frontend_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
      for (const [key, value] of caches) saveCache.run(key, JSON.stringify(value), now);
      const after = db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all();
      assert.deepEqual(after.filter(row => !targetIds.has(identity(row))), before.filter(row => !targetIds.has(identity(row))), 'Se modificaron conclusiones ajenas al alcance.');
      for (const row of proposal.rows) assert.equal(after.find(item => identity(item) === conclusionIdentity(row))?.conclusion_text, row.text);
      const statesAfter = db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
      assert.deepEqual(statesAfter.filter(row => !caches.has(row.key)), statesBefore.filter(row => !caches.has(row.key)), 'Se modificaron preferencias o datos ajenos a las conclusiones.');
      for (const table of protectedTables) assert.equal(digest(db, table), protectedBefore[table], `Cambio no autorizado en ${table}`);
      assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
      return { applied: true, appliedAt: now, summary: proposal.summary, gradesChanged: 0, synchronizationClockMayAdvance: true, protectedTables, backup, audit: path.join(folder, 'before.json'), changes };
    }).immediate();
    fs.writeFileSync(path.join(folder, 'applied.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { snapshot?.close(); db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { db: { type: 'string' }, proposal: { type: 'string' }, 'backup-root': { type: 'string' } } });
  if (!values.db || !values.proposal || !values['backup-root']) throw new Error('Use --db archivo --proposal propuesta.json --backup-root carpeta.');
  if (process.platform === 'win32') {
    const check = spawnSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', windowsHide: true });
    assert.equal(check.status, 0);
    assert.equal(Number(check.stdout.trim()), 0, 'Cierre ARMI normalmente antes de aplicar las conclusiones.');
  }
  const report = await applyBimesterConclusions({ databasePath: path.resolve(values.db), proposal: JSON.parse(fs.readFileSync(values.proposal, 'utf8')), backupRoot: values['backup-root'] });
  console.log(JSON.stringify({ ...report, changes: report.changes.length }, null, 2));
}
