import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { createDriveDesktopLauncher } from './driveDesktopLauncher.js';
import { createContinuousSyncQueue } from './continuousSyncQueue.js';
import { createFrontendStateStore } from './frontendStateStore.js';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';
import PizZip from 'pizzip';
import Database from 'better-sqlite3';
import db, { dumpDatabase, restoreDatabase, SYNC_EXCLUDED_TABLES, getSyncChangeSignature } from './db.js';
import { listEvidenceTombstoneKeys, portableEvidenceKey, reconcileEvidenceMirrorIndex } from './evidenceMirrorIndex.js';
import { appRoot, dataRoot, databaseRoot, uploadsRoot, syncRuntimeRoot, ensureDir } from './paths.js';
import { createIncrementalMirrorSync } from './incrementalMirrorSync.js';
import { createDumpReferenceTranslator, createSyncReferenceIdentity } from './syncReferenceIdentity.js';
import { readMirrorJson as readMirrorJsonAsync, readMirrorJsonResult } from './mirrorJsonReader.js';
import { createInternetConnectivityMonitor } from './internetConnectivity.js';
import { createTransferProgress } from './transferProgress.js';
import { createResourceConflictStore, resourceChecksum } from './resourceConflicts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;
const runtimeFolder = syncRuntimeRoot;
const stateFolder = path.join(runtimeFolder, 'state');
const snapshotsFolder = path.join(runtimeFolder, 'restore-points');
const dbDumpPath = path.join(runtimeFolder, 'database-dump.json');
const frontendStatePath = path.join(stateFolder, 'frontend-local-storage.json');
const resourceConflicts = createResourceConflictStore(path.join(runtimeFolder, 'resource-conflicts'));
let resourceResolutionRunning = false;
export const listResourceConflicts = () => resourceConflicts.list();
export const getResourceConflictSnapshot = (id, version) => resourceConflicts.snapshot(id, version);
export const resolveResourceConflict = async (id, version) => {
  if (continuousMirrorTickRunning || resourceResolutionRunning) throw new Error('Espera a que termine la revisión de archivos e inténtalo otra vez.');
  resourceResolutionRunning = true;
  try {
    const result = await resourceConflicts.resolve(id, version,
      (source, destination, checksum) => copyFileAtomicStreaming(source, destination, () => {}, { checksum }));
    continuousMirrorSyncedResourceSignature = '';
    requestContinuousMirrorSync({ delayMs: 250 });
    return result;
  } finally { resourceResolutionRunning = false; }
};
const localManifestPath = path.join(runtimeFolder, 'local-manifest.json');
const configPath = path.join(runtimeFolder, 'sync-config.json');
const authSettingsPath = path.join(runtimeFolder, 'auth-settings.json');
const bundledAuthSettingsPath = path.join(appRoot, 'sync-runtime', 'auth-settings.json');
const remoteSyncStatePath = path.join(runtimeFolder, 'remote-sync-state.json');
const pendingLocalStatePath = path.join(runtimeFolder, 'pending-local-state.json');
const databaseStageStatePath = path.join(runtimeFolder, 'database-stage-state.json');
const expectedResourceCatalogPath = path.join(runtimeFolder, 'expected-mirror-resources.json');
const syncableDirectories = [
  { key: 'uploads', absolutePath: uploadsRoot },
];
const continuousResourceDirectories = [
  path.join(uploadsRoot, 'session-resources'),
  path.join(uploadsRoot, 'user-assets'),
];
const localOnlyUploadFolders = [path.resolve(uploadsRoot, 'student-chat-local')];
const isLocalOnlySyncRelativePath = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized === 'uploads/student-chat-local' || normalized.startsWith('uploads/student-chat-local/');
};
const DEFAULT_MIRROR_SUBFOLDER = 'ARMI Sync';
const DEFAULT_SYNC_USER_KEY = 'default-user';
const SAFETY_RETENTION = 3;
const REMOTE_PROVIDER = 'google-apps-script-drive';
const APPS_SCRIPT_CHUNK_BASE64_CHARS = 6 * 1024 * 1024;
const MIRROR_ROOT_MARKER = '.armi-sync-root.json';
const fileFingerprintCache = new Map();
const activeResourceTransfers = new Map();
const downloadProgress = createTransferProgress();
let receivedChanges = null;
let activeMirrorTransfer = null;

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

const stableJsonValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((acc, key) => {
        acc[key] = stableJsonValue(value[key]);
        return acc;
      }, {});
  }
  return value;
};

const buildStableSyncFingerprint = (targetPath, scope, relativePath) => {
  if (scope === 'frontend-state' || relativePath === 'state/frontend-local-storage.json') {
    const payload = readJsonFile(targetPath, null);
    const stable = JSON.stringify(stableJsonValue({
      keys: payload?.keys || {},
    }));
    return {
      checksum: crypto.createHash('sha256').update(stable).digest('hex'),
      size: Buffer.byteLength(stable, 'utf8'),
    };
  }

  const stats = safeStat(targetPath);
  const cacheKey = stats
    ? `${path.resolve(targetPath)}|${stats.size}|${stats.mtimeMs}`
    : '';
  if (cacheKey && fileFingerprintCache.has(cacheKey)) {
    return fileFingerprintCache.get(cacheKey);
  }
  const fingerprint = {
    checksum: hashFile(targetPath),
    size: stats?.size || 0,
  };
  if (cacheKey) fileFingerprintCache.set(cacheKey, fingerprint);
  return {
    ...fingerprint,
  };
};

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

const copyFileAtomicStreaming = (sourcePath, destinationPath, onProgress = () => {}, expected = {}) => new Promise((resolve, reject) => {
  ensureParentDir(destinationPath);
  const tempPath = `${destinationPath}.${process.pid}.${crypto.randomUUID()}.partial`;
  const totalBytes = Number(safeStat(sourcePath)?.size || 0);
  let copiedBytes = 0;
  const digest = expected.checksum ? crypto.createHash('sha256') : null;
  const input = fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 });
  const output = fs.createWriteStream(tempPath, { flags: 'wx' });
  const cleanup = () => {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
  };
  input.on('data', (chunk) => {
    digest?.update(chunk);
    copiedBytes += chunk.length;
    onProgress({ copiedBytes, totalBytes });
  });
  input.on('error', (error) => {
    output.destroy();
    cleanup();
    reject(error);
  });
  output.on('error', (error) => {
    input.destroy();
    cleanup();
    reject(error);
  });
  output.on('finish', () => {
    const previousPath = `${destinationPath}.${process.pid}.previous`;
    try {
      if ((digest && digest.digest('hex') !== expected.checksum)
        || (expected.size !== undefined && copiedBytes !== expected.size)) throw new Error('El archivo no coincide con la versión esperada. Se conserva la copia anterior.');
      if (pathExists(destinationPath)) fs.renameSync(destinationPath, previousPath);
      fs.renameSync(tempPath, destinationPath);
      try { fs.rmSync(previousPath, { force: true }); } catch {}
      onProgress({ copiedBytes: totalBytes, totalBytes });
      resolve();
    } catch (error) {
      if (!pathExists(destinationPath) && pathExists(previousPath)) {
        try { fs.renameSync(previousPath, destinationPath); } catch {}
      }
      cleanup();
      reject(error);
    }
  });
  input.pipe(output);
});

const hashFile = (targetPath) => {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(targetPath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
};

const listFilesRecursive = (baseFolder) => {
  if (!pathExists(baseFolder)) return [];
  const results = [];
  const walk = (folder) => {
    fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(folder, entry.name);
      const resolvedPath = path.resolve(absolutePath);
      if (localOnlyUploadFolders.some((excludedRoot) => (
        resolvedPath === excludedRoot || resolvedPath.startsWith(`${excludedRoot}${path.sep}`)
      ))) return;
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
  remoteFolderInfo: null,
  lastUpdatedAt: null,
});

const getDeviceId = () => {
  if (process.env.ARMI_SYNC_DEVICE_ID) return crypto.createHash('sha1').update(process.env.ARMI_SYNC_DEVICE_ID).digest('hex').slice(0, 16);
  const source = [os.hostname(), process.env.USERNAME || process.env.USER || '', process.platform].join('|');
  return crypto.createHash('sha1').update(source).digest('hex').slice(0, 16);
};

const readConfig = () => {
  const raw = readJsonFile(configPath, null);
  const merged = {
    ...defaultConfig(),
    ...(raw || {}),
  };
  if (merged.mode === 'apps_script_drive') {
    return {
      ...merged,
      mode: 'local',
      legacyMode: 'apps_script_drive',
    };
  }
  return merged;
};

const frontendStateStore = createFrontendStateStore(db, frontendStatePath);

const incrementalMirrorSync = createIncrementalMirrorSync({
  db,
  runtimeFolder,
  excludedTables: Array.from(SYNC_EXCLUDED_TABLES),
  getDeviceId,
  getSourceSignature: () => getDatabaseSourceSignature(),
  isMaintenanceAllowed: mirror => {
    const config = readConfig();
    return config.mode === 'drive_mirror' && resolveEffectiveMirrorPath(config).mirrorPath === mirror;
  },
  getBootstrapSeed: () => {
    const seed = readJsonFile(path.join(databaseRoot, '.bundled-seed.json'), null);
    if (!seed) return null;
    if (seed.tables) return { tables: seed.tables };
    const sourcePath = path.join(process.resourcesPath || appRoot, 'database', 'armi.db');
    if (!fs.existsSync(sourcePath) || path.resolve(sourcePath) === path.resolve(databaseRoot, 'armi.db')) return null;
    const source = new Database(sourcePath, { readonly: true });
    try {
      const tables = {};
      for (const { name } of source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
        if (!SYNC_EXCLUDED_TABLES.has(name)) tables[name] = source.prepare('SELECT * FROM ' + quoteIdentifier(name)).all();
      }
      return { tables };
    } finally { source.close(); }
  },
});

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

export const postChunkedSyncPackage = async ({ config, manifest, packageBase64, remoteState }) => {
  const totalParts = Math.ceil(packageBase64.length / APPS_SCRIPT_CHUNK_BASE64_CHARS);
  const commonPayload = {
    ...buildAppsScriptSyncPayload(config),
    deviceId: getDeviceId(),
    baseCloudVersion: remoteState.lastCloudVersion || '',
  };
  const startResponse = await postAppsScript({
    action: 'sync_push_start',
    ...commonPayload,
    manifest,
    totalParts,
    totalBytes: Buffer.byteLength(packageBase64, 'base64'),
  }, 120000);

  if (!startResponse.success || startResponse.data?.skippedUpload) {
    if (!startResponse.success && /Accion no reconocida/i.test(String(startResponse.message || ''))) {
      if (packageBase64.length <= 40 * 1024 * 1024) {
        return postAppsScript({
          action: 'sync_push',
          ...commonPayload,
          manifest,
          packageBase64,
        }, 240000);
      }
      return {
        success: false,
        message: 'El Apps Script publicado todavia no admite sincronizacion por fragmentos. Actualiza y vuelve a desplegar scripts/ArmiAuthWebApp.gs.',
      };
    }
    return startResponse;
  }

  const uploadId = String(startResponse.data?.uploadId || '').trim();
  const artifactKind = String(startResponse.data?.artifactKind || 'version').trim();
  if (!uploadId) {
    return { success: false, message: 'Drive no devolvio un identificador para la subida por fragmentos.' };
  }

  for (let index = 0; index < totalParts; index += 1) {
    const chunkBase64 = packageBase64.slice(
      index * APPS_SCRIPT_CHUNK_BASE64_CHARS,
      (index + 1) * APPS_SCRIPT_CHUNK_BASE64_CHARS
    );
    const chunkBytes = Buffer.from(chunkBase64, 'base64');
    const chunkResponse = await postAppsScript({
      action: 'sync_push_chunk',
      ...commonPayload,
      uploadId,
      artifactKind,
      index,
      totalParts,
      chunkSha256: crypto.createHash('sha256').update(chunkBytes).digest('hex'),
      chunkBase64,
    }, 120000);
    if (!chunkResponse.success) {
      return {
        success: false,
        message: chunkResponse.message || `Drive no pudo guardar el fragmento ${index + 1} de ${totalParts}.`,
        data: { uploadId, artifactKind, uploadedParts: index, totalParts },
      };
    }
  }

  return postAppsScript({
    action: 'sync_push_commit',
    ...commonPayload,
    uploadId,
    artifactKind,
    totalParts,
  }, 120000);
};

export const hydrateChunkedPackageResponse = async (response, config) => {
  if (!response?.success || response.data?.chunked !== true) return response;
  const totalParts = Number(response.data?.totalParts || response.data?.packageParts?.count || 0);
  if (!Number.isInteger(totalParts) || totalParts <= 0) {
    return { success: false, message: 'Drive devolvio una copia fragmentada sin un numero valido de partes.' };
  }

  const chunks = [];
  for (let index = 0; index < totalParts; index += 1) {
    const partResponse = await postAppsScript({
      action: 'sync_pull_chunk',
      ...buildAppsScriptSyncPayload(config),
      artifactId: response.data?.artifactId || '',
      artifactKind: response.data?.artifactKind || 'current',
      index,
      totalParts,
    }, 120000);
    const chunkBase64 = String(partResponse.data?.chunkBase64 || '').trim();
    if (!partResponse.success || !chunkBase64) {
      return {
        success: false,
        message: partResponse.message || `No se pudo descargar el fragmento ${index + 1} de ${totalParts}.`,
      };
    }
    chunks.push(chunkBase64);
  }

  return {
    ...response,
    data: {
      ...response.data,
      chunked: false,
      packageBase64: chunks.join(''),
    },
  };
};

const normalizeRemoteFolderInfo = (value) => {
  if (!value || typeof value !== 'object') return null;
  const normalized = {
    syncUserKey: sanitizeUserScope(value.syncUserKey),
    syncUserLabel: normalizeUserLabel(value.syncUserLabel || value.folderName),
    folderId: String(value.folderId || '').trim(),
    folderName: String(value.folderName || '').trim(),
    folderUrl: String(value.folderUrl || '').trim(),
    currentFolderId: String(value.currentFolderId || '').trim(),
    currentFolderUrl: String(value.currentFolderUrl || '').trim(),
    versionsFolderId: String(value.versionsFolderId || '').trim(),
    versionsFolderUrl: String(value.versionsFolderUrl || '').trim(),
    conflictsFolderId: String(value.conflictsFolderId || '').trim(),
    conflictsFolderUrl: String(value.conflictsFolderUrl || '').trim(),
    resolvedConflictsFolderId: String(value.resolvedConflictsFolderId || '').trim(),
    resolvedConflictsFolderUrl: String(value.resolvedConflictsFolderUrl || '').trim(),
    archivedVersionsFolderId: String(value.archivedVersionsFolderId || '').trim(),
    archivedVersionsFolderUrl: String(value.archivedVersionsFolderUrl || '').trim(),
  };
  return normalized.folderId ? normalized : null;
};

const sameRemoteFolderInfo = (left, right) => (
  JSON.stringify(normalizeRemoteFolderInfo(left) || null) === JSON.stringify(normalizeRemoteFolderInfo(right) || null)
);

const persistRemoteFolderInfo = (remoteUser, configLike = null) => {
  const normalized = normalizeRemoteFolderInfo(remoteUser);
  const currentConfig = configLike || readConfig();
  if (sameRemoteFolderInfo(currentConfig.remoteFolderInfo, normalized)) {
    return currentConfig;
  }
  return saveConfig({ remoteFolderInfo: normalized });
};

const persistObservedRemoteSyncState = (manifest, configLike = null) => {
  const cloudVersion = String(manifest?.cloudVersion || '').trim();
  const digest = String(manifest?.digest || '').trim();
  if (!cloudVersion && !digest) return;

  const currentState = readJsonFile(remoteSyncStatePath, {});
  const currentConfig = configLike || readConfig();
  const nextSyncUserKey = sanitizeUserScope(currentConfig.syncUserKey);
  const nextState = {
    ...currentState,
    lastCloudVersion: cloudVersion || currentState.lastCloudVersion || '',
    lastCloudDigest: digest || currentState.lastCloudDigest || '',
    lastSeenAt: new Date().toISOString(),
    syncUserKey: nextSyncUserKey,
    provider: REMOTE_PROVIDER,
  };

  writeJsonAtomic(remoteSyncStatePath, nextState);
};

const buildAppsScriptSyncPayload = (configLike = {}) => {
  const config = configLike || {};
  const remoteFolderInfo = normalizeRemoteFolderInfo(config.remoteFolderInfo);
  return {
    syncUserKey: sanitizeUserScope(config.syncUserKey),
    syncUserLabel: normalizeUserLabel(config.syncUserLabel),
    ...(remoteFolderInfo?.folderId ? {
      folderId: remoteFolderInfo.folderId,
      currentFolderId: remoteFolderInfo.currentFolderId,
      versionsFolderId: remoteFolderInfo.versionsFolderId,
      conflictsFolderId: remoteFolderInfo.conflictsFolderId,
      resolvedConflictsFolderId: remoteFolderInfo.resolvedConflictsFolderId,
      archivedVersionsFolderId: remoteFolderInfo.archivedVersionsFolderId,
    } : {}),
  };
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
    operationsRoot: path.join(internalRoot, 'operations'),
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
  ensureDir(paths.operationsRoot);
  writeJsonAtomic(path.join(paths.mirrorRoot, MIRROR_ROOT_MARKER), {
    format: 1,
    application: 'ARMI Docente',
    syncUserKey: sanitizeUserScope(readConfig().syncUserKey),
    createdByDevice: getDeviceId(),
    updatedAt: new Date().toISOString(),
    warning: 'No elimine esta carpeta. Contiene la copia sincronizada de ARMI Docente.',
  });
  return paths;
};

const isResourceFile = (file) => file?.scope === 'uploads' && !isLocalOnlySyncRelativePath(file.relativePath);

const getMirrorOperationPaths = (mirrorPath, operationId) => {
  const { operationsRoot } = ensureMirrorStructure(mirrorPath);
  const operationRoot = path.join(operationsRoot, operationId);
  ensureDir(operationRoot);
  return {
    operationRoot,
    intentPath: path.join(operationRoot, 'intent.json'),
    commitPath: path.join(operationRoot, 'commit.json'),
  };
};

const writeMirrorOperationIntent = (mirrorPath, operationId, manifest, changedFiles, removedPaths) => {
  const { intentPath } = getMirrorOperationPaths(mirrorPath, operationId);
  const resources = changedFiles.filter(isResourceFile);
  writeJsonAtomic(intentPath, {
    format: 1,
    operationId,
    state: 'preparing-mirror-copy',
    createdAt: new Date().toISOString(),
    deviceId: getDeviceId(),
    manifestDigest: manifest.digest,
    resources: resources.map(({ relativePath, size, checksum }) => ({ relativePath, size, checksum })),
    coreFiles: changedFiles.filter((file) => !isResourceFile(file)).map(({ relativePath, size, checksum }) => ({ relativePath, size, checksum })),
    removedPaths,
    note: 'Este catalogo se crea antes de copiar los archivos. Un recurso solo esta disponible cuando puede leerse y validarse.',
  });
};

const writeMirrorOperationCommit = (mirrorPath, operationId, manifest) => {
  const { commitPath } = getMirrorOperationPaths(mirrorPath, operationId);
  writeJsonAtomic(commitPath, {
    format: 1,
    operationId,
    state: 'prepared-in-local-drive-folder',
    completedAt: new Date().toISOString(),
    deviceId: getDeviceId(),
    manifestDigest: manifest.digest,
    note: 'ARMI termino la copia local. Google Drive puede continuar transfiriendola a otras computadoras.',
  });
};

const readLatestMirrorOperation = (mirrorPath, currentManifest = null) => {
  const { operationsRoot } = getMirrorMetaPaths(mirrorPath);
  if (!pathExists(operationsRoot)) return null;
  const operations = fs.readdirSync(operationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const operationRoot = path.join(operationsRoot, entry.name);
      const intent = readJsonFile(path.join(operationRoot, 'intent.json'), null);
      if (!intent) return null;
      const commit = readJsonFile(path.join(operationRoot, 'commit.json'), null);
      const timestamp = Date.parse(commit?.completedAt || intent.createdAt || '') || safeStat(operationRoot)?.mtimeMs || 0;
      return { intent, commit, timestamp };
    })
    .filter(Boolean)
    .sort((left, right) => right.timestamp - left.timestamp);
  const latest = operations[0];
  if (!latest) return null;
  const manifestDigest = String(currentManifest?.digest || '');
  const operationDigest = String(latest.intent.manifestDigest || '');
  const resources = Array.isArray(latest.intent.resources) ? latest.intent.resources : [];
  return {
    operationId: latest.intent.operationId,
    deviceId: latest.intent.deviceId,
    createdAt: latest.intent.createdAt,
    completedAt: latest.commit?.completedAt || null,
    manifestDigest: operationDigest,
    state: !latest.commit
      ? 'origin-copy-pending'
      : operationDigest && operationDigest !== manifestDigest
        ? 'catalog-ahead-of-manifest'
        : 'prepared-in-local-drive-folder',
    resourceFiles: resources.length,
    resourceBytes: resources.reduce((total, file) => total + Number(file.size || 0), 0),
  };
};

