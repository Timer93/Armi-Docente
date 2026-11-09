$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 needs the extended-length literal form for deletion
# below deep test folders. All boundary checks still use normal absolute paths.
function ConvertTo-ExtendedLiteralPath([string]$absolute) {
    if ($absolute.StartsWith('\\?\')) { return $absolute }
    if ($absolute.StartsWith('\\')) { return '\\?\UNC\' + $absolute.Substring(2) }
    return '\\?\' + $absolute
}
$workspaceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$records = Join-Path $workspaceRoot 'recovery-candidates/sync-repair-records-2026-10-26'
if (!(Test-Path -LiteralPath (Join-Path $records 'cleanup-prechecks.json'))) { throw 'Falta la comprobacion de originales. No se elimino nada.' }
if (!(Test-Path -LiteralPath (Join-Path $records 'historical-cache-values.json'))) { throw 'Falta el archivo de valores historicos. No se elimino nada.' }
$dataRoot = Join-Path $env:APPDATA 'ARMI Docente'
$originalDatabase = Join-Path $dataRoot 'database/armi.db'
$originalApplication = Join-Path $env:ProgramFiles 'ARMI Docente/resources/app.asar'
if (!(Test-Path -LiteralPath $originalDatabase) -or !(Test-Path -LiteralPath $originalApplication)) { throw 'No se encontraron los originales. No se elimino nada.' }
$applicationHash = (Get-FileHash -LiteralPath $originalApplication -Algorithm SHA256).Hash
$config = Get-Content -LiteralPath (Join-Path $dataRoot 'sync-runtime/sync-config.json') -Raw | ConvertFrom-Json
$diagnosticsRoot = [IO.Path]::GetFullPath((Join-Path $config.mirrorPath '.armi-sync/diagnostics'))
$backupRoot = [IO.Path]::GetFullPath((Join-Path $dataRoot 'repair-backups'))
$targets = @(
    [pscustomobject]@{Base=$workspaceRoot;Path=(Join-Path $workspaceRoot 'recovery-candidates/sync-investigation-2026-10-26')},
    [pscustomobject]@{Base=$workspaceRoot;Path=(Join-Path $workspaceRoot 'recovery-candidates/sync-repair-2026-10-26')},
    [pscustomobject]@{Base=$backupRoot;Path=(Join-Path $backupRoot 'sync-hotfix-20261026-225922')}
)
foreach ($name in @('recoger-pc2.ps1','recoger-instalacion-pc2.ps1','verificar-pc2.ps1','pc2-live-check.json','pc2-live-sync-identity-pending.json','pc2-live-incremental-last-error.json','reconcile-numeric-cache.cjs','conciliar-cache-pc2.ps1','pc2-cache-reconciliation.json','actualizacion-sync','pc2-20261026-205510','pc2-installation','actualizacion-sync-pc2')) {
    $targets += [pscustomobject]@{Base=$diagnosticsRoot;Path=(Join-Path $diagnosticsRoot $name)}
}
# Resolve and check every target before deleting the first one. None can be the
# active database, installation, uploads, event history or evidence directory.
$checked = @()
foreach ($target in $targets) {
    $absolute = [IO.Path]::GetFullPath($target.Path)
    if (!$absolute.StartsWith($target.Base + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta fuera del directorio previsto.' }
    $extended = ConvertTo-ExtendedLiteralPath $absolute
    if (!(Test-Path -LiteralPath $extended)) { continue }
    $item = Get-Item -LiteralPath $extended -Force
    $entries = @($item)
    if ($item.PSIsContainer) { $entries += @(Get-ChildItem -LiteralPath $extended -Force -Recurse -ErrorAction Stop) }
    if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw ('Se encontro un enlace: ' + $absolute) }
    $checked += [pscustomobject]@{Path=$absolute;Bytes=($entries | Where-Object {!$_.PSIsContainer} | Measure-Object -Property Length -Sum).Sum}
}
$receiptPath = Join-Path $records 'deleted-copies.json'
$receipt = @()
if (Test-Path -LiteralPath $receiptPath) { $receipt = @(Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json) }
$removedThisRun = 0
foreach ($target in $checked) {
    $deleteAbsolute = [IO.Path]::GetFullPath($target.Path)
    Remove-Item -LiteralPath (ConvertTo-ExtendedLiteralPath $deleteAbsolute) -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath (ConvertTo-ExtendedLiteralPath $deleteAbsolute)) { throw ('La copia todavia existe: ' + $deleteAbsolute) }
    $receipt += $target
    $removedThisRun += $target.Bytes
    $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    Write-Host ('Copia retirada: ' + $target.Path)
}
if (!(Test-Path -LiteralPath $originalDatabase)) { throw 'No se puede verificar la base original.' }
if ((Get-FileHash -LiteralPath $originalApplication -Algorithm SHA256).Hash -ne $applicationHash) { throw 'La aplicacion cambio durante la limpieza; requiere revision.' }
$bytes = ($receipt | Measure-Object -Property Bytes -Sum).Sum
Write-Host ('Copias retiradas en esta ejecucion: {0:N2} GB.' -f ($removedThisRun/1e9))
Write-Host 'Limpieza finalizada. Las copias ya retiradas antes del error no se repitieron; los borrados parciales se completaron.'
Write-Host 'Los originales de ARMI se conservaron. El archivo historico pequeno tambien.'
Write-Host 'Las copias locales de PC 2, que esta apagada, requieren ejecutar limpiar-copias-locales.ps1 en esa PC.'
