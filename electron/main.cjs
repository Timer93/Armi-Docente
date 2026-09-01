const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, dialog, ipcMain, utilityProcess } = require('electron');
const { createUpdaterController } = require('./updater.cjs');
const { ensureLanAccess } = require('./lan-access.cjs');

const appRoot = path.resolve(__dirname, '..');
const isDev = !app.isPackaged;

// Cambia solo esta ruta para usar una imagen PNG/JPG, un GIF/WebP animado o un video MP4/WebM.
const STARTUP_MEDIA = 'src/LOGO3D.png';
const STARTUP_MEDIA_MAX_SECONDS = 12;

if (process.platform === 'win32') {
  app.setName('ARMI Docente');
  app.setAppUserModelId('com.armi.docente');
}

const getAppIconPath = () => {
  const possiblePaths = isDev
    ? [
        path.join(appRoot, 'src', 'Logo_bar.ico'),
        path.join(appRoot, 'build', 'icon.ico'),
        path.join(appRoot, 'icon.ico'),
      ]
    : [
        path.join(process.resourcesPath, 'app-icon.ico'),
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'Logo_bar.ico'),
      ];

  return possiblePaths.find((iconPath) => fs.existsSync(iconPath)) || undefined;
};

let updaterController = null;
let backendProcess = null;
let mainWindowRef = null;
let splashWindowRef = null;
let allowWindowClose = false;
let closeHandshakePending = false;
let remoteShutdownPromise = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (splashWindowRef && !splashWindowRef.isDestroyed() && !mainWindowRef?.isVisible()) {
      splashWindowRef.show();
      splashWindowRef.focus();
      return;
    }
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    if (mainWindowRef.isMinimized()) mainWindowRef.restore();
    mainWindowRef.show();
    mainWindowRef.focus();
  });
}