const getDatabaseSourceSignature = () => {
  return getSyncChangeSignature();
};

const stageLocalDatabaseDump = ({ force = false } = {}) => {
  const sourceSignature = getDatabaseSourceSignature();
  const previousStage = readJsonFile(databaseStageStatePath, null);
  const liveEntityCounts = getSyncEntityCounts();
  const countKeys = ['programaciones', 'unidades', 'sesiones', 'estudiantes', 'egresados', 'asistencias', 'rostros', 'evaluaciones', 'evidencias'];
  const stagedCountsStillMatch = previousStage?.entityCounts
    && countKeys.every((key) => Number(previousStage.entityCounts?.[key] || 0) === Number(liveEntityCounts?.[key] || 0));
  if (!force
    && pathExists(dbDumpPath)
    && previousStage?.sourceSignature === sourceSignature
    && stagedCountsStillMatch) {
    return dbDumpPath;
  }
  const dump = dumpDatabase({
    excludeTables: Array.from(SYNC_EXCLUDED_TABLES),
    includeExportedAt: false,
  });
  writeJsonAtomic(dbDumpPath, dump);
  writeJsonAtomic(databaseStageStatePath, {
    sourceSignature,
    entityCounts: liveEntityCounts,
    stagedAt: new Date().toISOString(),
  });
  return dbDumpPath;
};

