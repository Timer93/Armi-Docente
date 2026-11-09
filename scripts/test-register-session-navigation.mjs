import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { createRegisterAggregation } from '../backend/shared/registerAggregation.generated.js';
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = { exports: {} };
const bundle = buildSync({ stdin: { contents: "export * from './utils/sessionRegisterNavigation'; export * from './components/evaluation/registers/GradeSessionSourcesDialog';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, packages: 'external', format: 'cjs', platform: 'node', write: false });
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { getGradeSessionSources, openSessionRegister, isSessionRegisterTarget, OPEN_SESSION_REGISTER_EVENT, withSessionRegisterScope, GradeSessionSourcesDialog } = compiled.exports;
const assessmentRows = [
  { id: 'primary-1', source: 'primary', competencyName: 'Gestiona proyectos', capacityName: 'Crea propuestas de valor', criterionText: 'Diseña una propuesta' },
  { id: 'transversal-1-1', source: 'transversal', competencyName: 'Gestiona su aprendizaje', capacityName: 'Define metas', criterionText: 'Define una meta' },
];
const sessions = [[5, 2], [6, 1], [5, 1]].map(([unitNumber, sessionNumber]) => ({ id: `2026-ept-4to-A y B-U${unitNumber}-S${sessionNumber}`, year: '2026', areaId: 'ept', grade: '4to', section: 'A y B', unitNumber: String(unitNumber), sessionNumber: String(sessionNumber), title: `Sesión ${sessionNumber}`, bimesterLabel: 'III', sessionData: { sessionAssessmentModel: { rows: assessmentRows } } }));
const records = sessions.flatMap(session => assessmentRows.map(row => ({ student_id: '7', session_id: session.id, criteria_id: row.id, level: row.source === 'primary' ? 'B' : 'C', numeric_score: row.source === 'primary' ? 13 : 5, grading_mode: 'hybrid_vigesimal' })));
const calculator = createRegisterAggregation('hybrid_vigesimal');
const input = { students: [{ id: '7', name: 'Estudiante de prueba', estado: 'A', section: 'B' }, { id: '8', name: 'Sin notas', estado: 'A', section: 'B' }], sessions, records };
const original = JSON.stringify(input);
let sources;
for (const method of ['buildUnitRegisterAggregation', 'buildBimesterRegisterAggregation']) {
  const aggregation = calculator[method](input);
  const before = JSON.stringify(aggregation);
  const student = aggregation.students.find(row => row.studentId === '7');
  const capacity = student.capacities.find(row => row.source === 'primary');
  const context = { studentId: '7', studentName: student.studentName, studentSection: 'B', areaName: 'Educación para el Trabajo', key: capacity.key, competencyName: capacity.competencyName, capacityName: capacity.capacityName };
  sources = getGradeSessionSources(aggregation, sessions, context);
  assert.deepEqual(sources.map(row => `${row.unitNumber}-${row.sessionNumber}`), ['5-1', '5-2', '6-1']);
  assert.ok(sources.every(row => row.code === 'b' && row.numericScore === 13));
  assert.ok(sources.every(row => row.section === 'A y B' && row.studentSection === 'B'));
  assert.ok(sources.every(isSessionRegisterTarget));
  assert.deepEqual(getGradeSessionSources(aggregation, sessions, { ...context, key: 'legacy-capacity-key' }), sources, 'Match legacy capacity keys by competency and capacity, not unrelated grades');
  assert.deepEqual(getGradeSessionSources(aggregation, sessions, { ...context, studentId: '8' }), [], 'No fabricated source for a student without grades');
  const competency = student.competencies.find(row => row.source === 'primary');
  assert.equal(getGradeSessionSources(aggregation, sessions, { ...context, capacityName: undefined, key: competency.key }).length, 3);
  const single = { ...aggregation, sessions: aggregation.sessions.slice(0, 1) };
  assert.equal(getGradeSessionSources(single, sessions, context).length, 1);
  assert.equal(JSON.stringify(aggregation), before, 'Finding grade origins must not mutate consolidated grades');
}
assert.equal(JSON.stringify(input), original, 'Session grades remain unchanged');
assert.equal(isSessionRegisterTarget({ sessionId: 'incomplete' }), false);
const assignments = [];
const scoped = withSessionRegisterScope(assignments, sources[0]);
assert.equal(assignments.length, 0, 'Historical navigation must not mutate configured assignments');
assert.equal(scoped[0].areaId, 'ept');
assert.equal(withSessionRegisterScope(scoped, sources[0]).length, 1);

// A missing transversal grade makes that capacity and competency pending.
// Pending links must lead to the missing sessions, not the already graded ones.
const missingSessions = new Set([sessions[0].id, sessions[1].id]);
const pendingInput = { ...input, records: records.filter(row => !(row.criteria_id.startsWith('transversal') && missingSessions.has(row.session_id))) };
const pendingOriginal = JSON.stringify(pendingInput);
let pendingSources;
for (const method of ['buildUnitRegisterAggregation', 'buildBimesterRegisterAggregation']) {
  const pendingAggregation = calculator[method](pendingInput);
  const student = pendingAggregation.students.find(row => row.studentId === '7');
  const capacity = student.capacities.find(row => row.source === 'transversal');
  const competency = student.competencies.find(row => row.source === 'transversal');
  assert.equal(capacity.pending, true); assert.equal(competency.pending, true);
  assert.equal(student.competencies.find(row => row.source === 'primary').code, 'b');
  const context = { studentId: '7', studentName: student.studentName, studentSection: 'B', areaName: 'EPT', key: capacity.key, competencyName: capacity.competencyName, capacityName: capacity.capacityName, pendingOnly: true };
  pendingSources = getGradeSessionSources(pendingAggregation, sessions, context);
  assert.deepEqual(new Set(pendingSources.map(row => row.sessionId)), missingSessions);
  assert.ok(pendingSources.every(row => row.pending && row.numericScore == null));
  assert.deepEqual(getGradeSessionSources(pendingAggregation, sessions, { ...context, capacityName: undefined, key: competency.key }), pendingSources.map(row => ({ ...row, capacityName: undefined })));
  assert.equal(getGradeSessionSources(pendingAggregation, sessions, { ...context, pendingOnly: false }).length, 1, 'A normal grade link still lists only graded origins');
  assert.deepEqual(getGradeSessionSources(pendingAggregation, sessions, { ...context, key: 'not-developed', capacityName: 'Not developed in any session' }), [], 'Do not require a capacity that no session develops');
}
assert.equal(JSON.stringify(pendingInput), pendingOriginal, 'Diagnosing missing grades must not fill or alter scores');
const inactive = calculator.buildUnitRegisterAggregation({ ...pendingInput, students: [{ ...input.students[0], estado: 'R' }] });
assert.equal(getGradeSessionSources(inactive, sessions, { studentId: '7', studentName: 'Inactive', studentSection: 'B', areaName: 'EPT', key: inactive.students[0].capacities.find(row => row.source === 'transversal').key, competencyName: 'Gestiona su aprendizaje', capacityName: 'Define metas', pendingOnly: true }).length, 0, 'Retired students remain NE, never pending');

const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(globalThis, { window, document: window.document, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
let destination, closed = 0;
window.addEventListener(OPEN_SESSION_REGISTER_EVENT, event => { if (isSessionRegisterTarget(event.detail)) destination = event.detail; });
const root = createRoot(document.getElementById('root'));
await act(async () => root.render(React.createElement(GradeSessionSourcesDialog, { sources, onClose: () => { closed++; }, onOpen: openSessionRegister })));
assert.equal(document.querySelectorAll('[role="dialog"] button').length, 4);
assert.match(document.querySelector('[role="dialog"]').textContent, /Unidad 5 · S1/);
await act(async () => document.querySelectorAll('[role="dialog"] button')[2].dispatchEvent(new window.Event('click', { bubbles: true })));
assert.equal(destination.sessionId, sources[1].sessionId);
assert.equal(destination.studentId, '7');
assert.equal(destination.areaId, 'ept');
assert.equal(destination.studentSection, 'B');
assert.equal(closed, 0, 'Choosing an origin must not accidentally click the backdrop');
const escape = new window.Event('keydown', { bubbles: true }); escape.key = 'Escape';
await act(async () => document.querySelector('[role="dialog"]').dispatchEvent(escape));
assert.equal(closed, 1);
await act(async () => root.unmount());
const pendingRoot = createRoot(document.getElementById('root'));
await act(async () => pendingRoot.render(React.createElement(GradeSessionSourcesDialog, { sources: pendingSources, onClose() {}, onOpen: openSessionRegister })));
assert.match(document.querySelector('h3').textContent, /Sesiones con notas pendientes/);
assert.equal(document.querySelectorAll('[role="dialog"] button').length, 3);
assert.match(document.querySelector('[role="dialog"]').textContent, /Pendiente/);
await act(async () => document.querySelectorAll('[role="dialog"] button')[1].dispatchEvent(new window.Event('click', { bubbles: true })));
assert.equal(destination.pending, true);
assert.ok(missingSessions.has(destination.sessionId));
await act(async () => pendingRoot.unmount());
fs.mkdirSync('artifacts/register-navigation-preview', { recursive: true });
fs.writeFileSync('artifacts/register-navigation-preview/dialog-markup.html', renderToStaticMarkup(React.createElement(GradeSessionSourcesDialog, { sources, onClose() {}, onOpen() {} })));
fs.writeFileSync('artifacts/register-navigation-preview/pending-dialog-markup.html', renderToStaticMarkup(React.createElement(GradeSessionSourcesDialog, { sources: pendingSources, onClose() {}, onOpen() {} })));
console.log('OK: real unit/bimester origins and pending-session links, capacity/competency navigation, graded vs missing origins, inactive NE preserved, no grade mutations.');
