import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createSyncReferenceIdentity } from '../backend/syncReferenceIdentity.js';
import { createRegisterAggregation } from '../backend/shared/registerAggregation.generated.js';
import { reconcileSessionCapacities } from '../backend/shared/sessionCapacityReconciliation.js';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const fileHash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = value => '"'+String(value).replaceAll('"','""')+'"';
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const timestamp = value => Date.parse(String(value || '').replace(' ','T').replace(/(?<=\d)$/, 'Z')) || 0;
const equal = (a,b) => a==null && b==null || String(a??'')===String(b??'');
const ignored = new Set(['id','updated_at','__sync_key','__studentIdentity','file_path']);
const known = new Set(['sesiones','db_estudiantes','asistencia_registros','asistencia_rostros',
  'evaluacion_registros','evaluacion_evidencias','evaluacion_conclusiones','interactive_activity_attempts',
  'interactive_activity_results','student_forum_drafts','evaluacion_ventanas_entrega','armi_frontend_state']);

export function consolidatedThirdBimester(db) {
  const students=db.prepare('SELECT * FROM db_estudiantes').all().map(row=>({id:String(row.id),name:row.estudiantes,grade:row.grado,section:row.secc,estado:row.estado}));
  const sessions=db.prepare("SELECT * FROM sesiones WHERE year='2026' AND unit_number IN ('5','6')").all().map(row=>({
    id:row.id_sesion,year:row.year,areaId:row.area_id,grade:row.grade,section:row.section,
    unitNumber:row.unit_number,sessionNumber:row.session_number,bimesterLabel:'III',sessionData:JSON.parse(row.session_data || '{}') }));
  const records=db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal'").all();
  const motor=createRegisterAggregation('hybrid_vigesimal');
  return [...new Set(students.map(student=>`${student.grade}::${student.section}`))].sort().map(group=>{
    const [grade,section]=group.split('::');
    const bundle={students:students.filter(student=>student.grade===grade && student.section===section),records,
      sessions:sessions.filter(session=>session.grade===grade && session.section.split(/,| y | Y |\//).map(value=>value.trim()).includes(section))};
    const result=motor.buildBimesterRegisterAggregation(bundle);
    return {grade,section,students:result.students};
  });
}

// This command only builds a separate candidate database. There is intentionally
// no option to write back to the installed database or publish to Drive.
export async function planReconciliation({source,snapshot,output,evidenceRoot}) {
  for (const input of [source,snapshot]) if (!fs.existsSync(input)) throw new Error(`Falta origen: ${input}`);
  if (fs.existsSync(output)) throw new Error('La carpeta de salida debe ser nueva.');
  fs.mkdirSync(output,{recursive:true});
  const original=new Database(source,{readonly:true,fileMustExist:true});
  const backup=path.join(output,'before.db');
  try { await original.backup(backup); } finally { original.close(); }
  const candidate=path.join(output,'candidate.db'); fs.copyFileSync(backup,candidate);
  const db=new Database(candidate);
  try {
    const gradesBefore=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
    const conclusionsBefore=db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all();
    const thirdBefore=consolidatedThirdBimester(db);
    const manifest=read(path.join(snapshot,'eventos-resguardados.json'));
    const inputHashes=[];
    const batches=manifest.files.map(file=>{
      const target=path.join(snapshot,'eventos-resguardados',file.device,file.name);
      const actual=fileHash(target); if(actual!==file.sha256) throw new Error(`El paquete resguardado cambio: ${file.name}`);
      inputHashes.push({device:file.device,name:file.name,sha256:actual}); return read(target);
    }).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)) || a.sequence-b.sequence);
    const sourceDevice='584392cf9397665d';
    const incoming=batches.filter(batch=>batch.deviceId===sourceDevice);
    const recovery=read(path.join(snapshot,'catalogos-recuperacion',sourceDevice+'.json'));
    const sourceRows=Object.fromEntries(Object.entries(recovery.tables).map(([table,records])=>[table,records.map(record=>record.row)]));
    const identity=createSyncReferenceIdentity(db);
    const references=identity.legacyCatalog(sourceRows);
    const instruments=db.prepare('SELECT * FROM evaluacion_instrumentos').all();
    const instrumentProofs=[];
    for(const batch of incoming) for(const operation of batch.operations) {
      if(operation.table!=='sesiones' || !operation.row?.session_data) continue;
      const row=operation.row, template=JSON.parse(row.session_data).instrumentoTemplate;
      if(!template?.id || !template.structure) continue;
      const matches=instruments.filter(item=>String(item.year)===String(row.year) && String(item.area_id)===String(row.area_id)
        && item.type===template.type && item.name===template.name && digest(JSON.parse(item.structure))===digest(template.structure));
      if(matches.length!==1) continue;
      const target=matches[0], token=identity.catalog().instruments[String(target.id)].token;
      if(references.instruments[String(template.id)] && references.instruments[String(template.id)].token!==token) throw new Error('Instrumento de origen contradictorio.');
      references.instruments[String(template.id)]={token};
      instrumentProofs.push({sourceId:template.id,targetId:target.id,session:row.id_sesion,name:target.name,structureSha256:digest(template.structure)});
    }
    const schemas=new Map(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({name})=>[name,db.prepare(`PRAGMA table_info(${quote(name)})`).all()]));
    const review=[],latest=new Map(),retainedFrontend=[];
    for(const batch of incoming) for(const operation of batch.operations) {
      const meta={batch:batch.batchId,createdAt:batch.createdAt,table:operation.table,action:operation.action,sourceKey:operation.key};
      if(!known.has(operation.table)) {review.push({...meta,reason:'Tabla no incluida en esta conciliacion.'});continue;}
      if(operation.table==='armi_frontend_state') {retainedFrontend.push(meta);continue;}
      if(operation.action==='delete' && operation.table!=='evaluacion_evidencias') {review.push({...meta,reason:'Borrado antiguo conservado para revision; no se elimina ninguna nota.',source:operation});continue;}
      try {
        const sourceRow=operation.row || Object.fromEntries(operation.keyColumns.map((column,index)=>[column,operation.keyValues[index]]));
        const portable=identity.portable(operation.table,sourceRow,references);
        let row=identity.local(operation.table,portable,references);
        let columns=operation.keyColumns;
        if(operation.table==='evaluacion_registros') {
          if(!row.grading_mode) throw new Error('Nota sin modalidad explicita.');
          columns=['student_id','session_id','criteria_id','grading_mode'];
          const session=db.prepare('SELECT grade,section FROM sesiones WHERE id_sesion=?').get(row.session_id);
          const student=db.prepare('SELECT grado,secc FROM db_estudiantes WHERE id=?').get(row.student_id);
          if(!session || !student || session.grade!==student.grado || !session.section.split(/,| y | Y |\//).map(value=>value.trim()).includes(student.secc)) throw new Error('La identidad no coincide con el grupo de la sesion.');
        }
        if(operation.table==='db_estudiantes') {
          const local=identity.localOperation({...operation,row:portable}).keyValues[0];
          const matching=db.prepare('SELECT id FROM db_estudiantes WHERE dni=?').all(String(sourceRow.dni));
          if(matching.length!==1) throw new Error('Estudiante sin coincidencia unica por DNI.');
          columns=['id'];row={...row,id:matching[0].id};
        }
        const values=columns.map(column=>row[column]);
        if(!columns.length || values.some(value=>value==null)) throw new Error('Clave incompleta.');
        const key=JSON.stringify([operation.table,columns,values]);
        latest.set(key,{...meta,row,columns,values,key,translatedStudent:sourceRow.student_id!=null && !equal(sourceRow.student_id,row.student_id),
          sourceStudentId:sourceRow.student_id,targetStudentId:row.student_id});
      } catch(error) {review.push({...meta,reason:error.message,source:operation});}
    }
    const tombstones=new Set(fs.readdirSync(path.join(snapshot,'tombstones')).flatMap(file=>{
      const value=read(path.join(snapshot,'tombstones',file));return value.evidenceKey?[String(value.evidenceKey)]:[];
    }));
    const decisions=[];
    const apply=(entry,existing,kind,row=entry.row)=>{
      const schema=schemas.get(entry.table),allowed=new Set(schema.map(item=>item.name));
      const pk=new Set(schema.filter(item=>item.pk).map(item=>item.name));
      const columns=Object.keys(row).filter(column=>allowed.has(column) && column!=='id' && !column.startsWith('__') && (kind==='insert' || !pk.has(column)));
      const clause=entry.columns.map(column=>`${quote(column)} IS ?`).join(' AND ');
      if(kind==='insert') db.prepare(`INSERT INTO ${quote(entry.table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]??null));
      else if(kind==='delete') db.prepare(`DELETE FROM ${quote(entry.table)} WHERE ${clause}`).run(...entry.values);
      else if(columns.length) db.prepare(`UPDATE ${quote(entry.table)} SET ${columns.map(column=>`${quote(column)}=?`).join(',')} WHERE ${clause}`).run(...columns.map(column=>row[column]??null),...entry.values);
      decisions.push({...entry,decision:kind,before:existing||null,after:kind==='delete'?null:row});
    };
    db.transaction(()=>{
      for(const entry of latest.values()) {
        const schema=schemas.get(entry.table),allowed=new Set(schema.map(item=>item.name));
        if(entry.columns.some(column=>!allowed.has(column))) {review.push({...entry,reason:'Clave ajena al esquema local.'});continue;}
        const clause=entry.columns.map(column=>`${quote(column)} IS ?`).join(' AND ');
        const matches=db.prepare(`SELECT * FROM ${quote(entry.table)} WHERE ${clause}`).all(...entry.values);
        if(matches.length>1) {review.push({...entry,reason:'Varias filas locales para la misma clave.'});continue;}
        const existing=matches[0];
        if(entry.table==='evaluacion_evidencias') {
          const deleted=tombstones.has(String(entry.row.evidence_key));
          if(entry.action==='delete' || deleted) {
            if(!deleted) {review.push({...entry,reason:'Eliminacion sin tombstone verificable.'});continue;}
            if(existing) apply(entry,existing,'delete'); else decisions.push({...entry,decision:'already-deleted'});
            continue;
          }
          const relative=String(entry.row.relative_path || '').replaceAll('\\','/');
          if(!relative || !evidenceRoot) {review.push({...entry,reason:'Falta ruta de archivo para verificar la evidencia.'});continue;}
          const file=path.resolve(evidenceRoot,...relative.split('/'));
          const check=path.relative(path.resolve(evidenceRoot),file);
          if(check.startsWith('..') || path.isAbsolute(check) || !fs.existsSync(file) || (Number(entry.row.file_size)>0 && fs.statSync(file).size!==Number(entry.row.file_size))) {
            review.push({...entry,reason:'Archivo de evidencia ausente o tamano diferente; se conserva pendiente.'});continue;
          }
          entry.fileVerification={relativePath:relative,bytes:fs.statSync(file).size,sha256:fileHash(file)};
        }
        const differences=existing ? Object.keys(entry.row).filter(column=>allowed.has(column) && !ignored.has(column) && !equal(existing[column],entry.row[column])) : [];
        if(existing && !differences.length) {decisions.push({...entry,decision:'same'});continue;}
        if(entry.table==='evaluacion_conclusiones') {
          review.push({...entry,reason:'Se conserva la conclusion validada de PC1; diferencia con guardado de PC2.',differences});continue;
        }
        if(existing && entry.table==='sesiones' && differences.length===1 && differences[0]==='session_data') {
          const expected=reconcileSessionCapacities(JSON.parse(existing.session_data || '{}'));
          if(digest(expected)===digest(JSON.parse(entry.row.session_data || '{}'))) {
            entry.verifiedRepair='Coincide exactamente con el reparador existente de capacidades, sin cambiar criterios ni notas.';
            apply(entry,existing,'update'); continue;
          }
        }
        if(existing && (entry.table==='evaluacion_registros' || entry.table==='sesiones')) {
          review.push({...entry,reason:'Registro existente distinto: se preserva PC1 para revision.',differences,before:existing});continue;
        }
        if(entry.table==='db_estudiantes') {
          const safe=new Set(['grupo','gmail','outlook','notifications_enabled']);
          const safeColumns=differences.filter(column=>safe.has(column));
          const other=differences.filter(column=>!safe.has(column));
          if(other.length) review.push({...entry,reason:'Campos de estudiante conservados para revision.',differences:other});
          if(!safeColumns.length) continue;
          if(timestamp(entry.row.updated_at)<=timestamp(existing?.updated_at)) {decisions.push({...entry,decision:'keep-newer-local',differences:safeColumns});continue;}
          apply(entry,existing,'update',Object.fromEntries([...safeColumns,'updated_at'].map(column=>[column,entry.row[column]]))); continue;
        }
        if(existing && entry.table==='evaluacion_evidencias' && existing.teacher_comment && entry.row.teacher_comment && existing.teacher_comment!==entry.row.teacher_comment) {
          review.push({...entry,reason:'Comentarios docentes diferentes: conservar ambos para revision.',before:existing});continue;
        }
        if(existing && timestamp(entry.row.updated_at)<=timestamp(existing.updated_at)) {decisions.push({...entry,decision:'keep-newer-local',differences});continue;}
        apply(entry,existing,existing?'update':'insert');
      }
    })();
    const allGrades=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(), byId=new Map(allGrades.map(row=>[row.id,row]));
    const alteredGrades=gradesBefore.filter(row=>digest(row)!==digest(byId.get(row.id)));
    const afterConclusions=db.prepare('SELECT * FROM evaluacion_conclusiones ORDER BY id').all();
    if(alteredGrades.length || digest(conclusionsBefore)!==digest(afterConclusions)) throw new Error('La candidata altero una nota o conclusion previa.');
    const thirdAfter=consolidatedThirdBimester(db);
    if(digest(thirdBefore)!==digest(thirdAfter)) throw new Error('La candidata cambio el consolidado del III bimestre.');
    const coreSummary=thirdAfter.filter(group=>group.students.some(student=>student.competencies.length)).map(group=>({grade:group.grade,section:group.section,
      total:group.students.length,complete:group.students.filter(student=>student.competencies.length && student.competencies.every(item=>!item.pending && item.code!=='ne')).length,
      pending:group.students.filter(student=>student.competencies.some(item=>item.pending)).length}));
    const candidateEvidenceKeys=new Set(db.prepare('SELECT evidence_key FROM evaluacion_evidencias').all().map(row=>row.evidence_key));
    const recoveryEvidenceNotPresent=(sourceRows.evaluacion_evidencias || []).filter(row=>!candidateEvidenceKeys.has(row.evidence_key) && !tombstones.has(String(row.evidence_key)))
      .map(row=>({evidenceKey:row.evidence_key,relativePath:row.relative_path}));
    const insertedGrades=decisions.filter(item=>item.table==='evaluacion_registros' && item.decision==='insert');
    const newGradesByUnitAndMode=Object.fromEntries([...new Set(insertedGrades.map(item=>`${item.row.unit_id}::${item.row.grading_mode}`))]
      .map(key=>[key,insertedGrades.filter(item=>`${item.row.unit_id}::${item.row.grading_mode}`===key).length]));
    const summary={sourceDevice,batchesVerified:batches.length,pc2Batches:incoming.length,operations:incoming.reduce((sum,batch)=>sum+batch.operations.length,0),
      distinctResolvedRecords:latest.size,translatedRecords:[...latest.values()].filter(item=>item.translatedStudent).length,
      byDecision:Object.fromEntries([...new Set(decisions.map(item=>item.table))].sort().map(table=>[table,Object.fromEntries([...new Set(decisions.filter(item=>item.table===table).map(item=>item.decision))].map(kind=>[kind,decisions.filter(item=>item.table===table && item.decision===kind).length]))])),
      reviewCases:review.length,reviewByReason:Object.fromEntries([...new Set(review.map(item=>item.reason))].map(reason=>[reason,review.filter(item=>item.reason===reason).length])),
      frontendOperationsPreservedWithoutImport:retainedFrontend.length,
      originalGrades:gradesBefore.length,proposedGrades:allGrades.length,originalGradeChanges:alteredGrades.length,
      originalConclusions:conclusionsBefore.length,originalConclusionsChanged:false,thirdBimesterUnchanged:true,thirdBimester:coreSummary,
      newGradesByUnitAndMode,recoveryEvidenceNotPresent,
      integrity:db.pragma('integrity_check',{simple:true})};
    fs.writeFileSync(path.join(output,'proposal.json'),JSON.stringify({summary,instrumentProofs,inputHashes,decisions,review},null,2));
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
    fs.writeFileSync(path.join(output,'III-bimestre-verificado.json'),JSON.stringify(thirdAfter,null,2));
    return summary;
  } finally {db.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,item,index,array)=>index%2===0?[...pairs,[item.slice(2),array[index+1]]]:pairs,[]));
  if(!args.source || !args.snapshot || !args.output) throw new Error('Usar --source DB --snapshot CARPETA_RESGUARDADA --output CARPETA_NUEVA --evidenceRoot CARPETA_EVIDENCIAS');
  console.log(JSON.stringify(await planReconciliation(args),null,2));
}