const serializeLocalFiles = () => {
  const files = [];
  const databaseDumpStats = safeStat(dbDumpPath);
  if (databaseDumpStats) {
    const fingerprint = buildStableSyncFingerprint(dbDumpPath, 'database', 'database/database-dump.json');
    files.push({
      scope: 'database',
      relativePath: 'database/database-dump.json',
      absolutePath: dbDumpPath,
      size: fingerprint.size,
      mtimeMs: databaseDumpStats.mtimeMs,
      checksum: fingerprint.checksum,
    });
  }

  syncableDirectories.forEach(({ key, absolutePath }) => {
    listFilesRecursive(absolutePath).forEach((filePath) => {
      const stats = safeStat(filePath);
      if (!stats) return;
      const relativePath = toPosix(path.relative(dataRoot, filePath));
      const fingerprint = buildStableSyncFingerprint(filePath, key, relativePath);
      files.push({
        scope: key,
        relativePath,
        absolutePath: filePath,
        size: fingerprint.size,
        mtimeMs: stats.mtimeMs,
        checksum: fingerprint.checksum,
      });
    });
  });

  const frontendStats = safeStat(frontendStatePath);
  if (frontendStats) {
    const fingerprint = buildStableSyncFingerprint(frontendStatePath, 'frontend-state', 'state/frontend-local-storage.json');
    files.push({
      scope: 'frontend-state',
      relativePath: 'state/frontend-local-storage.json',
      absolutePath: frontendStatePath,
      size: fingerprint.size,
      mtimeMs: frontendStats.mtimeMs,
      checksum: fingerprint.checksum,
    });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

const buildManifestFromFiles = (files, provider, storageMode) => {
  const entityCounts = getSyncEntityCounts();
  const digest = crypto.createHash('sha256')
    .update(
      JSON.stringify(
        files.map(({ relativePath, size, checksum }) => ({
          relativePath,
          size,
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

const buildLightweightLocalManifest = (fallbackManifest = null) => {
  const databaseStats = safeStat(path.join(databaseRoot, 'armi.db'));
  const frontendStats = safeStat(frontendStatePath);
  const latestMtime = Math.max(Number(databaseStats?.mtimeMs || 0), Number(frontendStats?.mtimeMs || 0));
  const digest = crypto.createHash('sha256')
    .update(`${getDatabaseSourceSignature()}|${frontendStats?.size || 0}:${frontendStats?.mtimeMs || 0}`)
    .digest('hex');
  return {
    ...(fallbackManifest || {}),
    version: 2,
    provider: 'local-app-storage',
    storageMode: 'local',
    generatedAt: latestMtime ? new Date(latestMtime).toISOString() : new Date().toISOString(),
    digest,
    summary: {
      entities: getSyncEntityCounts(),
      includesAttendance: true,
      includesFaceProfiles: true,
    },
    files: Array.isArray(fallbackManifest?.files) ? fallbackManifest.files : [],
    lightweight: true,
  };
};

export const buildSyncPackageBase64 = async (manifest) => {
  const absolutePathByRelativePath = new Map(serializeLocalFiles().map((file) => [file.relativePath, file.absolutePath]));
  const packagePath = path.join(runtimeFolder, `sync-package-${process.pid}-${crypto.randomUUID()}.zip.tmp`);

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(packagePath);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      let settled = false;
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);

      output.on('close', resolveOnce);
      output.on('error', rejectOnce);
      archive.on('error', rejectOnce);
      archive.on('warning', (error) => {
        if (error?.code !== 'ENOENT') rejectOnce(error);
      });
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      manifest.files.forEach((file) => {
        const absolutePath = file.absolutePath || absolutePathByRelativePath.get(file.relativePath);
        if (!absolutePath || !pathExists(absolutePath)) return;
        const alreadyCompressed = /\.(?:avif|gif|jpe?g|png|webp|zip)$/i.test(file.relativePath);
        archive.file(absolutePath, {
          name: file.relativePath,
          store: alreadyCompressed,
        });
      });

      archive.finalize().catch(rejectOnce);
    });

    return fs.readFileSync(packagePath, 'base64');
  } finally {
    try {
      if (pathExists(packagePath)) fs.unlinkSync(packagePath);
    } catch {}
  }
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
    .filter((file) => ['uploads', 'temp'].includes(file.scope) && !isLocalOnlySyncRelativePath(file.relativePath))
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
    if (isLocalOnlySyncRelativePath(file.relativePath)) return;
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

const getContinuousResourceCatalogRoot = (mirrorPath) => (
  path.join(getMirrorMetaPaths(mirrorPath).internalRoot, 'resource-catalog-v1', 'devices')
);
const resourceCatalogTimestamp = (value) => Date.parse(String(value || '')) || 0;

const listContinuousLocalResources = () => continuousResourceDirectories
  .flatMap((directory) => listFilesRecursive(directory))
  .filter((absolutePath) => pathExists(absolutePath))
  .map((absolutePath) => {
    const stats = safeStat(absolutePath);
    return {
      absolutePath,
      relativePath: toPosix(path.relative(dataRoot, absolutePath)),
      size: Number(stats?.size || 0),
      sourceMtimeMs: Math.trunc(Number(stats?.mtimeMs || 0)),
    };
  })
  .filter((file) => normalizeRequestedResourcePath(file.relativePath))
  .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

const buildContinuousResourceSourceSignature = (files) => crypto
  .createHash('sha1')
  .update(files
    .map((file) => `${file.relativePath}:${file.size}:${file.sourceMtimeMs}`)
    .join('|'))
  .digest('hex')
  .slice(0, 20);
const getContinuousResourceSourceSignature = () => buildContinuousResourceSourceSignature(listContinuousLocalResources());

const readResourceMetadata = async (file, field) => {
  const result = await readMirrorJsonResult(file);
  if (result.status === 'missing') return null;
  if (result.status !== 'ready' || !Array.isArray(result.value?.[field])) {
    throw new Error('Esperando verificar el catálogo de archivos de Drive. Se conservan los archivos y se reintentará sin volver a copiarlos.');
  }
  return result.value;
};

const readContinuousMirrorResourceCatalog = async (mirrorPath) => {
  const catalogRoot = getContinuousResourceCatalogRoot(mirrorPath);
  if (!pathExists(catalogRoot)) return [];
  const byPath = new Map();
  for (const entry of (await fs.promises.readdir(catalogRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))) {
      const catalog = await readResourceMetadata(path.join(catalogRoot, entry.name), 'resources');
      (Array.isArray(catalog?.resources) ? catalog.resources : []).forEach((resource) => {
        const relativePath = normalizeRequestedResourcePath(resource?.relativePath);
        if (!relativePath) return;
        const candidate = {
          relativePath,
          size: Number(resource?.size || 0),
          checksum: String(resource?.checksum || ''),
          updatedAt: String(resource?.updatedAt || catalog?.generatedAt || ''),
        };
        const current = byPath.get(relativePath);
        if (!current || resourceCatalogTimestamp(candidate.updatedAt) >= resourceCatalogTimestamp(current.updatedAt)) {
          byPath.set(relativePath, candidate);
        }
      });
    }
  return [...byPath.values()];
};

const refreshExpectedResourceCatalogFromMirror = async (mirrorPath) => {
  const manifestResources = ((await readResourceMetadata(getMirrorFilePath(mirrorPath, 'manifest.json'), 'files'))?.files || [])
    .filter(isResourceFile)
    .map(({ relativePath, size, checksum }) => ({ relativePath, size: Number(size || 0), checksum: String(checksum || ''), updatedAt: '' }));
  const byPath = new Map(manifestResources.map((resource) => [resource.relativePath, resource]));
  (await readContinuousMirrorResourceCatalog(mirrorPath)).forEach((resource) => byPath.set(resource.relativePath, resource));
  const resources = [...byPath.values()];
  writeJsonAtomic(expectedResourceCatalogPath, {
    format: 2,
    mirrorPath: path.resolve(mirrorPath),
    receivedAt: new Date().toISOString(),
    resources,
  });
  return resources;
};

export const publishContinuousResourcesToMirror = async (mirrorPath, localResources = null) => {
  ensureMirrorStructure(mirrorPath);
  const deviceId = getDeviceId();
  const catalogRoot = getContinuousResourceCatalogRoot(mirrorPath);
  ensureDir(catalogRoot);
  const catalogPath = path.join(catalogRoot, `${deviceId}.json`);
  // A slow/unreadable catalog is never an empty catalog. Stop before copying.
  const previous = await readResourceMetadata(catalogPath, 'resources') || { resources: [] };
  const previousByPath = new Map((previous.resources || []).map((resource) => [resource.relativePath, resource]));
  // Other PCs and legacy snapshots may already have published the same content.
  const knownResources = await readContinuousMirrorResourceCatalog(mirrorPath);
  const manifest = await readResourceMetadata(getMirrorFilePath(mirrorPath, 'manifest.json'), 'files');
  const knownByPath = new Map();
  for (const resource of [...(manifest?.files || []), ...knownResources, ...previous.resources]) {
    if (!knownByPath.has(resource.relativePath)) knownByPath.set(resource.relativePath, []);
    knownByPath.get(resource.relativePath).push(resource);
  }
  const resources = [];
  let copiedFiles = 0;
  let copiedBytes = 0;

  const sourceFiles = Array.isArray(localResources) ? localResources : listContinuousLocalResources();
  const pendingFiles = [];
  const progress = { phase: 'checking', completedFiles: 0, totalFiles: sourceFiles.length,
    completedBytes: 0, totalBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0),
    currentFile: '', reviewedFiles: 0, unchangedFiles: 0 };
  updateContinuousMirrorState({ progress });
  for (const file of sourceFiles) {
    progress.currentFile = file.relativePath;
    updateContinuousMirrorState({ progress: { ...progress } });
    const destinationPath = getMirrorFilePath(mirrorPath, file.relativePath);
    const previousResource = previousByPath.get(file.relativePath);
    let checksum = '';
    const metadataUnchanged = previousResource
      && Number(previousResource.size || 0) === file.size
      && Number(previousResource.sourceMtimeMs || 0) === file.sourceMtimeMs
      && String(previousResource.checksum || '');
    if (metadataUnchanged) checksum = String(previousResource.checksum);
    else {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(file.absolutePath)) hash.update(chunk);
      checksum = hash.digest('hex');
    }

    const destinationStats = safeStat(destinationPath);
    // Compare against published metadata; reading the destination would
    // download a Drive placeholder merely to decide whether to upload a file.
    const knownVersions = knownByPath.get(file.relativePath) || [];
    const versionTime = resource => resourceCatalogTimestamp(resource.updatedAt)
      || Number(resource.sourceMtimeMs || resource.mtimeMs || 0);
    const newestTime = Math.max(0, ...knownVersions.map(versionTime));
    const latestVersions = knownVersions.filter(resource => versionTime(resource) === newestTime);
    const contentPublished = latestVersions.length > 0 && latestVersions.every(resource =>
      Number(resource.size) === file.size && resource.checksum === checksum);
    let destinationMatches = contentPublished && Number(destinationStats?.size ?? -1) === file.size;
    let preserveVersion = false;
    if (!destinationMatches && destinationStats?.isFile()) {
      const mirrorHash = await resourceChecksum(destinationPath);
      if (mirrorHash === checksum) destinationMatches = true;
      else if (previousResource?.checksum === checksum) {
        // Only the other PC changed the file. Do not overwrite it with this stale copy.
        preserveVersion = true;
      } else if (!previousResource?.checksum || previousResource.checksum !== mirrorHash) {
        await resourceConflicts.capture({ relativePath: file.relativePath, localPath: file.absolutePath, mirrorPath: destinationPath });
        preserveVersion = true;
      }
    }
    if (!destinationMatches && !preserveVersion) {
      pendingFiles.push({ file, destinationPath });
    } else progress.unchangedFiles += 1;
    if (preserveVersion) { if (previousResource) resources.push(previousResource); }
    else resources.push({
      relativePath: file.relativePath,
      size: file.size,
      checksum,
      sourceMtimeMs: file.sourceMtimeMs,
      updatedAt: new Date(contentPublished ? newestTime || file.sourceMtimeMs || Date.now()
        : Math.max(Date.now(), newestTime + 1)).toISOString(),
    });
    progress.completedFiles += 1;
    progress.reviewedFiles += 1;
    progress.completedBytes += file.size;
    updateContinuousMirrorState({ progress: { ...progress } });
  }

  // Only files which actually need copying enter the upload denominator.
  // Checking unchanged files is a separate, explicitly labelled phase.
  Object.assign(progress, { phase: 'copying', completedFiles: 0, totalFiles: pendingFiles.length,
    completedBytes: 0, totalBytes: pendingFiles.reduce((sum, {file}) => sum + file.size, 0), currentFile: '' });
  updateContinuousMirrorState({ progress: { ...progress } });
  for (const {file, destinationPath} of pendingFiles) {
    progress.currentFile = file.relativePath;
    updateContinuousMirrorState({ progress: { ...progress } });
    const bytesBeforeFile = progress.completedBytes;
    await copyFileAtomicStreaming(file.absolutePath, destinationPath, ({ copiedBytes: fileBytes }) => {
      updateContinuousMirrorState({ progress: { ...progress, completedBytes: bytesBeforeFile + fileBytes } });
    });
    copiedFiles += 1;
    copiedBytes += file.size;
    progress.completedFiles = copiedFiles;
    progress.completedBytes = copiedBytes;
    updateContinuousMirrorState({ progress: { ...progress } });
  }
  Object.assign(progress, { phase: 'catalog', currentFile: '' });
  updateContinuousMirrorState({ progress: { ...progress } });

  // A missing local download is not a deletion of a version already published.
  const localPaths = new Set(sourceFiles.map(file => file.relativePath));
  for (const resource of previous.resources) if (!localPaths.has(resource.relativePath)) resources.push(resource);

  writeJsonAtomic(catalogPath, {
    format: 1,
    deviceId,
    generatedAt: new Date().toISOString(),
    resources,
  });
  const visibleResources = await refreshExpectedResourceCatalogFromMirror(mirrorPath);
  return {
    copiedFiles,
    copiedBytes,
    publishedFiles: resources.length,
    visibleFiles: visibleResources.length,
    sourceSignature: buildContinuousResourceSourceSignature(sourceFiles),
    conflicts: resourceConflicts.list().length,
  };
};

const runIncrementalMirrorSync = async (mirrorPath) => {
  const result = await incrementalMirrorSync.run({
    mirrorPath,
    mirrorDatabaseDumpPath: mirrorPath ? getMirrorFilePath(mirrorPath, 'database/database-dump.json') : '',
  });
  if (result.success && !result.data?.alreadyRunning && (result.data?.appliedOperations > 0 || result.data?.identityMigrationApplied)) {
    receivedChanges = { operations: Math.max(1,result.data.appliedOperations), completedAt: new Date().toISOString() };
  }
  return result;
};

const verifyMirrorIntegrity = (mirrorPath, manifest) => {
  if (!manifest) {
    return { ok: false, code: 'missing-manifest', missingFiles: [], missingCoreFiles: [], pendingResourceFiles: [] };
  }

  const missingFiles = (manifest.files || []).filter(
    (file) => !pathExists(getMirrorFilePath(mirrorPath, file.relativePath))
  );
  const missingCoreFiles = missingFiles.filter((file) => !isResourceFile(file)).map((file) => file.relativePath);
  const pendingResourceFiles = missingFiles.filter(isResourceFile).map((file) => file.relativePath);

  if (missingCoreFiles.length > 0) {
    return {
      ok: false,
      code: 'mirror-incomplete',
      missingFiles: missingFiles.map((file) => file.relativePath),
      missingCoreFiles,
      pendingResourceFiles,
    };
  }

  return {
    ok: true,
    code: pendingResourceFiles.length > 0 ? 'resources-pending' : 'ok',
    missingFiles: pendingResourceFiles,
    missingCoreFiles: [],
    pendingResourceFiles,
  };
};

const persistExpectedResourceCatalog = (mirrorPath, manifest) => {
  const resources = (manifest?.files || []).filter(isResourceFile).map(({ relativePath, size, checksum }) => ({
    relativePath,
    size: Number(size || 0),
    checksum: String(checksum || ''),
  }));
  writeJsonAtomic(expectedResourceCatalogPath, {
    format: 1,
    mirrorPath: path.resolve(mirrorPath),
    manifestDigest: String(manifest?.digest || ''),
    receivedAt: new Date().toISOString(),
    resources,
  });
  return resources;
};

const getExpectedResourceCatalog = () => readJsonFile(expectedResourceCatalogPath, { resources: [] });

const normalizeRequestedResourcePath = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('uploads/') || normalized.includes('../')) return '';
  return normalized;
};

const summarizeResourceDelivery = () => {
  const catalog = getExpectedResourceCatalog();
  const resources = Array.isArray(catalog.resources) ? catalog.resources : [];
  let availableFiles = 0;
  let availableBytes = 0;
  let pendingBytes = 0;
  const pendingFiles = [];
  resources.forEach((file) => {
    const localPath = path.join(dataRoot, fromPosixToCurrentOs(file.relativePath));
    const localSize = Number(safeStat(localPath)?.size ?? -1);
    if (localSize === Number(file.size || 0)) {
      availableFiles += 1;
      availableBytes += Number(file.size || 0);
    } else {
      pendingBytes += Number(file.size || 0);
      if (pendingFiles.length < 20) pendingFiles.push(file.relativePath);
    }
  });
  const activeTransfers = Array.from(activeResourceTransfers.values()).map(({ promise: _promise, ...state }) => state);
  return {
    manifestDigest: String(catalog.manifestDigest || ''),
    totalFiles: resources.length,
    totalBytes: resources.reduce((total, file) => total + Number(file.size || 0), 0),
    availableFiles,
    availableBytes,
    pendingFilesCount: Math.max(0, resources.length - availableFiles),
    pendingBytes,
    pendingFiles,
    activeTransfers,
    mirrorTransfer: activeMirrorTransfer,
  };
};

export const getResourceDeliveryStatus = () => ({ success: true, data: summarizeResourceDelivery() });

export const ensureMirrorResourceAvailable = async (requestedRelativePath) => {
  const relativePath = normalizeRequestedResourcePath(requestedRelativePath);
  if (!relativePath) return { success: false, code: 'invalid-resource-path', message: 'La ruta del recurso no es valida.' };

  const catalog = getExpectedResourceCatalog();
  let expected = (catalog.resources || []).find((file) => file.relativePath === relativePath);
  const localPath = path.join(dataRoot, fromPosixToCurrentOs(relativePath));
  let discoveredMirrorPath = '';
  if (!expected) {
    if (pathExists(localPath)) return { success: true, code: 'local-resource', localPath };
    const effectiveMirror = resolveEffectiveMirrorPath(readConfig());
    discoveredMirrorPath = String(catalog.mirrorPath || effectiveMirror.mirrorPath || '');
    const uncataloguedMirrorPath = discoveredMirrorPath
      ? getMirrorFilePath(discoveredMirrorPath, relativePath)
      : '';
    const uncataloguedStats = uncataloguedMirrorPath ? safeStat(uncataloguedMirrorPath) : null;
    if (!uncataloguedStats?.isFile()) {
      return { success: false, code: 'unknown-resource', message: 'El recurso no figura en el catalogo sincronizado.' };
    }
    expected = { relativePath, size: Number(uncataloguedStats.size || 0), checksum: '' };
  }
  const localStatsBefore = safeStat(localPath);
  if (Number(localStatsBefore?.size ?? -1) === Number(expected.size || 0)
    && (!expected.checksum || await resourceChecksum(localPath) === expected.checksum)) {
    return { success: true, code: 'available', localPath };
  }

  const existing = activeResourceTransfers.get(relativePath);
  if (existing?.promise && existing.state === 'downloading') return existing.promise;

  const mirrorPath = String(catalog.mirrorPath || discoveredMirrorPath || '').trim();
  const mirrorFilePath = mirrorPath ? getMirrorFilePath(mirrorPath, relativePath) : '';
  if (!mirrorFilePath || !pathExists(mirrorFilePath)) {
    const waitingState = {
      relativePath,
      fileName: path.basename(relativePath),
      state: 'waiting-for-drive-upload',
      copiedBytes: 0,
      totalBytes: Number(expected.size || 0),
      message: 'Este archivo todavia no termino de copiarse o subirse desde la otra PC.',
      observedAt: new Date().toISOString(),
    };
    activeResourceTransfers.set(relativePath, waitingState);
    downloadProgress.begin(relativePath, waitingState.totalBytes, 'waiting');
    setTimeout(() => {
      if (activeResourceTransfers.get(relativePath) === waitingState) activeResourceTransfers.delete(relativePath);
    }, 10000);
    return {
      success: false,
      code: 'waiting-for-drive-upload',
      message: waitingState.message,
    };
  }

  if (localStatsBefore?.isFile() && expected.checksum) {
    const localHash = await resourceChecksum(localPath);
    const ownCatalog = await readResourceMetadata(path.join(getContinuousResourceCatalogRoot(mirrorPath), `${getDeviceId()}.json`), 'resources');
    const baseline = ownCatalog?.resources.find(file => file.relativePath === relativePath);
    if (localHash !== expected.checksum && localHash !== baseline?.checksum) {
      const conflict = await resourceConflicts.capture({ relativePath, localPath, mirrorPath: mirrorFilePath });
      if (conflict) return { success: false, code: 'resource-conflict', message: 'Este recurso tiene dos versiones. El docente puede elegir cuál conservar en el aviso de sincronización.' };
      return { success: true, code: 'available', localPath };
    }
  }

  const state = {
    relativePath,
    fileName: path.basename(relativePath),
    state: 'downloading',
    copiedBytes: 0,
    totalBytes: Number(expected.size || 0),
    startedAt: new Date().toISOString(),
  };
  downloadProgress.begin(relativePath, state.totalBytes);
  const promise = (async () => {
    try {
      await copyFileAtomicStreaming(mirrorFilePath, localPath, ({ copiedBytes, totalBytes }) => {
        state.copiedBytes = copiedBytes;
        state.totalBytes = Number(expected.size || totalBytes || 0);
        downloadProgress.update(relativePath, state.copiedBytes, state.totalBytes);
      }, { checksum: expected.checksum, size: Number(expected.size || 0) });
      const localStats = safeStat(localPath);
      if (Number(localStats?.size || 0) !== Number(expected.size || 0)
        || (expected.checksum && hashFile(localPath) !== expected.checksum)) {
        throw new Error('El archivo descargado no coincide con el catalogo de Drive.');
      }
      state.state = 'available';
      state.copiedBytes = state.totalBytes;
      state.completedAt = new Date().toISOString();
      downloadProgress.complete(relativePath);
      return { success: true, code: 'downloaded', localPath };
    } catch (error) {
      state.state = 'error';
      state.message = `No se pudo descargar el recurso desde Drive. Puede seguir subiendose desde la otra PC o Drive puede estar pausado.${error?.message ? ` Detalle: ${error.message}` : ''}`;
      downloadProgress.fail(relativePath, state.message);
      return { success: false, code: 'download-failed', message: state.message };
    } finally {
      setTimeout(() => { if (activeResourceTransfers.get(relativePath) === state) activeResourceTransfers.delete(relativePath); }, 5000);
    }
  })();
  activeResourceTransfers.set(relativePath, { ...state, promise });
  // Preserve the mutable progress object while retaining the shared promise.
  activeResourceTransfers.set(relativePath, Object.assign(state, { promise }));
  return promise;
};

const getComparableManifestDigest = (manifest) => {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (!files.length) return '';
  return crypto.createHash('sha256')
    .update(
      JSON.stringify(
        files.map(({ relativePath, size, checksum }) => ({
          relativePath: String(relativePath || ''),
          size: Number(size || 0),
          checksum: String(checksum || ''),
        }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      )
    )
    .digest('hex');
};

export const compareSyncManifests = (localManifest, mirrorManifest, mode, savedManifest = null) => {
  if (mode === 'local') return 'local-mode';
  if (mode === 'apps_script_drive' && !mirrorManifest && localManifest) return 'mirror-missing';
  if (!mirrorManifest && !localManifest) return 'no-data';
  if (!mirrorManifest && localManifest) return 'mirror-missing';
  if (localManifest?.digest === mirrorManifest?.digest) return 'in-sync';
  const localEntities = localManifest?.summary?.entities || {};
  const mirrorEntities = mirrorManifest?.summary?.entities || {};
  const protectedEntityKeys = [
    'programaciones', 'programacionesConMetas', 'datosGenerales', 'unidades', 'sesiones',
    'estudiantes', 'egresados', 'asistencias', 'rostros', 'evaluaciones', 'evidencias',
  ];
  let localHasMore = false;
  let mirrorHasMore = false;
  protectedEntityKeys.forEach((key) => {
    if (localEntities[key] === undefined || mirrorEntities[key] === undefined) return;
    const localValue = Number(localEntities[key] || 0);
    const mirrorValue = Number(mirrorEntities[key] || 0);
    if (localValue > mirrorValue) localHasMore = true;
    if (mirrorValue > localValue) mirrorHasMore = true;
  });
  if (localHasMore && !mirrorHasMore) return 'local-newer';
  if (mirrorHasMore && !localHasMore) return 'mirror-newer';
  if (localHasMore && mirrorHasMore) return 'diverged';
  const localComparableDigest = getComparableManifestDigest(localManifest);
  const mirrorComparableDigest = getComparableManifestDigest(mirrorManifest);
  if (localComparableDigest && localComparableDigest === mirrorComparableDigest) return 'in-sync';
  const savedComparableDigest = getComparableManifestDigest(savedManifest);
  if (savedComparableDigest && savedComparableDigest === mirrorComparableDigest) return 'local-newer';
  if (savedComparableDigest && savedComparableDigest === localComparableDigest) return 'mirror-newer';
  if (!savedComparableDigest && mirrorComparableDigest && localComparableDigest) return 'diverged';
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

let cachedDriveCandidates = { userKey: '', checkedAt: 0, candidates: [] };
const detectGoogleDriveCandidates = (syncUserKey = DEFAULT_SYNC_USER_KEY) => {
  const cacheKey = sanitizeUserScope(syncUserKey);
  if (cachedDriveCandidates.userKey === cacheKey
    && Date.now() - cachedDriveCandidates.checkedAt < 120_000) {
    return cachedDriveCandidates.candidates.map((candidate) => ({ ...candidate }));
  }
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
        if (!/^(?:google[ ._-]?drive|drive|my drive|mi unidad)$/i.test(entry.name)) return;
        const absolutePath = path.join(home, entry.name);
        if (pathExists(absolutePath)) discovered.add(path.resolve(absolutePath));
      });
  } catch {}

  if (process.platform === 'win32') {
    for (let code = 'D'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
      const driveRoot = `${String.fromCharCode(code)}:${path.sep}`;
      if (!pathExists(driveRoot)) continue;
      ['Mi unidad', 'My Drive'].forEach((folderName) => {
        const candidate = path.join(driveRoot, folderName);
        if (pathExists(candidate)) discovered.add(path.resolve(candidate));
      });
    }
  }

  const candidates = Array.from(discovered).map((basePath) => ({
    basePath,
    suggestedMirrorPath: buildSuggestedMirrorPath(basePath, syncUserKey),
  }));
  cachedDriveCandidates = { userKey: cacheKey, checkedAt: Date.now(), candidates };
  return candidates.map((candidate) => ({ ...candidate }));
};

const detectExistingMirrorPaths = (syncUserKey = DEFAULT_SYNC_USER_KEY, driveCandidates = null) => {
  const safeUserKey = sanitizeUserScope(syncUserKey);
  const candidates = Array.isArray(driveCandidates)
    ? driveCandidates
    : detectGoogleDriveCandidates(safeUserKey);
  const discovered = new Set();
  const consider = (mirrorPath) => {
    if (!mirrorPath) return;
    const resolved = path.resolve(mirrorPath);
    if (pathExists(path.join(resolved, MIRROR_ROOT_MARKER))) discovered.add(resolved);
  };

  candidates.forEach(({ basePath, suggestedMirrorPath }) => {
    consider(suggestedMirrorPath);
    let children = [];
    try {
      children = fs.readdirSync(basePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .slice(0, 200);
    } catch {}
    children.forEach((entry) => {
      consider(path.join(basePath, entry.name, DEFAULT_MIRROR_SUBFOLDER, 'users', safeUserKey));
    });
  });

  return Array.from(discovered);
};

let cachedDriveExecutable = { checkedAt: 0, path: '' };
const internetConnectivity = createInternetConnectivityMonitor({ onChange: () => {
  if (readConfig().mode === 'drive_mirror') requestContinuousMirrorSync({ delayMs: 150 });
} });
export const getInternetConnectivity = (options) => internetConnectivity.check(options);
const driveDesktopLauncher = createDriveDesktopLauncher({ automaticEnabled: process.env.ARMI_DISABLE_DRIVE_LAUNCH !== '1' });

const detectGoogleDriveDesktopExecutable = () => {
  if (process.platform !== 'win32') return '';
  if (Date.now() - cachedDriveExecutable.checkedAt < 10 * 60_000) {
    return cachedDriveExecutable.path;
  }
  const candidates = [
    path.join(String(process.env.LOCALAPPDATA || ''), 'Google', 'DriveFS', 'GoogleDriveFS.exe'),
    path.join(String(process.env.ProgramFiles || 'C:\\Program Files'), 'Google', 'Drive File Stream', 'GoogleDriveFS.exe'),
  ].filter(Boolean);
  const versionRoot = path.join(String(process.env.ProgramFiles || 'C:\\Program Files'), 'Google', 'Drive File Stream');
  try {
    fs.readdirSync(versionRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
      .forEach((entry) => candidates.unshift(path.join(versionRoot, entry.name, 'GoogleDriveFS.exe')));
  } catch {}
  const executablePath = candidates.find((candidate) => pathExists(candidate)) || '';
  cachedDriveExecutable = { checkedAt: Date.now(), path: executablePath };
  return executablePath;
};

const checkInternetConnection = async ({ waitForFresh = true } = {}) => {
  return (await internetConnectivity.check({ wait: waitForFresh })).online;
};

const getDrivePauseObservation = () => {
  if (process.platform !== 'win32') return { paused: null, observedAt: null };
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  if (!localAppData) return { paused: null, observedAt: null };
  const logPath = path.join(localAppData, 'Google', 'DriveFS', 'Logs', 'drive_fs.txt');
  const stats = safeStat(logPath);
  if (!stats?.size) return { paused: null, observedAt: null };
  try {
    const bytesToRead = Math.min(stats.size, 1024 * 1024);
    const buffer = Buffer.alloc(bytesToRead);
    const handle = fs.openSync(logPath, 'r');
    try {
      fs.readSync(handle, buffer, 0, bytesToRead, stats.size - bytesToRead);
    } finally {
      fs.closeSync(handle);
    }
    const matches = [...buffer.toString('utf8').matchAll(/^(\d{4}-\d{2}-\d{2}T\S+).*NotifyPauseSyncing Syncing is (on|off)\s*$/gmi)];
    const latest = matches.at(-1);
    if (!latest) return { paused: null, observedAt: null };
    return {
      paused: latest[2].toLowerCase() === 'off',
      observedAt: latest[1],
    };
  } catch {
    return { paused: null, observedAt: null };
  }
};

const getDriveDesktopHealth = async (config, resolvedMirror, driveCandidates) => {
  const executablePath = detectGoogleDriveDesktopExecutable();
  const drive = await driveDesktopLauncher.observe({ executablePath, automatic: config.mode === 'drive_mirror' });
  const { processRunning, launchAttempted } = drive;
  const installed = processRunning === true || !!executablePath || driveCandidates.length > 0;
  // Internet no condiciona la escritura segura en la carpeta espejo y no debe
  // bloquear ni el inicio ni el cierre. El resultado se actualiza en background.
  const internetOnline = config.mode === 'drive_mirror'
    ? await checkInternetConnection({ waitForFresh: false })
    : null;
  const pauseObservation = getDrivePauseObservation();
  const mirrorPath = String(resolvedMirror?.mirrorPath || '').trim();
  const folderAccessible = !!mirrorPath && pathExists(mirrorPath);
  const markerPresent = folderAccessible && pathExists(path.join(mirrorPath, MIRROR_ROOT_MARKER));
  let state = 'not-configured';
  let message = 'Selecciona la carpeta de Google Drive que usara ARMI.';

  if (config.mode !== 'drive_mirror') {
    state = 'inactive';
    message = driveCandidates.length
      ? 'Google Drive fue detectado y esta listo para configurarse.'
      : 'El modo espejo todavia no esta activado.';
  } else if (!mirrorPath || !folderAccessible) {
    state = 'folder-missing';
    message = 'La carpeta configurada no esta disponible. Drive puede estar cerrado, desconectado o la carpeta fue movida.';
  } else if (drive.starting) {
    state = 'starting';
    message = 'Google Drive esta iniciando. ARMI no repetira el intento automaticamente en esta sesion.';
  } else if (processRunning === false) {
    state = 'app-not-running';
    message = installed
      ? 'Google Drive esta cerrado. Usa Abrir Google Drive para enviar los cambios; la copia local sigue disponible.'
      : 'Google Drive para escritorio no esta instalado. Los cambios seguiran seguros en la carpeta local configurada.';
  } else if (processRunning === null) {
    state = 'unknown';
    message = 'No pudimos comprobar si Drive esta abierto. No intentaremos abrirlo mientras su estado sea desconocido.';
  } else if (pauseObservation.paused === true) {
    state = 'paused';
    message = 'Google Drive informa que la sincronizacion esta pausada. Los cambios de ARMI estan seguros en esta PC, pero siguen pendientes de subir.';
  } else if (internetOnline === false) {
    state = 'offline';
    message = 'Las comprobaciones de red indican que no hay conexion a Internet. Los cambios locales se conservan y se reintentara automaticamente.';
  } else if (internetOnline !== true) {
    state = 'unknown';
    message = 'Drive esta abierto y la carpeta local es accesible. No se pudo verificar internet; esto no confirma una desconexion. ARMI seguira copiando los cambios al espejo local.';
  } else {
    state = 'ready';
    message = 'Google Drive esta ejecutandose y la carpeta de ARMI esta accesible.';
  }

  return {
    state,
    message,
    processRunning,
    installed,
    executablePath,
    launchAttempted,
    internetOnline,
    folderConfigured: !!mirrorPath,
    folderAccessible,
    markerPresent,
    paused: pauseObservation.paused,
    pauseObservedAt: pauseObservation.observedAt,
    pauseDetection: 'best-effort',
    pauseMessage: pauseObservation.paused === null
      ? 'No se pudo confirmar desde Drive si la sincronizacion esta pausada.'
      : `Ultimo estado informado por Google Drive: ${pauseObservation.paused ? 'pausado' : 'activo'}.`,
  };
};

export const openGoogleDriveDesktop = async () => {
  const executablePath = detectGoogleDriveDesktopExecutable();
  if (!executablePath) return { success: false, message: 'No encontramos Google Drive instalado.' };
  const result = await driveDesktopLauncher.observe({ executablePath, manual: true });
  requestContinuousMirrorSync({ delayMs: 250 });
  return { success: result.processRunning === true || result.starting, message: result.error || (result.processRunning === true ? 'Google Drive ya esta abierto.' : result.starting ? 'Google Drive esta iniciando.' : 'No pudimos confirmar el estado de Drive. Vuelve a intentarlo.'), data: result };
};

const resolveEffectiveMirrorPath = (configLike = {}) => {
  const syncUserKey = sanitizeUserScope(configLike.syncUserKey);
  const configuredMirrorPath = typeof configLike.mirrorPath === 'string' ? configLike.mirrorPath.trim() : '';
  if (configuredMirrorPath) {
    if (!pathExists(configuredMirrorPath)) {
      const [relocatedMirrorPath] = detectExistingMirrorPaths(syncUserKey);
      if (relocatedMirrorPath) {
        return {
          mirrorPath: relocatedMirrorPath,
          derivedAutomatically: true,
          relocatedAutomatically: true,
          syncUserKey,
        };
      }
    }
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

const saveFrontendStateSnapshot = (payload = {}, changedKeys = []) => {
  const result = frontendStateStore.observe(payload, changedKeys);
  if (!result.unchanged) requestContinuousMirrorSync({ delayMs: 750 });
  return result;
};

const readPendingLocalState = () => readJsonFile(pendingLocalStatePath, null);

const clearPendingLocalState = () => {
  try {
    if (pathExists(pendingLocalStatePath)) {
      fs.unlinkSync(pendingLocalStatePath);
    }
  } catch {}
};

const persistPendingLocalState = (payload = {}) => {
  const pending = {
    createdAt: new Date().toISOString(),
    reason: String(payload.reason || 'pending-sync').trim() || 'pending-sync',
    restorePoint: String(payload.restorePoint || '').trim(),
    manifest: payload.manifest || null,
    counts: payload.counts || getSyncEntityCounts(),
    note: String(payload.note || '').trim(),
  };
  writeJsonAtomic(pendingLocalStatePath, pending);
  return pending;
};

export const markPendingLocalBackup = async (payload = {}) => {
  if (payload.reason === 'close-attempt' && payload.deferRemote === true && readConfig().mode === 'drive_mirror') {
    // Closing is a local durability boundary, not a full Drive export. SQLite
    // already persisted the edits and its incremental outbox; checkpoint what
    // can be checkpointed without waiting for readers or a remote filesystem.
    db.pragma('wal_checkpoint(PASSIVE)');
    frontendStateStore.snapshot();
    const previous = readPendingLocalState();
    const protectedConflict = /another-pc|fewer-records|conflict/.test(previous?.reason || '');
    const pending = persistPendingLocalState({
      reason: protectedConflict ? previous.reason : 'close-attempt',
      restorePoint: previous?.restorePoint || '',
      manifest: previous?.manifest || null,
      note: protectedConflict ? previous.note : 'Datos guardados en esta PC. La sincronizacion pendiente se reintentara al abrir ARMI.',
    });
    return { success: true, data: { ...pending, closePrepared: true, localSaved: true, cloudDeliveryPending: true } };
  }
  stageLocalDatabaseDump();
  const manifest = buildManifestFromFiles(serializeLocalFiles(), 'local-pending-backup', 'local');
  // localManifest is the last synchronized baseline. Advancing it before the
  // upload succeeds makes this PC's own edits look like another-PC conflict.
  return {
    success: true,
    data: persistPendingLocalState({
      ...payload,
      restorePoint: '',
      manifest,
      counts: getSyncEntityCounts(),
    }),
  };
};

export const getDriveMirrorEvidenceStorage = () => {
  const config = readConfig();
  const resolved = resolveEffectiveMirrorPath(config);
  const enabled = config.mode === 'drive_mirror' && !!resolved.mirrorPath;
  return {
    enabled,
    mirrorPath: enabled ? resolved.mirrorPath : '',
    evidencePath: enabled ? path.join(resolved.mirrorPath, 'Evidencias de estudiantes') : '',
    syncUserKey: sanitizeUserScope(config.syncUserKey),
  };
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

const backupMirrorSnapshot = (mirrorPath, manifest) => {
  if (!manifest?.files?.length) return '';
  const { backupsRoot } = ensureMirrorStructure(mirrorPath);
  const snapshotsRoot = path.join(backupsRoot, 'snapshots');
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${getDeviceId()}`;
  const snapshotRoot = path.join(snapshotsRoot, stamp);
  ensureDir(snapshotRoot);

  manifest.files.forEach((file) => {
    const sourcePath = getMirrorFilePath(mirrorPath, file.relativePath);
    if (!pathExists(sourcePath)) return;
    copyFileAtomic(sourcePath, path.join(snapshotRoot, 'current', fromPosixToCurrentOs(file.relativePath)));
  });
  writeJsonAtomic(path.join(snapshotRoot, 'manifest.json'), {
    ...manifest,
    protectedAt: new Date().toISOString(),
    protectedByDevice: getDeviceId(),
    protectionReason: 'manual-conflict-resolution',
  });
  pruneOldFolders(snapshotsRoot, SAFETY_RETENTION);
  return snapshotRoot;
};

const applyMirrorToLocal = (mirrorPath, manifest, restoreRoot) => {
  const manifestPaths = new Set((manifest.files || [])
    .filter((file) => ['uploads', 'temp'].includes(file.scope) && !isLocalOnlySyncRelativePath(file.relativePath))
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
    if (isLocalOnlySyncRelativePath(file.relativePath)) return;
    const sourcePath = getMirrorFilePath(mirrorPath, file.relativePath);
    if (file.scope === 'database') return;
    // Los recursos se descargan bajo demanda. Esto evita bloquear el inicio por
    // videos, imagenes o documentos grandes que Drive aun este transfiriendo.
    if (isResourceFile(file)) return;
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
  persistExpectedResourceCatalog(mirrorPath, manifest);
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

  const safeScalar = (sql) => {
    try {
      const row = db.prepare(sql).get();
      return Number(row?.total || 0);
    } catch {
      return 0;
    }
  };

  return {
    programaciones: safeCount('programacion_anual'),
    programacionesConMetas: safeScalar(`
      SELECT COUNT(*) as total
      FROM programacion_anual
      WHERE metas_datos IS NOT NULL
        AND TRIM(metas_datos) <> ''
        AND TRIM(metas_datos) <> '[]'
    `),
    datosGenerales: safeCount('datos_generales'),
    unidades: safeCount('unidades_didacticas'),
    sesiones: safeCount('sesiones'),
    estudiantes: safeCount('db_estudiantes'),
    egresados: safeCount('db_egresados'),
    asistencias: safeCount('asistencia_registros'),
    rostros: safeCount('asistencia_rostros'),
    evaluaciones: safeCount('evaluacion_registros'),
    evidencias: safeCount('evaluacion_evidencias'),
  };
};

const getSyncEntityCountsFromDump = (dump) => ({
  programaciones: Array.isArray(dump?.tables?.programacion_anual) ? dump.tables.programacion_anual.length : 0,
  programacionesConMetas: Array.isArray(dump?.tables?.programacion_anual)
    ? dump.tables.programacion_anual.filter((row) => {
        const raw = String(row?.metas_datos ?? '').trim();
        return raw && raw !== '[]' && raw !== 'null';
      }).length
    : 0,
  datosGenerales: Array.isArray(dump?.tables?.datos_generales) ? dump.tables.datos_generales.length : 0,
  unidades: Array.isArray(dump?.tables?.unidades_didacticas) ? dump.tables.unidades_didacticas.length : 0,
  sesiones: Array.isArray(dump?.tables?.sesiones) ? dump.tables.sesiones.length : 0,
  estudiantes: Array.isArray(dump?.tables?.db_estudiantes) ? dump.tables.db_estudiantes.length : 0,
  egresados: Array.isArray(dump?.tables?.db_egresados) ? dump.tables.db_egresados.length : 0,
  asistencias: Array.isArray(dump?.tables?.asistencia_registros) ? dump.tables.asistencia_registros.length : 0,
  rostros: Array.isArray(dump?.tables?.asistencia_rostros) ? dump.tables.asistencia_rostros.length : 0,
  evaluaciones: Array.isArray(dump?.tables?.evaluacion_registros) ? dump.tables.evaluacion_registros.length : 0,
  evidencias: Array.isArray(dump?.tables?.evaluacion_evidencias) ? dump.tables.evaluacion_evidencias.length : 0,
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

  let response = await postAppsScript({
    action: 'sync_pull_artifact',
    ...buildAppsScriptSyncPayload(config),
    artifactId: String(artifactId || '').trim(),
    artifactKind: normalizeArtifactKind(artifactKind),
  }, 240000);
  response = await hydrateChunkedPackageResponse(response, config);

  if (!response.success) {
    return { success: false, message: response.message || 'No se pudo descargar la copia seleccionada desde Drive.' };
  }

  return { success: true, data: response.data || null };
};

const resolveArtifactManifest = (remoteManifest, extractedManifest) => {
  if (remoteManifest?.files) return remoteManifest;
  if (remoteManifest?.manifest?.files) return remoteManifest.manifest;
  if (extractedManifest?.files) return extractedManifest;
  return remoteManifest || extractedManifest || null;
};

export const resolveCloudConflict = async ({ artifactId = '' } = {}) => {
  const config = readConfig();
  const conflictId = String(artifactId || '').trim();
  if (config.mode !== 'apps_script_drive') {
    return { success: false, message: 'Esta funcion solo esta disponible cuando la sincronizacion por Drive esta activada.' };
  }
  if (!conflictId) {
    return { success: false, message: 'Falta indicar el conflicto que deseas marcar como resuelto.' };
  }

  const response = await postAppsScript({
    action: 'sync_resolve_conflict',
    ...buildAppsScriptSyncPayload(config),
    conflictId,
  }, 120000);

  if (!response.success) {
    return { success: false, message: response.message || 'No se pudo marcar el conflicto como resuelto.' };
  }

  return {
    success: true,
    message: response.message || 'Conflicto marcado como resuelto.',
    data: response.data || null,
  };
};

export const clearCloudVersionHistory = async () => {
  const config = readConfig();
  if (config.mode !== 'apps_script_drive') {
    return { success: false, message: 'Esta funcion solo esta disponible cuando la sincronizacion por Drive esta activada.' };
  }

  const response = await postAppsScript({
    action: 'sync_clear_versions',
    ...buildAppsScriptSyncPayload(config),
  }, 120000);

  if (!response.success) {
    return { success: false, message: response.message || 'No se pudo limpiar el historial de versiones.' };
  }

  return {
    success: true,
    message: response.message || 'Historial de versiones archivado correctamente.',
    data: response.data || null,
  };
};

const mergeAttendanceTablesFromDump = (dump) => {
  const translate = createDumpReferenceTranslator(db,dump);
  const attendanceRows = (Array.isArray(dump?.tables?.asistencia_registros) ? dump.tables.asistencia_registros : []).map(row => translate('asistencia_registros',row));
  const faceRows = (Array.isArray(dump?.tables?.asistencia_rostros) ? dump.tables.asistencia_rostros : []).map(row => translate('asistencia_rostros',row));
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
  const identity = createSyncReferenceIdentity(db);
  const sourceReferences = identity.legacyCatalog(dump?.tables || {});
  const incomingStudentRows = Array.isArray(dump?.tables?.db_estudiantes) ? dump.tables.db_estudiantes : [];
  const incomingStudentTombstones = Array.isArray(dump?.tables?.student_deletion_tombstones)
    ? dump.tables.student_deletion_tombstones.map(row => identity.portable('student_deletion_tombstones',row,sourceReferences))
    : [];
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

  const localStudentTombstones = db.prepare('SELECT student_id, dni FROM student_deletion_tombstones').all()
    .map(row => identity.portable('student_deletion_tombstones',row));
  const tombstoneIds = new Set();
  const tombstoneDnis = new Set();
  [...localStudentTombstones, ...incomingStudentTombstones].forEach((row) => {
    const id = String(row?.student_id || '').trim();
    const dni = String(row?.dni || '').trim();
    if (id.startsWith('@student:')) tombstoneIds.add(id);
    if (/^\d{8}$/.test(dni) && !/^(\d)\1{7}$/.test(dni)) tombstoneDnis.add(dni);
  });
  const isDeletedStudent = (row) => tombstoneDnis.has(String(row?.dni || '').trim())
    || tombstoneIds.has(identity.catalog().students[String(row?.id)]?.token);
  const studentRows = incomingStudentRows.filter((row) => !tombstoneDnis.has(String(row.dni || '').trim())
    && !tombstoneIds.has(sourceReferences.students[String(row.id)]?.token));
  const existingStudents = db.prepare('SELECT * FROM db_estudiantes').all();
  const existingGraduates = db.prepare('SELECT * FROM db_egresados').all();
  const studentKeyMap = new Map(existingStudents.map((row) => [buildStudentIdentityKey(row, 'student'), row]));
  const graduateKeyMap = new Map(existingGraduates.map((row) => [buildStudentIdentityKey(row, 'graduate'), row]));
  const graduateByDni = new Map(existingGraduates.filter((row) => String(row?.dni || '').trim()).map((row) => [String(row.dni).trim(), row]));

  const transaction = db.transaction(() => {
    const saveStudentTombstone = db.prepare(`
      INSERT INTO student_deletion_tombstones (student_id, dni, student_name, deleted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_id) DO UPDATE SET
        dni = excluded.dni,
        student_name = excluded.student_name,
        deleted_at = excluded.deleted_at
    `);
    const insertStudent = db.prepare(`
      INSERT INTO db_estudiantes (
        nivel, dni, estudiantes, grado, secc, fecha_nacimiento, gmail, outlook, estado, grupo, sexo, edad, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStudent = db.prepare(`
      UPDATE db_estudiantes
      SET nivel = ?, dni = ?, estudiantes = ?, grado = ?, secc = ?, fecha_nacimiento = ?, gmail = ?, outlook = ?, estado = ?, grupo = ?, sexo = ?, edad = ?, updated_at = ?
      WHERE id = ?
    `);
    const deleteStudent = db.prepare('DELETE FROM db_estudiantes WHERE id = ?');
    const insertGraduate = db.prepare(`
      INSERT INTO db_egresados (
        estudiante_id_origen, nivel, dni, estudiantes, grado, secc, fecha_nacimiento, gmail, outlook, estado, grupo, sexo, edad, egresado_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateGraduate = db.prepare(`
      UPDATE db_egresados
      SET estudiante_id_origen = ?, nivel = ?, dni = ?, estudiantes = ?, grado = ?, secc = ?, fecha_nacimiento = ?, gmail = ?, outlook = ?, estado = ?, grupo = ?, sexo = ?, edad = ?, egresado_at = ?
      WHERE id = ?
    `);

    incomingStudentTombstones.forEach((row) => {
      const portable = identity.portable('student_deletion_tombstones',row,sourceReferences);
      const studentId = String(portable?.student_id || '').trim();
      if (!studentId) return;
      saveStudentTombstone.run(
        studentId,
        String(row?.dni || '').trim(),
        String(row?.student_name || '').trim(),
        row?.deleted_at || new Date().toISOString(),
      );
    });
    existingStudents.filter(isDeletedStudent).forEach((row) => deleteStudent.run(row.id));

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
          row?.fecha_nacimiento ?? '',
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
          row?.fecha_nacimiento ?? existing.fecha_nacimiento ?? '',
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
          row?.fecha_nacimiento ?? '',
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
          row?.fecha_nacimiento ?? existingGraduate.fecha_nacimiento ?? '',
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
  const regressions = [
    'programaciones',
    'programacionesConMetas',
    'datosGenerales',
    'unidades',
    'sesiones',
    'asistencias',
    'rostros',
    'evaluaciones',
    'evidencias',
  ]
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

const buildSyncStatus = async () => {
  const config = readConfig();
  const resolvedMirror = resolveEffectiveMirrorPath(config);
  let localManifest = null;
  const savedManifest = readJsonFile(localManifestPath, null);
  const driveCandidates = detectGoogleDriveCandidates(config.syncUserKey);
  const existingMirrorPaths = detectExistingMirrorPaths(config.syncUserKey, driveCandidates);
  const driveDesktopHealth = await getDriveDesktopHealth(config, resolvedMirror, driveCandidates);
  const incrementalInspection = config.mode === 'drive_mirror' && resolvedMirror.mirrorPath
    ? await incrementalMirrorSync.inspectAsync({ mirrorPath: resolvedMirror.mirrorPath })
    : null;
  const continuousLocalChangesPending = config.mode === 'drive_mirror'
    && !!resolvedMirror.mirrorPath
    && getContinuousSourceSignature() !== continuousMirrorSyncedSignature;
  if (!continuousMirrorTickRunning && (incrementalInspection?.pending
    || incrementalInspection?.initialized === false
    || continuousLocalChangesPending)) {
    requestContinuousMirrorSync({ delayMs: 150 });
  }
  const remoteState = readJsonFile(remoteSyncStatePath, {});
  let mirrorManifest = config.mode === 'drive_mirror' && resolvedMirror.mirrorPath
    ? await readMirrorJsonAsync(getMirrorFilePath(resolvedMirror.mirrorPath, 'manifest.json'))
    : null;
  let remoteUser = null;
  let remoteActivity = null;
  let remoteLookupMessage = '';
  if (config.mode === 'apps_script_drive') {
    const remoteStatus = await postAppsScript({
      action: 'sync_status',
      ...buildAppsScriptSyncPayload(config),
    }, 45000);
    if (remoteStatus.success) {
      mirrorManifest = remoteStatus.data?.manifest || null;
      remoteUser = normalizeRemoteFolderInfo(remoteStatus.data?.user);
      remoteActivity = remoteStatus.data?.activity || null;
      if (remoteUser) {
        persistRemoteFolderInfo(remoteUser, config);
      }
      if (mirrorManifest) {
        persistObservedRemoteSyncState(mirrorManifest, config);
      }
    } else {
      remoteLookupMessage = String(remoteStatus.message || '').trim();
    }
  }
  const additiveMerge = null;
  // Consultar el estado nunca debe exportar la BD ni recorrer todos los recursos.
  // Las operaciones manuales de respaldo siguen construyendo el manifiesto completo.
  localManifest = buildLightweightLocalManifest(savedManifest || mirrorManifest);
  const integrity = config.mode === 'drive_mirror' && resolvedMirror.mirrorPath
    ? verifyMirrorIntegrity(resolvedMirror.mirrorPath, mirrorManifest)
    : { ok: true, code: 'not-applicable', missingFiles: [] };
  if (config.mode === 'drive_mirror' && resolvedMirror.mirrorPath && mirrorManifest?.files) {
    const currentCatalog = getExpectedResourceCatalog();
    if (String(currentCatalog.manifestDigest || '') !== String(mirrorManifest.digest || '')
      || path.resolve(String(currentCatalog.mirrorPath || appRoot)) !== path.resolve(resolvedMirror.mirrorPath)) {
      persistExpectedResourceCatalog(resolvedMirror.mirrorPath, mirrorManifest);
    }
  }

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
        remoteUser: remoteUser || normalizeRemoteFolderInfo(config.remoteFolderInfo),
        remoteActivity,
        remoteLookupMessage,
        lastCloudVersion: remoteState.lastCloudVersion || '',
      },
      localManifest,
      savedManifest,
      mirrorManifest,
      additiveMerge,
      mirrorOperation: config.mode === 'drive_mirror' && resolvedMirror.mirrorPath
        ? readLatestMirrorOperation(resolvedMirror.mirrorPath, mirrorManifest)
        : null,
      comparison: integrity.ok
        ? (incrementalInspection?.pending || continuousLocalChangesPending)
          ? 'incremental-pending'
          : incrementalInspection?.initialized
            ? 'in-sync'
            : compareSyncManifests(savedManifest || localManifest, mirrorManifest, config.mode, savedManifest)
        : integrity.code === 'missing-manifest'
          ? 'mirror-missing'
          : integrity.code,
      lastFrontendStateAt: readJsonFile(frontendStatePath, null)?.exportedAt || null,
      driveDesktop: {
        detected: driveDesktopHealth.installed,
        candidates: driveCandidates,
        existingMirrors: existingMirrorPaths,
        ...driveDesktopHealth,
      },
      internetConnectivity: internetConnectivity.snapshot(),
      downloadProgress: downloadProgress.snapshot(),
      resourceConflicts: resourceConflicts.list(),
      receivedChanges,
      activeTransfers: Array.from(activeResourceTransfers.values()).map(({ promise: _promise, ...transfer }) => transfer),
      mirrorTransfer: activeMirrorTransfer ? { ...activeMirrorTransfer } : null,
      pendingLocal: readPendingLocalState(),
      incrementalSync: {
        ...incrementalMirrorSync.getState(),
        inspection: {
          ...(incrementalInspection || {}),
          continuousLocalChangesPending,
        },
      },
      continuousSync: { ...continuousMirrorState },
      resourceDelivery: summarizeResourceDelivery(),
      frontendState: readJsonFile(frontendStatePath, { keys: {} }),
      safety: {
        restorePointsPath: snapshotsFolder,
        retention: SAFETY_RETENTION,
        missingMirrorFiles: integrity.missingFiles,
        missingMirrorCoreFiles: integrity.missingCoreFiles,
        pendingMirrorResources: integrity.pendingResourceFiles,
      },
    },
  };
};

let syncStatusInFlight = null;
export const getSyncStatus = async () => {
  if (syncStatusInFlight) return syncStatusInFlight;
  syncStatusInFlight = buildSyncStatus().finally(() => {
    syncStatusInFlight = null;
  });
  return syncStatusInFlight;
};

const mergeEvidenceTablesFromDump = (dump, evidenceRoot) => {
  const translate = createDumpReferenceTranslator(db,dump);
  const incomingRows = (Array.isArray(dump?.tables?.evaluacion_evidencias) ? dump.tables.evaluacion_evidencias : []).map(row => translate('evaluacion_evidencias',row));
  if (!evidenceRoot || !pathExists(evidenceRoot) || incomingRows.length === 0) {
    return { inserted: 0, updated: 0, waitingForFile: 0 };
  }
  const tableColumns = db.prepare('PRAGMA table_info(evaluacion_evidencias)').all().map((column) => column.name);
  const allowedColumns = new Set(tableColumns.filter((column) => column !== 'id'));
  const tombstoneKeys = listEvidenceTombstoneKeys(evidenceRoot);
  let inserted = 0;
  let updated = 0;
  let waitingForFile = 0;
  const timestamp = (value) => Date.parse(String(value || '').replace(' ', 'T') + (String(value || '').includes('Z') ? '' : 'Z')) || 0;

  const transaction = db.transaction(() => {
    incomingRows.forEach((row) => {
      const relativePath = String(row?.relative_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!relativePath) return;
      const absolutePath = path.resolve(evidenceRoot, ...relativePath.split('/'));
      const check = path.relative(path.resolve(evidenceRoot), absolutePath);
      if (check.startsWith('..') || path.isAbsolute(check) || !pathExists(absolutePath)) {
        waitingForFile += 1;
        return;
      }
      const actualSize = Number(safeStat(absolutePath)?.size || 0);
      if (Number(row?.file_size || 0) > 0 && Number(row.file_size) !== actualSize) {
        waitingForFile += 1;
        return;
      }
      const evidenceKey = String(row?.evidence_key || portableEvidenceKey(relativePath));
      if (tombstoneKeys.has(evidenceKey)) return;
      const existing = db.prepare(`
        SELECT * FROM evaluacion_evidencias
        WHERE evidence_key = ? OR REPLACE(relative_path, '\\', '/') = ?
        ORDER BY CASE WHEN evidence_key = ? THEN 0 ELSE 1 END, id LIMIT 1
      `).get(evidenceKey, relativePath, evidenceKey);
      const portableRow = {
        ...row,
        evidence_key: evidenceKey,
        file_path: '',
        relative_path: relativePath,
        file_size: actualSize,
      };
      const columns = Object.keys(portableRow).filter((column) => allowedColumns.has(column));
      if (!existing) {
        db.prepare(`
          INSERT INTO evaluacion_evidencias (${columns.map((column) => `"${column}"`).join(', ')})
          VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map((column) => portableRow[column] ?? null));
        inserted += 1;
        return;
      }
      const incomingAt = row?.updated_at || row?.submitted_at || '';
      const existingAt = existing?.updated_at || existing?.submitted_at || '';
      if (!existing.evidence_key || timestamp(incomingAt) > timestamp(existingAt)) {
        const updateColumns = columns.filter((column) => column !== 'id');
        db.prepare(`
          UPDATE evaluacion_evidencias
          SET ${updateColumns.map((column) => `"${column}" = ?`).join(', ')}
          WHERE id = ?
        `).run(...updateColumns.map((column) => portableRow[column] ?? null), existing.id);
        updated += 1;
      }
    });
  });
  transaction();
  reconcileEvidenceMirrorIndex({ db, root: evidenceRoot });
  return { inserted, updated, waitingForFile };
};

let lastAdditiveMergeKey = '';
const mergeAdditiveMirrorData = (mirrorPath, mirrorManifest) => {
  if (!mirrorPath || !mirrorManifest?.digest) return null;
  const beforeSignature = getDatabaseSourceSignature();
  const mergeKey = `${mirrorManifest.digest}|${beforeSignature}`;
  if (mergeKey === lastAdditiveMergeKey) return null;
  const dump = readJsonFile(getMirrorFilePath(mirrorPath, 'database/database-dump.json'), null);
  if (!dump?.tables) return null;
  const attendance = mergeAttendanceTablesFromDump(dump);
  const evidences = mergeEvidenceTablesFromDump(dump, path.join(mirrorPath, 'Evidencias de estudiantes'));
  lastAdditiveMergeKey = `${mirrorManifest.digest}|${getDatabaseSourceSignature()}`;
  return { attendance, evidences };
};

export const getLocalSyncStatus = async ({ lightweight = false } = {}) => {
  const config = readConfig();
  const resolvedMirror = resolveEffectiveMirrorPath(config);
  const savedManifest = readJsonFile(localManifestPath, null);
  const pendingLocal = readPendingLocalState();
  const currentSourceSignature = config.mode === 'drive_mirror'
    ? getContinuousSourceSignature()
    : '';
  if (config.mode === 'drive_mirror' && resolvedMirror.mirrorPath) {
    await internetConnectivity.check({ wait: false });
    // Polling a finished transfer must not start another one. Only new work
    // needs the queue; an active pass already owns the completion checkpoint.
    if (!continuousMirrorTickRunning) {
      const inspection = await incrementalMirrorSync.inspectAsync({ mirrorPath: resolvedMirror.mirrorPath });
      if (currentSourceSignature !== continuousMirrorSyncedSignature || !inspection.initialized || inspection.pending) {
        requestContinuousMirrorSync({ delayMs: 150 });
      }
    }
  }
  const mirrorPrepared = config.mode === 'drive_mirror'
    && !!resolvedMirror.mirrorPath
    && !!continuousMirrorSyncedSignature
    && currentSourceSignature === continuousMirrorSyncedSignature
    && ['in-sync', 'waiting-for-drive'].includes(continuousMirrorState.state);
  // In mirror mode pending changes are determined by the source revision below.
  // A status read must not export and hash the entire database/resources while
  // another incremental pass is running. Explicit backup operations still do so.
  const localManifest = mirrorPrepared ? savedManifest
    : config.mode === 'drive_mirror' || lightweight ? buildLightweightLocalManifest(savedManifest)
    : buildLocalManifest();
  const localDigest = getComparableManifestDigest(localManifest);
  const savedDigest = getComparableManifestDigest(savedManifest);
  const hasUnsyncedChanges = config.mode === 'drive_mirror'
    ? !mirrorPrepared
    : lightweight && config.mode === 'local' ? false : !savedDigest || localDigest !== savedDigest;

  return {
    success: true,
    data: {
      config: {
        ...config,
        syncUserKey: sanitizeUserScope(config.syncUserKey),
        syncUserLabel: normalizeUserLabel(config.syncUserLabel),
      },
      localManifest,
      savedManifest,
      pendingLocal,
      incrementalSync: incrementalMirrorSync.getState(),
      continuousSync: { ...continuousMirrorState },
      hasUnsyncedChanges,
      internetConnectivity: internetConnectivity.snapshot(),
      activeTransfers: Array.from(activeResourceTransfers.values()).map(({ promise: _promise, ...transfer }) => transfer),
      mirrorTransfer: activeMirrorTransfer ? { ...activeMirrorTransfer } : null,
      downloadProgress: downloadProgress.snapshot(),
      resourceConflicts: resourceConflicts.list(),
      receivedChanges,
      mirrorPrepared,
      ...(lightweight ? {} : {
        lastFrontendStateAt: readJsonFile(frontendStatePath, null)?.exportedAt || null,
        frontendState: readJsonFile(frontendStatePath, { keys: {} }),
      }),
    },
  };
};

let continuousMirrorTimer = null;
let continuousMirrorInitialTimer = null;
let dataMirrorTimer = null;
let dataMirrorWriteTimer = null;
let dataMirrorRunning = null;

// Grades and evidence metadata must keep moving even while a large resource
// copy is waiting for Drive. This lane never copies evidence binaries.
const runDataMirrorTick = () => {
  if (dataMirrorRunning) return dataMirrorRunning;
  dataMirrorRunning = (async () => {
    const config = readConfig();
    const mirror = resolveEffectiveMirrorPath(config).mirrorPath;
    if (config.mode !== 'drive_mirror' || !mirror) return { success: true };
    const result = await runIncrementalMirrorSync(mirror);
    if (result.success) frontendStateStore.snapshot();
    return result;
  })().finally(() => { dataMirrorRunning = null; });
  return dataMirrorRunning;
};
let continuousMirrorWatchers = [];
let continuousMirrorWatchedPath = '';
let continuousMirrorRerunRequested = false;
let continuousMirrorTickRunning = false;
let continuousMirrorCandidateSignature = '';
let continuousMirrorCandidateSince = 0;
let continuousMirrorSyncedSignature = '';
let continuousMirrorSyncedResourceSignature = '';
let continuousMirrorState = {
  enabled: false,
  state: 'inactive',
  message: 'La sincronizacion continua esta inactiva.',
  updatedAt: null,
};

const getContinuousSourceSignature = () => {
  const frontendStats = safeStat(frontendStatePath);
  return [
    getDatabaseSourceSignature(),
    frontendStats ? `frontend:${frontendStats.size}:${frontendStats.mtimeMs}` : 'frontend:missing',
    `resources:${getContinuousResourceSourceSignature()}`,
  ].join('|');
};

const updateContinuousMirrorState = (next) => {
  continuousMirrorState = {
    ...continuousMirrorState,
    ...next,
    updatedAt: new Date().toISOString(),
  };
};

const stopContinuousMirrorWatchers = () => {
  continuousMirrorWatchers.forEach((watcher) => watcher.close());
  continuousMirrorWatchers = [];
  continuousMirrorWatchedPath = '';
};

const ensureContinuousMirrorWatchers = (mirrorPath) => {
  if (continuousMirrorWatchedPath === mirrorPath) return;
  stopContinuousMirrorWatchers();
  const watch = (root, relevant) => {
    try {
      const watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        if (relevant(String(filename || '').replace(/\\/g, '/'))) requestContinuousMirrorSync({ delayMs: 750 });
      });
      watcher.on('error', () => {
        watcher.close();
        continuousMirrorWatchedPath = '';
      });
      continuousMirrorWatchers.push(watcher);
    } catch { /* The periodic scan remains active if notifications are unavailable. */ }
  };
  watch(uploadsRoot, (name) => name.startsWith('session-resources/') || name.startsWith('user-assets/'));
  watch(mirrorPath, (name) => name.endsWith('.json') && (
    name.includes('/incremental-v1/') || name.includes('/resource-catalog-v1/')
  ));
  continuousMirrorWatchedPath = mirrorPath;
};

