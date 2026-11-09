const { contextBridge, ipcRenderer } = require('electron');

let latestSnapshot = {
  available: false,
  configured: false,
  currentVersion: '',
  status: 'idle',
  progress: null,
  message: '',
  releaseName: '',
  releaseNotes: '',
  error: '',
};

ipcRenderer.on('updater:state', (_event, payload) => {
  latestSnapshot = payload;
});

contextBridge.exposeInMainWorld('armiUpdater', {
  getSnapshot: () => latestSnapshot,
  onStateChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      latestSnapshot = payload;
      callback(payload);
    };
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installDownloadedUpdate: () => ipcRenderer.invoke('updater:install'),
});

contextBridge.exposeInMainWorld('armiApp', {
  previewPrint: options => ipcRenderer.invoke('print:preview', { title: String(options?.title || '') }),
  onPrintRequest: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('print:request', listener);
    return () => ipcRenderer.removeListener('print:request', listener);
  },
  notifyStartupReady: () => ipcRenderer.send('app:startup-ready'),
  onBeforeQuitAttempt: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => {
      ipcRenderer.send('app:close-request-received');
      callback();
    };
    ipcRenderer.on('app:before-close', listener);
    ipcRenderer.send('app:close-handler-ready', true);
    return () => {
      ipcRenderer.removeListener('app:before-close', listener);
      ipcRenderer.send('app:close-handler-ready', ipcRenderer.listenerCount('app:before-close') > 0);
    };
  },
  onBackendRecovered: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('app:backend-recovered', listener);
    return () => ipcRenderer.removeListener('app:backend-recovered', listener);
  },
  continueQuit: () => ipcRenderer.invoke('app:continue-close'),
  cancelQuit: () => ipcRenderer.invoke('app:cancel-close'),
  requestQuit: () => ipcRenderer.invoke('app:request-close'),
  restartApplication: () => ipcRenderer.invoke('app:restart-application'),
  exitApplication: () => ipcRenderer.invoke('app:exit-application'),
  setStudentContextMenuTarget: (student) => ipcRenderer.sendSync('students:set-context-menu-target', student || null),
  onDeleteStudentFromContextMenu: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, student) => callback(student);
    ipcRenderer.on('students:delete-from-context-menu', listener);
    return () => ipcRenderer.removeListener('students:delete-from-context-menu', listener);
  },
});
