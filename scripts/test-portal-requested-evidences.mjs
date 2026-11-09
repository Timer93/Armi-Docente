import assert from 'node:assert/strict';
import { getPortalRequestedEvidences, resolvePortalRequestedEvidence, readRequestedEvidence } from '../backend/shared/portalRequestedEvidences.js';

const data = {
  competenciaPrio: { comp: 'Emprendimiento', evidence: '<ul><li>Entrevista (audio, imágenes o video)</li><li>Ficha de respuestas</li></ul>' },
  competenciasTrans: [
    { comp: 'Se desenvuelve en los entornos virtuales generados por las TIC', evidence: '<p>Presentación digital</p>', rowColor: '#007c59' },
    { comp: 'Gestiona su aprendizaje de manera autónoma', evidence: '• Plan de trabajo\n• Autoevaluación' },
  ],
};
const items = getPortalRequestedEvidences(data);
assert.equal(items.length, 5);
assert.equal(items[0].text, 'Entrevista (audio, imágenes o video)', 'Commas/examples must not invent more deliverables');
assert.deepEqual(items.map(item => item.source), ['primary', 'primary', 'transversal', 'transversal', 'transversal']);
assert.equal(items[3].color, '#00b28c');
const reordered = getPortalRequestedEvidences({ ...data, competenciaPrio: { ...data.competenciaPrio, evidence: '<p>Ficha de respuestas</p><p>Entrevista (audio, imágenes o video)</p>' } });
assert.equal(reordered[1].id, items[0].id, 'Ids must survive reordering and equivalent HTML');
assert.equal(getPortalRequestedEvidences({ competenciaPrio: { comp: 'Área', evidence: '<p>Producto</p><p>Producto</p>' } }).length, 1);
const previous = { requested_evidence: JSON.stringify(items[2]) };
assert.deepEqual(resolvePortalRequestedEvidence({}, '', previous), items[2], 'Replacement preserves original category even if planning changed');
assert.throws(() => resolvePortalRequestedEvidence(data, items[0].id, previous), error => error.statusCode === 400);
assert.throws(() => resolvePortalRequestedEvidence(data, 'foreign-id'), error => error.statusCode === 400);
assert.equal(resolvePortalRequestedEvidence(data, ''), null, 'Older clients still work');
assert.equal(readRequestedEvidence('bad json'), null);
console.log('OK: productos del área y transversales, listas reales, identidad estable y reemplazos seguros.');
