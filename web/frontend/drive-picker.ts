import './drive-picker.css';
import {driveFlowStorage,clearDriveFlow,finishDrivePicker,readDriveFlow} from './drive-flow';
declare global {interface Window {gapi:any;google:any;}}
const status=document.getElementById('picker-status')!;
const shell=document.getElementById('picker-shell')!,spinner=document.getElementById('picker-spinner')!;
const params=new URLSearchParams(window.location.search),nonce=params.get('requestId')||'',mode=params.get('mode');
const sameTab=params.get('flow')==='tab';
let saved=false,submitting=false;
function cancel(){if(submitting)return;if(sameTab){clearDriveFlow(driveFlowStorage());window.location.replace('/?armi-drive=cancelled');}else window.close();}
document.getElementById('picker-cancel')!.onclick=cancel;
document.getElementById('picker-retry')!.onclick=()=>window.location.reload();
function showError(error:any){
 spinner.hidden=true;shell.hidden=false;shell.setAttribute('aria-busy','false');
 document.getElementById('picker-error-title')!.hidden=false;
 status.setAttribute('role','alert');status.textContent=error.name==='TimeoutError'?'Google Drive tardó demasiado en responder. Regresa a ARMI para comprobar si se guardó la selección.':error.message||'No se pudo abrir Google Drive.';
 document.getElementById('picker-explanation')!.hidden=false;document.getElementById('picker-help')!.hidden=false;
 document.getElementById('picker-retry')!.hidden=!sameTab&&!window.opener;
}
async function run(){
 const pending=sameTab?readDriveFlow(driveFlowStorage()):null;
 if((sameTab?(pending?.kind!=='picker'||pending.requestId!==nonce||pending.mode!==mode):!window.opener)||!/^[a-f0-9-]{36}$/.test(nonce)||!['folder','files'].includes(mode||''))throw new Error('Abre el selector desde el panel Google Drive de ARMI.');
 const response=await fetch('/api/drive/picker-config',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)}),payload=await response.json();
 if(!response.ok||!payload.success)throw new Error(payload.message||'No se pudo preparar el selector.');
 const config=payload.data;
 if(!Number.isInteger(config.revision)||!config.teacherId||(params.has('revision')&&Number(params.get('revision'))!==config.revision)||(params.has('teacherId')&&params.get('teacherId')!==config.teacherId)||(sameTab&&(pending?.revision!==config.revision||pending.teacherId!==config.teacherId)))throw new Error('La cuenta o la conexión cambió. Regresa a ARMI y vuelve a elegir la carpeta.');
 const write=async(path:string,method:string,body:unknown)=>{
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-armi-teacher-id':config.teacherId},body:JSON.stringify(body)}),payload=await response.json();
  if(!response.ok||!payload.success)throw new Error(payload.message||'No se pudo confirmar la selección.');
 };
 await new Promise<void>((resolve,reject)=>{
  const timer=window.setTimeout(()=>reject(new Error('Google tardó demasiado en cargar el selector. Revisa tu conexión o los permisos del navegador.')),20000);
  const done=(error?:Error)=>{window.clearTimeout(timer);error?reject(error):resolve();};
  const script=document.createElement('script');script.src='https://apis.google.com/js/api.js';
  script.onload=()=>{try{window.gapi.load('picker',{callback:()=>done(),onerror:()=>done(new Error('No se pudo cargar el selector de Google.')),timeout:15000,ontimeout:()=>done(new Error('Google tardó demasiado en cargar el selector.'))});}catch{done(new Error('No se pudo preparar el selector de Google.'));}};
  script.onerror=()=>done(new Error('No se pudo cargar Google. Revisa tu conexión o los permisos del navegador.'));document.head.appendChild(script);
 });
 const pickerApi=window.google.picker;
 const view=new pickerApi.DocsView(pickerApi.ViewId.DOCS).setIncludeFolders(true).setMode(pickerApi.DocsViewMode.LIST);
 if(mode==='folder')view.setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder').setParent('root');
 else {view.setSelectFolderEnabled(true).setParent(config.folderId||'root');}
 let picker:any;
 const builder=new pickerApi.PickerBuilder().addView(view).setOAuthToken(config.accessToken).setDeveloperKey(config.developerKey).setAppId(config.appId).setOrigin(window.location.origin).setLocale('es').setCallback((result:any)=>{
  if(result.action===pickerApi.Action.CANCEL){cancel();return;}
  if(result.action!==pickerApi.Action.PICKED)return;
  const ids=(Array.isArray(result.docs)?result.docs:[]).map((doc:any)=>doc.id).filter((id:unknown)=>typeof id==='string'&&/^[a-zA-Z0-9_-]{10,200}$/.test(id as string));
  if(submitting||saved)return;
  if(!ids.length){showError(new Error('Google no devolvió una selección válida. Regresa a ARMI y vuelve a elegir la carpeta.'));return;}
  submitting=true;picker.setVisible(false);shell.hidden=false;spinner.hidden=false;shell.setAttribute('aria-busy','true');status.textContent='Confirmando tu selección…';
  void (async()=>{
   if(mode==='files'){
    if(!config.folderId)throw new Error('Vincula primero tu carpeta de trabajo.');
    await write('/api/drive/selection','POST',{ids});
   }
   await write('/api/drive/folder','PUT',{folder:mode==='folder'?ids[0]:config.folderId,revision:config.revision});
   saved=true;spinner.hidden=true;shell.setAttribute('aria-busy','false');status.textContent='Tu selección quedó guardada. Puedes volver a ARMI.';
   document.getElementById('picker-return')!.hidden=false;document.getElementById('picker-retry')!.hidden=true;
   if(sameTab){
    try{finishDrivePicker(driveFlowStorage(),nonce,mode!,ids,config.revision+1);window.location.replace('/?armi-drive=saved');}
    catch{clearDriveFlow(driveFlowStorage());window.location.replace('/?armi-drive=linked');}
    return;
   }
   try{window.opener?.postMessage({type:'armi-drive-saved',mode,requestId:nonce},window.location.origin);}catch{}
   try{window.close();}catch{}
  })().catch(error=>{document.getElementById('picker-error-title')!.textContent='No se pudo confirmar la selección';showError(error);}).finally(()=>{submitting=false;});
 });
 if(mode==='files')builder.enableFeature(pickerApi.Feature.MULTISELECT_ENABLED).setMaxItems(20);
 picker=builder.build();picker.setVisible(true);shell.setAttribute('aria-busy','false');shell.hidden=true;
}
void run().catch(showError);
