import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(fs.readFileSync('utils/backgroundSyncStatus.ts','utf8'), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
}).outputText;
const {describeSyncDelivery}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const status={config:{mode:'drive_mirror'},hasUnsyncedChanges:false,incrementalSync:{delivery:{
  scope:'database-changes',cloud:'unverified',lastPublication:{batchId:'latest',sha256:'hash',createdAt:'2026-11-01T00:00:00Z'},
  peers:[{deviceId:'pc2',label:'PC 2',confirmed:true,confirmedAt:'2026-11-01T00:01:00Z'}],
}}};
let rows=describeSyncDelivery(status);
assert.equal(rows.find(row=>row.label==='Recepción en otras PC').confirmed,true);
assert.equal(rows.find(row=>row.label==='Servidores de Google Drive').confirmed,false,'Peer receipt is not a direct Google server/API check');
assert.match(rows.find(row=>row.label==='Recepción en otras PC').detail,/adjuntos se comprueban por separado/);
rows=describeSyncDelivery({...status,hasUnsyncedChanges:true});
assert.equal(rows.find(row=>row.label==='Recepción en otras PC').confirmed,false,'An older receipt must not claim unsent work is already received');
assert.equal(rows.find(row=>row.label==='Carpeta de Drive').confirmed,false);
rows=describeSyncDelivery({...status,hasUnsyncedChanges:undefined,comparison:'incremental-pending'});
assert.equal(rows.find(row=>row.label==='Recepción en otras PC').confirmed,false,'The full-status view must also mask old confirmations while work is pending');
rows=describeSyncDelivery({config:status.config});
assert.equal(rows.find(row=>row.label==='Recepción en otras PC').confirmed,false);
assert.match(rows.find(row=>row.label==='Recepción en otras PC').value,/Todavía no hay comprobantes/);
const mixed=structuredClone(status);mixed.incrementalSync.delivery.peers.push({deviceId:'pc3',confirmed:false,confirmedAt:'2026-10-01T00:00:00Z'});
rows=describeSyncDelivery(mixed);
assert.equal(rows.find(row=>row.label==='Recepción en otras PC').confirmed,false);
assert.match(rows.find(row=>row.label==='Recepción en otras PC').value,/1 de 2/);
console.log('OK: local preparation, direct-cloud uncertainty, actual peer receipts and unsent changes are distinguished without claiming attachment delivery.');
