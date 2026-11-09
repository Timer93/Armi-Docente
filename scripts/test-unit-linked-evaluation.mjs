import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';
import { editUnitLinkedEvaluation } from '../utils/unitLinkedEvaluation.ts';

// Exercise the actual catalog, derivation and save normalization from UnitsView.
const source = fs.readFileSync('components/UnitsView.tsx', 'utf8');
const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const fixtures = `
const prioritizedCompetencies = [{id:'comp-with-hyphen',rows:[{originalIdx:3,capacidades:'Diseña'},{originalIdx:4,capacidades:'Evalúa'}]}];
const groupedTransversales = [{id:'autonomia',rows:[{originalIdx:7,capacidades:'Organiza'}]}];
const AREA_TEXT_COLOR='text-black', TRANS_TEXT_COLORS_STRONG=['text-green'];
const normalizeLoose=(v)=>String(v||'').toLowerCase().trim();
const normalizeBulletArtifacts=(v)=>v;
const extractMeaningfulTokens=(v)=>[v];
const LIST_BREAK_RE=/^\\s*(?:[-*•]|(?:\\d+[\\.\\)]))\\s+/;
const cleanListLine=(line)=>String(line||'').replace(LIST_BREAK_RE,'').trim();
`;
const code = fixtures + take('const splitBulletLikeText =', 'const extractMeaningfulTokens =')
    + take('const buildSessionEvidenceCatalog =', 'const sessionEvidenceCatalog =')
    + take('const deriveSessionEvaluationData =', 'const normalizeSessionCriterionOwnership =')
    + take('const normalizeSessionCriterionOwnership =', 'const updateSessionAtIndex =')
    + '\nexport {splitBulletLikeText,deriveSessionEvaluationData,normalizeSessionCriterionOwnership};';
const compiled = await transform(code, { loader: 'ts', format: 'esm' });
const { splitBulletLikeText: split, deriveSessionEvaluationData: derive, normalizeSessionCriterionOwnership: normalize } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const refresh = (unit) => ({ ...unit, sesiones: normalize(unit.sesiones.map((s) => ({ ...s, ...derive(s, unit) }))) });
let unit = refresh({
    criterios: { 3: 'Diseña un prototipo.', 4: 'Evalúa el proyecto.' },
    evidencias: { 3: '• Boceto inicial.\n• Prototipo terminado.', 4: 'Informe.' },
    criteriosTrans: { 7: 'Organiza sus metas.' }, evidenciasTrans: { 7: 'Agenda.' },
    instrumentos: {}, instrumentosTrans: {},
    sesiones: [
        { id: 1, competencia: 'comp-with-hyphen', capacidades: ['Diseña', 'Organiza'], transversales: ['autonomia'], evidenceDistributionMode: 'auto' },
        { id: 2, competencia: 'comp-with-hyphen', capacidades: ['Diseña'], evidenceDistributionMode: 'manual', selectedEvidenceIds: ['area-3-1'] },
        { id: 3, competencia: 'comp-with-hyphen', capacidades: ['Evalúa'], evidenceDistributionMode: 'auto' }
    ]
});
const original = structuredClone(unit);
unit = refresh(editUnitLinkedEvaluation(unit, 2, 'evidence', 'area-3-1', 'Prototipo revisado por el equipo.', split));
assert.equal(unit.evidencias[3], '• Boceto inicial.\n• Prototipo revisado por el equipo.');
assert.equal(original.evidencias[3], '• Boceto inicial.\n• Prototipo terminado.', 'No mutation of previous React state');
assert.match(unit.sesiones[0].evi, /Prototipo revisado/);
assert.equal(unit.sesiones[1].evi, 'Prototipo revisado por el equipo.');
assert.deepEqual(unit.sesiones[1].selectedEvidenceIds, ['area-3-1']);
assert.deepEqual(unit.sesiones[2], original.sesiones[2], 'Unrelated capacity stays unchanged');
unit = refresh(editUnitLinkedEvaluation(unit, 1, 'criteria', 'area-comp-with-hyphen-3', 'Diseña y justifica el prototipo.', split));
assert.equal(unit.criterios[3], 'Diseña y justifica el prototipo.');
assert.match(unit.sesiones[1].des, /justifica/);
unit = refresh(editUnitLinkedEvaluation(unit, 1, 'criteria', 'trans-autonomia-7', 'Organiza y revisa sus metas.', split));
unit = refresh(editUnitLinkedEvaluation(unit, 1, 'evidence', 'trans-7-0', 'Agenda con metas verificadas.', split));
assert.equal(unit.criteriosTrans[7], 'Organiza y revisa sus metas.');
assert.equal(unit.evidenciasTrans[7], 'Agenda con metas verificadas.');
assert.match(unit.sesiones[0].des, /revisa sus metas/);
assert.match(unit.sesiones[0].evi, /metas verificadas/);
// The reverse direction uses the matrix as the same source of truth.
unit = refresh({ ...unit, evidencias: { ...unit.evidencias, 3: '• Boceto mejorado.\n• Prototipo evaluado.' }, criterios: { ...unit.criterios, 3: 'Criterio editado en la matriz.' } });
assert.equal(unit.sesiones[1].evi, 'Prototipo evaluado.');
assert.equal(unit.sesiones[1].des, 'Criterio editado en la matriz.');
const reopened = refresh(JSON.parse(JSON.stringify(unit)));
assert.deepEqual(reopened, unit, 'Save and reopening must never reconstruct the previous text');
const cleared = refresh(editUnitLinkedEvaluation(unit, 2, 'evidence', 'area-3-1', '', split));
assert.equal(cleared.evidencias[3], 'Boceto mejorado.');
assert.equal(cleared.sesiones[1].evi, '');
assert.deepEqual(cleared.sesiones[1].selectedEvidenceIds, []);
assert.equal(refresh(JSON.parse(JSON.stringify(cleared))).sesiones[1].evi, '');
const clearedCriterion = refresh(editUnitLinkedEvaluation(unit, 1, 'criteria', 'area-comp-with-hyphen-3', '', split));
assert.equal(clearedCriterion.criterios[3], '');
assert.equal(clearedCriterion.sesiones[1].des, '');
assert.equal(clearedCriterion.sesiones[1].evi, '', 'A linked evidence must not survive its removed criterion as a stale copy');
const removedFirst = refresh(editUnitLinkedEvaluation(unit, 1, 'evidence', 'area-3-0', '', split));
assert.deepEqual(removedFirst.sesiones[1].selectedEvidenceIds, ['area-3-0']);
assert.equal(removedFirst.sesiones[1].evi, 'Prototipo evaluado.');
const withIndependent = { ...unit, sesiones: [...unit.sesiones, { id: 4, evi: 'Texto independiente.', evidenceItems: [], selectedEvidenceIds: [], evidenceDistributionMode: 'manual' }] };
assert.deepEqual(editUnitLinkedEvaluation(withIndependent, 1, 'evidence', 'area-3-0', '', split).sesiones[3], withIndependent.sesiones[3]);
assert.equal(editUnitLinkedEvaluation(unit, 99, 'criteria', 'area-comp-with-hyphen-3', 'wrong', split), unit);
assert.equal(editUnitLinkedEvaluation(unit, 1, 'evidence', 'area-999-0', 'wrong', split), unit);
console.log('OK: edición bidireccional, varias evidencias, criterios del área/transversales, selección manual y reapertura sin pérdida.');
