import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {pathToFileURL} from 'node:url';

const scoreKey=row=>`${row.session_id}::${row.student_id}::${row.criteria_id}`;
export const adjustUnit56Grades = async ({databasePath,apply=false,year='2026',backupRoot}) => {
  const db=new Database(databasePath,{readonly:!apply,fileMustExist:true,timeout:10000});
  try{
    const scope=db.prepare("SELECT * FROM sesiones WHERE year=? AND unit_number IN ('5','6')").all(year);
    const sessionIds=new Set(scope.map(row=>row.id_sesion));
    const candidates=db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal' AND numeric_score=0").all().filter(row=>sessionIds.has(row.session_id));
    const plan={year,units:[5,6],zeroGrades:candidates.length,sessions:scope.length,apply};
    if(!apply)return plan;
    if(!backupRoot)throw new Error('Se requiere una carpeta de respaldo antes de aplicar el ajuste.');
    const folder=path.resolve(backupRoot,`unit56-${new Date().toISOString().replace(/[:.]/g,'-')}`);
    fs.mkdirSync(folder,{recursive:true});
    const backup=path.join(folder,'armi-before.db');
    await db.backup(backup);
    let report;
    db.transaction(()=>{
      const before=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
      const selected=before.filter(row=>sessionIds.has(row.session_id)&&row.grading_mode==='hybrid_vigesimal'&&row.numeric_score===0);
      const ids=new Set(selected.map(row=>row.id));
      const cacheBefore=db.prepare("SELECT * FROM armi_frontend_state WHERE key='armi_hybrid_numeric_scores_v1'").get();
      fs.writeFileSync(path.join(folder,'before.json'),JSON.stringify({records:selected,sessions:scope,cache:cacheBefore},null,2));
      const update=db.prepare("UPDATE evaluacion_registros SET numeric_score=5,level='Inicio',updated_at=? WHERE id=? AND numeric_score=0 AND grading_mode='hybrid_vigesimal'");
      const now=new Date().toISOString();
      selected.forEach(row=>assert.equal(update.run(now,row.id).changes,1));
      let roundedSessions=0;
      const saveSession=db.prepare('UPDATE sesiones SET session_data=?,updated_at=? WHERE id_sesion=? AND session_data=?');
      for(const row of scope){
        const data=JSON.parse(row.session_data || '{}');
        if(data.numericAverageRounding==='nearest_integer')continue;
        assert.ok(data.numericAverageRounding===undefined,'Existe otra regla de redondeo; revisar antes de reemplazarla.');
        const changed={...data,numericAverageRounding:'nearest_integer'};
        assert.equal(saveSession.run(JSON.stringify(changed),now,row.id_sesion,row.session_data).changes,1,'La sesión cambió durante el ajuste.');
        delete changed.numericAverageRounding;assert.deepEqual(changed,data);roundedSessions++;
      }
      let cacheUpdates=0;
      if(cacheBefore){
        const cache=JSON.parse(cacheBefore.value || '{}');
        for(const row of selected){const key=scoreKey(row);if(cache[key]!==null&&cache[key]!==undefined&&cache[key]!==''&&Number(cache[key])===0){cache[key]=5;cacheUpdates++;}}
        if(cacheUpdates)db.prepare('UPDATE armi_frontend_state SET value=?,updated_at=? WHERE key=?').run(JSON.stringify(cache),now,cacheBefore.key);
      }
      const after=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
      assert.equal(after.length,before.length,'No se crean ni eliminan notas.');
      const original=new Map(before.map(row=>[row.id,row]));
      for(const row of after){
        const expected=original.get(row.id);
        if(ids.has(row.id))assert.deepEqual(row,{...expected,numeric_score:5,level:'Inicio',updated_at:now});
        else assert.deepEqual(row,expected,'Una nota fuera del ajuste fue modificada.');
      }
      assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
      report={...plan,zeroGrades:selected.length,roundedSessions,cacheUpdates,backup,audit:path.join(folder,'before.json')};
    }).immediate();
    fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));
    return report;
  }finally{db.close();}
};

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  if(!args.includes('--db'))throw new Error('Indica --db con la ruta exacta de la base. Por defecto solo se revisa.');
  const databasePath=path.resolve(value('--db'));
  console.log(JSON.stringify(await adjustUnit56Grades({databasePath,apply:args.includes('--apply'),backupRoot:args.includes('--backup-root')?value('--backup-root'):path.join(path.dirname(path.dirname(databasePath)),'repair-backups'),year:args.includes('--year')?value('--year'):'2026'}),null,2));
}
