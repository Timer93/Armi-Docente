import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import Database from 'better-sqlite3';
import {hybridGradeIssue} from '../backend/shared/hybridGradeIntegrity.js';

// Read-only: never changes a grade or infers a score from an attached file.
const {values} = parseArgs({options:{db:{type:'string'},before:{type:'string'},out:{type:'string'}}});
if (!values.db || !values.out) throw new Error('Use --db archivo.db --out carpeta [--before respaldo.db]');
const db = new Database(values.db, {readonly:true, fileMustExist:true});
const before = values.before ? new Database(values.before, {readonly:true, fileMustExist:true}) : null;
try {
  const records = db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal'").all();
  const students = new Map(db.prepare('SELECT * FROM db_estudiantes').all().map(s=>[String(s.id),s]));
  const deletedStudents = new Map(db.prepare('SELECT student_id,student_name FROM student_deletion_tombstones').all().map(s=>[String(s.student_id),s.student_name]));
  const evidence = db.prepare('SELECT student_id,student_ids,session_id,criteria_id FROM evaluacion_evidencias').all();
  const old = before?.prepare('SELECT level,numeric_score,updated_at FROM evaluacion_registros WHERE student_id=? AND session_id=? AND criteria_id=? AND grading_mode=?');
  const issues = records.filter(r=>hybridGradeIssue(r)).map(r=>{
    const student=students.get(String(r.student_id));
    const attached = evidence.filter(e=>{
      if(e.session_id!==r.session_id) return false;
      let group=[];try{group=JSON.parse(e.student_ids||'[]').map(String);}catch{}
      return String(e.student_id)===String(r.student_id)||group.includes(String(r.student_id));
    });
    return {...r,studentName:student?.estudiantes || deletedStudents.get(String(r.student_id)) || String(r.student_id),
      deletedStudent:!student && deletedStudents.has(String(r.student_id)),
      issue:hybridGradeIssue(r),sessionEvidenceCount:attached.length,
      previous:old?.get(r.student_id,r.session_id,r.criteria_id,r.grading_mode)||null};
  });
  fs.mkdirSync(values.out,{recursive:true});
  fs.writeFileSync(path.join(values.out,'inconsistencias.json'),JSON.stringify({createdAt:new Date().toISOString(),readOnly:true,totalChecked:records.length,issues},null,2));
  const escape=value=>String(value??'').replace(/\|/g,'/').replace(/[\r\n]+/g,' ');
  const lines=['# Revisión de notas híbridas','',`Se revisaron ${records.length} registros. Se encontraron ${issues.length} inconsistencias. No se modificó ningún dato.`,
    '', 'Los adjuntos se cuentan por estudiante y sesión; no prueban la calificación de un criterio. La nota exacta requiere revisión docente.',
    '', '| Estudiante | Sesión | Criterio | Letra actual | Número actual | Antes: letra / número | Evidencias en sesión |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...issues.map(r=>`| ${[r.studentName+(r.deletedStudent?' (eliminada del padrón)':''),r.session_id,r.criteria_id,r.level,r.numeric_score,r.previous?`${r.previous.level} / ${r.previous.numeric_score??'sin nota'}`:'Sin registro en respaldo',r.sessionEvidenceCount].map(escape).join(' | ')} |`)];
  fs.writeFileSync(path.join(values.out,'revision-notas.md'),lines.join('\n'));
  console.log(JSON.stringify({totalChecked:records.length,issues:issues.length,report:path.resolve(values.out,'revision-notas.md')}));
}finally{db.close();before?.close();}
