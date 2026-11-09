$ErrorActionPreference = 'Stop'
$dataRoot = Join-Path $env:APPDATA 'ARMI Docente'
$backupRoot = [IO.Path]::GetFullPath((Join-Path $dataRoot 'repair-backups'))
if (!(Test-Path -LiteralPath (Join-Path $dataRoot 'database/armi.db'))) { throw 'No se encontro la base original. No se elimino nada.' }
if (!(Test-Path -LiteralPath "$env:ProgramFiles/ARMI Docente/resources/app.asar")) { throw 'No se encontro la aplicacion original. No se elimino nada.' }
$names = @('sync-20261026-205510','sync-hotfix-20261026-212126','cache-reconciliation-1793070813625','sync-hotfix-20261026-225922')
$removed = @()
foreach ($name in $names) {
    $target = [IO.Path]::GetFullPath((Join-Path $backupRoot $name))
    if (!$target.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta fuera de la carpeta de copias.' }
    if (!(Test-Path -LiteralPath $target)) { continue }
    $item = Get-Item -LiteralPath $target -Force
    $entries = @($item) + @(Get-ChildItem -LiteralPath $target -Force -Recurse)
    if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'La copia contiene un enlace; se conserva para revisarla.' }
    $historical = Join-Path $target 'archived-alternatives.json'
    if (Test-Path -LiteralPath $historical) {
        $records = Join-Path $dataRoot 'repair-records/sync-2026-10-26'
        New-Item -ItemType Directory -Path $records -Force | Out-Null
        $saved = Join-Path $records 'archived-alternatives.json'
        Copy-Item -LiteralPath $historical -Destination $saved -Force
        if ((Get-FileHash -LiteralPath $saved).Hash -ne (Get-FileHash -LiteralPath $historical).Hash) { throw 'No se pudo conservar el archivo historico.' }
    }
    $bytes = ($entries | Where-Object { !$_.PSIsContainer } | Measure-Object -Property Length -Sum).Sum
    Remove-Item -LiteralPath $target -Recurse -Force
    $removed += [pscustomobject]@{ Path=$target; Bytes=$bytes }
}
$total = ($removed | Measure-Object -Property Bytes -Sum).Sum
Write-Host ('Copias de la reparacion retiradas: {0:N2} GB.' -f ($total/1e9))
Write-Host 'La aplicacion instalada, la base activa, los recursos y las evidencias originales no se eliminaron.'
