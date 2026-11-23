import React,{useEffect,useRef,useSyncExternalStore} from 'react';
import {academicApi,academicVersion,displayValue,readAcademic,withWebSave} from './academic-client';
import {getWebIdentity} from './runtime.js';
const fields=['year','areaId','grade','section','scopeType','scopeValue'];
const contextOf=(value:any)=>Object.fromEntries(fields.map(key=>[key,String(value[key]||'')]));
const conclusionKey=(value:any)=>'conclusions:'+fields.map(key=>String(value[key]||'')).join('::');
const caches=new Map<string,any>(),queues=new Map<string,Promise<any>>(),listeners=new Set<()=>void>();
const pending=new Map<string,number>();
let failure='';
const notify=()=>listeners.forEach(fn=>fn());
export const evaluationBlocked=()=>Boolean(failure);
export const evaluationPending=(key:string)=>pending.has(key);
export function markEvaluationPending(key:string){pending.set(key,(pending.get(key)||0)+1);window.dispatchEvent(new CustomEvent('armi-web-save',{detail:{state:'pending'}}));}
export function clearEvaluationPending(key:string){if(pending.delete(key))window.dispatchEvent(new CustomEvent('armi-web-save',{detail:{state:pending.size?'pending':'saved'}}));}
window.addEventListener('beforeunload',event=>{if(pending.size){event.preventDefault();event.returnValue='';}});
function failed(error:any){failure||=error.message||'No se pudo guardar la evaluación. Recarga antes de continuar.';notify();return {success:false,message:failure,data:[]};}
function loaded(key:string,data:any){caches.set(key,data);notify();return {success:true,data:displayValue(data.records)};}
export function EvaluationGate({required,children}:{required:string[];children:React.ReactNode}) {
 const status=useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>failure||(!getWebIdentity()?.academic?.evaluationEditable?'El administrador debe activar las calificaciones en la base de datos web.':required.every(key=>caches.has(key))?'ready':'loading'));
 return <section data-armi-web-editor="evaluation"><p role="status" className="rounded-xl border border-slate-200 p-3 text-sm">{status==='ready'?'Evaluación web: guardado por cuenta. Las notas y conclusiones del escritorio todavía no se sincronizan.':status==='loading'?'Cargando evaluación antes de permitir cambios…':status}</p><fieldset disabled={status!=='ready'} className="min-w-0 border-0 p-0 m-0">{children}</fieldset></section>;
}
export async function getEvaluacionRegistros(filters:any={}) {
 try {
  await Promise.all([...queues.values()]);if(failure)throw new Error(failure);
  if(filters.sessionId){
   await Promise.all([readAcademic('sessions'),readAcademic('units')]);
   const key='grades:'+filters.sessionId,source=academicVersion('sessions',filters.sessionId),unit=academicVersion('units',filters.sessionId.replace(/-S\d+$/,''));
   if(!source.loaded||!unit.loaded||source.snapshot!==unit.snapshot)throw new Error('Carga la planificación completa antes de calificar.');
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([source.snapshot,source.revision,unit.revision])));
   const version=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
   const result=await academicApi('/api/evaluation/grades?sessionId='+encodeURIComponent(filters.sessionId));
   if(result.sourceVersion!==version)throw new Error('La planificación cambió en otra pestaña. Recarga para calificar con los criterios actuales.');
   return loaded(key,result);
  }
  const rows=[];let cursor='',revision:number|undefined;
  do{const page=await academicApi('/api/evaluation/grades'+(cursor?'?cursor='+encodeURIComponent(cursor)+'&revision='+revision:''));revision=page.revision;rows.push(...page.records);cursor=page.nextCursor||'';if(rows.length>100000)throw new Error('Demasiadas calificaciones para esta vista.');}while(cursor);
  return loaded('all-grades',{records:rows});
 }catch(error){return failed(error);}
}
export async function getEvaluacionConclusiones(filters:any) {
 try{await Promise.all([...queues.values()]);if(failure)throw new Error(failure);const context=contextOf(filters);return loaded(conclusionKey(context),await academicApi('/api/evaluation/conclusions?'+new URLSearchParams(context)));}catch(error){return failed(error);}
}
function enqueue(key:string,operation:()=>Promise<any>) {
 const pending=(queues.get(key)||Promise.resolve()).then(operation);
 queues.set(key,pending.then(()=>{},()=>{}));return pending;
}
async function persist(key:string,changes:any[],context:any,sessionId?:string) {
 if(failure)throw new Error(failure);
 const base=caches.get(key);if(!base)throw new Error('Carga este registro antes de modificarlo.');
 const rowKey=(row:any)=>JSON.stringify(sessionId?[String(row.student_id),String(row.criteria_id)]:[String(row.studentId),String(row.competencyKey)]);
 const previous=new Map(base.records.map((row:any)=>[rowKey(row),row]));
 const changed=changes.filter(row=>{
  const old:any=previous.get(rowKey(row));
  return sessionId?String(old?.level||'')!==row.level||String(old?.observation||'')!==row.observation:String(old?.conclusionText||'')!==row.conclusionText;
 });
 if(!changed.length){clearEvaluationPending(key);return {success:true};}
 const stamp=pending.get(key);
 const result=await withWebSave(()=>academicApi('/api/evaluation/'+(sessionId?'grades':'conclusions'),'PUT',{...(sessionId?{sessionId,sourceVersion:base.sourceVersion}:{context}),changes:changed,expectedRevision:base.revision,operationId:crypto.randomUUID()}));
 loaded(key,{...result,...(sessionId?{sourceVersion:base.sourceVersion}:{})});
 if(stamp===pending.get(key))pending.delete(key);
 if(pending.size)window.dispatchEvent(new CustomEvent('armi-web-save',{detail:{state:'pending'}}));
 return {success:true};
}
export async function saveEvaluacionRegistros(data:any) {
 try {
  if(!data.records?.length)return {success:true};
  const id=data.records[0].session_id;
  if(data.records.some((row:any)=>row.session_id!==id))throw new Error('Guarda una sesión a la vez.');
  return await enqueue('grades:'+id,()=>persist('grades:'+id,data.records,null,id));
 }catch(error){return failed(error);}
}
export async function saveEvaluacionConclusiones(data:any) {
 try {
  if(!data.records?.length)return {success:true};
  const context=contextOf(data.records[0]),key=conclusionKey(context);
  if(data.records.some((row:any)=>conclusionKey(row)!==key))throw new Error('Guarda un ámbito de conclusiones a la vez.');
  const changes=data.records.map((row:any)=>Object.fromEntries(['studentId','competencyKey','competencyName','competencySource','conclusionText'].map(k=>[k,row[k]])));
  return await enqueue(key,()=>persist(key,changes,context));
 }catch(error){return failed(error);}
}
export function useWebConclusionAutosave(key:string,records:any[],ready:boolean) {
 const callbacks=useRef(new Map<string,()=>Promise<any>>());
 const encoded=JSON.stringify(records);
 useEffect(()=>{
  if(!ready||failure||!caches.has('conclusions:'+key))return;
  const base=caches.get('conclusions:'+key);
  const changed=records.some(row=>String(base.records.find((old:any)=>old.studentId===row.studentId&&old.competencyKey===row.competencyKey)?.conclusionText||'')!==row.conclusionText);
  if(!changed){clearEvaluationPending('conclusions:'+key);callbacks.current.delete(key);return;}
  const scope='conclusions:'+key;
  markEvaluationPending(scope);
  const save=()=>saveEvaluacionConclusiones({records});callbacks.current.set(key,save);
  const timer=window.setTimeout(()=>{void save();},700);
  return()=>window.clearTimeout(timer);
 },[key,encoded,ready]);
 useEffect(()=>()=>{if(evaluationPending('conclusions:'+key)&&!failure)void callbacks.current.get(key)?.();},[key]);
}
