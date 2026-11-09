import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {exportPortableIdentitySnapshot,hashPortableIdentityRow} from '../backend/incrementalMirrorSync.js';
import {identityDigest,identityFingerprints,identitySemanticFingerprints,IDENTITY_PARENT_TABLES,IDENTITY_REPLACED_TABLES} from '../backend/identityMigration.js';

export function attachObservedAuthorityVersions({output,mirror}) {
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 const marker=read(path.join(output,'marker.json'));
 const oldFile=path.basename(marker.authorityUpdate.path),update=read(path.join(output,oldFile));
 const original=read(path.join(mirror,marker.payloadPath)),covered=new Set(original.coveredBatches);
 const root=path.join(mirror,'.armi-sync','incremental-v1','devices');
 const observedVersions={},batches=[];
 for(const device of fs.readdirSync(root)) {
  const folder=path.join(root,device,'events');if(!fs.existsSync(folder))continue;
  for(const file of fs.readdirSync(folder).filter(file=>file.endsWith('.json')&&!covered.has(path.parse(file).name))) {
   const bytes=fs.readFileSync(path.join(folder,file)),batch=JSON.parse(bytes.toString('utf8'));
   assert.equal(batch.format,2,'Hay un paquete nuevo antiguo que requiere conciliación antes de continuar');
   const saved=path.join(output,'peer-events',device,file);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.writeFileSync(saved,bytes);
   batches.push({device,file,sha256:identityDigest(batch)});
   for(const raw of batch.operations) {
    const op={...raw};
    if(op.table==='db_enfoques'&&op.row&&op.action==='upsert'){
     op.keyColumns=['enfoque','valores','actitudes','se_demuestra_cuando'];op.keyValues=op.keyColumns.map(key=>op.row[key]);op.key=JSON.stringify([op.keyColumns,op.keyValues]);
    }
    const id=`${op.table}:${op.key}`,previous=observedVersions[id];
    if(!previous||Number(op.version)>previous.version) observedVersions[id]={version:Number(op.version),protocol:2,deviceId:op.deviceId||batch.deviceId,rowHash:op.rowHash||'',deleted:op.action==='delete'};
   }
  }
 }
 update.observedVersions=observedVersions;update.observedBatches=batches;
 const sha256=identityDigest(update),name=`authority-update-${sha256.slice(0,16)}.json`;
 fs.writeFileSync(path.join(output,name),JSON.stringify(update));
 marker.authorityUpdate={...marker.authorityUpdate,sha256,path:`.armi-sync/identity-migrations/${marker.id}/${name}`};
 fs.writeFileSync(path.join(output,'marker.json'),JSON.stringify(marker));
 return {name,sha256,observedBatches:batches.length,observedRows:Object.keys(observedVersions).length};
}

const same=(a,b)=>a===b || (a!=null && b!=null && typeof a==='object' && typeof b==='object' && identityDigest(a)===identityDigest(b));
export function mergeAuthoritySnapshots(before,planned,current) {
  const tables={},changes={};
  for(const table of Object.keys(planned.tables)) {
    const base=new Map((before.tables[table]||[]).map(op=>[op.key,op]));
    const target=new Map((planned.tables[table]||[]).map(op=>[op.key,op]));
    const local=new Map((current.tables[table]||[]).map(op=>[op.key,op]));
    const merged=[];let localEdits=0,localDeletes=0;
    for(const key of new Set([...target.keys(),...local.keys(),...base.keys()])) {
      const b=base.get(key),p=target.get(key),c=local.get(key);
      if(!c) {if(!b && p)merged.push(p);else if(b && p)localDeletes++;continue;}
      if(!b) {merged.push(c);if(!p||c.rowHash!==p.rowHash)localEdits++;continue;}
      if(c.rowHash===b.rowHash) {if(p)merged.push(p);continue;}
      localEdits++;
      const row={...(p?.row || c.row)};
      for(const field of new Set([...Object.keys(b.row),...Object.keys(c.row)])) {
        if(!same(c.row[field],b.row[field])) {
          if(c.row[field]===undefined)delete row[field];else row[field]=c.row[field];
        }
      }
      const op={...(p||c),row};op.rowHash=hashPortableIdentityRow(table,row);merged.push(op);
    }
    tables[table]=merged;
    if(localEdits||localDeletes)changes[table]={localEdits,localDeletes};
  }
  const references=Object.fromEntries(['students','instruments','evidences'].map(kind=>[kind,{...planned.references[kind],...current.references[kind]}]));
  return {snapshot:{...planned,tables,references},changes};
}

