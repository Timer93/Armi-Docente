import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { createRegisterAggregation } from '../backend/shared/registerAggregation.generated.js';

const bundle = buildSync({ entryPoints: ['utils/competencyClipboard.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { buildCompetencyClipboardData } = compiled.exports;
const area = [
  { competencyKey: 'number', competencyName: 'Resuelve problemas de cantidad' },
  { competencyKey: 'shape', competencyName: 'Resuelve problemas de forma' },
];
const transversal = [
  { competencyKey: 'autonomy', competencyName: 'GESTIONA SU APRENDIZAJE DE MANERA AUTÓNOMA' },
  { competencyKey: 'tic', competencyName: 'SE DESENVUELVE EN LOS ENTORNOS VIRTUALES GENERADOS POR LAS TIC' },
];
const students = [
  { studentName: 'ÁLVAREZ PÉREZ, María', results: { number: { code: 'b', numericScore: 13.25, conclusion: 'Avanza\tcon apoyo.\nContinuar practicando.' }, shape: { code: 'ad', numericScore: 18.6, conclusion: 'Logro destacado.' }, autonomy: { code: 'a', numericScore: 16, conclusion: 'Organiza su aprendizaje.' }, tic: { code: 'c', numericScore: 10, conclusion: 'Reforzar el uso de TIC.' } }, dni: 'not-to-copy', observation: 'not-to-copy' },
  { studentName: 'Retirado', results: Object.fromEntries(['number', 'shape', 'autonomy', 'tic'].map(key => [key, { code: 'ne', conclusion: 'Estudiante retirado.' }])) },
  { studentName: 'Apellido\tNombre\ncon salto', results: { number: { code: 'c', numericScore: 10 }, shape: { code: 'a', numericScore: 14 }, autonomy: { code: 'ne', numericScore: null, pending: true, conclusion: 'En revisión.' }, tic: { code: 'b', numericScore: 11 } } },
];
const original = JSON.stringify({ area, transversal, students });
const data = buildCompetencyClipboardData(students, area, transversal, (student, group) => student.results[group.competencyKey]);
assert.equal(data.text, [
  ['ÁLVAREZ PÉREZ, María', 'B', 'Avanza con apoyo. Continuar practicando.', 'AD', 'Logro destacado.', 'C', 'Reforzar el uso de TIC.', 'A', 'Organiza su aprendizaje.'],
  ['Retirado', 'NE', 'Estudiante retirado.', 'NE', 'Estudiante retirado.', 'NE', 'Estudiante retirado.', 'NE', 'Estudiante retirado.'],
  ['Apellido Nombre con salto', 'C', '', 'A', '', 'B', '', '', 'En revisión.'],
].map(row => row.join('\t')).join('\r\n'));
assert.equal(data.pendingCount, 1); assert.equal(data.emptyCount, 0); assert.equal(data.rowCount, 3);
assert.deepEqual(data.columns.map(row => row.competencyKey), ['number', 'shape', 'tic', 'autonomy']);
assert.ok(data.text.split('\r\n').every(row => row.split('\t').length === 9));
assert.ok(!data.text.includes('not-to-copy')); assert.ok(!data.text.includes('Competencia'));
assert.equal(JSON.stringify({ area, transversal, students }), original, 'Export must not reorder the register or alter grades');
assert.equal(buildCompetencyClipboardData([], area, transversal, () => undefined).text, '');
assert.equal(buildCompetencyClipboardData([{ studentName: 'Sin nota' }], area.slice(0, 1), [], () => undefined).text, ['Sin nota', ...Array(6).fill('')].join('\t'));
assert.equal(buildCompetencyClipboardData(students.slice(0, 1), area.slice(0, 1), transversal.slice(0, 1), (student, group) => student.results[group.competencyKey]).text, ['ÁLVAREZ PÉREZ, María', 'B', 'Avanza con apoyo. Continuar practicando.', '', '', 'A', 'Organiza su aprendizaje.'].join('\t'), 'Missing TIC must leave both fields blank so autonomy never shifts into TIC');
const precision = buildCompetencyClipboardData([{ studentName: 'Promedio exacto' }], area.slice(0, 1), [], () => ({ code: 'b', numericScore: 13.333333333333334, conclusion: 'Conservar conclusión.' }));
assert.ok(!precision.text.includes('13.333333333333334'), 'Do not export numeric grades');
assert.deepEqual(precision.text.split('\t'), ['Promedio exacto', 'B', 'Conservar conclusión.', '', '', '', '']);

// Use the actual motor's final competency codes, preserving its rounding rule.
const rows = [
  { id: 'primary-1', source: 'primary', competencyName: 'EPT', capacityName: 'Crea propuestas', criterionText: 'Primero' },
  { id: 'primary-2', source: 'primary', competencyName: 'EPT', capacityName: 'Crea propuestas', criterionText: 'Segundo' },
  { id: 'transversal-1-1', source: 'transversal', competencyName: transversal[0].competencyName, capacityName: 'Define metas', criterionText: 'Tercero' },
  { id: 'transversal-2-1', source: 'transversal', competencyName: transversal[1].competencyName, capacityName: 'Gestiona información', criterionText: 'Cuarto' },
];
const session = { id: 's1', year: '2026', areaId: 'EPT', grade: '2do', section: 'A', unitNumber: '5', sessionNumber: '1', bimesterLabel: 'III', sessionData: { numericAverageRounding: 'nearest_integer', sessionAssessmentModel: { rows } } };
const records = rows.map((row, index) => ({ student_id: 's', session_id: 's1', criteria_id: row.id, numeric_score: [10, 11, 14, 11][index], level: ['C', 'B', 'A', 'B'][index], grading_mode: 'hybrid_vigesimal' }));
const bundleInput = { students: [{ id: 's', name: 'Estudiante', estado: 'A' }, { id: 'r', name: 'Retirado', estado: 'R' }], sessions: [session], records };
const inputBefore = JSON.stringify(bundleInput);
const result = createRegisterAggregation('hybrid_vigesimal').buildBimesterRegisterAggregation(bundleInput);
const groups = result.students[0].competencies.map(row => ({ competencyKey: row.key, competencyName: row.competencyName, source: row.source }));
const actual = buildCompetencyClipboardData(result.students, groups.filter(row => row.source === 'primary'), groups.filter(row => row.source === 'transversal'), (student, group) => ({ ...student.competencies.find(row => row.key === group.competencyKey), conclusion: 'Conclusión vigente.' }));
assert.equal(result.students[0].competencies.find(row => row.source === 'primary').numericScore, 10.5);
assert.equal(actual.text, [
  ['Estudiante', 'B', 'Conclusión vigente.', 'B', 'Conclusión vigente.', 'A', 'Conclusión vigente.'],
  ['Retirado', 'NE', 'Conclusión vigente.', 'NE', 'Conclusión vigente.', 'NE', 'Conclusión vigente.'],
].map(row => row.join('\t')).join('\r\n'));
assert.equal(JSON.stringify(bundleInput), inputBefore);
console.log('OK: name + literal/conclusion pairs only, no numeric grades, dynamic area, correct TIC/autonomy order, fixed empty columns, multiline conclusion safety, pending/NE and no mutation.');