const runContinuousMirrorTick = async (quietMs) => {
  if (resourceResolutionRunning) return { retry: true };
  if (continuousMirrorTickRunning) {
    continuousMirrorRerunRequested = true;
    return { retry: true };
  }
  continuousMirrorTickRunning = true;
  try {
    const config = readConfig();
    const effectiveMirror = resolveEffectiveMirrorPath(config);
    if (config.mode !== 'drive_mirror') {
      stopContinuousMirrorWatchers();
      updateContinuousMirrorState({ enabled: false, state: 'inactive', message: 'El modo carpeta espejo no esta activo.' });
      return;
    }
    if (!effectiveMirror.mirrorPath) {
      updateContinuousMirrorState({ enabled: true, state: 'waiting-for-folder', message: 'Esperando que la carpeta espejo vuelva a estar disponible.' });
      return;
    }

    ensureContinuousMirrorWatchers(effectiveMirror.mirrorPath);
    const sourceBeforeSync = getDatabaseSourceSignature();
    updateContinuousMirrorState({ enabled: true, state: 'syncing', message: 'Sincronizando cambios pequeños en segundo plano.', progress: null });
    const incrementalInspection = await incrementalMirrorSync.inspectAsync({ mirrorPath: effectiveMirror.mirrorPath });
    const incrementalResult = (!incrementalInspection.initialized || incrementalInspection.pending)
      ? await runDataMirrorTick()
      : { success: true, data: incrementalMirrorSync.getState() };
    if (!incrementalResult?.success) {
      updateContinuousMirrorState({
        enabled: true,
        state: 'pending',
        message: incrementalResult?.message || 'Los datos permanecen locales y se reintentara la sincronizacion.',
        lastErrorAt: new Date().toISOString(),
      });
      return { success: false, message: incrementalResult?.message || continuousMirrorState.message };
    }
    // Consume current row events before using a legacy full snapshot as fallback.
    frontendStateStore.importMissing(await readMirrorJsonAsync(getMirrorFilePath(effectiveMirror.mirrorPath, 'state/frontend-local-storage.json')));
    frontendStateStore.snapshot();
    const localResources = listContinuousLocalResources();
    const resourceSignature = buildContinuousResourceSourceSignature(localResources);
    const resourceResult = resourceSignature !== continuousMirrorSyncedResourceSignature
      ? await publishContinuousResourcesToMirror(effectiveMirror.mirrorPath, localResources)
      : {
          copiedFiles: 0,
          copiedBytes: 0,
          publishedFiles: localResources.length,
          visibleFiles: (await refreshExpectedResourceCatalogFromMirror(effectiveMirror.mirrorPath)).length,
          sourceSignature: resourceSignature,
        };
    const driveHealth = await getDriveDesktopHealth(
      config,
      effectiveMirror,
      detectGoogleDriveCandidates(config.syncUserKey)
    );
    continuousMirrorSyncedResourceSignature = resourceResult.sourceSignature || resourceSignature;
    const frontendStats = safeStat(frontendStatePath);
    continuousMirrorSyncedSignature = [
      getDatabaseSourceSignature(),
      frontendStats ? `frontend:${frontendStats.size}:${frontendStats.mtimeMs}` : 'frontend:missing',
      `resources:${continuousMirrorSyncedResourceSignature}`,
    ].join('|');
    continuousMirrorCandidateSignature = continuousMirrorSyncedSignature;
    continuousMirrorCandidateSince = Date.now();
    if (sourceBeforeSync !== getDatabaseSourceSignature()) {
      continuousMirrorRerunRequested = true;
      continuousMirrorSyncedSignature = '';
      updateContinuousMirrorState({ enabled: true, state: 'pending', message: 'Hay cambios nuevos; la siguiente copia ya esta programada.' });
      return { retry: true };
    }
    if (driveHealth.state !== 'ready') {
      updateContinuousMirrorState({
        enabled: true,
        state: 'waiting-for-drive',
        message: driveHealth.message || 'Los cambios estan seguros en esta PC y esperan a Google Drive.',
        lastErrorAt: new Date().toISOString(),
      });
      return;
    }
    if (incrementalResult.data?.pendingOperations) {
      updateContinuousMirrorState({ enabled: true, state: 'pending',
        message: incrementalResult.data.message || 'Drive aun debe entregar cambios pendientes.' });
      return;
    }
    if (resourceConflicts.list().length) {
      updateContinuousMirrorState({ enabled: true, state: 'needs-review', message: 'Hay recursos con dos versiones. Elige cuál conservar.' });
      return;
    }
    clearPendingLocalState();
    updateContinuousMirrorState({
      enabled: true,
      state: 'in-sync',
      message: resourceResult.copiedFiles
        ? `${resourceResult.copiedFiles} archivo${resourceResult.copiedFiles === 1 ? '' : 's'} nuevo${resourceResult.copiedFiles === 1 ? '' : 's'} quedó${resourceResult.copiedFiles === 1 ? '' : 'aron'} en la carpeta espejo.`
        : (incrementalResult.data?.message || 'Todos los cambios visibles quedaron en la carpeta espejo.'),
      resourceFilesCopied: resourceResult.copiedFiles,
      resourceBytesCopied: resourceResult.copiedBytes,
      visibleResourceFiles: resourceResult.visibleFiles,
      lastSuccessAt: new Date().toISOString(),
    });
    return;
  } catch (error) {
    updateContinuousMirrorState({
      enabled: true,
      state: 'pending',
      message: `La sincronizacion continua reintentara los cambios. ${error?.message || ''}`.trim(),
      lastErrorAt: new Date().toISOString(),
    });
    return { success: false, message: continuousMirrorState.message };
  } finally {
    continuousMirrorTickRunning = false;
    if (continuousMirrorRerunRequested) {
      continuousMirrorRerunRequested = false;
      requestContinuousMirrorSync({ delayMs: 100 });
    }
  }
};

