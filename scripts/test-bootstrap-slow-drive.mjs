import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-slow-drive-'));
const mirror = path.join(root, 'mirror');
fs.mkdirSync(path.join(root, 'database'), { recursive: true });
fs.mkdirSync(path.join(root, 'sync-runtime', 'state'), { recursive: true });
fs.mkdirSync(mirror);
fs.mkdirSync(path.join(mirror, '.armi-sync', 'current', 'database'), { recursive: true });
fs.writeFileSync(path.join(mirror, '.armi-sync', 'current', 'database', 'database-dump.json'), '{}');
// Exercise placeholder recovery with a valid clean profile, independently of
// the developer's historical identity issues or unpublished personal records.
await prepareInstallerDatabase(path.resolve('database/armi.db'), path.join(root, 'database', 'armi.db'));
const fixture = new Database(path.join(root, 'database', 'armi.db'));
fixture.exec('DELETE FROM armi_frontend_state'); fixture.close();
fs.writeFileSync(path.join(root, 'sync-runtime', 'sync-config.json'), JSON.stringify({ mode: 'drive_mirror', mirrorPath: mirror, syncUserKey: 'slow-drive' }));
fs.writeFileSync(path.join(mirror, '.armi-sync-root.json'), JSON.stringify({ format: 1, syncUserKey: 'slow-drive' }));
fs.writeFileSync(path.join(root, 'sync-runtime', 'state', 'frontend-local-storage.json'), JSON.stringify({ keys: { armi_schedule_entries: '[{"course":"Local timetable"}]' } }));
process.env.ARMI_DATA_ROOT = root;
process.env.ARMI_DISABLE_DRIVE_LAUNCH = '1';
const { bootstrapPortableState, startContinuousMirrorSync } = await import('../backend/sync.js');
const { default: db } = await import('../backend/db.js');
const originalRead = fs.promises.readFile;
let release;
let intercepted = false;
fs.promises.readFile = async function (file, ...args) {
  if (String(file).includes(mirror) && String(file).endsWith('database-dump.json')) {
    intercepted = true;
    await new Promise(resolve => { release = resolve; });
    return JSON.stringify({ tables: {} });
  }
  return originalRead.call(this, file, ...args);
};
const stop = startContinuousMirrorSync({ initialDelayMs: 60_000, intervalMs: 60_000 });
let ticks = 0;
const timer = setInterval(() => { ticks++; }, 50);
try {
  const began = Date.now();
  const result = await bootstrapPortableState({ armi_schedule_entries: '[]' });
  const elapsed = Date.now() - began;
  assert.equal(intercepted, true, 'Test must actually stall a Drive placeholder');
  assert.equal(result.success, true);
  assert.equal(result.data.recoveryPending, true);
  assert.equal(result.data.frontendState.keys.armi_schedule_entries, '[{"course":"Local timetable"}]');
  assert.ok(elapsed < 4_000, `Startup waited ${elapsed} ms for Drive`);
  assert.ok(ticks >= Math.floor(elapsed / 100), 'Drive reads must not block the event loop while the bounded read is pending');
  fs.promises.readFile = originalRead;
  release();
  let recovered;
  const deadline = Date.now() + 20_000;
  do { recovered = await bootstrapPortableState({}); } while (recovered.data?.recoveryPending && Date.now() < deadline);
  assert.equal(recovered.success, true);
  assert.equal(recovered.data.recoveryPending, false);
  const { readMirrorJson } = await import('../backend/mirrorJsonReader.js');
  const stalledReads = [];
  let readCount = 0;
  fs.promises.readFile = async function (file, ...args) {
    if (String(file).includes('stalled-provider-')) {
      readCount++;
      return new Promise(resolve => { stalledReads.push(() => resolve('{}')); });
    }
    return originalRead.call(this, file, ...args);
  };
  await Promise.all([readMirrorJson('stalled-provider-1'), readMirrorJson('stalled-provider-2')]);
  await readMirrorJson('stalled-provider-3');
  await readMirrorJson('stalled-provider-1');
  assert.equal(readCount, 2, 'A stopped provider cannot create unlimited native reads or duplicate retries');
  await fs.promises.writeFile(path.join(root, 'local-save.txt'), 'safe-local-write');
  stalledReads.forEach(unblock => unblock());
  fs.promises.readFile = originalRead;
  console.log(`OK: a stalled Drive placeholder keeps local data and opens in ${elapsed} ms; background recovery resumes.`);
} finally {
  fs.promises.readFile = originalRead;
  release?.(); clearInterval(timer); stop();
  await new Promise(resolve => setTimeout(resolve, 500));
  db.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
