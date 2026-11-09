import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import Database from 'better-sqlite3';
import {createIncrementalMirrorSync,exportPortableIdentitySnapshot} from '../backend/incrementalMirrorSync.js';
import {identityDigest,identityFingerprints,identitySemanticFingerprints} from '../backend/identityMigration.js';
import {mergeAuthoritySnapshots} from './refresh-authority-migration.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-authority-refresh-')),mirror=path.join(root,'mirror'),id='fixture-update';
const pcs=[];
const make=(name,student)=>{
 const runtime=path.join(root,name);fs.mkdirSync(runtime,{recursive:true});
 const db=new Database(path.join(root,name+'.db'));pcs.push(db);
 db.exec(`CREATE TABLE db_estudiantes(id INTEGER PRIMARY KEY,dni TEXT,estudiantes TEXT,grado TEXT,secc TEXT,password_recovery_cipher TEXT);
 CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY,student_id TEXT,session_id TEXT,criteria_id TEXT,grading_mode TEXT,level TEXT,numeric_score REAL,updated_at TEXT);
 CREATE TABLE evaluacion_conclusiones(id INTEGER PRIMARY KEY,year TEXT,area_id TEXT,grade TEXT,section TEXT,scope_type TEXT,scope_value TEXT,student_id TEXT,competency_key TEXT,conclusion_text TEXT,updated_at TEXT);`);
 db.prepare('INSERT INTO db_estudiantes VALUES(?,?,?,?,?,?)').run(student,'70000011','ANA TEST','4to','U','local cipher');
 db.prepare('INSERT INTO evaluacion_registros VALUES(?,?,?,?,?,?,?,?)').run(1,String(student),'U6S1','c1','hybrid_vigesimal','A',15,'2026-10-19');
 db.prepare('INSERT INTO evaluacion_conclusiones VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(1,'2026','ept','4to','U','bimester','III',String(student),'ept','Original','2026-10-19');
 return {db,runtime,engine:createIncrementalMirrorSync({db,runtimeFolder:runtime,getDeviceId:()=>name,excludedTables:[]})};
};
try{
 const a=make('a',11),b=make('b',22);
 const tables=['db_estudiantes','evaluacion_registros','evaluacion_conclusiones'];
 const policy=pc=>({mode:'exact',fingerprints:identityFingerprints(pc.db,tables),roster:pc.db.prepare('SELECT * FROM db_estudiantes').all()});
 const original=await exportPortableIdentitySnapshot(a.db);
 const payload={format:1,id,createdAt:'2026-10-19',coveredBatches:[],snapshot:original,devices:{a:policy(a),b:policy(b)}};
 const folder=path.join(mirror,'.armi-sync','identity-migrations',id);fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'payload.json'),JSON.stringify(payload));
 const marker={format:1,id,payloadPath:`.armi-sync/identity-migrations/${id}/payload.json`,payloadSha256:identityDigest(payload)};
 const manifest=path.join(mirror,'.armi-sync/identity-migration-v4.json');fs.writeFileSync(manifest,JSON.stringify(marker));
 assert.equal((await b.engine.run({mirrorPath:mirror})).success,true,'The other PC has already migrated');
 a.db.prepare('UPDATE evaluacion_registros SET numeric_score=16').run();
 a.db.prepare("UPDATE evaluacion_conclusiones SET conclusion_text='Recent teacher text'").run();
 const current=await exportPortableIdentitySnapshot(a.db);
 const merged=mergeAuthoritySnapshots(original,original,current);
 const update={format:1,migrationId:id,deviceId:'a',basePayloadSha256:marker.payloadSha256,createdAt:'2026-10-20',
  snapshot:merged.snapshot,policy:{...policy(a),semanticFingerprints:identitySemanticFingerprints(a.db,tables)},summary:merged.changes};
 const peerState=JSON.parse(fs.readFileSync(path.join(b.runtime,'incremental-identity-state.json')));
 update.observedVersions=peerState.versions;
 fs.writeFileSync(path.join(folder,'update.json'),JSON.stringify(update));
 fs.writeFileSync(manifest,JSON.stringify({...marker,authorityUpdate:{deviceId:'a',path:`.armi-sync/identity-migrations/${id}/update.json`,sha256:identityDigest(update)}}));
 // Ordinary re-saves only change storage IDs/timestamps/encryption details.
 a.db.exec("UPDATE evaluacion_registros SET id=99,updated_at='2026-10-20';UPDATE evaluacion_conclusiones SET id=99,updated_at='2026-10-20';UPDATE db_estudiantes SET password_recovery_cipher='new local cipher'");
 a.db.exec('UPDATE evaluacion_registros SET numeric_score=17');
 const protectedResult=await a.engine.run({mirrorPath:mirror});assert.equal(protectedResult.success,false);
 assert.equal(protectedResult.data.pendingTask.requiresAction,true);assert.equal(a.db.prepare('SELECT numeric_score FROM evaluacion_registros').get().numeric_score,17);
 a.db.exec('UPDATE evaluacion_registros SET numeric_score=16');
 const first=await a.engine.run({mirrorPath:mirror});assert.equal(first.success,true,first.message);
 for(let round=0;round<2;round++) {await b.engine.run({mirrorPath:mirror});await a.engine.run({mirrorPath:mirror});}
 for(const pc of[a,b]){
  assert.equal(pc.db.prepare('SELECT numeric_score FROM evaluacion_registros').get().numeric_score,16);
  assert.equal(pc.db.prepare('SELECT conclusion_text FROM evaluacion_conclusiones').get().conclusion_text,'Recent teacher text');
 }
 assert.equal(b.db.prepare('SELECT COUNT(*) n FROM armi_sync_migration_log').get().n,1,'The old migrated PC must not re-import its original snapshot');
 assert.equal((await b.engine.run({mirrorPath:mirror})).data.identityMigrationApplied,false);
 assert.ok(fs.existsSync(path.join(a.runtime,'identity-upgrade-backups',id,'before.db')));
 const localDeletion=mergeAuthoritySnapshots(original,original,{...original,tables:{...original.tables,evaluacion_registros:[]}});
 assert.equal(localDeletion.snapshot.tables.evaluacion_registros.length,0,'A recent deliberate clearing must not be resurrected');
 console.log('OK: recent grades/text preserved, equivalent internal re-saves accepted, real later edits protected, migrated peer updated incrementally, backups and no repeated import.');
}finally{for(const db of pcs)db.close();fs.rmSync(root,{recursive:true,force:true});}
