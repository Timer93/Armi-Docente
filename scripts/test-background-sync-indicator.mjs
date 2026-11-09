import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compiled = ts.transpileModule(fs.readFileSync('utils/backgroundSyncStatus.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { describeBackgroundSync, describeDirectionalSync, getSyncIndicatorTone, mergeRecoveredLocalState, mergeRecoveryProgress, compactSyncState, syncCountLabel } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const status = { config: { mode: 'drive_mirror' }, hasUnsyncedChanges: false,
  continuousSync: { state: 'in-sync', message: '' }, incrementalSync: { state: 'in-sync', pendingOperations: 0 } };
assert.equal(describeBackgroundSync(status, true, '').percent, 100);
const history = { ...status, incrementalSync: { ...status.incrementalSync, conflicts: 100 } };
assert.equal(describeBackgroundSync(history, true, '').percent, 100, 'Resolved conflict history must not block completion');
assert.equal(getSyncIndicatorTone({ ...history, driveDesktop: { state: 'ready' } }), 'ready');
assert.equal(getSyncIndicatorTone({ ...history, incrementalSync: { ...history.incrementalSync, state: 'needs-review' } }), 'ready',
  'Older resolved-history statuses should also stop the perpetual activity indicator');
const pendingHistory = { ...history, incrementalSync: { ...history.incrementalSync, state: 'pending', pendingOperations: 1, message: 'Ficha pendiente' } };
assert.equal(describeBackgroundSync(pendingHistory, true, '').percent, null);
assert.equal(describeBackgroundSync(pendingHistory, true, '').label, 'Esperando cambios de Drive');
assert.equal(getSyncIndicatorTone(pendingHistory), 'waiting', 'A delayed Drive file is not a failed sync');
const failedHistory = { ...history, incrementalSync: { ...history.incrementalSync, state: 'error', message: 'Fallo real' } };
assert.equal(describeBackgroundSync(failedHistory, true, '').detail, 'Fallo real', 'History must not obscure an actual error');
assert.equal(describeBackgroundSync(failedHistory, true, '').tone, 'error');
assert.equal(getSyncIndicatorTone(failedHistory), 'error');
assert.equal(getSyncIndicatorTone(history, false), 'waiting', 'The browser adapter hint alone cannot prove Internet is down');
assert.equal(getSyncIndicatorTone({ ...history, internetConnectivity: { online: true } }, false), 'ready', 'Verified connectivity overrides a wrong browser hint');
assert.equal(getSyncIndicatorTone({ ...history, internetConnectivity: { online: false } }), 'error');
assert.equal(getSyncIndicatorTone({ ...history, internetConnectivity: { online: true },
  driveDesktop: { state: 'offline', processRunning: true, folderAccessible: true, paused: false } }), 'ready',
  'Fresh recovery must not wait for the old aggregate Drive status to expire');
assert.equal(describeBackgroundSync({ ...history, internetConnectivity: { online: false } }, true, '').percent, null);
assert.equal(getSyncIndicatorTone({ ...history, continuousSync: { state: 'syncing' } }), 'syncing');
assert.equal(getSyncIndicatorTone({ ...history, driveDesktop: { state: 'paused' } }), 'waiting');
assert.equal(describeBackgroundSync(status, false, '').percent, null, 'Recovery must complete before announcing completion');
assert.equal(describeBackgroundSync({ ...status, hasUnsyncedChanges: true }, true, '').percent, null);
assert.equal(describeBackgroundSync({ ...status, incrementalSync: { ...status.incrementalSync, pendingOperations: 1 } }, true, '').percent, null);
assert.equal(describeBackgroundSync(status, true, 'Backend desconectado').percent, null, 'A stale status must not show completion after disconnect');
const waiting = describeBackgroundSync({ ...status, continuousSync: { state: 'waiting-for-drive', message: 'Drive detenido' } }, true, '');
assert.equal(waiting.percent, null); assert.equal(waiting.tone, 'warning');
const files = { ...status, continuousSync: { state: 'syncing', progress: { completedFiles: 2, totalFiles: 4, completedBytes: 300, totalBytes: 1000 } } };
assert.equal(describeBackgroundSync(files, true, '').percent, 30, 'Measure bytes rather than assuming all files have the same size');
files.continuousSync.progress.completedBytes = 1000;
assert.equal(describeBackgroundSync(files, true, '').percent, 99, 'Copying all bytes still needs the catalog to finish');
const downloads = { ...status, activeTransfers: [{ state: 'downloading', copiedBytes: 20, totalBytes: 100 }] };
assert.equal(describeBackgroundSync(downloads, true, '').percent, 20);
downloads.activeTransfers[0].state = 'waiting-for-drive-upload';
assert.equal(describeBackgroundSync(downloads, true, '').percent, null);
const simultaneous = { ...status,
  mirrorTransfer: { state: 'copying-to-drive-folder', copiedBytes: 20, totalBytes: 100, copiedFiles: 0, totalFiles: 1 },
  downloadProgress: { state: 'transferring', completedBytes: 150, totalBytes: 300, completedFiles: 0, totalFiles: 1 },
};
const both = describeDirectionalSync(simultaneous, true, '');
assert.equal(syncCountLabel(both.upload), '0/1 arch.');
assert.equal(syncCountLabel(both.download), '0/1 arch.');
assert.equal(both.upload.percent, 20, 'Subida y bajada muestran avances independientes');
assert.equal(both.download.percent, 50);
simultaneous.mirrorTransfer.state = 'prepared-in-local-drive-folder';
simultaneous.mirrorTransfer.copiedFiles = 1;
simultaneous.downloadProgress.state = 'complete';
simultaneous.downloadProgress.completedFiles = 1;
simultaneous.downloadProgress.completedBytes = 300;
const completedDirections = describeDirectionalSync(simultaneous, true, '');
assert.equal(completedDirections.upload.percent, 100);
assert.equal(completedDirections.download.percent, 100);
assert.match(completedDirections.upload.detail, /servidores: no verificada/, 'Folder completion must not impersonate a cloud acknowledgement');
assert.equal(describeDirectionalSync({ ...simultaneous, activeTransfers: [], mirrorTransfer: null }, true, '').download.percent, 100,
  'Completion stays visible after active file entries disappear');
assert.equal(describeDirectionalSync(simultaneous, true, 'Backend desconectado').upload.percent, null);
assert.equal(describeDirectionalSync(simultaneous, true, 'Backend desconectado').download.percent, null);
assert.equal(describeDirectionalSync({ ...status, downloadProgress: { ...simultaneous.downloadProgress, state: 'error' } }, true, '').download.percent, null);
assert.equal(getSyncIndicatorTone({ ...status, downloadProgress: { ...simultaneous.downloadProgress, state: 'error' } }), 'error',
  'The sidebar must preserve a failed download after its active file entry disappears');
assert.equal(getSyncIndicatorTone({ ...status, downloadProgress: { ...simultaneous.downloadProgress, state: 'waiting' } }), 'waiting');
assert.equal(getSyncIndicatorTone({ ...status, downloadProgress: simultaneous.downloadProgress }), 'ready');
assert.equal(describeDirectionalSync(status, true, '').download.tone, 'idle', 'No requested downloads must not be a fictitious 100 percent download');
assert.equal(describeDirectionalSync({ ...status, receivedChanges: { operations: 4 } }, true, '').download.percent, 100,
  'Receiving database records also completes the download direction');
const dataOnly = describeDirectionalSync({ ...status, receivedChanges: { operations: 4 } }, true, '').download;
assert.equal(syncCountLabel(dataOnly), '4 cambios', 'Database records must not appear as files');
const incomingQueue = describeDirectionalSync({ ...status, receivedChanges: { operations: 4 },
  incrementalSync: { ...status.incrementalSync, pendingOperations: 3 } }, true, '').download;
assert.equal(syncCountLabel(incomingQueue), '3 pendientes');
const internalRepair = {...status,incrementalSync:{...status.incrementalSync,pendingOperations:1,
  pendingTask:{kind:'identity-migration',label:'Verificación de la reparación',detail:'Leyendo el control local',requiresAction:false}}};
assert.equal(describeBackgroundSync(internalRepair,true,'').label,'Verificación de la reparación');
const repairView=describeDirectionalSync(internalRepair,true,'');
assert.equal(repairView.download.internalTask,true);
assert.equal(repairView.download.total,null,'An internal repair must not masquerade as one pending download');
assert.equal(repairView.upload.tone,'idle','An internal repair must not claim files are uploading');
assert.equal(incomingQueue.completed, null, 'An unknown remote denominator must not invent a completed count');
const scan = describeDirectionalSync({ ...status, continuousSync: {state:'syncing',progress:{phase:'checking',completedFiles:3,totalFiles:10,completedBytes:30,totalBytes:100,currentFile:'uploads/test.html'}} },true,'').upload;
assert.equal(syncCountLabel(scan),'3/10 revisados');
assert.equal(scan.files[0].name,'test.html');
const copy = describeDirectionalSync({ ...status, continuousSync: {state:'syncing',progress:{phase:'copying',completedFiles:1,totalFiles:2,completedBytes:50,totalBytes:100,unchangedFiles:8,currentFile:'uploads/test.html'}} },true,'').upload;
assert.equal(syncCountLabel(copy),'1/2 arch.');
assert.equal(copy.unchangedFiles,8);
assert.equal(copy.percent,50);
const fail = describeDirectionalSync(simultaneous,true,'Sin servicio');
assert.equal(fail.upload.total,null,'A stale counter must not be presented during a lost connection');
assert.equal(describeDirectionalSync({ ...status, receivedChanges: { operations: 4 },
  incrementalSync: { ...status.incrementalSync, pendingOperations: 1 } }, true, '').download.percent, null,
  'A new pending remote batch must not inherit the previous receipt\'s 100 percent');
assert.deepEqual(mergeRecoveredLocalState(
  { armi_schedule: 'old', armi_deleted: 'old' },
  { armi_schedule: 'edited', armi_new: 'new' },
  { armi_schedule: 'remote', armi_deleted: 'remote', armi_calendar: 'received' },
), { keys: { armi_schedule: 'edited', armi_new: 'new', armi_calendar: 'received' }, changedKeys: ['armi_schedule', 'armi_deleted', 'armi_new'] },
'Opening immediately must preserve edits and deletions made while recovery runs');
const initial = { armi_areas: '[]', armi_deleted: 'old' };
const first = mergeRecoveryProgress(initial, { armi_areas: '[]', armi_new: 'teacher edit' }, {
  armi_areas: '["local area"]', armi_deleted: 'restored', armi_assignments: '["local class"]',
});
assert.equal(first.keys.armi_areas, '["local area"]', 'Pending Drive must not hide local server data from an empty browser.');
assert.equal(first.keys.armi_deleted, undefined, 'A deletion made during recovery must survive.');
const final = mergeRecoveryProgress(first.baseline, first.keys, {
  armi_areas: '["updated area"]', armi_deleted: 'remote', armi_assignments: '["updated class"]', armi_new: 'remote',
});
assert.equal(final.keys.armi_areas, '["updated area"]', 'Hydrated values are not mistaken for teacher edits on the next poll.');
assert.equal(final.keys.armi_new, 'teacher edit');
assert.equal(final.keys.armi_deleted, undefined);
assert.deepEqual(new Set(final.changedKeys), new Set(['armi_deleted', 'armi_new']));
const app = fs.readFileSync('App.tsx', 'utf8');
assert.ok(app.indexOf('applyArmiLocalState(merged.keys)') < app.indexOf('if (result.data?.recoveryPending)'), 'Local settings must be applied before waiting for Drive.');
assert.match(app, /Fragment key=\{localStateRevision\}/, 'Mounted views must read newly hydrated settings.');
console.log('OK: measured progress, local hydration before Drive, repeated recovery and preservation of edits/deletions.');

assert.deepEqual(compactSyncState(scan, 'upload'), { icon: 'sync', text: 'Revisando archivos', count: '3/10 revisados' });
assert.equal(compactSyncState(copy, 'upload').text, 'Copiando archivos');
assert.equal(compactSyncState(describeDirectionalSync(null, false, '').upload, 'upload').count, null);
assert.equal(compactSyncState(describeDirectionalSync(status, true, '').upload, 'upload').text, 'Todo copiado a carpeta espejo');
assert.equal(compactSyncState(describeDirectionalSync(status, true, '').download, 'download').text, 'Sin archivos pendientes');
