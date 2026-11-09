import fs from 'fs';
import path from 'path';
import { ensureDir, syncRuntimeRoot } from '../paths.js';
import { CloudflareTunnelProvider } from './CloudflareTunnelProvider.js';
import { TunnelManager, TUNNEL_STATUS } from './TunnelManager.js';
import { shouldRecoverTunnel } from './tunnelRecovery.js';
import { reconcileEvidenceState } from '../evidenceReconciliationService.js';

const runtimeRoot = path.join(syncRuntimeRoot, 'remote-access');
const settingsPath = path.join(runtimeRoot, 'settings.json');
const eventsPath = path.join(runtimeRoot, 'events.log');
ensureDir(runtimeRoot);

const backendPort = Number(process.env.ARMI_BACKEND_PORT || 3000);
const studentPortalPort = Number(process.env.ARMI_STUDENT_PORTAL_PORT || (backendPort + 1));
const studentPortalOrigin = `http://127.0.0.1:${studentPortalPort}`;
const tunnelMetricsAddress = String(process.env.ARMI_REMOTE_METRICS_ADDRESS || '127.0.0.1:49312');

const MONITOR_INTERVAL_MS = 15_000;
const STABLE_CONNECTION_RESET_MS = 5 * 60_000;

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
    const mode = ['named', 'remote', 'quick'].includes(saved.mode) ? saved.mode : 'quick';
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      provider: 'cloudflare',
      mode,
      originUrl: DEFAULT_SETTINGS.originUrl,
      allowQuickTunnel: mode === 'quick' || saved.allowQuickTunnel === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

const appendEvent = (event, details = {}) => {
  try {
    const safeDetails = { ...details };
    delete safeDetails.token;
    fs.appendFileSync(
      eventsPath,
      `${JSON.stringify({ at: new Date().toISOString(), event, ...safeDetails })}\n`,
      'utf8',
    );
  } catch {}
};

let settings = readSettings();
const provider = new CloudflareTunnelProvider({ config: settings, logger: appendEvent });
const manager = new TunnelManager({ provider, logger: appendEvent });

let monitorTimer = null;
let monitorRunning = false;
let disconnectedSince = 0;
let connectedSince = 0;
let lastRestartAt = 0;
let recoveryAttempts = 0;
let initialized = false;
let initializationPromise = null;
let accessEndsAt = '';
let pendingAccessDurationMs = 0;
let expiryTimer = null;
let accessGeneration = 0;

export const validateRemoteAccessExpiry = (value) => {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    const error = new Error('Selecciona una fecha y hora de cierre posterior a la hora actual.');
    error.statusCode = 400;
    throw error;
  }
  return new Date(timestamp).toISOString();
};

export const getRemoteAccessDeadline = () => manager.getState().enabledByTeacher ? accessEndsAt : '';

const clearExpiryTimer = () => {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
};

const scheduleExpiry = () => {
  clearExpiryTimer();
  if (!accessEndsAt) return;
  const remaining = Date.parse(accessEndsAt) - Date.now();
  if (remaining <= 0) {
    void stopRemoteAccess().catch(error => appendEvent('TunnelExpiryStopError', { message: String(error?.message || error) }));
    return;
  }
  expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 60_000));
  expiryTimer.unref?.();
};

const startAccessCountdownIfConnected = (state) => {
  if (state?.tunnelStatus !== TUNNEL_STATUS.CONNECTED || accessEndsAt || pendingAccessDurationMs <= 0) return;
  accessEndsAt = new Date(Date.now() + pendingAccessDurationMs).toISOString();
  const grantedDurationMs = pendingAccessDurationMs;
  pendingAccessDurationMs = 0;
  scheduleExpiry();
  appendEvent('RemoteAccessCountdownStarted', { accessEndsAt, grantedDurationMs });
};

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
    const now = Date.now();

    if (state.tunnelStatus === TUNNEL_STATUS.CONNECTED) {
      startAccessCountdownIfConnected(state);
      disconnectedSince = 0;

      // No ponemos attempts=0 por una sola lectura correcta.
      // Si el tunel esta "flapeando", eso impediria el limite de reintentos.
      if (!connectedSince) connectedSince = now;
      if (now - connectedSince >= STABLE_CONNECTION_RESET_MS) {
        recoveryAttempts = 0;
      }
      return;
    }

    connectedSince = 0;
    if (!disconnectedSince) disconnectedSince = now;

    if (shouldRecoverTunnel({
      state,
      disconnectedSince,
      lastRestartAt,
      attempts: recoveryAttempts,
      now,
    })) {
      lastRestartAt = now;
      recoveryAttempts += 1;

      appendEvent('TunnelRecoveryAttempt', {
        attempt: recoveryAttempts,
        disconnectedForMs: now - disconnectedSince,
      });

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
  monitorTimer = setInterval(() => { void monitorOnce(); }, MONITOR_INTERVAL_MS);
  monitorTimer.unref?.();
};

