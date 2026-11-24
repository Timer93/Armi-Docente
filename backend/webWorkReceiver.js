import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const parse=(v,f={})=>{try{return JSON.parse(v);}catch{return f;}};
const normalized=v=>String(v||'').trim().toLowerCase();
const safeTree=(v,depth=0)=>{
 if(depth>45)throw Error('Cambio demasiado profundo.');
 if(object(v))for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))throw Error('Campo no válido.');safeTree(x,depth+1);}
 if(Array.isArray(v))for(const x of v)safeTree(x,depth+1);
};
// Merge only fields changed on the web. An unrelated local change survives.
// Unknown baselines never authorize replacing an existing record.
export function mergeWebWork(before,after,local){
 if(equal(after,local))return local;
 if(before===null){if(local===null)return after;throw Error('Falta una versión anterior verificable.');}
 if(equal(before,after))return local;
 if(equal(local,before))return after;
 if(object(before)&&object(after)&&object(local)){
  const result={...local};
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
   if(equal(before[key],after[key]))continue;
   const value=mergeWebWork(before[key]===undefined?null:before[key],after[key]===undefined?null:after[key],local[key]===undefined?null:local[key]);
   if(!(key in after))delete result[key];else result[key]=value;
  }
  return result;
 }
 throw Error('El mismo dato cambió en Windows y en la web.');
}
const generalFields='year department region province ugel district institution lugar school_shift level motto year_name management_weeks_u1 director subdirector pedagogical_coordinator toe_coordinator teacher context_description b1_start b1_end b2_start b2_end b3_start b3_end b4_start b4_end vac_start vac_end u1_start u2_start u3_start u4_start u5_start u6_start u7_start u8_start u_vac_start u_vac_end u1_end u2_end u3_end u4_end u5_end u6_end u7_end u8_end ie_anniversary_date achievement_day_1_date community_anniversary_date achievement_day_2_date province_anniversary_date other_important_date'.split(' ');
const studentFields={nivel:'nivel',name:'estudiantes',grade:'grado',section:'secc',fechaNacimiento:'fecha_nacimiento',dni:'dni',email:'gmail',microsoft:'outlook',group:'grupo',estado:'estado',sexo:'sexo',edad:'edad'};
const configKeys=new Set(['armi_areas','armi_assignments','armi_calendar_state','armi_holidays_v7','armi_schedule_config','armi_schedule_entries','armi_schedule_color_settings','armi_pa_pinned_didactic_units_global','armi_pa_pinned_matrix_global']);
const clean=(v,fields)=>Object.fromEntries(fields.filter(k=>k in (v||{})).map(k=>[k,v[k]??'']));
const quote=v=>'"'+v.replaceAll('"','""')+'"';
function columns(db,table){return new Set(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(x=>x.name));}
function write(db,table,keyColumn,key,value){
 const allowed=columns(db,table),data=Object.fromEntries(Object.entries(value).filter(([k])=>allowed.has(k)&&k!==keyColumn));
 if(!Object.keys(data).length)return;
 if(allowed.has('updated_at'))data.updated_at=new Date().toISOString();
 const keys=Object.keys(data);
 if(db.prepare(`SELECT 1 FROM ${quote(table)} WHERE ${quote(keyColumn)}=?`).get(key))db.prepare(`UPDATE ${quote(table)} SET ${keys.map(k=>quote(k)+'=?').join(',')} WHERE ${quote(keyColumn)}=?`).run(...Object.values(data),key);
 else db.prepare(`INSERT INTO ${quote(table)} (${[keyColumn,...keys].map(quote).join(',')}) VALUES (${[keyColumn,...keys].map(()=>'?').join(',')})`).run(key,...Object.values(data));
}
function student(db,scope,key,before,after){
 const mapping=db.prepare("SELECT local_id FROM web_work_ids WHERE scope=? AND kind='students' AND web_id=?").get(scope,key);
 if(mapping){const row=db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(mapping.local_id);if(!row)throw Error('El estudiante vinculado ya no existe.');return row;}
 const dni=String(before?.dni||after?.dni||'').trim();
 if(!dni)throw Error('Completa el DNI para vincular este estudiante entre equipos.');
 if(dni){const rows=db.prepare('SELECT * FROM db_estudiantes WHERE trim(dni)=?').all(dni);if(rows.length>1)throw Error('Hay más de un estudiante con ese DNI.');if(rows[0])return rows[0];}
 if(before)throw Error('No se pudo verificar la identidad del estudiante.');
 return null;
}
function applyRecord(db,scope,r,identities={}){
 const old=r.before?.deleted?null:r.before?.value??null, next=r.after.deleted?null:r.after.value;
 if(r.after.deleted)throw Error('El borrado requiere revisión en Windows; el registro se conserva.');
 if(r.kind==='general'){
  const row=db.prepare('SELECT * FROM datos_generales LIMIT 1').get();
  if(!row)throw Error('Windows no tiene datos generales inicializados.');
  const before=old&&clean(old,generalFields),after=clean(next,generalFields),local=clean(row,Object.keys(after));
  const merged=mergeWebWork(before&&clean(before,Object.keys(after)),after,local);
  write(db,'datos_generales','id',row.id,merged);return;
 }
 if(r.kind==='students'){
  const row=student(db,scope,r.key,old,next),fields=Object.keys(studentFields),local=row?Object.fromEntries(fields.map(k=>[k,row[studentFields[k]]??(k==='edad'?null:'')])):null;
  const after=clean(next,fields),before=old&&clean(old,fields),merged=mergeWebWork(before,after,local);
  if(!merged.name||!merged.grade||!merged.section)throw Error('Estudiante incompleto.');
  const value=Object.fromEntries(Object.entries(merged).map(([k,v])=>[studentFields[k],v]));
  let id=row?.id;
  if(!row){const keys=Object.keys(value);id=db.prepare(`INSERT INTO db_estudiantes (${keys.map(quote).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(value)).lastInsertRowid;}
  else write(db,'db_estudiantes','id',id,value);
  db.prepare("INSERT OR IGNORE INTO web_work_ids(scope,kind,web_id,local_id) VALUES (?,'students',?,?)").run(scope,r.key,String(id));return;
 }
 if(r.kind==='sessions'){
  const row=db.prepare('SELECT * FROM sesiones WHERE id_sesion=?').get(r.key);
  const convert=v=>{if(!v)return null;const result={...v};delete result.id;delete result.updated_at;return result;};
  const local=row?convert({...parse(row.session_data),year:row.year,areaId:row.area_id,grade:row.grade,section:row.section,unitNumber:row.unit_number,sessionNumber:row.session_number}):null;
  // Canonical identities are strings in SQL and can be numbers in imported JSON.
  const normalize=v=>{const out=convert(v);if(out)for(const k of ['year','unitNumber','sessionNumber'])if(k in out)out[k]=String(out[k]);return out;};
  const merged=mergeWebWork(normalize(old),normalize(next),normalize(local));
  const id=`${merged.year}-${merged.areaId}-${merged.grade}-${merged.section}-U${merged.unitNumber}-S${merged.sessionNumber}`;
  if(id!==r.key)throw Error('La identidad de la sesión no coincide.');
  write(db,'sesiones','id_sesion',r.key,{year:merged.year,area_id:merged.areaId,grade:merged.grade,section:merged.section,unit_number:merged.unitNumber,session_number:merged.sessionNumber,session_data:JSON.stringify(merged)});return;
 }
 if(r.kind==='configuration'){
  if(!old)throw Error('Falta comparar la configuración inicial con Windows.');
  const removed=r.after.context?.removed||[],keys=[...new Set([...Object.keys(next),...removed])];
  for(const k of keys)if(!configKeys.has(k))throw Error('Configuración no admitida.');
  const local=Object.fromEntries(keys.map(k=>[k,parse(db.prepare('SELECT value FROM armi_frontend_state WHERE key=?').get(k)?.value,null)])),before=Object.fromEntries(keys.map(k=>[k,old[k]??null])),after=Object.fromEntries(keys.map(k=>[k,removed.includes(k)?null:next[k]]));
  const merged=mergeWebWork(before,after,local);
  for(const [k,v]of Object.entries(merged))db.prepare('INSERT INTO armi_frontend_state(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(k,v===null?null:JSON.stringify(v),new Date().toISOString());return;
 }
 if(r.kind==='units'){
  const row=db.prepare('SELECT * FROM unidades_didacticas WHERE id_unidad=?').get(r.key);
  const jsonFields=['criterios','evidencias','instrumentos','criterios_trans','evidencias_trans','instrumentos_trans','sesiones','recursos','bibliografia'];
  const convert=v=>{if(!v)return null;const out={...v};delete out.id;delete out.id_unidad;delete out.updated_at;delete out.area_id;delete out.unit_number;for(const [alias,key]of [['criteriosTrans','criterios_trans'],['evidenciasTrans','evidencias_trans'],['instrumentosTrans','instrumentos_trans']])if(alias in out){out[key]=out[alias];delete out[alias];}for(const k of ['year','unitNumber'])if(k in out)out[k]=String(out[k]);return out;};
  const local=row?convert({...row,areaId:row.area_id,unitNumber:row.unit_number,...Object.fromEntries(jsonFields.map(k=>[k,parse(row[k],k==='sesiones'?[]:{})]))}):null;
  const after=convert(next),before=convert(old),project=v=>v&&Object.fromEntries(Object.keys(after).map(k=>[k,v[k]??null]));
  const supported=columns(db,'unidades_didacticas');
  if(Object.keys(after).some(k=>!['areaId','unitNumber'].includes(k)&&!supported.has(k)))throw Error('La unidad contiene un campo que requiere conversión adicional a Windows.');
  const merged=mergeWebWork(project(before),after,project(local));
  if(`${merged.year}-${merged.areaId}-${merged.grade}-${merged.section}-U${merged.unitNumber}`!==r.key)throw Error('La identidad de unidad no coincide.');
  const stored={...merged,area_id:merged.areaId,unit_number:merged.unitNumber};for(const k of jsonFields)if(k in stored)stored[k]=typeof stored[k]==='string'?stored[k]:JSON.stringify(stored[k]);
  write(db,'unidades_didacticas','id_unidad',r.key,stored);return;
 }
 if(r.kind==='annual'){
  const row=db.prepare('SELECT * FROM programacion_anual WHERE id_programa=?').get(r.key),resources=db.prepare('SELECT * FROM programacion_recursos WHERE id_programa=?').get(r.key)||{};
  const after={...next};delete after.id;
  const resourceFields=['medios','materiales','recursos','espacios','apps','softwares','plataformas'];
  const local=row?{year:r.key.slice(0,4),nroPa:row.nro_pa||'',areaId:row.area_id,areaName:row.area_curricular,grade:row.grade,section:row.section,matrixChecks:parse(row.matrix_checks),didacticUnits:Object.fromEntries(Array.from({length:8},(_,i)=>[i,{title:row[`titulo_u${i+1}`]||'',situation:row[`st_cont_u${i+1}`]||''}])),areaPurpose:row.area_purpose||'',areaEnfoque:row.area_enfoque||'',areaStandards:row.area_standards||'',metas_datos:row.metas_datos||null,resourceFields:Object.fromEntries(resourceFields.map(k=>[k,resources[k]||''])),bibliographyFields:{referencias:resources.referencias||'',linkografia:resources.linkografia||''}}:null;
  const fields=Object.keys(local||after);if(Object.keys(after).some(k=>!fields.includes(k)))throw Error('La programación contiene campos que aún no tienen conversión a Windows.');
  const before=old&&clean({...old,year:old.year||r.key.slice(0,4)},fields),merged=mergeWebWork(before,after,local);
  if(`${merged.year}-${merged.areaId}-${merged.grade}-${merged.section}`!==r.key)throw Error('La identidad de programación no coincide.');
  const stored={nro_pa:merged.nroPa,area_id:merged.areaId,area_curricular:merged.areaName,grade:merged.grade,section:merged.section,matrix_checks:JSON.stringify(merged.matrixChecks),area_purpose:merged.areaPurpose,area_enfoque:merged.areaEnfoque,area_standards:merged.areaStandards,metas_datos:typeof merged.metas_datos==='object'?JSON.stringify(merged.metas_datos):merged.metas_datos};
  for(let i=0;i<8;i++){stored[`titulo_u${i+1}`]=merged.didacticUnits?.[i]?.title||'';stored[`st_cont_u${i+1}`]=merged.didacticUnits?.[i]?.situation||'';}
  write(db,'programacion_anual','id_programa',r.key,stored);write(db,'programacion_recursos','id_programa',r.key,{...merged.resourceFields,...merged.bibliographyFields});return;
 }
 if(r.kind==='instruments'){
  const linked=db.prepare("SELECT local_id FROM web_work_ids WHERE scope=? AND kind='instruments' AND web_id=?").get(scope,r.key);
  let row=linked?db.prepare('SELECT * FROM evaluacion_instrumentos WHERE id=?').get(linked.local_id):null;
  if(linked&&!row)throw Error('El instrumento vinculado ya no existe.');
  if(!linked){
   const candidates=db.prepare('SELECT * FROM evaluacion_instrumentos WHERE year=? AND area_id=? AND grade=? AND section=? AND type=? AND name=?').all(next.year,next.areaId,next.grade,next.section,next.type,next.name);
   const same=candidates.filter(v=>equal(parse(v.structure),next.structure)&&v.version===next.version);
   if(candidates.length&&(same.length!==1||candidates.length!==1))throw Error('Ya existe un instrumento con esos datos y una versión diferente.');
   row=same[0]||null;
  }
  const local=row?{year:row.year,areaId:row.area_id,grade:row.grade,section:row.section,type:row.type,name:row.name,structure:parse(row.structure),version:row.version}:null;
  const after=clean(next,['year','areaId','grade','section','type','name','structure','version']),before=old&&clean(old,Object.keys(after)),merged=mergeWebWork(before,after,local);
  const value={year:merged.year,area_id:merged.areaId,grade:merged.grade,section:merged.section,type:merged.type,name:merged.name,structure:JSON.stringify(merged.structure),version:merged.version};
  let id=row?.id;if(row)write(db,'evaluacion_instrumentos','id',id,value);else {const keys=Object.keys(value);id=db.prepare(`INSERT INTO evaluacion_instrumentos (${keys.map(quote).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(value)).lastInsertRowid;}
  db.prepare("INSERT OR IGNORE INTO web_work_ids VALUES (?,'instruments',?,?)").run(scope,r.key,String(id));return;
 }
 if(r.kind==='grades'||r.kind==='conclusions'){
  if(!Array.isArray(next)||next.length>5000)throw Error('Registro de evaluación no válido.');
  const isGrade=r.kind==='grades',key=x=>JSON.stringify(isGrade?[x.student_id,x.criteria_id]:[x.studentId,x.competencyKey]);
  const previous=new Map((old||[]).map(v=>[key(v),v])),context=r.after.context||{};
  for(const value of next){
   const prior=previous.get(key(value));if(equal(value,prior))continue;
   const webId=String(isGrade?value.student_id:value.studentId),person=student(db,scope,webId,null,identities[webId]);
   if(!person)throw Error('No se pudo vincular el estudiante de la evaluación por DNI.');
   if(String(person.grado)!==String(context.grade)||!String(context.section||'').split(/\s+y\s+|[,;/]/i).map(s=>s.trim()).includes(String(person.secc)))throw Error('El estudiante no pertenece a ese registro.');
   if(isGrade){
    if(value.session_id!==r.key||!db.prepare('SELECT 1 FROM sesiones WHERE id_sesion=?').get(r.key))throw Error('La sesión de la nota no existe.');
    const rows=db.prepare('SELECT * FROM evaluacion_registros WHERE student_id=? AND session_id=? AND criteria_id=?').all(String(person.id),r.key,value.criteria_id);
    if(rows.length>1)throw Error('Hay notas duplicadas para este criterio.');const row=rows[0];
    if(row?.numeric_score!==null&&row?.numeric_score!==undefined)throw Error('La calificación numérica requiere revisión.');
    const before=prior?{level:prior.level,observation:prior.observation}:null,after={level:value.level,observation:value.observation},local=row?{level:row.level||'',observation:row.observation||''}:null;
    const merged=mergeWebWork(before,after,local);
    let instrument=null;
    if(value.instrument_id){const linked=db.prepare("SELECT local_id FROM web_work_ids WHERE scope=? AND kind='instruments' AND web_id=?").get(scope,String(value.instrument_id));if(!linked)throw Error('Falta recibir el instrumento de esta nota.');instrument=linked.local_id;}
    if(row)write(db,'evaluacion_registros','id',row.id,merged);
    else db.prepare('INSERT INTO evaluacion_registros(student_id,session_id,unit_id,instrument_id,criteria_id,level,observation) VALUES (?,?,?,?,?,?,?)').run(String(person.id),r.key,value.unit_id,instrument,value.criteria_id,merged.level,merged.observation);
   }else{
    const args=[context.year,context.areaId,context.grade,context.section,context.scopeType,context.scopeValue,String(person.id),value.competencyKey];
    const row=db.prepare('SELECT * FROM evaluacion_conclusiones WHERE year=? AND area_id=? AND grade=? AND section=? AND scope_type=? AND scope_value=? AND student_id=? AND competency_key=?').get(...args);
    const merged=mergeWebWork(prior?{text:prior.conclusionText}:null,{text:value.conclusionText},row?{text:row.conclusion_text||''}:null);
    if(row)write(db,'evaluacion_conclusiones','id',row.id,{conclusion_text:merged.text});
    else db.prepare('INSERT INTO evaluacion_conclusiones(year,area_id,grade,section,scope_type,scope_value,student_id,competency_key,competency_name,competency_source,conclusion_text) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...args,value.competencyName,value.competencySource,merged.text);
   }
  }
  return;
 }
 throw Error('Este tipo de cambio todavía requiere integración: '+r.kind);
}
export function receiveWebPacket(db,packet,{syncUserKey,scope}){
 safeTree(packet);
 if(packet?.format!=='armi-web-changes'||packet.version!==1||normalized(packet.syncUserKey)!==normalized(syncUserKey)||!Array.isArray(packet.records)||packet.records.length>20||!/^[-a-f0-9]{36}$/.test(packet.packetId||''))throw Error('Lote web no válido para este docente.');
 db.exec(`CREATE TABLE IF NOT EXISTS web_work_ids(scope TEXT,kind TEXT,web_id TEXT,local_id TEXT,PRIMARY KEY(scope,kind,web_id));
 CREATE TABLE IF NOT EXISTS web_work_receipts(scope TEXT,packet_id TEXT,hash TEXT,result_json TEXT,PRIMARY KEY(scope,packet_id));
 CREATE TABLE IF NOT EXISTS web_work_versions(scope TEXT,kind TEXT,record_key TEXT,sequence INTEGER,PRIMARY KEY(scope,kind,record_key));`);
 const hash=crypto.createHash('sha256').update(JSON.stringify(packet)).digest('hex');
 const previous=db.prepare('SELECT * FROM web_work_receipts WHERE scope=? AND packet_id=?').get(scope,packet.packetId);
 if(previous){if(previous.hash!==hash)throw Error('Cambió el contenido de un lote ya recibido.');return JSON.parse(previous.result_json);}
 const outcomes=[];
 for(const r of [...packet.records].sort((a,b)=>a.sequence-b.sequence)){
  if(!Number.isSafeInteger(r.sequence)||r.sequence<1||typeof r.key!=='string'||r.key.length>500||typeof r.kind!=='string'||!object(r.after))throw Error('Registro web no válido.');
  try{
   const result=db.transaction(()=>{
    const version=db.prepare('SELECT sequence FROM web_work_versions WHERE scope=? AND kind=? AND record_key=?').get(scope,r.kind,r.key);
    if(version?.sequence>=r.sequence)return 'already-applied';
    applyRecord(db,scope,r,packet.studentIdentities||{});
    db.prepare('INSERT INTO web_work_versions VALUES (?,?,?,?) ON CONFLICT(scope,kind,record_key) DO UPDATE SET sequence=excluded.sequence').run(scope,r.kind,r.key,r.sequence);
    return 'applied';
   })();outcomes.push({sequence:r.sequence,kind:r.kind,key:r.key,status:result});
  }catch(error){outcomes.push({sequence:r.sequence,kind:r.kind,key:r.key,status:'conflict',message:error.message});}
 }
 const result={format:'armi-desktop-receipt',version:1,packetId:packet.packetId,syncUserKey,receivedAt:new Date().toISOString(),outcomes};
 db.prepare('INSERT INTO web_work_receipts VALUES (?,?,?,?)').run(scope,packet.packetId,hash,JSON.stringify(result));return result;
}
export async function receiveWebWork({db,mirrorPath,syncUserKey,backupPath}){
 const root=path.resolve(mirrorPath),marker=parse(await fs.promises.readFile(path.join(root,'.armi-sync-root.json'),'utf8'));
 if(normalized(marker.syncUserKey)!==normalized(syncUserKey))throw Error('La carpeta espejo pertenece a otra cuenta.');
 const folder=path.join(root,'ARMI Web Sync');let entries;
 try{entries=await fs.promises.readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return {applied:0,conflicts:0};throw e;}
 if(await fs.promises.realpath(folder)!==folder)throw Error('La carpeta de intercambio no puede ser un enlace.');
 const packets=[];
 for(const entry of entries.filter(e=>e.isFile()&&/^[-a-f0-9]{36}\.json$/.test(e.name)&&!fs.existsSync(path.join(folder,'receipts',e.name))).slice(0,200)){
  const target=path.join(folder,entry.name),stat=await fs.promises.lstat(target);if(stat.size>1_500_000||stat.isSymbolicLink())continue;
  try{const packet=JSON.parse(await fs.promises.readFile(target,'utf8'));packets.push(packet);}catch{/* Drive may still be delivering the file. Retry next pass. */}
 }
 packets.sort((a,b)=>Math.min(...(Array.isArray(a.records)?a.records.map(r=>r.sequence):[Infinity]))-Math.min(...(Array.isArray(b.records)?b.records.map(r=>r.sequence):[Infinity])));
 if(packets.length&&backupPath&&!fs.existsSync(backupPath)){await fs.promises.mkdir(path.dirname(backupPath),{recursive:true});await db.backup(backupPath);}
 let applied=0,conflicts=0;
 const receipts=path.join(folder,'receipts');await fs.promises.mkdir(receipts,{recursive:true});
 if(await fs.promises.realpath(receipts)!==receipts)throw Error('La carpeta de confirmaciones no puede ser un enlace.');
 for(const packet of packets){
  const result=receiveWebPacket(db,packet,{syncUserKey,scope:root});
  const file=path.join(receipts,packet.packetId+'.json');
  if(!fs.existsSync(file)){const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.promises.writeFile(tmp,JSON.stringify(result),{flag:'wx'});await fs.promises.rename(tmp,file);applied+=result.outcomes.filter(r=>r.status==='applied').length;}
  conflicts+=result.outcomes.filter(r=>r.status==='conflict').length;
 }
 return {applied,conflicts};
}