const logLine = (message, extra = null) => {
  try {
    const logPath = path.join(app.getPath('userData'), 'launcher.log');
    const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {}
};

const resolveStartupMedia = () => {
  const configuredPath = String(STARTUP_MEDIA || '').trim();
  if (!configuredPath) return null;

  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(appRoot, configuredPath);
  if (!fs.existsSync(absolutePath)) {
    logLine('El recurso visual de inicio no existe', { configuredPath, absolutePath });
    return null;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const isVideo = ['.mp4', '.webm', '.ogg'].includes(extension);
  const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(extension);
  if (!isVideo && !isImage) {
    logLine('Formato visual de inicio no compatible', { configuredPath, extension });
    return null;
  }

  return {
    src: path.relative(__dirname, absolutePath).split(path.sep).join('/'),
    isVideo,
    configuredPath,
    size: fs.statSync(absolutePath).size,
  };
};

const createSplashWindow = async (appIconPath) => {
  const media = resolveStartupMedia();
  const splashPagePath = path.join(__dirname, 'startup-splash.html');
  let resolveSplashVisible;
  const splashVisiblePromise = new Promise((resolve) => {
    resolveSplashVisible = resolve;
  });

  const splashWindow = new BrowserWindow({
    width: 700,
    height: 460,
    show: false,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: false,
    center: true,
    alwaysOnTop: true,
    transparent: true,
    // Alfa mínimo: visualmente transparente, pero evita que algunos controladores
    // de Windows descarten toda la superficie como si no tuviera contenido.
    backgroundColor: '#01000000',
    title: 'ARMI Docente',
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      paintWhenInitiallyHidden: true,
    },
  });

  splashWindowRef = splashWindow;
  splashWindow.on('closed', () => {
    if (splashWindowRef === splashWindow) splashWindowRef = null;
  });

  let splashShown = false;
  const showSplashWindow = (reason) => {
    if (splashShown || splashWindow.isDestroyed()) return;
    splashShown = true;
    splashWindow.show();
    splashWindow.focus();
    logLine('Presentacion de inicio visible', { reason });
    resolveSplashVisible?.();
  };

  splashWindow.once('ready-to-show', () => showSplashWindow('ready-to-show'));
  splashWindow.webContents.once('dom-ready', () => showSplashWindow('dom-ready'));
  splashWindow.webContents.once('did-finish-load', async () => {
    if (splashWindow.isDestroyed()) return;
    showSplashWindow('did-finish-load');
    try {
      const visualState = await splashWindow.webContents.executeJavaScript(`({
        imageVisible: !document.getElementById('startup-image')?.hidden,
        imageWidth: document.getElementById('startup-image')?.naturalWidth || 0,
        videoVisible: !document.getElementById('startup-video')?.hidden,
        fallbackVisible: getComputedStyle(document.getElementById('fallback-logo')).display !== 'none'
      })`);
      logLine('Recurso visual de inicio renderizado', visualState);
    } catch (error) {
      logLine('No se pudo verificar el recurso visual de inicio', { message: String(error?.message || error) });
    }
  });

  logLine('Cargando recurso visual de inicio', {
    configuredPath: media?.configuredPath || null,
    size: media?.size || 0,
    type: media?.isVideo ? 'video' : media ? 'image' : 'fallback',
  });

  void splashWindow.loadFile(splashPagePath, {
    query: {
      media: media?.src || '',
      mediaType: media?.isVideo ? 'video' : media ? 'image' : 'fallback',
      maxSeconds: String(Number(STARTUP_MEDIA_MAX_SECONDS) || 12),
    },
  }).catch((error) => {
    logLine('No se pudo cargar la presentacion de inicio', { message: String(error?.message || error) });
    if (!splashWindow.isDestroyed()) {
      splashWindow.setBackgroundColor('#0b1230');
      showSplashWindow('load-error-fallback');
    }
  });

  await splashVisiblePromise;
  return splashWindow;
};

const shutdownRemoteAccess = async () => {
  if (remoteShutdownPromise) return remoteShutdownPromise;
  remoteShutdownPromise = Promise.resolve()
    .then(async () => {
      if (!backendProcess?.pid) return;
      try {
        await fetch('http://127.0.0.1:3000/api/remote-access/stop', {
          method: 'POST',
          signal: AbortSignal.timeout(12_000),
        });
      } catch (error) {
        logLine('El backend no confirmo el cierre del acceso remoto', {
          message: String(error?.message || error),
        });
      } finally {
        if (backendProcess?.pid) backendProcess.kill();
      }
    })
    .catch((error) => {
      logLine('No se pudo detener limpiamente el acceso remoto', {
        message: String(error?.message || error),
      });
    });
  return remoteShutdownPromise;
};

const waitForServer = async (url, timeoutMs = 30000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
};

const showEditableContextMenu = (mainWindow, params) => {
  const template = [];
  const suggestions = Array.isArray(params?.dictionarySuggestions)
    ? params.dictionarySuggestions.filter(Boolean).slice(0, 6)
    : [];
  const misspelledWord = String(params?.misspelledWord || '').trim();
  const canSpellcheck = typeof mainWindow?.webContents?.replaceMisspelling === 'function';

  if (misspelledWord && suggestions.length > 0 && canSpellcheck) {
    suggestions.forEach((suggestion) => {
      template.push({
        label: suggestion,
        click: () => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.replaceMisspelling(suggestion);
          }
        },
      });
    });
    template.push({ type: 'separator' });
  }

  if (misspelledWord && canSpellcheck && typeof mainWindow?.webContents?.session?.addWordToSpellCheckerDictionary === 'function') {
    template.push({
      label: 'Agregar al diccionario',
      click: () => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.session.addWordToSpellCheckerDictionary(misspelledWord);
        }
      },
    });
    template.push({ type: 'separator' });
  }

  template.push(
    { role: 'undo', enabled: !!params?.editFlags?.canUndo },
    { role: 'redo', enabled: !!params?.editFlags?.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: !!params?.editFlags?.canCut },
    { role: 'copy', enabled: !!params?.editFlags?.canCopy },
    { role: 'paste', enabled: !!params?.editFlags?.canPaste },
    { role: 'selectAll' }
  );

  Menu.buildFromTemplate(template).popup({ window: mainWindow });
};

