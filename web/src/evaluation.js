import {AuthError} from './apps-script-auth.js';
const fail=(message,status=400)=>{throw new AuthError(message,status);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=250)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const sectionList=value=>String(value).split(/\s+y\s+|[,;/]/i).map(v=>v.trim().toLowerCase()).filter(Boolean);
const contextFields=['year','areaId','grade','section','scopeType','scopeValue'];
export async function evaluationReady(db){return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='web_evaluation'").first());}
function conclusionContext(value) {
 if(!object(value)||Object.keys(value).some(k=>!contextFields.includes(k))||contextFields.some(k=>!text(value[k],80)||!value[k].trim())||!/^\d{4}$/.test(value.year)||!['unit','bimester'].includes(value.scopeType)||(value.scopeType==='unit'?!/^\d{1,3}$/.test(value.scopeValue):!['I','II','III','IV'].includes(value.scopeValue)))fail('Selecciona un ámbito válido de conclusiones.');
 return Object.fromEntries(contextFields.map(k=>[k,value[k]]));
}
async function lesson(db,teacherId,id) {
 const head=await db.prepare('SELECT active_import_id FROM academic_heads WHERE teacher_id=?').bind(teacherId).first();
 const edit=await db.prepare("SELECT payload_json,revision,deleted FROM planning_edits WHERE teacher_id=? AND dataset='sessions' AND record_id=?").bind(teacherId,id).first();
 const base=!edit&&head?.active_import_id?await db.prepare("SELECT payload_json FROM academic_records WHERE teacher_id=? AND import_id=? AND dataset='sessions' AND record_id=?").bind(teacherId,head.active_import_id,id).first():null;
 if(edit?.deleted||!(edit||base))fail('La sesión no está disponible en tu cuenta.',404);
 const unitId=id.replace(/-S\d+$/,'');
 const unit=await db.prepare("SELECT revision FROM planning_edits WHERE teacher_id=? AND dataset='units' AND record_id=?").bind(teacherId,unitId).first();
 return {value:JSON.parse((edit||base).payload_json),revision:edit?.revision||0,unitRevision:unit?.revision||0,unitId,snapshot:head?.active_import_id||null};
}
// Both validation and the final write use the current owned roster. No student
// identity supplied by the browser grants access to another teacher's records.
const studentJoins=`FROM json_each(?) r
 LEFT JOIN academic_edits e ON e.teacher_id=? AND e.dataset='students' AND e.record_id=r.value
 LEFT JOIN academic_heads h ON h.teacher_id=?
 LEFT JOIN academic_records b ON b.teacher_id=h.teacher_id AND b.import_id=h.active_import_id AND b.dataset='students' AND b.record_id=r.value`;
const studentPayload='COALESCE(e.payload_json,b.payload_json)';
const badStudent=`COALESCE(e.deleted,0)=1 OR ${studentPayload} IS NULL OR lower(trim(json_extract(${studentPayload},'$.grade')))<>? OR lower(trim(json_extract(${studentPayload},'$.section'))) NOT IN (SELECT value FROM json_each(?))`;
export async function evaluationRoute(request,env,teacher,{readJson,digest,now}) {
 const db=env.DB,url=new URL(request.url),kind=url.pathname.endsWith('/grades')?'grades':'conclusions';
 if(!await evaluationReady(db))fail('Falta activar las calificaciones web. Ejecuta 0009_web_evaluation.sql en D1.',503);
 if(request.method==='GET') {
  if(kind==='grades') {
   if([...url.searchParams.keys()].some(k=>!['sessionId','cursor','revision'].includes(k)))fail('Filtros no válidos.');
   const sessionId=url.searchParams.get('sessionId');
   if(sessionId){if(!text(sessionId)||!sessionId.trim())fail('Sesión no válida.');const source=await lesson(db,teacher.id,sessionId);
    const row=await db.prepare("SELECT payload_json,revision FROM web_evaluation WHERE teacher_id=? AND kind='grades' AND scope_id=?").bind(teacher.id,sessionId).first();
    return {records:JSON.parse(row?.payload_json||'[]'),revision:row?.revision||0,sourceVersion:await digest(JSON.stringify([source.snapshot,source.revision,source.unitRevision])),nextCursor:null};
   }
   const cursor=url.searchParams.get('cursor')||'';if(!text(cursor))fail('Página no válida.');
   const revision=(await db.prepare('SELECT revision FROM academic_heads WHERE teacher_id=?').bind(teacher.id).first())?.revision||0;
   if(url.searchParams.has('revision')&&url.searchParams.get('revision')!==String(revision))fail('Las calificaciones cambiaron durante la lectura. Recarga el registro.',409);
   const rows=(await db.prepare("SELECT scope_id,payload_json FROM web_evaluation WHERE teacher_id=? AND kind='grades' AND scope_id>? ORDER BY scope_id LIMIT 6").bind(teacher.id,cursor).all()).results;
   return {records:rows.slice(0,5).flatMap(row=>JSON.parse(row.payload_json)),revision,nextCursor:rows.length>5?rows[4].scope_id:null};
  }
  const context=conclusionContext(Object.fromEntries(url.searchParams)),scopeId=await digest(JSON.stringify(context));
  const row=await db.prepare("SELECT payload_json,revision FROM web_evaluation WHERE teacher_id=? AND kind='conclusions' AND scope_id=?").bind(teacher.id,scopeId).first();
  return {records:JSON.parse(row?.payload_json||'[]'),revision:row?.revision||0};
 }
 if(request.method!=='PUT')fail('Operación no disponible.',404);
 const body=await readJson(request,400_000);
 if(Object.keys(body).some(k=>!['sessionId','context','changes','expectedRevision','sourceVersion','operationId'].includes(k))||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>=Number.MAX_SAFE_INTEGER||!/^[a-f0-9-]{36}$/.test(body.operationId||'')||!Array.isArray(body.changes)||!body.changes.length||body.changes.length>500)fail('Lote de evaluación no válido.');
 let context,scopeId,source;
 if(kind==='grades'){
  if(body.context!==undefined||!text(body.sessionId)||!body.sessionId.trim())fail('Sesión no válida.');
  scopeId=body.sessionId;source=await lesson(db,teacher.id,scopeId);const s=source.value;
  if(body.sourceVersion!==await digest(JSON.stringify([source.snapshot,source.revision,source.unitRevision])))fail('La planificación cambió desde que abriste la calificación. Recarga para usar los criterios actuales.',409);
  context={year:String(s.year),areaId:String(s.areaId),grade:String(s.grade),section:String(s.section),unitId:source.unitId};
 }else{if(body.sessionId!==undefined)fail('Ámbito no válido.');context=conclusionContext(body.context);scopeId=await digest(JSON.stringify(context));}
 const key=row=>JSON.stringify(kind==='grades'?[row.student_id,row.criteria_id]:[row.studentId,row.competencyKey]);
 const identities=new Set(),studentIds=new Set();
 for(const row of body.changes) {
  const fields=kind==='grades'?['student_id','session_id','unit_id','instrument_id','criteria_id','level','observation']:['studentId','competencyKey','competencyName','competencySource','conclusionText'];
  if(!object(row)||Object.keys(row).some(k=>!fields.includes(k)))fail('Campos de evaluación no válidos.');
  const studentId=kind==='grades'?row.student_id:row.studentId;
  if(!text(studentId,150)||!studentId||studentId.includes('::'))fail('Estudiante no válido.');
  if(kind==='grades') {
   if(row.session_id!==scopeId||row.unit_id!==context.unitId||!text(row.criteria_id,500)||!row.criteria_id||typeof row.level!=='string'||!['','c','b','a','ad','ne','inicio','proceso','logrado','destacado'].includes(row.level.toLowerCase())||typeof row.observation!=='string'||row.observation.length>2000||!(row.instrument_id===null||row.instrument_id===undefined||(typeof row.instrument_id==='string'&&text(row.instrument_id,150))||Number.isSafeInteger(row.instrument_id)))fail('La calificación contiene datos no válidos.');
   if(row.criteria_id.startsWith('summary::')&&row.level)fail('Los resúmenes guardan observaciones, no notas independientes.');
  }else if(!text(row.competencyKey,500)||!row.competencyKey||!text(row.competencyName,500)||!['primary','transversal'].includes(row.competencySource)||typeof row.conclusionText!=='string'||row.conclusionText.length>250)fail('La conclusión admite hasta 250 caracteres y una competencia válida.');
  if(identities.has(key(row)))fail('El lote contiene celdas duplicadas.');identities.add(key(row));studentIds.add(studentId);
 }
 const students=JSON.stringify([...studentIds]),sections=JSON.stringify(sectionList(context.section)),grade=context.grade.trim().toLowerCase();
 const rosterArgs=[students,teacher.id,teacher.id,grade,sections];
 const invalid=await db.prepare(`SELECT 1 AS invalid ${studentJoins} WHERE ${badStudent} LIMIT 1`).bind(...rosterArgs).first();
 if(invalid)fail('Hay estudiantes que no pertenecen al grado y sección de este registro.',403);
 const previous=await db.prepare('SELECT * FROM web_evaluation WHERE teacher_id=? AND kind=? AND scope_id=?').bind(teacher.id,kind,scopeId).first(),hash=await digest(JSON.stringify({kind,...body}));
 if(previous?.operation_id===body.operationId){if(previous.operation_hash!==hash)fail('Operación reutilizada con otros datos.',409);return {records:JSON.parse(previous.payload_json),revision:previous.revision};}
 if((previous?.revision||0)!==body.expectedRevision)fail('Este registro cambió en otra pestaña. Conserva tus cambios y recarga antes de continuar.',409);
 const merged=new Map(JSON.parse(previous?.payload_json||'[]').map(row=>[key(row),row]));for(const row of body.changes)merged.set(key(row),row);
 const records=[...merged.values()],payload=JSON.stringify(records);
 if(records.length>5000||new TextEncoder().encode(payload).byteLength>256_000)fail('El registro supera el tamaño permitido. Reduce las observaciones.',413);
 const sourceGuard=kind==='grades'?`AND EXISTS(SELECT 1 FROM academic_heads WHERE teacher_id=? AND active_import_id IS ?) AND COALESCE((SELECT revision FROM planning_edits WHERE teacher_id=? AND dataset='sessions' AND record_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM planning_edits WHERE teacher_id=? AND dataset='sessions' AND record_id=? AND deleted=1) AND COALESCE((SELECT revision FROM planning_edits WHERE teacher_id=? AND dataset='units' AND record_id=?),0)=?`:'';
 const statement=db.prepare(`INSERT INTO web_evaluation(teacher_id,kind,scope_id,scope_json,payload_json,revision,operation_id,operation_hash,updated_at)
  SELECT ?,?,?,?,?,1,?,?,? WHERE NOT EXISTS(SELECT 1 ${studentJoins} WHERE ${badStudent}) ${sourceGuard}
  AND (?=0 OR EXISTS(SELECT 1 FROM web_evaluation WHERE teacher_id=? AND kind=? AND scope_id=? AND revision=?))
  ON CONFLICT(teacher_id,kind,scope_id) DO UPDATE SET payload_json=excluded.payload_json,revision=web_evaluation.revision+1,operation_id=excluded.operation_id,operation_hash=excluded.operation_hash,updated_at=excluded.updated_at WHERE web_evaluation.revision=?`)
  .bind(teacher.id,kind,scopeId,JSON.stringify(context),payload,body.operationId,hash,now,...rosterArgs,...(source?[teacher.id,source.snapshot,teacher.id,scopeId,source.revision,teacher.id,scopeId,teacher.id,source.unitId,source.unitRevision]:[]),body.expectedRevision,teacher.id,kind,scopeId,body.expectedRevision,body.expectedRevision);
 const [saved]=await db.batch([statement,db.prepare('UPDATE academic_heads SET revision=revision+1 WHERE teacher_id=? AND changes()>0 AND EXISTS(SELECT 1 FROM web_evaluation WHERE teacher_id=? AND kind=? AND scope_id=? AND operation_id=?)').bind(teacher.id,teacher.id,kind,scopeId,body.operationId)]);
 if(!saved.meta.changes)fail('Los datos académicos cambiaron durante el guardado. Recarga antes de continuar.',409);
 return {records,revision:body.expectedRevision+1};
}
