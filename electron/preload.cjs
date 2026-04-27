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
  onBeforeQuitAttempt: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('app:before-close', listener);
    return () => ipcRenderer.removeListener('app:before-close', listener);
  },
  continueQuit: () => ipcRenderer.invoke('app:continue-close'),
  cancelQuit: () => ipcRenderer.invoke('app:cancel-close'),
  requestQuit: () => ipcRenderer.invoke('app:request-close'),
});
