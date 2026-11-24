import {AuthError} from './apps-script-auth.js';
import {serviceLimit} from './ai.js';
const fail=(message,status=400,diagnostic)=>{const error=new AuthError(message,status);if(diagnostic)error.driveDiagnostic=diagnostic;throw error;};
const SCOPE='https://www.googleapis.com/auth/drive.file';
const API='https://www.googleapis.com/drive/v3/';
const FOLDER='application/vnd.google-apps.folder';
const fileId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{10,200}$/.test(value);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=value=>Uint8Array.from(value.match(/../g)||[],x=>parseInt(x,16));
const scopeKey=value=>String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
export async function driveReady(db){return (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('drive_connections','drive_oauth_states')").all()).results.length===2;}
function config(env){
 try{
  const redirect=new URL(env.ARMI_DRIVE_REDIRECT_URI||'https://web.armiapp.com/api/drive/oauth/callback');
  if(!/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(env.ARMI_GOOGLE_CLIENT_ID||'')||typeof env.ARMI_GOOGLE_CLIENT_SECRET!=='string'||env.ARMI_GOOGLE_CLIENT_SECRET.length<16||!/^[a-f0-9]{64}$/i.test(env.ARMI_DRIVE_ENCRYPTION_KEY||'')||redirect.pathname!=='/api/drive/oauth/callback'||redirect.search||redirect.hash||redirect.username||redirect.password||!(redirect.protocol==='https:'||(env.ARMI_ENV==='local'&&redirect.protocol==='http:'&&redirect.hostname==='127.0.0.1')))return null;
  return {redirect:redirect.href,origin:redirect.origin};
 }catch{return null;}
}
async function cryptKey(env){return crypto.subtle.importKey('raw',unhex(env.ARMI_DRIVE_ENCRYPTION_KEY),'AES-GCM',false,['encrypt','decrypt']);}
async function seal(env,aad,value){const iv=crypto.getRandomValues(new Uint8Array(12));return {cipher:hex(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},await cryptKey(env),new TextEncoder().encode(JSON.stringify(value))))),iv:hex(iv)};}
async function open(env,aad,cipher,iv){try{return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(iv),additionalData:new TextEncoder().encode(aad)},await cryptKey(env),unhex(cipher))));}catch{fail('No se pudo abrir la conexión guardada. Conecta nuevamente tu cuenta de Google.',503);}}
async function remote(requester,url,options={},oauthToken=false){
 try{
  const response=await requester(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok){
   if(oauthToken){
    // Only interpret known error identifiers; never expose descriptions or bodies.
    let payload;try{payload=await readRemoteJson(response,16384);}catch{}
    if(['invalid_client','unauthorized_client'].includes(payload?.error))fail('Google no aceptó las credenciales OAuth de ARMI.',502,'DRIVE-CREDENCIALES');
    if(payload?.error==='invalid_grant')fail('La autorización de Google ya no es válida. Conecta de nuevo.',400,'DRIVE-AUTORIZACION');
   }else await response.body?.cancel();
   fail(response.status===429?'Google Drive alcanzó su cuota. Intenta más tarde.':response.status===401?'Vuelve a conectar tu cuenta de Google.':'Google Drive no permitió completar la operación. Revisa los permisos de la cuenta.',response.status===429?429:502);
  }
  return response;
 }catch(error){if(error instanceof AuthError)throw error;fail('Google Drive no respondió. Tus datos guardados no se modificaron.',502);}
}
async function readRemoteJson(response,limit=1000000){
 const reader=response.body.getReader(),chunks=[];let total=0;
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();fail('La respuesta de Drive supera el tamaño permitido.',502);}chunks.push(value);}
 const data=new Uint8Array(total);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(data));}catch{fail('Google Drive no devolvió una respuesta válida.',502);}
}
async function tokenRequest(env,requester,values){
 const response=await remote(requester,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.ARMI_GOOGLE_CLIENT_ID,client_secret:env.ARMI_GOOGLE_CLIENT_SECRET,...values}).toString()},true);
 const payload=await readRemoteJson(response);
 if(typeof payload.access_token!=='string'||!payload.access_token||payload.access_token.length>4096||!Number.isFinite(Number(payload.expires_in))||Number(payload.expires_in)<=0||(payload.scope&&(!payload.scope.split(' ').includes(SCOPE)||payload.scope.split(' ').some(scope=>scope==='https://www.googleapis.com/auth/drive'||scope==='https://www.googleapis.com/auth/drive.readonly'))))fail('Google no concedió únicamente los permisos limitados solicitados. Revisa la configuración del cliente OAuth.',502);
 return payload;
}
async function accessToken(env,row,requester,now){
 const value=await open(env,`${row.teacher_id}:drive`,row.token_cipher,row.token_iv);
 if(value.expiresAt>now+60000)return value.access;
 const payload=await tokenRequest(env,requester,{grant_type:'refresh_token',refresh_token:value.refresh});
 const saved=await seal(env,`${row.teacher_id}:drive`,{access:payload.access_token,refresh:payload.refresh_token||value.refresh,expiresAt:now+Number(payload.expires_in)*1000});
 const result=await env.DB.prepare('UPDATE drive_connections SET token_cipher=?,token_iv=? WHERE teacher_id=? AND revision=?').bind(saved.cipher,saved.iv,row.teacher_id,row.revision).run();
 if(!result.meta.changes)fail('La conexión cambió en otra pestaña. Abre nuevamente el panel.',409);
 return payload.access_token;
}
const metadata=async(requester,token,id)=>{
 if(!fileId(id))fail('Identificador de Drive no válido.');
 const url=new URL(API+'files/'+id);url.search=new URLSearchParams({fields:'id,name,mimeType,parents,trashed,size,modifiedTime',supportsAllDrives:'true'});
 const file=await readRemoteJson(await remote(requester,url.href,{headers:{authorization:`Bearer ${token}`}}));
 if(file.trashed||file.mimeType==='application/vnd.google-apps.shortcut')fail('El archivo fue eliminado o es un acceso directo no compatible.',404);
 return file;
};
async function within(requester,token,id,root,cache=new Map()){
 const read=async key=>{if(!cache.has(key))cache.set(key,await metadata(requester,token,key));return cache.get(key);};
 const original=await read(id);let current=original;const seen=new Set();
 for(let depth=0;depth<24;depth++){
  if(current.id===root)return original;
  if(seen.has(current.id)||!Array.isArray(current.parents)||current.parents.length!==1)break;
  seen.add(current.id);current=await read(current.parents[0]);
 }
 fail('Este archivo no pertenece a la carpeta vinculada a tu cuenta de ARMI.',403);
}
async function list(requester,token,parent,pageToken='',name=''){
 const url=new URL(API+'files');url.search=new URLSearchParams({q:`'${parent}' in parents and trashed = false${name?` and name = '${name}'`:''}`,fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime)',pageSize:name?'2':'50',orderBy:'folder,name',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(pageToken?{pageToken}:{})});
 return readRemoteJson(await remote(requester,url.href,{headers:{authorization:`Bearer ${token}`}}));
}
function folderInput(value){
 if(fileId(value))return value;
 try{const url=new URL(value);if(url.protocol==='https:'&&url.hostname==='drive.google.com'&&!url.username&&!url.password){const id=url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1];if(fileId(id))return id;}}catch{}
 fail('Pega el enlace de la carpeta de Google Drive que usa este docente.');
}
async function unchanged(db,row){if(!await db.prepare('SELECT 1 FROM drive_connections WHERE teacher_id=? AND revision=?').bind(row.teacher_id,row.revision).first())fail('La conexión cambió en otra pestaña. Abre nuevamente el panel.',409);}

