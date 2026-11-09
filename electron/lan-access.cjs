const { dialog } = require('electron');
const { execFile } = require('child_process');

const RULE_NAME = 'ARMI Docente - Portal estudiantes LAN';
const STUDENT_PORTAL_PORT = 3001;
const DISCOVERY_RULE_NAME = 'ARMI Docente - Descubrimiento estudiantes LAN';
const LAN_DIAGNOSTIC_RETRIES = 2;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const powerShellFailure = (error, stderr) => {
  const output = String(stderr || '').trim();
  const failure = new Error(output || 'PowerShell no pudo completar la comprobación.');
  failure.code = error?.code;
  failure.killed = !!error?.killed;
  failure.signal = error?.signal || null;
  return failure;
};

const runPowerShell = (script, timeout = 20000) => new Promise((resolve, reject) => {
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout,
  }, (error, stdout, stderr) => {
    // `error.message` de execFile incluye el comando completo. Nunca debe
    // terminar en una alerta para el docente.
    if (error) return reject(powerShellFailure(error, stderr));
    return resolve(String(stdout || '').trim());
  });
});

const readLanAccessStatusOnce = async () => {
  if (process.platform !== 'win32') return { supported: false, ready: true, networks: [] };
  const script = `
    $networkCheckAvailable = $true
    $firewallCheckAvailable = $true
    $profiles = @()
    $ruleReady = $false
    try {
      $profiles = @(Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object Name, InterfaceAlias, NetworkCategory)
    } catch {
      $networkCheckAvailable = $false
    }
    try {
      $rule = Get-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction SilentlyContinue | Select-Object -First 1
      $portFilter = if ($rule) { $rule | Get-NetFirewallPortFilter -ErrorAction Stop } else { $null }
      $ruleReady = [bool]($rule -and $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $portFilter.LocalPort -contains '${STUDENT_PORTAL_PORT}')
      $discovery = Get-NetFirewallRule -DisplayName '${DISCOVERY_RULE_NAME}' -ErrorAction SilentlyContinue | Select-Object -First 1
      $discoveryPort = if ($discovery) { $discovery | Get-NetFirewallPortFilter -ErrorAction Stop } else { $null }
      $ruleReady = $ruleReady -and [bool]($discovery -and $discovery.Enabled -eq 'True' -and $discovery.Action -eq 'Allow' -and $discoveryPort.LocalPort -contains '50321' -and $discoveryPort.Protocol -eq 'UDP')
    } catch {
      $firewallCheckAvailable = $false
    }
    [pscustomobject]@{
      networks = $profiles
      networkCheckAvailable = $networkCheckAvailable
      firewallCheckAvailable = $firewallCheckAvailable
      hasPrivateNetwork = @($profiles | Where-Object { $_.NetworkCategory -eq 'Private' -or $_.NetworkCategory -eq 'DomainAuthenticated' }).Count -gt 0
      ruleReady = $ruleReady
    } | ConvertTo-Json -Depth 5 -Compress
  `;
  const output = await runPowerShell(script);
  const parsed = JSON.parse(output || '{}');
  const networks = Array.isArray(parsed.networks) ? parsed.networks : parsed.networks ? [parsed.networks] : [];
  const networkCheckAvailable = parsed.networkCheckAvailable !== false;
  const firewallCheckAvailable = parsed.firewallCheckAvailable !== false;
  const diagnosticAvailable = networkCheckAvailable && firewallCheckAvailable;
  return {
    supported: true,
    networks,
    diagnosticAvailable,
    networkCheckAvailable,
    firewallCheckAvailable,
    hasPrivateNetwork: !!parsed.hasPrivateNetwork,
    ruleReady: !!parsed.ruleReady,
    ready: diagnosticAvailable
      ? !!parsed.hasPrivateNetwork && !!parsed.ruleReady
      : null,
  };
};

const readLanAccessStatus = async () => {
  let lastFailure = null;
  for (let attempt = 1; attempt <= LAN_DIAGNOSTIC_RETRIES; attempt += 1) {
    try {
      const status = await readLanAccessStatusOnce();
      if (status.diagnosticAvailable !== false || attempt === LAN_DIAGNOSTIC_RETRIES) return status;
    } catch (error) {
      lastFailure = error;
      if (attempt === LAN_DIAGNOSTIC_RETRIES) throw error;
    }
    await delay(350);
  }
  throw lastFailure || new Error('No fue posible comprobar la configuración LAN.');
};

