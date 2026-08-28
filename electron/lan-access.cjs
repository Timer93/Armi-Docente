const { dialog } = require('electron');
const { execFile } = require('child_process');

const RULE_NAME = 'ARMI Docente - Portal estudiantes LAN';
const STUDENT_PORTAL_PORT = 3001;

const runPowerShell = (script, timeout = 20000) => new Promise((resolve, reject) => {
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout,
  }, (error, stdout, stderr) => {
    if (error) return reject(new Error(String(stderr || error.message || error)));
    return resolve(String(stdout || '').trim());
  });
});

const readLanAccessStatus = async () => {
  if (process.platform !== 'win32') return { supported: false, ready: true, networks: [] };
  const script = `
    $profiles = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object Name, InterfaceAlias, NetworkCategory)
    $rule = Get-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction SilentlyContinue | Select-Object -First 1
    $portFilter = if ($rule) { $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue } else { $null }
    [pscustomobject]@{
      networks = $profiles
      hasPrivateNetwork = @($profiles | Where-Object { $_.NetworkCategory -eq 'Private' -or $_.NetworkCategory -eq 'DomainAuthenticated' }).Count -gt 0
      ruleReady = [bool]($rule -and $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $portFilter.LocalPort -contains '${STUDENT_PORTAL_PORT}')
    } | ConvertTo-Json -Depth 5 -Compress
  `;
  const output = await runPowerShell(script);
  const parsed = JSON.parse(output || '{}');
  const networks = Array.isArray(parsed.networks) ? parsed.networks : parsed.networks ? [parsed.networks] : [];
  return {
    supported: true,
    networks,
    hasPrivateNetwork: !!parsed.hasPrivateNetwork,
    ruleReady: !!parsed.ruleReady,
    ready: !!parsed.hasPrivateNetwork && !!parsed.ruleReady,
  };
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
  try {
    const initial = await readLanAccessStatus();
    log('Diagnóstico LAN', initial);
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
    if (!verified.ready) throw new Error('Windows no confirmó la red privada o la regla de firewall.');
    await dialog.showMessageBox(parentWindow, {
      type: 'info',
      title: 'Acceso LAN habilitado',
      message: 'El portal de estudiantes ya está disponible en esta red.',
      detail: 'ARMI volverá a comprobar esta configuración al iniciar y no solicitará permisos mientras permanezca correcta.',
      buttons: ['Entendido'],
    });
    return verified;
  } catch (error) {
    log('No se pudo habilitar LAN', { message: String(error?.message || error) });
    await dialog.showMessageBox(parentWindow, {
      type: 'warning',
      title: 'No se habilitó el acceso LAN',
      message: 'ARMI continuará funcionando, pero los estudiantes no podrán conectarse desde otros dispositivos.',
      detail: String(error?.message || error),
      buttons: ['Entendido'],
    });
    return { ready: false, error: String(error?.message || error) };
  }
};

module.exports = { ensureLanAccess, readLanAccessStatus };
