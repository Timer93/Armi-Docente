import {FRONTEND_KEYS} from '../src/configuration-keys.js';
import {readAcademic,academicApi,configurationMetadata,acceptConfiguration,withWebSave} from './academic-client';
import {getWebIdentity} from './runtime.js';
let sequence: Promise<unknown> = Promise.resolve();
export function persistConfiguration(state: Record<string,string>, changedKeys=FRONTEND_KEYS) {
  const owner=getWebIdentity()?.user.id;
  const keys=changedKeys.filter(key=>FRONTEND_KEYS.includes(key));
  // Capture only the requested keys. Queued writes never publish unrelated
  // storage values or credentials, nor replace a newer server revision.
  const captured=Object.fromEntries(keys.map(key=>[key,state[key]]));
  const pending=sequence.then(async()=>{
    if(!getWebIdentity()?.academic?.settingsEditable) throw new Error('Falta activar la configuración web en D1 (0006_web_configuration.sql).');
    const rows=await readAcademic('frontend');
    if(getWebIdentity()?.user.id!==owner) throw new Error('La cuenta cambió. Recarga la página.');
    const current=Object.fromEntries(rows.map(row=>[row.id,row.value]));
    const changes: Record<string,unknown>={};const removed: string[]=[];
    for(const key of keys) {
      if(captured[key]===undefined) {if(Object.hasOwn(current,key))removed.push(key);}
      else {const value=JSON.parse(captured[key]);if(JSON.stringify(value)!==JSON.stringify(current[key]))changes[key]=value;}
    }
    if(!Object.keys(changes).length && !removed.length) return withWebSave(async()=>true);
    return withWebSave(async()=>{
      const result=await academicApi('/api/academic/settings','PUT',{changes,removed,...configurationMetadata(),operationId:crypto.randomUUID()});
      if(getWebIdentity()?.user.id!==owner) throw new Error('La cuenta cambió. Recarga la página.');
      acceptConfiguration(result);return true;
    });
  });
  sequence=pending.catch(()=>{});
  return pending;
}
export const configurationState=()=>Object.fromEntries(FRONTEND_KEYS.flatMap(key=>{
  const value=window.localStorage.getItem(key);return value===null?[]:[[key,value]];
}));
