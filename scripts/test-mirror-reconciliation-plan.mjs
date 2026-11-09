import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { planReconciliation } from './plan-mirror-reconciliation.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-reconciliation-plan-'));
const source=path.join(root,'original.db'),snapshot=path.join(root,'snapshot'),evidenceRoot=path.join(root,'files');
const device='584392cf9397665d';
const db=new Database(source);
try {
  db.exec(`
    CREATE TABLE db_estudiantes(id INTEGER PRIMARY KEY,dni TEXT,estudiantes TEXT,grado TEXT,secc TEXT,estado TEXT);
    CREATE TABLE evaluacion_instrumentos(id INTEGER PRIMARY KEY,year TEXT,area_id TEXT,grade TEXT,section TEXT,type TEXT,name TEXT,structure TEXT);
    CREATE TABLE sesiones(id INTEGER PRIMARY KEY,id_sesion TEXT,year TEXT,area_id TEXT,grade TEXT,section TEXT,unit_number TEXT,session_number TEXT,session_data TEXT);
    CREATE TABLE evaluacion_registros(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id TEXT,session_id TEXT,unit_id TEXT,instrument_id INTEGER,criteria_id TEXT,grading_mode TEXT,level TEXT,numeric_score REAL,observation TEXT,updated_at TEXT);
    CREATE TABLE evaluacion_conclusiones(id INTEGER PRIMARY KEY,year TEXT,area_id TEXT,grade TEXT,section TEXT,scope_type TEXT,scope_value TEXT,student_id TEXT,competency_key TEXT,conclusion_text TEXT,updated_at TEXT);
    CREATE TABLE asistencia_registros(id INTEGER PRIMARY KEY AUTOINCREMENT,attendance_date TEXT,grade TEXT,section TEXT,student_id TEXT,student_name TEXT,dni TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE evaluacion_evidencias(id INTEGER PRIMARY KEY AUTOINCREMENT,evidence_key TEXT,student_id TEXT,student_ids TEXT,relative_path TEXT,file_size INTEGER,updated_at TEXT);
    INSERT INTO db_estudiantes VALUES(11,'70000011','ANA TEST','4to','U','A'),(22,'70000022','BRUNO TEST','4to','U','A');
    INSERT INTO evaluacion_registros VALUES(1,'11','s5','u5',NULL,'primary-1','hybrid_vigesimal','C',10,'Verificada','2026-10-18T12:00:00Z');
    INSERT INTO evaluacion_conclusiones VALUES(1,'2026','ept','4to','U','bimester','III','11','ept','Conclusion validada','2026-10-18T12:00:00Z');
  `);
  const data={competenciaPrio:{comp:'Emprendimiento',cap:'Crea propuestas',des:'Propone soluciones'},sessionAssessmentModel:{rows:[{id:'primary-1',source:'primary',competencyName:'Emprendimiento',capacityName:'Crea propuestas',criterionText:'Propone soluciones'}]}};
  for(const [i,unit] of [[5,'5'],[6,'6'],[7,'7']]) db.prepare("INSERT INTO sesiones VALUES(?,?,'2026','ept','4to','U',?,'1',?)").run(i,`s${i}`,unit,JSON.stringify(data));
  const beforeGrades=db.prepare('SELECT * FROM evaluacion_registros').all(),beforeConclusions=db.prepare('SELECT * FROM evaluacion_conclusiones').all();
  db.close();
  fs.mkdirSync(path.join(snapshot,'eventos-resguardados',device),{recursive:true});
  fs.mkdirSync(path.join(snapshot,'catalogos-recuperacion'),{recursive:true});fs.mkdirSync(path.join(snapshot,'tombstones'),{recursive:true});fs.mkdirSync(evidenceRoot);
  fs.writeFileSync(path.join(evidenceRoot,'ana.txt'),'Evidencia Ana');
  const roster=[{id:22,dni:'70000011',estudiantes:'ANA TEST',grado:'4to',secc:'U'},{id:11,dni:'70000022',estudiantes:'BRUNO TEST',grado:'4to',secc:'U'}];
  fs.writeFileSync(path.join(snapshot,'catalogos-recuperacion',device+'.json'),JSON.stringify({tables:{db_estudiantes:roster.map(row=>({row})),evaluacion_evidencias:[]}}));
  const operation=(table,row,columns)=>({table,row,action:'upsert',keyColumns:columns,keyValues:columns.map(column=>row[column]),key:JSON.stringify([columns,columns.map(column=>row[column])])});
  const grade=(session,score)=>operation('evaluacion_registros',{student_id:'22',session_id:session,unit_id:session==='s5'?'u5':'u7',instrument_id:null,criteria_id:'primary-1',grading_mode:'hybrid_vigesimal',level:'A',numeric_score:score,observation:'Nueva',updated_at:'2026-10-19T12:00:00Z'},['student_id','session_id','criteria_id','grading_mode']);
  const operations=[grade('s5',16),grade('s7',15),
    operation('asistencia_registros',{student_id:'22',student_name:'ANA TEST',dni:'70000011',attendance_date:'2026-10-19',grade:'4to',section:'U',status:'P',updated_at:'2026-10-19T12:00:00Z'},['attendance_date','grade','section','student_id']),
    operation('evaluacion_evidencias',{student_id:'22',student_ids:'["22","11"]',evidence_key:'ana-evidence',relative_path:'ana.txt',file_size:13,updated_at:'2026-10-19T12:00:00Z'},['evidence_key']),
    operation('evaluacion_conclusiones',{year:'2026',area_id:'ept',grade:'4to',section:'U',scope_type:'bimester',scope_value:'III',student_id:'22',competency_key:'ept',conclusion_text:'Texto antiguo de otra copia',updated_at:'2026-10-19T12:00:00Z'},['year','area_id','grade','section','scope_type','scope_value','student_id','competency_key'])];
  const batch={deviceId:device,batchId:'test',createdAt:'2026-10-19T12:00:00Z',sequence:1,operations};
  const contents=JSON.stringify(batch);fs.writeFileSync(path.join(snapshot,'eventos-resguardados',device,'test.json'),contents);
  fs.writeFileSync(path.join(snapshot,'eventos-resguardados.json'),JSON.stringify({files:[{device,name:'test.json',sha256:crypto.createHash('sha256').update(contents).digest('hex')}]}));
  const output=path.join(root,'proposal');
  const result=await planReconciliation({source,snapshot,output,evidenceRoot});
  assert.equal(result.originalGradeChanges,0);assert.equal(result.originalConclusionsChanged,false);assert.equal(result.thirdBimesterUnchanged,true);
  assert.equal(result.byDecision.evaluacion_registros.insert,1);assert.equal(result.byDecision.asistencia_registros.insert,1);assert.equal(result.byDecision.evaluacion_evidencias.insert,1);
  const original=new Database(source,{readonly:true}),candidate=new Database(path.join(output,'candidate.db'),{readonly:true});
  try {
    assert.deepEqual(original.prepare('SELECT * FROM evaluacion_registros').all(),beforeGrades);
    assert.deepEqual(original.prepare('SELECT * FROM evaluacion_conclusiones').all(),beforeConclusions);
    assert.deepEqual(candidate.prepare('SELECT * FROM evaluacion_registros WHERE id=1').all(),beforeGrades);
    assert.equal(candidate.prepare("SELECT student_id FROM evaluacion_registros WHERE session_id='s7'").get().student_id,'11');
    assert.equal(candidate.prepare('SELECT student_id FROM asistencia_registros').get().student_id,'11');
    assert.deepEqual(JSON.parse(candidate.prepare('SELECT student_ids FROM evaluacion_evidencias').get().student_ids),['11','22']);
    assert.deepEqual(candidate.prepare('SELECT * FROM evaluacion_conclusiones').all(),beforeConclusions);
  } finally {original.close();candidate.close();}
  // An altered event must fail verification before any candidate reconciliation.
  fs.appendFileSync(path.join(snapshot,'eventos-resguardados',device,'test.json'),' ');
  await assert.rejects(planReconciliation({source,snapshot,output:path.join(root,'tampered'),evidenceRoot}),/paquete resguardado cambio/);
  console.log('OK: isolated candidate, crossed IDs, preserved grades/conclusions, real motor parity, files and source hash verification.');
} finally {
  if(db.open) db.close();fs.rmSync(root,{recursive:true,force:true});
}
