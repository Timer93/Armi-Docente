import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import {spawn,spawnSync} from 'node:child_process';
import express from 'express';
import Database from 'better-sqlite3';
import {createAccessControlStore} from '../backend/accessControl.js';
import {createStudentAgentService} from '../backend/studentAgent.js';
import {createAccessControlRouter} from '../backend/routes/accessControl.routes.js';
import {createStudentAgentRouter} from '../backend/routes/studentAgent.routes.js';
import {startStudentDiscovery,createStudentIdentity} from '../backend/studentDiscovery.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-auto-'));
const db=new Database(':memory:'),local=new Database(':memory:');db.exec('CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
const store=createAccessControlStore(db);store.save({version:1,groups:[{id:'aula',name:'Aula'}],devices:[],rules:[]},store.read().revision);
const service=createStudentAgentService({db,localDatabase:local,runtimeFolder:root});
const app=express();app.use(express.json());const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const port=server.address().port,origin=`http://127.0.0.1:${port}`;
app.use('/api/student-agent',createStudentAgentRouter(service,{studentPort:port}));app.use('/api/admin/access-control',createAccessControlRouter({db,agentService:service}));
const originalAutoRequest=service.autoRequest;let wrongApproval=false;service.autoRequest=body=>{const reply=originalAutoRequest(body);if(wrongApproval&&reply.approval){const data=JSON.parse(reply.approval.payload);reply.approval=service.identity.approve({...data,nonce:'0'.repeat(32)});}return reply;};
const discovery=startStudentDiscovery({identity:service.identity,studentPort:port,port:0,host:'127.0.0.1'});const udpPort=await discovery.ready;
const run=(exe,args)=>new Promise((resolve,reject)=>{const c=spawn(exe,args,{windowsHide:true,stdio:'pipe'});let out='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>out+=d);c.on('error',reject);c.on('exit',code=>code===0?resolve(out):reject(new Error('Native exit '+code+': '+out+' '+fs.readFileSync(path.join(os.tmpdir(),'armi-student-last-error.txt'),'utf8'))));});
const fixture=path.join(root,'native');fs.mkdirSync(fixture);const descriptor=service.identity.describe(crypto.randomBytes(16).toString('hex'),port);const serverId=JSON.parse(descriptor.payload).serverId;

const binary=path.join(root,'AgentTest.exe'),source=path.resolve('student-agent');
const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const result=spawnSync(csc,['/nologo','/target:winexe','/platform:x64','/out:'+binary,...['System','System.Core','System.Drawing','System.Windows.Forms','System.ServiceProcess','System.Web.Extensions','System.Security'].map(n=>'/reference:'+n+'.dll'),...['AssemblyInfo.cs','Agent.cs','Program.cs','Discovery.cs','SessionBridge.cs','TrayApp.cs','AutoForm.cs','WebPolicies.cs','SelfTest.cs'].map(n=>path.join(source,n))],{encoding:'utf8',windowsHide:true});
assert.equal(result.status,0,result.stdout+result.stderr);
const registry='Software\\ARMI\\StudentAgentTest\\'+crypto.randomUUID();
try {
  await run(binary,['--sandbox-discover',fixture,String(udpPort)]);const found=JSON.parse(fs.readFileSync(path.join(fixture,'discovery.json'),'utf8'));assert.equal(found[0].serverId,serverId);
  await run(binary,['--sandbox-auto-step',fixture,String(udpPort)]);assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'auto-result.json'))).paired,false);assert.equal(service.pendingRequests().length,1);assert.equal(store.read().config.devices.length,0);
  const request=service.pendingRequests()[0],firstState=JSON.parse(fs.readFileSync(path.join(fixture,'setup-state.json')));assert.match(request.verificationCode,/^[A-F0-9]{8}$/);assert.equal(firstState.verificationCode,request.verificationCode);
  service.approve({requestIds:[request.id],groupId:'aula'});
  wrongApproval=true;await assert.rejects(run(binary,['--sandbox-auto-step',fixture,String(udpPort)]));assert.equal(store.read().config.devices.length,0,'An approval for another challenge must not pair');wrongApproval=false;
  await run(binary,['--sandbox-auto-step',fixture,String(udpPort)]);const paired=JSON.parse(fs.readFileSync(path.join(fixture,'auto-result.json')));assert.equal(paired.paired,true);assert.equal(paired.serverId,serverId);assert.equal(paired.server,origin);
  assert.equal(store.read().config.devices.length,1);assert.equal(store.read().config.devices[0].groupId,'aula');assert.equal(service.pendingRequests().length,0);
  await run(binary,['--sandbox-tick',fixture,registry]);assert.equal(service.status()[0].version,'1.3.0');
  // The exact same binary must discover and pair with a second school without being rebuilt.
  const dbB=new Database(':memory:'),localB=new Database(':memory:');dbB.exec('CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
  const storeB=createAccessControlStore(dbB);storeB.save({version:1,groups:[],devices:[],rules:[]},storeB.read().revision);
  const serviceB=createStudentAgentService({db:dbB,localDatabase:localB,runtimeFolder:path.join(root,'school-b')});
  const appB=express();appB.use(express.json());const serverB=await new Promise(resolve=>{const s=appB.listen(0,'127.0.0.1',()=>resolve(s));});const portB=serverB.address().port;appB.use('/api/student-agent',createStudentAgentRouter(serviceB,{studentPort:portB}));
  const autoB=serviceB.autoRequest;let legacyB=true;serviceB.autoRequest=body=>autoB(legacyB?{...body,pairingProtocol:3}:body);
  const idB=JSON.parse(serviceB.identity.describe('0'.repeat(32),portB).payload).serverId;
  const multiple=dgram.createSocket('udp4');let advertisements=[{service:serviceB,port:portB}];
  multiple.on('message',(bytes,remote)=>{const query=JSON.parse(bytes.toString());for(const item of advertisements)multiple.send(Buffer.from(JSON.stringify(item.service.identity.describe(query.nonce,item.port))),remote.port,remote.address);});
  await new Promise(resolve=>multiple.bind(0,'127.0.0.1',resolve));const multiPort=multiple.address().port;let alternate;
  const state=()=>JSON.parse(fs.readFileSync(path.join(fixture,'setup-state.json')));
  const step=()=>run(binary,['--sandbox-auto-step',fixture,String(multiPort)]);
  const action=(name,arg)=>run(binary,['--sandbox-teacher-action',fixture,name,...(arg===undefined?[]:[String(arg)])]);
  const preserved=path.join(fixture,'classroom/original.txt');fs.writeFileSync(preserved,'original');
  try {
    await action('rediscover',multiPort);assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'action-result.json'))).serverId,serverId,'Reconnect must never adopt an unrelated teacher');
    advertisements=[{service,port},{service:serviceB,port:portB}];await action('change');await step();assert.equal(state().state,'choose');assert.equal(state().candidates.length,2);assert.equal(serviceB.pendingRequests().length,0);
    await action('select',idB);await step();const requestB=serviceB.pendingRequests()[0];assert.equal(state().verificationCode,requestB.verificationCode);serviceB.approve({requestIds:[requestB.id]});await step();assert.equal(state().state,'confirm');
    await action('cancel');assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'action-result.json'))).serverId,serverId,'Cancelling keeps previous teacher credentials');
    await action('change');await step();await action('select',idB);legacyB=false;await step();assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'auto-result.json'))).serverId,idB);
    await action('change');await step();await action('select',serverId);await step();const returnRequest=service.pendingRequests()[0];service.approve({requestIds:[returnRequest.id],groupId:'aula'});await step();assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'auto-result.json'))).serverId,serverId,'A previously verified teacher is remembered without reinstalling');
    alternate=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});advertisements=[{service,port:alternate.address().port}];await action('rediscover',multiPort);assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'action-result.json'))).server,`http://127.0.0.1:${alternate.address().port}`,'Address/port changes keep the pinned teacher identity');
    assert.equal(fs.readFileSync(preserved,'utf8'),'original');
  }finally{multiple.close();if(alternate)await new Promise(resolve=>alternate.close(resolve));await new Promise(resolve=>serverB.close(resolve));dbB.close();localB.close();}
  // A second native identity gets a scoped user credential; it cannot access service-only control.
  const code=service.code({groupId:'aula',maxUses:1});const p=service.pair({code:code.code,installationId:'session-native-test-0001',machineName:'PC sesiones'});const token=p.token;
  service.heartbeat(token,{revision:p.policy.revision,navigationState:'configured',blockedCount:0,capabilities:{navigation:true,folders:true,files:true},version:'1.1.0'});
  const sid='S-1-5-21-123-456-789-1001',session=service.session(token,{sid,username:'AULA\\Estudiante'});
  assert.throws(()=>service.policy(session.token),/Vinculación|Vinculaci/);
  const other=service.session(token,{sid:'S-1-5-21-123-456-789-1002',username:'AULA\\Otro'});
  const userHome=path.join(root,'user');fs.mkdirSync(userHome);const settings={server:origin,serverId,modulus:descriptor.modulus,token:session.token,rootPath:paired.rootPath||path.join(fixture,'classroom'),capabilities:{navigation:true,folders:true,files:true}};
  fs.writeFileSync(path.join(userHome,'sandbox-settings.json'),JSON.stringify(settings));
  const targetScope={type:'devices',deviceIds:[p.policy.deviceId]};service.createJobs({scope:targetScope,type:'create-folder',destination:'pictures',relativePath:'Unidad 7'});
  assert.equal(service.jobs(token).length,0,'The SYSTEM service must not receive user-folder jobs');
  const personal=service.jobs(session.token);assert.equal(personal.length,1);assert.equal(service.jobs(other.token).length,0,'A job claimed by one Windows user must not move to another user');assert.throws(()=>service.complete(token,personal[0].id,{state:'success'}),/encontrada/);
  await run(binary,['--sandbox-user-tick',userHome,registry]);assert.ok(fs.existsSync(path.join(userHome,'user-pictures/Unidad 7')));
  const payload=Buffer.from([255,216,255,224,0,16,74,70,73,70]);const form=new FormData();form.append('scope',JSON.stringify(targetScope));form.append('destination','pictures');form.append('folderPath','Unidad 7');form.append('onlyOnline','false');form.append('file',new Blob([payload]),'descarga (6).jpg');
  const delivery=await fetch(origin+'/api/admin/access-control/agent/files',{method:'POST',body:form});assert.equal(delivery.status,200,await delivery.text());

  await run(binary,['--sandbox-user-tick',userHome,registry]);assert.deepEqual(fs.readFileSync(path.join(userHome,'user-pictures/Unidad 7/descarga (6).jpg')),payload);
  assert.ok(service.folders().some(f=>f.relativePath==='Unidad 7'&&f.username==='AULA\\Estudiante'));
  service.createJobs({scope:targetScope,type:'rename-folder',destination:'pictures',relativePath:'Unidad 7',newRelativePath:'Unidad final'});await run(binary,['--sandbox-user-tick',userHome,registry]);assert.ok(fs.existsSync(path.join(userHome,'user-pictures/Unidad final/descarga (6).jpg')));
  assert.ok(service.folders().some(f=>f.relativePath==='Unidad final'));assert.ok(!service.folders().some(f=>f.deviceId===p.policy.deviceId&&f.relativePath==='Unidad 7'));
  service.createJobs({scope:targetScope,type:'open-folder',destination:'pictures',relativePath:'Unidad final'});await run(binary,['--sandbox-user-tick',userHome,registry]);assert.ok(service.history().filter(j=>j.deviceId===p.policy.deviceId).every(j=>j.state==='success'));
  assert.equal(service.status().find(d=>d.deviceId===p.policy.deviceId).activeUser,'AULA\\Estudiante');
  for(const action of ['create-folder','receive-file','rename-folder'])assert.throws(()=>service.createJobs({scope:targetScope,type:action,destination:'windows',relativePath:'test'}),/admitida/);
  console.log('OK: real UDP/RSA discovery, native autoconfiguration waits for teacher approval, automatic identity/group binding, scoped Windows-user credentials, actual personal-folder creation/download/rename, open-folder dispatch, user isolation and preservation of academic data.');
}finally{discovery.close();await new Promise(resolve=>server.close(resolve));db.close();local.close();await run('reg.exe',['delete','HKCU\\'+registry,'/f']).catch(()=>{});if(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))await fs.promises.rm(root,{recursive:true,force:true});}
