// Tab-local continuation only: never store Google tokens or credentials here.
const key='armi-drive-flow';
// Capture before installWebRuntime replaces legacy desktop sessionStorage with
// memory-only storage. This one continuation must survive same-tab navigation.
let nativeStorage:Storage|null=null;
try{nativeStorage=window.sessionStorage;}catch{}
export function driveFlowStorage():Storage{if(!nativeStorage)throw new Error('Permite el almacenamiento de ARMI en este navegador para continuar con Google.');return nativeStorage;}
type Pending={kind:'connect'|'picker';teacherId:string;expiresAt:number;requestId?:string;mode?:'folder'|'files';revision?:number;email?:string};
export function saveDriveFlow(storage:Storage,value:Omit<Pending,'expiresAt'>,now=Date.now()){
 storage.setItem(key,JSON.stringify({...value,expiresAt:now+15*60*1000}));
}
export function readDriveFlow(storage:Storage,now=Date.now()):Pending|null{
 try{const value=JSON.parse(storage.getItem(key)||'null');if(value&&['connect','picker'].includes(value.kind)&&typeof value.teacherId==='string'&&value.expiresAt>now&&value.expiresAt<=now+15*60*1000)return value;}catch{}
 storage.removeItem(key);return null;
}
export function clearDriveFlow(storage:Storage){storage.removeItem(key);}
export function finishDrivePicker(storage:Storage,requestId:string,mode:string,ids:string[]){
 const pending=readDriveFlow(storage);
 if(pending?.kind!=='picker'||pending.requestId!==requestId||pending.mode!==mode)throw new Error('La selección venció. Abre Google Drive desde ARMI.');
 storage.setItem(key,JSON.stringify({...pending,ids:ids.filter(id=>/^[a-zA-Z0-9_-]{10,200}$/.test(id)).slice(0,20)}));
}
export function takeDriveSelection(storage:Storage,teacherId:string,profile:{revision:number;email:string},now=Date.now()){
 const pending=readDriveFlow(storage,now) as (Pending&{ids?:string[]})|null;
 clearDriveFlow(storage);
 if(pending?.kind!=='picker'||pending.teacherId!==teacherId||pending.revision!==profile.revision||pending.email!==profile.email||!['folder','files'].includes(pending.mode||'')||!Array.isArray(pending.ids)||!pending.ids.length||pending.ids.length>20||pending.ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{10,200}$/.test(id)))return null;
 return pending;
}
