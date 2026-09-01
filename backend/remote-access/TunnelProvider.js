export const TUNNEL_STATUS = Object.freeze({
  DISABLED: 'DISABLED',
  STARTING: 'STARTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  STOPPING: 'STOPPING',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
});

export class TunnelProvider {
  constructor(name) {
    if (new.target === TunnelProvider) {
      throw new TypeError('TunnelProvider es un contrato abstracto.');
    }
    this.name = String(name || 'unknown');
  }

  async start() {
    throw new Error('El proveedor no implementa start().');
  }

  async stop() {
    throw new Error('El proveedor no implementa stop().');
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async getStatus() {
    throw new Error('El proveedor no implementa getStatus().');
  }

  getPublicUrl() {
    return '';
  }

  isRunning() {
    return false;
  }

  getLastError() {
    return null;
  }
}

export const assertTunnelProvider = (provider) => {
  const requiredMethods = [
    'start',
    'stop',
    'restart',
    'getStatus',
    'getPublicUrl',
    'isRunning',
    'getLastError',
  ];
  const missing = requiredMethods.filter((method) => typeof provider?.[method] !== 'function');
  if (missing.length > 0) {
    throw new TypeError(`Proveedor de tunel incompleto: ${missing.join(', ')}.`);
  }
  return provider;
};
