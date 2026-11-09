import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import Database from 'better-sqlite3';
import {identityDigest,identityFingerprints,identitySemanticFingerprints,atomicIdentityJson,IDENTITY_MIGRATION_MARKER} from '../backend/identityMigration.js';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,array)=>index%2===0?[...pairs,[value.slice(2),array[index+1]]]:pairs,[]));
for(const key of ['prepared','mirror','source','validation'])assert.ok(args[key],`Falta --${key}`);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const marker=read(path.join(args.prepared,'marker.json')),ref=marker.authorityUpdate;
assert.ok(ref&&ref.path===`.armi-sync/identity-migrations/${marker.id}/${path.basename(ref.path)}`);
const update=read(path.join(args.prepared,path.basename(ref.path))),validation=read(path.join(args.validation,'results.json'));
assert.equal(identityDigest(update),ref.sha256);assert.equal(validation.authorityUpdateSha256,ref.sha256);
assert.ok(validation.results.length>=6);
// Bounded Drive reads may need a retry. The peer is expected to retain its old
// values until it receives the authority publication; both final states must agree.
for(const pc of ['pc1','pc2']){const result=validation.results.filter(row=>row.pc===pc).at(-1);
 assert.equal(result.result.success,true);assert.equal(result.thirdBimesterMatches,true);
 assert.equal(result.result.data.identityPending,0);assert.equal(result.result.data.conflicts,0);
 assert.equal(result.result.data.pendingOperations,0);assert.equal(result.result.data.publishedOperations,0);}
const firstApplied=validation.results.findIndex(row=>row.pc==='pc1'&&row.result.data.identityMigrationApplied);
assert.ok(firstApplied>=0,'La prueba debe aplicar realmente la reparación');
for(const row of validation.results.slice(firstApplied).filter(row=>row.pc==='pc1'))assert.equal(row.thirdBimesterMatches,true);
const preservation=read(path.join(args.validation,'data-preservation.json'));
for(const pc of ['pc1','pc2']){const check=preservation.checks.find(row=>row.pc===pc);
 assert.equal(check.recentGradesPreserved,9);assert.equal(check.conclusionTextsPreserved,1332);
 assert.equal(check.evidenceRecordsPreserved,update.snapshot.tables.evaluacion_evidencias.length);}
const installed=new Database(args.source,{readonly:true,fileMustExist:true});
try{const tables=Object.keys(update.policy.fingerprints);
 assert.ok(identityDigest(identityFingerprints(installed,tables))===identityDigest(update.policy.fingerprints)
   ||identityDigest(identitySemanticFingerprints(installed,tables))===identityDigest(update.policy.semanticFingerprints),'Hay cambios nuevos sin conciliar; no se activa una copia antigua');
}finally{installed.close();}
const pointer=path.join(args.mirror,IDENTITY_MIGRATION_MARKER),previous=read(pointer);
assert.equal(previous.id,marker.id);assert.equal(previous.payloadSha256,marker.payloadSha256);
assert.ok(!previous.authorityUpdate||previous.authorityUpdate.sha256===ref.sha256,'Existe otra revisión que no debe sobrescribirse');
const payload=read(path.join(args.mirror,marker.payloadPath));assert.equal(identityDigest(payload),marker.payloadSha256);
const covered=new Set([...payload.coveredBatches,...update.observedBatches.map(row=>path.parse(row.file).name)]);
const root=path.join(args.mirror,'.armi-sync/incremental-v1/devices');
for(const device of fs.readdirSync(root)){const folder=path.join(root,device,'events');if(!fs.existsSync(folder))continue;
 for(const file of fs.readdirSync(folder).filter(file=>file.endsWith('.json')))assert.ok(covered.has(path.parse(file).name),'Hay un paquete nuevo sin revisar: '+file);}
for(const batch of update.observedBatches)assert.equal(identityDigest(read(path.join(root,batch.device,'events',batch.file))),batch.sha256);
const backup=path.join(args.prepared,'marker-before-activation.json');if(!fs.existsSync(backup))fs.copyFileSync(pointer,backup);
const target=path.join(args.mirror,ref.path);if(fs.existsSync(target))assert.equal(identityDigest(read(target)),ref.sha256);
await atomicIdentityJson(target,update);assert.equal(identityDigest(read(target)),ref.sha256);
await atomicIdentityJson(pointer,marker);assert.equal(identityDigest(read(pointer)),identityDigest(marker));
const report={migrationId:marker.id,authorityUpdateSha256:ref.sha256,activatedAt:new Date().toISOString(),validation:args.validation,
  sourceDatabaseUnchanged:true,payloadPath:target,requiresVersion:'11.4.10',summary:update.summary};
await atomicIdentityJson(path.join(args.prepared,'activation.json'),report);
console.log(JSON.stringify({activated:true,migrationId:marker.id,authorityUpdateSha256:ref.sha256,sourceDatabaseUnchanged:true,requiresVersion:'11.4.10'},null,2));
