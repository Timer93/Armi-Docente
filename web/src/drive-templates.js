import {AuthError} from './apps-script-auth.js';
const fail=(message,status=409)=>{throw new AuthError(message,status);};
const normalize=v=>String(v||'').trim().toLowerCase();
export async function readDriveTemplates(teacher,row,token,sessionId,{list,remote,readRemoteJson,digest,requester,unchanged,db}){
 if(!sessionId||sessionId.length>250||/[\x00-\x1f]/.test(sessionId))fail('Selecciona una sesión guardada.',400);
 if(!row.folder_id||!row.mirror_verified)fail('Vincula la carpeta de sincronización de este docente para consultar sus plantillas.');
 const child=async(parent,name,folder=false)=>{
  const result=await list(requester,token,parent,'',name),files=result.files||[];
  if(files.length>1||result.nextPageToken)fail('Hay más de una carpeta o archivo con ese nombre. Revisa tu carpeta de trabajo.');
  const file=files[0];if(!file)return null;
  if(!/^[a-zA-Z0-9_-]{10,200}$/.test(file.id)||folder&&file.mimeType!=='application/vnd.google-apps.folder'||!folder&&file.mimeType!=='application/json')fail('El catálogo de plantillas no tiene el formato esperado.');
  return file;
 };
 const sync=await child(row.folder_id,'ARMI Web Sync',true),folder=sync&&await child(sync.id,'templates',true),indexFile=folder&&await child(folder.id,'index.json');
 if(!indexFile)return {pending:true,templates:[],message:'Abre ARMI de Windows actualizado y deja que termine la sincronización para ver aquí tus plantillas.'};
 const json=async(file,max)=>{
  if(!Number.isFinite(Number(file.size))||Number(file.size)>max)fail('El catálogo supera el tamaño permitido.');
  return readRemoteJson(await remote(requester,'https://www.googleapis.com/drive/v3/files/'+file.id+'?alt=media&supportsAllDrives=true',{headers:{authorization:`Bearer ${token}`}}),max);
 };
 const identity=JSON.parse(teacher.membership_json||'{}').syncUserKey||teacher.provider_username,index=await json(indexFile,1_000_000);
 if(index.format!=='armi-template-index'||index.version!==1||normalize(index.syncUserKey)!==normalize(identity)||!Array.isArray(index.entries)||index.entries.length>10000)fail('El catálogo no corresponde a este docente.',403);
 const matches=index.entries.filter(e=>e.sessionId===sessionId);if(matches.length>1)fail('Hay plantillas de sesión duplicadas.');
 if(!matches.length)return {templates:[],evidences:[],message:'Todavía no hay plantillas sincronizadas para esta sesión.'};
 const entry=matches[0];if(!/^[a-f0-9]{64}$/.test(entry.sha256)||entry.file!==entry.sha256+'.json')fail('Referencia de plantilla no válida.');
 const file=await child(folder.id,entry.file);if(!file)return {pending:true,templates:[],message:'Drive todavía está entregando las plantillas. Vuelve a actualizar en unos momentos.'};
 const data=await json(file,2_000_000);
 if(await digest(JSON.stringify(data))!==entry.sha256||data.format!=='armi-session-templates'||data.version!==1||normalize(data.syncUserKey)!==normalize(identity)||data.sessionId!==sessionId||!Array.isArray(data.templates)||data.templates.some(t=>typeof t.html!=='string'||t.html.length>600000))fail('No se pudo verificar el contenido de las plantillas.');
 const activities=data.activities||[];if(!Array.isArray(activities)||activities.length>50||activities.some(a=>typeof a.html!=='string'||a.html.length>600000))fail('El catálogo de actividades no tiene el formato esperado.');
 await unchanged(db,row);return {templates:[...activities.map(a=>({...a,id:'activity-'+a.id,evidence_id:'activity-'+a.id,requested:{text:a.title||'Actividad'}})),...data.templates],evidences:data.evidences||[],pedagogy:data.pedagogy||{},readOnly:true};
}
