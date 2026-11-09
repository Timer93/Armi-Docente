import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import Database from 'better-sqlite3';
import {resolveSessionCriterionRows} from '../backend/shared/sessionCriterionIdentity.js';
import {hybridGradeIssue} from '../backend/shared/hybridGradeIntegrity.js';

const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
const ownKey=row=>`${row.student_id}::${row.session_id}`;
const order=session=>Number(session.unit_number)*10000+Number(session.session_number);
const hasScore=row=>typeof row.numeric_score==='number'&&Number.isFinite(row.numeric_score);
const primary=row=>row?.source==='primary'&&normalize(row.competencyName).includes('gestiona proyectos de emprendimiento');

// This analysis is deliberately read-only. A rubric describes expected performance,
// not an individual finding. History, transversals, file counts and automatic HTML
// results cannot by themselves authorize a different EPT score.
export function reviewNormalization(db,{year='2026',units=[5,6]}={}) {
  const sessions=db.prepare('SELECT * FROM sesiones WHERE year=?').all(year).map(session=>{
    const data=JSON.parse(session.session_data||'{}');
    return {...session,data,rows:resolveSessionCriterionRows(data,data.sessionAssessmentModel?.rows||[])};
  });
  const sessionMap=new Map(sessions.map(session=>[session.id_sesion,session]));
  const scoped=sessions.filter(session=>units.includes(Number(session.unit_number)));
  const scopeIds=new Set(scoped.map(session=>session.id_sesion));
  const students=new Map(db.prepare('SELECT * FROM db_estudiantes').all().map(student=>[String(student.id),student]));
  const deleted=new Map(db.prepare('SELECT student_id,student_name FROM student_deletion_tombstones').all().map(student=>[String(student.student_id),student.student_name]));
  const all=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
  const records=all.filter(record=>scopeIds.has(record.session_id));
  const descriptors=record=>{
    const matches=(sessionMap.get(record.session_id)?.rows||[]).filter(row=>row.recordIds.includes(String(record.criteria_id)));
    return matches.length===1?matches[0]:null;
  };
  const hybrid=all.filter(record=>record.grading_mode==='hybrid_vigesimal'&&sessionMap.has(record.session_id));
  const byOwner=new Map();
  for(const record of all){const key=ownKey(record);if(!byOwner.has(key))byOwner.set(key,[]);byOwner.get(key).push(record);}
  const evidenceByOwner=new Map();
  for(const evidence of db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all()){
    if(!scopeIds.has(evidence.session_id)||evidence.is_latest===0)continue;
    let group=[];try{group=JSON.parse(evidence.student_ids||'[]').map(String);}catch{}
    for(const id of new Set([String(evidence.student_id||''),...group].filter(Boolean))){
      const key=`${id}::${evidence.session_id}`;
      if(!evidenceByOwner.has(key))evidenceByOwner.set(key,[]);
      evidenceByOwner.get(key).push(evidence);
    }
  }
  const identification=record=>{
    const student=students.get(String(record.student_id));
    const session=sessionMap.get(record.session_id);
    return {studentId:String(record.student_id),studentName:student?.estudiantes||deleted.get(String(record.student_id))||String(record.student_id),
      studentState:student?.estado||'Sin ficha activa',grade:session?.grade,section:student?.secc||session?.section,
      unit:session?.unit_number,session:session?.session_number,sessionId:record.session_id,criteriaId:record.criteria_id};
  };
  const candidates=records.filter(record=>record.grading_mode==='hybrid_vigesimal'&&[12,14].includes(record.numeric_score)&&primary(descriptors(record)));
  const reviews=candidates.map(record=>{
    const descriptor=descriptors(record),session=sessionMap.get(record.session_id);
    const own=byOwner.get(ownKey(record))||[];
    const transversal=own.filter(row=>row.grading_mode==='hybrid_vigesimal'&&descriptors(row)?.source==='transversal'&&hasScore(row)&&!hybridGradeIssue(row))
      .map(row=>({recordId:row.id,criteriaId:row.criteria_id,capacity:descriptors(row).capacityName,score:row.numeric_score}));
    const history=hybrid.filter(row=>String(row.student_id)===String(record.student_id)&&row.session_id!==record.session_id&&hasScore(row)&&!hybridGradeIssue(row)).filter(row=>{
      const other=sessionMap.get(row.session_id),otherDescriptor=descriptors(row);
      return String(other.area_id)===String(session.area_id)&&String(other.grade)===String(session.grade)&&order(other)<order(session)
        &&primary(otherDescriptor)&&normalize(otherDescriptor.capacityName)===normalize(descriptor.capacityName);
    }).sort((left,right)=>order(sessionMap.get(left.session_id))-order(sessionMap.get(right.session_id))).map(row=>({recordId:row.id,sessionId:row.session_id,unit:sessionMap.get(row.session_id).unit_number,session:sessionMap.get(row.session_id).session_number,criteriaId:row.criteria_id,score:row.numeric_score}));
    const attached=evidenceByOwner.get(ownKey(record))||[];
    const comments=[...own.filter(row=>row.grading_mode==='hybrid_vigesimal'&&row.observation?.trim()&&(row.criteria_id===record.criteria_id||row.criteria_id.startsWith('summary::primary::')))
      .map(row=>({type:'registro docente',id:row.id,criteriaId:row.criteria_id,text:row.observation})),
      ...attached.filter(row=>row.teacher_comment?.trim()).map(row=>({type:'comentario docente en evidencia',id:row.id,criteriaId:row.criteria_id,text:row.teacher_comment}))];
    const automatic=own.filter(row=>row.observation?.startsWith('[Actividad HTML:')).map(row=>({recordId:row.id,mode:row.grading_mode,score:row.numeric_score,text:row.observation}));
    const options=record.numeric_score===12?[13]:[15,16];
    return {...identification(record),recordId:record.id,score:record.numeric_score,level:record.level,options,
      capacity:descriptor.capacityName,criterion:descriptor.criterionText,levelDescriptors:descriptor.levelDescriptors||{},
      transversal,history,comments,automatic,evidenceIds:attached.map(row=>row.id),decision:'conservar y revisar',newScore:record.numeric_score,
      reason:`No hay una valoración individual verificable que justifique específicamente ${record.numeric_score} → ${options.join(' o ')}. La descripción general de la rúbrica y las referencias complementarias no bastan para determinar esos puntos adicionales.`};
  });
  const highScores=records.filter(row=>hasScore(row)&&row.numeric_score>16).map(record=>({...identification(record),recordId:record.id,
    mode:record.grading_mode,score:record.numeric_score,level:record.level,automaticHtml:record.observation?.startsWith('[Actividad HTML:')||false,
    description:record.observation,unchanged:true}));
  const scopedHybrid=records.filter(row=>row.grading_mode==='hybrid_vigesimal');
  return {createdAt:new Date().toISOString(),year,units,mode:'hybrid_vigesimal',target:'Criterios EPT; transversales solo como referencia',
    sessions:scoped.length,checkedRecords:records.length,hybridRecords:scopedHybrid.length,
    candidates:reviews.length,studentsForReview:new Set(reviews.map(row=>row.studentId)).size,
    candidates12:reviews.filter(row=>row.score===12).length,candidates14:reviews.filter(row=>row.score===14).length,
    appliedChanges:0,integrityIssues:scopedHybrid.filter(row=>hybridGradeIssue(row)).map(record=>({...identification(record),issue:hybridGradeIssue(record)})),
    historicalOrder:'Unidad y número de sesión; mismo año, estudiante, área, grado y capacidad. Se excluyen sesiones posteriores.',
    highScores,highHybrid:highScores.filter(row=>row.mode==='hybrid_vigesimal').length,reviews};
}

