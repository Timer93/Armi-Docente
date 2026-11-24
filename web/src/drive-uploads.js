// Create-only transfers. Never edit mirror manifests, databases or existing files.
import {AuthError} from './apps-script-auth.js';
import {serviceLimit} from './ai.js';

export const MAX_DRIVE_UPLOAD_BYTES=5_000_000;
const fail=(message,status=400)=>{throw new AuthError(message,status);};
const validName=name=>typeof name==='string'&&name.length>0&&name.length<=200&&name===name.trim()&&!/[<>:"/\\|?*\x00-\x1f]/.test(name)&&!/[. ]$/.test(name)&&!name.startsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
const validMime=mime=>typeof mime==='string'&&mime.length<=150&&/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime)&&!mime.startsWith('application/vnd.google-apps.');
const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');

async function readBytes(request,expected){
 const announced=request.headers.get('content-length');
 if(announced!==null&&Number(announced)!==expected)fail('El tamaño del archivo no coincide con la subida preparada.',413);
 if(!request.body)fail('Selecciona un archivo con contenido.');
 const reader=request.body.getReader(),chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>expected||length>MAX_DRIVE_UPLOAD_BYTES){await reader.cancel();fail('El archivo supera el tamaño autorizado.',413);}chunks.push(value);}}
 catch(error){if(error instanceof AuthError)throw error;fail('La transferencia se interrumpió. Comprueba la subida antes de reintentar.',400);}
 if(length!==expected)fail('La transferencia está incompleta. Selecciona de nuevo el archivo.');
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

export async function driveUploadRoute(request,env,teacher,row,token,{readJson,now,requester,remote,readRemoteJson,seal,open,within,unchanged,fileId}){
 const path=new URL(request.url).pathname,api='https://www.googleapis.com/drive/v3/';
 const destination=async id=>{
  const cache=new Map(),folder=await within(requester,token,id,row.folder_id,cache);
  if(folder.mimeType!=='application/vnd.google-apps.folder')fail('El destino debe ser una carpeta.');
  if([...cache.values()].some(item=>String(item.name||'').startsWith('.armi')))fail('Esta carpeta contiene datos internos de ARMI. Elige una carpeta de materiales.',403);
  return folder;
 };
 if(!row.folder_id)fail('Elige tu carpeta de trabajo antes de subir archivos.');
 if(path==='/api/drive/upload/prepare'&&request.method==='POST'){
  const body=await readJson(request);
  if(Object.keys(body).some(key=>!['parent','revision','name','size','mimeType','sha256'].includes(key))||!validName(body.name)||!validMime(body.mimeType)||!fileId(body.parent)||!Number.isInteger(body.size)||body.size<1||body.size>MAX_DRIVE_UPLOAD_BYTES||!/^[a-f0-9]{64}$/.test(body.sha256||''))fail('Selecciona un archivo de hasta 5 MB con un nombre válido.');
  if(body.revision!==row.revision)fail('La conexión cambió. Abre de nuevo Google Drive.',409);
  await serviceLimit(env.DB,`drive-upload:${teacher.id}:${Math.floor(now/3600000)}`,20,now+7200000);
  await destination(body.parent);await unchanged(env.DB,row);
  const generated=await readRemoteJson(await remote(requester,api+'files/generateIds?count=1&space=drive&type=files',{headers:{authorization:`Bearer ${token}`}}));
  if(!Array.isArray(generated.ids)||generated.ids.length!==1||!fileId(generated.ids[0]))fail('Google no pudo preparar el archivo. Intenta más tarde.',502);
  const intent={...body,id:generated.ids[0],root:row.folder_id,googleAccount:row.google_account_id,expiresAt:now+1800000};
  const signed=await seal(env,`${teacher.id}:drive-upload`,intent);
  return Response.json({success:true,data:{ticket:signed.iv+'.'+signed.cipher,file:{id:intent.id,name:intent.name,size:intent.size},expiresAt:intent.expiresAt}});
 }
 const ticket=request.headers.get('x-armi-upload-ticket')||'';
 if(!/^[a-f0-9]{24}\.[a-f0-9]{2,12000}$/.test(ticket))fail('La preparación de la subida no es válida.');
 const [iv,cipher]=ticket.split('.'),intent=await open(env,`${teacher.id}:drive-upload`,cipher,iv);
 if(intent.expiresAt<=now)fail('La preparación de la subida venció. Revisa la carpeta antes de iniciar otra.',409);
 if(intent.root!==row.folder_id||intent.revision!==row.revision||intent.googleAccount!==row.google_account_id)fail('La cuenta o carpeta cambió. Abre de nuevo Google Drive.',409);
 const lookup=async()=>{
  const response=await remote(requester,api+'files/'+intent.id+'?fields=id,name,mimeType,parents,trashed,size,sha256Checksum,appProperties&supportsAllDrives=true',{headers:{authorization:`Bearer ${token}`}},false,[404]);
  if(response.status===404){await response.body?.cancel();return null;}
  const file=await readRemoteJson(response),properties=file.appProperties;
  if(file.id!==intent.id||file.trashed||file.parents?.length!==1||file.parents[0]!==intent.parent||Number(file.size)!==intent.size||properties?.armiTeacher!==teacher.id||properties?.armiSha256!==intent.sha256||(file.sha256Checksum&&file.sha256Checksum!==intent.sha256))fail('El archivo de destino cambió. No se sobrescribió ningún archivo.',409);
  return {id:file.id,name:file.name,size:file.size,mimeType:file.mimeType};
 };
 await destination(intent.parent);await unchanged(env.DB,row);
 if(path==='/api/drive/upload/status'&&request.method==='GET'){
  const file=await lookup();await unchanged(env.DB,row);
  return Response.json({success:true,data:{uploaded:Boolean(file),file}});
 }
 if(path!=='/api/drive/upload'||request.method!=='POST')fail('Operación de subida no disponible.',404);
 if(request.headers.get('content-type')!=='application/octet-stream')fail('Formato de transferencia no válido.',415);
 const bytes=await readBytes(request,intent.size);
 if(await sha256(bytes)!==intent.sha256)fail('El contenido no coincide con el archivo preparado. No se subió ningún archivo.',409);
 const existing=await lookup();if(existing)return Response.json({success:true,data:{uploaded:true,file:existing,reused:true}});
 await unchanged(env.DB,row);
 const boundary='armi_'+crypto.randomUUID().replaceAll('-','');
 const metadata={id:intent.id,name:intent.name,mimeType:intent.mimeType,parents:[intent.parent],appProperties:{armiTeacher:teacher.id,armiSha256:intent.sha256}};
 const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${intent.mimeType}\r\n\r\n`,bytes,`\r\n--${boundary}--\r\n`]);
 let response;
 try{response=await remote(requester,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':`multipart/related; boundary=${boundary}`},body},false,[409]);}
 catch(error){fail('No pudimos confirmar la subida. Pulsa «Comprobar subida» antes de reintentar.',error.status===429?429:502);}
 await response.body?.cancel();
 const file=await lookup();if(!file)fail('Google todavía no confirmó el archivo. Pulsa «Comprobar subida» antes de reintentar.',502);
 await unchanged(env.DB,row);
 return Response.json({success:true,data:{uploaded:true,file,reused:response.status===409}});
}
