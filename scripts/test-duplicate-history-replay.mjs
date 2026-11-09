import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-duplicate-replay-'));
const databases = [];
try {
  const make = (name) => {
    const db = new Database(':memory:');
    databases.push(db);
    db.exec('CREATE TABLE notes(id TEXT PRIMARY KEY, value TEXT)');
    const runtimeFolder = path.join(root, name);
    return { db, runtimeFolder, engine: createIncrementalMirrorSync({ db, runtimeFolder, excludedTables: [], getDeviceId: () => name }) };
  };
  const full = path.join(root, 'full');
  const compact = path.join(root, 'compact');
  fs.mkdirSync(full);
  const sender = make('sender');
  sender.db.exec("INSERT INTO notes VALUES('one', 'preserved A')");
  assert.equal((await sender.engine.run({ mirrorPath: full })).success, true);
  const events = path.join(full, '.armi-sync/incremental-v1/devices/sender/events');
  const firstFile = fs.readdirSync(events)[0];
  const first = JSON.parse(fs.readFileSync(path.join(events, firstFile), 'utf8'));
  const duplicate = { ...first, batchId: `${Date.now() + 1}-00000002-sender-repeated`, sequence: 2, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(events, `${duplicate.batchId}.json`), JSON.stringify(duplicate));
  sender.db.exec("UPDATE notes SET value='preserved B' WHERE id='one'; INSERT INTO notes VALUES('two', 'independent work')");
  assert.equal((await sender.engine.run({ mirrorPath: full })).success, true);
  fs.cpSync(full, compact, { recursive: true });
  fs.unlinkSync(path.join(compact, '.armi-sync/incremental-v1/devices/sender/events', `${duplicate.batchId}.json`));
  const before = make('receiver-full');
  const after = make('receiver-compact');
  for (const [pc, mirror] of [[before, full], [after, compact]]) {
    const result = await pc.engine.run({ mirrorPath: mirror });
    assert.equal(result.success, true, result.message);
    assert.equal(result.data.pendingOperations, 0);
  }
  assert.deepEqual(before.db.prepare('SELECT * FROM notes ORDER BY id').all(), after.db.prepare('SELECT * FROM notes ORDER BY id').all());
  const states = [before, after].map(pc => JSON.parse(fs.readFileSync(path.join(pc.runtimeFolder, 'incremental-identity-state.json'), 'utf8')));
  assert.deepEqual(states[0].versions, states[1].versions);
  assert.deepEqual(after.db.prepare('SELECT * FROM notes ORDER BY id').all(), [{ id: 'one', value: 'preserved B' }, { id: 'two', value: 'independent work' }]);
  console.log('OK: exact repeated batch removal preserves fresh-PC rows and version clocks.');
} finally {
  databases.forEach(db => db.close());
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('armi-duplicate-replay-')) throw new Error('Unexpected test cleanup path');
  fs.rmSync(root, { recursive: true, force: true });
}
