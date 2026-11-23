import {AuthError} from './apps-script-auth.js';
const fail=(message,status=400)=>{throw new AuthError(message,status);};
const object=value=>value && typeof value==='object' && !Array.isArray(value);
export async function configurationReady(db) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='web_configurations'").first());
}
export async function configurationRecords(db,teacherId,snapshotId) {
  const base=snapshotId ? (await db.prepare("SELECT record_id,payload_json FROM academic_records WHERE teacher_id=? AND import_id=? AND dataset='frontend' ORDER BY record_id LIMIT 10").bind(teacherId,snapshotId).all()).results : [];
  const saved=await db.prepare('SELECT * FROM web_configurations WHERE teacher_id=?').bind(teacherId).first();
  const values=Object.fromEntries(base.map(row=>[row.record_id,JSON.parse(row.payload_json)]));
  Object.assign(values,JSON.parse(saved?.payload_json || '{}'));
  for(const key of JSON.parse(saved?.removed_json || '[]')) delete values[key];
  return {records:Object.entries(values).sort(([a],[b])=>a.localeCompare(b)).map(([id,value])=>({id,value,revision:saved?.revision || 0})),settingsRevision:saved?.revision || 0};
}
function validateShape(key,value) {
  if(['armi_areas','armi_assignments','armi_holidays_v7','armi_schedule_entries'].includes(key)) {
    const limit=key==='armi_areas'?100:key==='armi_assignments'?1000:3000;
    if(!Array.isArray(value) || value.length>limit || value.some(row=>!object(row))) fail('La configuración incluye una lista no válida o demasiado grande.');
    if(['armi_areas','armi_assignments'].includes(key)) {
      const ids=new Set();
      for(const row of value) {
        if(typeof row.id!=='string' || !row.id || row.id.length>100 || ids.has(row.id)) fail('Hay identificadores de área o asignación no válidos.');
        ids.add(row.id);
        for(const field of key==='armi_areas'?['name']:['areaId','areaName','grade','section']) if(typeof row[field]!=='string' || !row[field].trim() || row[field].length>200) fail('Completa el área, grado y sección de las asignaciones.');
      }
    }
  } else if(!object(value)) fail('La configuración debe contener un objeto válido.');
}
export async function saveConfiguration(request,db,teacher,{readJson,digest,now,validateRecord,permittedKeys}) {
  if(!await configurationReady(db)) fail('Falta activar la configuración web. Ejecuta 0006_web_configuration.sql en D1.',503);
  const body=await readJson(request,400_000);
  if(!object(body) || Object.keys(body).some(key=>!['changes','removed','expectedRevision','snapshotId','operationId'].includes(key)) || !object(body.changes) || !Array.isArray(body.removed)
    || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<0 || !(body.snapshotId===null || /^[a-f0-9]{64}$/.test(body.snapshotId)) || !/^[a-f0-9-]{36}$/.test(body.operationId || '')) fail('Configuración no válida.');
  const keys=[...Object.keys(body.changes),...body.removed];
  if(!keys.length || keys.length>permittedKeys.length || new Set(keys).size!==keys.length || keys.some(key=>!permittedKeys.includes(key))) fail('La configuración contiene claves no admitidas.');
  for(const [id,value] of Object.entries(body.changes)) {validateShape(id,value);validateRecord({dataset:'frontend',id,value});}
  const previous=await db.prepare('SELECT * FROM web_configurations WHERE teacher_id=?').bind(teacher.id).first();
  const hash=await digest(JSON.stringify(body));
  const head=await db.prepare('SELECT active_import_id FROM academic_heads WHERE teacher_id=?').bind(teacher.id).first();
  if(previous?.operation_id===body.operationId) {
    if(previous.operation_hash!==hash) fail('La operación ya se utilizó con otros datos.',409);
    return {...await configurationRecords(db,teacher.id,head?.active_import_id || null),snapshotId:head?.active_import_id || null};
  }
  if((previous?.revision || 0)!==body.expectedRevision || (head?.active_import_id || null)!==body.snapshotId) fail('La configuración cambió en otra pestaña. Recarga antes de continuar.',409);
  const values={...JSON.parse(previous?.payload_json || '{}'),...body.changes};
  const removed=new Set(JSON.parse(previous?.removed_json || '[]'));
  for(const key of Object.keys(body.changes)) removed.delete(key);
  for(const key of body.removed) {delete values[key];removed.add(key);}
  const payload=JSON.stringify(values);
  if(new TextEncoder().encode(payload).byteLength>524_288) fail('La configuración supera el tamaño admitido.');
  await db.batch([
    db.prepare('INSERT INTO academic_heads(teacher_id,revision) VALUES(?,0) ON CONFLICT(teacher_id) DO NOTHING').bind(teacher.id),
    db.prepare(`INSERT INTO web_configurations(teacher_id,payload_json,removed_json,revision,operation_id,operation_hash,updated_at)
      SELECT ?,?,?,1,?,?,? WHERE EXISTS(SELECT 1 FROM academic_heads WHERE teacher_id=? AND active_import_id IS ?)
      AND (?=0 OR EXISTS(SELECT 1 FROM web_configurations WHERE teacher_id=? AND revision=?))
      ON CONFLICT(teacher_id) DO UPDATE SET payload_json=excluded.payload_json,removed_json=excluded.removed_json,revision=web_configurations.revision+1,
      operation_id=excluded.operation_id,operation_hash=excluded.operation_hash,updated_at=excluded.updated_at WHERE web_configurations.revision=?`)
      .bind(teacher.id,payload,JSON.stringify([...removed]),body.operationId,hash,now,teacher.id,body.snapshotId,body.expectedRevision,teacher.id,body.expectedRevision,body.expectedRevision),
    db.prepare('UPDATE academic_heads SET revision=revision+1 WHERE teacher_id=? AND changes()>0 AND EXISTS(SELECT 1 FROM web_configurations WHERE teacher_id=? AND operation_id=?)').bind(teacher.id,teacher.id,body.operationId),
  ]);
  const stored=await db.prepare('SELECT operation_id FROM web_configurations WHERE teacher_id=?').bind(teacher.id).first();
  if(stored?.operation_id!==body.operationId) fail('La configuración cambió durante el guardado. Recarga antes de continuar.',409);
  return {...await configurationRecords(db,teacher.id,body.snapshotId),snapshotId:body.snapshotId};
}
