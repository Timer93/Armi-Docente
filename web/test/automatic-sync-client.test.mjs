import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../frontend/automatic-sync-client.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'sync'});
const context={setTimeout,clearTimeout};vm.runInNewContext(bundle.outputFiles[0].text,context);
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){let owner='A',pending=0,fail=false;const calls=[],timers=new Map();let serial=0,state;
 const controller=context.sync.createAutomaticWorkSync({owner:()=>owner,status:value=>{state=typeof value==='function'?value(state):value;},busy:()=>{},error:()=>{},
  setTimer:fn=>{timers.set(++serial,fn);return serial;},clearTimer:id=>timers.delete(id),request:async(path,method)=>{calls.push({path,method});if(method==='POST'){if(fail)throw new Error('offline');pending=0;return{pending:0,lastSentAt:Date.now(),desktopConfirmed:false};}return{ready:true,connected:true,authorized:true,pending};}});
 return {controller,calls,timers,getState:()=>state,setOwner:value=>{owner=value;},setPending:value=>{pending=value;},setFail:value=>{fail=value;},tick:async()=>{const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1]();}await settle();}};
}
test('Committed work is batched into one automatic send; idle time does not poll Drive',async()=>{
 const f=fixture();await f.controller.check();assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
 f.setPending(15);for(let i=0;i<15;i++)f.controller.committed('A');
 assert.equal(f.calls.length,1,'A burst of saves does not issue a request per edit');assert.equal(f.timers.size,1);
 await f.tick();assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.timers.size,0);
 assert.equal(f.getState().desktopConfirmed,false);f.controller.stop();
});
test('Failed sends pause automatic retries and account changes cancel scheduled work',async()=>{
 const f=fixture();await f.controller.check();f.setPending(1);f.setFail(true);f.controller.committed('A');await f.tick();
 assert.equal(f.calls.filter(call=>call.method==='POST').length,1);f.controller.committed('A');assert.equal(f.timers.size,0);
 f.setFail(false);f.controller.retry();await settle();assert.equal(f.calls.filter(call=>call.method==='POST').length,2);
 f.setPending(1);f.controller.committed('A');f.setOwner('B');const count=f.calls.length;await f.tick();assert.equal(f.calls.length,count);f.controller.stop();
});
