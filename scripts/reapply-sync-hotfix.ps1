#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) { throw 'Cierra ARMI antes de aplicar la correccion.' }
$workspaceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$application = Join-Path $env:ProgramFiles 'ARMI Docente/resources/app.asar'
$before = (Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash.ToLowerInvariant()
if ($before -in @('9fbbcc9c0a09ee5b2ac2319955c8a36273a1ba7e27aa4230cd0a7bd40e2ea8d2','8d39246887adb7a161d431810b7a0d1db09e5fe40b6078f29a9e8afa96f1a1ab')) {
    Write-Host 'La correccion ya esta instalada.'; exit 0
}
if ($before -notin @('9ce07f967eaae10244c15c7267db3b496986a79f1153cfc0ee1f9eed91f69767','fb91993e433108e6c04e86d73920418fa9deaab3606591905a7850076f2583b7')) { throw 'La instalacion no coincide con las versiones revisadas.' }
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$staging = [IO.Path]::GetFullPath((Join-Path $temporaryRoot ('armi-sync-hotfix-' + [guid]::NewGuid().ToString())))
if (!$staging.StartsWith($temporaryRoot.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta temporal fuera del directorio previsto.' }
New-Item -ItemType Directory -Path $staging | Out-Null
$preserveStaging = $false
$previousArchive = Join-Path $staging 'previous-app.asar'
$failedArchive = Join-Path $staging 'failed-app.asar'
Push-Location -LiteralPath $workspaceRoot
try {
    $payload = Join-Path $staging 'app.asar'
    & node (Join-Path $PSScriptRoot 'prepare-sync-hotfix.mjs') $application $payload
    if ($LASTEXITCODE -ne 0) { throw 'La preparacion no paso las comprobaciones; la aplicacion sigue sin cambios.' }
    $manifest = Get-Content -LiteralPath (Join-Path $staging 'manifest.json') -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash -ne $manifest.originalSha256) { throw 'La instalacion cambio durante la preparacion.' }
    if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash -ne $manifest.patchedSha256) { throw 'La correccion preparada no coincide con su huella.' }
    $records = Join-Path $env:APPDATA ('ARMI Docente/repair-records/code-hotfix-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $records -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $staging 'manifest.json') -Destination $records
    Copy-Item -LiteralPath (Join-Path $staging 'rollback-header.gz') -Destination $records
    # The original archive body remains inside the patched archive. A compressed
    # original header and the receipt suffice to reconstruct the old archive.
    # PowerShell 5.1 converts a null String argument to an empty path. Use a
    # real temporary backup path, then remove it after verifying the result.
    [IO.File]::Replace($payload,$application,$previousArchive)
    if ((Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash -ne $manifest.patchedSha256) {
        [IO.File]::Replace($previousArchive,$application,$failedArchive)
        if ((Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash.ToLowerInvariant() -ne $before) { throw 'La restauracion requiere revision.' }
        throw 'La comprobacion fallo; se restauro la aplicacion anterior.'
    }
    Write-Host 'Correccion instalada y verificada; la base, las notas y los recursos no se modificaron.'
    Write-Host ('Registro pequeno para restauracion: ' + $records)
} catch {
    if (Test-Path -LiteralPath $previousArchive) {
        $actual = if (Test-Path -LiteralPath $application) { (Get-FileHash -LiteralPath $application -Algorithm SHA256).Hash.ToLowerInvariant() } else { '' }
        if ($actual -ne $before -and $actual -ne $manifest.patchedSha256) { $preserveStaging = $true }
    }
    throw
} finally {
    Pop-Location
    if (!$preserveStaging) {
    foreach ($name in @('app.asar','manifest.json','rollback-header.gz','previous-app.asar','failed-app.asar')) {
        $temporaryFile = [IO.Path]::GetFullPath((Join-Path $staging $name))
        if (!$temporaryFile.StartsWith($staging + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Archivo temporal fuera del directorio previsto.' }
        if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
    }
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Force }
    } else { Write-Host ('Se conserva el respaldo temporal para recuperacion: ' + $staging) }
}
