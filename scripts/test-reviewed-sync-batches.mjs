import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { reviewedLegacyBatchDecisions, reviewedSyncDigest } from '../backend/reviewedSyncBatches.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-reviewed-sync-'));
const db = new Database(':memory:');
db.exec(`CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT);
  CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY,grading_mode TEXT,student_id TEXT,session_id TEXT,criteria_id TEXT,numeric_score REAL,updated_at TEXT);
  INSERT INTO evaluacion_registros VALUES(1,'hybrid_vigesimal','22','S1','c1',15,'2026-10-20');
  INSERT INTO armi_frontend_state VALUES('armi_hybrid_numeric_scores_v1','{"S1::22::c1":15}');`);
const key = 'armi_hybrid_numeric_scores_v1';
const old = { format: 1, batchId: 'old-batch', deviceId: 'old-pc', operations: [{ table: 'armi_frontend_state', action: 'upsert', row: { key, value: '{"S1::11::c1":5}' }, keyColumns: ['key'], keyValues: [key], key: JSON.stringify([['key'], [key]]) }] };
const calendar = { format: 2, batchId: 'calendar-approved', deviceId: 'reviewer', operations: [{ table: 'armi_frontend_state', action: 'upsert', row: { key: 'armi_holidays_v7', value: '[]' } }] };
const receipt = { format: 1, migrationId: 'migration-test', policy: 'retain-verified-current-and-apply-approved-calendar', preserveAcademicData: true,
  approvedCalendar: { batchId: calendar.batchId, deviceId: calendar.deviceId, sha256: reviewedSyncDigest(calendar) },
  batches: [{ batchId: old.batchId, deviceId: old.deviceId, sha256: reviewedSyncDigest(old), decision: 'retain-verified-current' }] };
const manifestPath = path.join(root, '.armi-sync/reconciliation-audits/review/sync-resolution.json');
const eventPath = path.join(root, '.armi-sync/incremental-v1/devices/reviewer/events/calendar-approved.json');
for (const file of [manifestPath, eventPath]) fs.mkdirSync(path.dirname(file), { recursive: true });
const writeReceipt = () => fs.writeFileSync(manifestPath, JSON.stringify(receipt));
writeReceipt(); fs.writeFileSync(eventPath, JSON.stringify(calendar));
const state = { identityMigrationId: 'migration-test', appliedBatches: ['calendar-approved'] };
const options = { db, mirrorPath: root, state, batches: [old], readJson: async file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } } };
try {
  assert.equal((await reviewedLegacyBatchDecisions(options)).length, 1);
  assert.equal(db.prepare('SELECT numeric_score FROM evaluacion_registros').get().numeric_score, 15);
  db.prepare("INSERT INTO evaluacion_registros VALUES(2,'hybrid_vigesimal','22','S2','c1',0,'2026-10-21')").run();
  assert.equal((await reviewedLegacyBatchDecisions(options)).length, 1, 'New uncached official grades remain intact');
  assert.deepEqual(await reviewedLegacyBatchDecisions({ ...options, state: { ...state, appliedBatches: [] } }), [], 'Wait until the approved calendar has passed through the normal engine');
  assert.deepEqual(await reviewedLegacyBatchDecisions({ ...options, state: { ...state, identityMigrationId: 'other' } }), []);
  const tampered = structuredClone(old); tampered.operations[0].row.value = 'new data';
  assert.deepEqual(await reviewedLegacyBatchDecisions({ ...options, batches: [tampered] }), [], 'A receipt cannot suppress unseen edits');
  const gradeBatch = structuredClone(old); gradeBatch.operations.push({ table: 'evaluacion_registros', action: 'delete', keyValues: [1] });
  receipt.batches[0].sha256 = reviewedSyncDigest(gradeBatch); writeReceipt();
  assert.deepEqual(await reviewedLegacyBatchDecisions({ ...options, batches: [gradeBatch] }), [], 'Even a matching receipt cannot suppress academic operations');
  receipt.batches[0].sha256 = reviewedSyncDigest(old); writeReceipt();
  db.prepare('UPDATE evaluacion_registros SET numeric_score=16 WHERE id=1').run();
  assert.deepEqual(await reviewedLegacyBatchDecisions(options), [], 'An unverified cache must not authorize the decision');
  db.prepare('UPDATE evaluacion_registros SET numeric_score=15 WHERE id=1').run();
  receipt.approvedCalendar.deviceId = '../outside'; writeReceipt();
  assert.deepEqual(await reviewedLegacyBatchDecisions(options), []);
  receipt.approvedCalendar.deviceId = 'reviewer'; receipt.batches.unshift(null); writeReceipt();
  assert.equal((await reviewedLegacyBatchDecisions(options)).length, 1, 'Malformed unrelated entries do not break synchronization');
  console.log('OK: conciliación verificable, calendario previo, caché contrastada, migración exacta, rechazo de cambios nuevos, notas y rutas externas.');
} finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
