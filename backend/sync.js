import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';
import db, { dumpDatabase, restoreDatabase, SYNC_EXCLUDED_TABLES } from './db.js';
import { appRoot, dataRoot, uploadsRoot, syncRuntimeRoot, ensureDir } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeFolder = syncRuntimeRoot;
const stateFolder = path.join(runtimeFolder, 'state');
const snapshotsFolder = path.join(runtimeFolder, 'restore-points');
const dbDumpPath = path.join(runtimeFolder, 'database-dump.json');
const frontendStatePath = path.join(stateFolder, 'frontend-local-storage.json');
const localManifestPath = path.join(runtimeFolder, 'local-manifest.json');
const configPath = path.join(runtimeFolder, 'sync-config.json');
const authSettingsPath = path.join(runtimeFolder, 'auth-settings.json');
const bundledAuthSettingsPath = path.join(appRoot, 'sync-runtime', 'auth-settings.json');
const remoteSyncStatePath = path.join(runtimeFolder, 'remote-sync-state.json');
const syncableDirectories = [
  { key: 'uploads', absolutePath: uploadsRoot },
];
const DEFAULT_MIRROR_SUBFOLDER = 'ARMI Sync';
const DEFAULT_SYNC_USER_KEY = 'default-user';
const SAFETY_RETENTION = 3;
const REMOTE_PROVIDER = 'google-apps-script-drive';

const ensureParentDir = (target) => ensureDir(path.dirname(target));

ensureDir(runtimeFolder);
ensureDir(stateFolder);
ensureDir(snapshotsFolder);

const safeStat = (targetPath) => {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
};

const pathExists = (targetPath) => {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
};

const toPosix = (value) => value.split(path.sep).join('/');
const fromPosixToCurrentOs = (value) => value.split('/').join(path.sep);

const readJsonFile = (targetPath, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return fallback;
  }
};

const getAuthSettings = () => ({
  ...readJsonFile(bundledAuthSettingsPath, {}),
  ...readJsonFile(authSettingsPath, {}),
});

const getAppsScriptUrl = () => {
  const settings = getAuthSettings();
  return String(
    process.env.ARMI_AUTH_APPS_SCRIPT_URL ||
    settings.appsScriptUrl ||
    settings.authLoginUrl ||
    settings.appsScriptResolverUrl ||
    settings.authResolverUrl ||
    ''
  ).trim();
};

const postAppsScript = async (body, timeoutMs = 120000) => {
  const url = getAppsScriptUrl();
  if (!url) {
    return { success: false, message: 'No esta configurada la URL de Apps Script para sincronizacion.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { success: false, message: text.slice(0, 240) || 'Apps Script no devolvio JSON valido.' };
    }
  } catch (error) {
    return {
      success: false,
      message: error?.name === 'AbortError'
        ? 'Apps Script tardo demasiado en responder.'
        : `No se pudo conectar con Apps Script.${error?.message ? ` Detalle: ${error.message}` : ''}`,
    };
  } finally {
    clearTimeout(timer);
  }
};

const writeJsonAtomic = (targetPath, data) => {
  ensureParentDir(targetPath);
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, targetPath);
};

const copyFileAtomic = (sourcePath, destinationPath) => {
  ensureParentDir(destinationPath);
  const tempPath = `${destinationPath}.tmp`;
  fs.copyFileSync(sourcePath, tempPath);
  fs.renameSync(tempPath, destinationPath);
};

const hashFile = (targetPath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(targetPath));
  return hash.digest('hex');
};

const listFilesRecursive = (baseFolder) => {
  if (!pathExists(baseFolder)) return [];
  const results = [];
  const walk = (folder) => {
    fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        return;
      }
      results.push(absolutePath);
    });
  };
  walk(baseFolder);
  return results;
};

