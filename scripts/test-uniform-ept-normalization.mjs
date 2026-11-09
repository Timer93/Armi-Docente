import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {simulateUniformEpt,normalizeAuxiliaryScore,UNIFORM_RULES} from './simulate-uniform-ept-normalization.mjs';
import {createRegisterAggregation} from '../backend/shared/registerAggregation.generated.js';

const calculator=createRegisterAggregation('hybrid_vigesimal');
for(const [from,to] of Object.entries(UNIFORM_RULES)){
  assert.equal(normalizeAuxiliaryScore(Number(from)),to);
  assert.equal(calculator.numericScoreToRegisterLevel(Number(from)),calculator.numericScoreToRegisterLevel(to));
}
for(const value of [null,undefined,'',0,2,8,10.5,13.5,17,18,19,20])assert.equal(normalizeAuxiliaryScore(value),value);

const db=new Database(':memory:');
try{
  db.exec(`CREATE TABLE sesiones(id_sesion TEXT,year TEXT,area_id TEXT,grade TEXT,section TEXT,unit_number TEXT,session_number TEXT,session_data TEXT);
    CREATE TABLE db_estudiantes(id TEXT,estudiantes TEXT,grado TEXT,secc TEXT,estado TEXT);
    CREATE TABLE student_deletion_tombstones(student_id TEXT,student_name TEXT);
    CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY,student_id TEXT,session_id TEXT,criteria_id TEXT,grading_mode TEXT,numeric_score REAL,level TEXT);`);
  const model={numericAverageRounding:'nearest_integer',sessionAssessmentModel:{rows:[
    {id:'primary-1',source:'primary',competencyName:'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.',capacityName:'Crea propuestas de valor',criterionText:'Criterio de EPT'},
    {id:'transversal-1-1',source:'transversal',competencyName:'GESTIONA SU APRENDIZAJE DE MANERA AUTÓNOMA',capacityName:'Define metas de aprendizaje',criterionText:'Criterio transversal'}]}};
  const session=(id,year,unit)=>db.prepare('INSERT INTO sesiones VALUES(?,?,?,?,?,?,?,?)').run(id,year,'EPT','3ro','U',String(unit),'1',JSON.stringify(model));
  session('u5','2026',5);session('u6','2026',6);session('u4','2026',4);session('old-year','2025',5);
  let nextId=1;
  const record=(id,student,session,criterion,score,mode='hybrid_vigesimal',level=calculator.numericScoreToRegisterLevel(score))=>db.prepare('INSERT INTO evaluacion_registros VALUES(?,?,?,?,?,?,?)').run(id,student,session,criterion,mode,score,level);
  const people=[['c',[5,15],'A'],['b',[12,14],'A'],['a',[14,16],'A'],['constant',[10,11],'A'],['pending',[12,null],'A'],['inactive',[14,15],'R']];
  for(const [id,scores,state] of people){
    db.prepare('INSERT INTO db_estudiantes VALUES(?,?,?,?,?)').run(id,id,'3ro','U',state);
    for(const [index,session] of ['u5','u6'].entries()){
      if(scores[index]!==null)record(nextId++,id,session,'primary-1',scores[index]);
      record(nextId++,id,session,'transversal-1-1',12);
    }
  }
  db.exec("INSERT INTO student_deletion_tombstones VALUES('deleted','Deleted student')");
  record(nextId++,'deleted','u5','primary-1',11,'hybrid_vigesimal','');
  record(999,'c','u6','primary-1',20,'literal_traditional','AD');
  record(1000,'c','u4','primary-1',12);record(1001,'c','old-year','primary-1',12);
  const before=db.serialize();
  const report=simulateUniformEpt(db);
  assert.equal(report.summary.numericEptGrades,12);
  assert.equal(report.summary.normalizedGrades,7);
  assert.equal(report.summary.studentsWithNormalizedGrades,5);
  assert.equal(report.summary.studentsWithNumericCompetencyChange,3);
  assert.equal(report.periodCounts.III.evaluated,4);
  assert.equal(report.periodCounts.III.unchanged,2);
  assert.equal(report.periodCounts.III.cToB,1);
  assert.equal(report.periodCounts.III.bToA,1);
  assert.equal(report.periodCounts.III.aToAd,0);
  assert.equal(report.periodCounts.III.decreased,0);
  assert.equal(report.periodCounts.III.neUnchanged,2,'Pending and inactive remain NE, distinct from C/B/A/AD');
  const comparison=report.comparisons.find(row=>row.studentId==='c'&&row.period==='III');
  assert.equal(comparison.before.score,10);assert.equal(comparison.after.score,10.5,'Keep actual average; round only for the level');
  assert.equal(comparison.after.code,'b');
  assert.ok(report.recordChanges.every(row=>![999,1000,1001].includes(row.recordId)),'Do not change other modes, units or years');
  assert.equal(report.recordIssues.length,1);assert.equal(report.recordIssues[0].studentName,'Deleted student');
  assert.equal(report.summary.individualLiteralChanges,0);
  assert.ok(report.transversalChecks.every(row=>row.unchanged));
  assert.deepEqual(db.serialize(),before,'No originals or definitive results modified');
  console.log('OK: uniform mapping, real literal ranges and consolidation, C→B/B→A, original decimals, separate NE, unchanged transversals, all years/units/modes protected and read-only data.');
}finally{db.close();}
