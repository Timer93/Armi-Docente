import {AuthError} from './apps-script-auth.js';
const fail=(message,status=400)=>{throw new AuthError(message,status);};
const API='https://www.googleapis.com/drive/v3/';
export async function automaticSyncReady(db){
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('web_sync_outbox','web_sync_deliveries','web_sync_setup')").all()).results;
 if(tables.length!==3||!await db.prepare('SELECT 1 FROM web_sync_setup WHERE version=1').first())return false;
 return (await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('sync_academic_edits_insert','sync_academic_edits_update','sync_planning_edits_insert','sync_planning_edits_update','sync_web_configurations_insert','sync_web_configurations_update','sync_web_instruments_insert','sync_web_instruments_update','sync_web_evaluation_insert','sync_web_evaluation_update')").all()).results.length===10;
}
export async function automaticSyncStatus(db,teacherId){
 if(!await automaticSyncReady(db))return {ready:false,pending:0,lastSentAt:null,desktopConfirmed:false};
 const pending=(await db.prepare('SELECT COUNT(*) AS total FROM web_sync_outbox WHERE teacher_id=?').bind(teacherId).first()).total;
 const delivery=await db.prepare('SELECT last_sent_at,last_error FROM web_sync_deliveries WHERE teacher_id=?').bind(teacherId).first();
 return {ready:true,pending,lastSentAt:delivery?.last_sent_at||null,error:delivery?.last_error||'',desktopConfirmed:false};
}

// These packets are separate from incremental-v1. Never claim desktop receipt
// until a compatible desktop bridge has validated/applied them and acknowledged.
export async function publishAutomaticChanges(env,teacher,row,token,{now,requester,remote,readRemoteJson,unchanged,digest}){
 const db=env.DB;
 if(!await automaticSyncReady(db))fail('Falta preparar la sincronización automática. Contacta al administrador.',503);
 if(!row.folder_id)fail('Conecta tu carpeta de Drive para enviar los cambios pendientes.',409);
 const pending=(await db.prepare('SELECT * FROM web_sync_outbox WHERE teacher_id=? ORDER BY id LIMIT 20').bind(teacher.id).all()).results;
 let state=await db.prepare('SELECT * FROM web_sync_deliveries WHERE teacher_id=?').bind(teacher.id).first();
 if(!pending.length&&!state?.packet_json)return {sent:0,...await automaticSyncStatus(db,teacher.id)};
 const headers={authorization:`Bearer ${token}`};
 const generate=async()=>{
  const result=await readRemoteJson(await remote(requester,API+'files/generateIds?count=1&space=drive&type=files',{headers}));
  if(!/^[a-zA-Z0-9_-]{10,200}$/.test(result.ids?.[0]||''))fail('Google no pudo preparar el envío.',502);
  return result.ids[0];
 };
 if(!state){
  const lookup=new URL(API+'files');lookup.search=new URLSearchParams({q:`'${row.folder_id}' in parents and trashed = false and name = 'ARMI Web Sync'`,fields:'nextPageToken,files(id,mimeType,appProperties)',pageSize:'2',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
  const existing=await readRemoteJson(await remote(requester,lookup.href,{headers}));
  if(existing.nextPageToken||existing.files?.length>1)fail('Hay carpetas de intercambio duplicadas. Revisa tu carpeta de Drive.',409);
  const shared=existing.files?.[0];
  if(shared&&(shared.mimeType!=='application/vnd.google-apps.folder'||shared.appProperties?.armiTeacher&&shared.appProperties.armiTeacher!==teacher.id||!shared.appProperties?.armiTeacher&&!row.mirror_verified))fail('No se pudo verificar la carpeta de intercambio.',409);
  const id=shared?.id||await generate();
  await db.prepare('INSERT OR IGNORE INTO web_sync_deliveries(teacher_id,root_id,folder_id) VALUES(?,?,?)').bind(teacher.id,row.folder_id,id).run();
  state=await db.prepare('SELECT * FROM web_sync_deliveries WHERE teacher_id=?').bind(teacher.id).first();
 }
 if(state.root_id!==row.folder_id)fail('La carpeta cambió y hay un historial de envíos anterior. Revisa la conexión con soporte antes de continuar.',409);
 const lease=crypto.randomUUID();
 const acquired=await db.prepare('UPDATE web_sync_deliveries SET lease_token=?,lease_until=? WHERE teacher_id=? AND lease_until<=?').bind(lease,now+120000,teacher.id,now).run();
 if(!acquired.meta.changes)return {busy:true,...await automaticSyncStatus(db,teacher.id)};
 state=await db.prepare('SELECT * FROM web_sync_deliveries WHERE teacher_id=?').bind(teacher.id).first();
 const metadata=async id=>{
  const response=await remote(requester,API+'files/'+id+'?fields=id,name,mimeType,parents,trashed,size,sha256Checksum,appProperties&supportsAllDrives=true',{headers},false,[404]);
  if(response.status===404){await response.body?.cancel();return null;}
  return readRemoteJson(response);
 };
 const create=async(body,contentType,url)=>{
  const response=await remote(requester,url,{method:'POST',headers:{...headers,'content-type':contentType},body},false,[409]);await response.body?.cancel();
 };
 try{
  await unchanged(db,row);
  let folder=await metadata(state.folder_id);
  if(!folder){
   await create(JSON.stringify({id:state.folder_id,name:'ARMI Web Sync',mimeType:'application/vnd.google-apps.folder',parents:[row.folder_id],appProperties:{armiTeacher:teacher.id,armiRole:'web-sync'}}),'application/json',API+'files?supportsAllDrives=true&fields=id');
   folder=await metadata(state.folder_id);
  }
  if(!folder||folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||folder.parents?.length!==1||folder.parents[0]!==row.folder_id||(folder.appProperties?.armiTeacher?folder.appProperties.armiTeacher!==teacher.id||folder.appProperties.armiRole!=='web-sync':!row.mirror_verified))fail('La carpeta de intercambio cambió. No se reemplazaron archivos.',409);
  if(!state.packet_json){
   const records=[];let bytes=0;
   for(const item of pending){const size=new TextEncoder().encode(item.before_json+item.after_json).length;if(bytes+size>1_000_000&&records.length)break;if(size>1_000_000)fail('Un cambio es demasiado grande para este envío.',413);bytes+=size;records.push(item);}
   const packetId=crypto.randomUUID(),fileId=await generate();
   const portable=[];
   const studentIdentities={};
   const studentIds=new Set();
   for(const item of records){
    let before=JSON.parse(item.before_json);const after=JSON.parse(item.after_json);
    if(before===null&&['general','students','annual','units','sessions'].includes(item.kind)){
     const base=await db.prepare('SELECT r.payload_json FROM academic_records r JOIN academic_heads h ON h.teacher_id=r.teacher_id AND h.active_import_id=r.import_id WHERE r.teacher_id=? AND r.dataset=? AND r.record_id=?').bind(teacher.id,item.kind,item.record_key).first();
     if(base)before={deleted:0,value:JSON.parse(base.payload_json)};
    }
    if(item.kind==='configuration'){
     const base=(await db.prepare("SELECT r.record_id,r.payload_json FROM academic_records r JOIN academic_heads h ON h.teacher_id=r.teacher_id AND h.active_import_id=r.import_id WHERE r.teacher_id=? AND r.dataset='frontend'").bind(teacher.id).all()).results;
     const initial=Object.fromEntries(base.map(r=>[r.record_id,JSON.parse(r.payload_json)]));
     before={deleted:0,value:{...initial,...before?.value}};
    }
    if(['grades','conclusions'].includes(item.kind))for(const value of [...(before?.value||[]),...(after.value||[])]){
     const id=value.student_id||value.studentId;if(id)studentIds.add(String(id));
    }
    portable.push({sequence:item.id,kind:item.kind,key:item.record_key,before,after,revision:item.revision,updatedAt:item.updated_at});
   }
   if(studentIds.size){
    const roster=(await db.prepare("SELECT ids.value AS id,COALESCE(e.payload_json,b.payload_json) AS payload_json FROM json_each(?) ids JOIN academic_heads h ON h.teacher_id=? LEFT JOIN academic_edits e ON e.teacher_id=h.teacher_id AND e.dataset='students' AND e.record_id=ids.value LEFT JOIN academic_records b ON b.teacher_id=h.teacher_id AND b.import_id=h.active_import_id AND b.dataset='students' AND b.record_id=ids.value WHERE COALESCE(e.deleted,0)=0").bind(JSON.stringify([...studentIds]),teacher.id).all()).results;
    for(const student of roster)if(student.payload_json)studentIdentities[student.id]={dni:JSON.parse(student.payload_json).dni||''};
   }
   const packet=JSON.stringify({format:'armi-web-changes',version:1,packetId,ownerUsername:teacher.provider_username,syncUserKey:JSON.parse(teacher.membership_json||'{}').syncUserKey||teacher.provider_username,createdAt:new Date(now).toISOString(),studentIdentities,records:portable});
   if(new TextEncoder().encode(packet).length>1_400_000)fail('El lote de cambios supera el tamaño de recepción. Los datos permanecen guardados en la web.',413);
   const saved=await db.prepare('UPDATE web_sync_deliveries SET file_id=?,packet_id=?,packet_json=?,outbox_ids_json=? WHERE teacher_id=? AND lease_token=? AND packet_json IS NULL').bind(fileId,packetId,packet,JSON.stringify(records.map(item=>item.id)),teacher.id,lease).run();
   if(!saved.meta.changes)fail('Otro envío cambió el estado. Conservamos los cambios pendientes.',409);
   state={...state,file_id:fileId,packet_id:packetId,packet_json:packet,outbox_ids_json:JSON.stringify(records.map(item=>item.id))};
  }
  const hash=await digest(state.packet_json);let file=await metadata(state.file_id);
  if(!file){
   const boundary='armi_'+crypto.randomUUID().replaceAll('-','');
   const details={id:state.file_id,name:state.packet_id+'.json',mimeType:'application/json',parents:[state.folder_id],appProperties:{armiTeacher:teacher.id,armiPacket:state.packet_id,armiSha256:hash}};
   await create(new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(details)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${state.packet_json}\r\n--${boundary}--\r\n`]),`multipart/related; boundary=${boundary}`,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id');
   file=await metadata(state.file_id);
  }
  if(!file||file.trashed||file.parents?.length!==1||file.parents[0]!==state.folder_id||file.appProperties?.armiTeacher!==teacher.id||file.appProperties?.armiPacket!==state.packet_id||file.appProperties?.armiSha256!==hash||Number(file.size)!==new TextEncoder().encode(state.packet_json).length||(file.sha256Checksum&&file.sha256Checksum!==hash))fail('No pudimos verificar el envío. Los cambios siguen pendientes.',502);
  await unchanged(db,row);
  const guard='EXISTS(SELECT 1 FROM drive_connections WHERE teacher_id=? AND revision=? AND folder_id=?)';
  const results=await db.batch([
   db.prepare(`DELETE FROM web_sync_outbox WHERE teacher_id=? AND id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM web_sync_deliveries WHERE teacher_id=? AND lease_token=?) AND ${guard}`).bind(teacher.id,state.outbox_ids_json,teacher.id,lease,teacher.id,row.revision,row.folder_id),
   db.prepare(`UPDATE web_sync_deliveries SET file_id=NULL,packet_json=NULL,outbox_ids_json=NULL,lease_token=NULL,lease_until=0,last_sent_at=?,last_error='' WHERE teacher_id=? AND lease_token=? AND ${guard}`).bind(now,teacher.id,lease,teacher.id,row.revision,row.folder_id),
  ]);
  if(!results[1].meta.changes)fail('La conexión cambió. El envío se conserva para comprobarlo.',409);
  return {sent:JSON.parse(state.outbox_ids_json).length,...await automaticSyncStatus(db,teacher.id)};
 }catch(error){
  await db.prepare("UPDATE web_sync_deliveries SET last_error='No se confirmó el envío. Los cambios permanecen guardados en la web.',lease_token=NULL,lease_until=0 WHERE teacher_id=? AND lease_token=?").bind(teacher.id,lease).run();throw error;
 }
}

export async function checkDesktopReceipt(db,teacher,row,token,{requester,remote,readRemoteJson,list,unchanged}){
 const state=await db.prepare('SELECT root_id,folder_id,packet_id,packet_json FROM web_sync_deliveries WHERE teacher_id=?').bind(teacher.id).first();
 if(!state?.packet_id||state.packet_json||state.root_id!==row.folder_id)return {desktopConfirmed:false};
 const directories=await list(requester,token,state.folder_id,'','receipts');
 if(directories.files?.length!==1)return {desktopConfirmed:false};
 const directory=directories.files[0];if(directory.mimeType!=='application/vnd.google-apps.folder')return {desktopConfirmed:false};
 const files=await list(requester,token,directory.id,'',state.packet_id+'.json');
 if(files.files?.length!==1)return {desktopConfirmed:false};
 const file=files.files[0];if(file.mimeType!=='application/json'||!Number.isFinite(Number(file.size))||Number(file.size)>30000)fail('La confirmación de Windows no es válida.',409);
 const receipt=await readRemoteJson(await remote(requester,API+'files/'+file.id+'?alt=media&supportsAllDrives=true',{headers:{authorization:`Bearer ${token}`}}),30000);
 const expected=JSON.parse(teacher.membership_json||'{}').syncUserKey||teacher.provider_username;
 if(receipt.format!=='armi-desktop-receipt'||receipt.version!==1||receipt.packetId!==state.packet_id||String(receipt.syncUserKey).toLowerCase()!==String(expected).toLowerCase()||!Array.isArray(receipt.outcomes)||receipt.outcomes.length>20||receipt.outcomes.some(r=>!['applied','already-applied','conflict'].includes(r.status)))fail('No se pudo verificar la confirmación de Windows.',409);
 await unchanged(db,row);
 const conflicts=receipt.outcomes.filter(r=>r.status==='conflict').length;
 return {desktopConfirmed:conflicts===0,desktopConflicts:conflicts,desktopChecked:true};
}
