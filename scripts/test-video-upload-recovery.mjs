import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import crypto from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import Database from 'better-sqlite3';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';
const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'armi-video-upload-'));
const databasePath=path.join(testRoot,'database/armi.db');
const port=39000+process.pid%500;
const apiUrl=`http://127.0.0.1:${port+1}/api`;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const requestJson=async(url,options={})=>{const response=await fetch(url,options);return {response,data:await response.json()};};
let child,logs='';
try{
  await prepareInstallerDatabase(path.resolve('database/armi.db'),databasePath);
  const db=new Database(databasePath);
  db.prepare('INSERT INTO datos_generales(id,year,teacher,evidence_storage_path) VALUES(1,?,?,?)').run('2026','Video teacher',path.join(testRoot,'evidencias'));
  const studentId=String(db.prepare("INSERT INTO db_estudiantes(dni,estudiantes,grado,secc,estado,password_hash) VALUES('99999777','Video test','5to','A','A','')").run().lastInsertRowid);
  const session={id_sesion:'video-session'};
  const primaryRequested={id:''};
  db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)').run(session.id_sesion,'2026','video-area','5to','A','1','1',JSON.stringify({title:'Video upload test',date:'2026-01-01'}));
  db.prepare('INSERT INTO evaluacion_ventanas_entrega(session_id,enabled,open_from,close_at,exceptional) VALUES(?,1,?,?,1)').run(session.id_sesion,new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString());
  db.close();
  child=spawn(process.execPath,['backend/server.js'],{windowsHide:true,env:{...process.env,ARMI_DATA_ROOT:testRoot,ARMI_BACKEND_PORT:String(port),ARMI_STUDENT_PORTAL_PORT:String(port+1),ARMI_USE_VITE_MIDDLEWARE:'0',ARMI_DISABLE_DRIVE_LAUNCH:'1',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',c=>{logs+=c;});child.stderr.on('data',c=>{logs+=c;});
  const readyDeadline=Date.now()+45000;
  while(true){assert.equal(child.exitCode,null,logs);try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{}if(Date.now()>readyDeadline)throw new Error(logs);await wait(100);}
  const login=await requestJson(`${apiUrl}/student-portal/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dni:'99999777',password:'99999777'})});
  assert.equal(login.data.success,true,login.data.message);
  const auth={Authorization:`Bearer ${login.data.data.token}`};
  const changed=await requestJson(`${apiUrl}/student-portal/change-password`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({password:'VideoTest2026!',confirmation:'VideoTest2026!'})});
  assert.equal(changed.data.success,true,changed.data.message);
  // A valid MP4 padded to the reported size exercises mobile fragments,
  // interrupted first requests, background conversion and lost acknowledgements.
  const videoPath = path.join(testRoot, 'video-44MiB.mp4');
  const generatedVideo = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=12', '-t', '2',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath],
  { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(generatedVideo.status, 0, generatedVideo.stderr);
  const videoHandle = fs.openSync(videoPath, 'r+');
  fs.ftruncateSync(videoHandle, 46732367); fs.closeSync(videoHandle);
  const videoBytes = fs.readFileSync(videoPath);
  const videoInit = await requestJson(`${apiUrl}/student-portal/uploads/init`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id_sesion, requestedEvidenceId: primaryRequested.id,
      fileName: 'video-44MiB.mp4', fileType: 'video/mp4', totalSize: videoBytes.length,
      sha256: crypto.createHash('sha256').update(videoBytes).digest('hex') }),
  });
  assert.equal(videoInit.data.success, true, videoInit.data.message);
  const video = videoInit.data.data;
  assert.equal(video.chunkSize, 1024 * 1024, 'Mobile portal requests must have bounded 1 MiB fragments');
  await new Promise(resolve => {
    const interrupted = httpRequest(`${apiUrl}/student-portal/uploads/${video.uploadId}/chunks/0`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream', 'Content-Length': video.chunkSize },
    });
    interrupted.on('error', resolve); interrupted.on('close', resolve);
    interrupted.write(videoBytes.subarray(0, 128 * 1024));
    setTimeout(() => interrupted.destroy(), 50);
  });
  await wait(100);
  const afterCut = await requestJson(`${apiUrl}/student-portal/uploads/${video.uploadId}/status`, { headers: auth });
  assert.equal(afterCut.data.data.receivedChunks.length, 0, 'A partial chunk must not be acknowledged');
  for (const index of video.missingChunks) {
    const part = videoBytes.subarray(index * video.chunkSize, Math.min(videoBytes.length, (index + 1) * video.chunkSize));
    const received = await requestJson(`${apiUrl}/student-portal/uploads/${video.uploadId}/chunks/${index}`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream',
        'X-Chunk-SHA256': crypto.createHash('sha256').update(part).digest('hex') }, body: part,
    });
    assert.equal(received.data.success, true, received.data.message);
  }
  const beginCompletion = () => requestJson(`${apiUrl}/student-portal/uploads/${video.uploadId}/complete`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ background: true }),
  });
  const startedAt = Date.now();
  const [started, repeated] = await Promise.all([beginCompletion(), beginCompletion()]);
  assert.equal(started.response.status, 202, 'Conversion must not hold the HTTP response open');
  assert.equal(repeated.data.success, true);
  assert.ok(Date.now() - startedAt < 2000);
  let finalStatus;
  const finalDeadline = Date.now() + 30000;
  do {
    finalStatus = (await requestJson(`${apiUrl}/student-portal/uploads/${video.uploadId}/status`, { headers: auth })).data.data;
    assert.notEqual(finalStatus.status, 'FAILED_FINALIZATION', finalStatus.lastError);
    if (finalStatus.status === 'COMPLETED') break;
    await wait(100);
  } while (Date.now() < finalDeadline);
  assert.equal(finalStatus.status, 'COMPLETED');
  const acknowledgedAgain = await beginCompletion();
  assert.equal(acknowledgedAgain.data.data.id, finalStatus.completedEvidenceId, 'Lost completion acknowledgements must reuse the saved evidence');
  const videoCheck = new Database(databasePath, { readonly: true });
  assert.equal(videoCheck.prepare("SELECT COUNT(*) n FROM evaluacion_evidencias WHERE student_id=? AND file_name='video-44MiB.mp4'").get(studentId).n, 1);
  videoCheck.close();
  console.log('OK: 44.6 MiB video, interrupted chunk, 1 MiB resume, background conversion, concurrent completion and durable acknowledgement.');


  const contents=Buffer.from('legacy client');
  const legacyInit=await requestJson(`${apiUrl}/student-portal/uploads/init`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({sessionId:session.id_sesion,fileName:'legacy.txt',fileType:'text/plain',totalSize:contents.length})});
  assert.equal(legacyInit.data.success,true,legacyInit.data.message);
  const legacyId=legacyInit.data.data.uploadId;
  await requestJson(`${apiUrl}/student-portal/uploads/${legacyId}/chunks/0`,{method:'PUT',headers:{...auth,'Content-Type':'application/octet-stream'},body:contents});
  const legacySaved=await requestJson(`${apiUrl}/student-portal/uploads/${legacyId}/complete`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{}'});
  assert.equal(legacySaved.response.status,200);assert.ok(legacySaved.data.data.id);
  console.log('OK: synchronous finalization remains compatible with existing clients.');
}finally{
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(path.dirname(path.resolve(testRoot))===path.resolve(os.tmpdir()))fs.rmSync(testRoot,{recursive:true,force:true});
}