const continuousWriteQueue = createContinuousSyncQueue(() => runContinuousMirrorTick(0));
export const requestContinuousMirrorSync = ({ delayMs = 1_000 } = {}) => {
  continuousWriteQueue.request(delayMs);
  if (!dataMirrorWriteTimer) {
    dataMirrorWriteTimer = setTimeout(() => {
      dataMirrorWriteTimer = null;
      void runDataMirrorTick().catch(() => {});
    }, Math.min(250, delayMs));
    dataMirrorWriteTimer.unref?.();
  }
};

export const startContinuousMirrorSync = ({ intervalMs = 30_000, quietMs = 12_000, initialDelayMs = 2_000 } = {}) => {
  if (continuousMirrorTimer) return () => {};
  updateContinuousMirrorState({ enabled: true, state: 'starting', message: 'Iniciando vigilancia continua de la carpeta espejo.' });
  continuousMirrorTimer = setInterval(() => runContinuousMirrorTick(quietMs), intervalMs);
  continuousMirrorTimer.unref?.();
  dataMirrorTimer = setInterval(() => { void runDataMirrorTick().catch(() => {}); }, 5_000);
  dataMirrorTimer.unref?.();
  continuousMirrorInitialTimer = setTimeout(() => runContinuousMirrorTick(quietMs), Math.max(500, Number(initialDelayMs) || 2_000));
  continuousMirrorInitialTimer.unref?.();
  return () => {
    if (continuousMirrorTimer) clearInterval(continuousMirrorTimer);
    incrementalMirrorSync.stopMaintenance();
    continuousWriteQueue.stop();
    clearInterval(dataMirrorTimer);
    clearTimeout(dataMirrorWriteTimer);
    dataMirrorTimer = null;
    dataMirrorWriteTimer = null;
    clearTimeout(continuousMirrorInitialTimer);
    stopContinuousMirrorWatchers();
    continuousMirrorTimer = null;
    continuousMirrorInitialTimer = null;
    updateContinuousMirrorState({ enabled: false, state: 'stopped', message: 'La vigilancia continua se detuvo.' });
  };
};

