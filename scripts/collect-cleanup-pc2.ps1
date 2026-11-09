$ErrorActionPreference = 'Stop'
$taskData = Join-Path $env:APPDATA 'ARMI Docente'
$taskConfig = Get-Content -LiteralPath (Join-Path $taskData 'sync-runtime/sync-config.json') -Raw | ConvertFrom-Json
$taskStatePath = Join-Path $taskData 'sync-runtime/incremental-identity-state.json'
$taskState = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
if ($taskState.deviceId -ne '584392cf9397665d') { throw 'Este comprobador es para la otra PC de ARMI (PC 2). No se modifico nada.' }
if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) { throw 'Cierra ARMI Docente antes de continuar. Mantiene Google Drive abierto.' }
$taskStamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$taskBackup = Join-Path $taskData ('repair-backups/limpieza-' + $taskStamp)
$taskCapture = Join-Path $taskBackup 'capture'
New-Item -ItemType Directory -Path $taskCapture -Force | Out-Null
$taskRecords = @()
foreach ($taskRelative in @('database/armi.db','database/armi.db-wal','database/armi.db-shm',
    'sync-runtime/incremental-identity-state.json','sync-runtime/incremental-mirror-state.json',
    'sync-runtime/incremental-identity-fast-state.json','sync-runtime/incremental-last-error.json',
    'sync-runtime/incremental-pending-publication.json','sync-runtime/sync-identity-pending.json',
    'sync-runtime/sync-config.json')) {
    $taskSource = Join-Path $taskData $taskRelative
    if (!(Test-Path -LiteralPath $taskSource)) { continue }
    $taskTarget = Join-Path $taskCapture $taskRelative
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskTarget) -Force | Out-Null
    Copy-Item -LiteralPath $taskSource -Destination $taskTarget
    $taskHash = (Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash
    if ($taskHash -ne (Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash) { throw 'La copia cambio durante la captura. No se envia un respaldo incompleto.' }
    $taskRecords += [pscustomobject]@{Path=$taskRelative;Bytes=(Get-Item -LiteralPath $taskTarget).Length;SHA256=$taskHash}
}
if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) { throw 'ARMI se abrio durante la captura. Cierra ARMI y vuelve a ejecutar el comprobador.' }
$taskApp = Join-Path $env:ProgramFiles 'ARMI Docente/resources/app.asar'
$taskReport = [pscustomobject]@{deviceId=$taskState.deviceId;capturedAt=(Get-Date).ToUniversalTime().ToString('o');
    lastRunAt=$taskState.lastRunAt;identityPending=$taskState.identityPending;reconciliationPending=$taskState.reconciliationPending;
    applicationSHA256=$(if (Test-Path -LiteralPath $taskApp) {(Get-FileHash -LiteralPath $taskApp -Algorithm SHA256).Hash} else {$null});
    files=$taskRecords;localBackup=$taskBackup}
$taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskCapture 'capture-report.json') -Encoding UTF8
$taskZip = Join-Path $taskBackup ('limpieza-pc2-' + $taskStamp + '.zip')
Compress-Archive -LiteralPath (Join-Path $taskCapture 'database'),(Join-Path $taskCapture 'sync-runtime'),(Join-Path $taskCapture 'capture-report.json') -DestinationPath $taskZip -CompressionLevel Optimal
$taskDestination = Join-Path $taskConfig.mirrorPath '.armi-sync/diagnostics'
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
$taskShared = Join-Path $taskDestination (Split-Path -Leaf $taskZip)
Copy-Item -LiteralPath $taskZip -Destination $taskShared
if ((Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $taskShared -Algorithm SHA256).Hash) { throw 'El archivo compartido no coincide. La copia local esta conservada.' }
Write-Host ('Comprobacion y respaldo enviados: ' + $taskShared)
Write-Host ('Respaldo local: ' + $taskBackup)
Write-Host 'Deja ARMI cerrada y Google Drive abierto hasta que termine esta limpieza.'
