// Publish a verified private migration payload, never a database replacement.
// All checks precede the first write. The manifest is written last.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {identityDigest,identityFingerprints,atomicIdentityJson,IDENTITY_MIGRATION_MARKER} from '../backend/identityMigration.js';

const args=Object.fromEntries(process.argv.slice(2).reduce((result,value,index,array)=>index%2===0?[...result,[value.slice(2),array[index+1]]]:result,[]));
for(const key of ['prepared','mirror','source','snapshot','simulation']) assert.ok(args[key],`Falta --${key}`);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const payload=read(path.join(args.prepared,'payload.json'));
const marker=read(path.join(args.prepared,'marker.json'));
assert.equal(identityDigest(payload),marker.payloadSha256,'El paquete no coincide con el manifiesto');
assert.equal(payload.id,marker.id);
const validation=read(path.join(args.simulation,'results.json'));
assert.equal(identityDigest(read(path.join(validation.root,'mirror',marker.payloadPath))),marker.payloadSha256,
  'La prueba debe corresponder exactamente al paquete preparado');
assert.ok(validation.results.length>=6,'Se requieren primera apertura y dos reaperturas de cada PC');
for(const result of validation.results) {
  assert.equal(result.result.success,true);
  assert.equal(result.thirdBimesterMatches,true,'Los consolidados cambiaron');
  assert.equal(result.result.data.identityPending,0);
  assert.equal(result.result.data.conflicts,0);
}
for(const pc of ['pc1','pc2']) {
  const last=validation.results.filter(result=>result.pc===pc).at(-1);
  assert.equal(last.result.data.pendingOperations,0);
  assert.equal(last.result.data.publishedOperations,0,'La prueba debe terminar sin publicaciones repetidas');
}
const policy=payload.devices[payload.authorityDevice];
const db=new Database(path.resolve(args.source),{readonly:true,fileMustExist:true});
try {
  assert.equal(identityDigest(identityFingerprints(db,Object.keys(policy.fingerprints))),identityDigest(policy.fingerprints),
    'La base real cambió desde el respaldo inspeccionado');
} finally {db.close();}
const covered=new Set(payload.coveredBatches);
const eventRoot=path.join(args.mirror,'.armi-sync','incremental-v1','devices');
for(const device of fs.readdirSync(eventRoot)) {
  const folder=path.join(eventRoot,device,'events');if(!fs.existsSync(folder))continue;
  for(const file of fs.readdirSync(folder).filter(file=>file.endsWith('.json'))) {
    assert.ok(covered.has(path.parse(file).name),'Llegó un paquete nuevo que aún no está conciliado: '+file);
  }
}
const manifest=read(path.join(args.snapshot,'eventos-resguardados.json'));
for(const file of manifest.files) {
  const actual=fs.readFileSync(path.join(eventRoot,file.device,'events',file.name));
  assert.equal(crypto.createHash('sha256').update(actual).digest('hex'),file.sha256,'Cambió un paquete resguardado');
}
assert.equal(marker.payloadPath,`.armi-sync/identity-migrations/${payload.id}/payload.json`);
const target=path.join(args.mirror,marker.payloadPath);
const pointer=path.join(args.mirror,IDENTITY_MIGRATION_MARKER);
if(fs.existsSync(target)) assert.equal(identityDigest(read(target)),marker.payloadSha256,'No se reemplaza una migración diferente con el mismo ID');
if(fs.existsSync(pointer)) assert.equal(identityDigest(read(pointer)),identityDigest(marker),'Ya existe otro manifiesto');
await atomicIdentityJson(target,payload);
assert.equal(identityDigest(read(target)),marker.payloadSha256);
await atomicIdentityJson(pointer,marker);
assert.equal(identityDigest(read(pointer)),identityDigest(marker));
const report={migrationId:payload.id,payloadSha256:marker.payloadSha256,activatedAt:new Date().toISOString(),
  verifiedInputBatches:manifest.files.length,sourceDatabaseUnchanged:true,simulation:args.simulation,payloadPath:target,markerPath:pointer};
await atomicIdentityJson(path.join(args.prepared,'activation.json'),report);
console.log(JSON.stringify(report,null,2));
