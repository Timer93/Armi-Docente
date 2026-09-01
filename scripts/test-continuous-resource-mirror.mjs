import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-resource-mirror-test-'));
const dataRoot = path.join(root, 'data');
const mirrorRoot = path.join(root, 'mirror');
const sourcePath = path.join(dataRoot, 'uploads', 'session-resources', 'session-test.webp');
const relativePath = path.join('uploads', 'session-resources', 'session-test.webp');
const destinationPath = path.join(mirrorRoot, '.armi-sync', 'current', relativePath);
let testDb = null;

try {
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, Buffer.from('recurso-uno'));
  process.env.ARMI_DATA_ROOT = dataRoot;

  const [{ ensureMirrorResourceAvailable, publishContinuousResourcesToMirror }, dbModule] = await Promise.all([
    import('../backend/sync.js'),
    import('../backend/db.js'),
  ]);
  testDb = dbModule.default;
  const first = await publishContinuousResourcesToMirror(mirrorRoot);
  assert.equal(first.copiedFiles, 1);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'recurso-uno');

  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(sourcePath, Buffer.from('recurso-dos'));
  const second = await publishContinuousResourcesToMirror(mirrorRoot);
  assert.equal(second.copiedFiles, 1);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'recurso-dos');

  fs.rmSync(sourcePath);
  const third = await publishContinuousResourcesToMirror(mirrorRoot);
  assert.equal(third.copiedFiles, 0);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'recurso-dos');
  const recovered = await ensureMirrorResourceAvailable('uploads/session-resources/session-test.webp');
  assert.equal(recovered.success, true);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'recurso-dos');
  console.log('OK: recursos nuevos y modificados viajan al espejo y otra PC los recupera bajo demanda.');
} finally {
  try { testDb?.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
