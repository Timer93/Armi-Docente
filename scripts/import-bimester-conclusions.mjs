import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { conclusionIdentity, draftBimesterConclusions } from './draft-bimester-conclusions.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const storedIdentity = row => [row.year, row.area_id, row.grade, row.section, row.scope_type, row.scope_value, row.student_id, row.competency_key].join('::');
const stateKey = row => `armi_register_conclusions_bimester_2026_${row.areaId}_${row.grade}_${row.section}_III`;
const digest = (db, table) => {
  const digest = crypto.createHash('sha256');
  for (const row of db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).iterate()) digest.update(JSON.stringify(row));
  return digest.digest('hex');
};

export function planWorkbookImport(db, extracted) {
  assert.equal(hash(fs.readFileSync(extracted.source)), extracted.sha256, 'El Excel cambió desde su lectura.');
  const current = draftBimesterConclusions(db);
  const changes = [], blanks = [], seen = new Set();
  const cohortCounts = [];
  assert.equal(extracted.sheets.length, 6, 'Se esperan los seis grupos confirmados.');
  for (const sheet of extracted.sheets) {
    assert.match(sheet.name, /^(2do [AB]|3ro U|4to U|5to [AB])$/);
    const [grade, section] = sheet.name.split(' ');
    const cohort = current.summary.cohorts.find(row => row.grade === grade && row.section === section);
    assert.ok(cohort, `Grupo desconocido: ${sheet.name}`);
    const read = (row, column) => {
      const cell = row.cells[`${column}${row.row}`];
      assert.ok(!cell?.formula, `Se requiere texto explícito, no una fórmula: ${sheet.name}!${column}${row.row}`);
      return String(cell?.value || '');
    };
    assert.match(read(sheet.rows[0], 'A'), /III BIMESTRE 2026/);
    assert.deepEqual(['B', 'D', 'F'].map(col => read(sheet.rows[1], col)), ['01', '02', '03'], 'Orden de competencias desconocido.');
    const dataRows = sheet.rows.filter(row => row.row >= 4);
    assert.equal(dataRows.length, cohort.students, `Cantidad de estudiantes distinta en ${sheet.name}`);
    const studentIds = new Set();
    const start = changes.length;
    for (const row of dataRows) {
      const name = read(row, 'A');
      const candidates = current.rows.filter(item => item.grade === grade && item.section === section && normalize(item.studentName) === normalize(name));
      const ids = [...new Set(candidates.map(item => item.studentId))];
      assert.equal(ids.length, 1, `Nombre inexistente o ambiguo: ${sheet.name}!A${row.row}: ${name}`);
      assert.ok(!studentIds.has(ids[0]), `Estudiante duplicado en ${sheet.name}: ${name}`);
      studentIds.add(ids[0]);
      // Source workbook: 01 = area, 02 = TIC, 03 = autonomous learning.
      // Match actual competency names/keys, never the database's display order.
      for (const [levelColumn, textColumn, type] of [['B', 'C', 'primary'], ['D', 'E', 'tic'], ['F', 'G', 'autonomy']]) {
        const matches = candidates.filter(item => type === 'primary' ? item.source === 'primary'
          : type === 'tic' ? normalize(item.competencyName).includes('entornos virtuales')
            : normalize(item.competencyName).includes('aprendizaje de manera autonoma'));
        assert.equal(matches.length, 1, `Competencia ambigua: ${sheet.name}!${textColumn}${row.row}`);
        const target = matches[0];
        const text = read(row, textColumn);
        const sourceCell = `${sheet.name}!${textColumn}${row.row}`;
        const identity = conclusionIdentity(target);
        assert.ok(!seen.has(identity), `Destino repetido: ${identity}`); seen.add(identity);
        if (!text.trim()) { blanks.push({ sourceCell, studentName: target.studentName, competencyName: target.competencyName, inactive: target.kind === 'inactive' }); continue; }
        assert.ok(text.length <= 250 && !text.includes('\ufffd'), `Texto inválido o superior a 250 caracteres en ${sourceCell}`);
        assert.ok(!/[\r\n\t]/.test(text), `La conclusión debe ser un párrafo: ${sourceCell}`);
        assert.ok(target.kind !== 'inactive' && !target.pending && target.level !== 'NE', `Estudiante no evaluado o pendiente: ${sourceCell}`);
        assert.equal(read(row, levelColumn).trim().toUpperCase(), target.level, `Nivel de Excel distinto al vigente: ${sourceCell}`);
        changes.push({ year: target.year, areaId: target.areaId, grade, section,
          studentId: target.studentId, studentName: target.studentName,
          competencyKey: target.competencyKey, competencyName: target.competencyName,
          source: target.source, level: target.level, sourceCell, text });
      }
    }
    cohortCounts.push({ group: sheet.name, students: studentIds.size, conclusions: changes.length - start });
  }
  return { source: extracted.source, sourceSha256: extracted.sha256, signature: current.signature, changes, blanks,
    summary: { conclusions: changes.length, students: new Set(changes.map(row => row.studentId)).size,
      maxLength: Math.max(...changes.map(row => row.text.length)), blankActive: blanks.filter(row => !row.inactive),
      blankInactive: blanks.filter(row => row.inactive).length, groups: cohortCounts } };
}

