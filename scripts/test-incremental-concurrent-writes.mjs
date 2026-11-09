import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-concurrent-sync-'));
const mirror = path.join(root, 'mirror');
fs.mkdirSync(mirror);
const databases = [];
const make = (name) => {
  const db = new Database(':memory:'); databases.push(db);
  db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, value TEXT)');
  const pc = { db };
  const engine = createIncrementalMirrorSync({ db, runtimeFolder: path.join(root, name), excludedTables: [], getDeviceId: () => name,
    getSourceSignature: () => {
      const signature=JSON.stringify(db.prepare('SELECT * FROM notes ORDER BY id').all());
      const hook=pc.afterSourceRead;delete pc.afterSourceRead;hook?.();return signature;
    } });
  return Object.assign(pc,{engine});
};
const makeEvidence = (name) => {
  const db = new Database(':memory:'); databases.push(db);
  db.exec('CREATE TABLE evaluacion_evidencias (id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_key TEXT UNIQUE, relative_path TEXT, observation TEXT)');
  const engine = createIncrementalMirrorSync({
    db,
    runtimeFolder: path.join(root, `evidence-${name}`),
    excludedTables: [],
    getDeviceId: () => name,
    getSourceSignature: () => JSON.stringify(db.prepare('SELECT evidence_key, relative_path, observation FROM evaluacion_evidencias ORDER BY evidence_key').all()),
  });
  return { db, engine };
};
try {
  const a = make('a');
  a.db.prepare('INSERT INTO notes VALUES (?, ?)').run('local', 'first');
  // captureDatabase has read the row and yielded; this edit must stay pending.
  a.afterSourceRead=()=>queueMicrotask(() => a.db.prepare('UPDATE notes SET value = ? WHERE id = ?').run('latest', 'local'));
  const pending = a.engine.run({ mirrorPath: mirror });
  assert.equal((await pending).success, true);
  assert.equal(a.engine.inspect({ mirrorPath: mirror }).localChangesPending, true);
  await a.engine.run({ mirrorPath: mirror });
  const b = make('b');
  await b.engine.run({ mirrorPath: mirror });
  assert.equal(b.db.prepare('SELECT value FROM notes WHERE id = ?').get('local').value, 'latest');

  const otherMirror = path.join(root, 'remote-arrival'); fs.mkdirSync(otherMirror);
  const remote = make('remote');
  remote.db.prepare('INSERT INTO notes VALUES (?, ?)').run('remote-note', 'arrived during capture');
  await remote.engine.run({ mirrorPath: otherMirror });
  const events = path.join(otherMirror, '.armi-sync', 'incremental-v1', 'devices', 'remote', 'events');
  const file = path.join(events, fs.readdirSync(events)[0]);
  const content = fs.readFileSync(file); fs.unlinkSync(file);
  const local = make('local');
  local.afterSourceRead=()=>queueMicrotask(() => fs.writeFileSync(file, content));
  const firstPass = local.engine.run({ mirrorPath: otherMirror });
  await firstPass;
  assert.equal(local.engine.inspect({ mirrorPath: otherMirror }).remoteChangesPending, true);
  await local.engine.run({ mirrorPath: otherMirror });
  assert.equal(local.db.prepare('SELECT value FROM notes WHERE id = ?').get('remote-note').value, 'arrived during capture');

  const evidenceMirror = path.join(root, 'evidence-mirror'); fs.mkdirSync(evidenceMirror);
  const evidenceA = makeEvidence('evidence-a');
  const evidenceB = makeEvidence('evidence-b');
  evidenceA.db.prepare('INSERT INTO evaluacion_evidencias (evidence_key, relative_path, observation) VALUES (?, ?, ?)')
    .run('evidence-from-a', 'a/trabajo.pdf', 'PC A');
  evidenceB.db.prepare('INSERT INTO evaluacion_evidencias (evidence_key, relative_path, observation) VALUES (?, ?, ?)')
    .run('evidence-from-b', 'b/trabajo.pdf', 'PC B');
  await Promise.all([
    evidenceA.engine.run({ mirrorPath: evidenceMirror }),
    evidenceB.engine.run({ mirrorPath: evidenceMirror }),
  ]);
  await evidenceA.engine.run({ mirrorPath: evidenceMirror });
  await evidenceB.engine.run({ mirrorPath: evidenceMirror });
  assert.equal(evidenceA.db.prepare('SELECT COUNT(*) AS total FROM evaluacion_evidencias').get().total, 2);
  assert.equal(evidenceB.db.prepare('SELECT COUNT(*) AS total FROM evaluacion_evidencias').get().total, 2);

  evidenceA.db.prepare('DELETE FROM evaluacion_evidencias WHERE evidence_key = ?').run('evidence-from-b');
  await evidenceA.engine.run({ mirrorPath: evidenceMirror });
  await evidenceB.engine.run({ mirrorPath: evidenceMirror });
  assert.ok(evidenceB.db.prepare('SELECT 1 FROM evaluacion_evidencias WHERE evidence_key = ?').get('evidence-from-b'));
  const delayedMirror = path.join(root, 'delayed-provider'); fs.mkdirSync(delayedMirror);
  const editing = make('editing'), sender = make('sender');
  editing.db.prepare('INSERT INTO notes VALUES (?, ?)').run('shared', 'original');
  await editing.engine.run({ mirrorPath: delayedMirror });
  await sender.engine.run({ mirrorPath: delayedMirror });
  sender.db.prepare('UPDATE notes SET value = ? WHERE id = ?').run('remote-edit', 'shared');
  sender.db.prepare('INSERT INTO notes VALUES (?, ?)').run('remote-new', 'received');
  await sender.engine.run({ mirrorPath: delayedMirror });
  const originalRead = fs.promises.readFile;
  let injected = false;
  fs.promises.readFile = async function (file, ...args) {
    if (!injected && String(file).includes(`${path.sep}sender${path.sep}events${path.sep}`)) {
      injected = true;
      // Simulate editing while a provider takes time to download row events.
      editing.db.prepare('UPDATE notes SET value = ? WHERE id = ?').run('local-edit-during-read', 'shared');
      editing.db.prepare('INSERT INTO notes VALUES (?, ?)').run('local-new', 'not-acknowledged-early');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return originalRead.call(this, file, ...args);
  };
  try { await editing.engine.run({ mirrorPath: delayedMirror }); }
  finally { fs.promises.readFile = originalRead; }
  assert.equal(injected, true);
  assert.equal(editing.db.prepare('SELECT value FROM notes WHERE id = ?').get('shared').value, 'local-edit-during-read');
  await editing.engine.run({ mirrorPath: delayedMirror });
  await sender.engine.run({ mirrorPath: delayedMirror });
  assert.equal(sender.db.prepare('SELECT value FROM notes WHERE id = ?').get('shared').value, 'local-edit-during-read');
  assert.equal(sender.db.prepare('SELECT value FROM notes WHERE id = ?').get('local-new').value, 'not-acknowledged-early');
  const preferenceMirror=path.join(root,'preferences');fs.mkdirSync(preferenceMirror);
  const preferences=['preference-a','preference-b'].map(name=>{
    const db=new Database(':memory:');databases.push(db);
    db.exec('CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
    db.prepare('INSERT INTO armi_frontend_state VALUES(?,?,?)').run('armi_register_unit_view_selection',name,'2026-10-19');
    // Actual academic frontend content must still raise a reviewable conflict.
    db.prepare('INSERT INTO armi_frontend_state VALUES(?,?,?)').run('teacher_planning',name,'2026-10-19');
    return {db,engine:createIncrementalMirrorSync({db,runtimeFolder:path.join(root,name),excludedTables:[],getDeviceId:()=>name})};
  });
  await Promise.all(preferences.map(pc=>pc.engine.run({mirrorPath:preferenceMirror})));
  for(const pc of preferences) await pc.engine.run({mirrorPath:preferenceMirror});
  for(const pc of preferences) {
    assert.equal(pc.db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_register_unit_view_selection'").get().value,'preference-b');
    const state=JSON.parse(fs.readFileSync(path.join(root,pc===preferences[0]?'preference-a':'preference-b','incremental-identity-state.json')));
    assert.ok(state.conflicts.some(conflict=>conflict.entity.includes('teacher_planning')));
    assert.ok(!state.conflicts.some(conflict=>conflict.entity.includes('armi_register_unit_view_selection')));
  }
  const approachMirror=path.join(root,'approaches');fs.mkdirSync(approachMirror);
  const approaches=['approach-a','approach-b'].map(name=>{
    const db=new Database(':memory:');databases.push(db);
    db.exec('CREATE TABLE db_enfoques(id INTEGER PRIMARY KEY,enfoque TEXT,valores TEXT,actitudes TEXT,se_demuestra_cuando TEXT)');
    db.prepare('INSERT INTO db_enfoques VALUES(?,?,?,?,?)').run(1,'DERECHOS','Conciencia','Conocer derechos','Explica sus derechos');
    db.prepare('INSERT INTO db_enfoques VALUES(?,?,?,?,?)').run(2,'DERECHOS','Conciencia','Conocer derechos','Aplica sus derechos');
    return {db,engine:createIncrementalMirrorSync({db,runtimeFolder:path.join(root,name),excludedTables:[],getDeviceId:()=>name})};
  });
  await approaches[0].engine.run({mirrorPath:approachMirror});
  // Reproduce a packet emitted by an older v2 client: its incomplete key
  // must not collapse the two different descriptions under DERECHOS.
  const oldEvents=path.join(approachMirror,'.armi-sync/incremental-v1/devices/approach-a/events');
  for(const file of fs.readdirSync(oldEvents).filter(file=>file.endsWith('.json'))) {
    const target=path.join(oldEvents,file),batch=JSON.parse(fs.readFileSync(target));
    for(const op of batch.operations.filter(op=>op.table==='db_enfoques')) {
      op.keyColumns=['enfoque'];op.keyValues=[op.row.enfoque];
      op.key=JSON.stringify([op.keyColumns,op.keyValues]);
    }
    fs.writeFileSync(target,JSON.stringify(batch));
  }
  await approaches[1].engine.run({mirrorPath:approachMirror});
  for(let round=0;round<3;round++) for(const pc of approaches) {
    const result=await pc.engine.run({mirrorPath:approachMirror});
    assert.equal(result.data.publishedOperations,0,'Different values within one approach must not overwrite or republish one another');
    assert.equal(pc.db.prepare('SELECT COUNT(*) n FROM db_enfoques').get().n,2);
    assert.deepEqual(pc.db.prepare('SELECT se_demuestra_cuando FROM db_enfoques ORDER BY se_demuestra_cuando').all().map(row=>row.se_demuestra_cuando),['Aplica sus derechos','Explica sus derechos']);
  }
  console.log('OK: writes and remote batches arriving during capture are not acknowledged early and reach the other PC.');
} finally {
  databases.forEach((db) => db.close());
  fs.rmSync(root, { recursive: true, force: true });
}