const createMainWindow = async () => {
  const appIconPath = getAppIconPath();

  logLine('Ruta de icono usada', { appIconPath });

  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#eaebef',
    show: false,
    autoHideMenuBar: true,
    title: 'ARMI Docente',
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      spellcheck: true,
    },
  });

  if (appIconPath && typeof mainWindow.setIcon === 'function') {
    mainWindow.setIcon(appIconPath);
  }

  mainWindowRef = mainWindow;
  allowWindowClose = false;
  closeHandshakePending = false;

  logLine('Ventana principal creada');

  let startupRevealed = false;
  const revealMainWindow = (reason) => {
    if (startupRevealed || mainWindow.isDestroyed()) return;
    startupRevealed = true;
    logLine('Interfaz principal lista', { reason });
    mainWindow.show();
    mainWindow.focus();
    if (splashWindowRef && !splashWindowRef.isDestroyed()) {
      splashWindowRef.destroy();
    }
  };

  const handleRendererReady = (event) => {
    if (event.sender !== mainWindow.webContents) return;
    revealMainWindow('renderer-ready');
  };
  ipcMain.on('app:startup-ready', handleRendererReady);

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params?.isEditable) return;
    showEditableContextMenu(mainWindow, params);
  });

  mainWindow.on('close', (event) => {
    if (allowWindowClose) return;

    event.preventDefault();

    if (closeHandshakePending) return;

    closeHandshakePending = true;
    logLine('Solicitando cierre protegido al renderer');

    try {
      mainWindow.webContents.send('app:before-close');
    } catch (error) {
      logLine('No pude enviar evento de cierre protegido', {
        message: String(error?.message || error),
      });

      closeHandshakePending = false;
    }
  });

  mainWindow.on('session-end', () => {
    void shutdownRemoteAccess();
  });

  mainWindow.on('closed', () => {
    ipcMain.removeListener('app:startup-ready', handleRendererReady);
    if (mainWindowRef === mainWindow) mainWindowRef = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    logLine('Falló la carga de la ventana', { code, description });
  });

  const serverReady = await waitForServer(
    'http://127.0.0.1:3000/api/health',
    40000
  );

  if (!serverReady) {
    logLine('El backend no respondió a tiempo');

    dialog.showErrorBox(
      'ARMI Docente',
      `No se pudo iniciar el servidor interno del aplicativo.\n\nRevisa el archivo de log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );

    mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`
          <html>
            <body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#fff7ed;display:flex;align-items:center;justify-content:center;height:100vh;">
              <div style="background:#fff;border:1px solid #fdba74;border-radius:24px;padding:28px 32px;box-shadow:0 18px 50px rgba(15,23,42,.14);max-width:540px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:#9a3412;text-transform:uppercase;">ARMI Docente</div>
                <h1 style="margin:10px 0 8px;font-size:28px;color:#7c2d12;">No se pudo iniciar</h1>
                <p style="margin:0;color:#7c2d12;line-height:1.5;">Revisa el archivo <b>launcher.log</b> en la carpeta de datos del usuario.</p>
              </div>
            </body>
          </html>
        `)
    ).catch(() => {});

    app.quit();
    return;
  }

  logLine('Backend listo, cargando URL principal');

  await mainWindow.loadURL('http://127.0.0.1:3000');

  await ensureLanAccess(mainWindow, logLine);

  updaterController = createUpdaterController(mainWindow);

  if (typeof updaterController?.start === 'function') {
    await updaterController.start();
  }

  if (isDev && process.env.ARMI_NO_DEVTOOLS !== '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

const startBackend = async () => {
  const backendEntryPath = path.join(appRoot, 'backend', 'server.js');
  const serverPath = isDev
    ? path.join(appRoot, 'electron', 'backend-process.cjs')
    : path.join(process.resourcesPath, 'backend-process.cjs');
  const backendEnv = {
    ...process.env,
    NODE_ENV: isDev ? 'development' : 'production',
    ARMI_USE_VITE_MIDDLEWARE: '0',
    ARMI_BACKEND_ENTRY: backendEntryPath,
  };
  if (!isDev) backendEnv.ARMI_DATA_ROOT = app.getPath('userData');

  logLine('Iniciando backend', {
    serverPath,
    backendEntryPath,
    isDev,
    dataRoot: backendEnv.ARMI_DATA_ROOT || appRoot,
  });

  backendProcess = utilityProcess.fork(serverPath, [], {
    cwd: isDev ? appRoot : process.resourcesPath,
    env: backendEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
    serviceName: 'ARMI Backend',
  });
  const launchedProcess = backendProcess;
  launchedProcess.once('spawn', () => {
    logLine('Backend iniciado en proceso aislado', { pid: launchedProcess.pid });
  });
  launchedProcess.on('error', (type, location, report) => {
    logLine('Error fatal del backend aislado', { type, location, report });
  });
  launchedProcess.once('exit', (code) => {
    logLine('Backend aislado finalizado', { code });
    if (backendProcess === launchedProcess) backendProcess = null;
  });
  launchedProcess.stderr?.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (message) logLine('Backend stderr', { message: message.slice(0, 4000) });
  });
};

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    logLine('Electron listo');

    ipcMain.handle('app:continue-close', async () => {
      await shutdownRemoteAccess();
      allowWindowClose = true;
      closeHandshakePending = false;

      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.close();
      } else {
        app.quit();
      }

      return { success: true };
    });

    ipcMain.handle('app:cancel-close', async () => {
      closeHandshakePending = false;
      return { success: true };
    });

    ipcMain.handle('app:request-close', async () => {
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.close();
      } else {
        app.quit();
      }

      return { success: true };
    });

    await createSplashWindow(getAppIconPath());
    await startBackend();
    await createMainWindow();
  } catch (error) {
    logLine('Error fatal en main', {
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
    });

    dialog.showErrorBox(
      'ARMI Docente',
      `Ocurrió un error al iniciar.\n\nRevisa el log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createSplashWindow(getAppIconPath());
      await createMainWindow();
    }
  });
});

process.on('uncaughtException', (error) => {
  logLine('uncaughtException', {
    message: String(error?.message || error),
    stack: String(error?.stack || ''),
  });

  try {
    dialog.showErrorBox(
      'ARMI Docente',
      `Error no controlado al iniciar.\n\nRevisa el log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );
  } catch {}
});

process.on('unhandledRejection', (error) => {
  logLine('unhandledRejection', {
    message: String(error?.message || error),
    stack: String(error?.stack || ''),
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (remoteShutdownPromise) return;
  event.preventDefault();
  void shutdownRemoteAccess().finally(() => {
    allowWindowClose = true;
    closeHandshakePending = false;
    app.quit();
  });
});
