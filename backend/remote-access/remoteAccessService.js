import fs from 'fs';
import path from 'path';
import { ensureDir, syncRuntimeRoot } from '../paths.js';
import { CloudflareTunnelProvider } from './CloudflareTunnelProvider.js';
import { TunnelManager, TUNNEL_STATUS } from './TunnelManager.js';

const runtimeRoot = path.join(syncRuntimeRoot, 'remote-access');
const settingsPath = path.join(runtimeRoot, 'settings.json');
const eventsPath = path.join(runtimeRoot, 'events.log');
ensureDir(runtimeRoot);
const backendPort = Number(process.env.ARMI_BACKEND_PORT || 3000);
const studentPortalPort = Number(process.env.ARMI_STUDENT_PORTAL_PORT || (backendPort + 1));
const studentPortalOrigin = `http://127.0.0.1:${studentPortalPort}`;
const tunnelMetricsAddress = String(process.env.ARMI_REMOTE_METRICS_ADDRESS || '127.0.0.1:49312');

const DEFAULT_SETTINGS = Object.freeze({
  provider: 'cloudflare',
  mode: 'quick',
  cloudflaredPath: '',
  configPath: '',
  tunnelName: '',
  tokenFile: '',
  publicUrl: '',
  originUrl: studentPortalOrigin,
  metricsAddress: tunnelMetricsAddress,
  allowQuickTunnel: true,
});

const readSettings = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...saved, mode: 'quick', originUrl: DEFAULT_SETTINGS.originUrl, allowQuickTunnel: true };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

const appendEvent = (event, details = {}) => {
  try {
    const safeDetails = { ...details };
    delete safeDetails.token;
    fs.appendFileSync(eventsPath, `${JSON.stringify({ at: new Date().toISOString(), event, ...safeDetails })}\n`, 'utf8');
  } catch {}
};

let settings = readSettings();
const provider = new CloudflareTunnelProvider({ config: settings, logger: appendEvent });
const manager = new TunnelManager({ provider, logger: appendEvent });
let monitorTimer = null;
let monitorRunning = false;
let disconnectedSince = 0;
let lastRestartAt = 0;

const publicSettings = () => ({
  provider: settings.provider,
  mode: settings.mode,
  cloudflaredPath: settings.cloudflaredPath,
  configPath: settings.configPath,
  tunnelName: settings.tunnelName,
  tokenFileConfigured: Boolean(settings.tokenFile),
  publicUrl: settings.publicUrl,
  allowQuickTunnel: true,
});

const persistSettings = () => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
};

const isConfigured = () => {
  if (settings.mode === 'quick') return true;
  if (!settings.publicUrl) return false;
  if (settings.mode === 'remote') return Boolean(settings.tokenFile);
  return Boolean(settings.configPath);
};

const stopMonitor = () => {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
};

const monitorOnce = async () => {
  if (monitorRunning || !manager.getState().enabledByTeacher) return;
  monitorRunning = true;
  try {
    const state = await manager.refresh();
    if (state.tunnelStatus === TUNNEL_STATUS.CONNECTED) {
      disconnectedSince = 0;
      return;
    }
    if (!disconnectedSince) disconnectedSince = Date.now();
    const processStopped = !provider.isRunning();
    const disconnectedLongEnough = Date.now() - disconnectedSince >= 30_000;
    const restartAllowed = Date.now() - lastRestartAt >= 30_000;
    if (processStopped && disconnectedLongEnough && restartAllowed && manager.getState().enabledByTeacher) {
      lastRestartAt = Date.now();
      await manager.restart();
    }
  } catch (error) {
    appendEvent('TunnelMonitorError', { message: String(error?.message || error) });
  } finally {
    monitorRunning = false;
  }
};

const startMonitor = () => {
  stopMonitor();
  monitorTimer = setInterval(() => { void monitorOnce(); }, 10_000);
  monitorTimer.unref?.();
};

export const initializeRemoteAccess = async () => {
  await provider.initialize();
  stopMonitor();
  appendEvent('RemoteAccessInitialized', { enabledByTeacher: false });
  return getRemoteAccessSnapshot();
};

export const getRemoteAccessSnapshot = async ({ refresh = false } = {}) => {
  if (refresh && manager.getState().enabledByTeacher) await manager.refresh();
  const executablePath = await provider.resolveExecutable();
  return {
    ...manager.getState(),
    configured: isConfigured(),
    cloudflaredInstalled: Boolean(executablePath),
    configuration: publicSettings(),
  };
};

export const configureRemoteAccess = async (next = {}) => {
  if (manager.getState().enabledByTeacher || provider.isRunning()) {
    const error = new Error('Desactiva el acceso remoto antes de cambiar su configuracion.');
    error.statusCode = 409;
    throw error;
  }
  const mode = ['named', 'remote', 'quick'].includes(next.mode) ? next.mode : settings.mode;
  let publicUrl = String(next.publicUrl ?? settings.publicUrl ?? '').trim();
  if (publicUrl) {
    try {
      const parsed = new URL(publicUrl);
      if (parsed.protocol !== 'https:') throw new Error('invalid protocol');
      publicUrl = parsed.origin;
    } catch {
      const error = new Error('La dirección pública debe ser una URL HTTPS válida.');
      error.statusCode = 400;
      throw error;
    }
  }
  const requestedTokenFile = String(next.tokenFile ?? '').trim();
  settings = {
    ...settings,
    mode,
    cloudflaredPath: String(next.cloudflaredPath ?? settings.cloudflaredPath ?? '').trim(),
    configPath: String(next.configPath ?? settings.configPath ?? '').trim(),
    tunnelName: String(next.tunnelName ?? settings.tunnelName ?? '').trim(),
    tokenFile: requestedTokenFile || String(settings.tokenFile || '').trim(),
    publicUrl,
    originUrl: DEFAULT_SETTINGS.originUrl,
    allowQuickTunnel: mode === 'quick' ? true : next.allowQuickTunnel === true,
  };
  provider.updateConfig(settings);
  persistSettings();
  appendEvent('RemoteAccessConfigured', { mode: settings.mode, publicUrl: settings.publicUrl });
  return getRemoteAccessSnapshot();
};

export const startRemoteAccess = async () => {
  const state = await manager.start();
  const configurationFailure = /no fue encontrado|falta configurar|falta seleccionar|falta el archivo/i.test(String(state.lastError || ''));
  if (state.enabledByTeacher && !configurationFailure) startMonitor();
  return getRemoteAccessSnapshot();
};

export const restartRemoteAccess = async () => {
  const state = await manager.restart();
  if (state.enabledByTeacher) startMonitor();
  return getRemoteAccessSnapshot();
};

export const stopRemoteAccess = async () => {
  stopMonitor();
  disconnectedSince = 0;
  await manager.stop({ disableByTeacher: true });
  return getRemoteAccessSnapshot();
};

export const shutdownRemoteAccess = async () => {
  stopMonitor();
  disconnectedSince = 0;
  await manager.shutdown();
};

export const setRemoteAccessActivity = (activity) => manager.setActivityCounts(activity);

export { manager as remoteAccessManager };
