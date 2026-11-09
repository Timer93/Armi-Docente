import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-history-performance-'));
const mirrorPath = path.join(root, 'mirror');
const events = path.join(mirrorPath, '.armi-sync', 'incremental-v1', 'devices', 'remote', 'events');
const db = new Database(':memory:');
db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, value TEXT)');
fs.mkdirSync(events, { recursive: true });
const engine = createIncrementalMirrorSync({ db, runtimeFolder: path.join(root, 'runtime'),
  getDeviceId: () => 'local', getSourceSignature: () => 'stable-local-revision' });
const originalStat = fs.statSync;
const originalRead = fs.readFileSync;
let historyStats = 0;
let historyReads = 0;
try {
  for (let index = 0; index < 1600; index++) {
    const batchId = `history-${String(index).padStart(5, '0')}`;
    fs.writeFileSync(path.join(events, `${batchId}.json`), JSON.stringify({ format: 1, batchId, operations: [] }));
  }
  assert.equal((await engine.run({ mirrorPath })).success, true);
  fs.statSync = function (file, ...args) {
    if (String(file).startsWith(events)) historyStats++;
    return originalStat.call(this, file, ...args);
  };
  fs.readFileSync = function (file, ...args) {
    if (String(file).startsWith(events)) historyReads++;
    return originalRead.call(this, file, ...args);
  };
  const started = performance.now();
  assert.equal(engine.inspect({ mirrorPath }).pending, false);
  assert.equal((await engine.run({ mirrorPath })).data.fastCheck, true);
  assert.equal(historyStats, 0, 'History checks must not stat each Drive placeholder.');
  assert.equal(historyReads, 0, 'Already applied batches must not be read again.');
  console.log(`OK: 1600 historical batches checked in ${Math.round(performance.now() - started)} ms without per-file metadata or content reads.`);

  // A placeholder may be listed before its download finishes. It must be retried
  // after its contents become readable, even though its filename is unchanged.
  const pendingFile = path.join(events, 'new-arrival.json');
  fs.writeFileSync(pendingFile, '{');
  assert.equal(engine.inspect({ mirrorPath }).remoteChangesPending, true);
  await engine.run({ mirrorPath });
  assert.equal(engine.inspect({ mirrorPath }).remoteChangesPending, true);
  fs.writeFileSync(pendingFile, JSON.stringify({ format: 1, batchId: 'new-arrival', deviceId: 'remote', operations: [{
    table: 'notes', key: JSON.stringify([['id'], ['new']]), keyColumns: ['id'], keyValues: ['new'],
    action: 'upsert', row: { id: 'new', value: 'download complete' }, rowHash: 'new-hash', version: 1, deviceId: 'remote',
  }] }));
  assert.equal((await engine.run({ mirrorPath })).success, true);
  assert.equal(db.prepare('SELECT value FROM notes WHERE id = ?').get('new').value, 'download complete');
  assert.equal(engine.inspect({ mirrorPath }).remoteChangesPending, false);
  console.log('OK: incomplete downloads remain pending and apply when completed.');
} finally {
  fs.statSync = originalStat;
  fs.readFileSync = originalRead;
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