const enableLanAccess = async () => {
  const elevatedScript = `
    $ErrorActionPreference = 'Stop'
    $profiles = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' })
    foreach ($profile in $profiles) {
      if ($profile.NetworkCategory -ne 'DomainAuthenticated') {
        Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private
      }
    }
    Get-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName '${RULE_NAME}' -Description 'Permite exclusivamente el portal de estudiantes de ARMI dentro de la red local privada.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${STUDENT_PORTAL_PORT} -Profile Private -RemoteAddress LocalSubnet | Out-Null
    Get-NetFirewallRule -DisplayName '${DISCOVERY_RULE_NAME}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName '${DISCOVERY_RULE_NAME}' -Description 'Deteccion automatica de ARMI Estudiante en el aula.' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 50321 -Profile Private -RemoteAddress LocalSubnet | Out-Null
  `;
  const encoded = Buffer.from(elevatedScript, 'utf16le').toString('base64');
  const launcher = `
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}')
    if ($process.ExitCode -ne 0) { exit $process.ExitCode }
  `;
  await runPowerShell(launcher, 120000);
};

const ensureLanAccess = async (parentWindow, log = () => {}) => {
  if (process.platform !== 'win32') return { ready: true, skipped: true };
  let initial;
  try {
    initial = await readLanAccessStatus();
    log('Diagnóstico LAN', initial);
  } catch (error) {
    // Una inspección fallida no demuestra que la LAN esté deshabilitada. Se
    // conserva la configuración existente y ARMI inicia sin una alerta falsa.
    log('Diagnóstico LAN no disponible', {
      code: error?.code || null,
      killed: !!error?.killed,
      signal: error?.signal || null,
    });
    return { ready: null, diagnosticAvailable: false, errorCode: 'LAN_CHECK_UNAVAILABLE' };
  }

  if (initial.diagnosticAvailable === false) {
    log('Diagnóstico LAN incompleto; se conserva la configuración existente', {
      networkCheckAvailable: initial.networkCheckAvailable,
      firewallCheckAvailable: initial.firewallCheckAvailable,
    });
    return initial;
  }

  try {
    if (initial.ready || initial.networks.length === 0) return initial;

    const answer = await dialog.showMessageBox(parentWindow, {
      type: 'question',
      title: 'Habilitar acceso LAN',
      message: 'ARMI necesita habilitar el portal local para tus estudiantes.',
      detail: 'Windows solicitará autorización de administrador una sola vez. La regla permitirá únicamente el portal estudiantil protegido en el puerto 3001 desde dispositivos de tu red privada; no expondrá el sistema docente.',
      buttons: ['Habilitar acceso LAN', 'Ahora no'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response !== 0) return { ...initial, declined: true };

    await enableLanAccess();
    const verified = await readLanAccessStatus();
    log('Verificación LAN', verified);
    if (verified.diagnosticAvailable !== false && !verified.ready) {
      throw new Error('Windows no confirmó la red privada o la regla de firewall.');
    }
    await dialog.showMessageBox(parentWindow, {
      type: 'info',
      title: 'Acceso LAN habilitado',
      message: 'El portal de estudiantes ya está disponible en esta red.',
      detail: 'ARMI volverá a comprobar esta configuración al iniciar y no solicitará permisos mientras permanezca correcta.',
      buttons: ['Entendido'],
    });
    return verified;
  } catch (error) {
    log('No se pudo habilitar LAN', {
      code: error?.code || null,
      killed: !!error?.killed,
      signal: error?.signal || null,
      message: String(error?.message || 'Error desconocido').slice(0, 500),
    });
    await dialog.showMessageBox(parentWindow, {
      type: 'warning',
      title: 'No se habilitó el acceso LAN',
      message: 'ARMI continuará funcionando. El acceso de estudiantes desde otros dispositivos no pudo prepararse automáticamente.',
      detail: 'Comprueba que estás conectado a la red del aula e inténtalo nuevamente al abrir ARMI. Si Windows solicita permiso de administrador, debes aceptarlo. El portal docente y tus datos no se han afectado.',
      buttons: ['Entendido'],
    });
    return { ready: false, errorCode: 'LAN_ENABLE_FAILED' };
  }
};

module.exports = { ensureLanAccess, readLanAccessStatus };
