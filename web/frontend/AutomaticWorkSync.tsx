import React,{useEffect,useRef,useState} from 'react';
import {academicApi} from './academic-client';
import {getWebIdentity} from './runtime.js';
import {createAutomaticWorkSync} from './automatic-sync-client';

export function AutomaticWorkSync(){
 const [status,setStatus]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const retry=useRef<()=>void>(()=>{});
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
 const message=error?'Guardado en la web; envío pendiente.':!status?.ready?'Sincronización automática pendiente de configuración.':!status.connected?'Conecta tu carpeta de Drive para enviar tu trabajo.':!status.authorized?'Actualiza los permisos de Google para enviar tu trabajo.':busy?'Enviando cambios de tu trabajo a Drive…':status.pending?'Cambios guardados en la web, pendientes de envío a Drive.':status.lastSentAt?'Cambios enviados a Drive. La recepción en Windows todavía está pendiente.':'Los nuevos cambios se enviarán automáticamente a Drive.';
 return <div className="web-work-sync" role="status"><span>{message}</span>{error&&<button type="button" onClick={()=>retry.current()} disabled={busy}>Reintentar envío</button>}</div>;
}
