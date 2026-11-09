import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResourceConflictStore, resourceChecksum } from '../backend/resourceConflicts.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-conflicts-'));
try {
  const localPath = path.join(root, 'local.png'), mirrorPath = path.join(root, 'mirror.png');
  const store = createResourceConflictStore(path.join(root, 'records'));
  const options = { relativePath: 'uploads/session-resources/2026-test-S5-annex2.png', localPath, mirrorPath };
  fs.writeFileSync(localPath, 'same'); fs.writeFileSync(mirrorPath, 'same');
  assert.equal(await store.capture(options), null);
  assert.deepEqual(store.list(), []);
  fs.writeFileSync(localPath, 'LOCAL'); fs.writeFileSync(mirrorPath, 'DRIVE');
  const item = await store.capture(options);
  assert.equal(item.title, 'Sesión 5 · Práctica');
  await store.capture(options); assert.equal(store.list().length, 1);
  const copy = async (source, destination, checksum) => {
    assert.equal(await resourceChecksum(source), checksum);
    fs.copyFileSync(source, destination);
  };
  fs.writeFileSync(localPath, 'newer edit');
  await assert.rejects(store.resolve(item.id, 'mirror', copy), /cambios nuevos/);
  assert.equal(fs.readFileSync(localPath, 'utf8'), 'newer edit');
  fs.writeFileSync(localPath, 'LOCAL');
  await store.resolve(item.id, 'mirror', copy);
  assert.equal(fs.readFileSync(localPath, 'utf8'), 'DRIVE');
  assert.equal(store.list().length, 0);
  assert.equal(fs.readFileSync(store.snapshot(item.id, 'local').file, 'utf8'), 'LOCAL');
  assert.equal(fs.readFileSync(store.snapshot(item.id, 'mirror').file, 'utf8'), 'DRIVE');
  fs.writeFileSync(localPath, 'chosen local');
  const second = await store.capture(options);
  await store.resolve(second.id, 'local', copy);
  assert.equal(fs.readFileSync(mirrorPath, 'utf8'), 'chosen local');
  assert.throws(() => store.snapshot('../record', 'local'), /no válido/);
  assert.throws(() => store.snapshot(item.id, 'wrong'), /no válida/);
  console.log('OK: real versions only, deduplication, clear titles, both choices, backups and stale-choice protection.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
