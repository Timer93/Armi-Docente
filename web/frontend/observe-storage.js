import {FRONTEND_KEYS} from '../src/configuration-keys.js';
import {getWebIdentity} from './runtime.js';
// The web uses memory storage, not Storage.prototype and not the PC sync loop.
// Batch a burst once; a failed save is reported, never retried indefinitely.
export function observePortableStorage(save,initialKeys=[],{host=window,delayMs=500}={}) {
  if(!getWebIdentity()?.academic?.settingsEditable) return ()=>{};
  const pending=new Set(initialKeys.filter(key=>FRONTEND_KEYS.includes(key)));
  let active=true,busy=false,failed=false,timer;
  const notify=()=>host.dispatchEvent(new CustomEvent('armi-web-save',{detail:{state:'pending'}}));
  const schedule=()=>{if(active && !failed && pending.size && !timer && !busy)timer=setTimeout(flush,delayMs);};
  const flush=async()=>{
    timer=undefined;if(!active || failed || busy || !pending.size)return;
    const keys=[...pending];pending.clear();busy=true;
    try {if(!await save(keys))throw new Error('No se pudo guardar la configuración. Recarga antes de continuar.');}
    catch(error) {failed=true;host.dispatchEvent(new CustomEvent('armi-web-save',{detail:{state:'error',message:error.message}}));}
    finally {busy=false;if(active && pending.size && !failed){notify();schedule();}}
  };
  const changed=event=>{const key=event.detail?.key;if(!FRONTEND_KEYS.includes(key) || failed)return;pending.add(key);notify();schedule();};
  host.addEventListener('armi-web-storage-changed',changed);
  if(pending.size){notify();schedule();}
  return ()=>{active=false;clearTimeout(timer);host.removeEventListener('armi-web-storage-changed',changed);};
}
