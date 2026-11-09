import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';
import {createIncrementalMirrorSync} from '../backend/incrementalMirrorSync.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-async-inventory-'));
const mirror=path.join(root,'mirror');fs.mkdirSync(mirror);
const db=new Database(':memory:');db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY,value TEXT);INSERT INTO notes VALUES('one','local work')");
const engine=createIncrementalMirrorSync({db,runtimeFolder:path.join(root,'runtime'),getDeviceId:()=> 'pc',excludedTables:[]});
const originalSync=fs.readdirSync,originalAsync=fs.promises.readdir;
let release,started=0,synchronous=0,observing=true;
const gate=new Promise(resolve=>{release=resolve;});
fs.readdirSync=function(file,...args){if(observing && String(file).startsWith(mirror)){synchronous++;throw new Error('Drive scan on the HTTP thread');}return originalSync.call(this,file,...args);};
fs.promises.readdir=async function(file,...args){if(String(file)===path.join(mirror,'.armi-sync','incremental-v1','devices')){started++;await gate;}return originalAsync.call(this,file,...args);};
const server=http.createServer((_req,res)=>res.end('healthy'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const running=engine.run({mirrorPath:mirror});
  await new Promise(resolve=>setTimeout(resolve,20));
  const inspecting=engine.inspectAsync({mirrorPath:mirror});
  const began=Date.now();
  const response=await fetch(`http://127.0.0.1:${server.address().port}/health`,{signal:AbortSignal.timeout(1000)});
  assert.equal(await response.text(),'healthy');
  assert.ok(Date.now()-began<1000,'A stalled Drive scan must leave the portal health check responsive');
  const [result,inspection]=await Promise.all([running,inspecting]);
  assert.equal(result.success,false);assert.equal(result.data.pendingTask.kind,'sync-inventory');
  assert.equal(inspection.pending,true);
  assert.equal(started,1,'Polling and the data queue share the same pending native scan');
  assert.equal(synchronous,0);
  release();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await engine.run({mirrorPath:mirror})).success,true);
  assert.equal(db.prepare('SELECT value FROM notes').get().value,'local work');
  console.log('OK: stalled Drive inventory does not block portal health, uses one shared scan, times out safely and resumes without losing local data.');
} finally {
  observing=false;release();fs.readdirSync=originalSync;fs.promises.readdir=originalAsync;
  await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true});
}
