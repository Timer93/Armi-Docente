const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, dialog, ipcMain, utilityProcess } = require('electron');
const { createUpdaterController } = require('./updater.cjs');
const { ensureLanAccess } = require('./lan-access.cjs');
const { waitForServer } = require('./backend-readiness.cjs');
const { createCloseHandshake } = require('./close-handshake.cjs');
const { loadStartupPage } = require('./startup-navigation.cjs');
const { createPrintPreviewController } = require('./print-preview.cjs');
const { stopUtilityBackend } = require('./backend-shutdown.cjs');

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
let closeHandshake = null;
let remoteShutdownPromise = null;
let printPreviewController = null;
let backendStopExpected = false;
let backendRestartTimer = null;
let backendRestartInFlight = false;
let backendRestartAttempts = 0;
let backendRestartAfterExpectedStop = false;
const MAX_BACKEND_RESTART_ATTEMPTS = 5;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const stopBackendImmediately = async () => {
  const processToStop = backendProcess;
  backendProcess = null;
  if (!processToStop?.pid) return;
  backendStopExpected = true;
  try {
    await stopUtilityBackend(processToStop, { timeoutMs: 1000 });
    logLine('Backend detenido después de un inicio fallido', { pid: processToStop.pid });
  } catch (error) {
    logLine('No se pudo detener el backend después del fallo', { message: String(error?.message || error) });
  }
};

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
  backendStopExpected = true;
  backendRestartAfterExpectedStop = false;
  clearTimeout(backendRestartTimer);
  backendRestartTimer = null;
  remoteShutdownPromise = Promise.resolve()
    .then(async () => {
      if (!backendProcess?.pid) return;
      await stopUtilityBackend(backendProcess);
    })
    .catch((error) => {
      logLine('No se pudo detener limpiamente el acceso remoto', {
        message: String(error?.message || error),
      });
    });
  return remoteShutdownPromise;
};

