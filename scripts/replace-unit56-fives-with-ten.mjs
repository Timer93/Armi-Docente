import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { hybridGradeIssue } from '../backend/shared/hybridGradeIntegrity.js';

const CACHE_KEY = 'armi_hybrid_numeric_scores_v1';
const cacheKey = row => `${row.session_id}::${row.student_id}::${row.criteria_id}`;
const digest = (db, table) => {
  const hash = crypto.createHash('sha256');
  for (const row of db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).iterate()) hash.update(JSON.stringify(row));
  return hash.digest('hex');
};

export async function replaceUnit56Fives({ databasePath, apply = false, backupRoot }) {
  const db = new Database(databasePath, { readonly: !apply, fileMustExist: true, timeout: 10000 });
  let backupDb;
  try {
    const sessions = db.prepare("SELECT * FROM sesiones WHERE year='2026' AND unit_number IN ('5','6')").all();
    const sessionIds = new Set(sessions.map(row => row.id_sesion));
    const getAll = () => db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
    const select = rows => rows.filter(row => sessionIds.has(row.session_id) && row.grading_mode === 'hybrid_vigesimal' && row.numeric_score === 5);
    const selected = select(getAll());
    for (const row of selected) assert.equal(hybridGradeIssue({ ...row, numeric_score: 10 }), '', `Review inconsistent grade ${row.id}`);
    const plan = { applied: false, scope: { year: '2026', units: [5, 6], subjects: 'area_and_transversal' }, from: 5, to: 10, changedGrades: selected.length, students: new Set(selected.map(row => String(row.student_id))).size };
    if (!apply || !selected.length) return plan;
    assert.ok(backupRoot, 'A full backup is required before changing grades');
    const folder = path.resolve(backupRoot, `notas-5-a-10-III-2026-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(folder, { recursive: true });
    const backup = path.join(folder, 'armi-before.db');
    await db.backup(backup);
    backupDb = new Database(backup, { readonly: true, fileMustExist: true });
    const report = db.transaction(() => {
      const before = getAll();
      assert.deepEqual(before, backupDb.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(), 'Grades changed during backup; no changes applied');
      assert.deepEqual(select(before), selected, 'The selected grades changed; no changes applied');
      assert.deepEqual(db.prepare("SELECT * FROM sesiones WHERE year='2026' AND unit_number IN ('5','6')").all(), sessions, 'Session scope changed');
      const states = db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
      const state = states.find(row => row.key === CACHE_KEY);
      assert.deepEqual(state, backupDb.prepare('SELECT * FROM armi_frontend_state WHERE key=?').get(CACHE_KEY), 'Numeric cache changed during backup');
      const scores = state ? JSON.parse(state.value) : {};
      assert.ok(scores && typeof scores === 'object' && !Array.isArray(scores));
      const oldScores = structuredClone(scores);
      for (const row of selected) {
        const score = scores[cacheKey(row)];
        if (score != null && String(score).trim() !== '') assert.ok([5, 10].includes(Number(score)), `Conflicting cache for grade ${row.id}`);
      }
      const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      const protectedTables = ['sesiones', 'unidades', 'db_estudiantes', 'evaluacion_evidencias', 'evaluacion_conclusiones', 'interactive_activity_results', 'interactive_activity_attempts', 'evaluacion_configuracion', 'evaluacion_modos_calificacion'].filter(table => existing.has(table));
      const protectedBefore = Object.fromEntries(protectedTables.map(table => [table, digest(db, table)]));
      fs.writeFileSync(path.join(folder, 'before.json'), JSON.stringify({ ...plan, records: selected, cache: state || null }, null, 2));
      const now = new Date().toISOString();
      const update = db.prepare("UPDATE evaluacion_registros SET numeric_score=10,updated_at=? WHERE id=? AND numeric_score=5 AND grading_mode='hybrid_vigesimal'");
      for (const row of selected) {
        assert.equal(update.run(now, row.id).changes, 1);
        scores[cacheKey(row)] = 10;
      }
      if (state) assert.equal(db.prepare('UPDATE armi_frontend_state SET value=?,updated_at=? WHERE key=? AND value=?').run(JSON.stringify(scores), now, CACHE_KEY, state.value).changes, 1);
      const ids = new Set(selected.map(row => row.id));
      const after = getAll();
      assert.equal(after.length, before.length, 'No grades may be created or deleted');
      for (let index = 0; index < before.length; index++) assert.deepEqual(after[index], ids.has(before[index].id) ? { ...before[index], numeric_score: 10, updated_at: now } : before[index], `Unexpected change to grade ${before[index].id}`);
      const newStates = db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
      assert.equal(newStates.length, states.length);
      for (let index = 0; index < states.length; index++) if (states[index].key !== CACHE_KEY) assert.deepEqual(newStates[index], states[index]);
      const changedKeys = new Set(selected.map(cacheKey));
      for (const key of Object.keys(oldScores)) if (!changedKeys.has(key)) assert.deepEqual(scores[key], oldScores[key]);
      for (const table of protectedTables) assert.equal(digest(db, table), protectedBefore[table], `Protected table changed: ${table}`);
      assert.equal(select(after).length, 0, 'Some authorized 5s were not replaced');
      assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
      return { ...plan, applied: true, appliedAt: now, cacheUpdates: state ? selected.filter(row => oldScores[cacheKey(row)] !== 10).length : 0, individualLevelsChanged: 0, protectedTables, backup, audit: path.join(folder, 'before.json'), changes: selected.map(row => ({ id: row.id, studentId: String(row.student_id), sessionId: row.session_id, criteriaId: row.criteria_id, level: row.level, from: 5, to: 10 })) };
    }).immediate();
    fs.writeFileSync(path.join(folder, 'applied.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(folder, 'resumen.txt'), '\ufeff' + [
      'CAMBIO APLICADO: 5 A 10 — III BIMESTRE 2026 — UNIDADES 5 Y 6',
      `Notas actualizadas: ${report.changedGrades}. Identificadores de estudiantes: ${report.students}.`,
      'Incluye competencias del área y transversales. Los niveles individuales C se conservan.',
      'Las demás notas, los pendientes y las planificaciones se conservan. Los promedios se recalculan con los nuevos valores.',
      `Copia completa: ${backup}`, `Auditoría: ${report.audit}`,
    ].join('\r\n'));
    return report;
  } finally { backupDb?.close(); db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { db: { type: 'string' }, 'backup-root': { type: 'string' }, apply: { type: 'boolean', default: false } } });
  assert.ok(values.db, 'Use --db archivo.db [--apply --backup-root carpeta]');
  if (values.apply && process.platform === 'win32') {
    const check = spawnSync('powershell.exe', ['-NoProfile', '-Command', "if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"], { windowsHide: true });
    assert.equal(check.status, 0, 'Close ARMI normally before applying the bulk change');
  }
  const { changes, ...summary } = await replaceUnit56Fives({ databasePath: path.resolve(values.db), apply: values.apply, backupRoot: values['backup-root'] });
  console.log(JSON.stringify(summary, null, 2));
}
