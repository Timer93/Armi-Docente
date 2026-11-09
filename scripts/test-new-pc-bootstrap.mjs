import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-new-pc-'));
const mirror = path.join(root, 'mirror');
const source = path.join(root, 'source');
const fresh = path.join(root, 'fresh');
const bundled = path.join(root, 'bundle');
const pristine = path.join(root, 'pristine');
const port = 39000 + process.pid % 500;
fs.mkdirSync(mirror);
const processes = new Set();
const databases = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const start = async (dataRoot, suffix, mode = 'drive_mirror') => {
  fs.mkdirSync(path.join(dataRoot, 'sync-runtime'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'sync-runtime', 'sync-config.json'), JSON.stringify({ mode, mirrorPath: mirror, syncUserKey: 'bootstrap-test', syncUserLabel: 'Bootstrap Test' }));
  const child = spawn(process.execPath, ['--input-type=module', '-e', "process.resourcesPath = process.argv[1]; await import('./backend/server.js');", bundled], {
    env: { ...process.env, ARMI_DATA_ROOT: dataRoot, ARMI_BACKEND_PORT: String(port), ARMI_STUDENT_PORTAL_PORT: String(port + 1),
      ARMI_SYNC_DEVICE_ID: suffix, ARMI_DISABLE_DRIVE_LAUNCH: '1', ARMI_USE_VITE_MIDDLEWARE: '0', NODE_ENV: 'production' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.add(child);
  let logs = '';
  child.stdout.on('data', (data) => { logs += data; }); child.stderr.on('data', (data) => { logs += data; });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child; } catch {}
    await wait(200);
  }
  throw new Error('Test backend did not start: ' + logs);
};
const stop = async (child) => {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill();
  await Promise.race([exited, wait(5000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  processes.delete(child);
};
const post = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(result.success, true, result.message); return result.data;
};
const sessionId = '2026-bootstrap-area-5to-A-U1-S1';
const imageUrl = '/uploads/session-resources/bootstrap-resource.webp';
const wordUrl = '/uploads/session-resources/bootstrap-resource.word.jpg';
const state = { armi_assignments: '[{"areaId":"bootstrap-area","areaName":"Test Area","grade":"5to","section":"A"}]',
  armi_schedule_entries: '[{"day":"Monday","course":"Test Area"}]', armi_schedule_config: '{"periods":8}', armi_calendar_state: '{"year":2026}',
  armi_areas: '[{"id":"bootstrap-area","name":"Test Area"}]', armi_holidays_v7: '[{"date":"2026-07-28","name":"Custom holiday"}]' };
try {
  await prepareInstallerDatabase(path.resolve('database/armi.db'), path.join(bundled, 'database/armi.db'));
  const pristineChild = await start(pristine, 'pristine-pc', 'local');
  const empty = await post('sync/bootstrap', { state: {} });
  assert.deepEqual(empty.frontendState.keys, {});
  const pristineDb = new Database(path.join(pristine, 'database/armi.db'), { readonly: true });
  databases.push(pristineDb);
  assert.equal(pristineDb.prepare('SELECT teacher FROM datos_generales LIMIT 1').get().teacher, null);
  for (const table of ['db_estudiantes', 'sesiones', 'programacion_anual', 'unidades_didacticas']) {
    assert.equal(pristineDb.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `New installation: ${table}`);
  }
  pristineDb.close();
  await stop(pristineChild);
  console.log('Pristine installation: no user settings, students or academic documents.');
  // Drive can present an empty local folder before downloading the other PC's
  // events. The new PC must publish neither seed defaults nor deletions, and
  // must still accept those events after its first sync has already completed.
  const waitingChild = await start(fresh, 'zz-new-pc');
  const waiting = await post('sync/bootstrap', { state: { armi_schedule_entries: '[]', armi_calendar_state: '{}' } });
  assert.deepEqual(waiting.frontendState.keys, {});
  await stop(waitingChild);
  const waitingDevices = path.join(mirror, '.armi-sync/incremental-v1/devices');
  const [waitingDevice] = fs.readdirSync(waitingDevices);
  assert.ok(waitingDevice, 'Initial mirror pass completed');
  const waitingEvents = path.join(waitingDevices, waitingDevice, 'events');
  for (const file of fs.readdirSync(waitingEvents).filter((name) => name.endsWith('.json'))) {
    const batch = JSON.parse(fs.readFileSync(path.join(waitingEvents, file), 'utf8'));
    assert.equal(batch.operations.some((op) => ['datos_generales', 'estado_modulos', 'armi_frontend_state'].includes(op.table)), false, 'No initial empty/default settings published');
    assert.equal(batch.operations.some((op) => op.action === 'delete'), false, 'A fresh PC must not delete remote data');
  }
  console.log('Drive delay: empty mirror publishes no initial settings or deletions.');
  await prepareInstallerDatabase(path.resolve('database/armi.db'), path.join(source, 'database/armi.db'));
  const db = new Database(path.join(source, 'database/armi.db'));
  databases.push(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM datos_generales').get().n, 0, 'Installer seed has no user settings');
  assert.equal(db.prepare('SELECT count(*) AS n FROM db_estudiantes').get().n, 0, 'Installer seed has no students');
  db.prepare('INSERT INTO datos_generales(id,year,teacher) VALUES(1,?,?)').run('2026', 'Bootstrap teacher');
  db.prepare('INSERT INTO db_estudiantes(dni,estudiantes,grado,secc) VALUES(?,?,?,?)').run('12345678', 'Bootstrap student', '5to', 'A');
  db.prepare('INSERT INTO sesiones(id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES(?,?,?,?,?,?,?,?)')
    .run(sessionId, '2026', 'bootstrap-area', '5to', 'A', '1', '1', JSON.stringify({ title: 'Bootstrap session', learningResources: { annex1: { notes: 'Keep existing resource' } } }));
  db.close();
  const resourceFolder = path.join(source, 'uploads/session-resources'); fs.mkdirSync(resourceFolder, { recursive: true });
  const pixels = { create: { width: 24, height: 24, channels: 3, background: '#336699' } };
  await sharp(pixels).webp().toFile(path.join(source, imageUrl.slice(1)));
  await sharp(pixels).jpeg().toFile(path.join(source, wordUrl.slice(1)));

  let child = await start(source, 'origin-pc');
  const resourcePayload = { year: '2026', areaId: 'bootstrap-area', grade: '5to', section: 'A', unitNumber: '1', sessionNumber: '1',
    key: 'instructive', resource: { imageUrl, wordImageUrl: wordUrl }, sessionData: { title: 'Unsaved editor title' } };
  await post('sesiones/recurso', resourcePayload);
  await post('sesiones/recurso', { ...resourcePayload, sessionNumber: '2', sessionData: { title: 'New lesson resource' } });
  console.log('Source: saved resource links without pressing Save lesson.');
  await post('sync/frontend-state', { state, changedKeys: Object.keys(state) });
  await post('sync/bootstrap', { state });
  // Startup no longer waits for binary resources. Keep the source alive until
  // its background publisher completes before simulating a second PC.
  const resourceDeadline = Date.now() + 20_000;
  while (![imageUrl, wordUrl].every(url => fs.existsSync(path.join(mirror, '.armi-sync/current', url.slice(1)))) && Date.now() < resourceDeadline) await wait(100);
  await stop(child);
  const eventsRoot = path.join(mirror, '.armi-sync/incremental-v1/devices');
  const operations = fs.readdirSync(eventsRoot).flatMap((device) => {
    const folder = path.join(eventsRoot, device, 'events');
    return fs.readdirSync(folder).filter((file) => file.endsWith('.json'))
      .flatMap((file) => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')).operations);
  });
  for (const key of Object.keys(state)) {
    assert.ok(operations.some((op) => op.table === 'armi_frontend_state' && op.row?.key === key && op.row.value === state[key]), `Mirror contains ${key}`);
  }
  for (const table of ['datos_generales', 'db_estudiantes']) assert.ok(operations.some((op) => op.table === table), `Mirror contains ${table}`);
  for (const url of [imageUrl, wordUrl]) assert.ok(fs.existsSync(path.join(mirror, '.armi-sync/current', url.slice(1))));

  // No database, no browser state and no uploads on the destination PC.
  child = await start(fresh, 'zz-new-pc');
  const restored = await post('sync/bootstrap', { state: { armi_schedule_entries: '[]' } });
  for (const [key, value] of Object.entries(state)) assert.equal(restored.frontendState.keys[key], value, key);
  const freshDb = new Database(path.join(fresh, 'database/armi.db'), { readonly: true });
  databases.push(freshDb);
  assert.equal(freshDb.prepare('SELECT teacher FROM datos_generales LIMIT 1').get().teacher, 'Bootstrap teacher');
  assert.equal(freshDb.prepare('SELECT estudiantes FROM db_estudiantes WHERE dni=?').get('12345678').estudiantes, 'Bootstrap student');
  assert.ok(freshDb.prepare('SELECT id_sesion FROM sesiones WHERE id_sesion=?').get(sessionId));
  freshDb.close();
  const session = await (await fetch(`http://127.0.0.1:${port}/api/sesiones?year=2026&areaId=bootstrap-area&grade=5to&section=A&unitNumber=1&sessionNumber=1`)).json();
  assert.equal(session.data.learningResources.instructive.imageUrl, imageUrl);
  assert.equal(session.data.title, 'Bootstrap session', 'Resource save preserves the saved lesson');
  assert.equal(session.data.learningResources.annex1.notes, 'Keep existing resource');
  const newLesson = await (await fetch(`http://127.0.0.1:${port}/api/sesiones?year=2026&areaId=bootstrap-area&grade=5to&section=A&unitNumber=1&sessionNumber=2`)).json();
  assert.equal(newLesson.data.learningResources.instructive.wordImageUrl, wordUrl);
  assert.equal(newLesson.data.title, 'New lesson resource');
  console.log('Destination: recovered academic data and links for existing and new lessons.');
  for (const url of [imageUrl, wordUrl]) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`);
    assert.equal(response.status, 200, url);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(source, url.slice(1))));
  }
  const edited = { ...state, armi_schedule_entries: '[{"day":"Tuesday","course":"Updated from PC2"}]' };
  await post('sync/frontend-state', { state: edited, changedKeys: ['armi_schedule_entries'] });
  await post('sync/bootstrap', { state: edited });
  await stop(child);
  child = await start(source, 'origin-pc');
  const returned = await post('sync/bootstrap', { state });
  assert.equal(returned.frontendState.keys.armi_schedule_entries, edited.armi_schedule_entries, 'Old browser state must not overwrite the remote edit');
  await stop(child);
  console.log('OK: new PC restored general data, timetable, assignments, calendar, session and both image formats; return sync preserved the edit from PC2.');
} finally {
  databases.forEach((db) => { if (db.open) db.close(); });
  for (const child of processes) await stop(child);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
}
