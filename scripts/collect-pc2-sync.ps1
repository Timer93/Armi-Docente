$ErrorActionPreference = 'Stop'
$dataRoot = Join-Path $env:APPDATA 'ARMI Docente'
$config = Get-Content -LiteralPath (Join-Path $dataRoot 'sync-runtime/sync-config.json') -Raw | ConvertFrom-Json
if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) {
    throw 'Cierra ARMI Docente antes de recoger la copia. No se modifico nada.'
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$localBackup = Join-Path $dataRoot "repair-backups/sync-$stamp"
New-Item -ItemType Directory -Path $localBackup -Force | Out-Null
foreach ($relative in @('database/armi.db', 'database/armi.db-wal', 'database/armi.db-shm',
    'sync-runtime/incremental-identity-state.json', 'sync-runtime/incremental-mirror-state.json',
    'sync-runtime/incremental-last-error.json', 'sync-runtime/incremental-pending-publication.json',
    'sync-runtime/sync-identity-pending.json', 'sync-runtime/sync-config.json', 'launcher.log')) {
    $source = Join-Path $dataRoot $relative
    if (Test-Path -LiteralPath $source) {
        $target = Join-Path $localBackup $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
    }
}
$localBackup | Set-Content -LiteralPath (Join-Path $localBackup 'backup-location.txt')
$destination = Join-Path $config.mirrorPath ".armi-sync/diagnostics/pc2-$stamp"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $localBackup 'database') -Destination $destination -Recurse
Copy-Item -LiteralPath (Join-Path $localBackup 'sync-runtime') -Destination $destination -Recurse
if (Test-Path -LiteralPath (Join-Path $localBackup 'launcher.log')) {
    Copy-Item -LiteralPath (Join-Path $localBackup 'launcher.log') -Destination $destination
}
Get-ChildItem -LiteralPath $destination -File -Recurse | ForEach-Object {
    [pscustomobject]@{ Path = $_.FullName.Substring($destination.Length + 1); Bytes = $_.Length; SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'inventory.json') -Encoding UTF8
Write-Host "Copia local protegida: $localBackup"
Write-Host "Diagnostico enviado al espejo: $destination"
Write-Host 'Deja ARMI cerrada. Google Drive debe seguir abierto para terminar la transferencia.'
