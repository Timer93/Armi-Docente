import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {buildProposal,inspectActivity} from './build-normalization-html-proposal.mjs';

const db=new Database(':memory:');
try {
  db.exec(`CREATE TABLE sesiones(id_sesion TEXT,year TEXT,unit_number TEXT,session_number TEXT,area_id TEXT,grade TEXT,section TEXT,session_data TEXT);
    CREATE TABLE db_estudiantes(id TEXT,estudiantes TEXT,estado TEXT,secc TEXT,grado TEXT);
    CREATE TABLE student_deletion_tombstones(student_id TEXT,student_name TEXT);
    CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY,student_id TEXT,session_id TEXT,criteria_id TEXT,grading_mode TEXT,numeric_score REAL,level TEXT,observation TEXT);
    CREATE TABLE evaluacion_evidencias(id INTEGER,student_id TEXT,student_ids TEXT,session_id TEXT,criteria_id TEXT,is_latest INTEGER,teacher_comment TEXT);
    CREATE TABLE interactive_activity_results(id INTEGER,session_id TEXT,activity_id TEXT,scope_type TEXT,scope_key TEXT,student_id TEXT,student_ids TEXT,score REAL,answers_summary TEXT,completed_at TEXT,reset_at TEXT);
    CREATE TABLE interactive_activity_attempts(session_id TEXT,activity_id TEXT,scope_type TEXT,scope_key TEXT,status TEXT,checkpoint_json TEXT);`);
  db.exec("INSERT INTO db_estudiantes VALUES('142','Student','A','A','5to')");
  const activityId='html-1791174795853-mj0uzp';
  const questions=Array.from({length:10},(_,i)=>({id:`r${i+1}`,area:'Decisions',pregunta:'What would you do?',opciones:['Appropriate action','Other action'],correcta:0}));
  const activity={id:activityId,title:'Cooperation',criterionId:'primary-1',html:`<html><body><script>globalThis.__executedUnsafeHtml=true; const banco=${JSON.stringify(questions)};</script></body></html>`};
  const rows=[{id:'primary-1',source:'primary',competencyName:'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.',capacityName:'Trabaja cooperativamente para lograr objetivos y metas',criterionText:'Organiza roles, prioridades y seguimiento.'},
    {id:'transversal-1-1',source:'transversal',competencyName:'GESTIONA SU APRENDIZAJE DE MANERA AUTÓNOMA',capacityName:'Define metas de aprendizaje',criterionText:'Define metas.'}];
  const session=(id,unit,num,activities=[])=>db.prepare('INSERT INTO sesiones VALUES(?,?,?,?,?,?,?,?)').run(id,'2026',String(unit),String(num),'EPT','5to','A y B',JSON.stringify({numericAverageRounding:'nearest_integer',sessionAssessmentModel:{rows},interactiveActivities:activities}));
  session('previous',5,3);session('current',6,6,[activity]);session('no-result',6,7);
  const insert=(id,s,c,n,level,mode='hybrid_vigesimal')=>db.prepare('INSERT INTO evaluacion_registros VALUES(?,?,?,?,?,?,?,?)').run(id,'142',s,c,mode,n,level,'');
  insert(1,'previous','primary-1',13,'B');insert(2,'previous','transversal-1-1',14,'A');
  insert(180668,'current','primary-1',14,'A');insert(3,'current','transversal-1-1',14,'A');
  insert(999,'no-result','primary-1',12,'B');insert(4,'no-result','transversal-1-1',12,'B');
  insert(999999,'current','primary-1',20,'AD','literal_traditional'); // Must not override the actual hybrid 14.
  db.prepare('INSERT INTO interactive_activity_results VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(152,'current',activityId,'individual','142','142','["142"]',20,'10 correct','2026-10-01',null);
  const checkpoint={state:{finalizado:true,respuestas:Object.fromEntries(questions.map(q=>[q.id,{elegida:0,correcta:true}]))},score:20,maxScore:20};
  db.prepare('INSERT INTO interactive_activity_attempts VALUES(?,?,?,?,?,?)').run('current',activityId,'individual','142','completed',JSON.stringify(checkpoint));
  const assessments={activities:{[activityId]:{classification:'Partial direct evidence'}},cases:{180668:{newScore:15,reason:'Reviewed individual evidence'}}};
  const before=db.serialize();
  const report=buildProposal(db,assessments);
  assert.equal(report.summary.proposed,1);assert.equal(report.summary.kept,1);
  assert.equal(report.candidates.find(r=>r.recordId===999).newScore,12,'No HTML result must not produce an automatic upgrade');
  const impact=report.impacts.find(row=>row.period==='U6'&&row.source==='primary');
  assert.equal(impact.before.score,13,'Do not mix literal HTML grade 20 into hybrid consolidation');
  assert.equal(impact.after.score,13.5);assert.equal(impact.after.code,'a');
  assert.equal(report.candidates.find(r=>r.recordId===180668).verifiedDecisions.length,10);
  assert.equal(globalThis.__executedUnsafeHtml,undefined,'HTML source is parsed, never executed');
  assert.deepEqual(db.serialize(),before,'Proposal and simulation do not modify any stored data');
  checkpoint.state.respuestas.r2.correcta=false;
  db.prepare('UPDATE interactive_activity_attempts SET checkpoint_json=?').run(JSON.stringify(checkpoint));
  assert.throws(()=>buildProposal(db,assessments),'A global 20 is not enough when an underlying core decision is wrong');
  checkpoint.state.respuestas.r2.correcta=true;
  db.prepare('UPDATE interactive_activity_attempts SET checkpoint_json=?').run(JSON.stringify(checkpoint));
  db.exec("UPDATE interactive_activity_results SET reset_at='2026-10-02'");
  assert.throws(()=>buildProposal(db,assessments),'A reset attempt cannot support a current recommendation');
  assert.equal(inspectActivity(activity).banks[0].items.length,10);
  console.log('OK: same-session individual evidence, no automatic high-score upgrades, verified decisions, separate modes, exact ARMI simulation, reset protection and read-only database.');
}finally{db.close();}
