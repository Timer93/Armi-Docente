import './drive-picker.css';
declare global {interface Window {gapi:any;google:any;}}
const status=document.getElementById('picker-status')!;
const params=new URLSearchParams(window.location.search),nonce=params.get('requestId')||'',mode=params.get('mode');
document.getElementById('picker-cancel')!.onclick=()=>window.close();
async function run(){
 if(!window.opener||!/^[a-f0-9-]{36}$/.test(nonce)||!['folder','files'].includes(mode||''))throw new Error('Abre el selector desde el panel Google Drive de ARMI.');
 const response=await fetch('/api/drive/picker-config',{credentials:'same-origin',cache:'no-store'}),payload=await response.json();
 if(!response.ok||!payload.success)throw new Error(payload.message||'No se pudo preparar el selector.');
 const config=payload.data;
 await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src='https://apis.google.com/js/api.js';script.onload=()=>window.gapi.load('picker',{callback:resolve,onerror:()=>reject(new Error('No se pudo cargar el selector de Google.')),timeout:15000,ontimeout:()=>reject(new Error('Google tardó demasiado en cargar el selector.'))});script.onerror=()=>reject(new Error('No se pudo cargar Google.'));document.head.appendChild(script);});
 const pickerApi=window.google.picker;
 const view=new pickerApi.DocsView(pickerApi.ViewId.DOCS).setIncludeFolders(true);
 if(mode==='folder')view.setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');
 else {view.setSelectFolderEnabled(true);if(config.folderId)view.setParent(config.folderId);}
 const builder=new pickerApi.PickerBuilder().addView(view).setOAuthToken(config.accessToken).setDeveloperKey(config.developerKey).setAppId(config.appId).setOrigin(window.location.origin).setCallback((result:any)=>{
  if(result.action===pickerApi.Action.CANCEL){window.close();return;}
  if(result.action!==pickerApi.Action.PICKED)return;
  const ids=(result.docs||[]).map((doc:any)=>doc.id).filter((id:unknown)=>typeof id==='string'&&/^[a-zA-Z0-9_-]{10,200}$/.test(id as string));
  if(!ids.length)return;
  window.opener.postMessage({type:'armi-drive-selected',mode,requestId:nonce,ids},window.location.origin);window.close();
 });
 if(mode==='files')builder.enableFeature(pickerApi.Feature.MULTISELECT_ENABLED).setMaxItems(20);
 builder.build().setVisible(true);status.textContent='Selecciona únicamente la carpeta o los archivos que deseas autorizar para ARMI.';
}
void run().catch(error=>{status.textContent=error.message||'No se pudo abrir Google Drive.';});
