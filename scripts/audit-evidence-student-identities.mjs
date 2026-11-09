import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceStudentResolver, planEvidenceStudentRepairs, applyEvidenceStudentRepairs } from '../backend/evidenceStudentIdentity.js';
import { portableEvidenceKey } from '../backend/evidenceMirrorIndex.js';
import { Worker } from 'node:worker_threads';

const parseList = value => {
  try { const result = Array.isArray(value) ? value : JSON.parse(value || '[]'); return Array.isArray(result) ? result.map(String) : []; }
  catch { return []; }
};
const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const keyOf = row => portableEvidenceKey(row.relative_path) || String(row.evidence_key || `local-id:${row.id}`);
const brief = row => ({ id: row.id, evidenceKey: keyOf(row), studentId: row.student_id,
  studentDni: row.student_dni || '',
  studentIds: parseList(row.student_ids), studentNames: parseList(row.student_names), grade: row.grade,
  section: row.section, unit: row.unit_number, session: row.session_number, sessionId: row.session_id,
  relativePath: row.relative_path, submittedAt: row.submitted_at, updatedAt: row.updated_at });
const sources = [['proyecto', path.resolve('database/armi.db')],
  ['instalada', path.join(process.env.APPDATA, 'ARMI Docente', 'database', 'armi.db')]];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-identity-audit-'));
const artifactRoot = path.resolve('artifacts');
const report = { generatedAt: new Date().toISOString(), scope: 'Dos bases locales disponibles; no acceso directo a la otra PC.',
  activeDataModified: false, fileContentsReadOrModified: false, databases: [], students: [], comparison: {} };
