import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const appRoot = path.resolve(import.meta.dirname, '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-student-deliveries-test-'));
const databaseFolder = path.join(testRoot, 'database');
const databasePath = path.join(databaseFolder, 'armi.db');
const evidenceFolder = path.join(testRoot, 'evidencias');
const backendPort = 34_100 + Math.floor(Math.random() * 600);
const studentPort = backendPort + 1;
const apiUrl = `http://127.0.0.1:${backendPort}/api`;
let serverProcess = null;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const localDateKey = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

const stopServer = async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
  serverProcess.kill();
  await Promise.race([exited, wait(5_000)]);
  if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL');
};

const startServer = async () => {
  serverProcess = spawn(process.execPath, ['backend/server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ARMI_DATA_ROOT: testRoot,
      ARMI_BACKEND_PORT: String(backendPort),
      ARMI_STUDENT_PORTAL_PORT: String(studentPort),
      ARMI_USE_VITE_MIDDLEWARE: '0',
      ARMI_DISABLE_DRIVE_LAUNCH: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  serverProcess.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`El backend terminó antes de iniciar.\n${logs}`);
    try {
      if ((await fetch(`${apiUrl}/health`)).ok) return;
    } catch {}
    await wait(150);
  }
  throw new Error(`El backend no respondió a tiempo.\n${logs}`);
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json();
  return { response, data };
};