const showEditableContextMenu = (mainWindow, params, studentContext = null) => {
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

  if (studentContext?.id !== undefined && studentContext?.id !== null) {
    template.push(
      { type: 'separator' },
      {
        label: `Eliminar estudiante${studentContext.name ? `: ${studentContext.name}` : ''}`,
        click: () => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('students:delete-from-context-menu', studentContext);
          }
        },
      }
    );
  }

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
  printPreviewController?.attach(mainWindow);
  allowWindowClose = false;
  closeHandshake?.dispose();
  const closeWindowLocally = async () => {
    logLine('Cierre local sin esperar la interfaz de sincronizacion');
    closeHandshake?.cancel();
    await shutdownRemoteAccess();
    allowWindowClose = true;
    if (!mainWindow.isDestroyed()) mainWindow.close();
  };
  closeHandshake = createCloseHandshake({
    sendRequest: () => mainWindow.webContents.send('app:before-close'),
    closeWithoutRenderer: closeWindowLocally,
    onUnresponsive: async () => {
      if (mainWindow.isDestroyed() || allowWindowClose) return;
      logLine('La interfaz no confirmo la solicitud de cierre');
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Cerrar ARMI Docente',
        message: 'La interfaz no responde a la solicitud de cierre.',
        detail: 'Puedes cerrar ARMI. Los datos ya guardados se conservarán; los cambios aún sin guardar o sincronizar pueden quedar pendientes.',
        buttons: ['Seguir esperando', 'Cerrar ARMI'], defaultId: 0, cancelId: 0,
      });
      if (result.response === 1) await closeWindowLocally();
      else closeHandshake?.cancel();
    },
  });
  const handleCloseHandlerReady = (event, ready) => {
    if (event.sender === mainWindow.webContents) closeHandshake?.setReady(ready);
  };
  const handleCloseRequestReceived = event => {
    if (event.sender === mainWindow.webContents) closeHandshake?.acknowledge();
  };
  ipcMain.on('app:close-handler-ready', handleCloseHandlerReady);
  ipcMain.on('app:close-request-received', handleCloseRequestReceived);
  mainWindow.webContents.on('did-start-loading', () => closeHandshake?.setReady(false));
  mainWindow.webContents.on('render-process-gone', () => closeHandshake?.setReady(false));

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

  let pendingStudentContextMenuTarget = null;
  const handleStudentContextMenuTarget = (event, student) => {
    if (event.sender !== mainWindow.webContents) return;
    pendingStudentContextMenuTarget = student && student.id !== undefined
      ? { id: student.id, name: String(student.name || '').slice(0, 120) }
      : null;
    event.returnValue = true;
  };
  ipcMain.on('students:set-context-menu-target', handleStudentContextMenuTarget);

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const studentContext = pendingStudentContextMenuTarget;
    pendingStudentContextMenuTarget = null;
    if (!params?.isEditable && !studentContext) return;
    showEditableContextMenu(mainWindow, params, studentContext);
  });

  mainWindow.on('close', (event) => {
    if (allowWindowClose) return;

    event.preventDefault();

    closeHandshake?.request();
  });

  mainWindow.on('session-end', () => {
    void shutdownRemoteAccess();
  });

  mainWindow.on('closed', () => {
    closeHandshake?.dispose();
    ipcMain.removeListener('app:close-handler-ready', handleCloseHandlerReady);
    ipcMain.removeListener('app:close-request-received', handleCloseRequestReceived);
    ipcMain.removeListener('students:set-context-menu-target', handleStudentContextMenuTarget);
    ipcMain.removeListener('app:startup-ready', handleRendererReady);
    if (mainWindowRef === mainWindow) mainWindowRef = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    logLine('Falló la carga de la ventana', { code, description });
  });

  const serverReady = await waitForServer(
    'http://127.0.0.1:3000/api/health',
    90_000
  );

  if (!serverReady) {
    logLine('El backend no respondió a tiempo');
    await stopBackendImmediately();
    allowWindowClose = true;
    if (splashWindowRef && !splashWindowRef.isDestroyed()) splashWindowRef.destroy();

    await mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`
          <html>
            <body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;color:#0f172a;">
              <div style="background:#fff;border:1px solid #fecaca;border-radius:24px;padding:30px 34px;box-shadow:0 18px 50px rgba(15,23,42,.14);max-width:590px;text-align:center;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:#9a3412;text-transform:uppercase;">ARMI Docente</div>
                <h1 style="margin:10px 0 8px;font-size:28px;color:#991b1b;">El inicio tardó demasiado</h1>
                <p style="margin:0;color:#475569;line-height:1.55;">ARMI detuvo el intento para evitar que la ventana quede bloqueada. Puedes reintentar con seguridad o cerrar la aplicación.</p>
                <div style="display:flex;gap:10px;justify-content:center;margin-top:22px;">
                  <button onclick="window.armiApp.restartApplication()" style="border:0;border-radius:12px;padding:12px 18px;background:#7c3aed;color:white;font-weight:800;cursor:pointer;">Reintentar inicio</button>
                  <button onclick="window.armiApp.exitApplication()" style="border:1px solid #cbd5e1;border-radius:12px;padding:12px 18px;background:white;color:#334155;font-weight:800;cursor:pointer;">Cerrar ARMI</button>
                </div>
                <p style="margin:18px 0 0;color:#94a3b8;font-size:11px;">Diagnóstico: ${path.join(app.getPath('userData'), 'launcher.log').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>
              </div>
            </body>
          </html>
        `)
    );
    revealMainWindow('startup-error');
    return;
  }

  logLine('Backend listo, cargando URL principal');

  if (!await loadStartupPage(mainWindow, 'http://127.0.0.1:3000', { log: logLine })) return;

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
  if (backendProcess?.pid) return backendProcess;
  const backendEntryPath = path.join(appRoot, 'backend', 'server.js');
  const serverPath = isDev
    ? path.join(appRoot, 'electron', 'backend-process.cjs')
    : path.join(process.resourcesPath, 'backend-process.cjs');
  const backendEnv = {
    ...process.env,
    NODE_ENV: isDev ? 'development' : 'production',
    ARMI_USE_VITE_MIDDLEWARE: '0',
    ARMI_BACKEND_ENTRY: backendEntryPath,
    ARMI_BACKEND_OWNER_PID: String(process.pid),
    ARMI_RESOURCES_PATH: isDev ? appRoot : process.resourcesPath,
    ARMI_CLOUDFLARED_PATH: isDev
      ? path.join(appRoot, 'build', 'cloudflared', 'cloudflared.exe')
      : path.join(process.resourcesPath, 'cloudflared', 'cloudflared.exe'),
  };
  if (!isDev) backendEnv.ARMI_DATA_ROOT = app.getPath('userData');

  logLine('Iniciando backend', {
    serverPath,
    backendEntryPath,
    isDev,
    dataRoot: backendEnv.ARMI_DATA_ROOT || appRoot,
  });

  backendStopExpected = false;
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
    const expected = backendStopExpected || allowWindowClose;
    const restartAfterExpectedStop = backendRestartAfterExpectedStop;
    logLine('Backend aislado finalizado', { code, expected });
    if (backendProcess === launchedProcess) backendProcess = null;
    backendStopExpected = false;
    backendRestartAfterExpectedStop = false;
    if (!expected || restartAfterExpectedStop) scheduleBackendRestart({ code });
  });
  launchedProcess.stderr?.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (message) logLine('Backend stderr', { message: message.slice(0, 4000) });
  });
  return launchedProcess;
};

