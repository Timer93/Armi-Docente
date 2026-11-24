import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronRight,Download,ExternalLink,FileText,FolderOpen,Image as ImageIcon,Link2,LoaderCircle,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {academicApi} from './academic-client';
import './drive-panel.css';

const folderType='application/vnd.google-apps.folder';
const images=['image/png','image/jpeg','image/gif','image/webp'];
function DriveMark(){return <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#0f9d58" d="M18 4h12L14 32H2z"/><path fill="#fbbc04" d="M30 4l16 28H34L18 4z"/><path fill="#4285f4" d="M2 32h44l-6 11H8z"/></svg>;}
function sizeLabel(value:string){const size=Number(value);return !Number.isFinite(size)||size<=0?'Archivo':size<1048576?`${Math.max(1,Math.round(size/1024))} KB`:`${(size/1048576).toFixed(1)} MB`;}

export function DrivePanel({compact=false}:{compact?:boolean}){
 const [open,setOpen]=useState(false),[profile,setProfile]=useState<any>(null),[folder,setFolder]=useState(''),[files,setFiles]=useState<any[]>([]),[path,setPath]=useState<any[]>([]),[page,setPage]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<any>(null);
 const picker=useRef<{window:Window|null;requestId:string;mode:'folder'|'files'}|null>(null),panel=useRef<HTMLElement|null>(null);
 const resetFiles=()=>{setFiles([]);setPath([]);setPage(null);setPreview(null);};
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setMessage('');setError('');try{await fn();}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
 const load=async()=>{const value=await academicApi('/api/drive/profile');setProfile(value);setFolder(value.folder?'https://drive.google.com/drive/folders/'+value.folder.id:value.suggestedFolder||'');return value;};
 const show=()=>{setOpen(true);setProfile(null);resetFiles();void action(load);};
 const close=()=>{setOpen(false);setPreview(null);picker.current=null;};
 const connect=()=>void action(async()=>{const result=await academicApi('/api/drive/connect','POST',{});window.location.assign(result.authorizationUrl);});
 useEffect(()=>{const url=new URL(window.location.href);if(!compact&&url.searchParams.get('armi-drive')==='connected'){url.searchParams.delete('armi-drive');history.replaceState(null,'',url.pathname+url.search+url.hash);show();}},[]);
 useEffect(()=>{
  if(!open)return;
  const previous=document.activeElement as HTMLElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  panel.current?.querySelector<HTMLElement>('#drive-heading')?.focus();
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();close();return;}
   if(event.key!=='Tab')return;
   const elements=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]')||[]).filter(element=>element.getClientRects().length>0);
   const first=elements[0],last=elements.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!elements.includes(document.activeElement as HTMLElement))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!elements.includes(document.activeElement as HTMLElement))){event.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',keydown);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus();};
 },[open]);
 const browse=async(id:string,name:string,more=false)=>{
  const result=await academicApi('/api/drive/files?parent='+encodeURIComponent(id)+(more&&page?'&pageToken='+encodeURIComponent(page):''));
  setFiles(old=>more?[...old,...result.files]:result.files);setPage(result.nextPageToken);setPreview(null);
  if(!more)setPath(old=>{const index=old.findIndex(item=>item.id===id);return index>=0?old.slice(0,index+1):[...old,{id,name}];});
 };
 const fileUrl=(file:any,inline=false)=>'/api/drive/content?file='+encodeURIComponent(file.id)+(inline?'&preview=1':'');
 const select=(mode:'folder'|'files')=>{
  setError('');setMessage('');const requestId=crypto.randomUUID(),popup=window.open('/api/drive/picker?mode='+mode+'&requestId='+requestId,'armi-google-drive-picker','popup,width=1000,height=720');
  picker.current={window:popup,requestId,mode};if(!popup)setError('Permite la ventana emergente para abrir el selector de Google.');
 };
 useEffect(()=>{
  const selected=(event:MessageEvent)=>{
   const pending=picker.current,data=event.data;
   if(!open||event.origin!==window.location.origin||!pending||event.source!==pending.window||data?.type!=='armi-drive-selected'||data.requestId!==pending.requestId||data.mode!==pending.mode||!Array.isArray(data.ids)||!data.ids.length)return;
   picker.current=null;
   void action(async()=>{
    if(data.mode==='folder')await academicApi('/api/drive/folder','PUT',{folder:data.ids[0],revision:profile.revision});
    else if(data.mode==='files'&&profile.folder){await academicApi('/api/drive/selection','POST',{ids:data.ids});await academicApi('/api/drive/folder','PUT',{folder:profile.folder.id,revision:profile.revision});}
    else throw new Error('Vincula primero la carpeta de este docente.');
    resetFiles();const current=await load();if(current.folder)await browse(current.folder.id,current.folder.name);
    setMessage('Selección comprobada. Se muestran únicamente archivos que Google autorizó para ARMI.');
   });
  };
  window.addEventListener('message',selected);return()=>window.removeEventListener('message',selected);
 },[profile,open]);
 const connected=Boolean(profile?.connected),linked=Boolean(profile?.folder),available=profile?.ready&&profile?.configured;
 return <><button type="button" className={compact?'text-[9px] text-slate-500':''} onClick={show}>Google Drive</button>
 {open&&createPortal(<div className="drive-overlay"><section ref={panel} className="drive-panel" role="dialog" aria-modal="true" aria-labelledby="drive-heading" aria-describedby="drive-description" aria-busy={busy}>
  <header className="drive-heading"><div className="drive-brand"><span className="drive-brand-icon"><DriveMark/></span><div><span className="drive-eyebrow">TU ESPACIO DE ARCHIVOS</span><h2 id="drive-heading" tabIndex={-1}>Mi Google Drive</h2></div></div><button type="button" className="drive-icon-button" aria-label="Cerrar Google Drive" onClick={close}><X size={21}/></button></header>
  <p id="drive-description" className="drive-description">Tu cuenta, tu carpeta y tus archivos. Tú eliges qué compartir con ARMI.</p>
  <ol className="drive-steps" aria-label="Configuración de Google Drive">{[['Cuenta',connected],['Carpeta',linked],['Archivos',false]].map(([name,done],index)=><li key={String(name)} className={done?'is-complete':(index===0&&!connected||index===1&&connected&&!linked||index===2&&linked)?'is-current':''}><span>{done?<Check size={15}/>:index+1}</span>{String(name)}</li>)}</ol>
  <div className="drive-content">
  {!profile?<div className="drive-empty"><LoaderCircle className="drive-spinner" size={26}/><p>Cargando conexión…</p>{!busy&&error&&<button type="button" onClick={()=>void action(load)}>Reintentar</button>}</div>:!available?<div className="drive-callout" role="status"><ShieldCheck size={22}/><div><strong>La conexión necesita preparación</strong><p>{!profile.ready?'El administrador debe activar la conexión de Drive en la base de datos.':'Falta configurar el acceso de Google para ARMI Web. Tus datos actuales siguen guardados en la web.'}</p><button type="button" disabled={busy} onClick={()=>void action(load)}><RefreshCw size={15}/>Comprobar de nuevo</button></div></div>:<>
   <section className={'drive-account '+(connected?'is-connected':'')} aria-label="Cuenta de Google"><span className="drive-account-icon"><DriveMark/></span><div><span className="drive-label">{connected?'CUENTA CONECTADA':'PRIMER PASO'}</span><strong>{connected?profile.email:'Conecta tu Google Drive'}</strong><p>{connected?'Esta cuenta autoriza el acceso a tus archivos.':'Usa la cuenta donde guardas tus materiales o tu carpeta espejo.'}</p></div>{connected?<span className="drive-badge"><Check size={14}/>Conectada</span>:<button type="button" className="drive-primary" disabled={busy} onClick={connect}>Conectar mi Google Drive<ChevronRight size={17}/></button>}</section>
   {connected&&<>
    <section className="drive-folder-card" aria-labelledby="drive-folder-heading"><div className="drive-section-heading"><span className="drive-folder-icon"><FolderOpen size={24}/></span><div><span className="drive-label">{linked?'CARPETA VINCULADA':'SIGUIENTE PASO'}</span><h3 id="drive-folder-heading">{linked?profile.folder.name:'Elige tu carpeta de trabajo'}</h3></div></div>
     {linked?<><p>{profile.folder.mirrorVerified?'La identidad de la carpeta espejo coincide con este docente.':'Carpeta vinculada. La identidad del espejo de Windows aún no está confirmada.'}</p><div className="drive-actions"><button type="button" className="drive-primary" disabled={busy} onClick={()=>void action(async()=>{setPath([]);await browse(profile.folder.id,profile.folder.name);})}><FolderOpen size={17}/>Ver archivos de Drive</button>{profile.pickerConfigured&&<button type="button" disabled={busy} onClick={()=>select('folder')}>Cambiar carpeta</button>}</div></>:<>
      <p>{profile.suggestedFolder?'Encontramos un enlace de carpeta en tu cuenta de ARMI. Es una sugerencia: Google debe autorizarla antes de vincularla.':'Todavía no hay una carpeta vinculada. Puedes elegir una carpeta existente de tu Google Drive.'}</p>
      {profile.suggestedFolder&&<div className="drive-suggestion"><Link2 size={19}/><div><strong>Carpeta sugerida por tu cuenta</strong><div className="drive-suggestion-links"><a href={profile.suggestedFolder} target="_blank" rel="noreferrer">Ver en Google Drive<ExternalLink size={13}/></a><button type="button" disabled={busy} onClick={()=>void action(async()=>{try{await navigator.clipboard.writeText(profile.suggestedFolder);}catch{throw new Error('El navegador no permitió copiar el enlace. Puedes abrir la carpeta desde Google Drive.');}setMessage('Enlace copiado. Ábrelo con la cuenta de Google conectada a ARMI.');})}>Copiar enlace</button></div><small>Si Drive no encuentra la carpeta, comprueba la cuenta que abrió la aplicación de Google o elige tu carpeta actual con el selector. El enlace registrado puede estar desactualizado.</small></div></div>}
      {profile.pickerConfigured&&<button type="button" className="drive-primary" disabled={busy} onClick={()=>select('folder')}><FolderOpen size={18}/>Elegir carpeta con Google<ChevronRight size={17}/></button>}
     </>}
     {!profile.pickerConfigured&&<div className="drive-setup-notice"><strong>El selector de carpetas aún no está listo</strong><p>Tu cuenta ya está conectada. Falta completar una configuración de ARMI para que puedas elegir una carpeta con Google.</p><button type="button" disabled={busy} onClick={()=>void action(load)}><RefreshCw size={15}/>Comprobar de nuevo</button><details><summary>Detalle para el administrador</summary><ul>{profile.pickerSetup&&!profile.pickerSetup.apiKeyReady&&<li>Revisar el valor de ARMI_GOOGLE_PICKER_API_KEY: falta o no tiene el formato esperado.</li>}{profile.pickerSetup&&!profile.pickerSetup.projectNumberReady&&<li>Revisar ARMI_GOOGLE_PROJECT_NUMBER: debe contener el número del proyecto, solo dígitos.</li>}{profile.pickerSetup&&profile.pickerSetup.projectNumberReady&&!profile.pickerSetup.projectMatchesClient&&<li>El número de proyecto no coincide con el cliente OAuth configurado.</li>}{!profile.pickerSetup&&<li>Revisar la clave de Google Picker y el número del proyecto en Cloudflare.</li>}</ul></details></div>}
     <details className="drive-details"><summary><Link2 size={15}/>Vincular mediante un enlace ya autorizado</summary><div><p>Pegar un enlace no concede permisos. Usa esta opción si Google ya autorizó esa carpeta para ARMI.</p><label htmlFor="drive-folder-link">Enlace de la carpeta</label><input id="drive-folder-link" type="url" value={folder} placeholder="https://drive.google.com/drive/folders/…" onChange={event=>setFolder(event.target.value)}/><button type="button" disabled={busy||!folder.trim()} onClick={()=>void action(async()=>{await academicApi('/api/drive/folder','PUT',{folder:folder.trim(),revision:profile.revision});resetFiles();await load();setMessage('Carpeta vinculada. Ya puedes consultar sus archivos.');})}>Vincular carpeta existente</button></div></details>
    </section>
    {linked&&<section className="drive-library" aria-labelledby="drive-files-heading"><div className="drive-section-heading"><FileText size={22}/><div><span className="drive-label">TUS MATERIALES</span><h3 id="drive-files-heading">Archivos autorizados</h3></div>{profile.pickerConfigured&&<button type="button" disabled={busy} onClick={()=>select('files')}>Autorizar archivos o carpetas existentes</button>}</div><p className="drive-muted">¿Falta algún archivo? Compártelo con ARMI desde el selector. Una lista incompleta no significa que se haya borrado.</p>
     {path.length>0?<><nav className="drive-breadcrumbs" aria-label="Carpeta de Drive">{path.map(item=><button type="button" key={item.id} disabled={busy} onClick={()=>void action(()=>browse(item.id,item.name))}><FolderOpen size={14}/>{item.name}<ChevronRight size={13}/></button>)}</nav>
     {!files.length&&!busy&&<div className="drive-empty"><FolderOpen size={29}/><strong>No hay archivos autorizados visibles</strong><p>Esta carpeta puede contener archivos que todavía no compartiste con ARMI.</p></div>}
     <ul className="drive-file-list">{files.map(file=><li key={file.id}><span className="drive-file-icon">{file.mimeType===folderType?<FolderOpen size={23}/>:images.includes(file.mimeType)?<ImageIcon size={23}/>:<FileText size={23}/>}</span><div className="drive-file-name"><strong>{file.name}</strong><small>{file.mimeType===folderType?'Carpeta':sizeLabel(file.size)}</small></div><div className="drive-file-actions">{file.mimeType===folderType?<button type="button" disabled={busy} onClick={()=>void action(()=>browse(file.id,file.name))}>Abrir carpeta<ChevronRight size={16}/></button>:<>{images.includes(file.mimeType)&&<button type="button" disabled={busy} onClick={()=>setPreview(file)}>Vista previa</button>}{file.mimeType==='application/pdf'&&<a href={fileUrl(file,true)} target="_blank" rel="noreferrer">Ver PDF<ExternalLink size={14}/></a>}{!file.mimeType.startsWith('application/vnd.google-apps.')&&<a href={fileUrl(file)} target="_blank" rel="noreferrer"><Download size={15}/>Descargar</a>}</>}</div></li>)}</ul>{page&&<button type="button" disabled={busy} onClick={()=>void action(()=>browse(path.at(-1).id,path.at(-1).name,true))}>Ver más archivos</button>}</>:<p className="drive-muted">Pulsa «Ver archivos de Drive» para consultar el contenido autorizado.</p>}
     {preview&&<figure className="drive-preview"><figcaption><strong>{preview.name}</strong><button type="button" onClick={()=>setPreview(null)}>Cerrar vista previa<X size={15}/></button></figcaption><img alt={preview.name} src={fileUrl(preview,true)} onError={()=>setError('No se pudo abrir la imagen. Revisa los permisos o vuelve a conectar Google.')}/></figure>}
    </section>}
    <details className="drive-details drive-connection-options"><summary>Opciones de conexión</summary><div><p>Puedes cambiar la cuenta de Google o desvincularla. Desvincular no elimina tus archivos de Drive.</p><div className="drive-actions"><button type="button" disabled={busy} onClick={connect}><RefreshCw size={15}/>Volver a conectar Google</button><button type="button" className="drive-danger" disabled={busy} onClick={()=>void action(async()=>{await academicApi('/api/drive/connection','DELETE',{revision:profile.revision});resetFiles();await load();setMessage('Cuenta desvinculada. Tus archivos permanecen en Google Drive.');})}>Desvincular de ARMI Web</button></div></div></details>
   </>}
  </>}
  {busy&&profile&&<p className="drive-progress" role="status"><LoaderCircle size={17} className="drive-spinner"/>Procesando…</p>}{message&&<p className="drive-feedback is-success" role="status"><Check size={18}/>{message}</p>}{error&&<p className="drive-feedback is-error" role="alert">{error}</p>}
  <div className="drive-stage-note"><ShieldCheck size={19}/><p>Consulta y descarga disponibles al vincular tu carpeta. <strong>La subida y la sincronización con Windows siguen pendientes.</strong></p></div>
  </div><footer className="drive-footer"><nav aria-label="Privacidad de Drive"><a href="/privacidad" target="_blank" rel="noreferrer">Privacidad</a><span>·</span><a href="/condiciones" target="_blank" rel="noreferrer">Condiciones</a></nav><button type="button" onClick={close}>Cerrar</button></footer>
 </section></div>,document.body)}
 </>;
}
