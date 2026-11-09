import assert from 'node:assert/strict';
import { buildUnitSessionPlanning, mergeUnitSessionPlanning, UNIT_TRANSVERSAL_NAMES } from '../backend/shared/unitSessionPlanning.js';

const lesson = {
  title: 'Sesión redactada',
  competenciaPrio: { comp: 'Emprendimiento', cap: 'Crea propuestas de valor', des: '<p>Criterio del área</p>', evidence: '<p>Producto</p>', field: 'Tema', inst: 'Rúbrica' },
  competenciasTrans: [{ comp: UNIT_TRANSVERSAL_NAMES[0], cap: 'Personaliza entornos virtuales', des: '<p>Configura su entorno</p>', evidence: '<p>Capturas y portafolio</p>', inst: 'Rúbrica', field: '', rowColor: '#007c59' }],
  sessionAssessmentModel: { rows: [{ id: 'primary-7', source: 'primary', competencyName: 'Emprendimiento', criterionText: 'Criterio del área', capacityName: 'Crea propuestas de valor' }, { id: 'transversal-9', source: 'transversal', competencyName: UNIT_TRANSVERSAL_NAMES[0], capacityName: 'Personaliza entornos virtuales', criterionText: 'Configura su entorno', evidenceText: '<p>Capturas y portafolio</p>', levelDescriptors: { c: 'Descriptor propio' } }] },
  instrumento: [{ id: 'transversal-9', criterio: 'Configura su entorno', c: 'Descriptor propio' }],
  purpose: 'Propósito propio', grades: { 'transversal-9': 'AD' }, learningResources: { annex: 'imagen.png' }
};
const legacyUnit = { sesiones: [{ id: 5, title: lesson.title, competencia: 'Emprendimiento', capacidades: ['Crea propuestas de valor'], transversales: [UNIT_TRANSVERSAL_NAMES[0]], des: 'Criterio del área', evi: 'Producto', con: 'Tema', eval: 'Rúbrica' }] };
const original = structuredClone(lesson);
const linked = mergeUnitSessionPlanning(lesson, legacyUnit, 5);
assert.deepEqual(lesson, original, 'No mutar la sesión recibida');
assert.deepEqual(linked.competenciasTrans, lesson.competenciasTrans, 'El primer enlace no borra información ante una distribución incompleta');
assert.equal(linked.sessionAssessmentModel.rows[1].id, 'transversal-9');
assert.equal(linked.sessionAssessmentModel.rows[1].criterionText, 'Configura su entorno');
assert.equal(linked.unitPlanningSnapshot.competenciasTrans[0].des, '<p></p>', 'La referencia registra el estado real de la unidad');
assert.deepEqual(mergeUnitSessionPlanning(linked, legacyUnit, 5), linked, 'Reabrir es idempotente');

const noGroup = structuredClone(legacyUnit); noGroup.sesiones[0].transversales = [];
assert.deepEqual(mergeUnitSessionPlanning(lesson, noGroup, 5).competenciasTrans, lesson.competenciasTrans, 'Ausencia sin historial no demuestra eliminación');
assert.equal(mergeUnitSessionPlanning(linked, noGroup, 5).competenciasTrans.length, 0, 'Una eliminación posterior y comprobada sí se propaga');

const complete = structuredClone(legacyUnit);
Object.assign(complete, { criteriosTrans: { 0: 'Nuevo criterio' }, evidenciasTrans: { 0: 'Nueva evidencia' } });
Object.assign(complete.sesiones[0], {
  capacidades: ['Crea propuestas de valor', 'Personaliza entornos virtuales'],
  criteriaItems: [{ text: 'Criterio del área', color: 'text-black' }, { text: 'Viejo', sourceCriteriaId: 'trans-tic-0', capacidad: 'Personaliza entornos virtuales', color: '#007c59' }],
  evidenceItems: [{ text: 'Vieja', sourceEvidenceId: 'trans-0-0', sourceCriteriaId: 'trans-tic-0', color: '#007c59' }]
});
const updated = mergeUnitSessionPlanning(linked, complete, 5);
assert.equal(updated.competenciasTrans[0].des, '<p>Nuevo criterio</p>');
const emptied = structuredClone(complete); emptied.criteriosTrans[0] = ''; emptied.evidenciasTrans[0] = '';
const removed = mergeUnitSessionPlanning(updated, emptied, 5);
assert.equal(removed.competenciasTrans[0].des, '<p></p>', 'Una eliminación real desde una unidad previamente completa se respeta');
assert.equal(removed.competenciasTrans[0].evidence, '<p></p>');

const added = structuredClone(legacyUnit); added.sesiones[0].transversales.push(UNIT_TRANSVERSAL_NAMES[1]);
const withAddedGroup = mergeUnitSessionPlanning(linked, added, 5);
assert.deepEqual(withAddedGroup.competenciasTrans[0], lesson.competenciasTrans[0], 'Agregar otra competencia no debe vaciar la que ya estaba redactada');
const recovered = { ...lesson, unitPlanningSnapshot: buildUnitSessionPlanning(legacyUnit, 5) };
assert.deepEqual(mergeUnitSessionPlanning(recovered, legacyUnit, 5).competenciasTrans, lesson.competenciasTrans, 'El contenido recuperado se conserva aunque la referencia de unidad esté vacía');
for (const key of ['purpose', 'grades', 'learningResources', 'instrumento']) assert.deepEqual(linked[key], lesson[key]);
console.log('OK: primera vinculación incompleta, reapertura, otra competencia, eliminación intencional y conservación de notas/IDs/descriptores.');
