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
  stageLocalDatabaseDump();
  const manifest = buildManifestFromFiles(serializeLocalFiles(), 'local-app-storage', config.mode);
  writeJsonAtomic(localManifestPath, manifest);

  if (config.mode === 'apps_script_drive') {
    const remoteState = readJsonFile(remoteSyncStatePath, {});
    if (remoteState.lastCloudDigest && remoteState.lastCloudDigest === manifest.digest) {
      return {
        success: true,
        data: {
          manifest,
          mode: config.mode,
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
      removedPathsMovedToTrash: removedPaths,
    },
  };
};

export const pullFromCloud = async () => {
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

    const restoreRoot = createLocalRestorePoint();
    const extractRoot = path.join(runtimeFolder, 'remote-download', new Date().toISOString().replace(/[:.]/g, '-'));
    const extractedManifest = extractSyncPackageToFolder(response.data?.packageBase64, extractRoot);
    const remoteManifest = response.data?.manifest || extractedManifest;
    if (!remoteManifest?.files) {
      return { success: false, message: 'La copia remota no contiene un manifiesto valido.' };
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

  const restoreRoot = createLocalRestorePoint();
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
      frontendState: readJsonFile(frontendStatePath, { keys: {} }),
      restorePoint: restoreRoot,
    },
  };
};

export { saveFrontendStateSnapshot };