export async function importWorkbookConclusions({ databasePath, extracted, backupRoot }) {
  assert.ok(backupRoot, 'Se requiere respaldo.');
  const db = new Database(databasePath, { fileMustExist: true, timeout: 10000 });
  let snapshot;
  try {
    const proposal = planWorkbookImport(db, extracted);
    assert.ok(proposal.changes.length > 0, 'No hay textos para importar.');
    const folder = path.resolve(backupRoot, `conclusiones-excel-III-2026-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(folder, { recursive: true });
    const backup = path.join(folder, 'armi-before.db');
    await db.backup(backup);
    snapshot = new Database(backup, { readonly: true });
    fs.copyFileSync(extracted.source, path.join(folder, path.basename(extracted.source)));
    const report = db.transaction(() => {
      assert.deepEqual(planWorkbookImport(db, extracted), proposal, 'Los datos cambiaron durante el respaldo.');
      const before = db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all();
      const statesBefore = db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
      assert.deepEqual(before, snapshot.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all());
      assert.deepEqual(statesBefore, snapshot.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all());
      const protectedTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('evaluacion_conclusiones','armi_frontend_state','sync_change_clock')").all().map(row => row.name);
      const protectedBefore = Object.fromEntries(protectedTables.map(table => [table, digest(db, table)]));
      const keys = new Set(proposal.changes.map(conclusionIdentity));
      const cacheUpdates = new Map();
      const now = new Date().toISOString();
      const changes = proposal.changes.map(row => ({ ...row, before: before.find(item => storedIdentity(item) === conclusionIdentity(row)) || null }));
      fs.writeFileSync(path.join(folder, 'before.json'), JSON.stringify({ ...proposal, changes, cacheBefore: statesBefore.filter(row => proposal.changes.some(item => stateKey(item) === row.key)) }, null, 2));
      const upsert = db.prepare(`INSERT INTO evaluacion_conclusiones (year,area_id,grade,section,scope_type,scope_value,student_id,competency_key,competency_name,competency_source,conclusion_text,updated_at)
        VALUES (@year,@areaId,@grade,@section,'bimester','III',@studentId,@competencyKey,@competencyName,@source,@text,@now)
        ON CONFLICT(year,area_id,grade,section,scope_type,scope_value,student_id,competency_key) DO UPDATE SET competency_name=excluded.competency_name,competency_source=excluded.competency_source,conclusion_text=excluded.conclusion_text,updated_at=excluded.updated_at`);
      for (const row of proposal.changes) {
        upsert.run({ ...row, now });
        const key = stateKey(row);
        if (!cacheUpdates.has(key)) {
          const state = statesBefore.find(item => item.key === key);
          const values = state ? JSON.parse(state.value) : {};
          assert.ok(values && typeof values === 'object' && !Array.isArray(values));
          cacheUpdates.set(key, values);
        }
        cacheUpdates.get(key)[`${row.studentId}::${row.competencyKey}`] = row.text;
      }
      const saveCache = db.prepare('INSERT INTO armi_frontend_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
      for (const [key, values] of cacheUpdates) saveCache.run(key, JSON.stringify(values), now);
      const after = db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all();
      assert.deepEqual(after.filter(row => !keys.has(storedIdentity(row))), before.filter(row => !keys.has(storedIdentity(row))), 'Se alteraron conclusiones fuera del Excel, celdas vacías u otros bimestres.');
      for (const row of proposal.changes) assert.equal(after.find(item => storedIdentity(item) === conclusionIdentity(row))?.conclusion_text, row.text);
      const statesAfter = db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
      assert.deepEqual(statesAfter.filter(row => !cacheUpdates.has(row.key)), statesBefore.filter(row => !cacheUpdates.has(row.key)));
      for (const [key, values] of cacheUpdates) {
        const oldState = statesBefore.find(row => row.key === key);
        const old = oldState ? JSON.parse(oldState.value) : {};
        const changed = new Set(proposal.changes.filter(row => stateKey(row) === key).map(row => `${row.studentId}::${row.competencyKey}`));
        for (const entry of Object.keys(old)) if (!changed.has(entry)) assert.deepEqual(values[entry], old[entry]);
        assert.deepEqual(JSON.parse(statesAfter.find(row => row.key === key).value), values);
      }
      for (const table of protectedTables) assert.equal(digest(db, table), protectedBefore[table], `Cambio no autorizado en ${table}`);
      assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
      return { applied: true, appliedAt: now, source: proposal.source, sourceSha256: proposal.sourceSha256, summary: proposal.summary, gradesChanged: 0, backup, audit: path.join(folder, 'before.json'), protectedTables, changes };
    }).immediate();
    fs.writeFileSync(path.join(folder, 'applied.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { snapshot?.close(); db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { db: { type: 'string' }, extracted: { type: 'string' }, 'backup-root': { type: 'string' }, apply: { type: 'boolean', default: false } } });
  assert.ok(values.db && values.extracted, 'Use --db archivo --extracted origen-extraido.json.');
  const extracted = JSON.parse(fs.readFileSync(values.extracted, 'utf8'));
  if (!values.apply) {
    const db = new Database(values.db, { readonly: true, fileMustExist: true });
    try { console.log(JSON.stringify(planWorkbookImport(db, extracted).summary, null, 2)); } finally { db.close(); }
  } else {
    if (process.platform === 'win32') {
      const processCheck = spawnSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', windowsHide: true });
      assert.equal(processCheck.status, 0); assert.equal(Number(processCheck.stdout.trim()), 0, 'Cierre ARMI normalmente antes de importar.');
    }
    const report = await importWorkbookConclusions({ databasePath: values.db, extracted, backupRoot: values['backup-root'] });
    console.log(JSON.stringify({ ...report, changes: report.changes.length }, null, 2));
  }
}