export async function driveRoute(request,env,teacher,{readJson,digest,randomToken,now,requester}){
 const url=new URL(request.url),db=env.DB,ready=await driveReady(db),settings=config(env);
 if(url.pathname==='/api/drive/profile'&&request.method==='GET'){
  const row=ready?await db.prepare('SELECT google_email,folder_id,folder_name,mirror_verified,revision FROM drive_connections WHERE teacher_id=?').bind(teacher.id).first():null;
  return Response.json({success:true,data:{ready,configured:Boolean(settings),pickerConfigured:/^AIza[a-zA-Z0-9_-]{20,100}$/.test(env.ARMI_GOOGLE_PICKER_API_KEY||'')&&/^\d{6,30}$/.test(env.ARMI_GOOGLE_PROJECT_NUMBER||''),connected:Boolean(row),email:row?.google_email||'',suggestedFolder:JSON.parse(teacher.membership_json||'{}').driveFolderUrl||'',folder:row?.folder_id?{id:row.folder_id,name:row.folder_name,mirrorVerified:Boolean(row.mirror_verified)}:null,revision:row?.revision||0,readOnly:true,limitedAccess:true}});
 }
 if(!ready)fail('Falta activar 0012_drive_connection.sql en D1.',503,'DRIVE-DATOS');
 if(!settings)fail('El administrador debe configurar la conexión de Google Drive para ARMI Web.',503,'DRIVE-CONFIG');
 if(url.origin!==settings.origin)fail('Abre ARMI desde el dominio configurado para conectar Google Drive.',400);
 const row=await db.prepare('SELECT * FROM drive_connections WHERE teacher_id=?').bind(teacher.id).first();
 if(url.pathname==='/api/drive/connect'&&request.method==='POST'){
  const body=await readJson(request);if(Object.keys(body).length)fail('Configuración de conexión no válida.');
  await serviceLimit(db,`drive-connect:${teacher.id}:${Math.floor(now/60000)}`,3,now+120000);
  const state=randomToken(),stateHash=await digest(state),verifier=randomToken();
  const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const sealed=await seal(env,`${teacher.id}:drive-state:${stateHash}`,verifier);
  await db.batch([db.prepare('DELETE FROM drive_oauth_states WHERE teacher_id=? OR expires_at<=?').bind(teacher.id,now),db.prepare('INSERT INTO drive_oauth_states(state_hash,teacher_id,session_hash,verifier_cipher,verifier_iv,connection_revision,expires_at) VALUES(?,?,?,?,?,?,?)').bind(stateHash,teacher.id,teacher.token_hash,sealed.cipher,sealed.iv,row?.revision||0,now+600000)]);
  const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');auth.search=new URLSearchParams({client_id:env.ARMI_GOOGLE_CLIENT_ID,redirect_uri:settings.redirect,response_type:'code',scope:SCOPE+' openid email',state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account'});
  return Response.json({success:true,data:{authorizationUrl:auth.href}});
 }
 if(url.pathname==='/api/drive/oauth/callback'&&request.method==='GET'){
  let stage='DRIVE-AUTORIZACION';
  try{
  const state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!/^[a-f0-9]{64}$/.test(state||''))fail('La autorización de Google no es válida. Vuelve a conectar tu cuenta.');
  const stateHash=await digest(state);
  const pending=await db.prepare('DELETE FROM drive_oauth_states WHERE state_hash=? AND teacher_id=? AND session_hash=? AND expires_at>? RETURNING *').bind(stateHash,teacher.id,teacher.token_hash,now).first();
  if(!pending)fail('La autorización venció o pertenece a otra sesión. Vuelve a conectar tu cuenta.');
  if(url.searchParams.has('error')||!code||code.length>4096)fail('La autorización de Google fue cancelada. Puedes volver a intentarlo.',400,'DRIVE-CANCELADO');
  if(pending.connection_revision!==(row?.revision||0))fail('La conexión cambió en otra pestaña. Vuelve a abrir el panel.',409);
  stage='DRIVE-CIFRADO';
  const verifier=await open(env,`${teacher.id}:drive-state:${stateHash}`,pending.verifier_cipher,pending.verifier_iv);
  stage='DRIVE-TOKEN';
  const tokens=await tokenRequest(env,requester,{grant_type:'authorization_code',code,redirect_uri:settings.redirect,code_verifier:verifier});
  stage='DRIVE-PERMISOS';
  if(!tokens.scope?.split(' ').includes(SCOPE))fail('Google no confirmó el permiso limitado para archivos seleccionados.',502);
  if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token||tokens.refresh_token.length>4096)fail('Google no concedió acceso persistente. Vuelve a conectar y autoriza el acceso.',502);
  stage='DRIVE-IDENTIDAD';
  const account=await readRemoteJson(await remote(requester,'https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${tokens.access_token}`}}));
  if(typeof account.sub!=='string'||typeof account.email!=='string'||account.email_verified!==true)fail('Google no devolvió la identidad verificada de la cuenta.',502);
  const info={user:{permissionId:account.sub,emailAddress:account.email}};
  stage='DRIVE-CIFRADO';
  const sealed=await seal(env,`${teacher.id}:drive`,{access:tokens.access_token,refresh:tokens.refresh_token,expiresAt:now+Number(tokens.expires_in)*1000});
  stage='DRIVE-GUARDADO';
  const saved=await db.prepare(`INSERT INTO drive_connections(teacher_id,google_account_id,google_email,token_cipher,token_iv,updated_at) SELECT ?,?,?,?,?,? WHERE ?=0
   ON CONFLICT(teacher_id) DO UPDATE SET google_account_id=excluded.google_account_id,google_email=excluded.google_email,token_cipher=excluded.token_cipher,token_iv=excluded.token_iv,folder_id=CASE WHEN drive_connections.google_account_id=excluded.google_account_id THEN drive_connections.folder_id ELSE NULL END,folder_name=CASE WHEN drive_connections.google_account_id=excluded.google_account_id THEN drive_connections.folder_name ELSE '' END,mirror_verified=CASE WHEN drive_connections.google_account_id=excluded.google_account_id THEN drive_connections.mirror_verified ELSE 0 END,revision=drive_connections.revision+1,updated_at=excluded.updated_at WHERE drive_connections.revision=?`).bind(teacher.id,info.user.permissionId,info.user.emailAddress,sealed.cipher,sealed.iv,now,row?.revision||0,row?.revision||0).run();
  // Updating an existing connection needs a real row in the guarded INSERT.
  if(!saved.meta.changes&&row){const updated=await db.prepare('UPDATE drive_connections SET google_account_id=?,google_email=?,token_cipher=?,token_iv=?,folder_id=CASE WHEN google_account_id=? THEN folder_id ELSE NULL END,folder_name=CASE WHEN google_account_id=? THEN folder_name ELSE \'\' END,mirror_verified=CASE WHEN google_account_id=? THEN mirror_verified ELSE 0 END,revision=revision+1,updated_at=? WHERE teacher_id=? AND revision=?').bind(info.user.permissionId,info.user.emailAddress,sealed.cipher,sealed.iv,info.user.permissionId,info.user.permissionId,info.user.permissionId,now,teacher.id,row.revision).run();if(!updated.meta.changes)fail('La conexión cambió en otra pestaña. Intenta nuevamente.',409);}
  else if(!saved.meta.changes)fail('La conexión cambió en otra pestaña. Intenta nuevamente.',409);
  return new Response(null,{status:302,headers:{location:'/?armi-drive=connected'}});
  }catch(error){if(!error.driveDiagnostic)error.driveDiagnostic=stage;throw error;}
 }
 if(!row)fail('Conecta tu cuenta de Google antes de continuar.');
 if(url.pathname==='/api/drive/connection'&&request.method==='DELETE'){
  const body=await readJson(request);if(Object.keys(body).some(k=>k!=='revision')||body.revision!==row.revision)fail('La conexión cambió. Recarga su estado.',409);
  const removed=await db.prepare('DELETE FROM drive_connections WHERE teacher_id=? AND revision=?').bind(teacher.id,row.revision).run();if(!removed.meta.changes)fail('La conexión cambió. Recarga su estado.',409);
  await db.prepare('DELETE FROM drive_oauth_states WHERE teacher_id=?').bind(teacher.id).run();return Response.json({success:true,data:{disconnected:true}});
 }
 await serviceLimit(db,`drive-read:${teacher.id}:${Math.floor(now/60000)}`,120,now+120000);
 const token=await accessToken(env,row,requester,now);
 if(url.pathname==='/api/drive/picker'&&request.method==='GET')return env.ASSETS.fetch(new Request(new URL('/drive-picker.html',url),request));
 if(url.pathname==='/api/drive/picker-config'&&request.method==='GET'){
  if(!/^AIza[a-zA-Z0-9_-]{20,100}$/.test(env.ARMI_GOOGLE_PICKER_API_KEY||'')||!/^\d{6,30}$/.test(env.ARMI_GOOGLE_PROJECT_NUMBER||''))fail('El administrador debe completar la configuración del selector de Google.',503);
  // Only the teacher's isolated Picker page receives a short-lived, per-file
  // access token. Never return refresh tokens or pass tokens to the parent page.
  return Response.json({success:true,data:{accessToken:token,developerKey:env.ARMI_GOOGLE_PICKER_API_KEY,appId:env.ARMI_GOOGLE_PROJECT_NUMBER,folderId:row.folder_id||null}});
 }
 if(url.pathname==='/api/drive/folder'&&request.method==='PUT'){
  const body=await readJson(request);if(Object.keys(body).some(k=>!['folder','revision'].includes(k))||body.revision!==row.revision)fail('La conexión cambió. Recarga su estado.',409);
  const id=folderInput(body.folder),folder=await metadata(requester,token,id);if(folder.mimeType!==FOLDER)fail('Selecciona una carpeta, no un archivo.');
  const markers=await list(requester,token,id,'','.armi-sync-root.json');let verified=false;
  if(markers.files?.length){
   if(markers.files.length!==1||Number(markers.files[0].size)>16384)fail('La carpeta contiene una identidad de sincronización ambigua. Revisa la carpeta del docente.');
   if(!fileId(markers.files[0].id))fail('La identidad de la carpeta no es válida.');
   const marker=await readRemoteJson(await remote(requester,API+'files/'+markers.files[0].id+'?alt=media&supportsAllDrives=true',{headers:{authorization:`Bearer ${token}`}}),16384);
   const expected=JSON.parse(teacher.membership_json||'{}').syncUserKey||teacher.provider_username;
   if(!marker.syncUserKey||scopeKey(marker.syncUserKey)!==scopeKey(expected))fail('Esta carpeta espejo pertenece a otro usuario de ARMI.',403);
   verified=true;
  }
  const collision=await db.prepare('SELECT 1 FROM drive_connections WHERE folder_id=? AND teacher_id<>?').bind(id,teacher.id).first();if(collision)fail('Esta carpeta ya está vinculada a otra cuenta de ARMI.',409);
  const changed=await db.prepare('UPDATE drive_connections SET folder_id=?,folder_name=?,mirror_verified=?,revision=revision+1,updated_at=? WHERE teacher_id=? AND revision=?').bind(id,String(folder.name||'Carpeta').slice(0,300),Number(verified),now,teacher.id,row.revision).run();
  if(!changed.meta.changes)fail('La conexión cambió en otra pestaña. Recarga su estado.',409);
  return Response.json({success:true,data:{linked:true,mirrorVerified:verified}});
 }
 if(!row.folder_id)fail('Vincula primero la carpeta que usa este docente.');
 if(url.pathname==='/api/drive/selection'&&request.method==='POST'){
  const body=await readJson(request,30000);if(Object.keys(body).some(key=>key!=='ids')||!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>20||body.ids.some(id=>!fileId(id)))fail('Selecciona entre 1 y 20 archivos o carpetas por vez.');
  const cache=new Map();for(const id of new Set(body.ids))await within(requester,token,id,row.folder_id,cache);
  await unchanged(db,row);return Response.json({success:true,data:{authorizedCount:new Set(body.ids).size}});
 }
 if(url.pathname==='/api/drive/files'&&request.method==='GET'){
  const parent=url.searchParams.get('parent')||row.folder_id,page=url.searchParams.get('pageToken')||'';if(page.length>2048)fail('Página no válida.');
  const directory=await within(requester,token,parent,row.folder_id);if(directory.mimeType!==FOLDER)fail('La ruta no es una carpeta.');
  const result=await list(requester,token,parent,page);await unchanged(db,row);
  return Response.json({success:true,data:{folder:{id:parent,name:directory.name},limitedAccess:true,files:(result.files||[]).map(file=>({id:file.id,name:file.name,mimeType:file.mimeType,size:file.size||null,modifiedTime:file.modifiedTime||null})),nextPageToken:result.nextPageToken||null}});
 }
 if(url.pathname==='/api/drive/content'&&request.method==='GET'){
  const id=url.searchParams.get('file'),file=await within(requester,token,id,row.folder_id);
  if(file.mimeType.startsWith('application/vnd.google-apps.'))fail('La vista de documentos nativos de Google todavía no está conectada.');
  if(!Number.isFinite(Number(file.size))||Number(file.size)>100000000)fail('Esta etapa permite descargar archivos de hasta 100 MB.');
  await unchanged(db,row);const response=await remote(requester,API+'files/'+id+'?alt=media&supportsAllDrives=true',{headers:{authorization:`Bearer ${token}`}});
  const preview=url.searchParams.get('preview')==='1'&&['image/png','image/jpeg','image/webp','image/gif','application/pdf'].includes(file.mimeType);
  return new Response(response.body,{headers:{'content-type':preview?file.mimeType:'application/octet-stream','content-disposition':`${preview?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name||'archivo').replace(/'/g,'%27')}`,'cache-control':'no-store'}});
 }
 fail('Operación de Drive no disponible.',404);
}
