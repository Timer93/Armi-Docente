import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-live-mirror-'));
const mirror = path.join(root, 'mirror');
const dbPath = path.join(root, 'database', 'armi.db');
const runtime = path.join(root, 'sync-runtime');
fs.mkdirSync(mirror, { recursive: true });
fs.mkdirSync(runtime, { recursive: true });
await prepareInstallerDatabase(path.resolve('database/armi.db'), dbPath);
fs.writeFileSync(path.join(runtime, 'sync-config.json'), JSON.stringify({ mode: 'drive_mirror', mirrorPath: mirror, syncUserKey: 'test-live', syncUserLabel: 'Test Live' }));
fs.writeFileSync(path.join(mirror, '.armi-sync-root.json'), JSON.stringify({ format: 1, syncUserKey: 'test-live' }));
const port = 38000 + process.pid % 1000;
const server = spawn(process.execPath, ['backend/server.js'], {
  env: { ...process.env, ARMI_DATA_ROOT: root, ARMI_BACKEND_PORT: String(port), ARMI_STUDENT_PORTAL_PORT: String(port + 1), ARMI_DISABLE_DRIVE_LAUNCH: '1', ARMI_USE_VITE_MIDDLEWARE: '0', NODE_ENV: 'production' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (data) => { logs += data; });
server.stderr.on('data', (data) => { logs += data; });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, message, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(logs);
    if (await predicate()) return;
    await wait(100);
  }
  throw new Error(message);
};
const api = (route, options) => fetch(`http://127.0.0.1:${port}/api/${route}`, options);
let db;
try {
  await until(async () => { try { return (await api('health')).ok; } catch { return false; } }, 'Server failed to start', 45000);
  const home = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(home.headers.get('cache-control'), /no-store/);
  const html = await home.text();
  const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)];
  assert.ok(scripts.length, 'Production HTML must load the application script');
  for (const [, url] of scripts) {
    const asset = await fetch(`http://127.0.0.1:${port}${url}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
    await asset.arrayBuffer();
  }
  const missing = await fetch(`http://127.0.0.1:${port}/assets/missing-module.js`);
  assert.equal(missing.status, 404, 'Missing modules must never return the application HTML with status 200');
  db = new Database(dbPath);
  db.exec('CREATE TABLE armi_test_notes (id TEXT PRIMARY KEY, value TEXT)');
  await api('sync/status');
  const firstFile = path.join(root, 'uploads', 'session-resources', 'live-test.webp');
  fs.mkdirSync(path.dirname(firstFile), { recursive: true });
  fs.writeFileSync(firstFile, 'first-resource');
  const destination = path.join(mirror, '.armi-sync', 'current', 'uploads', 'session-resources', 'live-test.webp');
  await until(() => fs.existsSync(destination), 'Initial resource did not reach the mirror');

  // No API call after this edit: the filesystem notification must wake the queue.
  const started = Date.now();
  fs.writeFileSync(firstFile, 'changed-resource');
  await until(() => fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') === 'changed-resource', 'File notification was not copied', 10000);
  const resourceMs = Date.now() - started;

  db.prepare('INSERT INTO armi_test_notes VALUES (?, ?)').run('new-note', 'preserved-note');
  const postState = () => api('sync/frontend-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { armi_test_live: String(Date.now()) } }) });
  const edits = (async () => { for (let i = 0; i < 20; i++) { await postState(); await wait(150); } })();
  const eventsRoot = path.join(mirror, '.armi-sync', 'incremental-v1', 'devices');
  await until(() => {
    if (!fs.existsSync(eventsRoot)) return false;
    for (const device of fs.readdirSync(eventsRoot)) {
      const events = path.join(eventsRoot, device, 'events');
      if (!fs.existsSync(events)) continue;
      for (const file of fs.readdirSync(events).filter((name) => name.endsWith('.json'))) {
        const event = JSON.parse(fs.readFileSync(path.join(events, file), 'utf8'));
        if (event.operations?.some((op) => op.table === 'armi_test_notes' && op.row?.value === 'preserved-note')) return true;
      }
    }
    return false;
  }, 'Continuous edits postponed database publication');
  await edits;
  assert.equal(db.prepare('SELECT value FROM armi_test_notes').get().value, 'preserved-note');
  const remoteEvents = path.join(eventsRoot, 'other-pc', 'events');
  fs.mkdirSync(remoteEvents, { recursive: true });
  const incomingId = `remote-${Date.now()}`;
  fs.writeFileSync(path.join(remoteEvents, `${incomingId}.json`), JSON.stringify({
    format: 1, batchId: incomingId, deviceId: 'other-pc', operations: [{
      table: 'armi_test_notes', key: '[["id"],["incoming-note"]]',
      keyColumns: ['id'], keyValues: ['incoming-note'], action: 'upsert',
      row: { id: 'incoming-note', value: 'fresh-from-other-pc' }, version: 1,
    }],
  }));
  // Incoming row events must be consumed without a status request or restart.
  await until(() => db.prepare('SELECT value FROM armi_test_notes WHERE id = ?').get('incoming-note')?.value === 'fresh-from-other-pc',
    'Incoming change did not reach the running PC automatically', 10000);
  console.log(`OK: file notification copied in ${resourceMs} ms; database edits published automatically with Drive launch disabled; original data isolated.`);
} finally {
  db?.close();
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, wait(5000)]);
  if (server.exitCode === null) { server.kill('SIGKILL'); await exited; }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
