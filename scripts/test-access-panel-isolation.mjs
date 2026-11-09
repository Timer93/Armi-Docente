import assert from 'node:assert/strict';
import {startPanelPolling} from '../utils/panelPolling.ts';
import {needsAcademicViewRefresh} from '../utils/moduleStateRefresh.ts';
import {requestAgent} from '../services/accessControl.ts';

let visible=true,wake,unsubscribe=0,requests=0,maxActive=0,active=0,resolveRequest;
const timers=new Map();let id=0;const signals=[];
const environment={visible:()=>visible,subscribe:callback=>{wake=callback;return()=>{unsubscribe++;wake=null;};},schedule:(callback,delay)=>{timers.set(++id,{callback,delay});return id;},cancel:key=>timers.delete(key)};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const stop=startPanelPolling(async signal=>{requests++;signals.push(signal);active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>resolveRequest=resolve);active--;},10000,environment);
assert.equal(requests,1);assert.equal(timers.size,0,'A slow request must not overlap another interval');
visible=false;wake();assert.equal(signals[0].aborted,true);assert.equal(timers.size,0);
visible=true;wake();assert.equal(requests,1,'Wait for the aborted request to finish before restarting');resolveRequest();await flush();
assert.equal([...timers.values()][0].delay,0);const first=[...timers.entries()][0];timers.delete(first[0]);first[1].callback();assert.equal(requests,2);
stop();assert.equal(signals[1].aborted,true);resolveRequest();await flush();assert.equal(timers.size,0);assert.equal(unsubscribe,1);assert.equal(maxActive,1);
assert.equal(requests,2,'Leaving the panel cancels pending work and schedules no further requests');
visible=false;const idle=startPanelPolling(()=>{requests++;},10000,environment);await flush();assert.equal(requests,2,'An invisible panel must not poll');idle();
const before={armi_access_control_v1:'old',armi_calendar_v1:'calendar',armi_assignments_v1:'assignments'};
assert.equal(needsAcademicViewRefresh(before,{...before,armi_access_control_v1:'new'}),false,'Device settings must not remount sessions or other academic modules');
assert.equal(needsAcademicViewRefresh(before,{...before,armi_calendar_v1:'new'}),true,'Real academic configuration changes must still update views');
assert.equal(needsAcademicViewRefresh(before,{armi_access_control_v1:'new',armi_calendar_v1:'calendar'}),true,'A real academic deletion must remain visible');
assert.equal(needsAcademicViewRefresh(before,{...before}),false);
for(const key of ['armi_hybrid_numeric_scores_v1','armi_view_selection_sesiones_v1','armi_sessions_theme','armi_cloud_sync_recent_manual_push_at'])assert.equal(needsAcademicViewRefresh(before,{...before,[key]:'new'}),false,'Auxiliary changes must not reset an open editor: '+key);
for(const key of ['armi_fast_session_index_v1','armi_birthdays_toast_seen','armi_ai_usage_daily_v1','armi_general_notes_board_v1'])assert.equal(needsAcademicViewRefresh(before,{...before,[key]:'new'}),false,'Caches and activity bookkeeping must preserve the open draft: '+key);
const nativeFetch=globalThis.fetch;let captured;
try{
  globalThis.fetch=(_url,options)=>{captured=options.signal;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
  const controller=new AbortController(),pending=requestAgent('agent',undefined,controller.signal);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(captured.aborted,true);
}finally{globalThis.fetch=nativeFetch;}
console.log('OK: panel-scoped polling, no overlapping requests, hidden-page pause, abort on exit, no restart after late completion, and classroom settings isolated from academic view refreshes.');
