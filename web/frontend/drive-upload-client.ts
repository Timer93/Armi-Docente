export const MAX_DRIVE_UPLOAD_BYTES=5_000_000;
type Context={teacherId:string;revision:number;parent:string;parentName:string};
export type DriveTransfer={ticket:string;expiresAt:number;file:File;context:Context};
type Dependencies={api:(path:string,method?:string,body?:unknown)=>Promise<any>;owner:()=>string;fetcher?:typeof fetch};
const checkOwner=(context:Context,owner:()=>string)=>{if(owner()!==context.teacherId)throw new Error('La cuenta cambió. Abre de nuevo Google Drive.');};

export async function prepareDriveUpload(file:File,context:Context,{api,owner}:Dependencies):Promise<DriveTransfer>{
 checkOwner(context,owner);
 if(file.size<1||file.size>MAX_DRIVE_UPLOAD_BYTES)throw new Error('Selecciona un archivo con contenido de hasta 5 MB.');
 const bytes=await file.arrayBuffer();checkOwner(context,owner);
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
 checkOwner(context,owner);
 const prepared=await api('/api/drive/upload/prepare','POST',{parent:context.parent,revision:context.revision,name:file.name,size:file.size,mimeType:file.type||'application/octet-stream',sha256});
 checkOwner(context,owner);
 return {ticket:prepared.ticket,expiresAt:prepared.expiresAt,file,context};
}

export async function transferDriveUpload(transfer:DriveTransfer,statusOnly:boolean,{owner,fetcher=fetch}:Pick<Dependencies,'owner'|'fetcher'>){
 checkOwner(transfer.context,owner);
 if(transfer.expiresAt<=Date.now())throw new Error('La preparación de la subida venció. Revisa primero si el archivo ya está en Drive.');
 let response:Response;
 try{response=await fetcher(statusOnly?'/api/drive/upload/status':'/api/drive/upload',{
  method:statusOnly?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(90000),
  headers:{'x-armi-teacher-id':transfer.context.teacherId,'x-armi-upload-ticket':transfer.ticket,...(!statusOnly?{'content-type':'application/octet-stream'}:{})},
  ...(!statusOnly?{body:transfer.file}:{}),
 });}catch{throw new Error('La conexión se interrumpió. Pulsa «Comprobar subida» para saber si el archivo llegó.');}
 checkOwner(transfer.context,owner);
 let result:any;try{result=await response.json();}catch{throw new Error('No pudimos confirmar la respuesta. Pulsa «Comprobar subida».');}
 if(!response.ok||!result.success)throw new Error(result.message||'No pudimos confirmar la subida. Comprueba su estado antes de reintentar.');
 return result.data;
}
