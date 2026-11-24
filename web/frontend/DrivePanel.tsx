import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {academicApi} from './academic-client';

export function DrivePanel({compact=false}:{compact?:boolean}){
 const [open,setOpen]=useState(false),[profile,setProfile]=useState<any>(null),[folder,setFolder]=useState(''),[files,setFiles]=useState<any[]>([]),[path,setPath]=useState<any[]>([]),[page,setPage]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<any>(null);
 const picker=useRef<{window:Window|null;requestId:string}|null>(null);
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setMessage('');try{await fn();}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}};
 const load=async()=>{const value=await academicApi('/api/drive/profile');setProfile(value);if(!value.folder&&value.suggestedFolder)setFolder(value.suggestedFolder);return value;};
 const show=()=>{setOpen(true);setPreview(null);void action(async()=>{setFiles([]);setPath([]);setPage(null);await load();});};
 useEffect(()=>{const url=new URL(window.location.href);if(!compact&&url.searchParams.get('armi-drive')==='connected'){url.searchParams.delete('armi-drive');history.replaceState(null,'',url.pathname+url.search+url.hash);show();}},[]);
 const browse=async(id:string,name:string,more=false)=>{
  const result=await academicApi('/api/drive/files?parent='+encodeURIComponent(id)+(more&&page?'&pageToken='+encodeURIComponent(page):''));
  setFiles(old=>more?[...old,...result.files]:result.files);setPage(result.nextPageToken);setPreview(null);
  if(!more)setPath(old=>{const index=old.findIndex(item=>item.id===id);return index>=0?old.slice(0,index+1):[...old,{id,name}];});
 };
 const fileUrl=(file:any,inline=false)=>'/api/drive/content?file='+encodeURIComponent(file.id)+(inline?'&preview=1':'');
 const select=(mode:'folder'|'files')=>{
  const requestId=crypto.randomUUID(),popup=window.open('/api/drive/picker?mode='+mode+'&requestId='+requestId,'armi-google-drive-picker','popup,width=1000,height=720');
  picker.current={window:popup,requestId};if(!popup)setMessage('Permite la ventana emergente para abrir el selector de Google.');
 };
 useEffect(()=>{
  const selected=(event:MessageEvent)=>{
   const pending=picker.current,data=event.data;
   if(event.origin!==window.location.origin||!pending||event.source!==pending.window||data?.type!=='armi-drive-selected'||data.requestId!==pending.requestId||!Array.isArray(data.ids))return;
   picker.current=null;
   void action(async()=>{
    if(data.mode==='folder')await academicApi('/api/drive/folder','PUT',{folder:data.ids[0],revision:profile.revision});
    else if(data.mode==='files'&&profile.folder){await academicApi('/api/drive/selection','POST',{ids:data.ids});await academicApi('/api/drive/folder','PUT',{folder:profile.folder.id,revision:profile.revision});}
    else throw new Error('Vincula primero la carpeta de este docente.');
    setFiles([]);setPath([]);setPage(null);setPreview(null);const current=await load();
    if(current.folder)await browse(current.folder.id,current.folder.name);
    setMessage('Selección comprobada. Se muestran únicamente archivos que Google autorizó para ARMI.');
   });
  };
  window.addEventListener('message',selected);return()=>window.removeEventListener('message',selected);
 },[profile]);
 return <><button type="button" className={compact?'text-[9px] text-slate-500':''} onClick={show}>Google Drive</button>
 {open&&createPortal(<div className="web-ai-overlay"><section className="web-ai-panel drive-panel" role="dialog" aria-modal="true" aria-labelledby="drive-heading">
  <h2 id="drive-heading">Mi Google Drive</h2>
  <p>Conecta tu cuenta y elige la carpeta de archivos de este docente.</p>
  {!profile?<p>Cargando conexión…</p>:!profile.ready?<p role="status">El administrador debe activar la conexión de Drive en la base de datos.</p>:!profile.configured?<p role="status">Falta configurar el acceso de Google para ARMI Web. Tus datos actuales siguen guardados en la web.</p>:<>
   <p><strong>{profile.connected?'Cuenta vinculada: '+profile.email:'Cuenta de Google sin conectar'}</strong></p>
   <p>Comparte con ARMI únicamente la carpeta y los archivos que elijas.</p>
   {!profile.connected&&<button type="button" disabled={busy} onClick={()=>void action(async()=>{const result=await academicApi('/api/drive/connect','POST',{});window.location.assign(result.authorizationUrl);})}>Conectar mi Google Drive</button>}
   {profile.connected&&<>
    {profile.pickerConfigured?<button type="button" disabled={busy} onClick={()=>select('folder')}>{profile.folder?'Cambiar carpeta':'Elegir carpeta con Google'}</button>:<p>El administrador debe completar la configuración del selector de Google para autorizar archivos existentes.</p>}
    <details><summary>Usar el enlace de una carpeta ya autorizada</summary><label>Enlace de la carpeta<input type="url" value={folder} placeholder="https://drive.google.com/drive/folders/…" onChange={event=>setFolder(event.target.value)}/></label>
    <button type="button" disabled={busy||!folder.trim()} onClick={()=>void action(async()=>{await academicApi('/api/drive/folder','PUT',{folder:folder.trim(),revision:profile.revision});setFolder('');setFiles([]);setPath([]);setPage(null);setPreview(null);await load();setMessage('Carpeta vinculada. Ya puedes consultar sus archivos.');})}>Vincular carpeta existente</button></details>
    {profile.folder&&<>
     <p><strong>{profile.folder.name}</strong><br/>{profile.folder.mirrorVerified?'La identidad de la carpeta espejo coincide con este docente.':'La carpeta permite consultar archivos; todavía no se confirmó como carpeta espejo de este docente.'}</p>
     <button type="button" disabled={busy} onClick={()=>void action(async()=>{setPath([]);await browse(profile.folder.id,profile.folder.name);})}>Ver archivos de Drive</button>
     <button type="button" disabled={busy||!profile.pickerConfigured} onClick={()=>select('files')}>Autorizar archivos o carpetas existentes</button>
     <p>Si faltan archivos, autorízalos con Google. Una lista incompleta no significa que se hayan borrado.</p>
     {path.length>0&&<nav aria-label="Carpeta de Drive">{path.map(item=><button type="button" key={item.id} disabled={busy} onClick={()=>void action(()=>browse(item.id,item.name))}>{item.name}</button>)}</nav>}
     {path.length>0&&files.length===0&&!busy&&<p>No hay archivos autorizados visibles en esta carpeta. Puede contener otros archivos que todavía no compartiste con ARMI.</p>}
     <ul className="drive-files">{files.map(file=><li key={file.id}><strong>{file.name}</strong>{file.mimeType==='application/vnd.google-apps.folder'?<button type="button" disabled={busy} onClick={()=>void action(()=>browse(file.id,file.name))}>Abrir carpeta</button>:<>
      {['image/png','image/jpeg','image/gif','image/webp'].includes(file.mimeType)&&<button type="button" disabled={busy} onClick={()=>setPreview(file)}>Vista previa</button>}
      {file.mimeType==='application/pdf'&&<a href={fileUrl(file,true)} target="_blank" rel="noreferrer">Ver PDF</a>}
      {!file.mimeType.startsWith('application/vnd.google-apps.')&&<a href={fileUrl(file)} target="_blank" rel="noreferrer">Descargar</a>}
     </>}</li>)}</ul>
     {page&&<button type="button" disabled={busy} onClick={()=>void action(()=>browse(path.at(-1).id,path.at(-1).name,true))}>Ver más archivos</button>}
     {preview&&<figure><figcaption>{preview.name}</figcaption><img alt={preview.name} src={fileUrl(preview,true)} onError={()=>setMessage('No se pudo abrir la imagen. Revisa los permisos o vuelve a conectar Google.')}/><button type="button" onClick={()=>setPreview(null)}>Cerrar vista previa</button></figure>}
    </>}
    <details><summary>Opciones de conexión</summary><button type="button" disabled={busy} onClick={()=>void action(async()=>{const result=await academicApi('/api/drive/connect','POST',{});window.location.assign(result.authorizationUrl);})}>Volver a conectar Google</button><button type="button" disabled={busy} onClick={()=>void action(async()=>{await academicApi('/api/drive/connection','DELETE',{revision:profile.revision});setFiles([]);setPath([]);setPreview(null);setPage(null);await load();})}>Desvincular de ARMI Web</button></details>
   </>}
  </>}
  <p className="drive-stage-note">Puedes consultar y descargar archivos. La subida y la sincronización con Windows siguen pendientes. <a href="/privacidad" target="_blank" rel="noreferrer">Privacidad y uso de datos</a> · <a href="/condiciones" target="_blank" rel="noreferrer">Condiciones del Servicio</a>.</p>
  {message&&<p role="status">{message}</p>}
  <footer><button type="button" disabled={busy} onClick={()=>{setOpen(false);setPreview(null);}}>Cerrar</button></footer>
 </section></div>,document.body)}
 </>;
}
