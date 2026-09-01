import { EventEmitter } from 'events';
import { assertTunnelProvider, TUNNEL_STATUS } from './TunnelProvider.js';

const EMPTY_ACTIVITY = Object.freeze({
  connectedStudents: 0,
  activeUploads: 0,
  queuedUploads: 0,
  activeTransfers: 0,
});

const publicError = (error, fallback) => {
  const message = String(error?.publicMessage || '').trim();
  return message || fallback;
};

export class TunnelManager extends EventEmitter {
  constructor({ provider, logger = null }) {
    super();
    this.provider = assertTunnelProvider(provider);
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.operation = Promise.resolve();
    this.state = {
      enabledByTeacher: false,
      tunnelStatus: TUNNEL_STATUS.DISABLED,
      publicUrl: '',
      provider: this.provider.name,
      ...EMPTY_ACTIVITY,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  }

  getState() {
    return { ...this.state };
  }

  setActivityCounts(activity = {}) {
    this.updateState({
      connectedStudents: Math.max(0, Number(activity.connectedStudents) || 0),
      activeUploads: Math.max(0, Number(activity.activeUploads) || 0),
      queuedUploads: Math.max(0, Number(activity.queuedUploads) || 0),
      activeTransfers: Math.max(0, Number(activity.activeTransfers) || 0),
    });
    return this.getState();
  }

  start() {
    return this.enqueue(async () => {
      this.updateState({
        enabledByTeacher: true,
        tunnelStatus: TUNNEL_STATUS.STARTING,
        lastError: null,
      });
      this.log('TunnelStartRequested');
      try {
        await this.provider.start();
        return await this.refresh();
      } catch (error) {
        const message = publicError(error, 'No fue posible iniciar el acceso remoto.');
        this.updateState({ tunnelStatus: TUNNEL_STATUS.ERROR, publicUrl: '', lastError: message });
        this.log('TunnelError', { message: String(error?.message || error) });
        return this.getState();
      }
    });
  }

  restart() {
    return this.enqueue(async () => {
      if (!this.state.enabledByTeacher) return this.getState();
      this.updateState({ tunnelStatus: TUNNEL_STATUS.RECONNECTING, lastError: null });
      this.log('TunnelRestartRequested');
      try {
        await this.provider.restart();
        return await this.refresh();
      } catch (error) {
        const message = publicError(error, 'No fue posible restablecer el acceso remoto.');
        this.updateState({ tunnelStatus: TUNNEL_STATUS.ERROR, publicUrl: '', lastError: message });
        this.log('TunnelError', { message: String(error?.message || error) });
        return this.getState();
      }
    });
  }

  stop({ disableByTeacher = true } = {}) {
    return this.enqueue(async () => {
      if (disableByTeacher) this.state.enabledByTeacher = false;
      if (!this.provider.isRunning()) {
        this.updateState({
          enabledByTeacher: disableByTeacher ? false : this.state.enabledByTeacher,
          tunnelStatus: disableByTeacher ? TUNNEL_STATUS.DISABLED : TUNNEL_STATUS.DISCONNECTED,
          publicUrl: '',
          lastError: null,
        });
        return this.getState();
      }
      this.updateState({ tunnelStatus: TUNNEL_STATUS.STOPPING });
      try {
        await this.provider.stop();
        this.updateState({
          enabledByTeacher: disableByTeacher ? false : this.state.enabledByTeacher,
          tunnelStatus: disableByTeacher ? TUNNEL_STATUS.DISABLED : TUNNEL_STATUS.DISCONNECTED,
          publicUrl: '',
          lastError: null,
        });
        this.log('TunnelStopped');
      } catch (error) {
        const message = publicError(error, 'No fue posible detener completamente el acceso remoto.');
        this.updateState({ tunnelStatus: TUNNEL_STATUS.ERROR, publicUrl: '', lastError: message });
        this.log('TunnelError', { message: String(error?.message || error) });
      }
      return this.getState();
    });
  }

  async refresh() {
    const providerStatus = await this.provider.getStatus();
    const connected = providerStatus === TUNNEL_STATUS.CONNECTED;
    const publicUrl = connected ? String(this.provider.getPublicUrl() || '') : '';
    const lastError = this.provider.getLastError();
    this.updateState({
      tunnelStatus: connected
        ? TUNNEL_STATUS.CONNECTED
        : providerStatus || TUNNEL_STATUS.DISCONNECTED,
      publicUrl,
      lastError: lastError ? publicError(lastError, 'El acceso remoto no esta disponible.') : null,
    });
    if (connected) this.log('TunnelStarted', { publicUrl });
    return this.getState();
  }

  shutdown() {
    return this.stop({ disableByTeacher: true });
  }

  enqueue(task) {
    const run = this.operation.then(task, task);
    this.operation = run.catch(() => {});
    return run;
  }

  updateState(patch) {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.emit('state', this.getState());
  }

  log(event, details = {}) {
    this.logger(event, { provider: this.provider.name, ...details });
  }
}

export { TUNNEL_STATUS };
