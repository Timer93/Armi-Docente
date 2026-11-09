import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-close-checkpoint-'));
const runtime = path.join(root, 'sync-runtime');
const remote = path.join(root, 'unavailable-drive');
const uploads = path.join(root, 'uploads');
fs.mkdirSync(runtime, { recursive: true });
fs.mkdirSync(path.join(root, 'database'), { recursive: true });
new Database(path.join(root, 'database', 'armi.db')).close();
fs.writeFileSync(path.join(runtime, 'sync-config.json'), JSON.stringify({ mode: 'drive_mirror', mirrorPath: remote, syncUserKey: 'close-checkpoint-test', autoSyncOnClose: true }));
process.env.ARMI_DATA_ROOT = root;
process.env.ARMI_DISABLE_DRIVE_LAUNCH = '1';
let db;
try {
  const sync = await import('../backend/sync.js');
  db = (await import('../backend/db.js')).default;
  db.prepare("INSERT INTO evaluacion_registros(student_id,session_id,criteria_id,level) VALUES('test-student','test-session','primary-1','A')").run();
  const manifestPath = path.join(runtime, 'local-manifest.json');
  const baseline = JSON.stringify({ digest: 'last-confirmed-drive-copy', files: [] });
  fs.writeFileSync(manifestPath, baseline);
  sync.saveFrontendStateSnapshot({ armi_close_test: 'Estado visual guardado' }, ['armi_close_test']);
  fs.mkdirSync(uploads, { recursive: true });
  const resource = path.join(uploads, 'large-resource.bin');
  const fd = fs.openSync(resource, 'w'); fs.ftruncateSync(fd, 512 * 1024 * 1024); fs.closeSync(fd);
  const originals = {};
  let remoteOrResourceAccesses = 0;
  for (const method of ['readFileSync', 'readdirSync', 'statSync']) {
    originals[method] = fs[method];
    fs[method] = function (target, ...args) {
      if (typeof target === 'string' && (target.startsWith(remote) || target.startsWith(uploads))) {
        remoteOrResourceAccesses++;
        throw new Error('El cierre intentó acceder a Drive o recorrer recursos.');
      }
      return originals[method].call(this, target, ...args);
    };
  }
  let checkpoint;
  try { checkpoint = await sync.markPendingLocalBackup({ reason: 'close-attempt', deferRemote: true }); }
  finally { for (const [method, original] of Object.entries(originals)) fs[method] = original; }
  assert.equal(checkpoint.success, true);
  assert.equal(checkpoint.data.closePrepared, true);
  assert.equal(checkpoint.data.localSaved, true);
  assert.equal(checkpoint.data.cloudDeliveryPending, true, 'Do not claim that Drive received the data');
  assert.equal(remoteOrResourceAccesses, 0, 'Close must work even when Drive is unavailable and resources are large');
  assert.equal(fs.existsSync(path.join(runtime, 'database-dump.json')), false, 'No full database export during close');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), baseline, 'The last synchronized baseline must remain untouched');
  const secondConnection = new Database(path.join(root, 'database', 'armi.db'), { readonly: true });
  assert.equal(secondConnection.prepare("SELECT level FROM evaluacion_registros WHERE student_id='test-student'").get().level, 'A');
  assert.equal(secondConnection.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_close_test'").get().value, 'Estado visual guardado');
  secondConnection.close();
  const pendingPath = path.join(runtime, 'pending-local-state.json');
  assert.equal(JSON.parse(fs.readFileSync(pendingPath, 'utf8')).reason, 'close-attempt');
  fs.writeFileSync(pendingPath, JSON.stringify({ reason: 'mirror-changed-on-another-pc', manifest: { digest: 'protected-conflict' }, note: 'Conflicto real protegido' }));
  const conflict = await sync.markPendingLocalBackup({ reason: 'close-attempt', deferRemote: true });
  assert.equal(conflict.data.reason, 'mirror-changed-on-another-pc');
  assert.equal(conflict.data.manifest.digest, 'protected-conflict');
  fs.rmSync(resource);
  await sync.markPendingLocalBackup({ reason: 'manual-test' });
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), baseline, 'A manual pending backup must not advance the baseline either');
  console.log('OK: local durable close without Drive I/O or full export, pending retry persisted, original grades preserved and no false baseline advancement.');
} finally {
  db?.close();
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('armi-close-checkpoint-')) throw new Error('Unsafe temporary cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
}
