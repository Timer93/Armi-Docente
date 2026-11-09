import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';
import { createSyncReferenceIdentity, createDumpReferenceTranslator } from '../backend/syncReferenceIdentity.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(),'armi-reference-identity-'));
const mirror = path.join(root,'mirror'); fs.mkdirSync(mirror);
const connections = [];
const make = (name, swapped) => {
  const db = new Database(':memory:'); connections.push(db);
  db.exec(`
    CREATE TABLE db_estudiantes(id INTEGER PRIMARY KEY AUTOINCREMENT,dni TEXT,estudiantes TEXT,grado TEXT,secc TEXT);
    CREATE TABLE evaluacion_instrumentos(id INTEGER PRIMARY KEY AUTOINCREMENT,year INTEGER,area_id TEXT,grade TEXT,section TEXT,type TEXT,name TEXT);
    CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id TEXT,session_id TEXT,criteria_id TEXT,grading_mode TEXT,level TEXT,numeric_score REAL,instrument_id INTEGER);
    CREATE TABLE asistencia_registros(id INTEGER PRIMARY KEY AUTOINCREMENT,attendance_date TEXT,grade TEXT,section TEXT,student_id TEXT,student_name TEXT,dni TEXT,status TEXT);
    CREATE TABLE evaluacion_evidencias(id INTEGER PRIMARY KEY AUTOINCREMENT,evidence_key TEXT,student_id TEXT,student_ids TEXT,session_id TEXT,relative_path TEXT,student_names TEXT,version_group_id TEXT);
    CREATE TABLE evaluacion_conclusiones(id INTEGER PRIMARY KEY AUTOINCREMENT,year INTEGER,area_id TEXT,grade TEXT,section TEXT,scope_type TEXT,scope_value TEXT,student_id TEXT,competency_key TEXT,conclusion TEXT);
    CREATE TABLE interactive_activity_attempts(session_id TEXT,activity_id TEXT,scope_type TEXT,scope_key TEXT,checkpoint_json TEXT,PRIMARY KEY(session_id,activity_id,scope_type,scope_key));
    CREATE TABLE student_forum_drafts(id TEXT PRIMARY KEY,author_id TEXT,year INTEGER,data_json TEXT);
    CREATE TABLE student_learning_journal(id TEXT PRIMARY KEY,student_id TEXT,session_id TEXT,content_json TEXT,evidence_ids TEXT);
    CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE student_deletion_tombstones(student_id TEXT PRIMARY KEY,dni TEXT,student_name TEXT);
  `);
  const ana = swapped ? 22 : 11, bruno = swapped ? 11 : 22, instrument = swapped ? 99 : 1;
  db.prepare('INSERT INTO db_estudiantes VALUES (?,?,?,?,?)').run(ana,'70000011','ANA TEST','4to','U');
  db.prepare('INSERT INTO db_estudiantes VALUES (?,?,?,?,?)').run(bruno,'70000022','BRUNO TEST','4to','U');
  db.prepare('INSERT INTO evaluacion_instrumentos VALUES (?,2026,?,?,?,?,?)').run(instrument,'ept','4to','U','rubric','Rubrica U6');
  const engine = createIncrementalMirrorSync({db,runtimeFolder:path.join(root,name),getDeviceId:()=>name});
  return {db,engine,ana,bruno,instrument,name};
};
const run = async pc => {
  const result = await pc.engine.run({mirrorPath:mirror});
  assert.equal(result.success,true,result.message); return result;
};
try {
  const a=make('a',false),b=make('b',true);
  a.db.prepare('INSERT INTO evaluacion_registros VALUES (1,?,?,?,?,?,?,?)').run(String(a.ana),'U6S1','c1','hybrid_vigesimal','A',15,a.instrument);
  a.db.prepare('INSERT INTO evaluacion_registros VALUES (2,?,?,?,?,?,?,?)').run(String(a.ana),'U6S1','c1','literal_traditional','B',null,a.instrument);
  b.db.prepare('INSERT INTO evaluacion_registros VALUES (1,?,?,?,?,?,?,?)').run(String(b.bruno),'U6S1','c1','hybrid_vigesimal','C',10,b.instrument);
  a.db.prepare("INSERT INTO asistencia_registros VALUES (1,'2026-10-19','4to','U',?,'ANA TEST','70000011','P')").run(String(a.ana));
  a.db.prepare("INSERT INTO evaluacion_evidencias VALUES (7,'ev-ana',?,?, 'U6S1','ana.pdf',?,'legacy-7')").run(String(a.ana),JSON.stringify([String(a.ana),String(a.bruno)]),JSON.stringify(['ANA TEST','BRUNO TEST']));
  b.db.prepare("INSERT INTO evaluacion_evidencias VALUES (7,'ev-bruno',?,?, 'U6S1','bruno.pdf',?,'legacy-7')").run(String(b.bruno),JSON.stringify([String(b.bruno)]),JSON.stringify(['BRUNO TEST']));
  a.db.prepare("INSERT INTO evaluacion_conclusiones VALUES (1,2026,'ept','4to','U','bimester','III',?,'ept','Avanza en su proyecto.')").run(String(a.ana));
  a.db.prepare("INSERT INTO interactive_activity_attempts VALUES ('U6S1','practice','individual',?,?)").run(String(a.ana),JSON.stringify({student_id:String(a.ana),score:11,answers:[22]}));
  a.db.prepare('INSERT INTO student_forum_drafts VALUES (?,?,2026,?)').run(`student:2026:${a.ana}`,String(a.ana),JSON.stringify({student_id:String(a.ana),text:'11'}));
  a.db.prepare("INSERT INTO student_learning_journal VALUES (?,?,'U6S1',?,?)").run(`${a.ana}::U6S1`,String(a.ana),JSON.stringify({student_id:String(a.ana),score:11}),JSON.stringify([7]));
  a.db.prepare('INSERT INTO armi_frontend_state VALUES (?,?)').run('armi_register_conclusions_bimester_2026_ept_4to_U_III',JSON.stringify({[`${a.ana}::ept`]:'Avanza.'}));
  a.db.prepare('INSERT INTO armi_frontend_state VALUES (?,?)').run('armi_hybrid_numeric_scores_v1',JSON.stringify({[`U6S1::${a.ana}::c1`]:15}));
  await run(a); await run(b); await run(a); await run(b);
  const grades = pc => pc.db.prepare('SELECT s.dni,g.grading_mode,g.level,g.numeric_score,i.name FROM evaluacion_registros g JOIN db_estudiantes s ON s.id=g.student_id JOIN evaluacion_instrumentos i ON i.id=g.instrument_id ORDER BY s.dni,g.grading_mode').all();
  assert.deepEqual(grades(a),grades(b)); assert.equal(grades(b).length,3);
  assert.equal(b.db.prepare('SELECT student_id FROM asistencia_registros').get().student_id,String(b.ana));
  assert.equal(b.db.prepare('SELECT student_id FROM evaluacion_conclusiones').get().student_id,String(b.ana));
  const activity=b.db.prepare('SELECT * FROM interactive_activity_attempts').get();
  assert.equal(activity.scope_key,String(b.ana));
  assert.deepEqual(JSON.parse(activity.checkpoint_json),{student_id:String(b.ana),score:11,answers:[22]});
  assert.equal(b.db.prepare('SELECT id FROM student_forum_drafts').get().id,`student:2026:${b.ana}`);
  const journal=b.db.prepare('SELECT * FROM student_learning_journal').get();
  assert.equal(journal.id,`${b.ana}::U6S1`);
  const evidenceId=JSON.parse(journal.evidence_ids)[0];
  assert.equal(b.db.prepare('SELECT evidence_key FROM evaluacion_evidencias WHERE id=?').get(evidenceId).evidence_key,'ev-ana');
  const group=b.db.prepare("SELECT student_ids FROM evaluacion_evidencias WHERE evidence_key='ev-ana'").get();
  assert.deepEqual(JSON.parse(group.student_ids),[String(b.ana),String(b.bruno)]);
  assert.equal(b.db.prepare("SELECT version_group_id FROM evaluacion_evidencias WHERE evidence_key='ev-ana'").get().version_group_id,
    createSyncReferenceIdentity(a.db).portable('evaluacion_evidencias',a.db.prepare("SELECT * FROM evaluacion_evidencias WHERE evidence_key='ev-ana'").get()).version_group_id);
  assert.notEqual(b.db.prepare("SELECT version_group_id FROM evaluacion_evidencias WHERE evidence_key='ev-ana'").get().version_group_id,
    b.db.prepare("SELECT version_group_id FROM evaluacion_evidencias WHERE evidence_key='ev-bruno'").get().version_group_id);
  assert.deepEqual(JSON.parse(b.db.prepare("SELECT value FROM armi_frontend_state WHERE key LIKE 'armi_register_conclusions_%'").get().value),{[`${b.ana}::ept`]:'Avanza.'});
  assert.deepEqual(JSON.parse(b.db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_hybrid_numeric_scores_v1'").get().value),{[`U6S1::${b.ana}::c1`]:15});
  // An edit and a delete must target the same student/mode on the other PC.
  b.db.prepare("UPDATE evaluacion_registros SET numeric_score=16 WHERE student_id=? AND grading_mode='hybrid_vigesimal'").run(String(b.ana));
  b.db.prepare("DELETE FROM evaluacion_registros WHERE student_id=? AND grading_mode='literal_traditional'").run(String(b.ana));
  await run(b); await run(a); assert.deepEqual(grades(a),grades(b));
  assert.equal(grades(a).find(row=>row.dni==='70000011').numeric_score,16);
  assert.equal(grades(a).find(row=>row.dni==='70000022').numeric_score,10);
  // Correcting a document must preserve the already shared immutable identity.
  const beforeIdentity=createSyncReferenceIdentity(a.db).catalog().students[String(a.ana)].token;
  a.db.prepare("UPDATE db_estudiantes SET dni='70000033' WHERE id=?").run(a.ana);
  await run(a); await run(b);
  assert.equal(b.db.prepare('SELECT dni FROM db_estudiantes WHERE id=?').get(b.ana).dni,'70000033');
  assert.equal(createSyncReferenceIdentity(a.db).catalog().students[String(a.ana)].token,beforeIdentity);
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM db_estudiantes').get().n,2);
  for (const [pc,document,label,score] of [[a,'70000044','CLAIRE TEST',13],[b,'70000055','DIEGO TEST',16]]) {
    const created=pc.db.prepare("INSERT INTO db_estudiantes(dni,estudiantes,grado,secc) VALUES (?,?,'4to','U')").run(document,label);
    assert.equal(Number(created.lastInsertRowid),23,'Both PCs concurrently allocate the same number');
    pc.db.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,grading_mode,level,numeric_score,instrument_id) VALUES (?,'U6S2','c2','hybrid_vigesimal',?,?,?)")
      .run(String(created.lastInsertRowid),score===13?'B':'A',score,pc.instrument);
  }
  await run(a); await run(b); await run(a); await run(b);
  assert.deepEqual(grades(a),grades(b));
  assert.equal(grades(a).find(row=>row.dni==='70000044').numeric_score,13);
  assert.equal(grades(a).find(row=>row.dni==='70000055').numeric_score,16);
  // Legacy package merges use the source roster, including a colliding ID.
  const translate=createDumpReferenceTranslator(b.db,{tables:{db_estudiantes:a.db.prepare('SELECT * FROM db_estudiantes').all()}});
  assert.equal(translate('asistencia_registros',{student_id:String(a.ana)}).student_id,String(b.ana));
  assert.throws(()=>translate('evaluacion_registros',{student_id:'9999'}),{code:'ARMI_IDENTITY_PENDING'});
  const unknown=createSyncReferenceIdentity(a.db);
  assert.throws(()=>unknown.portable('evaluacion_registros',{student_id:'9999'}),{code:'ARMI_IDENTITY_PENDING'});
  // Old clients with already mixed IDs must not republish guessed ownership.
  const old=make('old',true); fs.mkdirSync(path.join(root,'old'),{recursive:true});
  fs.writeFileSync(path.join(root,'old','incremental-mirror-state.json'),JSON.stringify({initialized:true,identityRevision:3,appliedBatches:[],baseline:{}}));
  const before=old.db.prepare('SELECT * FROM db_estudiantes').all();
  const gated=await old.engine.run({mirrorPath:mirror});
  assert.equal(gated.success,false); assert.equal(gated.data.state,'pending');
  assert.deepEqual(old.db.prepare('SELECT * FROM db_estudiantes').all(),before);
  assert.equal(fs.readdirSync(path.join(mirror,'.armi-sync','incremental-v1','devices','old','events')).length,0);
  // A malformed new packet must not smuggle a foreign local number back in.
  const folder=path.join(mirror,'.armi-sync','incremental-v1','devices','malformed','events'); fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'malformed.json'),JSON.stringify({format:2,batchId:'malformed',deviceId:'malformed',operations:[{
    table:'evaluacion_registros',action:'upsert',key:'bad',keyColumns:['student_id','session_id','criteria_id','grading_mode'],keyValues:['11','BAD','c','hybrid_vigesimal'],version:999,
    row:{student_id:'11',session_id:'BAD',criteria_id:'c',grading_mode:'hybrid_vigesimal',level:'AD',numeric_score:20,instrument_id:1}
  }]}));
  const pending=await run(b); assert.ok(pending.data.identityPending>0);
  assert.equal(b.db.prepare("SELECT COUNT(*) n FROM evaluacion_registros WHERE session_id='BAD'").get().n,0);
  assert.equal(b.engine.inspect({mirrorPath:mirror}).pending,true);
  console.log('OK: crossed student IDs, instrument/evidence IDs, grades/modes, attendance, conclusions, activities, groups, journals, drafts, caches, legacy imports and guarded migration.');
} finally {
  connections.forEach(db=>db.close()); fs.rmSync(root,{recursive:true,force:true});
}
