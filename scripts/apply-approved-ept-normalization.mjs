import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
import {simulateUniformEpt,UNIFORM_RULES} from './simulate-uniform-ept-normalization.mjs';
import {hybridGradeIssue} from '../backend/shared/hybridGradeIntegrity.js';

const cacheKey='armi_hybrid_numeric_scores_v1';
const scoreKey=row=>`${row.sessionId}::${row.studentId}::${row.criteriaId}`;
const digest=(db,table)=>{
  const hash=crypto.createHash('sha256');
  for(const row of db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}" ORDER BY rowid`).iterate())hash.update(JSON.stringify(row));
  return hash.digest('hex');
};
const projection=(rows,side,field)=>rows.map(row=>({key:[row.studentId,row.areaId,row.period,row[field]].join('::'),result:row[side]})).sort((a,b)=>a.key.localeCompare(b.key));

export async function applyApprovedNormalization({databasePath,approved,backupRoot,apply=false}) {
  assert.equal(approved.applied,false,'An original simulation is required');
  assert.deepEqual(approved.scope,{year:'2026',units:[5,6],bimester:'III',mode:'hybrid_vigesimal',target:'EPT'});
  assert.deepEqual(approved.rules,UNIFORM_RULES,'Rules differ from the approved simulation');
  assert.ok(Array.isArray(approved.recordChanges)&&approved.recordChanges.length>0);
  assert.equal(new Set(approved.recordChanges.map(row=>row.recordId)).size,approved.recordChanges.length);
  const db=new Database(databasePath,{readonly:!apply,fileMustExist:true,timeout:10000});
  let folder;
  try{
    const get=db.prepare('SELECT * FROM evaluacion_registros WHERE id=?');
    const checkIdentity=(item,row)=>{
      assert.ok(row,`Missing grade ${item.recordId}`);
      assert.equal(String(row.student_id),String(item.studentId));assert.equal(row.session_id,item.sessionId);
      assert.equal(row.criteria_id,item.criteriaId);assert.equal(row.grading_mode,'hybrid_vigesimal');assert.equal(row.level,item.storedLevel);
      assert.equal(UNIFORM_RULES[item.originalScore],item.normalizedScore);
      assert.equal(hybridGradeIssue({...row,numeric_score:item.normalizedScore}),'');
    };
    const current=approved.recordChanges.map(item=>{const row=get.get(item.recordId);checkIdentity(item,row);return row;});
    if(current.every((row,index)=>row.numeric_score===approved.recordChanges[index].normalizedScore))return {applied:false,alreadyApplied:true,changedGrades:0};
    const verifyPlan=()=>{
      const fresh=simulateUniformEpt(db);
      assert.deepEqual(fresh.recordChanges,approved.recordChanges,'Grades changed since the approved simulation; nothing will be written');
      assert.deepEqual(fresh.comparisons,approved.comparisons,'Consolidation no longer matches the approved simulation');
      assert.deepEqual(fresh.capacityComparisons,approved.capacityComparisons,'Capacity consolidation changed');
      return fresh;
    };
    verifyPlan();
    if(!apply)return {applied:false,alreadyApplied:false,changedGrades:approved.recordChanges.length,students:approved.summary.studentsWithNormalizedGrades};
    assert.ok(backupRoot,'A backup location is required');
    folder=path.resolve(backupRoot,`normalizacion-aprobada-III-2026-${new Date().toISOString().replace(/[:.]/g,'-')}`);
    fs.mkdirSync(folder,{recursive:true});
    const backup=path.join(folder,'armi-before.db');
    await db.backup(backup);
    const backupDb=new Database(backup,{readonly:true,fileMustExist:true});
    let result;
    try{
      result=db.transaction(()=>{
        // Lock writers, then recheck the exact approved plan and backed-up data.
        verifyPlan();
        const protectedTables=['sesiones','unidades','evaluacion_evidencias','interactive_activity_results','interactive_activity_attempts','evaluacion_conclusiones','db_estudiantes'];
        for(const table of ['evaluacion_registros','armi_frontend_state',...protectedTables])assert.equal(digest(db,table),digest(backupDb,table),`${table} changed while creating the backup`);
        const before=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
        const stateBefore=db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
        const state=stateBefore.find(row=>row.key===cacheKey);
        const scores=state?JSON.parse(state.value):{};
        const oldScores=structuredClone(scores);
        const changes=approved.recordChanges.map(item=>({plan:item,before:get.get(item.recordId),cacheBefore:scores[scoreKey(item)]??null}));
        for(const item of approved.recordChanges){
          const value=scores[scoreKey(item)];
          if(value!==undefined&&value!==null&&String(value).trim()!=='')assert.ok([item.originalScore,item.normalizedScore].includes(Number(value)),`Cache has another value for ${item.recordId}`);
        }
        fs.writeFileSync(path.join(folder,'before.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:approved.scope,rules:approved.rules,changes},null,2));
        const now=new Date().toISOString();
        const update=db.prepare("UPDATE evaluacion_registros SET numeric_score=?,updated_at=? WHERE id=? AND student_id=? AND session_id=? AND criteria_id=? AND grading_mode='hybrid_vigesimal' AND numeric_score=? AND level=?");
        for(const item of approved.recordChanges){
          const row=get.get(item.recordId);checkIdentity(item,row);
          assert.equal(row.numeric_score,item.originalScore);
          assert.equal(update.run(item.normalizedScore,now,item.recordId,item.studentId,item.sessionId,item.criteriaId,item.originalScore,item.storedLevel).changes,1);
          scores[scoreKey(item)]=item.normalizedScore;
        }
        let cacheUpdates=0;
        if(state){
          cacheUpdates=approved.recordChanges.filter(item=>oldScores[scoreKey(item)]!==scores[scoreKey(item)]).length;
          assert.equal(db.prepare('UPDATE armi_frontend_state SET value=?,updated_at=? WHERE key=? AND value=?').run(JSON.stringify(scores),now,cacheKey,state.value).changes,1);
        }
        const after=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
        assert.equal(after.length,before.length,'No records may be created/deleted');
        const plans=new Map(approved.recordChanges.map(item=>[item.recordId,item]));
        for(let index=0;index<before.length;index++){
          const plan=plans.get(before[index].id);
          assert.deepEqual(after[index],plan?{...before[index],numeric_score:plan.normalizedScore,updated_at:now}:before[index],`Unexpected grade change ${before[index].id}`);
        }
        const stateAfter=db.prepare('SELECT * FROM armi_frontend_state ORDER BY key').all();
        assert.equal(stateAfter.length,stateBefore.length);
        for(let index=0;index<stateBefore.length;index++){
          if(stateBefore[index].key!==cacheKey)assert.deepEqual(stateAfter[index],stateBefore[index]);
        }
        for(const key of new Set([...Object.keys(oldScores),...Object.keys(scores)])){
          if(!approved.recordChanges.some(item=>scoreKey(item)===key))assert.deepEqual(scores[key],oldScores[key]);
        }
        const protectedVerification={};
        for(const table of protectedTables){protectedVerification[table]=digest(db,table)===digest(backupDb,table);assert.ok(protectedVerification[table],`${table} must remain unchanged`);}
        const actual=simulateUniformEpt(db);
        assert.equal(actual.recordChanges.length,0,'Normalization must be idempotent');
        assert.deepEqual(projection(actual.comparisons,'before','competency'),projection(approved.comparisons,'after','competency'),'Real results differ from approved simulation');
        assert.deepEqual(projection(actual.capacityComparisons,'before','capacity'),projection(approved.capacityComparisons,'after','capacity'),'Real capacity results differ from approved simulation');
        assert.equal(db.pragma('quick_check',{simple:true}),'ok');
        const report={applied:true,alreadyApplied:false,appliedAt:now,changedGrades:plans.size,cacheUpdates,students:approved.summary.studentsWithNormalizedGrades,
          mappingCounts:{'12->13':approved.recordChanges.filter(item=>item.originalScore===12).length,'14->16':approved.recordChanges.filter(item=>item.originalScore===14).length,'15->16':approved.recordChanges.filter(item=>item.originalScore===15).length},
          individualLiteralChanges:0,approvedBimesterTransitions:approved.periodCounts.III,
          actualMatchesSimulation:true,protectedVerification,backup,audit:path.join(folder,'before.json'),
          changes:changes.map(item=>({...item,after:get.get(item.plan.recordId)}))};
        return report;
      }).immediate();
    }finally{backupDb.close();}
    fs.writeFileSync(path.join(folder,'applied.json'),JSON.stringify(result,null,2));
    fs.writeFileSync(path.join(folder,'resumen.txt'),'\ufeff'+[
      'NORMALIZACIÓN APLICADA — III BIMESTRE 2026 — EPT — UNIDADES 5 Y 6',
      `Fecha UTC: ${result.appliedAt}`,`Notas actualizadas: ${result.changedGrades}. Estudiantes: ${result.students}.`,
      '12 -> 13: '+result.mappingCounts['12->13'],'14 -> 16: '+result.mappingCounts['14->16'],'15 -> 16: '+result.mappingCounts['15->16'],
      'Niveles individuales conservados. Resultados reales comprobados contra la simulación aprobada.',
      `C -> B: ${approved.periodCounts.III.cToB}. B -> A: ${approved.periodCounts.III.bToA}. Disminuciones: ${approved.periodCounts.III.decreased}.`,
      'Transversales, otras notas, planificaciones, evidencias, actividades HTML y conclusiones guardadas: sin cambios.',
      `Respaldo completo: ${result.backup}`,`Registro de valores originales: ${result.audit}`
    ].join('\r\n'));
    return result;
  }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{db:{type:'string'},approved:{type:'string'},'backup-root':{type:'string'},apply:{type:'boolean',default:false}}});
  if(!values.db||!values.approved)throw new Error('Use --db armi.db --approved simulacion-completa.json [--apply --backup-root carpeta]');
  const result=await applyApprovedNormalization({databasePath:path.resolve(values.db),approved:JSON.parse(fs.readFileSync(values.approved,'utf8')),apply:values.apply,backupRoot:values['backup-root']});
  const {changes,...summary}=result;console.log(JSON.stringify(summary,null,2));
}