const studentGroups = new Map();
const snapshots = [];
try {
  for (const [label, sourcePath] of sources) {
    const source = new Database(sourcePath, { readonly: true });
    const copyPath = path.join(temporaryRoot, `${label}.db`);
    await source.backup(copyPath); source.close();
    const db = new Database(copyPath);
    try {
      const students = db.prepare('SELECT id, dni, estudiantes, grado, secc FROM db_estudiantes').all();
      const byId = new Map(students.map(student => [String(student.id), student]));
      const resolve = createEvidenceStudentResolver(students);
      const before = db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all();
      const gradesBefore = db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
      for (const column of ['student_dni', 'student_dnis']) {
        if (!db.prepare('PRAGMA table_info(evaluacion_evidencias)').all().some(field => field.name === column)) db.exec(`ALTER TABLE evaluacion_evidencias ADD COLUMN ${column} TEXT`);
      }
      const issues = [], unresolved = [], duplicates = [], records = new Map();
      for (const original of before) {
        const resolved = resolve(original);
        const fields = [];
        if (String(original.student_id ?? '') !== String(resolved.student_id ?? '')) fields.push('student_id');
        if (JSON.stringify(parseList(original.student_ids)) !== JSON.stringify(parseList(resolved.student_ids))) fields.push('student_ids');
        for (const field of ['grade', 'section']) if (String(original[field] || '') !== String(resolved[field] || '')) fields.push(field);
        const members = parseList(resolved.student_ids), names = parseList(resolved.student_names);
        const primaryIndex = Math.max(0, members.indexOf(String(resolved.student_id || '')));
        const primary = byId.get(String(resolved.student_id || ''));
        const unknown = [];
        if (!primary) unknown.push('El ID principal no existe en la matrícula local');
        else if (names[primaryIndex] && normalizeName(primary.estudiantes) !== normalizeName(names[primaryIndex])) unknown.push('El nombre principal no coincide y no se pudo resolver con seguridad');
        members.forEach((id, index) => {
          const member = byId.get(id);
          if (!member || (names[index] && normalizeName(member.estudiantes) !== normalizeName(names[index]))) unknown.push(`Integrante ${index + 1} sin identidad local confirmada`);
        });
        if (names.length > Math.max(1, members.length)) unknown.push('Hay más nombres que IDs de integrantes');
        if (unknown.length) unresolved.push({ ...brief(original), reasons: [...new Set(unknown)] });
        if (fields.length) {
          const item = { ...brief(original), changedFields: fields, resolvedStudentId: resolved.student_id,
            resolvedStudentIds: members, resolvedGrade: resolved.grade, resolvedSection: resolved.section,
            localOwnerBefore: byId.get(String(original.student_id))?.estudiantes || null,
            partialResolution: unknown.length > 0 };
          issues.push(item);
          const affectedIds = new Set([...(fields.includes('student_id') || fields.includes('grade') || fields.includes('section') ? [String(resolved.student_id)] : []),
            ...members.filter((id, index) => id !== parseList(original.student_ids)[index])]);
          for (const id of affectedIds) {
            const student = byId.get(id);
            if (!student) continue;
            const identity = `${student.dni || normalizeName(student.estudiantes)}:${student.grado}:${student.secc}`;
            if (!studentGroups.has(identity)) studentGroups.set(identity, { name: student.estudiantes, dni: String(student.dni || ''),
              grade: student.grado, section: student.secc, databases: {}, evidenceKeys: new Set(), sessions: new Set() });
            const entry = studentGroups.get(identity);
            entry.databases[label] = (entry.databases[label] || 0) + 1;
            entry.evidenceKeys.add(keyOf(original));
            entry.sessions.add(`U${original.unit_number}/S${original.session_number}`);
          }
        }
        const key = keyOf(original);
        if (records.has(key)) duplicates.push({ evidenceKey: key, ids: [records.get(key).id, original.id] });
        else records.set(key, brief(resolved));
      }
      const plan = planEvidenceStudentRepairs(db);
      const applied = applyEvidenceStudentRepairs(db, plan);
      assert.equal(applied, plan.length);
      const after = db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all();
      assert.equal(before.length, after.length);
      const allowedChanges = new Set(['student_id', 'student_ids', 'student_dni', 'student_dnis', 'grade', 'section']);
      before.forEach((row, index) => {
        for (const field of Object.keys(row).filter(field => !allowedChanges.has(field))) assert.deepEqual(after[index][field], row[field]);
      });
      assert.deepEqual(db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(), gradesBefore);
      const repeatedPlan = planEvidenceStudentRepairs(db);
      assert.equal(repeatedPlan.length, 0, 'La corrección debe estabilizarse y no repetirse');
      report.databases.push({ label, sourcePath, rosterStudents: students.length, evidenceRows: before.length, gradeRows: gradesBefore.length,
        rowsWithIncorrectIdentityOrScope: issues.length,
        primaryIdMismatch: issues.filter(row => row.changedFields.includes('student_id')).length,
        membershipMismatch: issues.filter(row => row.changedFields.includes('student_ids')).length,
        scopeMismatch: issues.filter(row => row.changedFields.includes('grade') || row.changedFields.includes('section')).length,
        unresolvedRows: unresolved.length, duplicateKeys: duplicates.length,
        isolatedValidation: { allEvidenceRowsPreserved: true, allNonIdentityFieldsPreserved: true, allGradesUnchanged: true,
          repeatRepairChanges: repeatedPlan.length }, issues, unresolved, duplicates });
      snapshots.push({ label, records });
      console.log(JSON.stringify({ database: label, evidenceRows: before.length, incorrectRows: issues.length,
        unresolvedRows: unresolved.length, preservedGrades: gradesBefore.length }));
    } finally { db.close(); }
  }
  const [a, b] = snapshots;
  const onlyA = [...a.records.entries()].filter(([key]) => !b.records.has(key)).map(([, row]) => row);
  const onlyB = [...b.records.entries()].filter(([key]) => !a.records.has(key)).map(([, row]) => row);
  report.comparison = { sharedEvidenceKeys: [...a.records.keys()].filter(key => b.records.has(key)).length,
    onlyProjectCount: onlyA.length, onlyInstalledCount: onlyB.length, onlyProject: onlyA, onlyInstalled: onlyB,
    note: 'Ausente significa que el registro no existe en esa copia; no implica que el archivo se haya perdido. No se leyó el contenido de los archivos.' };
  report.students = [...studentGroups.values()].map(entry => ({ ...entry,
    affectedUniqueEvidenceKeys: entry.evidenceKeys.size, evidenceKeys: [...entry.evidenceKeys], sessions: [...entry.sessions].sort() }))
    .sort((a, b) => a.grade.localeCompare(b.grade) || a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  report.totalAffectedStudents = report.students.length;
  report.totalAffectedUniqueEvidenceKeys = new Set(report.databases.flatMap(db => db.issues.map(row => row.evidenceKey))).size;
  const config = JSON.parse(fs.readFileSync('sync-runtime/sync-config.json', 'utf8'));
  const mirrorRoot = path.join(config.mirrorPath, 'Evidencias de estudiantes', '.armi-evidence-index');
  const recordNames = await fs.promises.readdir(path.join(mirrorRoot, 'records'));
  const tombstoneNames = await fs.promises.readdir(path.join(mirrorRoot, 'tombstones'));
  const indexKeys = new Set(recordNames.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));
  const deletedKeys = new Set(tombstoneNames.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));
  const unionKeys = new Set([...a.records.keys(), ...b.records.keys()]);
  const affectedKeys = new Set(report.databases.flatMap(db => db.issues.map(row => row.evidenceKey)));
  const selectedKeys = [...new Set([...affectedKeys, ...onlyA.map(row => row.evidenceKey), ...onlyB.map(row => row.evidenceKey)])];
  // Audit metadata in one separate worker. Reading Drive files sequentially
  // avoids provider contention and never blocks the app or hydrates evidence.
  const metadataResults = await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const fs = require('node:fs'), path = require('node:path');
      const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\\uFEFF/, '')); } catch { return null; } };
      for (const key of workerData.keys) {
        parentPort.postMessage({ key,
          metadata: read(path.join(workerData.root, 'records', key + '.json')),
          tombstone: read(path.join(workerData.root, 'tombstones', key + '.json')) });
      }
      parentPort.postMessage({ complete: true });
    `, { eval: true, workerData: { root: mirrorRoot, keys: selectedKeys } });
    const results = new Map();
    const timeout = setTimeout(() => { void worker.terminate(); resolve(results); }, 60_000);
    worker.on('message', item => {
      if (item.complete) { clearTimeout(timeout); resolve(results); }
      else results.set(item.key, item);
    });
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
    worker.once('exit', () => { clearTimeout(timeout); resolve(results); });
  });
  const mirrorChecks = selectedKeys.map(key => {
    const base = a.records.get(key) || b.records.get(key);
    const { metadata, tombstone } = metadataResults.get(key) || {};
    return { evidenceKey: key, indexRecordPresent: indexKeys.has(key), tombstonePresent: deletedKeys.has(key),
      indexRecordReadable: Boolean(metadata), tombstoneReadable: Boolean(tombstone), deletedAt: tombstone?.deletedAt || '',
      tombstoneCoversRow: Boolean(tombstone && Date.parse(tombstone.deletedAt) >= Date.parse(base.updatedAt || base.submittedAt)),
      ...(metadata ? { studentDni: metadata.studentDni || '', studentNames: parseList(metadata.studentNames),
        namesMatchRow: JSON.stringify(parseList(metadata.studentNames).map(normalizeName)) === JSON.stringify(base.studentNames.map(normalizeName)),
        dniMatchesResolvedRow: !base.studentDni || !metadata.studentDni || String(metadata.studentDni) === String(base.studentDni),
        dniAbsentFromIndex: !metadata.studentDni } : {}) };
  });
  const mirrorByKey = new Map(mirrorChecks.map(check => [check.evidenceKey, check]));
  report.mirror = { root: mirrorRoot, indexRecordCount: indexKeys.size, tombstoneCount: deletedKeys.size,
    indexKeysAbsentFromBothDatabases: [...indexKeys].filter(key => !unionKeys.has(key)),
    checkedKeys: mirrorChecks.length,
    affectedKeysWithMatchingStableIdentity: mirrorChecks.filter(check => affectedKeys.has(check.evidenceKey) && check.namesMatchRow && check.dniMatchesResolvedRow).length,
    affectedKeysWithConflictingStableIdentity: mirrorChecks.filter(check => affectedKeys.has(check.evidenceKey) && check.indexRecordReadable && (!check.namesMatchRow || !check.dniMatchesResolvedRow)).length,
    selectedKeysWithConflictingStableIdentity: mirrorChecks.filter(check => check.indexRecordReadable && (!check.namesMatchRow || !check.dniMatchesResolvedRow)).length,
    unreadableIndexRecords: mirrorChecks.filter(check => check.indexRecordPresent && !check.indexRecordReadable).length,
    checks: mirrorChecks.sort((a, b) => a.evidenceKey.localeCompare(b.evidenceKey)) };
  const classifyMissing = rows => ({ coveredByDeletion: rows.filter(row => mirrorByKey.get(row.evidenceKey)?.tombstoneCoversRow).length,
    withReadableIndex: rows.filter(row => mirrorByKey.get(row.evidenceKey)?.indexRecordReadable && !mirrorByKey.get(row.evidenceKey)?.tombstoneCoversRow).length,
    withNoIndexOrDeletion: rows.filter(row => !mirrorByKey.get(row.evidenceKey)?.indexRecordPresent && !mirrorByKey.get(row.evidenceKey)?.tombstonePresent).length });
  report.comparison.onlyProjectMirrorClassification = classifyMissing(onlyA);
  report.comparison.onlyInstalledMirrorClassification = classifyMissing(onlyB);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const jsonPath = path.join(artifactRoot, 'auditoria-identidad-evidencias.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const markdown = [`# Auditoría de identidad de todas las evidencias`, '',
    `Fecha UTC: ${report.generatedAt}. Se auditaron las dos bases locales disponibles; no se accedió directamente a la segunda PC.`, '',
    '| Base | Registros revisados | ID principal incorrecto | Integrantes incorrectos | Grado/sección incorrectos | Sin resolver |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.databases.map(db => `| ${db.label} | ${db.evidenceRows} | ${db.primaryIdMismatch} | ${db.membershipMismatch} | ${db.scopeMismatch} | ${db.unresolvedRows} |`), '',
    'Las categorías pueden solaparse: una evidencia puede tener un ID y un grado incorrectos.', '',
    `Estudiantes afectados identificados: **${report.totalAffectedStudents}**. Evidencias únicas con vínculos o alcance incorrectos: **${report.totalAffectedUniqueEvidenceKeys}**.`, '',
    `Registros presentes solo en el proyecto: **${onlyA.length}**. Presentes solo en la base instalada: **${onlyB.length}**. Compartidos: **${report.comparison.sharedEvidenceKeys}**. La ausencia se compara contra las fichas de eliminación antes de sugerir recuperar registros.`, '',
    `Entre los registros exclusivos del proyecto, ${report.comparison.onlyProjectMirrorClassification.coveredByDeletion} tienen eliminación registrada y ${report.comparison.onlyProjectMirrorClassification.withReadableIndex} tienen ficha disponible sin eliminación aplicable. Entre los exclusivos de la base instalada, son ${report.comparison.onlyInstalledMirrorClassification.coveredByDeletion} y ${report.comparison.onlyInstalledMirrorClassification.withReadableIndex}, respectivamente.`, '',
    `Índice del espejo: ${report.mirror.indexRecordCount} fichas, ${report.mirror.tombstoneCount} fichas de eliminación. Entre las ${affectedKeys.size} evidencias afectadas: ${report.mirror.affectedKeysWithMatchingStableIdentity} fichas tienen identidad estable coincidente y ${report.mirror.affectedKeysWithConflictingStableIdentity} tienen discrepancias de nombre o DNI. Fichas seleccionadas sin poder leer: ${report.mirror.unreadableIndexRecords}.`, '',
    `En el conjunto de ${report.mirror.checkedKeys} fichas revisadas (casos de identidad y registros exclusivos), ${report.mirror.selectedKeysWithConflictingStableIdentity} tienen un DNI incompatible con el estudiante identificado por nombre en la matrícula local. La corrección verifica la coincidencia del nombre antes de confiar en un DNI recibido y resuelve estos casos por nombre único y aula. No se corrigió el espejo activo durante la auditoría.`, '',
    `Se encontraron ${report.databases[0].duplicateKeys} filas adicionales con ruta repetida en el proyecto y ${report.databases[1].duplicateKeys} en la base instalada. Se conservaron todas; no se deduplicó ni eliminó ningún registro.`, '',
    'La corrección se aplicó únicamente en copias temporales. Se verificó la conservación de todos los registros, todos los campos ajenos a identidad/grado/sección y todas las calificaciones. Una segunda ejecución no produjo nuevas reparaciones. Las bases activas y los archivos del espejo no fueron modificados. No se validó la disponibilidad física de cada archivo.', '',
    '## Estudiantes con casos similares', '',
    '| Estudiante | Grado/sección | Filas proyecto | Filas instalada | Evidencias únicas | Sesiones |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...report.students.map(s => `| ${s.name} | ${s.grade} ${s.section} | ${s.databases.proyecto || 0} | ${s.databases.instalada || 0} | ${s.affectedUniqueEvidenceKeys} | ${s.sessions.join(', ')} |`), '',
    'Los casos sin identidad confirmada y los registros exclusivos de cada base se detallan en `auditoria-identidad-evidencias.json`. No se reasignaron por suposición.', ''];
  fs.writeFileSync(path.join(artifactRoot, 'auditoria-identidad-evidencias.md'), markdown.join('\n'));
  console.log(JSON.stringify({ totalAffectedStudents: report.totalAffectedStudents, uniqueAffectedEvidenceKeys: report.totalAffectedUniqueEvidenceKeys,
    onlyProject: onlyA.length, onlyInstalled: onlyB.length, report: jsonPath }));
} finally {
  const resolvedTemporary = path.resolve(temporaryRoot);
  assert.ok(resolvedTemporary.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(resolvedTemporary, { recursive: true, force: true });
}
