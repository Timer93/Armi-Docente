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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  serverProcess.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const deadline = Date.now() + 30_000;
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
    competenciaPrio: { comp: 'Competencia del área', evidence: 'Producto de prueba' },
    competenciasTrans: [{ comp: 'Se desenvuelve en entornos virtuales', cap: 'Gestiona información', des: 'Criterio transversal' }],
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
  db.close();

  await startServer();
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

  const sessions = await requestJson(`${apiUrl}/student-portal/sessions`, { headers: auth });
  assert.equal(sessions.data.success, true, sessions.data.message);
  const portalSession = sessions.data.data.find((item) => item.id === session.id_sesion);
  assert.ok(portalSession, 'La sesión de hoy debe aparecer en Mis entregas.');
  assert.equal(portalSession.maxStudentEvidences, 10);
  assert.equal(portalSession.deliveryWindow.phase, 'on_time');
  assert.equal(portalSession.deliveryGroup, 'week');
  assert.deepEqual(portalSession.dates, [localDateKey(today)], 'Cada estudiante debe recibir la fecha correspondiente a su sección en una sesión combinada.');
  assert.equal(portalSession.feedback.competencyName, 'Competencia del área');
  assert.equal(portalSession.feedback.transversalCompetencies[0].literalGrade, 'AD');
  assert.equal(portalSession.feedback.transversalCompetencies[0].criteria[0].criterion, 'Criterio transversal');
  assert.equal(portalSession.feedback.transversalCompetencies[0].criteria[0].descriptor, 'Descriptor AD transversal');
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
  form.append('file', new Blob([Buffer.from('archivo del estudiante')], { type: 'application/pdf' }), 'nombre-original.pdf');
  const uploaded = await requestJson(`${apiUrl}/student-portal/evidences`, { method: 'POST', headers: auth, body: form });
  assert.equal(uploaded.data.success, true, uploaded.data.message);
  const renamed = await requestJson(`${apiUrl}/student-portal/evidences/${uploaded.data.data.id}/name`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mi producto final.docx' }),
  });
  assert.equal(renamed.data.success, true, renamed.data.message);
  assert.equal(renamed.data.data.fileName, 'Mi producto final.pdf', 'El renombrado debe conservar la extensión física real.');

  const testDb = new Database(databasePath);
  const savedProfile = testDb.prepare('SELECT gmail, outlook FROM db_estudiantes WHERE id = ?').get(studentId);
  assert.equal(savedProfile.gmail, 'estudiante.prueba@gmail.com');
  assert.equal(savedProfile.outlook, 'estudiante.prueba@outlook.com');
  const base = testDb.prepare('SELECT * FROM evaluacion_evidencias WHERE id = ?').get(uploaded.data.data.id);
  const insertCopy = testDb.prepare(`INSERT INTO evaluacion_evidencias (student_id,session_id,criteria_id,file_path,file_type,observation,year,area_id,grade,section,bimester,unit_number,session_number,student_ids,student_names,file_name,file_size,relative_path,source,version_group_id,version_number,is_latest,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)`);
  for (let index = 1; index < 10; index += 1) {
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
