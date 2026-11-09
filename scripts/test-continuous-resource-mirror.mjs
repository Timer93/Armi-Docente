import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resourceChecksum } from '../backend/resourceConflicts.js';

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

  const [{ ensureMirrorResourceAvailable, publishContinuousResourcesToMirror, getLocalSyncStatus, getContinuousMirrorSyncState, listResourceConflicts, resolveResourceConflict, getResourceConflictSnapshot }, dbModule] = await Promise.all([
    import('../backend/sync.js'),
    import('../backend/db.js'),
  ]);
  testDb = dbModule.default;
  const first = await publishContinuousResourcesToMirror(mirrorRoot);
  assert.equal(first.copiedFiles, 1);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'recurso-uno');
  const firstProgress = getContinuousMirrorSyncState().progress;
  assert.equal(firstProgress.totalFiles, 1);
  assert.equal(firstProgress.completedFiles, 1);
  assert.equal(firstProgress.phase, 'catalog');
  const unchanged = await publishContinuousResourcesToMirror(mirrorRoot);
  assert.equal(unchanged.copiedFiles, 0);
  const skippedProgress = getContinuousMirrorSyncState().progress;
  assert.equal(skippedProgress.totalFiles, 0, 'Unchanged files must not be counted as uploads');
  assert.equal(skippedProgress.unchangedFiles, 1);
  assert.equal(skippedProgress.reviewedFiles, 1);

  const unchangedPath = path.join(path.dirname(sourcePath), 'sin-cambios.webp');
  fs.writeFileSync(unchangedPath, 'sin-cambios');
  await publishContinuousResourcesToMirror(mirrorRoot);

  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(sourcePath, Buffer.from('recurso-dos'));
  const second = await publishContinuousResourcesToMirror(mirrorRoot);
  assert.equal(second.copiedFiles, 1);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'recurso-dos');
  const mixedProgress = getContinuousMirrorSyncState().progress;
  assert.equal(mixedProgress.totalFiles, 1, 'A mixed batch counts only the changed file as an upload');
  assert.equal(mixedProgress.unchangedFiles, 1);
  assert.equal(mixedProgress.reviewedFiles, 2);

  // Touching or moving an identical local file must not re-upload its bytes.
  const touched = new Date(Date.now() + 2000);
  fs.utimesSync(sourcePath, touched, touched);
  assert.equal((await publishContinuousResourcesToMirror(mirrorRoot)).copiedFiles, 0);

  const catalogRoot = path.join(mirrorRoot, '.armi-sync', 'resource-catalog-v1', 'devices');
  const catalogPath = path.join(catalogRoot, fs.readdirSync(catalogRoot)[0]);
  const otherPcCatalog = path.join(catalogRoot, 'other-pc.json');
  fs.renameSync(catalogPath, otherPcCatalog);
  assert.equal((await publishContinuousResourcesToMirror(mirrorRoot)).copiedFiles, 0,
    'A new PC reuses the content already published by another PC.');

  const savedCatalog = fs.readFileSync(catalogPath, 'utf8');
  const savedDestination = fs.readFileSync(destinationPath, 'utf8');
  fs.writeFileSync(catalogPath, '{invalid');
  await assert.rejects(publishContinuousResourcesToMirror(mirrorRoot), /Esperando verificar el catálogo/);
  assert.equal(fs.readFileSync(catalogPath, 'utf8'), '{invalid', 'An unreadable catalog is not overwritten.');
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), savedDestination);
  fs.writeFileSync(catalogPath, savedCatalog);

  const originalRead = fs.promises.readFile;
  let release;
  try {
    fs.promises.readFile = async (file, ...args) => String(file) === catalogPath
      ? new Promise(resolve => { release = () => resolve(savedCatalog); })
      : originalRead.call(fs.promises, file, ...args);
    await assert.rejects(publishContinuousResourcesToMirror(mirrorRoot), /Esperando verificar el catálogo/);
    await assert.rejects(publishContinuousResourcesToMirror(mirrorRoot), /Esperando verificar el catálogo/);
    assert.equal(fs.readFileSync(catalogPath, 'utf8'), savedCatalog);
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), savedDestination);
  } finally {
    fs.promises.readFile = originalRead;
    release?.();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal((await publishContinuousResourcesToMirror(mirrorRoot)).copiedFiles, 0,
    'Recovery after a delayed read must skip files already published.');
  fs.rmSync(destinationPath);
  assert.equal((await publishContinuousResourcesToMirror(mirrorRoot)).copiedFiles, 1,
    'A genuinely missing destination must still be restored.');

  // A remote-only edit, even at the same byte size, must replace a stale local copy.
  fs.writeFileSync(destinationPath, 'remote-only');
  const remoteCatalog = JSON.parse(fs.readFileSync(otherPcCatalog, 'utf8'));
  const remoteEntry = remoteCatalog.resources.find(item => item.relativePath.endsWith('session-test.webp'));
  remoteEntry.checksum = await resourceChecksum(destinationPath);
  remoteEntry.size = Buffer.byteLength('remote-only');
  remoteEntry.updatedAt = new Date(Date.now() + 5000).toISOString();
  fs.writeFileSync(otherPcCatalog, JSON.stringify(remoteCatalog));
  assert.equal((await publishContinuousResourcesToMirror(mirrorRoot)).copiedFiles, 0, 'A stale local file must not overwrite a remote edit.');
  assert.equal(listResourceConflicts().length, 0, 'A remote-only edit is not a conflict.');
  assert.equal((await ensureMirrorResourceAvailable('uploads/session-resources/session-test.webp')).success, true);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'remote-only');
  await publishContinuousResourcesToMirror(mirrorRoot);

  fs.writeFileSync(sourcePath, 'edited here');
  fs.writeFileSync(destinationPath, 'edited away');
  assert.equal((await publishContinuousResourcesToMirror(mirrorRoot)).copiedFiles, 0);
  assert.equal(listResourceConflicts().length, 1);
  const conflict = listResourceConflicts()[0];
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'edited here');
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'edited away');
  await resolveResourceConflict(conflict.id, 'local');
  assert.equal(listResourceConflicts().length, 0);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'edited here');
  assert.equal(fs.readFileSync(getResourceConflictSnapshot(conflict.id, 'mirror').file, 'utf8'), 'edited away');
  assert.equal((await publishContinuousResourcesToMirror(mirrorRoot)).copiedFiles, 0);
  assert.equal((await ensureMirrorResourceAvailable('uploads/session-resources/session-test.webp')).success, true);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'edited here', 'The chosen version must prevail over an older catalog from another PC.');
  fs.writeFileSync(sourcePath, 'recurso-dos');
  await publishContinuousResourcesToMirror(mirrorRoot);

  fs.rmSync(sourcePath);
  const third = await publishContinuousResourcesToMirror(mirrorRoot);
  assert.equal(third.copiedFiles, 0);
  assert.equal(fs.readFileSync(destinationPath, 'utf8'), 'recurso-dos');
  const recovered = await ensureMirrorResourceAvailable('uploads/session-resources/session-test.webp');
  assert.equal(recovered.success, true);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'recurso-dos');
  const receipt = (await getLocalSyncStatus()).data.downloadProgress;
  assert.equal(receipt.state, 'complete');
  assert.equal(receipt.completedFiles, 1);
  assert.equal(receipt.completedBytes, Buffer.byteLength('recurso-dos'));
  console.log('OK: cambios reales, contenido sin cambios, otra PC, catálogo inválido/lento, reintentos y recuperación de archivos.');
} finally {
  try { testDb?.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}
