const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { createUpdaterController } = require('./updater.cjs');

const appRoot = path.resolve(__dirname, '..');
const isDev = !app.isPackaged;
const appIconPath = isDev
  ? path.join(appRoot, 'build', 'icon.ico')
  : path.join(process.resourcesPath, 'icon.ico');
let updaterController = null;
let mainWindowRef = null;
let allowWindowClose = false;
let closeHandshakePending = false;

if (process.platform === 'win32') {
  app.setName('ARMI Docente');
  app.setAppUserModelId('com.armi.docente');
}

const logLine = (message, extra = null) => {
  try {
    const logPath = path.join(app.getPath('userData'), 'launcher.log');
    const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {}
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

const createMainWindow = async () => {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#eaebef',
    show: false,
    autoHideMenuBar: true,
    title: 'ARMI Docente',
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindowRef = mainWindow;
  allowWindowClose = false;
  closeHandshakePending = false;

  logLine('Ventana principal creada');
  const ensureWindowVisible = (reason) => {
    if (mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    logLine('Forzando visibilidad de la ventana', { reason });
    mainWindow.show();
  };

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <html>
      <body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#eaebef;display:flex;align-items:center;justify-content:center;height:100vh;">
        <div style="background:#fff;border-radius:24px;padding:28px 32px;box-shadow:0 18px 50px rgba(15,23,42,.14);max-width:460px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:#64748b;text-transform:uppercase;">ARMI Docente</div>
          <h1 style="margin:10px 0 8px;font-size:28px;color:#0f172a;">Iniciando aplicativo</h1>
          <p style="margin:0;color:#475569;line-height:1.5;">Estamos preparando el servidor interno y cargando la interfaz.</p>
        </div>
      </body>
    </html>
  `)).catch(() => {});

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    logLine('Ventana visible');
  });

  mainWindow.webContents.once('did-finish-load', () => {
    ensureWindowVisible('did-finish-load');
  });

  setTimeout(() => {
    ensureWindowVisible('startup-timeout');
  }, 1800);

  mainWindow.on('close', (event) => {
    if (allowWindowClose) return;
    event.preventDefault();
    if (closeHandshakePending) return;
    closeHandshakePending = true;
    logLine('Solicitando cierre protegido al renderer');
    try {
      mainWindow.webContents.send('app:before-close');
    } catch (error) {
      logLine('No pude enviar evento de cierre protegido', { message: String(error?.message || error) });
      closeHandshakePending = false;
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    logLine('Falló la carga de la ventana', { code, description });
  });

  const serverReady = await waitForServer('http://127.0.0.1:3000/api/health', isDev ? 15000 : 40000);
  if (!serverReady) {
    logLine('El backend no respondió a tiempo');
    dialog.showErrorBox(
      'ARMI Docente',
      `No se pudo iniciar el servidor interno del aplicativo.\n\nRevisa el archivo de log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <html>
        <body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#fff7ed;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="background:#fff;border:1px solid #fdba74;border-radius:24px;padding:28px 32px;box-shadow:0 18px 50px rgba(15,23,42,.14);max-width:540px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:.18em;color:#9a3412;text-transform:uppercase;">ARMI Docente</div>
            <h1 style="margin:10px 0 8px;font-size:28px;color:#7c2d12;">No se pudo iniciar</h1>
            <p style="margin:0;color:#7c2d12;line-height:1.5;">Revisa el archivo <b>launcher.log</b> en la carpeta de datos del usuario.</p>
          </div>
        </body>
      </html>
    `)).catch(() => {});
    app.quit();
    return;
  }

  logLine('Backend listo, cargando URL principal');
  await mainWindow.loadURL('http://127.0.0.1:3000');
  updaterController = createUpdaterController(mainWindow);
  if (typeof updaterController?.start === 'function') {
    await updaterController.start();
  }
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

const startBackend = async () => {
  process.env.NODE_ENV = isDev ? 'development' : 'production';
  process.env.ARMI_USE_VITE_MIDDLEWARE = '0';
  if (!isDev) {
    process.env.ARMI_DATA_ROOT = app.getPath('userData');
  }

  const serverPath = pathToFileURL(path.join(appRoot, 'backend', 'server.js')).href;
  logLine('Iniciando backend', { serverPath, isDev, dataRoot: process.env.ARMI_DATA_ROOT || appRoot });
  await import(serverPath);
  logLine('Backend importado correctamente');
};

app.whenReady().then(async () => {
  try {
    logLine('Electron listo');
    ipcMain.handle('app:continue-close', async () => {
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
    await startBackend();
    await createMainWindow();
  } catch (error) {
    logLine('Error fatal en main', { message: String(error?.message || error), stack: String(error?.stack || '') });
    dialog.showErrorBox(
      'ARMI Docente',
      `Ocurrió un error al iniciar.\n\nRevisa el log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

process.on('uncaughtException', (error) => {
  logLine('uncaughtException', { message: String(error?.message || error), stack: String(error?.stack || '') });
  try {
    dialog.showErrorBox(
      'ARMI Docente',
      `Error no controlado al iniciar.\n\nRevisa el log en:\n${path.join(app.getPath('userData'), 'launcher.log')}`
    );
  } catch {}
});

process.on('unhandledRejection', (error) => {
  logLine('unhandledRejection', { message: String(error?.message || error), stack: String(error?.stack || '') });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
