import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {receiveWebPacket,receiveWebWork,mergeWebWork} from '../backend/webWorkReceiver.js';
import {publishWebTemplates} from '../backend/webTemplateCatalog.js';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{patchSync,patchDb}=require('../backend/webBridgeSourcePatch.cjs');

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const source=fs.readFileSync(new URL('../backend/db.js',import.meta.url),'utf8');
 const sql=source.slice(source.indexOf('const initDb =')).match(/db\.exec\(`([\s\S]*?)`\)/)[1];db.exec(sql);
 db.exec("CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT); INSERT INTO datos_generales(year,institution,teacher,gemini_api_key) VALUES ('2026','Escuela','Docente','private-do-not-export');");
 db.transaction=fn=>(...args)=>{db.exec('BEGIN IMMEDIATE');try{const r=fn(...args);db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 return db;
}
const packet=records=>({format:'armi-web-changes',version:1,packetId:crypto.randomUUID(),syncUserKey:'teacher',records});
const record=(kind,key,before,after,sequence=1)=>({kind,key,before:before===null?null:{deleted:0,value:before},after:{deleted:0,value:after},sequence});
const receive=(db,p)=>receiveWebPacket(db,p,{scope:'mirror-teacher',syncUserKey:'teacher'});
test('Web receiver preserves unrelated desktop edits, secrets, replay identity and same-field conflicts',t=>{
 const db=fixture(t),p=packet([record('general','general',{institution:'Escuela',teacher:'Docente'},{institution:'Escuela web',teacher:'Docente'})]);
 db.exec("UPDATE datos_generales SET teacher='Local teacher'");
 assert.equal(receive(db,p).outcomes[0].status,'applied');
 const row=db.prepare('SELECT * FROM datos_generales').get();assert.equal(row.institution,'Escuela web');assert.equal(row.teacher,'Local teacher');assert.equal(row.gemini_api_key,'private-do-not-export');
 assert.deepEqual(receive(db,p),receive(db,p));
 assert.throws(()=>receive(db,{...p,records:[]}),/Cambió/);
 assert.throws(()=>receive(db,{...packet([]),syncUserKey:'someone-else'}),/docente/);
 const conflict=receive(db,packet([record('general','general',{institution:'Escuela'},{institution:'Conflicting web'},2)]));assert.equal(conflict.outcomes[0].status,'conflict');assert.equal(db.prepare('SELECT institution FROM datos_generales').get().institution,'Escuela web');
 assert.equal(receive(db,packet([record('general','general',null,{institution:'Unknown baseline'},3)])).outcomes[0].status,'conflict');
});
test('Students match DNI rather than numeric ID; new students are mapped and duplicate DNI blocks updates',t=>{
 const db=fixture(t);db.exec("INSERT INTO db_estudiantes(id,dni,estudiantes,grado,secc) VALUES(99,'00123456','Ana','3','A')");
 const before={dni:'00123456',name:'Ana',grade:'3',section:'A'},after={...before,name:'Ana Web'};
 assert.equal(receive(db,packet([record('students','1',before,after)])).outcomes[0].status,'applied');assert.equal(db.prepare('SELECT estudiantes FROM db_estudiantes WHERE id=99').get().estudiantes,'Ana Web');
 const created=receive(db,packet([record('students','web-new',null,{name:'Luis',grade:'3',section:'A',dni:'87654321'},2)]));assert.equal(created.outcomes[0].status,'applied');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM db_estudiantes').get().n,2);
 db.exec("INSERT INTO db_estudiantes(dni,estudiantes,grado,secc) VALUES('00123456','Duplicate','3','A')");
 assert.equal(receive(db,packet([record('students','unmapped',before,after,3)])).outcomes[0].status,'conflict');
});
test('Lesson edits merge by canonical identity; evidence HTML exports separately without credentials or student answers',async t=>{
 const db=fixture(t),dir=fs.mkdtempSync(path.join(os.tmpdir(),'armi-web-receive-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const id='2026-area-3-A-U1-S1',before={year:'2026',areaId:'area',grade:'3',section:'A',unitNumber:1,sessionNumber:1,title:'Title',purpose:'Purpose'};
 db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)').run(id,'2026','area','3','A','1','1',JSON.stringify({...before,purpose:'Local purpose'}));
 assert.equal(receive(db,packet([record('sessions',id,before,{...before,title:'Web title'})])).outcomes[0].status,'applied');
 const lesson=JSON.parse(db.prepare('SELECT session_data FROM sesiones').get().session_data);assert.equal(lesson.title,'Web title');assert.equal(lesson.purpose,'Local purpose');
 lesson.interactiveActivities=[{id:'interactive-1',title:'Practice',html:'<article>Interactive practice</article>',responses:'private-student-response'}];
 db.prepare('UPDATE sesiones SET session_data=?').run(JSON.stringify(lesson));
 db.exec('CREATE TABLE evidence_templates(id TEXT PRIMARY KEY,session_id TEXT,evidence_id TEXT,requested_json TEXT,html TEXT,mode TEXT,enabled INTEGER,version INTEGER,updated_at TEXT)');
 db.prepare('INSERT INTO evidence_templates VALUES(?,?,?,?,?,?,?,?,?)').run('template-1',id,'e1','{"text":"Activity"}','<article>Activity worksheet</article>','individual',1,1,'2026-11-24');
 await publishWebTemplates({db,mirrorPath:dir,syncUserKey:'teacher'});
 const folder=path.join(dir,'ARMI Web Sync','templates'),index=JSON.parse(fs.readFileSync(path.join(folder,'index.json'),'utf8'));assert.equal(index.entries[0].sessionId,id);
 const content=fs.readFileSync(path.join(folder,index.entries[0].file),'utf8');assert.ok(content.includes('Activity worksheet'));assert.ok(!content.includes('private-do-not-export'));assert.ok(!content.includes('student_id'));assert.equal(crypto.createHash('sha256').update(content).digest('hex'),index.entries[0].sha256);
 assert.ok(content.includes('Interactive practice'));assert.ok(!content.includes('private-student-response'));
});
test('Receiver detects unknown record types without blocking independent valid changes; actual mirror receives once',async t=>{
 const db=fixture(t),dir=fs.mkdtempSync(path.join(os.tmpdir(),'armi-web-receive-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'.armi-sync-root.json'),JSON.stringify({syncUserKey:'teacher'}));fs.mkdirSync(path.join(dir,'ARMI Web Sync'));
 const p=packet([record('unknown','x',null,{},1),record('general','general',{institution:'Escuela'},{institution:'Changed'},2)]);
 fs.writeFileSync(path.join(dir,'ARMI Web Sync',p.packetId+'.json'),JSON.stringify(p));
 const first=await receiveWebWork({db,mirrorPath:dir,syncUserKey:'teacher'});assert.equal(first.applied,1);assert.equal(first.conflicts,1);
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,'ARMI Web Sync','receipts',p.packetId+'.json'),'utf8'));assert.equal(receipt.outcomes[0].status,'conflict');
 assert.equal((await receiveWebWork({db,mirrorPath:dir,syncUserKey:'teacher'})).applied,0);
 assert.throws(()=>mergeWebWork({x:1},{x:2},{x:3}),/mismo dato/);
});
test('Units, instruments, grades and conclusions preserve SQL relationships using mapped student identities',t=>{
 const db=fixture(t),id='2026-area-3-A-U1-S1';
 db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)').run(id,'2026','area','3','A','1','1','{}');
 db.exec("INSERT INTO db_estudiantes(id,dni,estudiantes,grado,secc) VALUES(90,'00123456','Ana','3','A')");
 const unit={year:'2026',areaId:'area',grade:'3',section:'A',unitNumber:'1',title:'Unit',sesiones:[],criterios:{},evidencias:{},instrumentos:{}};
 const instrument={year:'2026',areaId:'area',grade:'3',section:'A',type:'rubrica',name:'Rubric',structure:{rows:[]},version:1};
 const grade={student_id:'1',session_id:id,unit_id:'2026-area-3-A-U1',instrument_id:'web-instrument',criteria_id:'criterion-a',level:'a',observation:'Good'};
 const conclusion={studentId:'1',competencyKey:'competency',competencyName:'Comp',competencySource:'primary',conclusionText:'Progress'};
 const p=packet([record('units','2026-area-3-A-U1',null,unit),record('instruments','web-instrument',null,instrument,2),{...record('grades',id,null,[grade],3),after:{deleted:0,value:[grade],context:{year:'2026',areaId:'area',grade:'3',section:'A'}}},{...record('conclusions','scope-unit',null,[conclusion],4),after:{deleted:0,value:[conclusion],context:{year:'2026',areaId:'area',grade:'3',section:'A',scopeType:'unit',scopeValue:'1'}}}]);
 p.studentIdentities={'1':{dni:'00123456'}};
 const result=receive(db,p);assert.deepEqual(result.outcomes.map(r=>r.status),['applied','applied','applied','applied']);
 assert.equal(db.prepare('SELECT student_id,level FROM evaluacion_registros').get().student_id,'90');assert.equal(db.prepare('SELECT student_id FROM evaluacion_conclusiones').get().student_id,'90');
 const changed=receive(db,{...packet([{...record('grades',id,[grade],[{...grade,level:'ad'}],5),after:{deleted:0,value:[{...grade,level:'ad'}],context:{year:'2026',areaId:'area',grade:'3',section:'A'}}}]),studentIdentities:p.studentIdentities});assert.equal(changed.outcomes[0].status,'applied');assert.equal(db.prepare('SELECT level FROM evaluacion_registros').get().level,'ad');
});
test('Installed source patch adds only the receiver hooks and refuses changed anchors',()=>{
 const source="import path from 'node:path';\nconst readConfig=()=>({}),db={},snapshotsFolder='unused',getMirrorFilePath=()=>'',incrementalMirrorSync={run:async()=>({success:true,data:{appliedOperations:0}})};let receivedChanges;\nconst runIncrementalMirrorSync = async (mirrorPath) => { const result=await incrementalMirrorSync.run(); if(result.success&&(result.data?.appliedOperations > 0 || result.data?.identityMigrationApplied)){receivedChanges={operations:Math.max(1,result.data.appliedOperations)};} return result;};export {runIncrementalMirrorSync};";
 const output=patchSync(source,'file:///bridge.cjs');assert.ok(output.includes('armiWebDesktopBridge.runWebBridge'));assert.equal(patchSync(output,'file:///bridge.cjs'),output);assert.throws(()=>patchSync('changed version','file:///bridge.cjs'),/versión instalada/);
 assert.ok(patchDb('const SYNC_EXCLUDED_TABLES = new Set([]);').includes("'web_work_receipts'"));
});
test('Packaged loader executes in Node without replacing installed modules or touching a real database',{skip:!fs.existsSync(path.resolve('artifacts','ARMI-Actualizacion-Sincronizacion-Web','bridge.cjs'))},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'armi-web-loader-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const hook=path.join(dir,'update'),backend=path.join(dir,'app.asar','backend');fs.mkdirSync(hook,{recursive:true});fs.mkdirSync(backend,{recursive:true});
 fs.writeFileSync(path.join(dir,'app.asar','package.json'),'{"type":"module"}');
 for(const name of ['bridge.cjs','register.cjs','patch.cjs'])fs.copyFileSync(path.resolve('artifacts','ARMI-Actualizacion-Sincronizacion-Web',name),path.join(hook,name));
 fs.writeFileSync(path.join(backend,'db.js'),"const SYNC_EXCLUDED_TABLES = new Set([]);export default SYNC_EXCLUDED_TABLES;");
 fs.writeFileSync(path.join(backend,'sync.js'),"import path from 'node:path';const readConfig=()=>({}),db={},snapshotsFolder='unused',incrementalMirrorSync={run:async()=>({success:true,data:{appliedOperations:0}})};let receivedChanges; const runIncrementalMirrorSync = async (mirrorPath) => {const result=await incrementalMirrorSync.run();if(result.success&&(result.data?.appliedOperations > 0 || result.data?.identityMigrationApplied)){receivedChanges={operations:Math.max(1,result.data.appliedOperations)};}return result;};export {runIncrementalMirrorSync};");
 const script=`const assert=require('node:assert/strict');Promise.all([import(${JSON.stringify(pathToFileURL(path.join(backend,'db.js')).href)}),import(${JSON.stringify(pathToFileURL(path.join(backend,'sync.js')).href)})]).then(async([db,sync])=>{assert.ok(db.default.has('web_work_receipts'));assert.equal((await sync.runIncrementalMirrorSync(null)).success,true);console.log('isolated-loader-ok');}).catch(e=>{console.error(e);process.exitCode=1;});`;
 const result=execFileSync(process.execPath,['--require',path.join(hook,'register.cjs'),'-e',script],{encoding:'utf8'});assert.ok(result.includes('isolated-loader-ok'));
});
