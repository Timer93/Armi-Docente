import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {reviewNormalization} from './review-bimester-normalization.mjs';

const db=new Database(':memory:');
try {
  db.exec(`CREATE TABLE sesiones(id_sesion TEXT,year TEXT,unit_number TEXT,session_number TEXT,area_id TEXT,grade TEXT,section TEXT,session_data TEXT);
    CREATE TABLE db_estudiantes(id TEXT,estudiantes TEXT,estado TEXT,secc TEXT);
    CREATE TABLE student_deletion_tombstones(student_id TEXT,student_name TEXT);
    CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY,student_id TEXT,session_id TEXT,criteria_id TEXT,grading_mode TEXT,numeric_score REAL,level TEXT,observation TEXT);
    CREATE TABLE evaluacion_evidencias(id INTEGER,student_id TEXT,student_ids TEXT,session_id TEXT,criteria_id TEXT,is_latest INTEGER,teacher_comment TEXT);`);
  db.exec("INSERT INTO db_estudiantes VALUES('s','Estudiante de prueba','A','U')");
  const makeSession=(id,unit,number,capacity='Crea propuestas de valor',area='EPT',year='2026')=>{
    const rows=[{id:'primary-1',source:'primary',competencyName:'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.',capacityName:capacity,criterionText:'Evalúa las necesidades.'},
      {id:'transversal-1-1',source:'transversal',competencyName:'GESTIONA SU APRENDIZAJE DE MANERA AUTÓNOMA',capacityName:'Define metas de aprendizaje',criterionText:'Define metas.'}];
    db.prepare('INSERT INTO sesiones VALUES(?,?,?,?,?,?,?,?)').run(id,year,String(unit),String(number),area,'3ro','U',JSON.stringify({sessionAssessmentModel:{rows}}));
  };
  makeSession('previous',4,1);makeSession('different-capacity',4,2,'Aplica habilidades técnicas');makeSession('other-area',4,3,'Crea propuestas de valor','other');
  makeSession('old-year',4,1,'Crea propuestas de valor','EPT','2025');makeSession('current',5,2);makeSession('later',6,1);makeSession('second-candidate',5,3);
  const insert=(id,session,score,level,criterion='primary-1',mode='hybrid_vigesimal',comment='')=>db.prepare('INSERT INTO evaluacion_registros VALUES(?,?,?,?,?,?,?,?)').run(id,'s',session,criterion,mode,score,level,comment);
  insert(1,'previous',16,'A');insert(2,'different-capacity',16,'A');insert(3,'other-area',16,'A');insert(4,'old-year',16,'A');
  insert(5,'current',12,'B');insert(6,'current',14,'A','transversal-1-1');insert(7,'current',20,'AD','primary-1','literal_traditional','[Actividad HTML:prueba] 20/20');
  insert(8,'later',16,'A');insert(9,'second-candidate',14,'A');
  db.prepare('INSERT INTO evaluacion_evidencias VALUES(?,?,?,?,?,?,?)').run(1,'s','["s"]','current','primary-1',1,'Presentó el producto.');
  const before=db.serialize();
  const report=reviewNormalization(db);
  assert.equal(report.candidates,2,'Only EPT 12 and 14; transversals and other modes are references');
  assert.equal(report.appliedChanges,0,'High references and a generic description do not justify extra points');
  const candidate=report.reviews.find(row=>row.recordId===5);
  assert.deepEqual(candidate.history.map(row=>row.recordId),[1],'Only previous sessions, same student/year/area/grade/capacity');
  assert.deepEqual(candidate.transversal.map(row=>row.score),[14]);
  assert.equal(candidate.automatic[0].score,20);assert.equal(candidate.newScore,12);
  assert.equal(candidate.comments[0].text,'Presentó el producto.');
  assert.equal(report.highHybrid,0);assert.equal(report.highScores.length,1);assert.equal(report.highScores[0].automaticHtml,true);
  assert.deepEqual(db.serialize(),before,'Read-only analysis leaves all grades, descriptions and evidence untouched');
  console.log('OK: controlled normalization review, EPT identity, past capacity history, separate modes, no automatic upgrades and unchanged data.');
}finally{db.close();}
