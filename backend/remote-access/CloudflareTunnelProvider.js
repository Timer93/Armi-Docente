import fs from 'fs';
import path from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { appRoot, ensureDir, syncRuntimeRoot } from '../paths.js';
import { TunnelProvider, TUNNEL_STATUS } from './TunnelProvider.js';

const execFileAsync = promisify(execFile);
const DEFAULT_ORIGIN = 'http://127.0.0.1:3001';
const DEFAULT_METRICS = '127.0.0.1:49312';
const START_TIMEOUT_MS = 10 * 60_000;
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_FAILURE_THRESHOLD = 3;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const armiTunnelError = (technicalMessage, publicMessage) => {
  const error = new Error(technicalMessage);
  error.publicMessage = publicMessage;
  return error;
};

const normalizeHttpsUrl = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

const normalizeOriginUrl = (value) => {
  try {
    const parsed = new URL(String(value || DEFAULT_ORIGIN).trim());
    if (parsed.protocol !== 'http:') return '';
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
};

const fetchWithTimeout = async (url, timeoutMs = HEALTH_TIMEOUT_MS, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fileExists = (candidate) => {
  try {
    return Boolean(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const sameWindowsPath = (left, right) => path.resolve(String(left || '')).toLowerCase() === path.resolve(String(right || '')).toLowerCase();

export class CloudflareTunnelProvider extends TunnelProvider {
  constructor(options = {}) {
    super('cloudflare');
    this.runtimeRoot = path.join(syncRuntimeRoot, 'remote-access');
    ensureDir(this.runtimeRoot);
    this.pidRecordPath = path.join(this.runtimeRoot, 'cloudflared-process.json');
    this.pidFilePath = path.join(this.runtimeRoot, 'cloudflared.pid');
    this.logFilePath = path.join(this.runtimeRoot, 'cloudflared.log');
    this.eventLogger = typeof options.logger === 'function' ? options.logger : () => {};
    this.child = null;
    this.status = TUNNEL_STATUS.DISABLED;
    this.publicUrl = '';
    this.dnsPublishedUrl = '';
    this.lastError = null;
    this.consecutiveHealthFailures = 0;
    this.lastSuccessfulHealthAt = 0;
    this.lastHealthCheckAt = 0;
    this.healthCheckPromise = null;
    this.healthGeneration = 0;
    this.automaticRecoveryAllowed = true;
    this.config = this.normalizeConfig(options.config || {});
  }

  normalizeConfig(config = {}) {
    return {
      mode: ['named', 'remote', 'quick'].includes(config.mode) ? config.mode : 'quick',
      cloudflaredPath: String(config.cloudflaredPath || '').trim(),
      configPath: String(config.configPath || '').trim(),
      tunnelName: String(config.tunnelName || '').trim(),
      tokenFile: String(config.tokenFile || '').trim(),
      publicUrl: normalizeHttpsUrl(config.publicUrl),
      originUrl: normalizeOriginUrl(config.originUrl) || DEFAULT_ORIGIN,
      metricsAddress: String(config.metricsAddress || DEFAULT_METRICS).trim(),
      startupTimeoutMs: Math.max(10_000, Number(config.startupTimeoutMs) || START_TIMEOUT_MS),
      allowQuickTunnel: config.allowQuickTunnel !== false,
    };
  }

  updateConfig(config = {}) {
    if (this.isRunning()) throw armiTunnelError('Cannot update a running tunnel.', 'Desactiva el acceso remoto antes de cambiar su configuracion.');
    this.config = this.normalizeConfig({ ...this.config, ...config });
    return { ...this.config, tokenFile: this.config.tokenFile ? '[configurado]' : '' };
  }

  async initialize() {
    await this.cleanupStaleOwnProcess();
    this.status = TUNNEL_STATUS.DISABLED;
    return this.status;
  }

  async start() {
    if (this.isRunning()) return this.getStatus();
    this.status = TUNNEL_STATUS.STARTING;
    this.lastError = null;
    this.publicFailureKind = '';
    this.consecutiveHealthFailures = 0;
    this.lastSuccessfulHealthAt = 0;
    this.lastHealthCheckAt = 0;
    this.automaticRecoveryAllowed = true;
    this.startCancelled = false;
    this.publicUrl = this.config.publicUrl;
    this.dnsPublishedUrl = '';

    if (!(await this.checkLocalServer())) {
      throw this.rememberError(armiTunnelError(
        `Local student server unavailable at ${this.config.originUrl}.`,
        'El servidor local de ARMI no esta disponible.',
      ));
    }

    const executablePath = await this.resolveExecutable();
    if (!executablePath) {
      throw this.rememberError(armiTunnelError(
        'cloudflared executable was not found.',
        'Falta el componente de acceso remoto de ARMI. Reinstala o actualiza la aplicacion.',
      ));
    }

    const args = this.buildArguments();
    await this.cleanupStaleOwnProcess();
    try { fs.rmSync(this.pidFilePath, { force: true }); } catch {}
    try { fs.rmSync(this.logFilePath, { force: true }); } catch {}

    this.child = spawn(executablePath, args, {
      cwd: this.runtimeRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.attachChildListeners();
    this.writePidRecord(executablePath, args);

    try {
      await this.waitForConnection();
      this.status = TUNNEL_STATUS.CONNECTED;
      this.eventLogger('TunnelStarted', { pid: this.child?.pid, publicUrl: this.publicUrl });
      return this.status;
    } catch (error) {
      await this.stop().catch(() => {});
      throw this.rememberError(error);
    }
  }

  async stop() {
    this.healthGeneration += 1;
    this.healthCheckPromise = null;
    this.lastHealthCheckAt = 0;
    this.status = TUNNEL_STATUS.STOPPING;
    const child = this.child;
    this.child = null;
    if (child && !child.killed && child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch {}
      const exited = await Promise.race([
        new Promise((resolve) => child.once('exit', () => resolve(true))),
        delay(5_000).then(() => false),
      ]);
      if (!exited && child.exitCode === null) {
        try { child.kill('SIGTERM'); } catch {}
      }
    }
    this.clearPidRecord();
    this.status = TUNNEL_STATUS.DISCONNECTED;
    this.publicUrl = '';
    this.dnsPublishedUrl = '';
    this.consecutiveHealthFailures = 0;
    this.lastSuccessfulHealthAt = 0;
    this.eventLogger('TunnelStopped', {});
    return this.status;
  }

  async getStatus() {
    if (this.healthCheckPromise) return this.healthCheckPromise;
    const pending = this.readHealthStatus();
    this.healthCheckPromise = pending;
    try { return await pending; }
    finally { if (this.healthCheckPromise === pending) this.healthCheckPromise = null; }
  }

  async readHealthStatus() {
    if (!this.isRunning()) {
      if (![TUNNEL_STATUS.DISABLED, TUNNEL_STATUS.ERROR].includes(this.status)) {
        this.status = TUNNEL_STATUS.DISCONNECTED;
      }
      return this.status;
    }

    // The monitor and status panels share one sample. Repeated UI polling must
    // not turn one network failure into three consecutive failures at once.
    if (this.lastHealthCheckAt && Date.now() - this.lastHealthCheckAt < 15_000) return this.status;
    this.lastHealthCheckAt = Date.now();
    const generation = this.healthGeneration;

    if (this.status === TUNNEL_STATUS.CONNECTED
      && this.lastSuccessfulHealthAt
      && Date.now() - this.lastSuccessfulHealthAt < 30_000) return this.status;

    let connectorReady = false;
    let publicReady = false;
    if (this.status === TUNNEL_STATUS.STARTING) {
      const [connector, dnsPublished] = await Promise.all([
        this.checkConnectorReady(),
        this.checkPublicDnsPublished(),
      ]);
      connectorReady = connector;
      // Evita consultar el DNS normal antes de que Cloudflare publique el
      // nombre, porque una respuesta NXDOMAIN puede quedar en cache minutos.
      publicReady = dnsPublished ? await this.checkPublicAvailability() : false;
    } else {
      [connectorReady, publicReady] = await Promise.all([
        this.checkConnectorReady(),
        this.checkPublicAvailability(),
      ]);
    }

    if (generation !== this.healthGeneration) return this.status;
    if (connectorReady && publicReady) {
      this.automaticRecoveryAllowed = true;
      this.consecutiveHealthFailures = 0;
      this.lastSuccessfulHealthAt = Date.now();
      this.status = TUNNEL_STATUS.CONNECTED;
      this.lastError = null;
      return this.status;
    }

    if (this.status === TUNNEL_STATUS.STARTING) {
      // Durante el arranque Cloudflare puede tardar en publicar/resolver la URL.
      // No convertimos ese periodo normal de propagacion en una desconexion.
      this.lastError = null;
      return this.status;
    }

    this.consecutiveHealthFailures += 1;

    // Un fallo HTTP/DNS aislado no significa que cloudflared haya muerto.
    // Mientras el proceso siga vivo, exigimos varios fallos consecutivos antes
    // de declarar el tunel desconectado y permitir que el monitor lo reinicie.
    if (this.consecutiveHealthFailures < HEALTH_FAILURE_THRESHOLD) {
      this.eventLogger('TunnelHealthTransientFailure', {
        connectorReady,
        publicReady,
        consecutiveFailures: this.consecutiveHealthFailures,
      });
      return this.status === TUNNEL_STATUS.CONNECTED
        ? TUNNEL_STATUS.CONNECTED
        : this.status;
    }

    const automaticRecoveryAllowed = !connectorReady
      || (!['dns', 'busy', 'portal'].includes(this.publicFailureKind) && await this.checkLocalServer());
    if (generation !== this.healthGeneration) return this.status;
    this.status = TUNNEL_STATUS.DISCONNECTED;
    this.automaticRecoveryAllowed = automaticRecoveryAllowed;
    this.lastError = armiTunnelError(
      `Tunnel health failed ${this.consecutiveHealthFailures} consecutive times (connector=${connectorReady}, public=${publicReady}).`,
      connectorReady
        ? this.publicFailureMessage()
        : 'Cloudflare Tunnel perdio la conexion. ARMI intentara recuperarla mientras siga habilitado.',
    );
    return this.status;
  }

  getPublicUrl() {
    return this.status === TUNNEL_STATUS.CONNECTED ? this.publicUrl : '';
  }

  getConnectionInfo() {
    return { automaticRecoveryAllowed: this.automaticRecoveryAllowed };
  }

  cancelPendingStart() { this.startCancelled = true; }

  isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  getLastError() {
    return this.lastError;
  }

  async resolveExecutable() {
    const candidates = [
      this.config.cloudflaredPath,
      process.env.ARMI_CLOUDFLARED_PATH,
      path.join(appRoot, 'build', 'cloudflared', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
      path.join(this.runtimeRoot, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'),
      process.resourcesPath ? path.join(process.resourcesPath, 'cloudflared', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared') : '',
    ].filter(Boolean);
    const direct = candidates.find(fileExists);
    if (direct) return path.resolve(direct);
    try {
      const command = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(command, [process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'], { windowsHide: true });
      return String(stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find(fileExists) || '';
    } catch {
      return '';
    }
  }

  buildArguments() {
    const common = [
      'tunnel',
      '--no-autoupdate',
      '--loglevel', 'info',
      '--logfile', this.logFilePath,
      '--metrics', this.config.metricsAddress,
      '--pidfile', this.pidFilePath,
    ];
    if (this.config.mode === 'remote') {
      if (!fileExists(this.config.tokenFile)) {
        throw armiTunnelError('Remote tunnel token file is missing.', 'Falta el archivo seguro del tunel configurado.');
      }
      if (!this.config.publicUrl) {
        throw armiTunnelError('Remote tunnel public URL is missing.', 'Falta configurar la direccion publica estable del portal.');
      }
      return [...common, 'run', '--token-file', path.resolve(this.config.tokenFile)];
    }
    if (this.config.mode === 'quick') {
      if (!this.config.allowQuickTunnel) {
        throw armiTunnelError('Quick Tunnel is disabled.', 'El acceso remoto gratuito esta desactivado en la configuracion de ARMI.');
      }
      return [...common, '--url', this.config.originUrl];
    }
    if (!fileExists(this.config.configPath)) {
      throw armiTunnelError('Named tunnel config file is missing.', 'Falta seleccionar la configuracion del tunel de Cloudflare.');
    }
    if (!this.config.publicUrl) {
      throw armiTunnelError('Named tunnel public URL is missing.', 'Falta configurar la direccion publica estable del portal.');
    }
    return [
      'tunnel', '--config', path.resolve(this.config.configPath),
      '--no-autoupdate', '--loglevel', 'info', '--logfile', this.logFilePath,
      '--metrics', this.config.metricsAddress, '--pidfile', this.pidFilePath,
      'run', ...(this.config.tunnelName ? [this.config.tunnelName] : []),
    ];
  }

  attachChildListeners() {
    const child = this.child;
    let recentOutput = '';
    const parseOutput = (chunk) => {
      if (this.child !== child) return;
      recentOutput = `${recentOutput}${String(chunk || '')}`.replace(/\u001b\[[0-9;]*m/g, '').slice(-16_384);
      if (this.config.mode === 'quick') {
        const quickUrl = recentOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
        if (quickUrl) this.publicUrl = normalizeHttpsUrl(quickUrl);
      }
    };
    this.child.stdout?.on('data', parseOutput);
    this.child.stderr?.on('data', parseOutput);
    this.child.once('error', (error) => {
      if (this.child !== child) return;
      this.status = TUNNEL_STATUS.ERROR;
      this.rememberError(armiTunnelError(error.message, 'No fue posible iniciar Cloudflare Tunnel.'));
    });
    this.child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      if (![TUNNEL_STATUS.STOPPING, TUNNEL_STATUS.DISABLED].includes(this.status)) {
        this.status = TUNNEL_STATUS.DISCONNECTED;
        this.lastError = armiTunnelError(
          `cloudflared exited unexpectedly (code=${code}, signal=${signal}).`,
          'Cloudflare Tunnel se desconecto inesperadamente.',
        );
      }
    });
  }

  async waitForConnection() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.config.startupTimeoutMs) {
      if (this.startCancelled) throw armiTunnelError('Tunnel start cancelled.', 'Se cancelo el inicio del acceso remoto.');
      if (!this.isRunning()) {
        throw armiTunnelError('cloudflared exited before becoming ready.', 'No fue posible establecer el tunel. Revisa la configuracion o la conexion a Internet.');
      }
      if (!this.publicUrl && this.config.mode === 'quick') this.captureQuickUrlFromLog();
      if (this.publicUrl) {
        const [connectorReady, dnsPublished] = await Promise.all([
          this.checkConnectorReady(),
          this.checkPublicDnsPublished(),
        ]);
        if (connectorReady && dnsPublished && await this.checkPublicAvailability()) return;
      }
      await delay(750);
    }
    throw armiTunnelError('Timed out waiting for cloudflared readiness.', this.publicFailureMessage());
  }

  captureQuickUrlFromLog() {
    try {
      const output = fs.readFileSync(this.logFilePath, 'utf8').slice(-64_000);
      const quickUrl = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
      if (quickUrl) this.publicUrl = normalizeHttpsUrl(quickUrl);
    } catch {}
  }

  async checkLocalServer() {
    try {
      const response = await fetchWithTimeout(`${this.config.originUrl}/api/health`);
      return response.ok && response.headers.get('x-armi-portal') === 'student-only';
    } catch {
      return false;
    }
  }

  async checkConnectorReady() {
    try {
      const response = await fetchWithTimeout(`http://${this.config.metricsAddress}/ready`);
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async checkPublicServer(requester = fetchWithTimeout) {
    if (!this.publicUrl) return false;
    try {
      this.publicFailureKind = 'unreachable';
      const response = await requester(`${this.publicUrl}/api/health`, 8_000, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      });
      if (response.status === 429) this.publicFailureKind = 'busy';
      if (!response.ok || response.headers.get('x-armi-portal') !== 'student-only') return false;
      const body = await response.json().catch(() => null);
      if (body?.success !== true) return false;
      const page = await requester(`${this.publicUrl}/estudiante`, 8_000, {
        headers: { accept: 'text/html', 'cache-control': 'no-cache' },
      });
      if (!page.ok || !(await page.text()).includes('<title>ARMI Estudiantes</title>')) {
        if (page.status === 429) this.publicFailureKind = 'busy';
        else if (page.status < 500) this.publicFailureKind = 'portal';
        return false;
      }
      this.publicFailureKind = '';
      return true;
    } catch (error) {
      if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.cause?.code || error?.code)) {
        this.publicFailureKind = 'dns';
      }
      return false;
    }
  }

  publicFailureMessage() {
    return this.publicFailureKind === 'dns'
      ? 'Esta red no encuentra el nombre del enlace (DNS). Comprueba el DNS del router o prueba con datos moviles. El enlace local es una alternativa dentro del mismo Wi-Fi si el acceso LAN esta habilitado.'
      : 'El portal publico no responde de forma estable. ARMI mantendra el tunel mientras cloudflared siga activo y solo intentara recuperarlo tras varios fallos consecutivos.';
  }

  async checkPublicAvailability() {
    return this.checkPublicServer();
  }

  async checkPublicDnsPublished() {
    if (!this.publicUrl) return false;
    if (this.dnsPublishedUrl === this.publicUrl) return true;
    let hostname = '';
    try {
      hostname = new URL(this.publicUrl).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!hostname.endsWith('.trycloudflare.com')) return false;
    try {
      const response = await fetchWithTimeout(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        HEALTH_TIMEOUT_MS,
        { headers: { accept: 'application/dns-json' } },
      );
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      const answers = Array.isArray(body?.Answer) ? body.Answer : [];
      const published = body?.Status === 0 && answers.some((answer) => [1, 5, 28].includes(Number(answer?.type)));
      if (published) this.dnsPublishedUrl = this.publicUrl;
      return published;
    } catch {
      return false;
    }
  }

  writePidRecord(executablePath, args) {
    const record = {
      pid: this.child?.pid || 0,
      executablePath: path.resolve(executablePath),
      pidFilePath: this.pidFilePath,
      startedAt: new Date().toISOString(),
      mode: this.config.mode,
      argsMarker: args.includes(this.pidFilePath) ? this.pidFilePath : '',
    };
    fs.writeFileSync(this.pidRecordPath, JSON.stringify(record, null, 2), 'utf8');
  }

  clearPidRecord() {
    try { fs.rmSync(this.pidRecordPath, { force: true }); } catch {}
    try { fs.rmSync(this.pidFilePath, { force: true }); } catch {}
  }

  async cleanupStaleOwnProcess() {
    if (!fileExists(this.pidRecordPath)) return false;
    let record;
    try { record = JSON.parse(fs.readFileSync(this.pidRecordPath, 'utf8')); } catch { this.clearPidRecord(); return false; }
    const pid = Number(record?.pid || 0);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) { this.clearPidRecord(); return false; }
    const owned = await this.isRecordedProcessOwned(record);
    if (!owned) { this.clearPidRecord(); return false; }
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await delay(400);
    this.clearPidRecord();
    this.eventLogger('TunnelOrphanCleaned', { pid });
    return true;
  }

  async isRecordedProcessOwned(record) {
    if (process.platform !== 'win32') {
      try { process.kill(Number(record.pid), 0); return true; } catch { return false; }
    }
    try {
      const pid = Number(record.pid);
      const script = `$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if($p){$p | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress}`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
      const processInfo = JSON.parse(String(stdout || '').trim() || 'null');
      if (!processInfo) return false;
      const sameExecutable = sameWindowsPath(processInfo.ExecutablePath, record.executablePath);
      const commandLine = String(processInfo.CommandLine || '').toLowerCase();
      const marker = String(record.pidFilePath || record.argsMarker || '').toLowerCase();
      return sameExecutable && Boolean(marker) && commandLine.includes(marker);
    } catch {
      return false;
    }
  }

  rememberError(error) {
    this.lastError = error;
    this.status = TUNNEL_STATUS.ERROR;
    this.eventLogger('TunnelError', { message: String(error?.message || error) });
    return error;
  }
}
