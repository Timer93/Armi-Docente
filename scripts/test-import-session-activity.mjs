import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { importSessionActivity } from '../backend/importSessionActivity.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-import-html-'));
const file = path.join(root, 'import.db');
let db = new Database(file);
const html = '<!doctype html><html><head><meta name="armi-activity-version" content="1"></head><body><header>Prueba</header><main>Actividad</main><footer>ARMI</footer><script>window.parent.postMessage({type:"armi:activity-result"},"*")</script></body></html>';
const criterion = { id: 'c1', source: 'primary', criterionText: 'Criterio de prueba' };
const payload = { year: '2026', areaId: 'area', grade: '1', section: 'A', unitNumber: '1', sessionNumber: '1',
  activity: { id: 'html-1', html, enabled: true, criterionId: 'c1', mode: 'individual', title: 'Prueba' },
  sessionData: { title: 'Borrador', sessionAssessmentModel: { rows: [criterion] } } };
const id = '2026-area-1-A-U1-S1';
const read = () => JSON.parse(db.prepare('SELECT session_data FROM sesiones WHERE id_sesion = ?').get(id).session_data);
try {
  db.exec('CREATE TABLE sesiones (id INTEGER PRIMARY KEY, id_sesion TEXT UNIQUE, year TEXT, area_id TEXT, grade TEXT, section TEXT, unit_number TEXT, session_number TEXT, session_data TEXT, updated_at TEXT)');
  importSessionActivity(db, payload);
  assert.equal(read().interactiveActivities[0].html, html);
  db.close(); db = new Database(file);
  assert.equal(read().interactiveActivities[0].id, 'html-1', 'The import survives closing and reopening the database without a full lesson save.');
  assert.equal(read().sessionAssessmentModel.rows[0].id, 'c1', 'The portal has the criterion needed to publish the activity.');
  const saved = { ...read(), title: 'Título guardado más reciente', purpose: 'Conservar', learningResources: { annex1: { imageUrl: 'actual.png' } }, otherField: 'Otro dato' };
  db.prepare('UPDATE sesiones SET session_data = ? WHERE id_sesion = ?').run(JSON.stringify(saved), id);
  importSessionActivity(db, { ...payload, activity: { ...payload.activity, id: 'html-2' } });
  for (const field of ['title', 'purpose', 'learningResources', 'otherField']) assert.deepEqual(read()[field], saved[field], 'Import never replaces ' + field + ' from a stale editor snapshot.');
  importSessionActivity(db, { ...payload, activity: { ...payload.activity, id: 'html-2' } });
  assert.equal(read().interactiveActivities.length, 2, 'Retry does not duplicate the activity.');
  assert.throws(() => importSessionActivity(db, { ...payload, activity: { ...payload.activity, html: html.replace('Actividad', 'Otra') } }), /otra versión/);
  const newCriterion = { id: 'c2', source: 'primary', criterionText: 'Criterio nuevo' };
  importSessionActivity(db, { ...payload, activity: { ...payload.activity, id: 'html-3', criterionId: 'c2' }, sessionData: { sessionAssessmentModel: { rows: [newCriterion] } } });
  assert.deepEqual(read().sessionAssessmentModel.rows, [criterion, newCriterion], 'A new selected criterion is appended without losing existing criteria.');
  const before = read();
  assert.throws(() => importSessionActivity(db, { ...payload, activity: { ...payload.activity, id: 'bad', html: html.replace('<main>', '<main><script src="https://evil.example/script.js"></script>') } }), /requisitos/);
  assert.deepEqual(read(), before, 'Invalid imports change nothing.');
  assert.throws(() => importSessionActivity(db, { ...payload, activity: { ...payload.activity, id: 'bad', criterionId: 'missing' } }), /criterio/);
  assert.deepEqual(read(), before, 'A missing criterion rolls back the import.');
  for (const activityId of ['html-4', 'html-5']) importSessionActivity(db, { ...payload, activity: { ...payload.activity, id: activityId } });
  assert.throws(() => importSessionActivity(db, { ...payload, activity: { ...payload.activity, id: 'html-6' } }), /5 actividades/);
  assert.equal(read().interactiveActivities.length, 5);
  assert.throws(() => importSessionActivity(db, { ...payload, year: '' }), /sesión válida/);
  importSessionActivity(db, { ...payload, sessionNumber: '2', sessionData: { ...payload.sessionData, interactiveActivities: [payload.activity] } });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sesiones').get().count, 2, 'A draft already containing the activity must still be inserted durably.');
  const client = fs.readFileSync('components/sessions-view/SessionInteractiveHtml.tsx', 'utf8');
  assert(client.indexOf('await onImport(activity)') < client.indexOf('onChange([...activities, activity])'), 'The UI only accepts the import after server confirmation.');
  assert.match(client, /activeSessionRef.current !== importingSession/);
  assert.doesNotMatch(client, /Guarda la sesión para publicarlo/);
  console.log('OK: automatic durable HTML import, idempotent retry, preserved lesson fields, criterion, limits and rollback on invalid input.');
} finally {
  db.close();
  // Only this test-created directory in the OS temporary folder.
  fs.rmSync(root, { recursive: true, force: true });
}
