import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';
import { wouldEraseNewerUnitPlanning } from '../backend/shared/unitPlanningSyncProtection.js';

const sessions = [{ id: 1, selectedCriteriaIds: ['area-competencia-0'], evidenceItems: [{ text: 'Ficha de observación' }] }];
const restored = { id_unidad: 'tercero-U7', sesiones: JSON.stringify(sessions), updated_at: '2026-10-14 22:47:19' };
const damaged = { ...restored, sesiones: JSON.stringify([{ id: 1, selectedCriteriaIds: [], evidenceItems: [] }]), updated_at: '2026-10-14 15:30:19' };
const op = row => ({ table: 'unidades_didacticas', action: 'upsert', row });
assert.equal(wouldEraseNewerUnitPlanning(op(damaged), restored), true);
assert.equal(wouldEraseNewerUnitPlanning(op({ ...damaged, sesiones: JSON.stringify([{ ...sessions[0], evidenceItems: [] }]) }), restored), true, 'Protect evidence even when criteria survive');
assert.equal(wouldEraseNewerUnitPlanning(op({ ...damaged, sesiones: JSON.stringify([{ ...sessions[0], selectedCriteriaIds: [] }]) }), restored), true, 'Protect criteria even when evidence survives');
assert.equal(wouldEraseNewerUnitPlanning(op({ ...damaged, updated_at: '2026-10-15 01:00:00' }), restored), false, 'Respect newer deliberate removals');
assert.equal(wouldEraseNewerUnitPlanning({ ...op(damaged), action: 'delete' }, restored), false);
assert.equal(wouldEraseNewerUnitPlanning(op({ ...damaged, updated_at: '' }), restored), false);
assert.equal(wouldEraseNewerUnitPlanning(op({ ...damaged, sesiones: 'bad json' }), restored), false);
assert.equal(wouldEraseNewerUnitPlanning(op({ ...restored, updated_at: damaged.updated_at }), restored), false);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-unit-sync-protection-'));
const mirror = path.join(root, 'mirror'); fs.mkdirSync(mirror);
const databases = [];
const make = name => {
  const db = new Database(':memory:'); databases.push(db);
  db.exec('CREATE TABLE unidades_didacticas (id_unidad TEXT PRIMARY KEY, sesiones TEXT, updated_at TEXT)');
  const engine = createIncrementalMirrorSync({ db, runtimeFolder: path.join(root, name), excludedTables: [], getDeviceId: () => name,
    getSourceSignature: () => JSON.stringify(db.prepare('SELECT * FROM unidades_didacticas').all()) });
  return { db, engine };
};
const save = (client, row) => client.db.prepare('INSERT OR REPLACE INTO unidades_didacticas VALUES (?,?,?)').run(row.id_unidad, row.sesiones, row.updated_at);
const run = async client => { const result = await client.engine.run({ mirrorPath: mirror }); assert.equal(result.success, true, JSON.stringify(result)); };
try {
  const remote = make('remote'), local = make('local');
  save(remote, { ...restored, updated_at: '2026-10-13 10:00:00' }); await run(remote); await run(local);
  const folder = path.join(mirror, '.armi-sync/incremental-v1/devices/remote/events');
  const initialFiles = new Set(fs.readdirSync(folder));
  for (let i = 0; i < 3; i++) { save(remote, { ...damaged, updated_at: `2026-10-14 15:30:${20 + i}` }); await run(remote); }
  // Model Drive delivering the old PC's higher revisions only after recovery.
  const pending = fs.readdirSync(folder).filter(file => !initialFiles.has(file)).map(file => ({ file, data: fs.readFileSync(path.join(folder, file)) }));
  for (const item of pending) fs.unlinkSync(path.join(folder, item.file));
  save(local, restored); await run(local);
  for (const item of pending) fs.writeFileSync(path.join(folder, item.file), item.data);
  await run(local); await run(remote); await run(local);
  for (const client of [local, remote]) {
    const row = client.db.prepare('SELECT * FROM unidades_didacticas').get();
    assert.deepEqual(row, restored, 'Both PCs converge on the recovered assignments');
  }
  save(remote, { ...damaged, updated_at: '2026-10-15 01:00:00' }); await run(remote); await run(local);
  assert.equal(local.db.prepare('SELECT sesiones FROM unidades_didacticas').get().sesiones, damaged.sesiones, 'A later explicit clear still syncs');
  console.log('OK: una copia antigua con revisión mayor no borra la recuperación; ambas PC convergen y se respetan las eliminaciones posteriores.');
} finally {
  databases.forEach(db => db.close());
  fs.rmSync(root, { recursive: true, force: true });
}