export const bootstrapPortableState = async (localKeys = {}) => {
  const config = readConfig();
  const mirror = resolveEffectiveMirrorPath(config).mirrorPath;
  const mirrorEnabled = config.mode === 'drive_mirror' && Boolean(mirror);
  const mirrorAvailable = mirrorEnabled && fs.existsSync(mirror);

  let recoveryPending = false;
  if (mirrorAvailable) {
    // Recover small row events independently of media and Drive health. A slow
    // placeholder must never keep the teacher behind the startup screen.
    const recovery = (async () => {
      const result = await runDataMirrorTick();
      if (!result?.success || result.data?.pendingOperations) return result;
      frontendStateStore.importMissing({ keys: localKeys });
      frontendStateStore.snapshot();
      requestContinuousMirrorSync({ delayMs: 250 });
      return result;
    })().catch(error => ({ success: false, message: error.message }));
    let timeout;
    const result = await Promise.race([
      recovery,
      new Promise(resolve => { timeout = setTimeout(() => resolve(null), 2_500); }),
    ]);
    clearTimeout(timeout);
    recoveryPending = !result?.success || Boolean(result.data?.pendingOperations);
  } else {
    frontendStateStore.observe(localKeys);
  }

  const stored = frontendStateStore.snapshot();
  const frontendState = recoveryPending
    ? { ...stored, keys: { ...localKeys, ...stored.keys } }
    : stored;
  frontendStateStore.acknowledge(frontendState.keys);

  // New local settings still publish through the shared continuous queue.
  if (mirrorEnabled) {
    requestContinuousMirrorSync({ delayMs: 250 });
  }

  return {
    success: true,
    data: {
      frontendState,
      continuousSync: { ...continuousMirrorState },
      recoveryPending,
      mirrorAvailable,
    },
  };
};

