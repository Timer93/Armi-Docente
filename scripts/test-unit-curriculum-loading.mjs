import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the actual UI derivation functions. Loading an empty catalog must
// preserve saved manual choices; once ready, normal editing must still work.
const source = fs.readFileSync(new URL('../components/UnitsView.tsx', import.meta.url), 'utf8');
const catalog = source.slice(source.indexOf('    const buildSessionEvidenceCatalog ='), source.indexOf('    const sessionEvidenceCatalog ='));
const derivation = source.slice(source.indexOf('    const deriveSessionEvaluationData ='), source.indexOf('    const updateSessionAtIndex ='));
assert.ok(catalog.length > 0 && derivation.includes('const normalizeSessionCriterionOwnership ='));
const js = ts.transpile(catalog + derivation, { target: ts.ScriptTarget.ES2022 });
const comp = 'Gestiona proyectos', cap = 'Crea propuestas de valor', criterionId = `area-${comp}-0`;
const group = { id: comp, rows: [{ originalIdx: 0, capacidades: cap }] };
const unit = { criterios: { 0: 'Identifica necesidades' }, evidencias: { 0: 'Ficha de observación\nMapa de empatía' }, instrumentos: { 0: 'Lista de cotejo' }, criteriosTrans: {}, evidenciasTrans: {}, instrumentosTrans: {} };
const session = {
  id: 1, title: 'Entrevistamos a los usuarios', competencia: comp, capacidades: [cap], transversales: [],
  criteriaSelectionTouched: true, selectedCriteriaIds: [criterionId],
  availableCriteriaOptions: [{ id: criterionId, text: unit.criterios[0], capacidad: cap }],
  criteriaItems: [{ text: unit.criterios[0], sourceCriteriaId: criterionId }], des: unit.criterios[0],
  evidenceDistributionMode: 'manual', selectedEvidenceIds: ['area-0-1'],
  availableEvidenceOptions: [{ id: 'area-0-1', text: 'Mapa de empatía', criterionGroupId: criterionId }],
  evidenceItems: [{ text: 'Mapa de empatía', sourceEvidenceId: 'area-0-1', sourceCriteriaId: criterionId }], evi: 'Mapa de empatía',
};
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const run = new Function('unitPlanningReady', 'prioritizedCompetencies', 'groupedTransversales', 'normalizeLoose', 'normalizeBulletArtifacts', 'TRANS_TEXT_COLORS_STRONG', 'AREA_TEXT_COLOR', 'splitBulletLikeText', 'extractMeaningfulTokens', 'session', 'unit', js + '\nreturn normalizeSessionCriterionOwnership([{ ...session, ...deriveSessionEvaluationData(session, unit) }])[0];');
const derive = (ready, groups, saved) => run(ready, groups, [], normalize, value => String(value || ''), ['green', 'teal'], 'text-black', value => String(value || '').split('\n').filter(Boolean), () => [], saved, unit);
let saved = structuredClone(session);
for (const groups of [[], [{ ...group, id: 'Competencia de otro grado' }]]) {
  saved = derive(false, groups, saved);
  assert.deepEqual(saved, session, 'A missing or stale catalog must preserve every saved field');
}
const loaded = derive(true, [group], saved);
assert.deepEqual(loaded.selectedCriteriaIds, [criterionId]);
assert.deepEqual(loaded.selectedEvidenceIds, ['area-0-1']);
assert.match(loaded.des, /Identifica necesidades/);
assert.match(loaded.evi, /Mapa de empatía/);
assert.equal(loaded.title, session.title);
const intentionallyEmpty = derive(true, [group], { ...session, selectedCriteriaIds: [], selectedEvidenceIds: [], criteriaItems: [], evidenceItems: [], des: '', evi: '' });
assert.deepEqual(intentionallyEmpty.criteriaItems, []);
assert.deepEqual(intentionallyEmpty.evidenceItems, []);
assert.equal(intentionallyEmpty.des, '');
assert.equal(intentionallyEmpty.evi, '');
const automatic = derive(true, [group], { ...session, evidenceDistributionMode: 'auto' });
assert.equal(automatic.evidenceItems.length, 2, 'Automatic distribution continues to include available evidence');
assert.match(source, /if \(!unitPlanningReady\) return;\s*setUnitData\(\(prev: any\) => \{\s*let changed = false/);
assert.match(source, /loadedCurriculumKey === curriculumKey && loadedUnitKey === unitKey/);
console.log('OK: carga incompleta, catálogo de otro grado, selección manual, selección vacía y distribución automática.');