const scheduleBackendRestart = (details = {}) => {
  if (remoteShutdownPromise || allowWindowClose || backendStopExpected || backendRestartTimer || backendRestartInFlight || backendProcess?.pid) return;
  if (backendRestartAttempts >= MAX_BACKEND_RESTART_ATTEMPTS) {
    logLine('Backend sin recuperacion automatica tras varios intentos', details);
    return;
  }
  const delayMs = Math.min(8_000, 1_000 * (backendRestartAttempts + 1));
  logLine('Programando recuperacion automatica del backend', { ...details, attempt: backendRestartAttempts + 1, delayMs });
  backendRestartTimer = setTimeout(async () => {
    backendRestartTimer = null;
    if (remoteShutdownPromise || allowWindowClose || backendProcess?.pid) return;
    backendRestartInFlight = true;
    backendRestartAttempts += 1;
    try {
      await startBackend();
      const ready = await waitForServer('http://127.0.0.1:3000/api/health', 90_000);
      if (!ready) throw new Error('El backend reiniciado no respondio a tiempo.');
      backendRestartAttempts = 0;
      logLine('Backend recuperado automaticamente');
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('app:backend-recovered');
      }
    } catch (error) {
      logLine('Fallo la recuperacion automatica del backend', { message: String(error?.message || error) });
      backendRestartAfterExpectedStop = true;
      await stopBackendImmediately();
    } finally {
      backendRestartInFlight = false;
    }
  }, delayMs);
};

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    logLine('Electron listo');
    printPreviewController = createPrintPreviewController({ app, BrowserWindow, ipcMain, getMainWindow: () => mainWindowRef, log: logLine });
    printPreviewController.register();
    app.once('will-quit', () => printPreviewController?.dispose());

    ipcMain.handle('app:continue-close', async () => {
      closeHandshake?.cancel();
      await shutdownRemoteAccess();
      allowWindowClose = true;

      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.close();
      } else {
        app.quit();
      }

      return { success: true };
    });

    ipcMain.handle('app:cancel-close', async () => {
      closeHandshake?.cancel();
      return { success: true };
    });

    ipcMain.handle('app:request-close', async () => {
      closeHandshake?.cancel();
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.close();
      } else {
        app.quit();
      }

      return { success: true };
    });

    ipcMain.handle('app:restart-application', async () => {
      await stopBackendImmediately();
      allowWindowClose = true;
      app.relaunch();
      app.exit(0);
      return { success: true };
    });

    ipcMain.handle('app:exit-application', async () => {
      await stopBackendImmediately();
      allowWindowClose = true;
      app.exit(0);
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

    await stopBackendImmediately();
    allowWindowClose = true;
    if (splashWindowRef && !splashWindowRef.isDestroyed()) splashWindowRef.destroy();
    dialog.showErrorBox(
      'ARMI Docente',
      `Ocurrió un error al iniciar.\n\nRevisa el log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );
    app.quit();
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createSplashWindow(getAppIconPath());
      await createMainWindow();
    }
  });
});

process.on('uncaughtException', async (error) => {
  logLine('uncaughtException', {
    message: String(error?.message || error),
    stack: String(error?.stack || ''),
  });

  try {
    await stopBackendImmediately();
    allowWindowClose = true;
    if (splashWindowRef && !splashWindowRef.isDestroyed()) splashWindowRef.destroy();
    dialog.showErrorBox(
      'ARMI Docente',
      `Error no controlado al iniciar.\n\nRevisa el log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );
    app.quit();
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
    closeHandshake?.cancel();
    app.quit();
  });
});
