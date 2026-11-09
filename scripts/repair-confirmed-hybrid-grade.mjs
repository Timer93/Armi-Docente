import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import Database from 'better-sqlite3';
import {hybridGradeIssue} from '../backend/shared/hybridGradeIntegrity.js';

export async function repairConfirmedGrade({databasePath,studentId,sessionId,criteriaId,from,to,apply=false}) {
  const db=new Database(databasePath,{fileMustExist:true,readonly:!apply});
  const args=[String(studentId),String(sessionId),String(criteriaId)];
  const query="SELECT * FROM evaluacion_registros WHERE student_id=? AND session_id=? AND criteria_id=? AND grading_mode='hybrid_vigesimal'";
  try {
    const matches=db.prepare(query).all(...args);
    if(matches.length!==1) throw new Error('Se esperaba exactamente un registro híbrido.');
    const before=matches[0];
    if(before.numeric_score===to && !hybridGradeIssue(before)) return {changed:false,reason:'Ya corregido'};
    if(before.numeric_score!==from) throw new Error('La nota cambió desde la revisión. No se modificó.');
    const proposed={...before,numeric_score:to};
    const issue=hybridGradeIssue(proposed);
    if(issue) throw new Error(issue);
    if(!apply) return {changed:false,proposed};
    const folder=path.join(path.dirname(databasePath),'..','repair-backups',`confirmed-grade-${new Date().toISOString().replace(/[:.]/g,'-')}`);
    fs.mkdirSync(folder,{recursive:true});
    await db.backup(path.join(folder,'armi-before.db'));
    const key=`${sessionId}::${studentId}::${criteriaId}`;
    db.transaction(()=>{
      if(JSON.stringify(db.prepare(query).get(...args))!==JSON.stringify(before)) throw new Error('El registro cambió mientras se creaba el respaldo.');
      const cache=db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_hybrid_numeric_scores_v1'").get();
      if(cache){
        const scores=JSON.parse(cache.value);
        if(scores[key]!==undefined && Number(scores[key])!==from && Number(scores[key])!==to) throw new Error('La caché contiene otra nota. Se requiere revisión.');
        if(scores[key]!==undefined){
          scores[key]=to;
          db.prepare("UPDATE armi_frontend_state SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key='armi_hybrid_numeric_scores_v1'").run(JSON.stringify(scores));
        }
      }
      db.prepare("UPDATE evaluacion_registros SET numeric_score=?,updated_at=CURRENT_TIMESTAMP WHERE student_id=? AND session_id=? AND criteria_id=? AND grading_mode='hybrid_vigesimal'").run(to,...args);
    })();
    const result={changed:true,before,after:db.prepare(query).get(...args),backup:path.join(folder,'armi-before.db')};
    fs.writeFileSync(path.join(folder,'repair.json'),JSON.stringify(result,null,2));
    return result;
  } finally {db.close();}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{db:{type:'string'},student:{type:'string'},session:{type:'string'},criterion:{type:'string'},from:{type:'string'},to:{type:'string'},apply:{type:'boolean',default:false}}});
  if(!values.db||!values.student||!values.session||!values.criterion||values.from===undefined||values.to===undefined)throw new Error('Faltan --db --student --session --criterion --from --to [--apply]');
  console.log(JSON.stringify(await repairConfirmedGrade({databasePath:values.db,studentId:values.student,sessionId:values.session,criteriaId:values.criterion,from:Number(values.from),to:Number(values.to),apply:values.apply}),null,2));
}
