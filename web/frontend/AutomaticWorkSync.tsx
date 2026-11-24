import React,{useEffect,useRef,useState} from 'react';
import {academicApi} from './academic-client';
import {getWebIdentity} from './runtime.js';
import {createAutomaticWorkSync} from './automatic-sync-client';

export function AutomaticWorkSync(){
 const [status,setStatus]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const retry=useRef<()=>void>(()=>{});
 const checkWindows=async()=>{const owner=getWebIdentity()?.user.id;setBusy(true);try{const receipt=await academicApi('/api/drive/sync/receipt');if(owner===getWebIdentity()?.user.id)setStatus((s:any)=>({...s,...receipt}));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 useEffect(()=>{
  const owner=getWebIdentity()?.user.id;if(!owner)return;
  const controller=createAutomaticWorkSync({owner:()=>getWebIdentity()?.user.id,request:academicApi,status:setStatus,busy:setBusy,error:setError});
  const committed=(event:Event)=>controller.committed((event as CustomEvent).detail?.teacherId);
  retry.current=controller.retry;
  const check=()=>void controller.check(),visible=()=>{if(document.visibilityState==='visible')check();};
  window.addEventListener('armi-work-committed',committed);window.addEventListener('armi-drive-changed',check);window.addEventListener('focus',visible);
  check();
  return()=>{controller.stop();window.removeEventListener('armi-work-committed',committed);window.removeEventListener('armi-drive-changed',check);window.removeEventListener('focus',visible);};
 },[]);
 if(!status&&!error)return null;
 const message=error?'Guardado en la web; no se pudo confirmar el intercambio.':!status?.ready?'Sincronización automática pendiente de configuración.':!status.connected?'Conecta tu carpeta de Drive para enviar tu trabajo.':!status.authorized?'Actualiza los permisos de Google para enviar tu trabajo.':busy?'Comprobando el intercambio con Drive…':status.pending?'Cambios guardados en la web, pendientes de envío a Drive.':status.desktopConfirmed?'Windows confirmó la recepción del último envío.':status.desktopConflicts?`${status.desktopConflicts} cambio(s) requieren revisión en Windows. Se conservaron las dos versiones.`:status.lastSentAt?'Cambios enviados a Drive. Abre Windows actualizado para recibirlos.':'Los nuevos cambios se enviarán automáticamente a Drive.';
 return <div className="web-work-sync" role="status"><span>{message}</span>{error&&<button type="button" onClick={()=>retry.current()} disabled={busy}>Reintentar envío</button>}{status?.lastSentAt&&!status.pending&&!error&&<button type="button" onClick={()=>void checkWindows()} disabled={busy}>Comprobar Windows</button>}</div>;
}