try {
  const portalHtml = fs.readFileSync(path.join(appRoot, 'backend', 'public', 'student-portal.html'), 'utf8');
  assert.doesNotMatch(
    portalHtml,
    /\.map\(sessionCard\)/,
    'No se debe pasar sessionCard directamente a map: el índice se interpretaría como estado deshabilitado.',
  );
  assert.match(
    portalHtml,
    /const isDisabled=disabled===true/,
    'Solo un booleano true explícito puede deshabilitar una tarjeta de sesión.',
  );

  assert.match(
    portalHtml,
    /startSessionRefresh=.*setInterval\(.*refreshSessions.*15000/s,
    'El portal debe incorporar cambios sin recargar la pagina ni reiniciar el tunel.',
  );

  fs.mkdirSync(databaseFolder, { recursive: true });
  fs.mkdirSync(evidenceFolder, { recursive: true });
  const source = new Database(path.join(appRoot, 'database', 'armi.db'), { readonly: true, fileMustExist: true });
  await source.backup(databasePath);
  source.close();

  const db = new Database(databasePath);
  const session = db.prepare("SELECT * FROM sesiones WHERE id_sesion IS NOT NULL AND TRIM(id_sesion) <> '' LIMIT 1").get();
  assert.ok(session, 'Se necesita al menos una sesión para ejecutar la prueba.');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = String(today.getFullYear());
  const birthday = `${today.getFullYear() - 15}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const sessionData = {
    title: 'Sesión de prueba del portal',
    date: localDateKey(yesterday),
    selectedSessionDate: '',
    sessionDateOptions: [
      { value: localDateKey(yesterday), label: 'Sección A' },
      { value: localDateKey(today), label: 'Sección Z' },
    ],
    competenciaPrio: { comp: 'Competencia del área', evidence: '<p>Producto de prueba</p><p>Ficha de organización</p>' },
    competenciasTrans: [
      { comp: 'Se desenvuelve en entornos virtuales', cap: 'Gestiona información', des: 'Criterio transversal', evidence: 'Presentación digital' },
      { comp: 'Gestiona su aprendizaje de manera autónoma', evidence: 'Plan de trabajo' },
    ],
    sessionAssessmentModel: {
      rows: [
        { id: 'primary-1', source: 'primary', competencyName: 'Competencia del área', capacityName: 'Capacidad', criterionText: 'Criterio del área' },
        { id: 'transversal-1-1', source: 'transversal', competencyName: 'Se desenvuelve en entornos virtuales', capacityName: 'Gestiona información', criterionText: 'Criterio transversal' },
      ],
    },
    instrumento: [
      { id: 'transversal-1-1', source: 'transversal', criterio: 'Criterio transversal', c: 'Descriptor C', b: 'Descriptor B', a: 'Descriptor A', ad: 'Descriptor AD transversal' },
    ],
  };
  db.prepare('UPDATE datos_generales SET year = ?, teacher = ?').run(year, 'Docente de Prueba');
  db.prepare('UPDATE sesiones SET year = ?, grade = ?, section = ?, unit_number = ?, session_number = ?, session_data = ? WHERE id_sesion = ?')
    .run(year, '5TO-PRUEBA', 'A y Z', '1', '1', JSON.stringify(sessionData), session.id_sesion);
  const upcomingSessionId = `${session.id_sesion}-upcoming`;
  const upcomingSessionData = {
    ...sessionData,
    title: 'Sesion proxima visible',
    date: localDateKey(yesterday),
    sessionDateOptions: [
      { value: localDateKey(yesterday), label: 'Seccion A' },
      { value: localDateKey(tomorrow), label: 'Seccion Z' },
    ],
  };
  db.prepare(`
    INSERT INTO sesiones (id_sesion, year, area_id, grade, section, unit_number, session_number, session_data, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(upcomingSessionId, year, session.area_id, '5TO-PRUEBA', 'A y Z', '1', '2', JSON.stringify(upcomingSessionData));
  const historicDate = new Date(today);
  historicDate.setDate(historicDate.getDate() - 30);
  const historicActivitySessionId = `${session.id_sesion}-history-activity`;
  const historicSiblingSessionId = `${session.id_sesion}-history-sibling`;
  const historicExistingUnitSessionId = `${session.id_sesion}-history-existing-unit`;
  const historicSessionData = {
    ...sessionData,
    date: localDateKey(historicDate),
    sessionDateOptions: [],
  };
  const insertHistoricSession = db.prepare(`
    INSERT INTO sesiones (id_sesion, year, area_id, grade, section, unit_number, session_number, session_data, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  insertHistoricSession.run(historicActivitySessionId, year, session.area_id, '5TO-PRUEBA', 'A y Z', '7', '1', JSON.stringify({ ...historicSessionData, title: 'Sesion historica evaluada' }));
  insertHistoricSession.run(historicSiblingSessionId, year, session.area_id, '5TO-PRUEBA', 'A y Z', '7', '2', JSON.stringify({ ...historicSessionData, title: 'Sesion historica de la misma unidad' }));
  insertHistoricSession.run(historicExistingUnitSessionId, year, session.area_id, '5TO-PRUEBA', 'A y Z', '8', '1', JSON.stringify({ ...historicSessionData, title: 'Sesion de unidad existente sin actividad' }));
  const manualOpen = new Date(yesterday);
  manualOpen.setHours(0, 0, 0, 0);
  const manualClose = new Date(tomorrow);
  manualClose.setDate(manualClose.getDate() + 4);
  manualClose.setHours(23, 59, 59, 999);
  db.prepare(`
    INSERT INTO evaluacion_ventanas_entrega (session_id, enabled, open_from, close_at, exceptional, updated_at)
    VALUES (?, 1, ?, ?, 1, CURRENT_TIMESTAMP)
  `).run(upcomingSessionId, manualOpen.toISOString(), manualClose.toISOString());
  db.prepare("DELETE FROM db_estudiantes WHERE TRIM(dni) = '99999991'").run();
  const studentResult = db.prepare("INSERT INTO db_estudiantes (nivel, estudiantes, grado, secc, estado, dni, password_hash, updated_at) VALUES ('Secundaria','Estudiante Portal Prueba','5TO-PRUEBA','Z','A','99999991','',CURRENT_TIMESTAMP)").run();
  const studentId = String(studentResult.lastInsertRowid);
  db.prepare('UPDATE db_estudiantes SET fecha_nacimiento = ? WHERE id = ?').run(birthday, studentId);
  db.prepare('DELETE FROM evaluacion_evidencias WHERE student_id = ?').run(studentId);
  db.prepare('DELETE FROM evaluacion_registros WHERE student_id = ?').run(studentId);
  db.prepare('DELETE FROM evaluacion_ventanas_entrega WHERE session_id = ?').run(session.id_sesion);
  db.prepare("INSERT INTO evaluacion_registros (student_id,session_id,criteria_id,level,observation,grading_mode,numeric_score) VALUES (?,?,?,?,?,'literal_traditional',NULL)")
    .run(studentId, session.id_sesion, 'summary::primary::competencia del area', 'A', 'Buen trabajo en el área.');
  db.prepare("INSERT INTO evaluacion_registros (student_id,session_id,criteria_id,level,observation,grading_mode,numeric_score) VALUES (?,?,?,?,?,'literal_traditional',NULL)")
    .run(studentId, session.id_sesion, 'summary::transversal::se desenvuelve en entornos virtuales', 'AD', 'Excelente desempeño transversal.');
  db.prepare("INSERT INTO evaluacion_registros (student_id,session_id,criteria_id,level,observation,grading_mode,numeric_score) VALUES (?,?,?,?,?,'literal_traditional',NULL)")
    .run(studentId, session.id_sesion, 'transversal-1-1', 'AD', 'Gestiona información con autonomía.');
  db.prepare("INSERT INTO evaluacion_registros (student_id,session_id,criteria_id,level,observation,grading_mode,numeric_score) VALUES (?,?,?,?,?,'literal_traditional',NULL)")
    .run(studentId, historicActivitySessionId, 'summary::primary::competencia del area', 'A', 'Sesion historica revisada.');
  db.exec('CREATE TABLE IF NOT EXISTS armi_frontend_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)');
  db.prepare("INSERT OR REPLACE INTO armi_frontend_state (key,value,updated_at) VALUES ('armi_active_grading_mode_v1','literal_traditional',CURRENT_TIMESTAMP)").run();
  db.close();

  await startServer();
  // A rejected numeric/literal pair must roll back the entire batch.
  const integrityRow = {student_id:studentId,session_id:session.id_sesion,criteria_id:'integrity-test',level:'A',numeric_score:15};
  const invalidGrade = await requestJson(`${apiUrl}/evaluacion/registros`, {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({gradingMode:'hybrid_vigesimal',records:[integrityRow,{...integrityRow,criteria_id:'integrity-invalid',numeric_score:5}]}),
  });
  assert.equal(invalidGrade.data.success,false);
  const integrityCheck = new Database(databasePath,{readonly:true});
  assert.equal(integrityCheck.prepare("SELECT COUNT(*) AS n FROM evaluacion_registros WHERE criteria_id LIKE 'integrity-%'").get().n,0);
  integrityCheck.close();
  const validGrade = await requestJson(`${apiUrl}/evaluacion/registros`, {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({gradingMode:'hybrid_vigesimal',records:[integrityRow]}),
  });
  assert.equal(validGrade.data.success,true,validGrade.data.message);
  const clearedGrade = await requestJson(`${apiUrl}/evaluacion/registros`, {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({gradingMode:'hybrid_vigesimal',records:[{...integrityRow,level:'',numeric_score:null}]}),
  });
  assert.equal(clearedGrade.data.success,true,clearedGrade.data.message);
  const config = await requestJson(`${apiUrl}/evidence-storage/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: evidenceFolder }),
  });
  assert.equal(config.data.success, true, config.data.message);

  const login = await requestJson(`${apiUrl}/student-portal/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dni: '99999991', password: '99999991' }),
  });
  assert.equal(login.data.success, true, login.data.message);
  const token = login.data.data.token;
  const auth = { Authorization: `Bearer ${token}` };
  const password = await requestJson(`${apiUrl}/student-portal/change-password`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'Portal2026', confirmation: 'Portal2026' }),
  });
  assert.equal(password.data.success, true, password.data.message);

  const profileForm = new FormData();
  profileForm.append('email', 'estudiante.prueba@gmail.com');
  profileForm.append('microsoft', 'estudiante.prueba@outlook.com');
  profileForm.append('notificationsEnabled', '1');
  const profile = await requestJson(`${apiUrl}/student-portal/profile`, { method: 'PUT', headers: auth, body: profileForm });
  assert.equal(profile.data.success, true, profile.data.message);
  assert.equal(profile.data.data.email, 'estudiante.prueba@gmail.com');
  assert.equal(profile.data.data.microsoft, 'estudiante.prueba@outlook.com');
  assert.equal(profile.data.data.age, 15);
  assert.equal(profile.data.data.birthday.isToday, true);
  assert.equal(profile.data.data.birthday.teacherName, 'Docente de Prueba');
  const lockedProfileForm = new FormData();
  lockedProfileForm.append('email', profile.data.data.email);
  lockedProfileForm.append('microsoft', profile.data.data.microsoft);
  lockedProfileForm.append('notificationsEnabled', '');
  lockedProfileForm.append('birthDate', '2000-01-01');
  lockedProfileForm.append('fecha_nacimiento', '2000-01-01');
  const lockedProfile = await requestJson(`${apiUrl}/student-portal/profile`, { method: 'PUT', headers: auth, body: lockedProfileForm });
  assert.equal(lockedProfile.data.success, true);
  assert.equal(lockedProfile.data.data.notificationsEnabled, true, 'Students cannot disable birthday notifications');
  assert.equal(lockedProfile.data.data.birthDate, profile.data.data.birthDate, 'Birth dates remain under teacher control');

  const sessions = await requestJson(`${apiUrl}/student-portal/sessions`, { headers: auth });
  assert.equal(sessions.data.success, true, sessions.data.message);
  const portalSession = sessions.data.data.find((item) => item.id === session.id_sesion);
  assert.ok(portalSession, 'La sesión de hoy debe aparecer en Mis entregas.');
  const upcomingSession = sessions.data.data.find((item) => item.id === upcomingSessionId);
  assert.ok(upcomingSession, 'Una sesión habilitada antes de la fecha de clase debe aparecer para el estudiante.');
  assert.equal(upcomingSession.available, true, 'La apertura manual debe tener prioridad sobre la fecha de clase de la sección.');
  assert.equal(upcomingSession.deliveryWindow.openAt, manualOpen.toISOString());
  const historicActivitySession = sessions.data.data.find((item) => item.id === historicActivitySessionId);
  const historicSiblingSession = sessions.data.data.find((item) => item.id === historicSiblingSessionId);
  assert.ok(historicActivitySession, 'Una sesion historica evaluada debe permanecer visible.');
  assert.ok(historicSiblingSession, 'Al existir actividad del estudiante, debe mostrarse la unidad historica completa.');
  assert.equal(historicSiblingSession.deliveryGroup, 'closed', 'Una sesion historica sin entrega debe conservarse como cerrada.');
  assert.ok(sessions.data.data.some((item) => item.id === historicExistingUnitSessionId), 'El selector debe poder incluir una unidad existente aunque el estudiante todavia no tenga actividad en ella.');
  // On Sunday, tomorrow's enabled lesson belongs to the following week.
  assert.equal(upcomingSession.deliveryGroup, today.getDay() === 0 ? 'unit' : 'week', 'La sesión habilitada debe agruparse según la semana de su fecha de clase.');
  assert.equal(portalSession.maxStudentEvidences, 10);
  assert.equal(portalSession.requestedEvidences.length, 4);
  assert.deepEqual(portalSession.requestedEvidences.map(item => item.source), ['primary', 'primary', 'transversal', 'transversal']);
  assert.equal(portalSession.requestedEvidences[2].color, '#007c59');
  assert.equal(portalSession.requestedEvidences[3].color, '#00b28c');
  assert.equal(portalSession.deliveryWindow.phase, 'on_time');
  assert.equal(portalSession.deliveryGroup, 'week');
  assert.deepEqual(portalSession.dates, [localDateKey(today)], 'Cada estudiante debe recibir la fecha correspondiente a su sección en una sesión combinada.');
  assert.equal(portalSession.feedback.competencyName, 'Competencia del área');
  assert.equal(portalSession.feedback.transversalCompetencies[0].literalGrade, 'AD');
  assert.equal(portalSession.feedback.transversalCompetencies[0].criteria[0].criterion, 'Criterio transversal');
  assert.equal(portalSession.feedback.transversalCompetencies[0].criteria[0].descriptor, 'Descriptor AD transversal');
  const unauthenticatedGrades = await requestJson(`${apiUrl}/student-portal/grades`);
  assert.equal(unauthenticatedGrades.response.status, 401, 'Grades require student authentication');
  const grades = await requestJson(`${apiUrl}/student-portal/grades?studentId=another-student`, { headers: auth });
  assert.equal(grades.data.success, true, grades.data.message);
  assert.equal(grades.response.headers.get('cache-control'), 'no-store');
  const gradeArea = grades.data.data.areas.find(item => item.id === String(session.area_id));
  assert.ok(gradeArea);
  assert.equal(gradeArea.bimesters.length, 4);
  assert.deepEqual(gradeArea.bimesters.map(item => item.unitNumbers), [[1,2],[3,4],[5,6],[7,8]]);
  const ownSessionGrade = gradeArea.bimesters.flatMap(item => item.units).flatMap(item => item.sessions).find(item => item.id === session.id_sesion);
  assert.equal(ownSessionGrade.code, 'a', 'Use the authenticated student summary, ignoring the requested student ID');
  assert.equal(ownSessionGrade.competencies.find(item => item.source === 'transversal').code, 'ad');
  assert.ok(!JSON.stringify(grades.data.data).includes('Estudiante Portal Prueba'), 'Do not return a roster or student profiles');
  const modeDb = new Database(databasePath);
  modeDb.prepare('DELETE FROM evaluacion_modos_calificacion WHERE area_id=?').run(session.area_id);
  modeDb.prepare("UPDATE armi_frontend_state SET value='hybrid_vigesimal' WHERE key='armi_active_grading_mode_v1'").run();
  modeDb.prepare("INSERT INTO evaluacion_modos_calificacion(year,area_id,grade,section,grading_mode) VALUES(?,?,?,'A y Z','criterial_predominance')")
    .run(year,session.area_id,'5TO-PRUEBA');
  modeDb.prepare("INSERT INTO evaluacion_registros (student_id,session_id,criteria_id,level,grading_mode,numeric_score) VALUES (?,?,?,'B','hybrid_vigesimal',13)").run(studentId,session.id_sesion,'primary-1');
  const migrated=structuredClone(sessionData);
  migrated.numericAverageRounding='nearest_integer';
  const currentTrans={id:'transversal-2-1',source:'transversal',competencyName:'Gestiona su aprendizaje de manera autónoma',capacityName:'Define metas.',criterionText:'Establece metas precisas'};
  migrated.sessionAssessmentModel.rows=[sessionData.sessionAssessmentModel.rows[0],currentTrans];
  migrated.instrumento=[
    {id:'transversal-2-1',source:'transversal',competencia:'TIC',capacidad:'Define metas.',criterio:'Establece metas precisas'},
    {id:'transversal-2-2',source:'transversal',competencia:currentTrans.competencyName,capacidad:'Define metas.',criterio:'Establece metas precisas'}
  ];
  modeDb.prepare('UPDATE sesiones SET session_data=? WHERE id_sesion=?').run(JSON.stringify(migrated),session.id_sesion);
  modeDb.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,level,grading_mode,numeric_score) VALUES(?,?,?,'B','hybrid_vigesimal',?)").run(studentId,session.id_sesion,'transversal-2-1',5);
  modeDb.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,level,grading_mode,numeric_score) VALUES(?,?,?,'B','hybrid_vigesimal',?)").run(studentId,session.id_sesion,'transversal-2-2',11);
  const numericGrades = await requestJson(`${apiUrl}/student-portal/grades`, {headers:auth});
  assert.equal(numericGrades.data.success,true,numericGrades.data.message);
  const numericArea=numericGrades.data.data.areas.find(item=>item.id===String(session.area_id));
  assert.equal(numericArea.gradingMode,'hybrid_vigesimal');
  const numericSession=numericArea.bimesters.flatMap(item=>item.units).flatMap(item=>item.sessions).find(item=>item.id===session.id_sesion);
  assert.equal(numericSession.code,'b');
  assert.equal(numericSession.numericScore,13,'Read the current numeric grade instead of the old literal summary');
  assert.equal(numericSession.competencies.find(item=>item.name===currentTrans.competencyName).numericScore,11,'Portal must use the current criterion and not the obsolete 5');
  modeDb.prepare("UPDATE evaluacion_registros SET numeric_score=13.5 WHERE student_id=? AND session_id=? AND criteria_id='primary-1' AND grading_mode='hybrid_vigesimal'").run(studentId,session.id_sesion);
  const roundedBook=await requestJson(`${apiUrl}/student-portal/grades`,{headers:auth});
  const roundedSession=roundedBook.data.data.areas.flatMap(item=>item.bimesters).flatMap(item=>item.units).flatMap(item=>item.sessions).find(item=>item.id===session.id_sesion);
  assert.equal(roundedSession.numericScore,13.5);assert.equal(roundedSession.code,'a');
  const roundedDeliveries=await requestJson(`${apiUrl}/student-portal/sessions`,{headers:auth});
  const roundedFeedback=roundedDeliveries.data.data.find(item=>item.id===session.id_sesion).feedback;
  assert.equal(roundedFeedback.numericScore,13.5);assert.equal(roundedFeedback.literalGrade,'A','Delivery feedback and gradebook must preserve the number and use rounding only for its letter');
  modeDb.prepare('UPDATE sesiones SET session_data=? WHERE id_sesion=?').run(JSON.stringify(sessionData),session.id_sesion);
  modeDb.prepare("UPDATE armi_frontend_state SET value='literal_traditional' WHERE key='armi_active_grading_mode_v1'").run();
  modeDb.close();
  const onTime = new Date(portalSession.deliveryWindow.onTimeCloseAt);
  const closed = new Date(portalSession.deliveryWindow.defaultCloseAt);
  assert.equal(Math.round((closed - onTime) / 86_400_000), 3, 'La recepción tardía debe durar tres días adicionales.');
  const extendedClose = new Date(closed);
  extendedClose.setDate(extendedClose.getDate() + 2);
  const extension = await requestJson(`${apiUrl}/evaluacion/ventana-entrega/${encodeURIComponent(session.id_sesion)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, exceptional: true, closeAt: extendedClose.toISOString() }),
  });
  assert.equal(extension.data.success, true, extension.data.message);
  const configuredWindow = await requestJson(`${apiUrl}/evaluacion/ventana-entrega/${encodeURIComponent(session.id_sesion)}`);
  assert.equal(configuredWindow.data.success, true, configuredWindow.data.message);
  assert.ok(new Date(configuredWindow.data.data.closeAt) > closed, 'El docente debe poder ampliar el cierre tardío.');

  const form = new FormData();
  form.append('sessionId', session.id_sesion);
  form.append('observation', 'Descripcion individual de la evidencia.');
  form.append('evidenceLink', 'https://example.edu/producto');
  form.append('file', new Blob([Buffer.from('archivo del estudiante')], { type: 'application/pdf' }), 'nombre-original.pdf');
  const uploaded = await requestJson(`${apiUrl}/student-portal/evidences`, { method: 'POST', headers: auth, body: form });
  assert.equal(uploaded.data.success, true, uploaded.data.message);
  const renamed = await requestJson(`${apiUrl}/student-portal/evidences/${uploaded.data.data.id}/name`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mi producto final.docx' }),
  });
  assert.equal(renamed.data.success, true, renamed.data.message);
  assert.equal(renamed.data.data.fileName, 'Mi producto final.pdf', 'El renombrado debe conservar la extensión física real.');

  assert.equal(renamed.data.data.observation, 'Descripcion individual de la evidencia.');
  assert.equal(renamed.data.data.evidenceLink, 'https://example.edu/producto');
  const teacherFeedback = await requestJson(`${apiUrl}/evaluacion/evidencias/${uploaded.data.data.id}/feedback`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teacherComment: 'Buen sustento; revisa la conclusion.' }),
  });
  assert.equal(teacherFeedback.data.success, true, teacherFeedback.data.message);
  assert.equal(teacherFeedback.data.data.teacherComment, 'Buen sustento; revisa la conclusion.');
  const listedEvidence = await requestJson(`${apiUrl}/student-portal/evidences?sessionId=${encodeURIComponent(session.id_sesion)}`, { headers: auth });
  assert.equal(listedEvidence.data.data[0].teacherComment, 'Buen sustento; revisa la conclusion.');
  const teacherEvidence = await requestJson(`${apiUrl}/evaluacion/evidencias?sessionId=${encodeURIComponent(session.id_sesion)}&studentId=${encodeURIComponent(studentId)}`);
  assert.equal(teacherEvidence.data.success, true, teacherEvidence.data.message);
  const teacherEvidenceItem = teacherEvidence.data.data.find((item) => String(item.id) === String(uploaded.data.data.id));
  assert.equal(teacherEvidenceItem?.deliveryTiming, 'on_time', 'La vista docente debe identificar la entrega realizada a tiempo.');
  assert.equal(Number(teacherEvidenceItem?.lateByMs || 0), 0);
  assert.ok(teacherEvidenceItem?.onTimeCloseAt, 'La vista docente debe recibir el plazo usado para calcular la puntualidad.');

  const inlinePdf = await fetch(`${apiUrl}/evaluacion/evidencias/${uploaded.data.data.id}/file`, {headers:auth});
  assert.match(inlinePdf.headers.get('content-disposition'), /^inline;/);
  await inlinePdf.arrayBuffer();
  const downloadPdf = await fetch(`${apiUrl}/evaluacion/evidencias/${uploaded.data.data.id}/file?download=1`, {headers:auth});
  assert.equal(downloadPdf.status,200);
  assert.match(downloadPdf.headers.get('content-disposition'), /^attachment;/, 'Download must work even for files normally shown inline');
  await downloadPdf.arrayBuffer();
  const htmlForm = new FormData();
  const diagramHtml='<!doctype html><html><body><div class="mxgraph">Diagrama de prueba</div><script src="https://app.diagrams.net/js/viewer-static.min.js"></script></body></html>';
  htmlForm.append('sessionId',session.id_sesion);
  htmlForm.append('file',new Blob([diagramHtml],{type:'text/html'}),'diagrama.drawio.html');
  const htmlUpload=await requestJson(`${apiUrl}/student-portal/evidences`,{method:'POST',headers:auth,body:htmlForm});
  assert.equal(htmlUpload.data.success,true,htmlUpload.data.message);
  const htmlId=htmlUpload.data.data.id;
  const htmlPreview=await fetch(`${apiUrl}/evaluacion/evidencias/${htmlId}/preview`,{headers:auth});
  assert.equal(htmlPreview.status,200);
  assert.match(htmlPreview.headers.get('content-type'),/text\/html/);
  assert.match(htmlPreview.headers.get('content-disposition'),/^inline;/);
  const policy=htmlPreview.headers.get('content-security-policy');
  assert.match(policy,/sandbox allow-scripts;/);
  assert.match(policy,/https:\/\/app\.diagrams\.net\/js\/viewer-static\.min\.js/);
  assert.match(policy,/connect-src 'none'/);
  assert.ok(!policy.includes('allow-same-origin'));
  assert.equal(await htmlPreview.text(),diagramHtml,'Preview must preserve the submitted diagram');
  const htmlDownload=await fetch(`${apiUrl}/evaluacion/evidencias/${htmlId}/file?download=1`,{headers:auth});
  assert.match(htmlDownload.headers.get('content-disposition'),/^attachment;/);
  assert.equal(await htmlDownload.text(),diagramHtml,'Download must preserve the original HTML');

  // Several attachments for one product, another for a transversal product,
  // and replacement versions must preserve their server-validated association.
  const [primaryRequested, , transversalRequested] = portalSession.requestedEvidences;
  const invalidCategory = await requestJson(`${apiUrl}/student-portal/uploads/init`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id_sesion, requestedEvidenceId: 'forged', fileName: 'bad.pdf', totalSize: 4 }),
  });
  assert.equal(invalidCategory.response.status, 400);
  const sendCategorized = async (requested, replaceEvidenceId = 0) => {
    const contents = Buffer.from('archivo categorizado');
    const initialized = await requestJson(`${apiUrl}/student-portal/uploads/init`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id_sesion, requestedEvidenceId: requested.id, replaceEvidenceId, fileName: 'adjunto.txt', fileType: 'text/plain', totalSize: contents.length }),
    });
    assert.equal(initialized.data.success, true, initialized.data.message);
    const uploadId = initialized.data.data.uploadId;
    const chunk = await requestJson(`${apiUrl}/student-portal/uploads/${uploadId}/chunks/0`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: contents });
    assert.equal(chunk.data.success, true, chunk.data.message);
    const completed = await requestJson(`${apiUrl}/student-portal/uploads/${uploadId}/complete`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(completed.data.success, true, completed.data.message);
    assert.equal(completed.data.data.requestedEvidence.id, requested.id);
    assert.equal(completed.data.data.criteriaId, requested.criteriaId);
    return completed.data.data;
  };
  const firstProductFile = await sendCategorized(primaryRequested);
  await sendCategorized(primaryRequested);
  const transversalFile = await sendCategorized(transversalRequested);
  const replacement = await sendCategorized(transversalRequested, transversalFile.id);
  assert.equal(replacement.versionNumber, 2);
  assert.equal(replacement.versionGroupId, transversalFile.versionGroupId);
  const mismatch = await requestJson(`${apiUrl}/student-portal/uploads/init`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id_sesion, requestedEvidenceId: primaryRequested.id, replaceEvidenceId: replacement.id, fileName: 'wrong.txt', totalSize: 4 }),
  });
  assert.equal(mismatch.response.status, 400);
  const categorizedTeacher = await requestJson(`${apiUrl}/evaluacion/evidencias?sessionId=${encodeURIComponent(session.id_sesion)}&studentId=${studentId}`);
  assert.equal(categorizedTeacher.data.data.find(item => item.id === firstProductFile.id).requestedEvidence.text, primaryRequested.text);
  const testDb = new Database(databasePath);
  assert.equal(JSON.parse(testDb.prepare('SELECT requested_evidence FROM evaluacion_evidencias WHERE id=?').get(replacement.id).requested_evidence).source, 'transversal');
  assert.equal(testDb.prepare('SELECT is_latest FROM evaluacion_evidencias WHERE id=?').get(transversalFile.id).is_latest, 0);
  const savedProfile = testDb.prepare('SELECT gmail, outlook FROM db_estudiantes WHERE id = ?').get(studentId);
  assert.equal(savedProfile.gmail, 'estudiante.prueba@gmail.com');
  assert.equal(savedProfile.outlook, 'estudiante.prueba@outlook.com');
  const base = testDb.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(uploaded.data.data.id);
  const lateSubmittedAt = new Date(new Date(teacherEvidenceItem.onTimeCloseAt).getTime() + (3 * 60 + 12) * 60_000);
  testDb.prepare('UPDATE evaluacion_evidencias SET submitted_at = ? WHERE id = ?')
    .run(lateSubmittedAt.toISOString().replace('T', ' ').replace('Z', ''), uploaded.data.data.id);
  const lateTeacherEvidence = await requestJson(`${apiUrl}/evaluacion/evidencias?sessionId=${encodeURIComponent(session.id_sesion)}&studentId=${encodeURIComponent(studentId)}`);
  const lateTeacherEvidenceItem = lateTeacherEvidence.data.data.find((item) => String(item.id) === String(uploaded.data.data.id));
  assert.equal(lateTeacherEvidenceItem?.deliveryTiming, 'late', 'La vista docente debe identificar la entrega tardia.');
  assert.equal(Number(lateTeacherEvidenceItem?.lateByMs), (3 * 60 + 12) * 60_000, 'El retraso debe conservar horas y minutos.');
  const insertCopy = testDb.prepare(`INSERT INTO evaluacion_evidencias (student_id,session_id,criteria_id,file_path,file_type,observation,year,area_id,grade,section,bimester,unit_number,session_number,student_ids,student_names,file_name,file_size,relative_path,source,version_group_id,version_number,is_latest,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)`);
  const used = Number(testDb.prepare("SELECT COUNT(*) AS total FROM evaluacion_evidencias WHERE student_id=? AND session_id=? AND source='student_portal' AND is_latest=1").get(String(studentId), session.id_sesion).total);
  for (let index = used; index < 10; index += 1) {
    insertCopy.run(base.student_id, base.session_id, base.criteria_id, base.file_path, base.file_type, base.observation, base.year, base.area_id, base.grade, base.section, base.bimester, base.unit_number, base.session_number, base.student_ids, base.student_names, `copia-${index}.pdf`, base.file_size, base.relative_path, 'student_portal', `test-group-${index}`, 1);
  }
  testDb.close();
  const eleventh = await requestJson(`${apiUrl}/student-portal/uploads/init`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id_sesion, fileName: 'once.pdf', fileType: 'application/pdf', totalSize: 4 }),
  });
  assert.equal(eleventh.response.status, 409);
  assert.match(eleventh.data.message, /máximo de 10/i);

  console.log('OK: portal estudiantil validado con perfil enlazado, cumpleaños, plazo automático, nota transversal, renombrado y límite de 10.');
} finally {
  await stopServer();
  const resolved = path.resolve(testRoot);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${temporaryRoot}${path.sep}`) && path.basename(resolved).startsWith('armi-student-deliveries-test-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
