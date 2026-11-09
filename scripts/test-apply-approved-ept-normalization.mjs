import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {simulateUniformEpt} from './simulate-uniform-ept-normalization.mjs';
import {applyApprovedNormalization} from './apply-approved-ept-normalization.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-approved-normalization-'));
const seedPath=path.join(root,'seed.db');
try{
  const seed=new Database(seedPath);
  seed.exec(`CREATE TABLE sesiones(id_sesion TEXT,year TEXT,area_id TEXT,grade TEXT,section TEXT,unit_number TEXT,session_number TEXT,session_data TEXT);
    CREATE TABLE db_estudiantes(id TEXT,estudiantes TEXT,grado TEXT,secc TEXT,estado TEXT);
    CREATE TABLE student_deletion_tombstones(student_id TEXT,student_name TEXT);
    CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY,student_id TEXT,session_id TEXT,criteria_id TEXT,grading_mode TEXT,numeric_score REAL,level TEXT,observation TEXT,updated_at TEXT);
    CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE unidades(id INTEGER,data TEXT); CREATE TABLE evaluacion_evidencias(id INTEGER,data TEXT);
    CREATE TABLE interactive_activity_results(id INTEGER,data TEXT); CREATE TABLE interactive_activity_attempts(id INTEGER,data TEXT);
    CREATE TABLE evaluacion_conclusiones(id INTEGER,data TEXT); CREATE TABLE sync_change_clock(revision INTEGER);
    INSERT INTO sync_change_clock VALUES(0);
    CREATE TRIGGER grade_clock AFTER UPDATE ON evaluacion_registros BEGIN UPDATE sync_change_clock SET revision=revision+1; END;
    CREATE TRIGGER cache_clock AFTER UPDATE ON armi_frontend_state BEGIN UPDATE sync_change_clock SET revision=revision+1; END;
    INSERT INTO unidades VALUES(1,'Original plan');INSERT INTO evaluacion_evidencias VALUES(1,'Original evidence');`);
  const model={numericAverageRounding:'nearest_integer',sessionAssessmentModel:{rows:[
    {id:'primary-1',source:'primary',competencyName:'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.',capacityName:'Crea propuestas de valor',criterionText:'EPT'},
    {id:'transversal-1-1',source:'transversal',competencyName:'GESTIONA SU APRENDIZAJE DE MANERA AUTÓNOMA',capacityName:'Define metas de aprendizaje',criterionText:'Metas'}]}};
  for(const unit of ['5','6'])seed.prepare('INSERT INTO sesiones VALUES(?,?,?,?,?,?,?,?)').run('u'+unit,'2026','EPT','3ro','U',unit,'1',JSON.stringify(model));
  let id=1;const scores={other:999};
  for(const [student,grades] of [['c',[5,15]],['b',[12,14]]]){
    seed.prepare('INSERT INTO db_estudiantes VALUES(?,?,?,?,?)').run(student,student,'3ro','U','A');
    for(const [index,unit] of ['5','6'].entries()){
      const score=grades[index],level=score>=14?'A':score>=11?'B':'C';
      seed.prepare('INSERT INTO evaluacion_registros VALUES(?,?,?,?,?,?,?,?,?)').run(id++,student,'u'+unit,'primary-1','hybrid_vigesimal',score,level,'Original comment','before');
      scores[`u${unit}::${student}::primary-1`]=score;
      seed.prepare('INSERT INTO evaluacion_registros VALUES(?,?,?,?,?,?,?,?,?)').run(id++,student,'u'+unit,'transversal-1-1','hybrid_vigesimal',12,'B','Transversal comment','before');
      scores[`u${unit}::${student}::transversal-1-1`]=12;
    }
  }
  seed.prepare('INSERT INTO armi_frontend_state VALUES(?,?,?)').run('armi_hybrid_numeric_scores_v1',JSON.stringify(scores),'before');
  seed.prepare('INSERT INTO armi_frontend_state VALUES(?,?,?)').run('armi_other_setting','unchanged','before');
  const approved=simulateUniformEpt(seed);assert.equal(approved.recordChanges.length,3);
  const originalRows=seed.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();seed.close();
  const clone=name=>{const file=path.join(root,name+'.db');fs.copyFileSync(seedPath,file);return file;};
  const dbPath=clone('success');
  const args={databasePath:dbPath,approved,backupRoot:path.join(root,'backups')};
  const dry=await applyApprovedNormalization(args);assert.equal(dry.applied,false);assert.equal(dry.changedGrades,3);
  const result=await applyApprovedNormalization({...args,apply:true});
  assert.equal(result.changedGrades,3);assert.equal(result.cacheUpdates,3);assert.equal(result.actualMatchesSimulation,true);
  const backup=new Database(result.backup,{readonly:true});assert.deepEqual(backup.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(),originalRows);backup.close();
  const check=new Database(dbPath,{readonly:true});
  assert.equal(check.prepare('SELECT revision FROM sync_change_clock').get().revision,4,'Existing replication triggers receive the grade and cache changes');
  assert.equal(check.prepare('SELECT data FROM evaluacion_evidencias').get().data,'Original evidence');
  assert.equal(check.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_other_setting'").get().value,'unchanged');check.close();
  assert.equal((await applyApprovedNormalization({...args,apply:true})).alreadyApplied,true);

  const rollbackPath=clone('rollback');const rollbackDb=new Database(rollbackPath);
  const failId=approved.recordChanges[1].recordId;
  rollbackDb.exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON evaluacion_registros WHEN OLD.id=${failId} BEGIN SELECT RAISE(ABORT,'forced failure'); END;`);rollbackDb.close();
  await assert.rejects(applyApprovedNormalization({...args,databasePath:rollbackPath,apply:true}),/forced failure/);
  const rolledBack=new Database(rollbackPath,{readonly:true});
  assert.deepEqual(rolledBack.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(),originalRows,'All grades roll back after a mid-batch failure');
  assert.equal(rolledBack.prepare('SELECT revision FROM sync_change_clock').get().revision,0);rolledBack.close();

  const badCachePath=clone('bad-cache');const badCacheDb=new Database(badCachePath);
  const wrongCache=structuredClone(scores),first=approved.recordChanges[0];wrongCache[`${first.sessionId}::${first.studentId}::${first.criteriaId}`]=0;
  badCacheDb.prepare("UPDATE armi_frontend_state SET value=? WHERE key='armi_hybrid_numeric_scores_v1'").run(JSON.stringify(wrongCache));badCacheDb.close();
  await assert.rejects(applyApprovedNormalization({...args,databasePath:badCachePath,apply:true}),/Cache has another value/);
  const cacheCheck=new Database(badCachePath,{readonly:true});assert.deepEqual(cacheCheck.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(),originalRows);cacheCheck.close();
  console.log('OK: approved-only atomic application, full backup, preserved original literals/comments/evidence, cache consistency, replication triggers, exact real consolidation, rollback and idempotency.');
}finally{
  const resolved=path.resolve(root),temp=path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(temp+path.sep)&&path.basename(resolved).startsWith('armi-approved-normalization-'));
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
