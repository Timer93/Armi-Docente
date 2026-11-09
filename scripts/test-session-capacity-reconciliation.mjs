import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import Database from 'better-sqlite3';
import { prepareLessonPlanningSave, reconcileUnitPlanningForLesson } from '../backend/unitSessionPlanningSync.js';
import { reconcileSessionCapacities } from '../backend/shared/sessionCapacityReconciliation.js';

const fixture = {
  competenciaPrio: { comp: 'Área', cap: 'Capacidad vigente', des: '<p>Criterio propio</p>' },
  competenciasTrans: [{ comp: 'Autonomía', cap: 'Meta vigente', des: '<p>Criterio transversal</p>' }],
  assessmentModel: { competencia: 'Área', capacidades: ['Capacidad vieja'], criterios: [{ id: '17', text: 'Criterio propio', capacidad: 'Capacidad vieja' }] },
  sessionAssessmentModel: { rows: [{ id: '17', source: 'primary', competencyName: 'Área', capacityName: 'Capacidad vieja', criterionText: 'Criterio propio' }] },
  instrumento: [
    { id: '17', source: 'primary', competencia: 'Área', capacidad: 'Capacidad vieja', criterio: 'Criterio propio', c: 'Descriptor propio' },
    { id: '42', source: 'transversal', competencia: 'Autonomía', capacidad: 'Meta vieja', criterio: 'Criterio transversal', ad: 'Descriptor transversal' }
  ],
  grades: { '17': 'AD' }, learningResources: { file: 'evidencia.png' }
};
const original = structuredClone(fixture);
const repaired = reconcileSessionCapacities(fixture);
assert.deepEqual(fixture, original, 'No mutar los datos recibidos');
assert.equal(repaired.instrumento[0].capacidad, 'Capacidad vigente');
assert.equal(repaired.instrumento[1].capacidad, 'Meta vigente');
assert.equal(repaired.assessmentModel.criterios[0].capacidad, 'Capacidad vigente');
assert.equal(repaired.sessionAssessmentModel.rows[0].capacityName, 'Capacidad vigente');
assert.deepEqual(reconcileSessionCapacities(repaired), repaired, 'La reparación es idempotente');
for (let i = 0; i < 2; i++) {
  assert.equal(repaired.instrumento[i].id, original.instrumento[i].id);
  assert.equal(repaired.instrumento[i].criterio, original.instrumento[i].criterio);
  for (const level of ['c', 'b', 'a', 'ad']) assert.equal(repaired.instrumento[i][level], original.instrumento[i][level]);
}
assert.deepEqual(repaired.grades, original.grades);
assert.deepEqual(repaired.learningResources, original.learningResources);
const multiple = structuredClone(fixture);
multiple.competenciaPrio.cap = 'Primera\nSegunda';
assert.equal(reconcileSessionCapacities(multiple).instrumento[0].capacidad, 'Capacidad vieja', 'No adivinar asociaciones ambiguas');
multiple.instrumento[0].capacidad = 'Segunda';
assert.equal(reconcileSessionCapacities(multiple).instrumento[0].capacidad, 'Segunda');
for (const cap of ['Primera; Segunda', 'Primera, Segunda', '<p>Primera</p><p>Segunda</p>', 'Primera • Segunda']) {
  multiple.competenciaPrio.cap = cap;
  assert.deepEqual(reconcileSessionCapacities(multiple).assessmentModel.capacidades, ['Primera', 'Segunda']);
  assert.equal(reconcileSessionCapacities(multiple).instrumento[0].capacidad, 'Segunda');
}
const blank = structuredClone(fixture);
blank.competenciaPrio.cap = '';
assert.equal(reconcileSessionCapacities(blank).instrumento[0].capacidad, 'Capacidad vieja', 'Una planificación vacía no debe borrar datos');
const capacityMode = structuredClone(fixture);
capacityMode.instrumento[0] = { ...capacityMode.instrumento[0], rowType: 'capacity', criterio: 'Capacidad vieja' };
assert.equal(reconcileSessionCapacities(capacityMode).instrumento[0].criterio, 'Capacidad vigente');
const db = new Database(':memory:');
try {
  db.exec('CREATE TABLE unidades_didacticas (year TEXT, area_id TEXT, grade TEXT, unit_number TEXT, updated_at TEXT)');
  const scope = { year: '2030', areaId: 'otra-area', grade: '5to', section: 'B', unitNumber: '9', sessionNumber: '7' };
  assert.deepEqual(prepareLessonPlanningSave(db, scope, fixture), repaired, 'Corregir guardados antiguos incluso sin unidad vinculada');
  assert.deepEqual(reconcileUnitPlanningForLesson(db, scope, fixture), repaired, 'Autocorregir al leer cualquier sesión');
} finally { db.close(); }

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-capacity-test-'));
try {
  const outfile = path.join(temporaryDirectory, 'shared.mjs');
  await build({ entryPoints: [path.resolve('components/sessions-view/shared.tsx')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { buildSessionAssessmentModel, buildSessionInstrumentRows, ensureSessionAssessmentModel } = await import(pathToFileURL(outfile).href);
  const model = buildSessionAssessmentModel(fixture);
  assert.equal(model.rows[0].capacityName, 'Capacidad vigente');
  assert.equal(model.rows[1].capacityName, 'Meta vigente');
  const rows = buildSessionInstrumentRows({}, model, fixture.instrumento);
  assert.equal(rows[0].capacidad, 'Capacidad vigente', 'El instrumento antiguo no debe reemplazar el modelo vigente');
  assert.equal(rows[1].capacidad, 'Meta vigente');
  assert.equal(rows[0].id, '17');
  assert.equal(rows[1].id, '42');
  assert.equal(rows[0].c, 'Descriptor propio');
  const autonomy={id:'autonomy-1',source:'transversal',competencyName:'Autonomía',capacityName:'Define metas.',criterionText:'Define sus metas'};
  const tic={id:'tic-1',source:'transversal',competencyName:'TIC',capacityName:'Personaliza entornos.',criterionText:'Configura su perfil'};
  const legacyInstrument=[
    {id:'tic-1',source:'transversal',competencia:'TIC',capacidad:'Personaliza entornos.',criterio:'Captura de perfil'},
    {id:'tic-2',source:'transversal',competencia:'TIC',capacidad:'Personaliza entornos.',criterio:'Participación en grupo'},
    {id:'autonomy-1',source:'transversal',competencia:'Autonomía',capacidad:'Define metas.',criterio:'Ficha de metas'}
  ];
  const aligned=buildSessionInstrumentRows({}, {rows:[tic,autonomy]},legacyInstrument);
  assert.deepEqual(aligned.map(row=>row.id),['tic-1','autonomy-1'],'The session screen must not use the second TIC row as Autonomy');
  const conflict=buildSessionInstrumentRows({}, {rows:[{...autonomy,id:'tic-1'}]},legacyInstrument);
  assert.notEqual(conflict[0].id,'tic-1','A regenerated row must not inherit another competency grade');
  const loaded = ensureSessionAssessmentModel(fixture);
  assert.equal(loaded.instrumento[0].capacidad, 'Capacidad vigente');
  assert.equal(loaded.instrumento[1].capacidad, 'Meta vigente');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
console.log('OK: capacidades del área y transversales, IDs, descriptores, casos ambiguos y carga del registro.');
