const path = require('path');
const fs = require('fs');
const { app, ipcMain, shell } = require('electron');
const { NsisUpdater } = require('electron-updater');

const FALLBACK_CONFIG = {
  provider: 'github',
  owner: '',
  repo: '',
  releaseType: 'release',
  channel: 'latest',
  enabled: false,
  manifestUrl: '',
};

const readReleaseConfig = () => {
  const candidates = [
    path.join(app.getAppPath(), 'electron', 'release-config.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'electron', 'release-config.json') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return {
          ...FALLBACK_CONFIG,
          ...JSON.parse(fs.readFileSync(candidate, 'utf8')),
        };
      }
    } catch {}
  }
  return { ...FALLBACK_CONFIG };
};

const updaterStatePath = () => path.join(app.getPath('userData'), 'updater-manifest-cache.json');

const readUpdaterState = () => {
  try {
    return JSON.parse(fs.readFileSync(updaterStatePath(), 'utf8'));
  } catch {
    return {};
  }
};

const writeUpdaterState = (payload = {}) => {
  try {
    fs.writeFileSync(updaterStatePath(), JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
};

const createSnapshot = (patch = {}) => ({
  available: false,
  configured: false,
  currentVersion: app.getVersion(),
  status: 'idle',
  progress: null,
  message: '',
  releaseName: '',
  releaseNotes: '',
  error: '',
  downloadReady: false,
  downloadedVersion: '',
  ...patch,
});

const normalizeVersion = (value) => String(value || '')
  .trim()
  .replace(/^v/i, '')
  .split('.')
  .map((part) => Number.parseInt(part, 10) || 0);

const compareVersions = (left, right) => {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const av = a[index] || 0;
    const bv = b[index] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
};

const fetchManifestJson = async (manifestUrl) => {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`No se pudo leer version.json (HTTP ${response.status}).`);
  }
  const payload = await response.json();
  if (!payload || !payload.version || !payload.downloadUrl) {
    throw new Error('version.json no incluye `version` o `downloadUrl`.');
  }
  return payload;
};