export async function refreshAuthorityMigration({prepared,before,current,output}) {
  assert.ok(!fs.existsSync(output),'La carpeta de trabajo debe ser nueva');fs.mkdirSync(output,{recursive:true});
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const marker=read(path.join(prepared,'marker.json')),payload=read(path.join(prepared,'payload.json'));
  assert.equal(identityDigest(payload),marker.payloadSha256);
  const deviceId=payload.authorityDevice,policy=payload.devices[deviceId];
  const original=new Database(before,{readonly:true,fileMustExist:true});
  const fresh=new Database(current,{readonly:true,fileMustExist:true});
  const gold=new Database(path.join(prepared,'portable-source.db'),{readonly:true,fileMustExist:true});
  const tables=[...IDENTITY_PARENT_TABLES,...IDENTITY_REPLACED_TABLES];
  try {
    assert.equal(identityDigest(identityFingerprints(original,Object.keys(policy.fingerprints))),identityDigest(policy.fingerprints),'El origen de la comparación no es el respaldo verificado');
    const roster=db=>db.prepare('SELECT id,dni,estudiantes,grado,secc FROM db_estudiantes ORDER BY id').all();
    assert.equal(identityDigest(roster(original)),identityDigest(roster(fresh)),'El padrón cambió; no se reutilizan las identidades sin revisar');
    const mappings=gold.prepare('SELECT * FROM armi_sync_identity_map').all();
    const snapshots=[];
    for(const [label,source] of [['original',original],['current',fresh]]) {
      const file=path.join(output,label+'.db');await source.backup(file);
      const db=new Database(file);
      try {
        db.exec('CREATE TABLE IF NOT EXISTS armi_sync_identity_map(entity_table TEXT NOT NULL,local_id TEXT NOT NULL,portable_id TEXT NOT NULL,PRIMARY KEY(entity_table,local_id),UNIQUE(entity_table,portable_id))');
        db.transaction(()=>{db.prepare('DELETE FROM armi_sync_identity_map').run();const put=db.prepare('INSERT INTO armi_sync_identity_map VALUES(?,?,?)');for(const row of mappings)put.run(row.entity_table,row.local_id,row.portable_id);})();
        snapshots.push(await exportPortableIdentitySnapshot(db,{legacyAliases:payload.proofs.legacyAliases}));
      }finally{db.close();}
    }
    const known=new Set(snapshots[0].unresolved.map(row=>`${row.table}:${row.localId}`));
    assert.ok(snapshots[1].unresolved.every(row=>known.has(`${row.table}:${row.localId}`)),'Hay una identidad nueva sin resolver');
    const merged=mergeAuthoritySnapshots(snapshots[0],payload.snapshot,snapshots[1]);
    const update={format:1,migrationId:marker.id,basePayloadSha256:marker.payloadSha256,deviceId,createdAt:new Date().toISOString(),
      policy:{...policy,fingerprints:identityFingerprints(fresh,tables),semanticFingerprints:identitySemanticFingerprints(fresh,tables),roster:roster(fresh)},
      snapshot:merged.snapshot,summary:{changes:merged.changes,unresolvedExisting:snapshots[1].unresolved.length,
        rows:Object.fromEntries(Object.entries(merged.snapshot.tables).map(([table,rows])=>[table,rows.length]))}};
    const sha256=identityDigest(update),name=`authority-update-${sha256.slice(0,16)}.json`;
    fs.writeFileSync(path.join(output,name),JSON.stringify(update));
    const nextMarker={...marker,authorityUpdate:{deviceId,path:`.armi-sync/identity-migrations/${marker.id}/${name}`,sha256}};
    fs.writeFileSync(path.join(output,'marker.json'),JSON.stringify(nextMarker));
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(update.summary,null,2));
    return {file:name,sha256,summary:update.summary};
  } finally {original.close();fresh.close();gold.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,array)=>index%2===0?[...pairs,[value.slice(2),array[index+1]]]:pairs,[]));
  if(args.attachObserved) console.log(JSON.stringify(attachObservedAuthorityVersions({output:args.attachObserved,mirror:args.mirror}),null,2));
  else {for(const key of ['prepared','before','current','output'])assert.ok(args[key],`Falta --${key}`);console.log(JSON.stringify(await refreshAuthorityMigration(args),null,2));}
}
