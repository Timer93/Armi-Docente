import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIncrementalMirrorSync } from '../backend/incrementalMirrorSync.js';
import { portableEvidenceKey } from '../backend/evidenceMirrorIndex.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-tombstone-placeholder-'));
const mirrorPath = path.join(root, 'mirror');
const runtimeFolder = path.join(root, 'runtime');
const db = new Database(':memory:');
const originalRead = fs.promises.readFile;
let placeholderReads = 0;
try {
  fs.mkdirSync(mirrorPath);
  db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, value TEXT); CREATE TABLE evaluacion_evidencias (id INTEGER PRIMARY KEY, evidence_key TEXT UNIQUE, relative_path TEXT)');
  const relativePath = '2026/estudiante/trabajo.pdf';
  const evidenceKey = portableEvidenceKey(relativePath);
  db.prepare('INSERT INTO evaluacion_evidencias VALUES (1, ?, ?)').run(evidenceKey, relativePath);
  db.prepare('INSERT INTO notes VALUES (?, ?)').run('note', 'initial');
  const engine = createIncrementalMirrorSync({ db, runtimeFolder, getDeviceId: () => 'pc-test',
    getSourceSignature: () => JSON.stringify({
      notes: db.prepare('SELECT * FROM notes').all(),
      evidence: db.prepare('SELECT * FROM evaluacion_evidencias').all(),
    }),
  });
  assert.equal((await engine.run({ mirrorPath })).success, true);
  assert.equal((await engine.run({ mirrorPath })).data.fastCheck, true);

  const fastPath = path.join(runtimeFolder, 'incremental-identity-fast-state.json');
  const statePath = path.join(runtimeFolder, 'incremental-identity-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.conflicts = Array.from({ length: 100 }, (_, i) => ({ entity: `historical-${i}` }));
  fs.writeFileSync(statePath, JSON.stringify(state));
  const fast = JSON.parse(fs.readFileSync(fastPath, 'utf8'));
  fs.writeFileSync(fastPath, JSON.stringify({ ...fast, conflicts: 100 }));
  const history = await engine.run({ mirrorPath });
  assert.equal(history.data.state, 'in-sync');
  assert.equal(history.data.conflicts, 100, 'The audit history is retained');

  const tombstones = path.join(mirrorPath, 'Evidencias de estudiantes', '.armi-evidence-index', 'tombstones');
  fs.mkdirSync(tombstones, { recursive: true });
  const placeholderPath = path.join(tombstones, `${evidenceKey}.json`);
  fs.writeFileSync(placeholderPath, '');
  fs.promises.readFile = async function (target, ...args) {
    if (String(target) === placeholderPath) {
      placeholderReads += 1;
      throw new Error('Drive has not hydrated this placeholder');
    }
    return originalRead.call(this, target, ...args);
  };
  assert.equal(engine.inspect({ mirrorPath }).tombstoneChangesPending, true,
    'A newly arrived deletion must invalidate the fast checkpoint');
  const deleted = await engine.run({ mirrorPath });
  assert.equal(deleted.success, true, deleted.message);
  assert.equal(placeholderReads, 0, 'Standard deletion keys are available without hydrating JSON');
  assert.equal(db.prepare('SELECT count(*) AS total FROM evaluacion_evidencias').get().total, 0);
  db.prepare('UPDATE notes SET value = ?').run('unrelated edit');
  assert.equal((await engine.run({ mirrorPath })).success, true);
  assert.equal((await engine.run({ mirrorPath })).data.state, 'in-sync');
  assert.equal(engine.inspect({ mirrorPath }).pending, false);
  assert.equal(db.prepare('SELECT count(*) AS total FROM evaluacion_evidencias').get().total, 0,
    'An old recovery catalog must not resurrect deleted evidence');

  const legacyPlaceholder = path.join(tombstones, 'legacy-pending.json');
  fs.writeFileSync(legacyPlaceholder, '');
  const pending = await engine.run({ mirrorPath });
  assert.equal(pending.success, false);
  assert.equal(pending.data.state, 'pending', 'An unidentifiable placeholder stays protected and waiting');
  assert.ok(pending.data.pendingOperations > 0);
  fs.rmSync(legacyPlaceholder);
  assert.equal((await engine.run({ mirrorPath })).success, true);
  console.log('OK: historial resuelto, eliminaciones nuevas, fichas sin hidratar y cambios independientes.');
} finally {
  fs.promises.readFile = originalRead;
  db.close();
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
  fs.rmSync(resolved, { recursive: true, force: true });
}
