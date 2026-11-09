import assert from 'node:assert/strict';
import { buildSessionEvidenceReview } from '../backend/sessionEvidenceReview.js';
const primary = 'Gestiona proyectos de emprendimiento económico y social';
const transversal = 'Se desenvuelve en los entornos virtuales generados por las TIC';
const sessionData = { competenciaPrio: { comp: primary }, competenciasTrans: [{ comp: transversal }], sessionAssessmentModel: { rows: [
  { id: 'primary-1', source: 'primary', competencyName: primary, capacityName: 'Crea propuestas', criterionText: 'Investiga necesidades' },
  { id: 'transversal-1', source: 'transversal', competencyName: transversal, capacityName: 'Personaliza entornos', criterionText: 'Configura herramientas' },
] } };
const evidence = { student_id: '155', student_ids: '["155"]', source: 'student_portal', is_latest: 1, criteria_id: `summary::transversal::${transversal.toLowerCase()}`, submitted_at: '2026-10-14 01:00:23' };
const autoGrade = { student_id: '155', criteria_id: 'primary-1', level: 'AD', observation: '[Actividad HTML:test] 20/20', updated_at: '2026-10-14 13:31:00' };
const read = (evidences, records) => buildSessionEvidenceReview({ evidences, records, sessionData });
let result = read([evidence, { ...evidence, submitted_at: '2026-10-13 19:51:31' }], [autoGrade]);
assert.equal(result[0].evidenceCount, 2);
assert.equal(result[0].pendingCount, 2, 'A primary HTML grade cannot hide transversal evidence');
const reviewed = { ...autoGrade, criteria_id: 'transversal-1', level: 'A', updated_at: '2026-10-15T01:00:00Z' };
result = read([evidence], [autoGrade, reviewed]);
assert.equal(result[0].pending, false);
assert.equal(result[0].evidenceCount, 1, 'Reviewed evidence remains visible permanently');
assert.equal(read([{ ...evidence, submitted_at: '2026-10-16T01:00:00Z' }], [reviewed])[0].pending, true, 'A later upload must require review again');
assert.equal(read([{ ...evidence, criteria_id: `summary::transversal::${transversal.replaceAll(' ', '')}` }], [reviewed])[0].pending, false, 'Legacy compact competency IDs must match');
assert.equal(read([{ ...evidence, criteria_id: 'unknown-criterion' }], [autoGrade, reviewed])[0].pending, true, 'Ambiguous scopes must not borrow unrelated grades');
result = read([{ ...evidence, student_ids: '["155","156"]' }], [reviewed]);
assert.equal(result.find(row => row.studentId === '156').pending, true, 'Each member has an independent review state');
assert.equal(read([{ ...evidence, is_latest: 0 }], []).length, 0);
result = read([{ ...evidence, source: 'teacher' }], []);
assert.equal(result[0].evidenceCount, 1, 'Teacher attachments also count as evidence');
assert.equal(result[0].pending, false, 'Teacher attachments are not new student submissions');
console.log('OK: Viqueli regression, competency-scoped reviews, permanent presence, group members, legacy IDs, UTC/ISO dates and teacher uploads.');
