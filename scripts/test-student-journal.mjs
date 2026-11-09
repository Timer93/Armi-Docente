import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-journal-'));
const port = 39600 + process.pid % 300, base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let db, child, logs = '';
const call = async (route, { token, data, form, method = data || form ? 'POST' : 'GET', expected = 200, gateway = false } = {}) => {
  const response = await fetch(`${gateway ? `http://127.0.0.1:${port + 1}` : base}/api/${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : form ? { body: form } : {}) });
  const payload = await response.json();
  assert.equal(response.status, expected, payload.message);
  if (expected === 200) assert.equal(payload.success, true, payload.message);
  return payload.data;
};
const postForm = (requestId, files = [{ name: 'demo.html', body: '<html><body><h1>HTML de foro</h1><script>parent.pwned=true</script></body></html>', type: 'text/html' }]) => {
  const form = new FormData();
  form.append('requestId', requestId); form.append('title', 'Proyecto del equipo'); form.append('category', 'proyecto'); form.append('body', 'Compartimos nuestra propuesta.');
  files.forEach((file) => form.append('files', new Blob([file.body], { type: file.type || 'application/octet-stream' }), file.name));
  return form;
};
try {
  const dbPath = path.join(root, 'database/armi.db');
  await prepareInstallerDatabase(path.resolve('database/armi.db'), dbPath);
  db = new Database(dbPath);
  db.prepare('INSERT INTO datos_generales(id,year,teacher) VALUES(1,?,?)').run('2026', 'Docente del foro');
  const students = [['99999181', 'Estudiante A', 'A'], ['99999182', 'Estudiante B', 'A'], ['99999183', 'Estudiante C', 'B']].map(([dni, name, section]) => {
    const result = db.prepare("INSERT INTO db_estudiantes(dni,estudiantes,grado,secc,estado,password_hash) VALUES(?,?,?,?,'A','')").run(dni, name, section === 'B' ? '3ro' : '5to', section);
    return { dni, id: String(result.lastInsertRowid) };
  });
  child = spawn(process.execPath, ['backend/server.js'], { windowsHide: true, env: { ...process.env, ARMI_DATA_ROOT: root, ARMI_BACKEND_PORT: String(port), ARMI_STUDENT_PORTAL_PORT: String(port + 1), ARMI_USE_VITE_MIDDLEWARE: '0', ARMI_DISABLE_DRIVE_LAUNCH: '1', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { logs += chunk; }); child.stderr.on('data', (chunk) => { logs += chunk; });
  const deadline = Date.now() + 45000;
  while (true) { assert.equal(child.exitCode, null, logs); try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} if (Date.now() > deadline) throw new Error(logs); await wait(150); }
  for (const student of students) {
    const session = await call('student-portal/login', { data: { dni: student.dni, password: student.dni } });
    student.token = session.token;
    await call('student-portal/change-password', { token: student.token, data: { password: 'Forum2026!', confirmation: 'Forum2026!' } });
  }

  const [a,b,c] = students;
  const sessionId='journal-shared-class', another='journal-other-class';
  const insertSession=db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)');
  insertSession.run(sessionId,'2026','MAT','5to','A','1','5',JSON.stringify({title:'Mi aprendizaje'}));
  insertSession.run(another,'2026','MAT','3ro','B','1','5',JSON.stringify({title:'Otra clase'}));
  const evidence=db.prepare('INSERT INTO evaluacion_evidencias(student_id,session_id,year,file_path,file_name,file_type,file_size,is_latest) VALUES(?,?,?,?,?,?,?,1)');
  const own=String(evidence.run(a.id,sessionId,'2026','','reporte.png','image/png',0).lastInsertRowid);
  const other=String(evidence.run(b.id,sessionId,'2026','','otra.png','image/png',0).lastInsertRowid);
  const wrongSession=String(evidence.run(a.id,another,'2026','','otra-sesion.png','image/png',0).lastInsertRowid);
  const route=`student-portal/journal/${sessionId}`;
  const draft={date:'2026-10-04',activities:'Organic? mis datos.\nApliqu? filtros.',progress:'Prepar? un reporte.',difficulties:'Una f?rmula no funcionaba.',strategies:'Revis? mis c?lculos.',reflection:'<script>Texto literal, nunca HTML</script>',evidenceIds:[own],revision:''};
  await call('student-portal/journal',{expected:401});
  assert.equal((await call('student-portal/journal',{token:a.token})).length,0);
  const saved=await call(route,{method:'PUT',token:a.token,data:draft,gateway:true});
  assert.equal(saved.sessionId,sessionId);assert.equal(saved.activities,draft.activities);assert.equal(saved.reflection,draft.reflection);assert.equal(saved.evidences.length,1);assert.equal(String(saved.evidences[0].id),own);
  assert.equal((await call('student-portal/journal',{token:b.token})).length,0,'Students only see their own journals');
  await call(route,{method:'PUT',token:b.token,data:{...draft,evidenceIds:[own]},expected:403});
  await call(route,{method:'PUT',token:a.token,data:{...draft,revision:saved.revision,evidenceIds:[other]},expected:403});
  await call(route,{method:'PUT',token:a.token,data:{...draft,revision:saved.revision,evidenceIds:[wrongSession]},expected:403});
  await call(`student-portal/journal/${another}`,{method:'PUT',token:a.token,data:draft,expected:403});
  for(const invalid of ['2026-99-10','2026-02-30','bad'])await call(route,{method:'PUT',token:a.token,data:{...draft,date:invalid,revision:saved.revision},expected:400});
  await call(route,{method:'PUT',token:a.token,data:{...draft,activities:'x'.repeat(6001),revision:saved.revision},expected:400});
  await call(route,{method:'PUT',token:a.token,data:{...draft,evidenceIds:Array(11).fill(own),revision:saved.revision},expected:400});
  const edited=await call(route,{method:'PUT',token:a.token,data:{...draft,progress:'Nuevo reporte',revision:saved.revision}});
  assert.notEqual(edited.revision,saved.revision);
  await call(route,{method:'PUT',token:a.token,data:{...draft,progress:'Versi?n desactualizada',revision:saved.revision},expected:409});
  assert.equal((await call('student-portal/journal',{token:a.token}))[0].progress,'Nuevo reporte');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM student_learning_journal WHERE student_id=?').get(a.id).n,1,'Editing never creates a duplicate entry');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='student_learning_journal'").all().length>=3,'Journal must be tracked by mirror synchronization');
  for(const asset of ['student-portfolio.js','student-portfolio.css'])assert.equal((await fetch(`${base}/estudiante-assets/${asset}`)).status,200);
  const beforeRestart=db.prepare('SELECT * FROM student_learning_journal WHERE student_id=?').get(a.id);
  db.close();db=null;
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;child=null;
  db=new Database(dbPath);assert.deepEqual(db.prepare('SELECT * FROM student_learning_journal WHERE student_id=?').get(a.id),beforeRestart,'Data survives shutdown and reopening');
  console.log('OK: bitácora privada, edición por sesión, evidencias propias, validación, versiones concurrentes, persistencia y seguimiento para sincronización.');
} finally {
  db?.close();
  if (child && child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await Promise.race([exited, wait(5000)]); if (child.exitCode === null) { child.kill('SIGKILL'); await exited; } }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
