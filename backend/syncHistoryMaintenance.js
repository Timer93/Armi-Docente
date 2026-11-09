import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const compress = promisify(gzip), decompress = promisify(gunzip);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,300}$/.test(value);
const inside = (root, target) => { const relative = path.relative(root, target); return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

export function duplicateBatchDigest(batch) {
  if (batch?.format !== 2 || batch.identityRevision !== 4 || !safe(batch.deviceId) || !safe(batch.batchId)
    || !Array.isArray(batch.operations) || !batch.operations.length
    || batch.operations.some(op => !Number.isSafeInteger(op.version) || !safe(op.deviceId)
      // Existing reviewed receipts refer to the exact approved calendar batch.
      || (op.table === 'armi_frontend_state' && op.row?.key === 'armi_holidays_v7'))) return null;
  const payload = Object.fromEntries(Object.entries(batch).filter(([key]) => !['batchId', 'sequence', 'createdAt'].includes(key)));
  return hash(JSON.stringify(stable(payload)));
}

// Only duplicate publications are retired. No unique operation, deletion marker,
// version clock, recovery catalog or local database is compacted or replaced.
export function createLocalSyncHistoryMaintenance({ runtimeFolder, readJson, writeJson, options = {} }) {
  const settings = { scanLimit: 16, retireLimit: 4, minAgeMs: 7 * 86400_000,
    intervalMs: 60_000, maxBatchBytes: 2 * 1024 * 1024, ...options };
  const indexPath = path.join(runtimeFolder, 'history-maintenance-index.json');
  const archiveRoot = path.join(runtimeFolder, 'history-archive');
  let index = null, loaded = false, running = false, lastRun = -Infinity;
  let current = { state: 'idle', retiredFiles: 0, retiredBytes: 0, archivePath: archiveRoot,
    cloudSpaceReclaimed: false, message: 'Mantenimiento automático de repeticiones exactas.' };
  return {
    snapshot: () => ({ ...current }),
    async tick({ mirrorPath, eventFiles, eventCount = eventFiles.length, applied, eventSignature, peers, deviceId, protectedBatchIds = [], canRetire = () => true }) {
      if (running || Date.now() - lastRun < settings.intervalMs || !safe(deviceId) || !await canRetire()) return;
      running = true; lastRun = Date.now();
      try {
        const mirror = await fs.realpath(mirrorPath);
        await fs.mkdir(archiveRoot, { recursive: true });
        const archive = await fs.realpath(archiveRoot);
        if (archive === mirror || inside(mirror, archive)) throw new Error('El archivo de seguridad debe estar fuera del espejo.');
        const segments = mirror.split(path.sep), cloudIndex = segments.findIndex(segment => ['mi unidad', 'my drive'].includes(segment.toLowerCase()));
        if (cloudIndex >= 0) {
          const driveRoot = segments.slice(0, cloudIndex + 1).join(path.sep);
          if (archive === driveRoot || inside(driveRoot, archive)) throw new Error('El archivo de seguridad debe quedar fuera de Google Drive.');
        }
        if (!loaded) {
          const saved = await readJson(indexPath, null);
          index = saved?.format === 1 && saved.mirror === mirror && saved.deviceId === deviceId
            ? saved : { format: 1, mirror, deviceId, cursor: 0, records: {}, retiredFiles: 0, retiredBytes: 0 };
          loaded = true;
        }
        if (index.mirror !== mirror || index.deviceId !== deviceId) {
          index = { format: 1, mirror, deviceId, cursor: 0, records: {}, retiredFiles: 0, retiredBytes: 0 };
        }
        const files = eventFiles.filter(file => path.basename(path.dirname(path.dirname(file))) === deviceId).sort();
        const names = new Set(files.map(file => path.basename(file, '.json')));
        for (const name of Object.keys(index.records)) if (!names.has(name)) delete index.records[name];
        // Incremental indexing, with no background reread of the entire history.
        for (let count = 0; count < Math.min(files.length, settings.scanLimit); count++) {
          const file = files[index.cursor++ % files.length], id = path.basename(file, '.json');
          if (index.records[id] || !applied.has(id)) continue;
          const stat = await fs.lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > settings.maxBatchBytes) continue;
          const batch = await readJson(file, null), digest = duplicateBatchDigest(batch);
          if (!digest || batch.batchId !== id || batch.deviceId !== deviceId || !Number.isFinite(Date.parse(batch.createdAt))) continue;
          index.records[id] = { digest, bytes: stat.size, createdAt: batch.createdAt };
        }
        const acknowledged = peers.some(peer => peer.eventSignature === eventSignature && peer.eventCount === eventCount);
        const groups = new Map();
        for (const [id, record] of Object.entries(index.records).sort(([a], [b]) => a.localeCompare(b))) {
          const group = groups.get(record.digest) || []; group.push(id); groups.set(record.digest, group);
        }
        const duplicates = [...groups.values()].flatMap(group => group.slice(1).map(id => ({ id, retained: group[0] })));
        current = { ...current, state: duplicates.length && !acknowledged ? 'waiting-for-receipt' : 'idle',
          indexedFiles: Object.keys(index.records).length, duplicateCandidates: duplicates.length,
          retiredFiles: index.retiredFiles, retiredBytes: index.retiredBytes,
          message: duplicates.length && !acknowledged ? 'Las repeticiones esperan un comprobante de recepción de otra PC.'
            : 'Revisión gradual de repeticiones; los cambios únicos se conservan.' };
        let retired = 0;
        for (const candidate of acknowledged ? duplicates : []) {
          if (retired >= settings.retireLimit) break;
          const record = index.records[candidate.id];
          if (protectedBatchIds.includes(candidate.id)) continue;
          if (Date.now() - Date.parse(record.createdAt) < settings.minAgeMs
            || !applied.has(candidate.id) || !applied.has(candidate.retained)) continue;
          const root = path.join(mirror, '.armi-sync/incremental-v1/devices', deviceId, 'events');
          const file = path.join(root, `${candidate.id}.json`), keeper = path.join(root, `${candidate.retained}.json`);
          if (!inside(root, file) || !inside(root, keeper) || !inside(mirror, await fs.realpath(file))
            || !inside(mirror, await fs.realpath(keeper))) throw new Error('Ruta de historial fuera del espejo esperado.');
          const a = await fs.lstat(file), b = await fs.lstat(keeper);
          if (!a.isFile() || !b.isFile() || a.isSymbolicLink() || b.isSymbolicLink()
            || a.size > settings.maxBatchBytes || b.size > settings.maxBatchBytes) continue;
          const bytes = await fs.readFile(file), kept = await fs.readFile(keeper);
          const batch = JSON.parse(bytes), retainedBatch = JSON.parse(kept);
          if (batch.batchId !== candidate.id || retainedBatch.batchId !== candidate.retained
            || batch.deviceId !== deviceId || retainedBatch.deviceId !== deviceId
            || duplicateBatchDigest(batch) !== record.digest || duplicateBatchDigest(retainedBatch) !== record.digest) continue;
          const free = await fs.statfs(archive);
          if (Number(free.bavail) * Number(free.bsize) < bytes.length * 2 + 64 * 1024 * 1024) throw new Error('Espacio local insuficiente para archivar la repetición.');
          const rawHash = hash(bytes), backup = path.join(archive, `${candidate.id}-${rawHash}.json.gz`);
          const compressed = await compress(bytes);
          try { await fs.writeFile(backup, compressed, { flag: 'wx' }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          const backupStat = await fs.lstat(backup);
          if (!backupStat.isFile() || backupStat.isSymbolicLink() || hash(await decompress(await fs.readFile(backup))) !== rawHash) throw new Error('El archivo de seguridad no pasó la verificación.');
          const receipt = { format: 1, batchId: candidate.id, retainedBatchId: candidate.retained,
            source: path.relative(mirror, file), originalSHA256: rawHash, retainedSHA256: hash(kept),
            semanticSHA256: record.digest, bytes: bytes.length, archivedAt: new Date().toISOString() };
          await writeJson(`${backup}.receipt.json`, receipt);
          // Recheck both immutable copies after the archive is durable/readable.
          if (hash(await fs.readFile(file)) !== rawHash || hash(await fs.readFile(keeper)) !== receipt.retainedSHA256) continue;
          if (!await canRetire()) break;
          await fs.unlink(file);
          delete index.records[candidate.id];
          index.retiredFiles++; index.retiredBytes += bytes.length; retired++;
        }
        await writeJson(indexPath, index);
        current = { ...current, retiredFiles: index.retiredFiles, retiredBytes: index.retiredBytes,
          lastCheckedAt: new Date().toISOString(), state: retired ? 'retired-duplicates' : current.state,
          message: retired ? 'Repeticiones archivadas fuera de Drive y retiradas del historial. La cuota depende de la papelera de Drive.' : current.message };
      } catch (error) {
        current = { ...current, state: 'deferred', message: `Mantenimiento aplazado; se conservan los archivos. ${error.message}` };
      } finally { running = false; }
    },
  };
}

// Filesystem calls stalled inside a Drive provider must not consume the server's
// filesystem worker pool. A separate process only touches history/archive files,
// never SQLite, and asks the parent for authorization immediately before retire.
export function createSyncHistoryMaintenance(args) {
  if (args.options?.useWorker === false) return createLocalSyncHistoryMaintenance(args);
  let child = null, lastRun = -Infinity;
  let current = { state: 'idle', message: 'Revisión gradual de repeticiones exactas.',
    retiredFiles: 0, retiredBytes: 0, cloudSpaceReclaimed: false };
  return {
    snapshot: () => ({ ...current }),
    stop: () => { child?.kill(); },
    async tick(input) {
      const minAge = args.options?.minAgeMs ?? 7 * 86400_000;
      // Fresh events are already protected against duplicate retry publication.
      // No background process is needed until a pair could actually be retired.
      const older = input.eventFiles.filter(file => path.basename(path.dirname(path.dirname(file))) === input.deviceId
        && Date.now() - Number(path.basename(file).split('-')[0]) >= minAge);
      if (child || older.length < 2 || Date.now() - lastRun < (args.options?.intervalMs ?? 60_000)
        || !await (input.canRetire?.() ?? true)) return;
      lastRun = Date.now();
      await new Promise(resolve => {
        let received = false;
        const worker = fork(fileURLToPath(new URL('./workers/syncHistoryMaintenanceWorker.js', import.meta.url)), [], {
          execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
        child = worker;
        const timer = setTimeout(() => {
          current = { ...current, state: 'deferred', message: 'Drive tarda en responder; el mantenimiento se reintentará sin bloquear los guardados.' };
          worker.kill();
        }, args.options?.workerTimeoutMs ?? 15_000);
        worker.on('message', async message => {
          if (message.type === 'retire-check') {
            let allowed = false;
            try { allowed = Boolean(await (input.canRetire?.() ?? true)); } catch { /* Fail closed. */ }
            if (worker.connected) worker.send({ type: 'retire-answer', id: message.id, allowed });
          } else if (message.type === 'complete') { received = true; current = message.snapshot; }
        });
        worker.on('error', () => { current = { ...current, state: 'deferred', message: 'No se pudo iniciar la revisión aislada; se conservan las copias.' }; });
        // close also fires when spawning fails before an exit event exists.
        worker.on('close', () => {
          clearTimeout(timer); if (child === worker) child = null;
          if (!received && current.state !== 'deferred') current = { ...current, state: 'deferred', message: 'Revisión interrumpida; las publicaciones equivalentes se conservan.' };
          resolve();
        });
        const { canRetire: _canRetire, ...payload } = input;
        const owned = input.eventFiles.filter(file => path.basename(path.dirname(path.dirname(file))) === input.deviceId);
        worker.send({ type: 'run', runtimeFolder: args.runtimeFolder, options: args.options || {},
          input: { ...payload, eventFiles: owned, eventCount: input.eventFiles.length,
            applied: owned.map(file => path.basename(file, '.json')).filter(id => input.applied.has(id)) } });
      });
    },
  };
}
