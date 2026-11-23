import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observePortableStorage} from '../frontend/observe-storage.js';
import {createMemoryStorage,setWebIdentity} from '../frontend/runtime.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('web storage groups changed configuration keys, ignores credentials and never retries a rejected batch',async t=>{
  const host=new EventTarget();const batches=[],states=[];
  setWebIdentity({academic:{settingsEditable:true}});t.after(()=>setWebIdentity(null));
  host.addEventListener('armi-web-save',event=>states.push(event.detail));
  const stop=observePortableStorage(async keys=>{batches.push(keys);return batches.length===1;},[],{host,delayMs:5});t.after(stop);
  const changed=key=>host.dispatchEvent(new CustomEvent('armi-web-storage-changed',{detail:{key}}));
  changed('armi_areas');changed('armi_assignments');changed('armi_areas');changed('armi_auth_session_v1');
  await pause(30);assert.equal(batches.length,1);assert.deepEqual(batches[0].sort(),['armi_areas','armi_assignments']);
  changed('armi_schedule_config');await pause(30);assert.equal(batches.length,2);
  changed('armi_calendar_state');await pause(30);assert.equal(batches.length,2,'Failure does not start a retry loop');
  assert.equal(states.at(-1).state,'error');
});
test('memory storage notifies only actual changes and unsubscribing prevents later saves',async t=>{
  const events=[];const memory=createMemoryStorage(key=>events.push(key));
  memory.setItem('a','1');memory.setItem('a','1');memory.setItem('b','2');memory.removeItem('a');memory.removeItem('a');memory.clear();
  assert.deepEqual(events,['a','b','a','b']);
  const host=new EventTarget();setWebIdentity({academic:{settingsEditable:true}});t.after(()=>setWebIdentity(null));
  let count=0;const stop=observePortableStorage(async()=>{count++;return true;},[],{host,delayMs:5});stop();
  host.dispatchEvent(new CustomEvent('armi-web-storage-changed',{detail:{key:'armi_areas'}}));await pause(15);assert.equal(count,0);
});