const buildRemoteAccessSnapshot = async () => {
  const executablePath = await provider.resolveExecutable();
  return {
    ...manager.getState(),
    accessEndsAt: getRemoteAccessDeadline(),
    pendingAccessDurationMs,
    configured: isConfigured(),
    cloudflaredInstalled: Boolean(executablePath),
    configuration: publicSettings(),
  };
};

export const initializeRemoteAccess = async () => {
  if (initialized) return buildRemoteAccessSnapshot();

  if (!initializationPromise) {
    initializationPromise = (async () => {
      await provider.initialize();
      stopMonitor();
      initialized = true;
      appendEvent('RemoteAccessInitialized', { enabledByTeacher: false });
      return buildRemoteAccessSnapshot();
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
};

const ensureRemoteAccessInitialized = async () => {
  if (!initialized) await initializeRemoteAccess();
};

export const getRemoteAccessSnapshot = async ({ refresh = false } = {}) => {
  await ensureRemoteAccessInitialized();
  if (refresh && manager.getState().enabledByTeacher) await manager.refresh();
  return buildRemoteAccessSnapshot();
};

export const configureRemoteAccess = async (next = {}) => {
  await ensureRemoteAccessInitialized();

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

export const startRemoteAccess = async (requestedEndsAt) => {
  const deadline = validateRemoteAccessExpiry(requestedEndsAt);
  const generation = ++accessGeneration;
  clearExpiryTimer();
  accessEndsAt = '';
  pendingAccessDurationMs = Math.max(1_000, Date.parse(deadline) - Date.now());
  appendEvent('RemoteAccessDurationRequested', { pendingAccessDurationMs });
  // Publicamos el inicio mientras se prepara y valida el enlace.
  manager.beginStart();
  await ensureRemoteAccessInitialized();

  // El portal usa la base local. Drive puede bloquear una lectura durante
  // minutos: actualizar su indice no debe impedir iniciar el servidor remoto.
  void reconcileEvidenceState().catch((error) => {
    appendEvent('EvidenceReconciliationFailed', { message: String(error?.message || error) });
  });
  if (generation !== accessGeneration) return getRemoteAccessSnapshot();

  recoveryAttempts = 0;
  disconnectedSince = 0;
  connectedSince = 0;
  lastRestartAt = 0;

  const state = await manager.start();
  startAccessCountdownIfConnected(state);
  const configurationFailure = /no fue encontrado|falta configurar|falta seleccionar|falta el archivo/i
    .test(String(state.lastError || ''));

  if (state.enabledByTeacher && !configurationFailure && (pendingAccessDurationMs > 0 || Date.parse(accessEndsAt) > Date.now())) startMonitor();
  return getRemoteAccessSnapshot();
};

export const restartRemoteAccess = async () => {
  if ((!accessEndsAt && pendingAccessDurationMs <= 0) || (accessEndsAt && Date.parse(accessEndsAt) <= Date.now())) {
    const error = new Error('La hora de cierre ya pasó. Desactiva el acceso y elige una nueva hora.');
    error.statusCode = 400;
    throw error;
  }
  const generation = accessGeneration;
  manager.beginStart({ reconnecting: true });
  await ensureRemoteAccessInitialized();

  void reconcileEvidenceState().catch((error) => {
    appendEvent('EvidenceReconciliationFailed', { message: String(error?.message || error) });
  });
  if (generation !== accessGeneration || (accessEndsAt && Date.parse(accessEndsAt) <= Date.now())) return getRemoteAccessSnapshot();

  // Reinicio manual del docente: inicia una nueva ventana de recuperacion.
  recoveryAttempts = 0;
  disconnectedSince = 0;
  connectedSince = 0;
  lastRestartAt = Date.now();

  const state = await manager.restart();
  startAccessCountdownIfConnected(state);
  if (state.enabledByTeacher) startMonitor();
  return getRemoteAccessSnapshot();
};

export const stopRemoteAccess = async () => {
  await ensureRemoteAccessInitialized();
  accessGeneration += 1;
  clearExpiryTimer();
  accessEndsAt = '';
  pendingAccessDurationMs = 0;

  stopMonitor();
  disconnectedSince = 0;
  connectedSince = 0;
  recoveryAttempts = 0;
  lastRestartAt = 0;

  await manager.stop({ disableByTeacher: true });
  return getRemoteAccessSnapshot();
};

export const shutdownRemoteAccess = async () => {
  clearExpiryTimer();
  accessEndsAt = '';
  pendingAccessDurationMs = 0;
  stopMonitor();
  disconnectedSince = 0;
  connectedSince = 0;
  recoveryAttempts = 0;
  lastRestartAt = 0;
  await manager.shutdown();
};

export const setRemoteAccessActivity = (activity) => manager.setActivityCounts(activity);

export { manager as remoteAccessManager };
