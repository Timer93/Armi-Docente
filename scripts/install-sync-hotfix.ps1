#Requires -RunAsAdministrator
param([string]$InstallDirectory = "$env:ProgramFiles\ARMI Docente")
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) {
    throw 'Cierra ARMI antes de actualizar. No se modifico nada.'
}
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$payload = Join-Path $PSScriptRoot 'app.asar'
$installed = Join-Path $InstallDirectory 'resources/app.asar'
$actual = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
if ($actual -eq $manifest.patchedSha256) { Write-Host 'Esta correccion ya esta instalada.'; exit 0 }
if ($actual -ne $manifest.originalSha256) {
    throw 'Esta instalacion es diferente de la version revisada. Se conserva sin cambios para revisarla primero.'
}
if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash -ne $manifest.patchedSha256) {
    throw 'Drive aun no entrego la actualizacion completa o su huella no coincide. No se modifico nada.'
}
$backupRoot = Join-Path $env:APPDATA ('ARMI Docente/repair-backups/sync-hotfix-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$dataRoot = Join-Path $env:APPDATA 'ARMI Docente'
foreach ($relative in @('database/armi.db','database/armi.db-wal','database/armi.db-shm',
    'sync-runtime/incremental-identity-state.json','sync-runtime/sync-config.json')) {
    $source = Join-Path $dataRoot $relative
    if (Test-Path -LiteralPath $source) {
        $destination = Join-Path $backupRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }
}
$staged = Join-Path $InstallDirectory ('resources/app.asar.sync-' + [guid]::NewGuid().ToString() + '.tmp')
Copy-Item -LiteralPath $payload -Destination $staged
if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash -ne $manifest.patchedSha256) { throw 'La copia preparada no paso la verificacion.' }
$backup = Join-Path $backupRoot 'app.asar'
[System.IO.File]::Replace($staged, $installed, $backup)
if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne $manifest.patchedSha256) {
    Copy-Item -LiteralPath $backup -Destination $installed -Force
    throw 'La comprobacion final fallo; se restauro la aplicacion anterior.'
}
Write-Host "Correccion instalada y verificada. Respaldo: $backupRoot"
Write-Host 'La aplicacion sigue cerrada. Conserva este respaldo hasta verificar ambas PC.'
