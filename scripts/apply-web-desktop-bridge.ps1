$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $process = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'))
    if ($process.ExitCode -ne 0) { throw 'No se completó la actualización. Revisa resultado.json en esta carpeta.' }
    Write-Host 'Actualización instalada. Vuelve a abrir ARMI.'
    exit
}
try {
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'manifest.json') | ConvertFrom-Json
    if ($manifest.directory -notmatch '^armi-web-work-[a-f0-9]{12}$') { throw 'Nombre de actualización no válido.' }
    $resources = Join-Path $env:ProgramFiles 'ARMI Docente\resources'
    $launcher = Join-Path $resources 'backend-process.cjs'
    if ((Get-FileHash -LiteralPath (Join-Path $resources 'app.asar') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.archiveSha256) { throw 'La versión instalada cambió. No se modificó ARMI.' }
    $line = "require('./$($manifest.directory)/register.cjs');"
    $original = [IO.File]::ReadAllText($launcher)
    if ($original.Contains($line)) { Write-Host 'Esta actualización ya está instalada. Reinicia ARMI.'; exit }
    if ((Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.launcherSha256) { throw 'El cargador cambió. No se modificó ARMI.' }
    foreach ($file in $manifest.files) {
        if (@('bridge.cjs','register.cjs','patch.cjs') -notcontains $file.file) { throw 'Archivo no válido.' }
        if ((Get-FileHash -LiteralPath (Join-Path $sourceRoot $file.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'La actualización está incompleta o modificada.' }
    }
    $backup = Join-Path $env:APPDATA ('ARMI Docente\repair-backups\web-work-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    Copy-Item -LiteralPath $launcher -Destination (Join-Path $backup 'backend-process.cjs')
    $target = Join-Path $resources $manifest.directory
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($file in $manifest.files) {
        Copy-Item -LiteralPath (Join-Path $sourceRoot $file.file) -Destination (Join-Path $target $file.file) -Force
        if ((Get-FileHash -LiteralPath (Join-Path $target $file.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Falló la comprobación de los archivos copiados.' }
    }
    $anchor = "const { pathToFileURL } = require('url');"
    if ($original.Split(@($anchor),[StringSplitOptions]::None).Length -ne 2) { throw 'No se reconoce el inicio del cargador.' }
    try { [IO.File]::WriteAllText($launcher,$original.Replace($anchor,($line + "`r`n" + $anchor)),(New-Object Text.UTF8Encoding($false))) }
    catch { Copy-Item -LiteralPath (Join-Path $backup 'backend-process.cjs') -Destination $launcher -Force; throw }
    @{success=$true;backup=$backup;restartRequired=$true;databaseChanged=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sourceRoot 'resultado.json') -Encoding UTF8
    Write-Host 'Actualización instalada. Cierra ARMI normalmente y vuelve a abrirlo.'
} catch {
    @{success=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sourceRoot 'resultado.json') -Encoding UTF8
    Write-Error $_.Exception.Message
    exit 1
}
