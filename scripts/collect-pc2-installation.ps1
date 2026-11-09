$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) {
    throw 'Cierra ARMI antes de recoger la instalacion. No se modifico nada.'
}
$config = Get-Content -LiteralPath (Join-Path $env:APPDATA 'ARMI Docente/sync-runtime/sync-config.json') -Raw | ConvertFrom-Json
$installation = Join-Path $env:ProgramFiles 'ARMI Docente'
$archive = Join-Path $installation 'resources/app.asar'
$destination = Join-Path $config.mirrorPath '.armi-sync/diagnostics/pc2-installation'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$hashBefore = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Copy-Item -LiteralPath $archive -Destination (Join-Path $destination 'app.asar') -Force
$hashAfter = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$copyHash = (Get-FileHash -LiteralPath (Join-Path $destination 'app.asar') -Algorithm SHA256).Hash
if ($hashBefore -ne $hashAfter -or $hashBefore -ne $copyHash) { throw 'La instalacion cambio durante la copia; manten ARMI cerrada y repite.' }
@{
    archiveSha256 = $hashAfter
    executableSha256 = (Get-FileHash -LiteralPath (Join-Path $installation 'ARMI Docente.exe') -Algorithm SHA256).Hash
    copiedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'installation.json') -Encoding UTF8
Write-Host 'Copia de la aplicacion verificada y enviada a Drive. La instalacion original no se modifico.'
Write-Host 'Deja ARMI cerrada y Google Drive abierto.'
