import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { compactBatchReferences } from '../backend/syncBatchReferences.js';
import { createSyncReferenceIdentity } from '../backend/syncReferenceIdentity.js';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';
import { createSyncHistoryMaintenance, duplicateBatchDigest } from '../backend/syncHistoryMaintenance.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-sync-efficiency-'));
const databases = [], engines = [];
const read = async (file, fallback) => { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; } };
const write = async (file, data) => {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(data)); await fsp.rename(`${file}.tmp`, file);
};
const step = async (pc, mirror) => {
  const result = await pc.engine.run({ mirrorPath: mirror });
  await pc.engine.waitForMaintenance?.();
  assert.equal(result.success, true, result.message);
  return result;
};
const make = (name, create = createIncrementalMirrorSync, opts = {}) => {
  const db = new Database(':memory:'); databases.push(db);
  db.exec('CREATE TABLE notes(id TEXT PRIMARY KEY, value TEXT)');
  const runtimeFolder = path.join(root, name);
  const engine = create({ db, runtimeFolder, getDeviceId: () => name, ...opts }); engines.push(engine);
  return { db, engine, runtimeFolder };
};
try {
  // Preserve references required to resolve a student whose local ID and stored
  // token differ on the receiving PC. Include nested JSON and composite keys.
  const a = new Database(':memory:'), b = new Database(':memory:'); databases.push(a, b);
  for (const [db, id] of [[a, 1], [b, 22]]) {
    db.exec(`CREATE TABLE db_estudiantes(id INTEGER PRIMARY KEY,dni TEXT,estudiantes TEXT,grado TEXT,secc TEXT);
      INSERT INTO db_estudiantes VALUES(${id},'12345678','Prueba','2do','A');`);
  }
  const ia = createSyncReferenceIdentity(a), ib = createSyncReferenceIdentity(b);
  b.prepare("UPDATE armi_sync_identity_map SET portable_id='@student:older-identity'").run(); ib.refresh();
  const token = ia.catalog().students['1'].token;
  const catalog = { ...ia.catalog(), evidences: Object.fromEntries(Array.from({length: 4000}, (_, i) => [i, {token: `@evidence:unrelated-${i}`}])) };
  const operations = [{table:'notes',key:JSON.stringify([['id'], [`s::${token}::criterion`]]),
    row:{student_id:token,checkpoint_json:JSON.stringify({student_ids:[token]})}}];
  const trimmed = compactBatchReferences(catalog, operations);
  assert.ok(Buffer.byteLength(JSON.stringify(trimmed)) < Buffer.byteLength(JSON.stringify(catalog)) / 100);
  assert.deepEqual(ib.local('notes', operations[0].row, trimmed), ib.local('notes', operations[0].row, catalog));
  assert.equal(ib.local('notes', operations[0].row, trimmed).student_id, '22');
  assert.deepEqual(JSON.parse(ib.local('notes', operations[0].row, trimmed).checkpoint_json).student_ids, ['22']);
  const evidenceToken = '@evidence-path:2026/foto con espacios/imagen.jpg';
  const evidenceCatalog = {...catalog,evidences:{1:{token:evidenceToken},2:{token:'@evidence:unused'}}};
  assert.equal(Object.keys(compactBatchReferences(evidenceCatalog,[{row:{evidence_ids:JSON.stringify([evidenceToken]),version_group_id:`@version-group:${evidenceToken}`}}]).evidences).length,1);
  assert.deepEqual(compactBatchReferences(evidenceCatalog,[{row:{opaque:'unparsed text @evidence:custom'}}]).evidences,evidenceCatalog.evidences);

  const mirror = path.join(root, 'mirror'); fs.mkdirSync(mirror);
  const sender = make('sender'), receiver = make('receiver');
  sender.db.exec("INSERT INTO notes VALUES('work','original')");
  await step(sender, mirror);
  assert.equal(sender.engine.getState().delivery.peers.length, 0, 'A local copy must not manufacture peer confirmation');
  assert.equal(sender.engine.getState().delivery.cloud, 'unverified');
  await step(receiver, mirror); await step(sender, mirror);
  assert.equal(sender.engine.getState().delivery.peers.find(p => p.deviceId === 'receiver').confirmed, true);
  const receiptPath = path.join(mirror, '.armi-sync/incremental-v1/receipts/sender.json');
  const receiptBytes = fs.readFileSync(receiptPath, 'utf8');
  await step(sender, mirror);
  assert.equal(fs.readFileSync(receiptPath, 'utf8'), receiptBytes, 'Idle checks must not continuously republish receipts');

  // A peer is offline, makes an unpublished edit, then returns after a remote
  // edit. Neither local editing nor sending depends on that PC being reachable.
  receiver.db.exec("UPDATE notes SET value='offline edit' WHERE id='work'");
  sender.db.exec("UPDATE notes SET value='online edit' WHERE id='work'");
  await step(sender, mirror);
  assert.equal(sender.engine.getState().delivery.peers.find(p => p.deviceId === 'receiver').confirmed, false, 'An old receipt cannot confirm a new batch');
  await step(receiver, mirror); await step(sender, mirror); await step(receiver, mirror);
  assert.deepEqual(sender.db.prepare('SELECT * FROM notes').all(), receiver.db.prepare('SELECT * FROM notes').all());
  const eventRoot = path.join(mirror, '.armi-sync/incremental-v1/devices');
  const values = [];
  for (const device of fs.readdirSync(eventRoot)) for (const file of fs.readdirSync(path.join(eventRoot,device,'events'))) {
    const batch=JSON.parse(fs.readFileSync(path.join(eventRoot,device,'events',file),'utf8'));
    values.push(...batch.operations.map(op=>op.row?.value));
  }
  assert.ok(values.includes('offline edit') && values.includes('online edit'), 'Both published alternatives must remain recoverable in shared history');

  // The compact format remains readable by the previously installed engine.
  const baseline = path.resolve('recovery-candidates/sync-efficiency-2026-11-01/backend/incrementalMirrorSync.js');
  if (fs.existsSync(baseline)) {
    const source = fs.readFileSync(baseline,'utf8').replace(/from '(\.\/[^']+)'/g, (_, name) => `from '${pathToFileURL(path.resolve('backend',name)).href}'`);
    const old = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const oldPC = make('old-client', old.createIncrementalMirrorSync);
    await step(oldPC, mirror);
    assert.deepEqual(oldPC.db.prepare('SELECT * FROM notes').all(),sender.db.prepare('SELECT * FROM notes').all());
  }

  // Unknown schemas must remain pending, not be acknowledged and forgotten.
  const unsupportedMirror=path.join(root,'unsupported-mirror');fs.mkdirSync(unsupportedMirror);
  const future=make('future'), older=make('older');future.db.exec("CREATE TABLE future_table(id TEXT PRIMARY KEY,value TEXT); INSERT INTO future_table VALUES('x','preserve')");
  await step(future,unsupportedMirror);const pending=await step(older,unsupportedMirror);
  assert.ok(pending.data.pendingOperations > 0);
  older.db.exec('CREATE TABLE future_table(id TEXT PRIMARY KEY,value TEXT)');await step(older,unsupportedMirror);
  assert.equal(older.db.prepare('SELECT value FROM future_table').get().value,'preserve');
  future.db.exec("ALTER TABLE future_table ADD COLUMN extra TEXT; UPDATE future_table SET extra='new information'");
  await step(future,unsupportedMirror);const unknownField=await step(older,unsupportedMirror);
  assert.ok(unknownField.data.pendingOperations>0,'Unknown fields must not be silently dropped and acknowledged');
  older.db.exec('ALTER TABLE future_table ADD COLUMN extra TEXT');await step(older,unsupportedMirror);
  assert.equal(older.db.prepare('SELECT extra FROM future_table').get().extra,'new information');
  future.db.exec("ALTER TABLE future_table ADD COLUMN nullable_new TEXT; UPDATE future_table SET value='actual teacher edit'");
  older.db.exec('ALTER TABLE future_table ADD COLUMN nullable_new TEXT');
  await step(future,unsupportedMirror);await step(older,unsupportedMirror);
  assert.equal(older.db.prepare('SELECT value FROM future_table').get().value,'actual teacher edit','Schema rebasing must never suppress a real local edit');

  const setup = async (name, runtimeInside = false) => {
    const mirrorPath=path.join(root,name),deviceId='owner';
    const folder=path.join(mirrorPath,'.armi-sync/incremental-v1/devices',deviceId,'events');fs.mkdirSync(folder,{recursive:true});
    const first={format:2,identityRevision:4,deviceId,batchId:'1700000000000-00000001-owner-first',sequence:1,createdAt:'2023-11-14T00:00:00Z',references:{students:{}},
      operations:[{table:'notes',key:'work',keyColumns:['id'],keyValues:['work'],action:'upsert',row:{id:'work',value:'preserved'},rowHash:'original',version:1,deviceId}]};
    const duplicate={...first,batchId:'1700000000001-00000002-owner-repeat',sequence:2};
    const changed={...first,batchId:'1700000000002-00000003-owner-changed',sequence:3,operations:[{...first.operations[0],version:2,row:{id:'work',value:'different'}}]};
    for(const batch of [first,duplicate,changed])fs.writeFileSync(path.join(folder,batch.batchId+'.json'),JSON.stringify(batch));
    const runtimeFolder=runtimeInside ? path.join(mirrorPath,'local-runtime') : path.join(root,name+'-runtime');
    const maintenance=createSyncHistoryMaintenance({runtimeFolder,readJson:read,writeJson:write,options:{useWorker:false,scanLimit:20,retireLimit:20,minAgeMs:0,intervalMs:0}});
    const args={mirrorPath,eventFiles:[first,duplicate,changed].map(b=>path.join(folder,b.batchId+'.json')),applied:new Set([first.batchId,duplicate.batchId,changed.batchId]),eventSignature:'verified-inventory',deviceId};
    const receipt={deviceId:'peer',eventSignature:args.eventSignature,eventCount:3};
    return {maintenance,args,receipt,folder,runtimeFolder,first,duplicate,changed};
  };
  const fixture=await setup('maintenance');
  const repeat=path.join(fixture.folder,fixture.duplicate.batchId+'.json'), original=fs.readFileSync(repeat);
  await fixture.maintenance.tick({...fixture.args,peers:[]});assert.ok(fs.existsSync(repeat));
  await fixture.maintenance.tick({...fixture.args,peers:[{...fixture.receipt,eventCount:2}]});assert.ok(fs.existsSync(repeat));
  await fixture.maintenance.tick({...fixture.args,peers:[fixture.receipt]});
  assert.equal(fs.existsSync(repeat),false,fixture.maintenance.snapshot().message);
  assert.ok(fs.existsSync(path.join(fixture.folder,fixture.first.batchId+'.json')));
  assert.ok(fs.existsSync(path.join(fixture.folder,fixture.changed.batchId+'.json')),'A changed version is never a duplicate');
  const archive=fs.readdirSync(path.join(fixture.runtimeFolder,'history-archive')).find(name=>name.endsWith('.gz'));
  assert.deepEqual(gunzipSync(fs.readFileSync(path.join(fixture.runtimeFolder,'history-archive',archive))),original);
  assert.equal(fixture.maintenance.snapshot().cloudSpaceReclaimed,false,'Drive quota cannot be inferred from a filesystem removal');
  assert.equal(duplicateBatchDigest({...fixture.first,format:1}),null);
  assert.equal(duplicateBatchDigest({...fixture.first,operations:[{...fixture.first.operations[0],table:'armi_frontend_state',row:{key:'armi_holidays_v7'}}]}),null);
  const inside=await setup('unsafe-archive',true);await inside.maintenance.tick({...inside.args,peers:[inside.receipt]});
  assert.equal(fs.readdirSync(inside.folder).length,3,'Never retire without an archive outside the mirror');
  const cancel=await setup('cancelled');let activeCalls=0;
  await cancel.maintenance.tick({...cancel.args,peers:[cancel.receipt],canRetire:()=>++activeCalls===1});
  assert.equal(fs.readdirSync(cancel.folder).length,3,'A stopped/switching mirror cannot retire files');
  const corrupt=await setup('corrupt-archive');
  await corrupt.maintenance.tick({...corrupt.args,peers:[]});
  const crypto=await import('node:crypto');const raw=fs.readFileSync(path.join(corrupt.folder,corrupt.duplicate.batchId+'.json'));
  fs.writeFileSync(path.join(corrupt.runtimeFolder,'history-archive',corrupt.duplicate.batchId+'-'+crypto.createHash('sha256').update(raw).digest('hex')+'.json.gz'),'broken');
  await corrupt.maintenance.tick({...corrupt.args,peers:[corrupt.receipt]});
  assert.equal(fs.readdirSync(corrupt.folder).length,3,'A corrupt safety archive must block retirement');
  const isolated=await setup('isolated-worker');
  const offline=make('offline-before-maintenance');await step(offline,isolated.args.mirrorPath);
  offline.db.exec("UPDATE notes SET value='unsent offline work' WHERE id='work'");
  const worker=createSyncHistoryMaintenance({runtimeFolder:isolated.runtimeFolder,options:{scanLimit:20,retireLimit:20,minAgeMs:0,intervalMs:0,workerTimeoutMs:10000}});
  await worker.tick({...isolated.args,peers:[isolated.receipt]});
  assert.equal(fs.existsSync(path.join(isolated.folder,isolated.duplicate.batchId+'.json')),false,worker.snapshot().message);
  assert.equal(worker.snapshot().retiredFiles,1);
  const interrupted=await setup('worker-timeout');
  const shortWorker=createSyncHistoryMaintenance({runtimeFolder:interrupted.runtimeFolder,options:{minAgeMs:0,intervalMs:0,workerTimeoutMs:1}});
  await shortWorker.tick({...interrupted.args,peers:[interrupted.receipt]});
  assert.equal(shortWorker.snapshot().state,'deferred','A timed-out process reports deferred maintenance');
  assert.equal(fs.readdirSync(interrupted.folder).length,3,'Interrupting maintenance must preserve the shared history');
  const fresh=make('fresh-after-maintenance');await step(fresh,isolated.args.mirrorPath);
  assert.equal(fresh.db.prepare('SELECT value FROM notes').get().value,'different','A new PC still recovers the latest unique version');
  await step(offline,isolated.args.mirrorPath);await step(fresh,isolated.args.mirrorPath);
  assert.equal(fresh.db.prepare('SELECT value FROM notes').get().value,'unsent offline work','A returning PC preserves edits made while disconnected');
  const integratedMirror=path.join(root,'integrated-maintenance');fs.mkdirSync(integratedMirror);
  const auto=make('auto-owner',createIncrementalMirrorSync,{maintenanceOptions:{minAgeMs:0,intervalMs:0,scanLimit:20}}), peer=make('auto-peer');
  auto.db.exec("INSERT INTO notes VALUES('automatic','real work')");await step(auto,integratedMirror);
  const autoEvents=path.join(integratedMirror,'.armi-sync/incremental-v1/devices/auto-owner/events');
  const batch=JSON.parse(fs.readFileSync(path.join(autoEvents,fs.readdirSync(autoEvents)[0]),'utf8'));
  const repeatBatch={...batch,batchId:`${Date.now()+1}-00000002-auto-owner-repeat`,sequence:2};
  fs.writeFileSync(path.join(autoEvents,repeatBatch.batchId+'.json'),JSON.stringify(repeatBatch));
  await step(auto,integratedMirror);assert.ok(fs.existsSync(path.join(autoEvents,repeatBatch.batchId+'.json')),'No receipt yet: no automatic retirement');
  await step(peer,integratedMirror);await step(auto,integratedMirror);
  assert.equal(fs.existsSync(path.join(autoEvents,repeatBatch.batchId+'.json')),false,auto.engine.getState().maintenance.message);
  assert.equal(peer.db.prepare('SELECT value FROM notes').get().value,'real work');
  console.log('OK: compact references, actual receipts, offline/concurrent edits, old-client reception, unknown-schema protection and guarded automatic duplicate maintenance.');
} finally {
  await Promise.all(engines.map(engine=>engine.waitForMaintenance?.()));
  databases.forEach(db=>db.close());
  if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('armi-sync-efficiency-'))throw Error('Unexpected fixture cleanup path');
  fs.rmSync(root,{recursive:true,force:true});
}