const downloadInstaller = async (downloadUrl, destinationPath, onProgress) => {
  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar el instalador (HTTP ${response.status}).`);
  }

  const total = Number(response.headers.get('content-length') || 0);
  const fileStream = fs.createWriteStream(destinationPath);
  let transferred = 0;

  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      transferred += chunk.length;
      fileStream.write(chunk);
      if (typeof onProgress === 'function') {
        const percent = total > 0 ? (transferred / total) * 100 : 0;
        onProgress({
          percent,
          transferred,
          total,
          bytesPerSecond: 0,
        });
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
      fileStream.end();
    });
  }
};

const createGithubProviderController = (mainWindow, releaseConfig, configured, emit, snapshotRef) => {
  if (!app.isPackaged || !configured) {
    ipcMain.handle('updater:check', async () => snapshotRef());
    return {
      getSnapshot: snapshotRef,
      checkForUpdates: async () => snapshotRef(),
    };
  }

  const updater = new NsisUpdater({
    provider: 'github',
    owner: releaseConfig.owner,
    repo: releaseConfig.repo,
    releaseType: releaseConfig.releaseType || 'release',
  });

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.autoRunAppAfterInstall = true;

  updater.on('checking-for-update', () => {
    emit({
      status: 'checking',
      message: 'Buscando actualizaciones...',
      error: '',
    });
  });

  updater.on('update-available', (info) => {
    emit({
      available: true,
      status: 'downloading',
      message: 'Nueva version encontrada. Descargando actualizacion...',
      releaseName: info?.version || '',
      releaseNotes: Array.isArray(info?.releaseNotes)
        ? info.releaseNotes.map((item) => item.note).join('\n')
        : String(info?.releaseNotes || ''),
    });
  });

  updater.on('update-not-available', () => {
    emit({
      available: false,
      status: 'idle',
      message: 'No hay actualizaciones disponibles.',
      progress: null,
      error: '',
    });
  });

  updater.on('download-progress', (progressObj) => {
    emit({
      available: true,
      status: 'downloading',
      progress: {
        percent: Number(progressObj.percent || 0),
        bytesPerSecond: Number(progressObj.bytesPerSecond || 0),
        transferred: Number(progressObj.transferred || 0),
        total: Number(progressObj.total || 0),
      },
      message: 'Descargando actualizacion...',
    });
  });

  updater.on('update-downloaded', () => {
    emit({
      available: true,
      status: 'installing',
      message: 'Actualizacion descargada. Instalando ahora...',
      progress: {
        percent: 100,
        bytesPerSecond: 0,
        transferred: 0,
        total: 0,
      },
    });
    setTimeout(() => {
      updater.quitAndInstall(false, true);
    }, 1500);
  });

  updater.on('error', (error) => {
    emit({
      status: 'error',
      error: String(error?.message || error || 'Error desconocido al actualizar.'),
      message: 'No se pudo completar la actualizacion.',
      progress: null,
    });
  });

  ipcMain.handle('updater:check', async () => {
    try {
      await updater.checkForUpdates();
    } catch (error) {
      emit({
        status: 'error',
        error: String(error?.message || error || 'No se pudo buscar actualizaciones.'),
        message: 'Fallo al buscar actualizaciones.',
      });
    }
    return snapshotRef();
  });

  return {
    getSnapshot: snapshotRef,
    checkForUpdates: async () => {
      await updater.checkForUpdates();
      return snapshotRef();
    },
    start: async () => {
      emit();
      setTimeout(() => {
        updater.checkForUpdates().catch((error) => {
          emit({
            status: 'error',
            error: String(error?.message || error || 'No se pudo iniciar el auto-update.'),
            message: 'Fallo al iniciar el auto-update.',
          });
        });
      }, 5000);
    },
  };
};

const createManifestProviderController = (releaseConfig, configured, emit, snapshotRef) => {
  let downloadInFlight = false;
  let latestManifest = null;
  let cachedState = readUpdaterState();

  const startDownload = async (manifest) => {
    if (downloadInFlight) return snapshotRef();
    downloadInFlight = true;

    const assetName = String(manifest.assetName || `ARMI_DOCENTE_Setup_${manifest.version}.exe`).trim();
    const destinationPath = path.join(app.getPath('temp'), assetName);

    emit({
      available: true,
      status: 'downloading',
      message: 'Nueva version encontrada. Descargando instalador...',
      error: '',
      releaseName: manifest.releaseName || manifest.version || '',
      releaseNotes: Array.isArray(manifest.changelog) ? manifest.changelog.join('\n') : String(manifest.changelog || ''),
      downloadReady: false,
      downloadedVersion: '',
    });

    try {
      await downloadInstaller(manifest.downloadUrl, destinationPath, (progress) => {
        emit({
          available: true,
          status: 'downloading',
          progress,
          message: 'Descargando instalador...',
        });
      });

      cachedState = {
        version: manifest.version,
        assetName,
        downloadUrl: manifest.downloadUrl,
        installerPath: destinationPath,
        downloadedAt: new Date().toISOString(),
      };
      writeUpdaterState(cachedState);

      emit({
        available: true,
        status: 'downloaded',
        message: 'La nueva version ya se descargo. Decide cuando quieres abrir el instalador.',
        progress: {
          percent: 100,
          bytesPerSecond: 0,
          transferred: 0,
          total,
        },
        downloadReady: true,
        downloadedVersion: manifest.version,
      });
    } catch (error) {
      emit({
        status: 'error',
        error: String(error?.message || error || 'No se pudo descargar la actualizacion.'),
        message: 'La actualizacion no pudo completarse.',
        progress: null,
        downloadReady: false,
        downloadedVersion: '',
      });
    } finally {
      downloadInFlight = false;
    }

    return snapshotRef();
  };

  const installDownloadedUpdate = async () => {
    const state = readUpdaterState();
    const installerPath = String(state.installerPath || '').trim();
    const installerVersion = String(state.version || '').trim();

    if (!installerPath || !fs.existsSync(installerPath)) {
      emit({
        status: 'error',
        error: 'No encontramos el instalador descargado. Vuelve a buscar actualizaciones.',
        message: 'La actualizacion descargada ya no esta disponible.',
        downloadReady: false,
        downloadedVersion: '',
      });
      return snapshotRef();
    }

    emit({
      available: true,
      status: 'installing',
      message: 'Abriendo el instalador de la nueva version...',
      progress: {
        percent: 100,
        bytesPerSecond: 0,
        transferred: 0,
        total: 0,
      },
      downloadReady: true,
      downloadedVersion: installerVersion,
    });

    const openError = await shell.openPath(installerPath);
    if (openError) {
      emit({
        status: 'error',
        error: openError,
        message: 'No se pudo abrir el instalador descargado.',
      });
      return snapshotRef();
    }

    setTimeout(() => {
      app.quit();
    }, 1200);
    return snapshotRef();
  };

  const checkManifest = async (autoStartDownload = false) => {
    if (!configured) return snapshotRef();

    emit({
      status: 'checking',
      message: 'Buscando actualizaciones...',
      error: '',
      progress: null,
    });

    try {
      const manifest = await fetchManifestJson(releaseConfig.manifestUrl);
      latestManifest = manifest;

      const currentVersion = app.getVersion();
      const releaseNotes = Array.isArray(manifest.changelog) ? manifest.changelog.join('\n') : String(manifest.changelog || '');

      if (compareVersions(manifest.version, currentVersion) <= 0) {
        emit({
          available: false,
          status: 'idle',
          message: 'No hay actualizaciones disponibles.',
          releaseName: manifest.releaseName || manifest.version || '',
          releaseNotes,
          progress: null,
          error: '',
          downloadReady: false,
          downloadedVersion: '',
        });
        return snapshotRef();
      }

      const cachedInstallerIsCurrent =
        String(cachedState.version || '') === String(manifest.version || '')
        && String(cachedState.downloadUrl || '') === String(manifest.downloadUrl || '')
        && fs.existsSync(String(cachedState.installerPath || ''));

      if (cachedInstallerIsCurrent) {
        emit({
          available: true,
          status: 'downloaded',
          message: 'Ya descargamos esta actualizacion anteriormente. Puedes instalarla cuando quieras.',
          releaseName: manifest.releaseName || manifest.version || '',
          releaseNotes,
          error: '',
          progress: {
            percent: 100,
            bytesPerSecond: 0,
            transferred: 0,
            total: 0,
          },
          downloadReady: true,
          downloadedVersion: manifest.version,
        });
        return snapshotRef();
      }

      emit({
        available: true,
        status: autoStartDownload ? 'downloading' : 'available',
        message: autoStartDownload ? 'Nueva version encontrada. Descargando instalador...' : 'Hay una nueva version disponible.',
        releaseName: manifest.releaseName || manifest.version || '',
        releaseNotes,
        error: '',
        downloadReady: false,
        downloadedVersion: '',
      });

      if (autoStartDownload) {
        return await startDownload(manifest);
      }
    } catch (error) {
      emit({
        status: 'error',
        error: String(error?.message || error || 'No se pudo buscar actualizaciones.'),
        message: 'Fallo al buscar actualizaciones.',
        progress: null,
        downloadReady: false,
        downloadedVersion: '',
      });
    }

    return snapshotRef();
  };

  ipcMain.handle('updater:check', async () => {
    await checkManifest(true);
    return snapshotRef();
  });
  ipcMain.handle('updater:install', async () => {
    await installDownloadedUpdate();
    return snapshotRef();
  });

  return {
    getSnapshot: snapshotRef,
    checkForUpdates: async () => {
      await checkManifest(true);
      return snapshotRef();
    },
    installUpdate: async () => {
      await installDownloadedUpdate();
      return snapshotRef();
    },
    start: async () => {
      emit();
      setTimeout(() => {
        checkManifest(true).catch((error) => {
          emit({
            status: 'error',
            error: String(error?.message || error || 'No se pudo iniciar la verificacion de actualizaciones.'),
            message: 'Fallo al iniciar la verificacion de actualizaciones.',
          });
        });
      }, 5000);
    },
  };
};

const createUpdaterController = (mainWindow) => {
  const releaseConfig = readReleaseConfig();
  const configured = !!(
    releaseConfig.enabled && (
      (releaseConfig.provider === 'manifest' && releaseConfig.manifestUrl)
      || (releaseConfig.owner && releaseConfig.repo)
    )
  );
  let snapshot = createSnapshot({
    configured,
    message: configured ? 'Actualizaciones automaticas listas.' : 'Actualizaciones automaticas no configuradas.',
  });

  const emit = (patch = {}) => {
    snapshot = {
      ...snapshot,
      ...patch,
      currentVersion: app.getVersion(),
      configured,
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:state', snapshot);
    }
  };

  const snapshotRef = () => snapshot;

  if (releaseConfig.provider === 'manifest') {
    return createManifestProviderController(releaseConfig, configured, emit, snapshotRef);
  }

  return createGithubProviderController(mainWindow, releaseConfig, configured, emit, snapshotRef);
};

module.exports = {
  createUpdaterController,
};
