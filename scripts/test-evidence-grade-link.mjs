import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const appRoot = path.resolve(import.meta.dirname, '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-evidence-grade-test-'));
const testDatabaseFolder = path.join(testRoot, 'database');
const testDatabasePath = path.join(testDatabaseFolder, 'armi.db');
const evidenceFolder = path.join(testRoot, 'evidencias');
const backendPort = 33_000 + Math.floor(Math.random() * 1_000);
const studentPort = backendPort + 1;
const backendUrl = `http://127.0.0.1:${backendPort}/api`;
let serverProcess = null;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const stopServer = async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const child = serverProcess;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, wait(5_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  serverProcess = null;
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

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`El backend de prueba termino antes de iniciar.\n${logs}`);
    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) return;
    } catch {}
    await wait(150);
  }
  throw new Error(`El backend de prueba no respondio a tiempo.\n${logs}`);
};

try {
  fs.mkdirSync(testDatabaseFolder, { recursive: true });
  fs.mkdirSync(evidenceFolder, { recursive: true });

  // SQLite creates a consistent snapshot; the real database is opened read-only
  // and is never modified by this regression test.
  const realDatabase = new Database(path.join(appRoot, 'database', 'armi.db'), { readonly: true, fileMustExist: true });
  await realDatabase.backup(testDatabasePath);
  realDatabase.close();

  const testDatabase = new Database(testDatabasePath);
  testDatabase.prepare('DELETE FROM evaluacion_evidencias').run();
  testDatabase.prepare("UPDATE datos_generales SET evidence_storage_path = ''").run();
  testDatabase.close();

  await startServer();

  const configResponse = await fetch(`${backendUrl}/evidence-storage/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: evidenceFolder }),
  });
  const config = await configResponse.json();
  assert.equal(config.success, true, config.message);
  assert.ok(Array.isArray(config.data?.portalUrls), 'La configuracion debe conservar los enlaces del portal LAN.');

  const sessionId = '2026-area-prueba-5to-A y B-U5-S1';
  const criteriaId = 'summary::primary::competencia de prueba';
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('year', '2026');
  form.append('areaId', 'area-prueba');
  form.append('grade', '5to');
  form.append('section', 'B');
  form.append('bimester', 'III');
  form.append('unitNumber', '5');
  form.append('sessionNumber', '1');
  form.append('studentIds', JSON.stringify(['9001']));
  form.append('studentNames', JSON.stringify(['Estudiante de prueba']));
  form.append('criteriaId', criteriaId);
  form.append('file', new Blob([Buffer.from('evidencia de regresion')], { type: 'application/pdf' }), 'evidencia-prueba.pdf');

  const uploadResponse = await fetch(`${backendUrl}/evaluacion/evidencias`, { method: 'POST', body: form });
  const upload = await uploadResponse.json();
  assert.equal(upload.success, true, upload.message);
  assert.equal(upload.data?.sessionId, sessionId);

  // Simulate a submission created by an older student portal version, whose
  // competency id removed spaces. The NL modal must still find it by session.
  const uploadedDatabase = new Database(testDatabasePath);
  uploadedDatabase.prepare(`
    UPDATE evaluacion_evidencias
    SET source = 'student_portal', criteria_id = ?, student_ids='["9001","9002"]'
    WHERE id = ?
  `).run('summary::primary::competenciadeprueba', upload.data.id);
  uploadedDatabase.close();

  const readReview = async () => {
    const result = await (await fetch(`${backendUrl}/evaluacion/revision-pendientes/${encodeURIComponent(sessionId)}`)).json();
    assert.equal(result.success, true, result.message);
    return result.data.find(item => item.studentId === '9001');
  };
  assert.equal((await readReview()).evidenceCount, 1);
  const transversalId = 'summary::transversal::otra competencia';
  form.set('criteriaId', transversalId);
  form.set('studentIds', '["9001"]');
  form.set('file', new Blob(['evidencia transversal'], { type: 'text/plain' }), 'transversal.txt');
  const transversal = await (await fetch(`${backendUrl}/evaluacion/evidencias`, { method: 'POST', body: form })).json();
  assert.equal(transversal.success, true, transversal.message);
  const linkDatabase = new Database(testDatabasePath);
  linkDatabase.prepare("UPDATE evaluacion_evidencias SET source='student_portal' WHERE id=?").run(transversal.data.id);
  linkDatabase.close();
  const listCompetency = async criteria => {
    const params = new URLSearchParams({ sessionId, studentId: '9001', criteriaId: criteria });
    const response = await (await fetch(`${backendUrl}/evaluacion/evidencias?${params}`)).json();
    assert.equal(response.success, true, response.message);
    return response.data.map(row => row.id);
  };
  assert.deepEqual(await listCompetency(criteriaId), [upload.data.id], 'Area NL must contain only area evidence, including compact legacy IDs');
  assert.deepEqual(await listCompetency(transversalId), [transversal.data.id], 'Transversal NL must not contain area evidence');
  assert.equal((await listCompetency('')).length, 2, 'Student counter must keep the complete list');
  const gradeDatabase = new Database(testDatabasePath);
  gradeDatabase.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,level,observation,updated_at) VALUES(?,?,?,?,?,?)")
    .run('9001', sessionId, 'summary::transversal::otra competencia', 'A', 'Actividad distinta', '2099-01-01 00:00:00');
  assert.equal((await readReview()).pending, true, 'Another competency cannot mark the uploaded evidence as reviewed');
  gradeDatabase.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,level,observation,updated_at) VALUES(?,?,?,?,?,?)")
    .run('9001', sessionId, criteriaId, 'B', 'Revisión pertinente', '2099-01-01 00:00:00');
  gradeDatabase.close();
  const reviewed = await readReview();
  assert.equal(reviewed.pending, false);
  assert.equal(reviewed.evidenceCount, 2, 'Evidence presence must remain after grading');
  const memberList = await (await fetch(`${backendUrl}/evaluacion/evidencias?sessionId=${encodeURIComponent(sessionId)}&studentId=9002`)).json();
  assert.equal(memberList.data.length, 1, 'Every group member must be able to open the files counted for their name');

  const query = new URLSearchParams({
    sessionId,
    year: '2026',
    areaId: 'area-prueba',
    grade: '5to',
    section: 'A y B',
    bimester: 'III',
    unitNumber: '5',
    sessionNumber: '1',
    studentId: '9001',
    criteriaId,
  });

  const verifyEvidence = async () => {
    let storage = await (await fetch(`${backendUrl}/evidence-storage/config`)).json();
    assert.equal(storage.success, true, storage.message);
    assert.ok(Array.isArray(storage.data?.portalUrls), 'LAN links must be available before the background inventory finishes');
    const recoveryDeadline = Date.now() + 15_000;
    while (!storage.data?.recovery && Date.now() < recoveryDeadline) {
      await new Promise(resolve => setTimeout(resolve, 150));
      storage = await (await fetch(`${backendUrl}/evidence-storage/config`)).json();
    }
    assert.equal(storage.data?.recovery?.totalRecords, 2, 'El estado de recuperacion debe calcularse sin ocultar el enlace LAN.');

    const listResponse = await fetch(`${backendUrl}/evaluacion/evidencias?${query}`);
    const list = await listResponse.json();
    assert.equal(list.success, true, list.message);
    assert.equal(list.data?.length, 1, 'La evidencia del portal debe aparecer aunque la sesion sea A y B y el criterio use un formato antiguo.');
    const fileResponse = await fetch(`http://127.0.0.1:${backendPort}${list.data[0].fileUrl}`);
    assert.equal(fileResponse.ok, true, 'El archivo asociado debe poder visualizarse.');
    assert.equal(Buffer.from(await fileResponse.arrayBuffer()).toString(), 'evidencia de regresion');
  };

  await verifyEvidence();
  await stopServer();
  await startServer();
  await verifyEvidence();

  console.log('OK: evidencia asociada a la nota, visible y persistente despues de reiniciar (base aislada).');
} finally {
  await stopServer();
  const safeTempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(testRoot);
  if (resolved.startsWith(`${safeTempRoot}${path.sep}`) && path.basename(resolved).startsWith('armi-evidence-grade-test-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
