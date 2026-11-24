import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronRight,Download,ExternalLink,FileText,FolderOpen,Image as ImageIcon,Link2,LoaderCircle,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {academicApi} from './academic-client';
import {getWebIdentity} from './runtime';
import {driveFlowStorage,clearDriveFlow,readDriveFlow,saveDriveFlow,takeDriveSelection} from './drive-flow';
import './drive-panel.css';

const folderType='application/vnd.google-apps.folder';
const images=['image/png','image/jpeg','image/gif','image/webp'];
function DriveMark(){return <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#0f9d58" d="M18 4h12L14 32H2z"/><path fill="#fbbc04" d="M30 4l16 28H34L18 4z"/><path fill="#4285f4" d="M2 32h44l-6 11H8z"/></svg>;}
function sizeLabel(value:string){const size=Number(value);return !Number.isFinite(size)||size<=0?'Archivo':size<1048576?`${Math.max(1,Math.round(size/1024))} KB`:`${(size/1048576).toFixed(1)} MB`;}

export function DrivePanel({compact=false}:{compact?:boolean}){
 const [open,setOpen]=useState(false),[profile,setProfile]=useState<any>(null),[folder,setFolder]=useState(''),[files,setFiles]=useState<any[]>([]),[path,setPath]=useState<any[]>([]),[page,setPage]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<any>(null);
 const panel=useRef<HTMLElement|null>(null),picker=useRef<{window:Window|null;requestId:string;mode:'folder'|'files'}|null>(null);
 const [folderStart,setFolderStart]=useState<'desktop'|'web'>('desktop');
 const isAdmin=Boolean(getWebIdentity()?.admin?.canViewUsage);
 const teacherId=()=>getWebIdentity()?.user.id||'';
 const resetFiles=()=>{setFiles([]);setPath([]);setPage(null);setPreview(null);};
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setMessage('');setError('');try{await fn();}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
 const load=async()=>{const value=await academicApi('/api/drive/profile');setProfile(value);setFolder(value.folder?'https://drive.google.com/drive/folders/'+value.folder.id:'');return value;};
 const show=()=>{setOpen(true);setProfile(null);resetFiles();void action(load);};
 const copyFolder=(url:string)=>void action(async()=>{await navigator.clipboard.writeText(url);setMessage('Enlace de la carpeta copiado.');});
 const close=()=>{setOpen(false);setPreview(null);picker.current=null;};
 const connect=()=>void action(async()=>{const result=await academicApi('/api/drive/connect','POST',{});saveDriveFlow(driveFlowStorage(),{kind:'connect',teacherId:teacherId()});window.location.assign(result.authorizationUrl);});
 useEffect(()=>{
  const url=new URL(window.location.href),result=url.searchParams.get('armi-drive');
  if(compact||!['connected','selected','cancelled'].includes(result||''))return;
  url.searchParams.delete('armi-drive');history.replaceState(null,'',url.pathname+url.search+url.hash);
  setOpen(true);resetFiles();
  void action(async()=>{
   const current=await load();
   if(result==='selected'){
    const selection=takeDriveSelection(driveFlowStorage(),teacherId(),current);
    if(!selection)throw new Error('La cuenta o la conexión cambió. Elige la carpeta nuevamente.');
    await applySelection(selection.mode!,selection.ids!,current);return;
   }
   const pending=readDriveFlow(driveFlowStorage());clearDriveFlow(driveFlowStorage());
   if(result==='connected'){
    if(pending?.kind==='connect'&&pending.teacherId===teacherId()&&current.connected&&!current.folder&&current.pickerConfigured){select('folder',current,true);return;}
    setMessage(current.folder?'Google conectado. Reconocimos tu carpeta de trabajo.':'Google conectado. Ahora elige tu carpeta de trabajo.');
   }else setMessage('No cambiaste la carpeta. Puedes continuar cuando quieras.');
  });
 },[]);
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
 const select=(mode:'folder'|'files',current=profile,sameTab=false)=>{
  setError('');setMessage('');
  try{
   const requestId=crypto.randomUUID();
   if(!sameTab){
    const popup=window.open('/api/drive/picker?mode='+mode+'&requestId='+requestId,'armi-google-drive-picker','popup,width=1000,height=720');
    picker.current={window:popup,requestId,mode};
    if(!popup)setError('Permite abrir el selector de Google en una ventana nueva para conservar tu trabajo de ARMI.');
    return;
   }
   saveDriveFlow(driveFlowStorage(),{kind:'picker',teacherId:teacherId(),requestId,mode,revision:current.revision,email:current.email});
   window.location.assign('/api/drive/picker?mode='+mode+'&requestId='+requestId+'&flow=tab');
  }catch{setError('El navegador no permitió continuar. Habilita el almacenamiento de este sitio e intenta de nuevo.');}
 };
 useEffect(()=>{
  const selected=(event:MessageEvent)=>{
   const pending=picker.current,data=event.data;
   if(!open||event.origin!==window.location.origin||!pending||event.source!==pending.window||data?.type!=='armi-drive-selected'||data.requestId!==pending.requestId||data.mode!==pending.mode||!Array.isArray(data.ids)||!data.ids.length||data.ids.length>20||data.ids.some((id:unknown)=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{10,200}$/.test(id)))return;
   picker.current=null;
   void action(()=>applySelection(data.mode,data.ids,profile));
  };
  window.addEventListener('message',selected);return()=>window.removeEventListener('message',selected);
 },[profile,open]);
 const applySelection=async(mode:'folder'|'files',ids:string[],current:any)=>{
    if(mode==='folder')await academicApi('/api/drive/folder','PUT',{folder:ids[0],revision:current.revision});
    else if(mode==='files'&&current.folder){await academicApi('/api/drive/selection','POST',{ids});await academicApi('/api/drive/folder','PUT',{folder:current.folder.id,revision:current.revision});}
    else throw new Error('Vincula primero la carpeta de este docente.');
    resetFiles();const updated=await load();if(updated.folder)await browse(updated.folder.id,updated.folder.name);
    setMessage('Selección comprobada. Se muestran únicamente archivos que Google autorizó para ARMI.');
 };
 const connected=Boolean(profile?.connected),linked=Boolean(profile?.folder),available=profile?.ready&&profile?.configured;
 return <><button type="button" className={compact?'text-[9px] text-slate-500':''} onClick={show}>Google Drive</button>
 {open&&createPortal(<div className="drive-overlay"><section ref={panel} className="drive-panel" role="dialog" aria-modal="true" aria-labelledby="drive-heading" aria-describedby="drive-description" aria-busy={busy}>
  <header className="drive-heading"><div className="drive-brand"><span className="drive-brand-icon"><DriveMark/></span><div><span className="drive-eyebrow">TU ESPACIO DE ARCHIVOS</span><h2 id="drive-heading" tabIndex={-1}>Mi Google Drive</h2></div></div><button type="button" className="drive-icon-button" aria-label="Cerrar Google Drive" onClick={close}><X size={21}/></button></header>
  <p id="drive-description" className="drive-description">Tu cuenta, tu carpeta y tus archivos. Tú eliges qué compartir con ARMI.</p>
  <ol className="drive-steps" aria-label="Configuración de Google Drive">{[['Cuenta',connected],['Carpeta',linked],['Archivos',false]].map(([name,done],index)=><li key={String(name)} className={done?'is-complete':(index===0&&!connected||index===1&&connected&&!linked||index===2&&linked)?'is-current':''}><span>{done?<Check size={15}/>:index+1}</span>{String(name)}</li>)}</ol>
  <div className="drive-content">
  {!profile?<div className="drive-empty"><LoaderCircle className="drive-spinner" size={26}/><p>Cargando conexión…</p>{!busy&&error&&<button type="button" onClick={()=>void action(load)}>Reintentar</button>}</div>:!available?<div className="drive-callout" role="status"><ShieldCheck size={22}/><div><strong>La conexión necesita preparación</strong><p>La conexión con Google Drive no está disponible en este momento. Contacta al soporte de ARMI si el aviso continúa.</p><button type="button" disabled={busy} onClick={()=>void action(load)}><RefreshCw size={15}/>Comprobar de nuevo</button></div></div>:<>
   <section className={'drive-account '+(connected?'is-connected':'')} aria-label="Cuenta de Google"><span className="drive-account-icon"><DriveMark/></span><div><span className="drive-label">{connected?'CUENTA CONECTADA':'PRIMER PASO'}</span><strong>{connected?profile.email:'Conecta tu Google Drive'}</strong><p>{connected?'Esta cuenta autoriza el acceso a tus archivos. Si Google pide cookies, acepta también el permiso del navegador.':'Inicia sesión en Google, acepta los permisos y continúa para elegir tu carpeta. Usa la cuenta donde guardarás tus materiales.'}</p></div>{connected?<span className="drive-badge"><Check size={14}/>Conectada</span>:<button type="button" className="drive-primary" disabled={busy} onClick={connect}>Conectar mi Google Drive<ChevronRight size={17}/></button>}</section>
   {connected&&<>
    {profile.legacyLocationLinked&&<p className="drive-feedback is-error" role="alert">Necesitas confirmar tu carpeta de trabajo. Pulsa «Cambiar carpeta» y elige la que utilizas con ARMI en tu computadora.</p>}
    <section className="drive-folder-card" aria-labelledby="drive-folder-heading"><div className="drive-section-heading"><span className="drive-folder-icon"><FolderOpen size={24}/></span><div><span className="drive-label">{linked?'CARPETA VINCULADA':'SIGUIENTE PASO'}</span><h3 id="drive-folder-heading">{linked?profile.folder.name:'Elige tu carpeta de trabajo'}</h3></div></div>
     {linked?<><div className="drive-root-location"><span className="drive-label">CARPETA RAÍZ DE ESTE DOCENTE</span><strong>{profile.folder.name}</strong><a href={profile.folder.url} target="_blank" rel="noreferrer">{profile.folder.url}<ExternalLink size={13}/></a><button type="button" disabled={busy} onClick={()=>copyFolder(profile.folder.url)}>Copiar enlace</button></div><p>{profile.folder.mirrorVerified?'Esta es la misma carpeta de ARMI que utilizas en tu computadora.':'Esta carpeta ya está seleccionada para tu cuenta de ARMI.'}</p><div className="drive-actions"><button type="button" className="drive-primary" disabled={busy} onClick={()=>void action(async()=>{setPath([]);await browse(profile.folder.id,profile.folder.name);})}><FolderOpen size={17}/>Ver archivos de Drive</button>{profile.pickerConfigured&&<button type="button" disabled={busy} onClick={()=>select('folder')}>Cambiar carpeta</button>}</div></>:<>
      <p className="drive-unselected">Todavía no has seleccionado una carpeta.</p>
      <fieldset className="drive-start-options"><legend>¿Cómo quieres empezar?</legend><label><input type="radio" name="drive-folder-start" value="desktop" checked={folderStart==='desktop'} onChange={()=>setFolderStart('desktop')}/>Ya uso ARMI en mi computadora</label><label><input type="radio" name="drive-folder-start" value="web" checked={folderStart==='web'} onChange={()=>setFolderStart('web')}/>Empiezo en la web</label></fieldset>
      {folderStart==='desktop'?<><p>Elige en Google Drive la misma carpeta que utilizas con ARMI en tu computadora.</p><div className="drive-root-location"><span className="drive-label">BUSCA ESTA CARPETA</span><strong>{profile.expectedMirrorName}</strong><small>Normalmente se encuentra dentro de {profile.expectedMirrorPath}. La ubicación puede variar según lo que elegiste en tu computadora.</small></div></>:<div className="drive-new-folder"><p>Elige una carpeta propia para tus materiales. Si todavía no tienes una, crea una carpeta vacía en Google Drive y después selecciónala aquí.</p><a href="https://drive.google.com/drive/my-drive" target="_blank" rel="noreferrer">Abrir Google Drive<ExternalLink size={14}/></a><p>Por ahora ARMI permite consultar archivos. La creación automática de carpetas y la subida de archivos aún no están disponibles.</p></div>}
      {profile.pickerConfigured&&<button type="button" className="drive-primary" disabled={busy} onClick={()=>select('folder')}><FolderOpen size={18}/>Elegir carpeta con Google<ChevronRight size={17}/></button>}
     </>}
     {!profile.pickerConfigured&&<div className="drive-setup-notice"><strong>El selector de carpetas aún no está listo</strong><p>Tu cuenta ya está conectada. Falta completar una configuración de ARMI para que puedas elegir una carpeta con Google.</p><button type="button" disabled={busy} onClick={()=>void action(load)}><RefreshCw size={15}/>Comprobar de nuevo</button>{isAdmin&&<details><summary>Detalle para el administrador</summary><ul>{profile.pickerSetup&&!profile.pickerSetup.apiKeyReady&&<li>Revisar el valor de ARMI_GOOGLE_PICKER_API_KEY: falta o no tiene el formato esperado.</li>}{profile.pickerSetup&&!profile.pickerSetup.projectNumberReady&&<li>Revisar ARMI_GOOGLE_PROJECT_NUMBER: debe contener el número del proyecto, solo dígitos.</li>}{profile.pickerSetup&&profile.pickerSetup.projectNumberReady&&!profile.pickerSetup.projectMatchesClient&&<li>El número de proyecto no coincide con el cliente OAuth configurado.</li>}{!profile.pickerSetup&&<li>Revisar la clave de Google Picker y el número del proyecto en Cloudflare.</li>}</ul></details>}</div>}
     {isAdmin&&profile.legacyFolder&&<details className="drive-details"><summary><Link2 size={15}/>Referencia técnica del registro</summary><div><p>Ubicación anterior de Apps Script; no identifica el espejo de Windows.</p><strong>{profile.legacyFolder.name}</strong><a className="drive-root-url" href={profile.legacyFolder.url} target="_blank" rel="noreferrer">{profile.legacyFolder.url}</a></div></details>}
     {profile.pickerConfigured&&<details className="drive-details"><summary>¿Google pide cookies o iniciar sesión?</summary><div><p>Tu cuenta sigue conectada a ARMI. El selector de Google también necesita acceder a la sesión del navegador.</p><ol><li>Abre <a href="https://drive.google.com/" target="_blank" rel="noreferrer">Google Drive en este navegador</a> e inicia sesión con <strong>{profile.email}</strong>.</li><li>Vuelve a «Elegir carpeta con Google» y permite las cookies necesarias si Google las solicita. Acepta también el permiso del navegador, si aparece.</li><li>Si el aviso continúa, revisa los permisos de cookies para este sitio en tu navegador. <a href="https://support.microsoft.com/en-US/edge/temporarily-allow-cookies-and-site-data-in-microsoft-edge" target="_blank" rel="noreferrer">Ayuda de Edge</a>.</li></ol><p>La sesión de la aplicación de Drive del teléfono puede ser distinta. ARMI no puede activar esos permisos del navegador por ti.</p></div></details>}
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
