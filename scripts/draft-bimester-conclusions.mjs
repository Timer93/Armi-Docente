import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createRegisterAggregation } from '../backend/shared/registerAggregation.generated.js';
import { buildConclusionEvidence, draftGroundedConclusion } from '../backend/shared/descriptiveConclusions.js';

const sections = value => String(value || '').toUpperCase().split(/,| Y |\/|-/).map(item => item.trim()).filter(Boolean);
const overlaps = (a, b) => sections(a).some(item => sections(b).includes(item));
export const conclusionIdentity = row => [row.year, row.areaId, row.grade, row.section, 'bimester', 'III', row.studentId, row.competencyKey].join('::');

export function draftBimesterConclusions(db) {
  const sessions = db.prepare("SELECT * FROM sesiones WHERE year='2026' AND unit_number IN ('5','6') ORDER BY area_id,grade,unit_number,session_number").all().map(row => ({
    id: row.id_sesion, year: String(row.year), areaId: String(row.area_id), grade: row.grade, section: row.section,
    unitNumber: String(row.unit_number), sessionNumber: String(row.session_number), bimesterLabel: 'III', sessionData: JSON.parse(row.session_data || '{}'),
  }));
  const records = db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal' ORDER BY id").all();
  const students = db.prepare('SELECT * FROM db_estudiantes ORDER BY grado,secc,estudiantes').all().map(row => ({ id: String(row.id), name: row.estudiantes, grade: row.grado, section: row.secc, estado: row.estado }));
  const assignmentState = db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_assignments'").get();
  const assignments = assignmentState ? JSON.parse(assignmentState.value) : [];
  const scopes = new Map();
  for (const session of sessions) for (const student of students) {
    if (student.grade !== session.grade || !overlaps(student.section, session.section)) continue;
    if (assignments.length && !assignments.some(row => String(row.areaId) === session.areaId && row.grade === student.grade && overlaps(row.section, student.section))) continue;
    const scope = { year: '2026', areaId: session.areaId, grade: student.grade, section: student.section };
    scopes.set([scope.areaId, scope.grade, scope.section].join('::'), scope);
  }
  const rows = [], cohorts = [];
  const calculator = createRegisterAggregation('hybrid_vigesimal');
  for (const scope of scopes.values()) {
    const scopedSessions = sessions.filter(row => row.areaId === scope.areaId && row.grade === scope.grade && overlaps(row.section, scope.section));
    const scopedStudents = students.filter(row => row.grade === scope.grade && row.section === scope.section);
    const ids = new Set(scopedSessions.map(row => row.id));
    const scopedRecords = records.filter(row => ids.has(row.session_id));
    const aggregation = calculator.buildBimesterRegisterAggregation({ sessions: scopedSessions, students: scopedStudents, records: scopedRecords });
    const start = rows.length;
    for (const student of aggregation.students) for (const competency of student.competencies) {
      const evidence = buildConclusionEvidence({ studentId: student.studentId, competencyName: competency.competencyName, source: competency.source, sessions: scopedSessions, records: scopedRecords });
      const draft = draftGroundedConclusion({ student, competency, evidence });
      rows.push({ ...scope, studentId: student.studentId, studentName: student.studentName, estado: student.estado,
        competencyKey: competency.key, competencyName: competency.competencyName, source: competency.source,
        level: competency.code.toUpperCase(), numericScore: competency.numericScore, ...draft, length: draft.text.length,
        capacities: student.capacities.filter(row => row.source === competency.source && row.key.startsWith(competency.key + '::')),
        evidence,
      });
    }
    const cohort = rows.slice(start);
    cohorts.push({ ...scope, students: scopedStudents.length, pedagogical: cohort.filter(row => row.kind === 'pedagogical').length, pending: cohort.filter(row => row.kind === 'pending').length, inactive: cohort.filter(row => row.kind === 'inactive').length, review: cohort.filter(row => row.kind === 'review').length });
  }
  const existing = db.prepare("SELECT * FROM evaluacion_conclusiones WHERE year='2026' AND scope_type='bimester' AND scope_value='III'").all();
  const targets = new Set(rows.map(conclusionIdentity));
  const orphanedExisting = existing.filter(row => !targets.has([row.year, row.area_id, row.grade, row.section, row.scope_type, row.scope_value, row.student_id, row.competency_key].join('::')));
  const signature = crypto.createHash('sha256').update(JSON.stringify({ sessions, records, students, assignments })).digest('hex');
  return { createdAt: new Date().toISOString(), applied: false, scope: { year: '2026', bimester: 'III', units: [5, 6] }, signature, rows, orphanedExisting,
    summary: { students: new Set(rows.map(row => row.studentId)).size, conclusions: rows.length, pedagogical: rows.filter(row => row.kind === 'pedagogical').length,
      pending: rows.filter(row => row.kind === 'pending').length, inactive: rows.filter(row => row.kind === 'inactive').length, missing: rows.filter(row => row.kind === 'missing').length,
      review: rows.filter(row => row.kind === 'review').length, maxLength: Math.max(0, ...rows.map(row => row.length)), distinctPedagogicalTexts: new Set(rows.filter(row => row.kind === 'pedagogical').map(row => row.text)).size,
      foreignOrHistoricalRowsPreserved: orphanedExisting.length, cohorts },
  };
}

export function writeConclusionDraft(plan, directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'propuesta.json'), JSON.stringify(plan, null, 2));
  const safe = value => String(value ?? '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ');
  fs.writeFileSync(path.join(directory, 'revision-conclusiones.md'), [
    '# Conclusiones descriptivas — III bimestre 2026', '',
    'Propuestas basadas en las calificaciones consolidadas, capacidades y criterios evaluados. No se modifican notas ni se infieren asistencia, esfuerzo o circunstancias personales.',
    'Estructura pedagógica: logros + aspectos por fortalecer + sugerencias. Los estados NE y pendientes se consignan como información, sin inventar logros ni dificultades.', '',
    '| Grado / sección | Estudiante | Competencia | Nivel | Tipo | Caracteres | Conclusión |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...plan.rows.map(row => `| ${[`${row.grade} ${row.section}`, row.studentName, row.competencyName, row.level, row.kind, row.length, row.text || row.reason].map(safe).join(' | ')} |`),
  ].join('\n'));
  const unique = [...new Set(plan.rows.filter(row => row.kind === 'pedagogical').map(row => row.text))];
  fs.writeFileSync(path.join(directory, 'textos-unicos.txt'), unique.map((text, index) => `${index + 1}. [${text.length}] ${text}`).join('\r\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { db: { type: 'string' }, out: { type: 'string' } } });
  if (!values.db || !values.out) throw new Error('Use --db archivo.db --out carpeta. Esta operación solo prepara propuestas.');
  const db = new Database(path.resolve(values.db), { readonly: true, fileMustExist: true });
  try { const plan = draftBimesterConclusions(db); writeConclusionDraft(plan, path.resolve(values.out)); console.log(JSON.stringify(plan.summary, null, 2)); } finally { db.close(); }
}
