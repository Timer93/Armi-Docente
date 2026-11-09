$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'ARMI Docente' -ErrorAction SilentlyContinue) { throw 'Cierra ARMI antes de conciliar. No se modifico nada.' }
$dataRoot = Join-Path $env:APPDATA 'ARMI Docente'
$config = Get-Content -LiteralPath (Join-Path $dataRoot 'sync-runtime/sync-config.json') -Raw | ConvertFrom-Json
$applicationRoot = Join-Path $env:ProgramFiles 'ARMI Docente/resources/app.asar'
$executable = Join-Path $env:ProgramFiles 'ARMI Docente/ARMI Docente.exe'
$helper = Join-Path $PSScriptRoot 'reconcile-numeric-cache.cjs'
$result = Join-Path $dataRoot ('temp/cache-reconciliation-' + [guid]::NewGuid().ToString() + '.json')
$previousMode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $worker = Start-Process -FilePath $executable -ArgumentList @(('"' + $helper + '"'),('"' + $dataRoot + '"'),('"' + $applicationRoot + '"'),('"' + $result + '"')) -WindowStyle Hidden -Wait -PassThru
} finally { $env:ELECTRON_RUN_AS_NODE = $previousMode }
if (!(Test-Path -LiteralPath $result)) { throw 'La comprobacion no termino; conserva ARMI cerrada para revisar el resultado.' }
$report = Get-Content -LiteralPath $result -Raw | ConvertFrom-Json
Copy-Item -LiteralPath $result -Destination (Join-Path $config.mirrorPath '.armi-sync/diagnostics/pc2-cache-reconciliation.json') -Force
if (!$report.success) { throw $report.error }
Write-Host ('Cache reconstruida: {0} notas oficiales; {1} valores anteriores conservados en archivo.' -f $report.officialEntries,$report.archivedAlternatives)
Write-Host 'Notas, estudiantes, sesiones, asistencias y evidencias: sin cambios, verificados por huellas.'
Write-Host ('Respaldo completo: ' + $report.backupRoot)
Write-Host 'Ahora puedes abrir ARMI en PC 2 y dejar que incorpore la conciliacion. Manten PC 1 cerrada.'
