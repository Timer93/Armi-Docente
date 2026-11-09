import assert from 'node:assert/strict';
import { resolveUnitSessionEvidenceItems } from '../backend/routes/unitSessionExportData.js';

const areaEvidence = {
  0: '• Guía de entrevista estructurada.\n• Informe de necesidades.',
  2: 'Plan de acción del proyecto.',
};
const transversalEvidence = {
  4: 'Ficha de autorreflexión.',
};

const recovered = resolveUnitSessionEvidenceItems({
  selectedCriteriaIds: ['area-competencia-0', 'trans-autonomia-4'],
  evidenceItems: [],
  evi: '',
}, areaEvidence, transversalEvidence);
assert.deepEqual(recovered.map((item) => item.text), [
  'Guía de entrevista estructurada.',
  'Informe de necesidades.',
  'Ficha de autorreflexión.',
]);
assert.equal(recovered[2].color, 'text-[#007c59]');

const stored = resolveUnitSessionEvidenceItems({
  evidenceItems: [{ text: 'Evidencia personalizada.', color: 'text-rose-600' }],
  selectedCriteriaIds: ['area-competencia-0'],
}, areaEvidence, transversalEvidence);
assert.deepEqual(stored, [{ text: 'Evidencia personalizada.', color: 'text-rose-600' }]);

const direct = resolveUnitSessionEvidenceItems({ evi: '- Producto final.\n• Registro fotográfico.' }, {}, {});
assert.deepEqual(direct.map((item) => item.text), ['Producto final.', 'Registro fotográfico.']);

console.log('OK: las evidencias de sesión se conservan y se recuperan para unidades antiguas.');

