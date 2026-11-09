import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createRegisterAggregation } from '../backend/shared/registerAggregation.generated.js';

const primary = 'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.';
const tic = 'Se desenvuelve en los entornos virtuales generados por las TIC';
const autonomy = 'Gestiona su aprendizaje de manera autónoma';
const definitions = [
  ['primary-1', 'primary', primary, 'Crea propuestas de valor', 'Identifica necesidades de usuarios.'],
  ['transversal-1-1', 'transversal', tic, 'Personaliza entornos virtuales.', 'Configura su perfil de aprendizaje.'],
  ['transversal-2-1', 'transversal', autonomy, 'Define metas de aprendizaje.', 'Establece metas realistas y viables.'],
];
const rows = definitions.map(([id, source, competencyName, capacityName, criterionText]) => ({ id, source, competencyName, capacityName, criterionText }));
const instrument = (id, competency, capacity, criterion) => ({ id, competencia: competency, capacidad: capacity, criterio: criterion, source: competency === primary ? 'primary' : 'transversal' });
const data = {
  competenciaPrio: { comp: primary, cap: rows[0].capacityName, des: rows[0].criterionText },
  assessmentModel: { competencia: primary, capacidades: [rows[0].capacityName], criterios: [{ text: rows[0].criterionText, capacidad: rows[0].capacityName }] },
  competenciasTrans: rows.slice(1).map(row => ({ comp: row.competencyName, cap: row.capacityName, des: row.criterionText })),
  sessionAssessmentModel: { rows },
  instrumento: [instrument(...[rows[0].id, primary, rows[0].capacityName, rows[0].criterionText]),
    instrument('transversal-1-1', tic, rows[1].capacityName, 'Captura de su perfil.'),
    instrument('transversal-1-2', tic, rows[1].capacityName, 'Registro de participación.'),
    instrument('transversal-2-1', autonomy, rows[2].capacityName, 'Ficha de autodiagnóstico.'),
    instrument('transversal-2-2', autonomy, rows[2].capacityName, 'Diario de aprendizaje.')],
};
const session = { id: 'legacy', year: '2026', areaId: 'EPT', grade: '3ro', section: 'U', unitNumber: '5', sessionNumber: '1', bimesterLabel: 'III', sessionData: data };
const students = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), name: `Estudiante ${i + 1}`, estado: 'A' }));
const records = students.flatMap(student => ['primary-1', 'transversal-1-1', 'transversal-1-2'].map((id, i) => ({ student_id: student.id, session_id: session.id, criteria_id: id, level: i === 2 ? 'b' : 'c', numeric_score: i === 2 ? 12 : 10 })));
const original = structuredClone({ data, records });
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-register-display-'));
try {
  const file = path.join(folder, 'session.mjs');
  await build({ entryPoints: [path.resolve('components/sessions-view/shared.tsx')], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { ensureSessionAssessmentModel, buildSessionAssessmentModel, buildSessionInstrumentRows } = await import(pathToFileURL(file).href);
  const loaded = ensureSessionAssessmentModel(data);
  const visibleRows = buildSessionInstrumentRows({}, buildSessionAssessmentModel(loaded), loaded.instrumento);
  const visibleAutonomy = visibleRows.find(row => row.competencia === autonomy);
  assert.equal(visibleAutonomy.id, 'transversal-1-2', 'Reproduce the effective ID used by the grading screen');
  const motor = createRegisterAggregation('hybrid_vigesimal');
  for (const calculate of [motor.buildUnitRegisterAggregation, motor.buildBimesterRegisterAggregation]) {
    const result = calculate({ sessions: [session], students, records });
    assert.equal(result.students.filter(student => student.competencies.find(row => row.competencyName === autonomy)?.numericScore === 12).length, 20);
    assert.ok(result.students.every(student => !student.pending));
    const missing = calculate({ sessions: [session], students, records: records.filter(row => row.criteria_id !== visibleAutonomy.id) });
    assert.ok(missing.students.every(student => student.competencies.find(row => row.competencyName === autonomy)?.pending), 'A genuinely missing grade must stay pending');
    const explicit = calculate({ sessions: [session], students, records: [...records, ...students.map(student => ({ student_id: student.id, session_id: session.id, criteria_id: 'transversal-2-1', level: 'a', numeric_score: 15 }))] });
    assert.ok(explicit.students.every(student => student.competencies.find(row => row.competencyName === autonomy)?.numericScore === 15), 'Existing canonical grades retain priority');
  }
  assert.deepEqual({ data, records }, original, 'Reading must not rewrite instruments or grades');
} finally {
  assert.ok(folder.startsWith(path.join(os.tmpdir(), 'armi-register-display-')));
  fs.rmSync(folder, { recursive: true, force: true });
}
console.log('OK: session screen and unit/bimester consolidation agree for 20 legacy records; missing grades and canonical priority preserved.');
