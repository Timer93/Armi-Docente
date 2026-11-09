import assert from 'node:assert/strict';
import { filterEvidenceByCompetency } from '../backend/evidenceCompetencyScope.js';
const primary = 'Gestiona proyectos de emprendimiento económico y social';
const tic = 'Se desenvuelve en los entornos virtuales generados por las TIC';
const autonomy = 'Gestiona su aprendizaje de manera autónoma';
const summary = (source, name) => `summary::${source}::${name}`;
const sessionData = { sessionAssessmentModel: { rows: [
  { id: 'c1', source: 'primary', competencyName: primary, capacityName: 'Crea', criterionText: 'Investiga' },
  { id: 'c2', source: 'transversal', competencyName: tic, capacityName: 'Personaliza', criterionText: 'Configura' },
] } };
const rows = [
  { id: 1, criteria_id: summary('primary', primary), source: 'teacher' },
  { id: 2, criteria_id: summary('primary', primary.replaceAll(' ', '')), source: 'student_portal' },
  { id: 3, criteria_id: 'c2', source: 'student_portal' },
  { id: 4, criteria_id: summary('transversal', autonomy), source: 'student_portal' },
  { id: 5, criteria_id: '', source: 'student_portal' },
  { id: 6, criteria_id: summary('primary', primary), requested_evidence: JSON.stringify({ id: 'product', text: 'Presentación', source: 'transversal', competency: tic }) },
];
const ids = criteria => filterEvidenceByCompetency(rows, criteria, sessionData).map(row => row.id);
const before = JSON.stringify(rows);
assert.deepEqual(ids(summary('primary', primary)), [1, 2]);
assert.deepEqual(ids(summary('transversal', tic)), [3, 6], 'Explicit requested-evidence association must survive old default IDs');
assert.deepEqual(ids(summary('transversal', autonomy)), [4], 'Different transversal competencies cannot share files');
assert.deepEqual(ids(summary('primary', tic)), [], 'A matching name in a different source is not the same competency');
assert.deepEqual(ids(''), [1, 2, 3, 4, 5, 6], 'The student counter keeps every file, including unclassified legacy uploads');
assert.equal(JSON.stringify(rows), before, 'Filtering must not move or edit files');
console.log('OK: separate primary/TIC/autonomy evidence, teacher uploads, legacy IDs, explicit associations, and unchanged all-evidence view.');