export const getContinuousMirrorSyncState = () => ({ ...continuousMirrorState });

export const isContinuousMirrorSyncBusy = () => continuousMirrorTickRunning;

export const updateSyncConfig = async (payload = {}) => {
  const mode = payload.mode === 'drive_mirror'
    ? 'drive_mirror'
    : payload.mode === 'apps_script_drive'
      ? 'apps_script_drive'
      : 'local';
  const syncUserKey = sanitizeUserScope(payload.syncUserKey);
  const syncUserLabel = normalizeUserLabel(payload.syncUserLabel || payload.syncUserKey);
  const mirrorPath = typeof payload.mirrorPath === 'string' ? payload.mirrorPath.trim() : '';
  const autoSyncOnClose = mode === 'drive_mirror' ? true : payload.autoSyncOnClose !== false;
  const resolvedMirror = resolveEffectiveMirrorPath({ mirrorPath, syncUserKey });

  if (mode === 'drive_mirror' && !resolvedMirror.mirrorPath) {
    return { success: false, message: 'No pude detectar Google Drive en esta computadora para crear la carpeta espejo del usuario.' };
  }
  if (mode === 'drive_mirror') {
    const driveCandidates = detectGoogleDriveCandidates(syncUserKey);
    const belongsToDetectedDrive = driveCandidates.some(({ basePath }) => {
      const relative = path.relative(path.resolve(basePath), path.resolve(resolvedMirror.mirrorPath));
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
    if (!belongsToDetectedDrive) {
      return {
        success: false,
        message: 'La carpeta seleccionada no esta dentro de "Mi unidad" de Google Drive. Selecciona Mi unidad o una carpeta ubicada dentro de ella.',
      };
    }
    const existingMarker = readJsonFile(path.join(resolvedMirror.mirrorPath, MIRROR_ROOT_MARKER), null);
    const markerUserKey = sanitizeUserScope(existingMarker?.syncUserKey || '');
    if (existingMarker?.syncUserKey && markerUserKey !== syncUserKey) {
      return {
        success: false,
        message: `Esta carpeta espejo pertenece a otro usuario de ARMI (${existingMarker.syncUserKey}). Selecciona Mi unidad o la carpeta correspondiente a ${syncUserLabel}.`,
      };
    }
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
    remoteUser = normalizeRemoteFolderInfo(prepared.data);
  }

  const nextConfig = saveConfig({
    mode,
    mirrorPath: mode === 'drive_mirror' ? resolvedMirror.mirrorPath : '',
    autoSyncOnClose,
    syncUserKey,
    syncUserLabel,
    remoteFolderInfo: mode === 'apps_script_drive' ? remoteUser : null,
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

const performPushToCloud = async (payload = {}) => {
  const force = payload?.force === true;
  const config = readConfig();
  const effectiveMirror = resolveEffectiveMirrorPath(config);
  const restorePoint = '';
  const baseManifest = readJsonFile(localManifestPath, null);
  stageLocalDatabaseDump();
  const localFiles = serializeLocalFiles();
  const localFilesByPath = new Map(localFiles.map((file) => [file.relativePath, file]));
  const manifest = buildManifestFromFiles(localFiles, 'local-app-storage', config.mode);
  const localCounts = getSyncEntityCounts();

  if (config.mode === 'apps_script_drive') {
    const remoteState = readJsonFile(remoteSyncStatePath, {});
    if (remoteState.lastCloudDigest && remoteState.lastCloudDigest === manifest.digest) {
      writeJsonAtomic(localManifestPath, manifest);
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
    const packageBase64 = await buildSyncPackageBase64(manifest);
    const response = await postChunkedSyncPackage({ config, manifest, packageBase64, remoteState });

    if (!response.success) {
      if (response.data?.currentManifest) {
        persistObservedRemoteSyncState(response.data.currentManifest, config);
      }
      return {
        success: false,
        message: response.message || 'No se pudo subir la copia a Drive.',
        conflict: response.conflict === true,
        data: response.data || null,
      };
    }

    const cloudManifest = response.data?.manifest || manifest;
    const remoteUser = normalizeRemoteFolderInfo(response.data?.user);
    if (remoteUser) {
      persistRemoteFolderInfo(remoteUser, config);
    }
    if (String(cloudManifest?.digest || '') !== String(manifest.digest || '')) {
      return {
        success: false,
        message: 'Drive no confirmó la misma copia que se intentó subir. La nube parece haberse quedado con una versión anterior.',
        data: {
          localDigest: manifest.digest,
          remoteDigest: cloudManifest?.digest || '',
          localCounts,
          restorePoint,
          remoteUser,
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
    clearPendingLocalState();
    return {
      success: true,
      data: {
        manifest: cloudManifest,
        mode: config.mode,
        counts: localCounts,
        restorePoint,
        remoteUser,
      },
    };
  }

  if (config.mode !== 'drive_mirror') {
    writeJsonAtomic(localManifestPath, manifest);
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

  const mirrorDeliveryHealth = await getDriveDesktopHealth(
    config,
    effectiveMirror,
    detectGoogleDriveCandidates(config.syncUserKey)
  );
  const cloudDeliveryPending = mirrorDeliveryHealth.state !== 'ready';

  const previousMirrorManifest = readMirrorManifest(effectiveMirror.mirrorPath);
  const integrity = previousMirrorManifest ? verifyMirrorIntegrity(effectiveMirror.mirrorPath, previousMirrorManifest) : { ok: true };
  if (!integrity.ok && integrity.code === 'mirror-incomplete') {
    return {
      success: false,
      message: 'La carpeta espejo está incompleta o alguien borró archivos manualmente. No subiré cambios hasta que revisemos esa copia para no perder información.',
      data: { missingFiles: integrity.missingFiles },
    };
  }

  let mirrorCounts = previousMirrorManifest?.summary?.entities || null;
  if (previousMirrorManifest && (!mirrorCounts || mirrorCounts.evidencias === undefined || mirrorCounts.evaluaciones === undefined)) {
    const previousMirrorDump = readJsonFile(getMirrorFilePath(effectiveMirror.mirrorPath, 'database/database-dump.json'), null);
    mirrorCounts = getSyncEntityCountsFromDump(previousMirrorDump);
  }
  const staleLocalRegression = mirrorCounts
    ? detectDestructiveCountRegression(mirrorCounts, localCounts)
    : { blocked: false, regressions: [] };
  if (staleLocalRegression.blocked && !force) {
    persistPendingLocalState({
      reason: 'local-copy-has-fewer-records',
      manifest,
      counts: localCounts,
      note: 'Esta PC tiene menos registros que Drive. Se bloqueo la subida para evitar perdida de datos.',
    });
    return {
      success: false,
      conflict: true,
      message: 'Esta PC tiene menos datos que la copia de Drive. No se sobrescribio nada. Primero recupera o combina la copia mas reciente.',
      data: {
        localCounts,
        mirrorCounts,
        missingLocally: staleLocalRegression.regressions.map((item) => ({
          key: item.key,
          drive: item.local,
          thisPc: item.remote,
          difference: item.local - item.remote,
        })),
      },
    };
  }

  const baseDigest = String(baseManifest?.digest || '');
  const mirrorDigest = String(previousMirrorManifest?.digest || '');
  const localDigest = String(manifest.digest || '');
  const mirrorChangedSinceLastKnownCopy = mirrorDigest
    && mirrorDigest !== localDigest
    && (!baseDigest || baseDigest !== mirrorDigest);
  if (mirrorChangedSinceLastKnownCopy && !force) {
    persistPendingLocalState({
      reason: 'mirror-changed-on-another-pc',
      manifest,
      counts: localCounts,
      note: 'Drive cambio desde la ultima copia conocida por esta PC. Se bloqueo la sobrescritura.',
    });
    return {
      success: false,
      conflict: true,
      message: 'Drive contiene cambios de otra PC que esta computadora todavia no ha incorporado. No se sobrescribio nada. Primero trae la copia de Drive y revisa las diferencias.',
      data: {
        baseDigest,
        localDigest,
        mirrorDigest,
      },
    };
  }

  const protectedMirrorBackup = mirrorChangedSinceLastKnownCopy && force
    ? backupMirrorSnapshot(effectiveMirror.mirrorPath, previousMirrorManifest)
    : '';

  if (previousMirrorManifest?.digest && previousMirrorManifest.digest === manifest.digest) {
    writeJsonAtomic(localManifestPath, previousMirrorManifest);
    persistExpectedResourceCatalog(effectiveMirror.mirrorPath, previousMirrorManifest);
    if (cloudDeliveryPending) {
      persistPendingLocalState({
        reason: `drive-desktop-${mirrorDeliveryHealth.state}`,
        manifest,
        counts: localCounts,
        note: mirrorDeliveryHealth.message,
      });
    } else {
      clearPendingLocalState();
    }
    persistMirrorSyncState(effectiveMirror.mirrorPath, {
      lastPushAt: new Date().toISOString(),
      lastOperation: 'push-no-changes',
      localDigest: manifest.digest,
      syncUserKey: sanitizeUserScope(config.syncUserKey),
    });
    return {
      success: true,
      data: {
        manifest: previousMirrorManifest,
        mode: config.mode,
        counts: localCounts,
        skippedUpload: true,
        cloudDeliveryPending,
        driveDesktop: mirrorDeliveryHealth,
        reason: 'same-digest',
        message: cloudDeliveryPending
          ? `La copia ya esta preparada en la carpeta espejo, pero sigue pendiente: ${mirrorDeliveryHealth.message}`
          : 'No hubo cambios nuevos para copiar a Drive.',
      },
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  ensureMirrorStructure(effectiveMirror.mirrorPath);
  backupMirrorManifest(effectiveMirror.mirrorPath, previousMirrorManifest);

  const previousFilesByPath = new Map(
    (previousMirrorManifest?.files || []).map((file) => [file.relativePath, file])
  );
  const previousPaths = new Set((previousMirrorManifest?.files || []).map((file) => file.relativePath));
  const currentPaths = new Set(manifest.files.map((file) => file.relativePath));
  const removedPaths = Array.from(previousPaths).filter((relativePath) => !currentPaths.has(relativePath));
  const changedFiles = manifest.files.filter((file) => {
    const previousFile = previousFilesByPath.get(file.relativePath);
    const destinationPath = getMirrorFilePath(effectiveMirror.mirrorPath, file.relativePath);
    return !(previousFile
      && previousFile.checksum === file.checksum
      && Number(previousFile.size || 0) === Number(file.size || 0)
      && pathExists(destinationPath));
  });
  const operationId = `${stamp}-${getDeviceId()}-${crypto.randomUUID().slice(0, 8)}`;
  writeMirrorOperationIntent(effectiveMirror.mirrorPath, operationId, manifest, changedFiles, removedPaths);

  let copiedFiles = 0;
  let copiedBytes = 0;
  const totalCopyBytes = changedFiles.reduce((total, file) => total + Number(file.size || 0), 0);
  activeMirrorTransfer = {
    operationId,
    state: 'copying-to-drive-folder',
    copiedFiles: 0,
    totalFiles: changedFiles.length,
    copiedBytes: 0,
    totalBytes: totalCopyBytes,
    currentFile: '',
    startedAt: new Date().toISOString(),
  };
  const orderedChangedFiles = [
    ...changedFiles.filter((file) => !isResourceFile(file)),
    ...changedFiles.filter(isResourceFile),
  ];
  for (const file of orderedChangedFiles) {
    const destinationPath = getMirrorFilePath(effectiveMirror.mirrorPath, file.relativePath);
    const sourcePath = localFilesByPath.get(file.relativePath)?.absolutePath;
    if (!sourcePath || !pathExists(sourcePath)) {
      throw new Error(`No se encontro el archivo local preparado para sincronizar: ${file.relativePath}`);
    }
    const bytesBeforeFile = copiedBytes;
    activeMirrorTransfer.currentFile = file.relativePath;
    try {
      await copyFileAtomicStreaming(sourcePath, destinationPath, ({ copiedBytes: currentFileBytes }) => {
        activeMirrorTransfer.copiedBytes = bytesBeforeFile + currentFileBytes;
      });
    } catch (error) {
      activeMirrorTransfer = {
        ...activeMirrorTransfer,
        state: 'error',
        message: error?.message || 'No se pudo copiar el archivo a la carpeta de Drive.',
        failedAt: new Date().toISOString(),
      };
      setTimeout(() => { activeMirrorTransfer = null; }, 10000);
      throw error;
    }
    copiedFiles += 1;
    copiedBytes += Number(file.size || 0);
    activeMirrorTransfer.copiedFiles = copiedFiles;
    activeMirrorTransfer.copiedBytes = copiedBytes;
  }
  moveMirrorFilesToTrash(effectiveMirror.mirrorPath, removedPaths, stamp);

  const mirrorManifest = {
    ...manifest,
    provider: 'google-drive-desktop-mirror',
    storageMode: 'drive_mirror',
    operationId,
    generatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(getMirrorMetaPaths(effectiveMirror.mirrorPath).manifestPath, mirrorManifest);
  writeMirrorOperationCommit(effectiveMirror.mirrorPath, operationId, mirrorManifest);
  writeJsonAtomic(localManifestPath, mirrorManifest);
  persistExpectedResourceCatalog(effectiveMirror.mirrorPath, mirrorManifest);
  activeMirrorTransfer = {
    ...activeMirrorTransfer,
    state: 'prepared-in-local-drive-folder',
    currentFile: '',
    copiedBytes: totalCopyBytes,
    completedAt: new Date().toISOString(),
  };
  setTimeout(() => { activeMirrorTransfer = null; }, 5000);
  if (cloudDeliveryPending) {
    persistPendingLocalState({
      reason: `drive-desktop-${mirrorDeliveryHealth.state}`,
      manifest: mirrorManifest,
      counts: localCounts,
      note: mirrorDeliveryHealth.message,
    });
  } else {
    clearPendingLocalState();
  }
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
        copiedFiles,
        copiedBytes,
        protectedMirrorBackup,
        cloudDeliveryPending,
        driveDesktop: mirrorDeliveryHealth,
        removedPathsMovedToTrash: removedPaths,
      },
  };
};

let activePushOperation = null;
export const pushToCloud = (payload = {}) => {
  if (activePushOperation) return activePushOperation;
  activePushOperation = performPushToCloud(payload).finally(() => {
    activePushOperation = null;
  });
  return activePushOperation;
};

export const pullFromCloud = async (payload = {}) => {
  const force = payload?.force === true;
  const config = readConfig();
  const effectiveMirror = resolveEffectiveMirrorPath(config);
  if (config.mode === 'apps_script_drive') {
    let response = await postAppsScript({
      action: 'sync_pull',
      ...buildAppsScriptSyncPayload(config),
    }, 240000);
    response = await hydrateChunkedPackageResponse(response, config);

    if (!response.success) {
      return { success: false, message: response.message || 'No se pudo descargar la copia desde Drive.' };
    }
    const remoteUser = normalizeRemoteFolderInfo(response.data?.user) || normalizeRemoteFolderInfo(config.remoteFolderInfo);
    if (response.data?.user) {
      persistRemoteFolderInfo(response.data.user, config);
    }
    if (!String(response.data?.packageBase64 || '').trim()) {
      return {
        success: false,
        message: response.message || 'No hay una copia actual disponible en Drive para este usuario todavia.',
        data: {
          remoteUser,
          manifest: response.data?.manifest || null,
        },
      };
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
          remoteUser,
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
    clearPendingLocalState();

    return {
      success: true,
      data: {
        manifest: remoteManifest,
        counts: getSyncEntityCounts(),
        frontendState: readJsonFile(frontendStatePath, { keys: {} }),
        restorePoint: restoreRoot,
        remoteUser,
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
  clearPendingLocalState();
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
        manifest: resolveArtifactManifest(response.data?.manifest, extracted.manifest),
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
    const remoteManifest = resolveArtifactManifest(response.data?.manifest, extractedManifest);
    if (!remoteManifest?.files) {
      return { success: false, message: 'La copia seleccionada no contiene un manifiesto valido.' };
    }
    applyExtractedPackageToLocal(extractRoot, remoteManifest, restoreRoot);
    writeJsonAtomic(localManifestPath, remoteManifest);
    const resolvedConflict = artifactKind === 'conflict'
      ? await resolveCloudConflict({ artifactId })
      : null;
    return {
      success: true,
      data: {
        artifactId,
        artifactKind,
        manifest: remoteManifest,
        counts: getSyncEntityCounts(),
        frontendState: readJsonFile(frontendStatePath, { keys: {} }),
        restorePoint: restoreRoot,
        resolvedConflict: resolvedConflict?.success === true,
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
    const remoteManifest = resolveArtifactManifest(response.data?.manifest, manifest);
    return {
      success: true,
      data: {
        artifactId,
        artifactKind,
        manifest: remoteManifest,
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
    const remoteManifest = resolveArtifactManifest(response.data?.manifest, manifest);
    return {
      success: true,
      data: {
        artifactId,
        artifactKind,
        manifest: remoteManifest,
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

export const discardPendingLocalBackup = async () => {
  clearPendingLocalState();
  return { success: true };
};

export { saveFrontendStateSnapshot };
