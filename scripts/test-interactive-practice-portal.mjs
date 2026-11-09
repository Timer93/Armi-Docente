import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';
import { fixtureHtml as evidenceTemplateHtml } from './fixtures/evidence-template-server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-practice-'));
const dbPath = path.join(root, 'database/armi.db');
const port = 38000 + process.pid % 500;
const url = `http://127.0.0.1:${port}/api`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, db, logs = '';
const html = `<!doctype html><html><head><title>Práctica de prueba</title><meta name="armi-activity-version" content="1"></head><body><header>Reto</header><main>Pregunta 3</main><footer>Actividad compatible con ARMI Docente</footer><script>let state={question:1,answers:[],order:[3,1,2],score:0};window.ARMI_PRACTICE.register({getState:()=>state,restoreState:value=>{state=value;},getResult:()=>({score:state.score,maxScore:20})});function done(){window.parent.postMessage({type:'armi:activity-result',version:1,completed:true,score:state.score,maxScore:20},'*')}</script></body></html>`;
const request = async (route, body, token, headers = {}, expected = 200) => {
  const response = await fetch(`${url}/${route}`, { method: body ? 'POST' : 'GET', headers: {
    'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.equal(response.status, expected, result.message);
  if (expected === 200) assert.equal(result.success, true, result.message);
  return result.data;
};
const login = async (dni) => {
  const result = await request('student-portal/login', { dni, password: dni });
  await request('student-portal/change-password', { password: 'Practice2026!', confirmation: 'Practice2026!' }, result.token);
  return result.token;
};
try {
  const portal=fs.readFileSync('backend/public/student-portal.html','utf8');
  for(const [name,expected] of [['compactGradeText',''],['gradeCode','']]){
    const line=portal.split('\n').find(line=>line.includes(`const ${name}=`));
    const helper=new Function(`${line};return ${name};`)();
    assert.equal(helper({numericScore:null}),expected,'A missing grade must not display zero or C');
  }
  await prepareInstallerDatabase(path.resolve('database/armi.db'), dbPath);
  db = new Database(dbPath);
  db.prepare('INSERT INTO datos_generales(id,year,teacher) VALUES(1,?,?)').run('2026', 'Practice teacher');
  const insertStudent = db.prepare('INSERT INTO db_estudiantes(dni,estudiantes,grado,secc,grupo,estado,password_hash) VALUES(?,?,?,?,?,?,?)');
  const a = String(insertStudent.run('99999981', 'Student A', '5to', 'A', 'Team', 'A', '').lastInsertRowid);
  const b = String(insertStudent.run('99999982', 'Student B', '5to', 'A', 'Team', 'A', '').lastInsertRowid);
  const sessionData = { title: 'Practice test', date: '2026-01-01', competenciaPrio:{comp:'Test competency',cap:'Test capacity',des:'Test criterion'},sessionAssessmentModel: { rows: [{ id: 'c1',source:'primary',competencyName:'Test competency',capacityName:'Test capacity', criterionText: 'Test criterion' }] },
    interactiveActivities: [
      { id: 'individual', title: 'Individual', criterionId: 'c1', enabled: true, mode: 'individual', html },
      { id: 'group', title: 'Group', criterionId: 'c1', enabled: true, mode: 'group', html },
    ] };
  db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)')
    .run('practice-session', '2026', 'test-area', '5to', 'A', '1', '1', JSON.stringify(sessionData));
  child = spawn(process.execPath, ['backend/server.js'], { windowsHide: true,
    env: { ...process.env, ARMI_DATA_ROOT: root, ARMI_BACKEND_PORT: String(port), ARMI_STUDENT_PORTAL_PORT: String(port + 1), ARMI_USE_VITE_MIDDLEWARE: '0', ARMI_DISABLE_DRIVE_LAUNCH: '1', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { logs += chunk; }); child.stderr.on('data', (chunk) => { logs += chunk; });
  const deadline = Date.now() + 45000;
  while (true) {
    assert.equal(child.exitCode, null, logs);
    try { if ((await fetch(`${url}/health`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(logs);
    await wait(150);
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
  await request('interactive-images', { name: 'bot_sonriendo.svg', dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
  const library = await request('interactive-images');
  assert.equal(library.folder, path.join(root, 'uploads/user-assets/practice'));
  assert.equal(library.images[0].name, 'bot_sonriendo.svg');
  await request('interactive-images', { name: '../bad.svg', dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }, null, {}, 400);
  await request('interactive-images', { name: 'active.svg', dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64')}` }, null, {}, 400);
  assert.equal(fs.existsSync(path.join(library.folder, 'active.svg')), false);
  const bound = await request('interactive-images/bind', { html: html.replace('<main>', '<main><img data-armi-image="bot_sonriendo">') });
  assert.deepEqual(bound.embedded, ['bot_sonriendo.svg']);
  sessionData.interactiveActivities[0].html = bound.html;
  db.prepare('UPDATE sesiones SET session_data=? WHERE id_sesion=?').run(JSON.stringify(sessionData), 'practice-session');
  const tokenA = await login('99999981'), tokenB = await login('99999982');
  const base = 'student-portal/interactive-activities/practice-session/individual';
  const ready = await request(base, null, tokenA);
  assert.equal(ready.attempt.status, 'ready'); assert.equal(ready.html, undefined, 'HTML is delivered only after the server starts the clock');
  for (const [device, ua] of [
    [{}, 'Mozilla Android'], [{ mobile: true }, 'Mozilla Windows'], [{ maxTouchPoints: 5, screenShortSide: 390 }, 'Mozilla Windows'],
    [{ platform: 'Android', maxTouchPoints: 5, screenShortSide: 980 }, 'Mozilla Linux x86_64'],
    [{ maxTouchPoints: 5, screenShortSide: 1024 }, 'Mozilla Macintosh'],
  ]) await request(`${base}/attempt`, { action: 'start', device }, tokenA, { 'User-Agent': ua }, 403);
  const first = await request(`${base}/attempt`, { action: 'start', device: { mobile: false } }, tokenA);
  assert.match(first.html, /data:image\/svg\+xml;base64,/);
  assert.match(first.html, /ARMI_PRACTICE/); assert.equal(first.attempt.stage, 1);
  assert.equal(first.attempt.deadline - first.attempt.serverNow <= 300000, true);
  await request(`${base}/attempt`, { action: 'start' }, tokenA, {}, 409);
  const checkpoint = { state: { question: 3, answers: ['A', 'C'], order: [3, 1, 2] }, score: 8, maxScore: 20, answersSummary: 'Retos 1 y 2 resueltos' };
  await request(`${base}/attempt`, { action: 'progress', attemptToken: first.attempt.token, checkpoint }, tokenA);
  await request(`${base}/attempt`, { action: 'progress', attemptToken: 'wrong', checkpoint }, tokenA, {}, 409);
  db.prepare("UPDATE interactive_activity_attempts SET deadline_ms=? WHERE scope_key=? AND activity_id='individual'").run(Date.now() - 1, a);
  const paused = await request(`${base}/attempt`, { action: 'status' }, tokenA);
  assert.equal(paused.attempt.status, 'paused'); assert.deepEqual(paused.attempt.checkpoint, checkpoint);
  const continued = await request(`${base}/attempt`, { action: 'continue', device: { mobile: false } }, tokenA);
  assert.equal(continued.attempt.stage, 2); assert.deepEqual(continued.attempt.checkpoint, checkpoint);
  await request(`${base}/attempt`, { action: 'continue' }, tokenA, {}, 409);
  const finalPayload = { type: 'armi:activity-result', version: 1, completed: true, score: 17, maxScore: 20, attemptToken: continued.attempt.token };
  await request(`${base}/result`, { ...finalPayload, attemptToken: first.attempt.token }, tokenA, {}, 409);
  const graded = await request(`${base}/result`, finalPayload, tokenA);
  assert.equal(graded.score, 17); assert.equal(graded.recorded, true);
  assert.equal(graded.gradeRecorded,false);assert.equal(graded.gradedCount,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM evaluacion_registros').get().n,0,'Completing a practice must not create academic grades');
  let delivery=(await request('student-portal/sessions',null,tokenA)).find(s=>s.id==='practice-session');
  assert.equal(delivery.feedback.reviewed,false);assert.equal(delivery.feedback.numericScore,null);assert.notEqual(delivery.status,'reviewed');
  // Historical rows remain recoverable in storage, but cannot become grades.
  db.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,grading_mode,level,numeric_score,observation) VALUES(?,?,?,'literal_traditional','AD',18,?)").run(a,'practice-session','c1','[Actividad HTML:individual] Previous practice: 18/20');
  delivery=(await request('student-portal/sessions',null,tokenA)).find(s=>s.id==='practice-session');
  assert.equal(delivery.feedback.reviewed,false);assert.equal(delivery.feedback.literalGrade,'');
  const book=await request('student-portal/grades',null,tokenA);
  assert.equal(book.areas[0].bimesters[0].units[0].sessions[0].code,'ne');
  assert.equal((await request('evaluacion/registros?sessionId=practice-session')).length,0);
  assert.equal(db.prepare('SELECT numeric_score FROM evaluacion_registros WHERE student_id=? AND session_id=? AND criteria_id=?').get(a, 'practice-session', 'c1').numeric_score, 18,'The historical practice row remains unmodified for traceability');
  await request(`${base}/result`, finalPayload, tokenA, {}, 409);
  await request(`${base}/attempt`, { action: 'start' }, tokenA, {}, 409);
  assert.equal((await request(base, null, tokenA)).attempt.status, 'completed');
  const bFirst = await request(`${base}/attempt`, { action: 'start' }, tokenB);
  await request(`${base}/attempt`, { action: 'progress', attemptToken: bFirst.attempt.token, checkpoint }, tokenB);
  await request(`${base}/attempt`, { action: 'abandon', attemptToken: bFirst.attempt.token }, tokenB);
  assert.equal((await request(base, null, tokenB)).attempt.status, 'abandoned');
  assert.equal(db.prepare('SELECT score FROM interactive_activity_results WHERE scope_key=? AND activity_id=?').get(b, 'individual').score, 8);
  await request(`${base}/attempt`, { action: 'continue' }, tokenB, {}, 409);
  await request('interactive-activities/practice-session/individual/reset', { scopeType: 'individual', targetId: b });
  const bReset = await request(`${base}/attempt`, { action: 'start' }, tokenB);
  db.prepare("UPDATE interactive_activity_attempts SET deadline_ms=? WHERE scope_key=? AND activity_id='individual'").run(Date.now() - 1, b);
  const bSecond = await request(`${base}/attempt`, { action: 'continue' }, tokenB);
  await request(`${base}/attempt`, { action: 'progress', attemptToken: bSecond.attempt.token, checkpoint }, tokenB);
  db.prepare("UPDATE interactive_activity_attempts SET deadline_ms=? WHERE scope_key=? AND activity_id='individual'").run(Date.now() - 1, b);
  assert.equal((await request(`${base}/attempt`, { action: 'status' }, tokenB)).attempt.status, 'expired');
  await request(`${base}/result`, { ...finalPayload, attemptToken: bSecond.attempt.token }, tokenB, {}, 409);
  assert.equal(db.prepare('SELECT score FROM interactive_activity_results WHERE scope_key=? AND activity_id=?').get(b, 'individual').score, 8);
  const groupBase = 'student-portal/interactive-activities/practice-session/group';
  // A teacher's manual grade must survive automatic group evaluation.
  db.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,grading_mode,level,numeric_score,observation) VALUES(?,?,?,'literal_traditional','AD',19,?)").run(b,'practice-session','c1','Manual teacher grade');
  const beforeGroup=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
  const groupFirst = await request(`${groupBase}/attempt`, { action: 'start' }, tokenA);
  await request(`${groupBase}/attempt`, { action: 'start' }, tokenB, {}, 409);
  const groupResult = await request(`${groupBase}/result`, { ...finalPayload, attemptToken: groupFirst.attempt.token }, tokenA);
  assert.equal(groupResult.participantCount, 2); assert.equal(groupResult.protectedTeacherGrade, true);
  assert.equal(db.prepare('SELECT numeric_score FROM evaluacion_registros WHERE student_id=? AND session_id=? AND criteria_id=?').get(b, 'practice-session', 'c1').numeric_score, 19);
  assert.deepEqual(db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(),beforeGroup,'Group results must not write academic grades');
  await request(`${groupBase}/attempt`, { action: 'start' }, tokenB, {}, 409);
  await request('interactive-activities/practice-session/group/reset',{scopeType:'group',targetId:'Team'});
  assert.deepEqual(db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(),beforeGroup,'Resetting a practice must not delete academic grades');
  // Exercise the new workspace through the real authenticated portal, schema,
  // evidence storage and existing assessment views (not only the route factory).
  sessionData.competenciaPrio.evidence='Propuesta de valor';
  db.prepare('UPDATE sesiones SET session_data=? WHERE id_sesion=?').run(JSON.stringify(sessionData),'practice-session');
  const templateCatalog=await request('evidence-templates/practice-session/catalog');
  const templateDefinition=await request('evidence-templates/practice-session',{evidenceId:templateCatalog.evidences[0].id,html:evidenceTemplateHtml.replace(/bot_atento/g,'bot_sonriendo'),mode:'group',enabled:true,overrides:{A:{openAt:new Date(Date.now()-60000).toISOString(),closeAt:new Date(Date.now()+3600000).toISOString()}}});
  const templateA=await request(`student-portal/evidence-templates/practice-session/${templateDefinition.id}`,null,tokenA,{'User-Agent':'Mozilla/5.0 (Linux; Android 15) Mobile'});
  const templateB=await request(`student-portal/evidence-templates/practice-session/${templateDefinition.id}`,null,tokenB);assert.equal(templateA.id,templateB.id);
  const templateBase=`student-portal/evidence-documents/${templateA.id}/action`;
  for(const [token,clientId,fieldId,value] of [[tokenA,'client-aa','necesidades','Organizar tareas'],[tokenB,'client-bb','solucion','Un organizador reutilizable']]){
    await request(templateBase,{action:'lock',clientId,fieldId},token);
    await request(templateBase,{action:'save',clientId,fieldId,value,fieldRevision:0,release:true},token);
  }
  await request(templateBase,{action:'confirm',clientId:'client-aa',revision:2},tokenA);
  await request(templateBase,{action:'confirm',clientId:'client-bb',revision:2},tokenB);
  const archivedTemplates=db.prepare("SELECT * FROM evaluacion_evidencias WHERE source='evidence_template' AND is_latest=1").all();assert.equal(archivedTemplates.length,2);
  for(const file of archivedTemplates){assert.equal(fs.existsSync(file.file_path),true);assert.match(fs.readFileSync(file.file_path,'utf8'),/Organizar tareas/);assert.deepEqual(JSON.parse(file.student_ids),[file.student_id]);}
  const portalSessions=await request('student-portal/sessions',null,tokenB);const portalLesson=portalSessions.find(s=>s.id==='practice-session');assert.equal(portalLesson.studentEvidenceCount,1);assert.equal(portalLesson.evidenceTemplates[0].id,templateDefinition.id);assert.equal(portalLesson.resources.some(r=>r.kind==='evidence_template'),true);
  assert.deepEqual(db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all(),beforeGroup,'Evidence templates must never assign or change academic grades');
  for(const asset of ['evidence-workspace.html','evidence-workspace.js','student-evidence-templates.js'])assert.equal((await fetch(`http://127.0.0.1:${port}/estudiante-assets/${asset}`)).status,200);
  const gateway=`http://127.0.0.1:${port+1}`;
  assert.equal((await fetch(`${gateway}/estudiante`)).headers.get('x-frame-options'),'DENY');
  assert.equal((await fetch(`${gateway}/estudiante-assets/evidence-workspace.html`)).headers.get('x-frame-options'),'SAMEORIGIN');
  const electronEnv={...process.env,ARMI_GATEWAY_URL:gateway,ARMI_GATEWAY_TOKEN:tokenB,ARMI_GATEWAY_TEMPLATE:templateDefinition.id};delete electronEnv.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{const browser=spawn(createRequire(import.meta.url)('electron'),['scripts/test-evidence-template-gateway-electron.cjs'],{windowsHide:true,env:electronEnv,stdio:['ignore','pipe','pipe']});let output='';browser.stdout.on('data',s=>{output+=s;});browser.stderr.on('data',s=>{output+=s;});browser.once('error',reject);browser.once('exit',code=>code===0?resolve():reject(new Error(output)));});
  for (const asset of ['student-practice.js', 'student-portal-v2.js']) assert.equal((await fetch(`http://127.0.0.1:${port}/estudiante-assets/${asset}`)).status, 200);
  console.log('OK: individual/group practices store separate results, historical auto grades stay out of academic views, reset preserves grades, manual assessment survives, and attempts/deadlines remain functional.');
} finally {
  db?.close();
  if (child && child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await Promise.race([exited, wait(5000)]); if (child.exitCode === null) { child.kill('SIGKILL'); await exited; } }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
