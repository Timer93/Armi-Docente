import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {adjustUnit56Grades} from './adjust-unit56-grades.mjs';
import {createRegisterAggregation} from '../backend/shared/registerAggregation.generated.js';
import {buildStudentGradebook} from '../backend/studentGradebook.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-unit56-adjustment-')),file=path.join(root,'armi.db');
try{
  const db=new Database(file);
  db.exec(`CREATE TABLE sesiones(id_sesion TEXT PRIMARY KEY,year TEXT,unit_number TEXT,session_data TEXT,updated_at TEXT);
    CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY,student_id TEXT,session_id TEXT,criteria_id TEXT,grading_mode TEXT,numeric_score REAL,level TEXT,observation TEXT,updated_at TEXT);
    CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);`);
  const session=db.prepare("INSERT INTO sesiones VALUES(?,?,?,'{\"title\":\"Conservar planificación\"}','before')");
  session.run('u5','2026','5');session.run('u6','2026','6');session.run('u4','2026','4');session.run('old','2025','5');
  const insert=db.prepare("INSERT INTO evaluacion_registros VALUES(?,'s',?,'c',?,?,?,'Conservar comentario','before')");
  insert.run(1,'u5','hybrid_vigesimal',0,'Inicio');insert.run(2,'u6','hybrid_vigesimal',0,'C');
  insert.run(3,'u4','hybrid_vigesimal',0,'Inicio');insert.run(4,'u5','literal_traditional',0,'Logrado');
  insert.run(5,'u5','hybrid_vigesimal',null,'');insert.run(6,'old','hybrid_vigesimal',0,'Inicio');insert.run(7,'u5','hybrid_vigesimal',12,'Proceso');
  db.prepare("INSERT INTO armi_frontend_state VALUES('armi_hybrid_numeric_scores_v1',?,'before')").run(JSON.stringify({'u5::s::c':0,'u6::s::c':'0','u4::s::c':0,'old::s::c':0}));
  const before=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();db.close();
  assert.equal((await adjustUnit56Grades({databasePath:file})).zeroGrades,2);
  const result=await adjustUnit56Grades({databasePath:file,apply:true,backupRoot:path.join(root,'backups')});
  assert.equal(result.zeroGrades,2);assert.equal(result.roundedSessions,2);assert.equal(result.cacheUpdates,2);assert.ok(fs.existsSync(result.backup));
  const check=new Database(file);const after=check.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
  assert.deepEqual(after.slice(2),before.slice(2),'Other units, years, literals, blanks and nonzero grades must remain unchanged');
  assert.equal(after[0].numeric_score,5);assert.equal(after[1].numeric_score,5);assert.equal(after[0].observation,'Conservar comentario');
  const saved=JSON.parse(check.prepare("SELECT session_data FROM sesiones WHERE id_sesion='u5'").get().session_data);assert.equal(saved.title,'Conservar planificación');assert.equal(saved.numericAverageRounding,'nearest_integer');
  const cache=JSON.parse(check.prepare('SELECT value FROM armi_frontend_state').get().value);assert.equal(cache['u5::s::c'],5);assert.equal(cache['u4::s::c'],0);check.close();
  const backup=new Database(result.backup,{readonly:true});assert.deepEqual(backup.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(),before);backup.close();
  const again=await adjustUnit56Grades({databasePath:file,apply:true,backupRoot:path.join(root,'backups')});assert.equal(again.zeroGrades,0);assert.equal(again.roundedSessions,0);

  const calculator=createRegisterAggregation('hybrid_vigesimal'),student={id:'s',name:'Estudiante',estado:'A'};
  const makeSession=(id,unit,round)=>({id,year:'2026',areaId:'EPT',grade:'2do',section:'A',unitNumber:String(unit),sessionNumber:'1',bimesterLabel:'III',sessionData:{...(round?{numericAverageRounding:'nearest_integer'}:{}),sessionAssessmentModel:{rows:[1,2].map(i=>({id:`primary-${i}`,source:'primary',competencyName:'Emprendimiento',capacityName:'Crea propuestas',criterionText:`Criterio ${i}`}))}}});
  const records=(id,scores)=>scores.map((numeric_score,i)=>({student_id:'s',session_id:id,criteria_id:`primary-${i+1}`,level:'Inicio',grading_mode:'hybrid_vigesimal',numeric_score}));
  for(const [scores,score,code] of [[[10,11],10.5,'b'],[[13,14],13.5,'a'],[[17,18],17.5,'ad'],[[10,10.8],10.4,'c']]){
    const result=calculator.buildUnitRegisterAggregation({students:[student],sessions:[makeSession('s1',5,true)],records:records('s1',scores)}).students[0];
    assert.equal(result.overallNumericScore,score);assert.equal(result.overallCode,code);
  }
  const control=calculator.buildUnitRegisterAggregation({students:[student],sessions:[makeSession('s1',4,false)],records:records('s1',[10,11])}).students[0];assert.equal(control.overallNumericScore,10.5);assert.equal(control.overallCode,'c','Rounding must be opt-in, not global');
  const bimonthly=calculator.buildBimesterRegisterAggregation({students:[student],sessions:[makeSession('s1',5,true),makeSession('s2',6,true)],records:[...records('s1',[10,11]),...records('s2',[10.4,10.4])]}).students[0];
  assert.ok(Math.abs(bimonthly.overallNumericScore-10.45)<1e-10,'Retain the actual average in calculations and display');assert.equal(bimonthly.overallCode,'c');
  const pending=calculator.buildUnitRegisterAggregation({students:[student],sessions:[makeSession('s1',5,true)],records:records('s1',[10])}).students[0];assert.equal(pending.overallNumericScore,null);
  const book=buildStudentGradebook({student,sessions:[makeSession('s1',5,true)],records:records('s1',[10,11]),modeForArea:()=> 'hybrid_vigesimal',feedbackForSession:()=>({numericScore:10.5,literalGrade:'C',criteria:[{numericScore:10},{numericScore:11}]})});
  const displayed=book.areas[0].bimesters[2].units[0].sessions[0];assert.equal(displayed.numericScore,10.5);assert.equal(displayed.code,'b');
  console.log('OK: backed-up/idempotent U5/U6 zero-to-five adjustment, preserved blanks/literals/other scopes, opt-in rounded levels and full-precision averages.');
}finally{
  const resolved=path.resolve(root);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('armi-unit56-adjustment-'))fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