export function writeNormalizationReport(report,out,backupPath) {
  fs.mkdirSync(out,{recursive:true});
  const text=(file,lines)=>fs.writeFileSync(path.join(out,file),'\ufeff'+lines.join('\r\n'),'utf8');
  fs.writeFileSync(path.join(out,'analisis-completo.json'),JSON.stringify({...report,backup:backupPath},null,2));
  const lines=['REVISIÓN CONTROLADA — III BIMESTRE 2026 — UNIDADES 5 Y 6','',
    `Respaldo completo: ${backupPath}`,`Sesiones: ${report.sessions}. Registros híbridos revisados: ${report.hybridRecords}.`,
    `Ajustes aplicados: ${report.appliedChanges}. No se ha modificado ninguna calificación.`,
    `Candidatos EPT: ${report.candidates12} con 12 y ${report.candidates14} con 14. Agrupados en ${report.studentsForReview} estudiantes para evitar revisiones duplicadas.`,
    '', 'Se mantienen 10, 11, 13, 15 y 16 y las demás notas. Las transversales no se modifican.',
    'No se asignan puntos por promedio transversal, por historial, por cantidad de archivos o por la descripción general de una rúbrica.',
    'Las referencias ayudan a revisar; no sustituyen la evaluación del desempeño EPT en esa sesión.',
    'Se requiere una valoración individual que permita distinguir 12 de 13, o 14 de 15/16. No se encontró esa justificación específica en los textos revisados.',
    'No se abren casos para las notas que las reglas ordenan conservar. Todos los candidatos sin justificación están incluidos a continuación.',
    '', 'REFERENCIAS: notas híbridas del mismo estudiante y capacidad; sesiones anteriores según unidad/número. No se usan notas futuras.',
    'Las observaciones de sesión se identifican como tales: pueden referirse a varios criterios, no necesariamente a uno solo.',
    '', `SUPERIORES A 16: ${report.highHybrid} en modo híbrido; ${report.highScores.length} entre todos los modos. Ver superiores-a-16.txt.`,
    '', 'CASOS AGRUPADOS POR ESTUDIANTE'];
  const grouped=Map.groupBy(report.reviews,row=>`${row.grade}::${row.section}::${row.studentId}`);
  const groups=[...grouped.values()].sort((a,b)=>[a[0].grade,a[0].section,a[0].studentName].join(' ').localeCompare([b[0].grade,b[0].section,b[0].studentName].join(' '),'es',{numeric:true}));
  for(const group of groups){
    const student=group[0];lines.push('',`${student.studentName} — ${student.grade} ${student.section} — ID ${student.studentId}`);
    for(const item of group.sort((a,b)=>Number(a.unit)-Number(b.unit)||Number(a.session)-Number(b.session))){
      lines.push(`  U${item.unit} S${item.session} / ${item.criteriaId}: conservar ${item.score}; posible ${item.options.join(' o ')} solo tras revisión.`,
        `    Capacidad: ${item.capacity}.`,
        `    Criterio: ${item.criterion}`,
        `    Transversales de la sesión: ${item.transversal.map(row=>`${row.capacity}: ${row.score}`).join('; ')||'Sin notas numéricas utilizables'}.`,
        `    Historial de la misma capacidad: ${item.history.map(row=>`U${row.unit} S${row.session}: ${row.score}`).join('; ')||'Sin registros anteriores utilizables'}.`,
        `    Comentarios docentes: ${item.comments.map(row=>`[${row.type} ${row.id}, ${row.criteriaId}] ${row.text.replace(/\s+/g,' ')}`).join(' / ')||'Sin valoración individual registrada'}.`,
        `    Motivo: ${item.reason}`);
      if(item.automatic.length)lines.push(`    Actividades HTML en otro modo (no equivalen a la nota manual EPT): ${item.automatic.map(row=>`${row.score} (${row.mode}, registro ${row.recordId})`).join('; ')}.`);
    }
  }
  if(report.integrityIssues.length)lines.push('', 'INCONSISTENCIAS PREEXISTENTES (NO MODIFICADAS)',...report.integrityIssues.map(row=>`${row.studentName}, U${row.unit} S${row.session}, ${row.criteriaId}: ${row.issue}`));
  text('revision-para-bloc-de-notas.txt',lines);
  text('superiores-a-16.txt',['NOTAS SUPERIORES A 16 — III BIMESTRE 2026 — UNIDADES 5 Y 6','',
    `Modo híbrido actual: ${report.highHybrid}. Todos los modos: ${report.highScores.length}.`,
    `Resultados identificados como automáticos HTML: ${report.highScores.filter(row=>row.automaticHtml).length}. Ninguno se modificó.`,
    'Los modos guardan registros separados. Estos resultados no se mezclan automáticamente con la calificación manual híbrida.', '',
    ...report.highScores.map(row=>`${row.studentName} | ${row.grade} ${row.section} | U${row.unit} S${row.session} | ${row.criteriaId} | ${row.score} / ${row.level} | ${row.mode} | ${row.automaticHtml?'Actividad HTML automática':'Otro origen'} | registro ${row.recordId}\r\n  ${String(row.description||'').replace(/\s+/g,' ')}`)]);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{db:{type:'string'},out:{type:'string'},backup:{type:'string'}}});
  if(!values.db||!values.out)throw new Error('Use --db respaldo.db --out carpeta [--backup respaldo.db]. Solo lectura.');
  const db=new Database(values.db,{readonly:true,fileMustExist:true});
  try{
    const report=reviewNormalization(db);writeNormalizationReport(report,values.out,values.backup||values.db);
    const {reviews,highScores,integrityIssues,...summary}=report;
    console.log(JSON.stringify({...summary,highOtherModes:highScores.length-report.highHybrid,integrityIssues:integrityIssues.length,report:path.resolve(values.out,'revision-para-bloc-de-notas.txt')},null,2));
  }finally{db.close();}
}
