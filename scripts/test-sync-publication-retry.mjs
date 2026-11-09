import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-publication-retry-'));
const databases = [];
const make = (name, mirror) => {
  const db = new Database(':memory:'); databases.push(db);
  db.exec('CREATE TABLE notes(id TEXT PRIMARY KEY, value TEXT)');
  const runtimeFolder = path.join(root, name);
  const create = () => createIncrementalMirrorSync({ db, runtimeFolder, excludedTables: [], getDeviceId: () => name });
  return { db, runtimeFolder, create, engine: create(),
    events: () => fs.readdirSync(path.join(mirror, '.armi-sync', 'incremental-v1', 'devices', name, 'events')).filter(f => f.endsWith('.json')) };
};
const rename = fs.promises.rename;
try {
  const mirror = path.join(root, 'mirror'); fs.mkdirSync(mirror);
  const sender = make('sender', mirror), receiver = make('receiver', mirror);
  sender.db.exec("INSERT INTO notes VALUES('remote','remote work')");
  assert.equal((await sender.engine.run({ mirrorPath: mirror })).success, true);
  receiver.db.exec(`INSERT INTO notes VALUES('local','local work');
    CREATE TRIGGER reject_remote BEFORE INSERT ON notes WHEN NEW.id='remote'
    BEGIN SELECT RAISE(ABORT, 'simulated receiving failure'); END;`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await receiver.engine.run({ mirrorPath: mirror });
    assert.equal(result.success, false);
    assert.match(result.message, /simulated receiving failure/);
    assert.equal(receiver.events().length, 1, 'Failed receives must not republish local work');
    receiver.engine = receiver.create(); // Restarting must retain the acknowledgement.
  }
  assert.match(fs.readFileSync(path.join(receiver.runtimeFolder, 'incremental-last-error.json'), 'utf8'), /simulated receiving failure/);
  receiver.db.exec("DROP TRIGGER reject_remote; UPDATE notes SET value='new local edit' WHERE id='local'");
  assert.equal((await receiver.engine.run({ mirrorPath: mirror })).success, true);
  assert.equal(receiver.events().length, 2, 'A real later edit still publishes');
  assert.equal(receiver.db.prepare("SELECT value FROM notes WHERE id='remote'").get().value, 'remote work');
  assert.equal((await sender.engine.run({ mirrorPath: mirror })).success, true);
  assert.equal(sender.db.prepare("SELECT value FROM notes WHERE id='local'").get().value, 'new local edit');

  for (const failure of ['checkpoint', 'drive']) {
    const isolated = path.join(root, failure); fs.mkdirSync(isolated);
    const pc = make(`retry-${failure}`, isolated);
    pc.db.exec("INSERT INTO notes VALUES('saved','preserved')");
    fs.promises.rename = async function (from, to) {
      if ((failure === 'checkpoint' && to === path.join(pc.runtimeFolder, 'incremental-identity-state.json'))
        || (failure === 'drive' && String(to).includes(`${path.sep}events${path.sep}`))) {
        throw Object.assign(new Error(`simulated ${failure} write failure`), { code: 'EACCES' });
      }
      return rename.call(this, from, to);
    };
    assert.equal((await pc.engine.run({ mirrorPath: isolated })).success, false);
    const journalPath = path.join(pc.runtimeFolder, 'incremental-pending-publication.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    fs.promises.rename = rename;
    pc.engine = pc.create();
    assert.equal((await pc.engine.run({ mirrorPath: isolated })).success, true);
    assert.deepEqual(pc.events(), [`${journal.batch.batchId}.json`], 'Retry must use the original immutable batch ID');
    assert.equal(fs.existsSync(journalPath), false);
    const peer = make(`peer-${failure}`, isolated);
    assert.equal((await peer.engine.run({ mirrorPath: isolated })).success, true);
    assert.equal(peer.db.prepare("SELECT value FROM notes WHERE id='saved'").get().value, 'preserved');
  }
  const identityMirror = path.join(root, 'identity-mirror'); fs.mkdirSync(identityMirror);
  const origin = make('identity-origin', identityMirror), guarded = make('identity-guarded', identityMirror);
  for (const pc of [origin, guarded]) pc.db.exec(`
    CREATE TABLE db_estudiantes(id INTEGER PRIMARY KEY, dni TEXT, estudiantes TEXT, grado TEXT, secc TEXT);
    INSERT INTO db_estudiantes VALUES(1,'12345678','Estudiante de prueba','2do','A');
    CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);`);
  origin.db.prepare('INSERT INTO armi_frontend_state VALUES(?,?,?)').run('armi_hybrid_numeric_scores_v1', JSON.stringify({'session::1::criterion': 18}), '2026-10-26');
  const unresolved = JSON.stringify({'session::108::criterion': 12});
  guarded.db.prepare('INSERT INTO armi_frontend_state VALUES(?,?,?)').run('armi_hybrid_numeric_scores_v1', unresolved, '2026-10-25');
  origin.db.exec("INSERT INTO notes VALUES('received','unrelated work')");
  assert.equal((await origin.engine.run({ mirrorPath: identityMirror })).success, true);
  const guardedResult = await guarded.engine.run({ mirrorPath: identityMirror });
  assert.equal(guardedResult.success, true, 'An unresolved local cache must not abort reception');
  assert.equal(guarded.db.prepare("SELECT value FROM notes WHERE id='received'").get().value, 'unrelated work');
  assert.equal(guarded.db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_hybrid_numeric_scores_v1'").get().value, unresolved, 'Keep the unverified cache intact');
  const protectedRows = JSON.parse(fs.readFileSync(path.join(guarded.runtimeFolder, 'sync-identity-pending.json'), 'utf8'));
  assert.ok(protectedRows.incoming.some(row => row.source === 'local-current-row' && /108/.test(row.reason)));
  const sent = guarded.events().length;
  assert.equal((await guarded.engine.run({ mirrorPath: identityMirror })).success, true);
  assert.equal(guarded.events().length, sent, 'A protected cache must not cause repeated sends');
  console.log('OK: receiving failures, restarts and failed writes do not duplicate sends; unresolved local identities remain protected while unrelated changes arrive.');
} finally {
  fs.promises.rename = rename;
  databases.forEach(db => db.close());
  fs.rmSync(root, { recursive: true, force: true });
}
