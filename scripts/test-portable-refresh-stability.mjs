import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
class Storage {
  data=new Map(); writes=0;
  get length(){return this.data.size;}
  key(index){return [...this.data.keys()][index]??null;}
  getItem(key){return this.data.get(key)??null;}
  setItem(key,value){this.writes++;this.data.set(key,String(value));}
  removeItem(key){this.writes++;this.data.delete(key);}
}
globalThis.window=new EventTarget();window.localStorage=new Storage();
const {collectArmiLocalState,applyArmiLocalState,emitCloudSyncUpdated,CLOUD_SYNC_EVENT}=await load('utils/cloudSyncState.ts');
const {needsAcademicViewRefresh}=await load('utils/moduleStateRefresh.ts');
const events=[];window.addEventListener(CLOUD_SYNC_EVENT,event=>events.push(event.detail.changedKeys));
window.localStorage.setItem('armi_calendar_v1','local draft');
window.localStorage.setItem('armi_fast_session_index_v1','cache');
window.localStorage.setItem('armi_auth_session_v1','session');
const snapshot=collectArmiLocalState(),writes=window.localStorage.writes;
applyArmiLocalState(snapshot);emitCloudSyncUpdated();
assert.equal(window.localStorage.writes,writes,'Reapplying identical state must not trigger storage writes or autosave');
assert.deepEqual(events.pop(),[],'A status event must not report previously edited local state as a newly received change');
applyArmiLocalState({...snapshot,armi_fast_session_index_v1:'new cache'});emitCloudSyncUpdated();
let changed=events.pop();assert.equal(needsAcademicViewRefresh({},Object.fromEntries(changed.map(key=>[key,'changed']))),false);
applyArmiLocalState({armi_calendar_v1:'received schedule'});emitCloudSyncUpdated();
changed=events.pop();assert.ok(changed.includes('armi_calendar_v1'));assert.ok(changed.includes('armi_fast_session_index_v1'),'Remote deletions remain visible');
assert.equal(needsAcademicViewRefresh({},Object.fromEntries(changed.map(key=>[key,'changed']))),true);
assert.equal(window.localStorage.getItem('armi_auth_session_v1'),'session');
console.log('OK: unchanged hydration makes no writes, status-only events preserve drafts, auxiliary cache updates stay isolated and received academic changes/deletions still refresh.');