const removeEmptyDirsUpward = (folder, stopAt) => {
  let current = folder;
  while (current.startsWith(stopAt) && current !== stopAt) {
    try {
      if (fs.readdirSync(current).length > 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
};

const pruneOldFolders = (folder, keepCount) => {
  if (!pathExists(folder)) return;
  const dirs = fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      absolutePath: path.join(folder, entry.name),
      mtimeMs: safeStat(path.join(folder, entry.name))?.mtimeMs || 0,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  dirs.slice(keepCount).forEach((dir) => {
    try {
      fs.rmSync(dir.absolutePath, { recursive: true, force: true });
    } catch {}
  });
};

const normalizeFrontendStatePayload = (payload = {}) => {
  const keys = Object.entries(payload)
    .filter(([key]) => typeof key === 'string' && key.startsWith('armi_'))
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    exportedAt: new Date().toISOString(),
    keys: Object.fromEntries(keys),
  };
};

const defaultConfig = () => ({
  mode: 'local',
  mirrorPath: '',
  autoSyncOnClose: true,
  syncUserKey: DEFAULT_SYNC_USER_KEY,
  syncUserLabel: 'Usuario local',
  lastUpdatedAt: null,
});

const getDeviceId = () => {
  const source = [os.hostname(), process.env.USERNAME || process.env.USER || '', process.platform].join('|');
  return crypto.createHash('sha1').update(source).digest('hex').slice(0, 16);
};

const readConfig = () => {
  const raw = readJsonFile(configPath, null);
  return {
    ...defaultConfig(),
    ...(raw || {}),
  };
};

const saveConfig = (patch) => {
  const nextConfig = {
    ...readConfig(),
    ...(patch || {}),
    lastUpdatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(configPath, nextConfig);
  return nextConfig;
};

const sanitizeUserScope = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_SYNC_USER_KEY;
};

const normalizeUserLabel = (value) => {
  const normalized = String(value || '').trim();
  return normalized || 'Usuario local';
};

const buildSuggestedMirrorPath = (basePath, syncUserKey) => (
  path.join(basePath, DEFAULT_MIRROR_SUBFOLDER, 'users', sanitizeUserScope(syncUserKey))
);

const getMirrorMetaPaths = (mirrorPath) => {
  const mirrorRoot = path.resolve(mirrorPath);
  const internalRoot = path.join(mirrorRoot, '.armi-sync');
  const currentRoot = path.join(internalRoot, 'current');
  return {
    mirrorRoot,
    internalRoot,
    currentRoot,
    manifestPath: path.join(currentRoot, 'manifest.json'),
    backupsRoot: path.join(internalRoot, 'backups'),
    backupManifestsRoot: path.join(internalRoot, 'backups', 'manifests'),
    trashRoot: path.join(internalRoot, 'trash'),
    syncStatePath: path.join(internalRoot, 'sync-state.json'),
  };
};

const ensureMirrorStructure = (mirrorPath) => {
  const paths = getMirrorMetaPaths(mirrorPath);
  ensureDir(paths.mirrorRoot);
  ensureDir(paths.internalRoot);
  ensureDir(paths.currentRoot);
  ensureDir(paths.backupsRoot);
  ensureDir(paths.backupManifestsRoot);
  ensureDir(paths.trashRoot);
  return paths;
};

const stageLocalDatabaseDump = () => {
  const dump = dumpDatabase({ excludeTables: Array.from(SYNC_EXCLUDED_TABLES) });
  writeJsonAtomic(dbDumpPath, dump);
  return dbDumpPath;
};

const serializeLocalFiles = () => {
  const files = [];
  const databaseDumpStats = safeStat(dbDumpPath);
  if (databaseDumpStats) {
    files.push({
      scope: 'database',
      relativePath: 'database/database-dump.json',
      absolutePath: dbDumpPath,
      size: databaseDumpStats.size,
      mtimeMs: databaseDumpStats.mtimeMs,
      checksum: hashFile(dbDumpPath),
    });
  }

  syncableDirectories.forEach(({ key, absolutePath }) => {
    listFilesRecursive(absolutePath).forEach((filePath) => {
      const stats = safeStat(filePath);
      if (!stats) return;
      files.push({
        scope: key,
        relativePath: toPosix(path.relative(dataRoot, filePath)),
        absolutePath: filePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        checksum: hashFile(filePath),
      });
    });
  });

  const frontendStats = safeStat(frontendStatePath);
  if (frontendStats) {
    files.push({
      scope: 'frontend-state',
      relativePath: 'state/frontend-local-storage.json',
      absolutePath: frontendStatePath,
      size: frontendStats.size,
      mtimeMs: frontendStats.mtimeMs,
      checksum: hashFile(frontendStatePath),
    });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

const buildManifestFromFiles = (files, provider, storageMode) => {
  const entityCounts = getSyncEntityCounts();
  const digest = crypto.createHash('sha256')
    .update(
      JSON.stringify(
        files.map(({ relativePath, size, mtimeMs, checksum }) => ({
          relativePath,
          size,
          mtimeMs,
          checksum,
        }))
      )
    )
    .digest('hex');

  return {
    version: 2,
    provider,
    storageMode,
    generatedAt: new Date().toISOString(),
    digest,
    summary: {
      entities: entityCounts,
      includesAttendance: true,
      includesFaceProfiles: true,
    },
    files: files.map(({ relativePath, scope, size, mtimeMs, checksum }) => ({
      relativePath,
      scope,
      size,
      mtimeMs,
      checksum,
    })),
  };
};

const buildLocalManifest = () => {
  stageLocalDatabaseDump();
  return buildManifestFromFiles(serializeLocalFiles(), 'local-app-storage', 'local');
};

const buildSyncPackageBase64 = (manifest) => {
  const zip = new PizZip();
  const absolutePathByRelativePath = new Map(serializeLocalFiles().map((file) => [file.relativePath, file.absolutePath]));
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  manifest.files.forEach((file) => {
    const absolutePath = file.absolutePath || absolutePathByRelativePath.get(file.relativePath);
    if (!absolutePath || !pathExists(absolutePath)) return;
    zip.file(file.relativePath, fs.readFileSync(absolutePath), { binary: true });
  });
  return zip.generate({ type: 'base64', compression: 'DEFLATE' });
};

const extractSyncPackageToFolder = (packageBase64, targetFolder) => {
  ensureDir(targetFolder);
  let zip;
  try {
    zip = new PizZip(Buffer.from(String(packageBase64 || ''), 'base64'));
  } catch (error) {
    throw new Error('La copia remota llego con un formato ZIP invalido.');
  }

  Object.keys(zip.files || {}).forEach((relativePath) => {
    const file = zip.files[relativePath];
    if (!file || file.dir) return;
    const destination = path.join(targetFolder, fromPosixToCurrentOs(relativePath));
    ensureParentDir(destination);
    fs.writeFileSync(destination, file.asNodeBuffer());
  });
  return readJsonFile(path.join(targetFolder, 'manifest.json'), null);
};

const getExtractedFilePath = (extractRoot, relativePath) => (
  path.join(extractRoot, fromPosixToCurrentOs(relativePath))
);

const extractDatabaseDumpFromPackageBase64 = (packageBase64, targetFolder) => {
  const manifest = extractSyncPackageToFolder(packageBase64, targetFolder);
  const dump = readJsonFile(getExtractedFilePath(targetFolder, 'database/database-dump.json'), null);
  if (!dump?.tables) {
    throw new Error('El paquete remoto no contiene una base de datos valida.');
  }
  return { manifest, dump, extractRoot: targetFolder };
};

const applyExtractedPackageToLocal = (extractRoot, manifest, restoreRoot) => {
  const manifestPaths = new Set((manifest.files || [])
    .filter((file) => ['uploads', 'temp'].includes(file.scope))
    .map((file) => file.relativePath));

  syncableDirectories.forEach(({ absolutePath }) => {
    listFilesRecursive(absolutePath).forEach((localFilePath) => {
      const relativePath = toPosix(path.relative(dataRoot, localFilePath));
      if (manifestPaths.has(relativePath)) return;
      const backupPath = path.join(restoreRoot, 'removed-live-files', fromPosixToCurrentOs(relativePath));
      ensureParentDir(backupPath);
      fs.renameSync(localFilePath, backupPath);
      removeEmptyDirsUpward(path.dirname(localFilePath), absolutePath);
    });
  });

  (manifest.files || []).forEach((file) => {
    const sourcePath = getExtractedFilePath(extractRoot, file.relativePath);
    if (!pathExists(sourcePath)) return;
    if (file.scope === 'database') return;
    if (file.scope === 'frontend-state') {
      copyFileAtomic(sourcePath, frontendStatePath);
      return;
    }
    copyFileAtomic(sourcePath, path.join(dataRoot, fromPosixToCurrentOs(file.relativePath)));
  });

  const dump = readJsonFile(getExtractedFilePath(extractRoot, 'database/database-dump.json'), null);
  if (!dump?.tables) {
    throw new Error('El paquete remoto no contiene una base de datos valida.');
  }
  db.pragma('wal_checkpoint(TRUNCATE)');
  restoreDatabase(dump);
};

const readMirrorManifest = (mirrorPath) => {
  const { manifestPath } = getMirrorMetaPaths(mirrorPath);
  return readJsonFile(manifestPath, null);
};

const getMirrorFilePath = (mirrorPath, relativePath) => {
  const { currentRoot } = getMirrorMetaPaths(mirrorPath);
  return path.join(currentRoot, fromPosixToCurrentOs(relativePath));
};

const verifyMirrorIntegrity = (mirrorPath, manifest) => {
  if (!manifest) {
    return { ok: false, code: 'missing-manifest', missingFiles: [] };
  }

  const missingFiles = (manifest.files || [])
    .map((file) => file.relativePath)
    .filter((relativePath) => !pathExists(getMirrorFilePath(mirrorPath, relativePath)));

  if (missingFiles.length > 0) {
    return { ok: false, code: 'mirror-incomplete', missingFiles };
  }

  return { ok: true, code: 'ok', missingFiles: [] };
};

const compareManifests = (localManifest, mirrorManifest, mode) => {
  if (mode === 'local') return 'local-mode';
  if (mode === 'apps_script_drive' && !mirrorManifest && localManifest) return 'mirror-missing';
  if (!mirrorManifest && !localManifest) return 'no-data';
  if (!mirrorManifest && localManifest) return 'mirror-missing';
  if (localManifest?.digest === mirrorManifest?.digest) return 'in-sync';
  const localDate = Date.parse(localManifest?.generatedAt || '') || 0;
  const mirrorDate = Date.parse(mirrorManifest?.generatedAt || '') || 0;
  if (mirrorDate > localDate) return 'mirror-newer';
  if (localDate > mirrorDate) return 'local-newer';
  return 'diverged';
};

const getLikelyUserHome = () => {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir() || appRoot;
  return path.resolve(home);
};

const detectGoogleDriveCandidates = (syncUserKey = DEFAULT_SYNC_USER_KEY) => {
  const home = getLikelyUserHome();
  const directCandidates = [
    path.join(home, 'Google Drive'),
    path.join(home, 'My Drive'),
    path.join(home, 'Mi unidad'),
    path.join(home, 'GoogleDrive'),
  ];

  const discovered = new Set();
  directCandidates.forEach((candidate) => {
    if (pathExists(candidate)) discovered.add(path.resolve(candidate));
  });

  try {
    fs.readdirSync(home, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => {
        if (!/drive/i.test(entry.name)) return;
        const absolutePath = path.join(home, entry.name);
        if (pathExists(absolutePath)) discovered.add(path.resolve(absolutePath));
      });
  } catch {}

  return Array.from(discovered).map((basePath) => ({
    basePath,
    suggestedMirrorPath: buildSuggestedMirrorPath(basePath, syncUserKey),
  }));
};

const resolveEffectiveMirrorPath = (configLike = {}) => {
  const syncUserKey = sanitizeUserScope(configLike.syncUserKey);
  const configuredMirrorPath = typeof configLike.mirrorPath === 'string' ? configLike.mirrorPath.trim() : '';
  if (configuredMirrorPath) {
    return {
      mirrorPath: path.resolve(configuredMirrorPath),
      derivedAutomatically: false,
      syncUserKey,
    };
  }

  const [firstCandidate] = detectGoogleDriveCandidates(syncUserKey);
  return {
    mirrorPath: firstCandidate?.suggestedMirrorPath ? path.resolve(firstCandidate.suggestedMirrorPath) : '',
    derivedAutomatically: true,
    syncUserKey,
  };
};

const saveFrontendStateSnapshot = (payload = {}) => {
  const normalized = normalizeFrontendStatePayload(payload);
  writeJsonAtomic(frontendStatePath, normalized);
  return normalized;
};

const createLocalRestorePoint = () => {
  const restorePointId = new Date().toISOString().replace(/[:.]/g, '-');
  const restoreRoot = path.join(snapshotsFolder, restorePointId);
  ensureDir(restoreRoot);

  stageLocalDatabaseDump();
  if (pathExists(dbDumpPath)) {
    copyFileAtomic(dbDumpPath, path.join(restoreRoot, 'database', 'database-dump.json'));
  }
  if (pathExists(frontendStatePath)) {
    copyFileAtomic(frontendStatePath, path.join(restoreRoot, 'state', 'frontend-local-storage.json'));
  }

  syncableDirectories.forEach(({ absolutePath, key }) => {
    listFilesRecursive(absolutePath).forEach((filePath) => {
      const relativePath = path.relative(absolutePath, filePath);
      copyFileAtomic(filePath, path.join(restoreRoot, key, relativePath));
    });
  });

  const manifest = buildManifestFromFiles(serializeLocalFiles(), 'local-restore-point', 'local');
  writeJsonAtomic(path.join(restoreRoot, 'manifest.json'), manifest);
  pruneOldFolders(snapshotsFolder, SAFETY_RETENTION);
  return restoreRoot;
};

const moveMirrorFilesToTrash = (mirrorPath, relativePaths, stamp) => {
  const { trashRoot } = ensureMirrorStructure(mirrorPath);
  relativePaths.forEach((relativePath) => {
    const sourcePath = getMirrorFilePath(mirrorPath, relativePath);
    if (!pathExists(sourcePath)) return;
    const destinationPath = path.join(trashRoot, stamp, fromPosixToCurrentOs(relativePath));
    ensureParentDir(destinationPath);
    fs.renameSync(sourcePath, destinationPath);
    removeEmptyDirsUpward(path.dirname(sourcePath), getMirrorMetaPaths(mirrorPath).currentRoot);
  });
  pruneOldFolders(trashRoot, SAFETY_RETENTION);
};

const backupMirrorManifest = (mirrorPath, manifest) => {
  if (!manifest) return;
  const { backupManifestsRoot } = ensureMirrorStructure(mirrorPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeJsonAtomic(path.join(backupManifestsRoot, `${stamp}-manifest.json`), manifest);
  pruneOldFolders(path.dirname(backupManifestsRoot), SAFETY_RETENTION);
};

const applyMirrorToLocal = (mirrorPath, manifest, restoreRoot) => {
  const manifestPaths = new Set((manifest.files || [])
    .filter((file) => ['uploads', 'temp'].includes(file.scope))
    .map((file) => file.relativePath));

  syncableDirectories.forEach(({ absolutePath }) => {
    listFilesRecursive(absolutePath).forEach((localFilePath) => {
      const relativePath = toPosix(path.relative(dataRoot, localFilePath));
      if (manifestPaths.has(relativePath)) return;
      const backupPath = path.join(restoreRoot, 'removed-live-files', fromPosixToCurrentOs(relativePath));
      ensureParentDir(backupPath);
      fs.renameSync(localFilePath, backupPath);
      removeEmptyDirsUpward(path.dirname(localFilePath), absolutePath);
    });
  });

  (manifest.files || []).forEach((file) => {
    const sourcePath = getMirrorFilePath(mirrorPath, file.relativePath);
    if (file.scope === 'database') return;
    if (file.scope === 'frontend-state') {
      copyFileAtomic(sourcePath, frontendStatePath);
      return;
    }
    const destinationPath = path.join(dataRoot, fromPosixToCurrentOs(file.relativePath));
    copyFileAtomic(sourcePath, destinationPath);
  });

  const mirrorDbDumpPath = getMirrorFilePath(mirrorPath, 'database/database-dump.json');
  const dump = readJsonFile(mirrorDbDumpPath, null);
  if (!dump?.tables) {
    throw new Error('La copia espejo de la base de datos no es válida.');
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  restoreDatabase(dump);
};

const persistMirrorSyncState = (mirrorPath, state) => {
  const { syncStatePath } = ensureMirrorStructure(mirrorPath);
  writeJsonAtomic(syncStatePath, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
};

const getSyncEntityCounts = () => {
  const safeCount = (table) => {
    try {
      return Number(db.prepare(`SELECT COUNT(*) as total FROM "${table}"`).get()?.total || 0);
    } catch {
      return 0;
    }
  };

  return {
    programaciones: safeCount('programacion_anual'),
    unidades: safeCount('unidades_didacticas'),
    sesiones: safeCount('sesiones'),
    estudiantes: safeCount('db_estudiantes'),
    egresados: safeCount('db_egresados'),
    asistencias: safeCount('asistencia_registros'),
    rostros: safeCount('asistencia_rostros'),
  };
};

const getSyncEntityCountsFromDump = (dump) => ({
  programaciones: Array.isArray(dump?.tables?.programacion_anual) ? dump.tables.programacion_anual.length : 0,
  unidades: Array.isArray(dump?.tables?.unidades_didacticas) ? dump.tables.unidades_didacticas.length : 0,
  sesiones: Array.isArray(dump?.tables?.sesiones) ? dump.tables.sesiones.length : 0,
  estudiantes: Array.isArray(dump?.tables?.db_estudiantes) ? dump.tables.db_estudiantes.length : 0,
  egresados: Array.isArray(dump?.tables?.db_egresados) ? dump.tables.db_egresados.length : 0,
  asistencias: Array.isArray(dump?.tables?.asistencia_registros) ? dump.tables.asistencia_registros.length : 0,
  rostros: Array.isArray(dump?.tables?.asistencia_rostros) ? dump.tables.asistencia_rostros.length : 0,
});

const normalizeArtifactKind = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'conflict' ? 'conflict' : normalized === 'current' ? 'current' : 'version';
};

const fetchCloudArtifact = async ({ artifactId = '', artifactKind = 'version' } = {}) => {
  const config = readConfig();
  if (config.mode !== 'apps_script_drive') {
    return { success: false, message: 'Esta funcion solo esta disponible cuando la sincronizacion por Drive esta activada.' };
  }

  const response = await postAppsScript({
    action: 'sync_pull_artifact',
    syncUserKey: sanitizeUserScope(config.syncUserKey),
    syncUserLabel: normalizeUserLabel(config.syncUserLabel),
    artifactId: String(artifactId || '').trim(),
    artifactKind: normalizeArtifactKind(artifactKind),
  }, 240000);

  if (!response.success) {
    return { success: false, message: response.message || 'No se pudo descargar la copia seleccionada desde Drive.' };
  }

  return { success: true, data: response.data || null };
};

const mergeAttendanceTablesFromDump = (dump) => {
  const attendanceRows = Array.isArray(dump?.tables?.asistencia_registros) ? dump.tables.asistencia_registros : [];
  const faceRows = Array.isArray(dump?.tables?.asistencia_rostros) ? dump.tables.asistencia_rostros : [];
  let insertedAttendance = 0;
  let updatedAttendance = 0;
  let insertedFaces = 0;

  const compareTimestamps = (left, right) => {
    const leftTime = Date.parse(String(left || '')) || 0;
    const rightTime = Date.parse(String(right || '')) || 0;
    return leftTime - rightTime;
  };

  const transaction = db.transaction(() => {
    const selectAttendance = db.prepare(`
      SELECT * FROM asistencia_registros
      WHERE attendance_date = ? AND grade = ? AND section = ? AND student_id = ?
      LIMIT 1
    `);
    const insertAttendance = db.prepare(`
      INSERT INTO asistencia_registros (
        attendance_date, grade, section, student_id, student_name, dni, status, marked_at, source, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateAttendance = db.prepare(`
      UPDATE asistencia_registros
      SET student_name = ?, dni = ?, status = ?, marked_at = ?, source = ?, notes = ?, updated_at = ?
      WHERE attendance_date = ? AND grade = ? AND section = ? AND student_id = ?
    `);
    const selectFace = db.prepare(`
      SELECT id FROM asistencia_rostros
      WHERE student_id = ? AND grade = ? AND section = ? AND descriptor = ? AND source = ?
      LIMIT 1
    `);
    const insertFace = db.prepare(`
      INSERT INTO asistencia_rostros (
        student_id, student_name, grade, section, image_data, descriptor, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    attendanceRows.forEach((row) => {
      const key = [
        row?.attendance_date ?? '',
        row?.grade ?? '',
        row?.section ?? '',
        row?.student_id ?? '',
      ].map((item) => String(item || '').trim());
      if (key.some((item) => !item)) return;

      const existing = selectAttendance.get(...key);
      const incomingUpdatedAt = row?.updated_at || row?.marked_at || '';
      if (!existing) {
        insertAttendance.run(
          key[0],
          key[1],
          key[2],
          key[3],
          row?.student_name ?? '',
          row?.dni ?? '',
          row?.status ?? 'P',
          row?.marked_at || incomingUpdatedAt || new Date().toISOString(),
          row?.source ?? 'cloud_merge',
          row?.notes ?? '',
          incomingUpdatedAt || new Date().toISOString(),
        );
        insertedAttendance += 1;
        return;
      }

      const existingUpdatedAt = existing.updated_at || existing.marked_at || '';
      if (compareTimestamps(incomingUpdatedAt, existingUpdatedAt) > 0) {
        updateAttendance.run(
          row?.student_name ?? existing.student_name ?? '',
          row?.dni ?? existing.dni ?? '',
          row?.status ?? existing.status ?? 'P',
          row?.marked_at || incomingUpdatedAt || existing.marked_at || new Date().toISOString(),
          row?.source ?? existing.source ?? 'cloud_merge',
          row?.notes ?? existing.notes ?? '',
          incomingUpdatedAt || new Date().toISOString(),
          key[0],
          key[1],
          key[2],
          key[3],
        );
        updatedAttendance += 1;
      }
    });

    faceRows.forEach((row) => {
      const studentId = String(row?.student_id || '').trim();
      const grade = String(row?.grade || '').trim();
      const section = String(row?.section || '').trim();
      const descriptor = String(row?.descriptor || '').trim();
      const source = String(row?.source || 'cloud_merge').trim() || 'cloud_merge';
      if (!studentId || !grade || !section || !descriptor) return;
      const exists = selectFace.get(studentId, grade, section, descriptor, source);
      if (exists?.id) return;
      insertFace.run(
        studentId,
        row?.student_name ?? '',
        grade,
        section,
        row?.image_data ?? '',
        descriptor,
        source,
        row?.created_at || row?.updated_at || new Date().toISOString(),
        row?.updated_at || row?.created_at || new Date().toISOString(),
      );
      insertedFaces += 1;
    });
  });

  transaction();

  return {
    attendance: {
      inserted: insertedAttendance,
      updated: updatedAttendance,
    },
    faces: {
      inserted: insertedFaces,
    },
  };
};

const buildStudentIdentityKey = (row = {}, scope = 'student') => {
  const dni = String(row?.dni || '').trim();
  if (dni) return `${scope}:dni:${dni}`;
  const nivel = String(row?.nivel || '').trim().toLowerCase();
  const name = String(row?.estudiantes || row?.student_name || row?.name || '').trim().toLowerCase();
  const grade = String(row?.grado || row?.grade || '').trim().toLowerCase();
  const section = String(row?.secc || row?.section || '').trim().toLowerCase();
  return `${scope}:fallback:${nivel}|${name}|${grade}|${section}`;
};

const mergeStudentsTablesFromDump = (dump) => {
  const studentRows = Array.isArray(dump?.tables?.db_estudiantes) ? dump.tables.db_estudiantes : [];
  const graduateRows = Array.isArray(dump?.tables?.db_egresados) ? dump.tables.db_egresados : [];
  let insertedStudents = 0;
  let updatedStudents = 0;
  let insertedGraduates = 0;
  let updatedGraduates = 0;
  let promotedToGraduate = 0;

  const compareTimestamps = (left, right) => {
    const leftTime = Date.parse(String(left || '')) || 0;
    const rightTime = Date.parse(String(right || '')) || 0;
    return leftTime - rightTime;
  };

  const existingStudents = db.prepare('SELECT * FROM db_estudiantes').all();
  const existingGraduates = db.prepare('SELECT * FROM db_egresados').all();
  const studentKeyMap = new Map(existingStudents.map((row) => [buildStudentIdentityKey(row, 'student'), row]));
  const graduateKeyMap = new Map(existingGraduates.map((row) => [buildStudentIdentityKey(row, 'graduate'), row]));
  const graduateByDni = new Map(existingGraduates.filter((row) => String(row?.dni || '').trim()).map((row) => [String(row.dni).trim(), row]));

  const transaction = db.transaction(() => {
    const insertStudent = db.prepare(`
      INSERT INTO db_estudiantes (
        nivel, dni, estudiantes, grado, secc, gmail, outlook, estado, grupo, sexo, edad, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStudent = db.prepare(`
      UPDATE db_estudiantes
      SET nivel = ?, dni = ?, estudiantes = ?, grado = ?, secc = ?, gmail = ?, outlook = ?, estado = ?, grupo = ?, sexo = ?, edad = ?, updated_at = ?
      WHERE id = ?
    `);
    const deleteStudent = db.prepare('DELETE FROM db_estudiantes WHERE id = ?');
    const insertGraduate = db.prepare(`
      INSERT INTO db_egresados (
        estudiante_id_origen, nivel, dni, estudiantes, grado, secc, gmail, outlook, estado, grupo, sexo, edad, egresado_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateGraduate = db.prepare(`
      UPDATE db_egresados
      SET estudiante_id_origen = ?, nivel = ?, dni = ?, estudiantes = ?, grado = ?, secc = ?, gmail = ?, outlook = ?, estado = ?, grupo = ?, sexo = ?, edad = ?, egresado_at = ?
      WHERE id = ?
    `);

    studentRows.forEach((row) => {
      const key = buildStudentIdentityKey(row, 'student');
      const incomingUpdatedAt = row?.updated_at || new Date().toISOString();
      const existingGraduateSameDni = String(row?.dni || '').trim() ? graduateByDni.get(String(row.dni).trim()) : null;
      if (existingGraduateSameDni && compareTimestamps(existingGraduateSameDni.egresado_at, incomingUpdatedAt) >= 0) {
        return;
      }

      const existing = studentKeyMap.get(key);
      if (!existing) {
        insertStudent.run(
          row?.nivel ?? '',
          row?.dni ?? '',
          row?.estudiantes ?? '',
          row?.grado ?? '',
          row?.secc ?? '',
          row?.gmail ?? '',
          row?.outlook ?? '',
          row?.estado ?? 'A',
          row?.grupo ?? '',
          row?.sexo ?? '',
          row?.edad ?? null,
          incomingUpdatedAt,
        );
        insertedStudents += 1;
        return;
      }

      const existingUpdatedAt = existing.updated_at || '';
      if (compareTimestamps(incomingUpdatedAt, existingUpdatedAt) > 0) {
        updateStudent.run(
          row?.nivel ?? existing.nivel ?? '',
          row?.dni ?? existing.dni ?? '',
          row?.estudiantes ?? existing.estudiantes ?? '',
          row?.grado ?? existing.grado ?? '',
          row?.secc ?? existing.secc ?? '',
          row?.gmail ?? existing.gmail ?? '',
          row?.outlook ?? existing.outlook ?? '',
          row?.estado ?? existing.estado ?? 'A',
          row?.grupo ?? existing.grupo ?? '',
          row?.sexo ?? existing.sexo ?? '',
          row?.edad ?? existing.edad ?? null,
          incomingUpdatedAt,
          existing.id,
        );
        updatedStudents += 1;
      }
    });

    graduateRows.forEach((row) => {
      const key = buildStudentIdentityKey(row, 'graduate');
      const incomingGraduateAt = row?.egresado_at || new Date().toISOString();
      const existingGraduate = graduateKeyMap.get(key);
      if (!existingGraduate) {
        insertGraduate.run(
          row?.estudiante_id_origen ?? '',
          row?.nivel ?? '',
          row?.dni ?? '',
          row?.estudiantes ?? '',
          row?.grado ?? '',
          row?.secc ?? '',
          row?.gmail ?? '',
          row?.outlook ?? '',
          row?.estado ?? '',
          row?.grupo ?? '',
          row?.sexo ?? '',
          row?.edad ?? null,
          incomingGraduateAt,
        );
        insertedGraduates += 1;
      } else if (compareTimestamps(incomingGraduateAt, existingGraduate.egresado_at) > 0) {
        updateGraduate.run(
          row?.estudiante_id_origen ?? existingGraduate.estudiante_id_origen ?? '',
          row?.nivel ?? existingGraduate.nivel ?? '',
          row?.dni ?? existingGraduate.dni ?? '',
          row?.estudiantes ?? existingGraduate.estudiantes ?? '',
          row?.grado ?? existingGraduate.grado ?? '',
          row?.secc ?? existingGraduate.secc ?? '',
          row?.gmail ?? existingGraduate.gmail ?? '',
          row?.outlook ?? existingGraduate.outlook ?? '',
          row?.estado ?? existingGraduate.estado ?? '',
          row?.grupo ?? existingGraduate.grupo ?? '',
          row?.sexo ?? existingGraduate.sexo ?? '',
          row?.edad ?? existingGraduate.edad ?? null,
          incomingGraduateAt,
          existingGraduate.id,
        );
        updatedGraduates += 1;
      }

      const remoteDni = String(row?.dni || '').trim();
      if (remoteDni) {
        const localStudent = db.prepare('SELECT * FROM db_estudiantes WHERE dni = ? LIMIT 1').get(remoteDni);
        if (localStudent) {
          const localStudentUpdatedAt = localStudent.updated_at || '';
          if (compareTimestamps(incomingGraduateAt, localStudentUpdatedAt) >= 0) {
            deleteStudent.run(localStudent.id);
            promotedToGraduate += 1;
          }
        }
      }
    });
  });

  transaction();

  return {
    students: {
      inserted: insertedStudents,
      updated: updatedStudents,
    },
    graduates: {
      inserted: insertedGraduates,
      updated: updatedGraduates,
      promoted: promotedToGraduate,
    },
  };
};

const detectDestructiveCountRegression = (localCounts, remoteCounts) => {
  const regressions = ['programaciones', 'unidades', 'sesiones', 'asistencias', 'rostros']
    .map((key) => ({
      key,
      local: Number(localCounts?.[key] || 0),
      remote: Number(remoteCounts?.[key] || 0),
    }))
    .filter((item) => item.remote < item.local && item.local > 0);

  return {
    blocked: regressions.length > 0,
    regressions,
  };
};

export const getSyncStatus = async () => {
  const config = readConfig();
  const resolvedMirror = resolveEffectiveMirrorPath(config);
  const localManifest = buildLocalManifest();
  const savedManifest = readJsonFile(localManifestPath, null);
  const driveCandidates = detectGoogleDriveCandidates(config.syncUserKey);
  const remoteState = readJsonFile(remoteSyncStatePath, {});
  let mirrorManifest = config.mode === 'drive_mirror' && resolvedMirror.mirrorPath
    ? readMirrorManifest(resolvedMirror.mirrorPath)
    : null;
  let remoteUser = null;
  let remoteActivity = null;
  if (config.mode === 'apps_script_drive') {
    const remoteStatus = await postAppsScript({
      action: 'sync_status',
      syncUserKey: sanitizeUserScope(config.syncUserKey),
      syncUserLabel: normalizeUserLabel(config.syncUserLabel),
    }, 45000);
    if (remoteStatus.success) {
      mirrorManifest = remoteStatus.data?.manifest || null;
      remoteUser = remoteStatus.data?.user || null;
      remoteActivity = remoteStatus.data?.activity || null;
    }
  }
  const integrity = config.mode === 'drive_mirror' && resolvedMirror.mirrorPath
    ? verifyMirrorIntegrity(resolvedMirror.mirrorPath, mirrorManifest)
    : { ok: true, code: 'not-applicable', missingFiles: [] };

  return {
    success: true,
    data: {
      config: {
        ...config,
        syncUserKey: sanitizeUserScope(config.syncUserKey),
        syncUserLabel: normalizeUserLabel(config.syncUserLabel),
        resolvedMirrorPath: resolvedMirror.mirrorPath,
        mirrorPathDerivedAutomatically: resolvedMirror.derivedAutomatically,
        remoteProvider: config.mode === 'apps_script_drive' ? REMOTE_PROVIDER : null,
        remoteUser,
        remoteActivity,
        lastCloudVersion: remoteState.lastCloudVersion || '',
      },
      localManifest,
      savedManifest,
      mirrorManifest,
      comparison: integrity.ok ? compareManifests(localManifest, mirrorManifest, config.mode) : integrity.code,
      lastFrontendStateAt: readJsonFile(frontendStatePath, null)?.exportedAt || null,
      driveDesktop: {
        detected: driveCandidates.length > 0,
        candidates: driveCandidates,
      },
      safety: {
        restorePointsPath: snapshotsFolder,
        retention: SAFETY_RETENTION,
        missingMirrorFiles: integrity.missingFiles,
      },
    },
  };
};

export const updateSyncConfig = async (payload = {}) => {
  const mode = payload.mode === 'drive_mirror'
    ? 'drive_mirror'
    : payload.mode === 'apps_script_drive'
      ? 'apps_script_drive'
      : 'local';
  const syncUserKey = sanitizeUserScope(payload.syncUserKey);
  const syncUserLabel = normalizeUserLabel(payload.syncUserLabel || payload.syncUserKey);
  const mirrorPath = typeof payload.mirrorPath === 'string' ? payload.mirrorPath.trim() : '';
  const autoSyncOnClose = payload.autoSyncOnClose !== false;
  const resolvedMirror = resolveEffectiveMirrorPath({ mirrorPath, syncUserKey });

  if (mode === 'drive_mirror' && !resolvedMirror.mirrorPath) {
    return { success: false, message: 'No pude detectar Google Drive en esta computadora para crear la carpeta espejo del usuario.' };
  }

  let remoteUser = null;
  if (mode === 'apps_script_drive') {
    const prepared = await postAppsScript({
      action: 'sync_prepare_user',
      syncUserKey,
      syncUserLabel,
    }, 45000);
    if (!prepared.success) {
      return { success: false, message: prepared.message || 'No pude preparar la carpeta del usuario en Drive.' };
    }
    remoteUser = prepared.data || null;
  }

  const nextConfig = saveConfig({
    mode,
    mirrorPath: mode === 'drive_mirror' ? resolvedMirror.mirrorPath : '',
    autoSyncOnClose,
    syncUserKey,
    syncUserLabel,
  });

  if (nextConfig.mode === 'drive_mirror') {
    ensureMirrorStructure(nextConfig.mirrorPath);
  }

  return {
    success: true,
    data: {
      ...nextConfig,
      resolvedMirrorPath: nextConfig.mirrorPath,
      mirrorPathDerivedAutomatically: resolvedMirror.derivedAutomatically,
      remoteUser,
    },
  };
};

export const pushToCloud = async () => {
  const config = readConfig();
  const effectiveMirror = resolveEffectiveMirrorPath(config);
  const restorePoint = createLocalRestorePoint();
  stageLocalDatabaseDump();
  const manifest = buildManifestFromFiles(serializeLocalFiles(), 'local-app-storage', config.mode);
  const localCounts = getSyncEntityCounts();
  writeJsonAtomic(localManifestPath, manifest);

  if (config.mode === 'apps_script_drive') {
    const remoteState = readJsonFile(remoteSyncStatePath, {});
    if (remoteState.lastCloudDigest && remoteState.lastCloudDigest === manifest.digest) {
      return {
        success: true,
        data: {
          manifest,
          mode: config.mode,
          restorePoint,
          skippedUpload: true,
          reason: 'same-digest',
          message: 'No hubo cambios nuevos para subir a Drive.',
        },
      };
    }
    const packageBase64 = buildSyncPackageBase64(manifest);
    const response = await postAppsScript({
      action: 'sync_push',
      syncUserKey: sanitizeUserScope(config.syncUserKey),
      syncUserLabel: normalizeUserLabel(config.syncUserLabel),
      deviceId: getDeviceId(),
      baseCloudVersion: remoteState.lastCloudVersion || '',
      manifest,
      packageBase64,
    }, 240000);

    if (!response.success) {
      return {
        success: false,
        message: response.message || 'No se pudo subir la copia a Drive.',
        conflict: response.conflict === true,
        data: response.data || null,
      };
    }

    const cloudManifest = response.data?.manifest || manifest;
    if (String(cloudManifest?.digest || '') !== String(manifest.digest || '')) {
      return {
        success: false,
        message: 'Drive no confirmó la misma copia que se intentó subir. La nube parece haberse quedado con una versión anterior.',
        data: {
          localDigest: manifest.digest,
          remoteDigest: cloudManifest?.digest || '',
          localCounts,
          restorePoint,
          remoteUser: response.data?.user || null,
        },
      };
    }
    writeJsonAtomic(remoteSyncStatePath, {
      lastCloudVersion: cloudManifest.cloudVersion || '',
      lastCloudDigest: cloudManifest.digest || '',
      lastPushAt: new Date().toISOString(),
      syncUserKey: sanitizeUserScope(config.syncUserKey),
      provider: REMOTE_PROVIDER,
    });
    writeJsonAtomic(localManifestPath, cloudManifest);
    return {
      success: true,
      data: {
        manifest: cloudManifest,
        mode: config.mode,
        counts: localCounts,
        restorePoint,
        remoteUser: response.data?.user || null,
      },
    };
  }

  if (config.mode !== 'drive_mirror') {
    return {
      success: true,
      data: {
        manifest,
        mode: config.mode,
        message: 'El aplicativo quedó en modo solo local. No se subieron datos a Google Drive.',
      },
    };
  }

  if (!effectiveMirror.mirrorPath) {
    return { success: false, message: 'La carpeta espejo de Google Drive no está configurada.' };
  }

  const previousMirrorManifest = readMirrorManifest(effectiveMirror.mirrorPath);
  const integrity = previousMirrorManifest ? verifyMirrorIntegrity(effectiveMirror.mirrorPath, previousMirrorManifest) : { ok: true };
  if (!integrity.ok && integrity.code === 'mirror-incomplete') {
    return {
      success: false,
      message: 'La carpeta espejo está incompleta o alguien borró archivos manualmente. No subiré cambios hasta que revisemos esa copia para no perder información.',
      data: { missingFiles: integrity.missingFiles },
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  ensureMirrorStructure(effectiveMirror.mirrorPath);
  backupMirrorManifest(effectiveMirror.mirrorPath, previousMirrorManifest);

  manifest.files.forEach((file) => {
    copyFileAtomic(file.absolutePath, getMirrorFilePath(effectiveMirror.mirrorPath, file.relativePath));
  });

  const previousPaths = new Set((previousMirrorManifest?.files || []).map((file) => file.relativePath));
  const currentPaths = new Set(manifest.files.map((file) => file.relativePath));
  const removedPaths = Array.from(previousPaths).filter((relativePath) => !currentPaths.has(relativePath));
  moveMirrorFilesToTrash(effectiveMirror.mirrorPath, removedPaths, stamp);

  const mirrorManifest = {
    ...manifest,
    provider: 'google-drive-desktop-mirror',
    storageMode: 'drive_mirror',
    generatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(getMirrorMetaPaths(effectiveMirror.mirrorPath).manifestPath, mirrorManifest);
  persistMirrorSyncState(effectiveMirror.mirrorPath, {
    lastPushAt: mirrorManifest.generatedAt,
    lastOperation: 'push',
    localDigest: manifest.digest,
    syncUserKey: sanitizeUserScope(config.syncUserKey),
  });

  return {
    success: true,
      data: {
        manifest: mirrorManifest,
        mode: config.mode,
        counts: localCounts,
        restorePoint,
        removedPathsMovedToTrash: removedPaths,
      },
  };
};

export const pullFromCloud = async (payload = {}) => {
  const force = payload?.force === true;
  const config = readConfig();
  const effectiveMirror = resolveEffectiveMirrorPath(config);
  if (config.mode === 'apps_script_drive') {
    const response = await postAppsScript({
      action: 'sync_pull',
      syncUserKey: sanitizeUserScope(config.syncUserKey),
      syncUserLabel: normalizeUserLabel(config.syncUserLabel),
    }, 240000);

    if (!response.success) {
      return { success: false, message: response.message || 'No se pudo descargar la copia desde Drive.' };
    }

    const localCountsBeforePull = getSyncEntityCounts();
    const restoreRoot = createLocalRestorePoint();
    const extractRoot = path.join(runtimeFolder, 'remote-download', new Date().toISOString().replace(/[:.]/g, '-'));
    const extractedManifest = extractSyncPackageToFolder(response.data?.packageBase64, extractRoot);
    const remoteManifest = response.data?.manifest || extractedManifest;
    if (!remoteManifest?.files) {
      return { success: false, message: 'La copia remota no contiene un manifiesto valido.' };
    }

    const remoteDump = readJsonFile(getExtractedFilePath(extractRoot, 'database/database-dump.json'), null);
    const remoteCounts = getSyncEntityCountsFromDump(remoteDump);
    const regressionCheck = detectDestructiveCountRegression(localCountsBeforePull, remoteCounts);
    if (regressionCheck.blocked && !force) {
      return {
        success: false,
        message: 'La copia de Drive tiene menos registros que tu copia local en Programaciones, Unidades, Sesiones o Asistencia. Se bloqueo la descarga para proteger tu trabajo.',
        data: {
          localCounts: localCountsBeforePull,
          remoteCounts,
          regressions: regressionCheck.regressions,
          restorePoint: restoreRoot,
          remoteUser: response.data?.user || null,
        },
      };
    }

    applyExtractedPackageToLocal(extractRoot, remoteManifest, restoreRoot);
    writeJsonAtomic(localManifestPath, remoteManifest);
    writeJsonAtomic(remoteSyncStatePath, {
      lastCloudVersion: remoteManifest.cloudVersion || '',
      lastCloudDigest: remoteManifest.digest || '',
      lastPullAt: new Date().toISOString(),
      syncUserKey: sanitizeUserScope(config.syncUserKey),
      provider: REMOTE_PROVIDER,
    });

    return {
      success: true,
      data: {
        manifest: remoteManifest,
        counts: getSyncEntityCounts(),
        frontendState: readJsonFile(frontendStatePath, { keys: {} }),
        restorePoint: restoreRoot,
        remoteUser: response.data?.user || null,
      },
    };
  }

  if (config.mode !== 'drive_mirror') {
    return { success: false, message: 'El aplicativo está en modo solo local.' };
  }
  if (!effectiveMirror.mirrorPath) {
    return { success: false, message: 'La carpeta espejo de Google Drive no está configurada.' };
  }

  const mirrorManifest = readMirrorManifest(effectiveMirror.mirrorPath);
  const integrity = verifyMirrorIntegrity(effectiveMirror.mirrorPath, mirrorManifest);
  if (!integrity.ok) {
    return {
      success: false,
      message: integrity.code === 'missing-manifest'
        ? 'La carpeta espejo todavía no tiene una copia válida.'
        : 'La carpeta espejo está incompleta. Faltan archivos y no aplicaré una descarga que pueda sobrescribir datos sanos.',
      data: { missingFiles: integrity.missingFiles },
    };
  }

  const localCountsBeforePull = getSyncEntityCounts();
  const restoreRoot = createLocalRestorePoint();
  const mirrorDump = readJsonFile(getMirrorFilePath(effectiveMirror.mirrorPath, 'database/database-dump.json'), null);
  const remoteCounts = getSyncEntityCountsFromDump(mirrorDump);
  const regressionCheck = detectDestructiveCountRegression(localCountsBeforePull, remoteCounts);
  if (regressionCheck.blocked && !force) {
    return {
      success: false,
      message: 'La copia de Drive tiene menos registros que tu copia local en Programaciones, Unidades, Sesiones o Asistencia. Se bloqueo la descarga para proteger tu trabajo.',
      data: {
        localCounts: localCountsBeforePull,
        remoteCounts,
        regressions: regressionCheck.regressions,
        restorePoint: restoreRoot,
      },
    };
  }
  applyMirrorToLocal(effectiveMirror.mirrorPath, mirrorManifest, restoreRoot);
  writeJsonAtomic(localManifestPath, mirrorManifest);
  persistMirrorSyncState(effectiveMirror.mirrorPath, {
    lastPullAt: new Date().toISOString(),
    lastOperation: 'pull',
    localRestorePoint: restoreRoot,
    mirrorDigest: mirrorManifest.digest,
    syncUserKey: sanitizeUserScope(config.syncUserKey),
  });

  return {
    success: true,
    data: {
      manifest: mirrorManifest,
      counts: getSyncEntityCounts(),
      frontendState: readJsonFile(frontendStatePath, { keys: {} }),
      restorePoint: restoreRoot,
    },
  };
};

export const pullCloudArtifact = async (payload = {}) => {
  const artifactId = String(payload.artifactId || '').trim();
  const artifactKind = normalizeArtifactKind(payload.artifactKind);
  if (artifactKind !== 'current' && !artifactId) {
    return { success: false, message: 'Falta indicar la copia que deseas descargar.' };
  }

  const response = await fetchCloudArtifact({ artifactId, artifactKind });
  if (!response.success) return response;

  const runtimeExtractRoot = path.join(runtimeFolder, 'artifact-download', `${artifactKind}-${artifactId || 'current'}-${Date.now()}`);
  try {
    const extracted = extractDatabaseDumpFromPackageBase64(response.data?.packageBase64, runtimeExtractRoot);
    return {
      success: true,
      data: {
        artifactId,
        artifactKind,
        manifest: response.data?.manifest || extracted.manifest || null,
        counts: getSyncEntityCountsFromDump(extracted.dump),
        packageBase64: response.data?.packageBase64 || '',
      },
    };
  } catch (error) {
    return { success: false, message: error?.message || 'No se pudo preparar la copia seleccionada.' };
  }
};

export const applyCloudArtifact = async (payload = {}) => {
  const artifactId = String(payload.artifactId || '').trim();
  const artifactKind = normalizeArtifactKind(payload.artifactKind);
  if (artifactKind !== 'current' && !artifactId) {
    return { success: false, message: 'Falta indicar la copia que deseas cargar.' };
  }

  const response = await fetchCloudArtifact({ artifactId, artifactKind });
  if (!response.success) return response;

  const restoreRoot = createLocalRestorePoint();
  const extractRoot = path.join(runtimeFolder, 'artifact-apply', `${artifactKind}-${artifactId || 'current'}-${Date.now()}`);

  try {
    const extractedManifest = extractSyncPackageToFolder(response.data?.packageBase64, extractRoot);
    const remoteManifest = response.data?.manifest || extractedManifest;
    if (!remoteManifest?.files) {
      return { success: false, message: 'La copia seleccionada no contiene un manifiesto valido.' };
    }
    applyExtractedPackageToLocal(extractRoot, remoteManifest, restoreRoot);
    writeJsonAtomic(localManifestPath, remoteManifest);
    return {
      success: true,
      data: {
        artifactId,
        artifactKind,
        manifest: remoteManifest,
        counts: getSyncEntityCounts(),
        frontendState: readJsonFile(frontendStatePath, { keys: {} }),
        restorePoint: restoreRoot,
      },
    };
  } catch (error) {
    return { success: false, message: error?.message || 'No se pudo aplicar la copia seleccionada.' };
  }
};

export const mergeAttendanceFromCloudArtifact = async (payload = {}) => {
  const artifactId = String(payload.artifactId || '').trim();
  const artifactKind = normalizeArtifactKind(payload.artifactKind);
  if (artifactKind !== 'current' && !artifactId) {
    return { success: false, message: 'Falta indicar la copia que deseas fusionar.' };
  }

  const response = await fetchCloudArtifact({ artifactId, artifactKind });
  if (!response.success) return response;

  const restoreRoot = createLocalRestorePoint();
  const extractRoot = path.join(runtimeFolder, 'artifact-merge', `${artifactKind}-${artifactId || 'current'}-${Date.now()}`);

  try {
    const { manifest, dump } = extractDatabaseDumpFromPackageBase64(response.data?.packageBase64, extractRoot);
    const mergeStats = mergeAttendanceTablesFromDump(dump);
    return {
      success: true,
      data: {
        artifactId,
        artifactKind,
        manifest: response.data?.manifest || manifest || null,
        mergeStats,
        counts: getSyncEntityCounts(),
        restorePoint: restoreRoot,
      },
      message: 'La asistencia se fusiono correctamente con la copia seleccionada.',
    };
  } catch (error) {
    return { success: false, message: error?.message || 'No se pudo fusionar la asistencia de la copia seleccionada.' };
  }
};

export const mergeStudentsFromCloudArtifact = async (payload = {}) => {
  const artifactId = String(payload.artifactId || '').trim();
  const artifactKind = normalizeArtifactKind(payload.artifactKind);
  if (artifactKind !== 'current' && !artifactId) {
    return { success: false, message: 'Falta indicar la copia que deseas fusionar.' };
  }

  const response = await fetchCloudArtifact({ artifactId, artifactKind });
  if (!response.success) return response;

  const restoreRoot = createLocalRestorePoint();
  const extractRoot = path.join(runtimeFolder, 'artifact-merge-students', `${artifactKind}-${artifactId || 'current'}-${Date.now()}`);

  try {
    const { manifest, dump } = extractDatabaseDumpFromPackageBase64(response.data?.packageBase64, extractRoot);
    const mergeStats = mergeStudentsTablesFromDump(dump);
    return {
      success: true,
      data: {
        artifactId,
        artifactKind,
        manifest: response.data?.manifest || manifest || null,
        mergeStats,
        counts: getSyncEntityCounts(),
        restorePoint: restoreRoot,
      },
      message: 'Los estudiantes se fusionaron correctamente con la copia seleccionada.',
    };
  } catch (error) {
    return { success: false, message: error?.message || 'No se pudo fusionar la lista de estudiantes de la copia seleccionada.' };
  }
};

export { saveFrontendStateSnapshot };
