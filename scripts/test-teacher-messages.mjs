import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
import {prepareInstallerDatabase} from './prepare-installer-database.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'armi-teacher-messages-'));
const port=35500+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;
let db,child,logs='';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=async(route,{token,data,expected=200,gateway=false}={})=>{
  const response=await fetch(`${gateway?`http://127.0.0.1:${port+1}`:base}/api/${route}`,{method:data?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const payload=await response.json();assert.equal(response.status,expected,payload.message);return payload.data;
};
try{
  const file=path.join(root,'database/armi.db');await prepareInstallerDatabase(path.resolve('database/armi.db'),file);db=new Database(file);
  db.prepare('INSERT INTO datos_generales(id,year,teacher) VALUES(1,?,?)').run('2026','Docente de prueba');
  const students=['A','A','B'].map((section,index)=>{const dni=`9999912${index}`;const result=db.prepare("INSERT INTO db_estudiantes(dni,estudiantes,grado,secc,estado,password_hash) VALUES(?,?,?,?,'A','')").run(dni,`Alumno ${index}`,index===2?'3ro':'5to',section);return {id:String(result.lastInsertRowid),dni};});
  child=spawn(process.execPath,['backend/server.js'],{windowsHide:true,env:{...process.env,ARMI_DATA_ROOT:root,ARMI_BACKEND_PORT:String(port),ARMI_STUDENT_PORTAL_PORT:String(port+1),ARMI_USE_VITE_MIDDLEWARE:'0',ARMI_DISABLE_DRIVE_LAUNCH:'1',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  const deadline=Date.now()+60000;while(true){assert.equal(child.exitCode,null,logs);try{if((await fetch(`${base}/api/health`)).ok)break;}catch{}if(Date.now()>deadline)throw new Error(logs);await wait(200);}
  for(const student of students){const session=await call('student-portal/login',{data:{dni:student.dni,password:student.dni}});student.token=session.token;await call('student-portal/change-password',{token:student.token,data:{password:'Messages2026!',confirmation:'Messages2026!'}});}
  const [a,b,c]=students;
  await call('student-portal/logout',{token:c.token,data:{}});
  const targets=await call('student-messages/teacher/recipients');assert.equal(targets.filter(item=>item.online).length,2);
  const draft={title:'Aviso de prueba',body:'Revisen su entrega.',audience:'online',requestId:'test-online-001'};
  const online=await call('student-messages/teacher/messages',{data:draft});assert.equal(online.recipients,2);
  assert.equal((await call('student-messages/teacher/messages',{data:draft})).id,online.id,'Retrying the request must not send twice');
  const personal=await call('student-messages/teacher/messages',{data:{...draft,audience:'personal',studentId:b.id,requestId:'test-personal-001',body:'Mensaje personal para B'}});
  assert.equal(personal.recipients,1);
  const inboxA=await call('student-portal/teacher-messages',{token:a.token});assert.equal(inboxA.items.length,1);assert.equal(inboxA.unread,1);assert.equal(inboxA.items[0].teacherName,'Docente de prueba');
  const inboxB=await call('student-portal/teacher-messages',{token:b.token});assert.equal(inboxB.items.length,2);
  await call(`student-portal/teacher-messages/${personal.id}/read`,{token:a.token,data:{},expected:404});
  await call('student-portal/teacher-messages',{expected:401});
  await call('student-messages/teacher/messages',{gateway:true,token:a.token,data:{...draft,requestId:'forged-message-001'},expected:404});
  await call(`student-portal/teacher-messages/${online.id}/notified`,{token:a.token,data:{}});
  const notified=await call('student-portal/teacher-messages',{token:a.token});assert.equal(notified.unread,1);assert.ok(notified.items[0].notifiedAt);assert.equal(notified.items[0].readAt,null,'Displaying a toast must not mark the message read');
  await call(`student-portal/teacher-messages/${online.id}/read`,{token:a.token,data:{}});
  await call(`student-portal/teacher-messages/${online.id}/read`,{token:a.token,data:{}});
  assert.equal((await call('student-portal/teacher-messages',{token:a.token})).unread,0);
  assert.equal((await call('student-portal/teacher-messages',{token:b.token})).unread,2,'Read status belongs to each recipient');
  assert.equal((await call('student-messages/teacher/messages',{data:{...draft,audience:'class',grade:'5to',section:'A',requestId:'test-class-001'}})).recipients,2);
  assert.equal((await call('student-messages/teacher/messages',{data:{...draft,audience:'all',requestId:'test-all-001'}})).recipients,3,'Offline students retain messages sent to everyone');
  await call('student-messages/teacher/messages',{data:{...draft,audience:'personal',studentId:'missing',requestId:'test-missing-001'},expected:400});
  await call('student-messages/teacher/messages',{data:{...draft,title:'',requestId:'test-invalid-001'},expected:400});
  const history=await call('student-messages/teacher/messages');assert.equal(history.length,4);assert.equal(history.find(item=>item.id===online.id).readCount,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM student_teacher_message_recipients WHERE message_id=? AND student_id=?').get(online.id,c.id).count,0);
  console.log('OK: online, class, all and personal messages; private inbox, local teacher access, retry deduplication, unread and toast receipts.');
}finally{
  db?.close();if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([done,wait(5000)]);}
  const resolved=path.resolve(root);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('armi-teacher-messages-'))fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
