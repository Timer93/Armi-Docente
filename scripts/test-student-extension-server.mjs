import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-extension-server-'));
fs.mkdirSync(path.join(root,'database'));fs.mkdirSync(path.join(root,'sync-runtime'));
new Database(path.join(root,'database/armi.db')).close();
fs.writeFileSync(path.join(root,'sync-runtime/sync-config.json'),JSON.stringify({mode:'local',mirrorPath:'',syncUserKey:'isolated-extension-test'}));
const freePort=async()=>{const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;};
const teacherPort=await freePort(),studentPort=await freePort();
const teacher=`http://127.0.0.1:${teacherPort}`,student=`http://127.0.0.1:${studentPort}`;
const child=spawn(process.execPath,['backend/server.js'],{windowsHide:true,env:{...process.env,ARMI_DATA_ROOT:root,ARMI_STUDENT_DISCOVERY:'0',ARMI_BACKEND_PORT:String(teacherPort),ARMI_STUDENT_PORTAL_PORT:String(studentPort),NODE_ENV:'production',ARMI_USE_VITE_MIDDLEWARE:'0'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',data=>{logs+=data});child.stderr.on('data',data=>{logs+=data});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
 let ready=false;
 for(let i=0;i<600;i++) {try{if((await fetch(`${teacher}/api/health`,{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}await pause(200);}
 assert.ok(ready,'Isolated full backend must start: '+logs.slice(-2500));
 const empty=await (await fetch(`${teacher}/api/admin/access-control`)).json();assert.equal(empty.success,true);
 const config={version:1,groups:[],devices:[{id:'smokepc',name:'PC de prueba',groupId:null}],rules:[{id:'block',name:'Bloqueo',enabled:true,domains:['example.com'],scope:'all',groupId:null,deviceIds:[]}]};
 assert.equal((await fetch(`${teacher}/api/admin/access-control`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,revision:empty.data.revision})})).status,200);
 const pair=await (await fetch(`${teacher}/api/admin/access-control/devices/smokepc/pairing`,{method:'POST'})).json();assert.equal(pair.success,true);
 assert.equal((await fetch(`${student}/api/admin/access-control/devices/smokepc/pairing`,{method:'POST'})).status,404, 'The student gateway must not expose administrative routes');
 const response=await fetch(`${student}/api/access-extension/pair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:pair.data.code})});assert.equal(response.status,200);
 const data=(await response.json()).data;
 const readClock=()=>{const db=new Database(path.join(root,'database/armi.db'),{readonly:true});try{return db.prepare('SELECT revision FROM sync_change_clock WHERE id=1').get().revision;}finally{db.close();}};
 const before=readClock();
 for(let i=0;i<3;i++) {
  const policy=await (await fetch(`${student}/api/access-extension/policy`,{headers:{Authorization:`Bearer ${data.token}`}})).json();assert.deepEqual(policy.data.domains,['example.com']);
  const ack=await fetch(`${student}/api/access-extension/ack`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.token}`},body:JSON.stringify({revision:policy.data.revision,blockedCount:1,extensionVersion:'1.0.0'})});assert.equal(ack.status,200);
 }
 assert.equal(readClock(),before,'Extension traffic must not increment the academic synchronization clock');
 const status=await(await fetch(`${teacher}/api/admin/access-control/extension`)).json();assert.equal(status.data.devices[0].state,'applied');
 assert.ok(fs.existsSync(path.join(root,'sync-runtime/access-extension.sqlite')));
 const download=await fetch(`${teacher}/extensions/ARMI-Estudiantes.zip`);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),fs.readFileSync('public/extensions/ARMI-Estudiantes.zip'));
 const nativeCode=await(await fetch(`${teacher}/api/admin/access-control/devices/smokepc/agent-pairing`,{method:'POST'})).json();assert.equal(nativeCode.success,true);
 const nativePair=await(await fetch(`${student}/api/student-agent/pair`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:nativeCode.data.code,installationId:'full-server-test-0001',machineName:'Test'})})).json();assert.equal(nativePair.success,true);
 const token=nativePair.data.token,policy=nativePair.data.policy,clock=readClock();
 const nativeHeaders={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
 for(let i=0;i<3;i++){assert.equal((await fetch(`${student}/api/student-agent/heartbeat`,{method:'POST',headers:nativeHeaders,body:JSON.stringify({revision:policy.revision,navigationState:'configured',blockedCount:1,capabilities:{navigation:true,folders:true,files:true},rootPath:'C:/ARMI-Aula'})})).status,200);assert.equal((await fetch(`${student}/api/student-agent/jobs`,{headers:nativeHeaders})).status,200);}
 assert.equal(readClock(),clock,'Native agent traffic must not change academic sync clock');
 const form=new FormData();form.append('scope',JSON.stringify({type:'devices',deviceIds:['smokepc']}));form.append('relativePath','Unidad 7/guia.txt');form.append('file',new Blob(['Guía de sesión']),'guia.txt');
 const delivered=await(await fetch(`${teacher}/api/admin/access-control/agent/files`,{method:'POST',body:form})).json();assert.equal(delivered.success,true);assert.equal(delivered.data.count,1);
 const nativeJobs=await(await fetch(`${student}/api/student-agent/jobs`,{headers:nativeHeaders})).json();assert.equal(nativeJobs.data.length,1);
 const attachment=await fetch(`${student}${nativeJobs.data[0].file.url}`,{headers:nativeHeaders});assert.equal(await attachment.text(),'Guía de sesión');
 assert.equal((await fetch(`${student}/api/admin/access-control/agent/enrollment`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
 const exe=await fetch(`${student}/agents/ARMI-Estudiante-Setup.exe`);assert.equal(exe.status,200);assert.deepEqual(Buffer.from(await exe.arrayBuffer()),fs.readFileSync('public/agents/ARMI-Estudiante-Setup.exe'));
 console.log('OK: full isolated ARMI backend, protected student gateway, ZIP/EXE downloads, browser and native pairing, multipart delivery, heartbeat/jobs and zero academic-clock changes from agent traffic.');
} finally {
 child.kill();for(let i=0;i<50&&child.exitCode===null;i++)await pause(100);
 if(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)) {
  try{await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch(error){if(!['EPERM','EBUSY'].includes(error.code))throw error;}
 }
}
