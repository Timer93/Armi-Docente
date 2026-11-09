import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync('services/apiService.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const isolated=js.replace(/^import[^;]+;/gm, '');
const api=await import('data:text/javascript;base64,'+Buffer.from(isolated).toString('base64'));
let calls=0,release,seen;
globalThis.fetch=async(url,options)=>{calls++;seen={url,options};return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({success:true,data:{config:{mode:'local'}}}),{headers:{'Content-Type':'application/json'}}));});};
const a=api.getCloudSyncStatus(),b=api.getCloudSyncStatus();
assert.equal(a,b,'Concurrent diagnostic readers share one request');assert.equal(calls,1);release();await a;
globalThis.fetch=(url,options)=>{
  calls++;seen={url,options};
  return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
};
const controller=new AbortController(),pending=api.getLocalCloudSyncStatus({lightweight:true,signal:controller.signal});
assert.match(seen.url,/status\/local\?lightweight=1$/);
controller.abort();assert.equal(seen.options.signal.aborted,true);
const response=await pending;assert.equal(response.success,false);assert.equal(calls,2,'Leaving a panel cancels the request without retrying four times');
console.log('OK: shared full-status requests, lightweight progress requests and immediate cancellation without retry storms.');
