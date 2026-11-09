$ErrorActionPreference = 'Stop'
$dataRoot = Join-Path $env:APPDATA 'ARMI Docente'
$config = Get-Content -LiteralPath (Join-Path $dataRoot 'sync-runtime/sync-config.json') -Raw | ConvertFrom-Json
$folder = Join-Path $config.mirrorPath '.armi-sync/diagnostics'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$samples = @()
for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try {
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/sync/status/local' -TimeoutSec 20
        $samples += @{ at = (Get-Date).ToUniversalTime().ToString('o'); status = $status }
        $incremental = $status.data.incrementalSync
        Write-Host ("Estado: {0}; pendientes: {1}; recibidos: {2}; enviados: {3}" -f $incremental.state, $incremental.pendingOperations, $incremental.appliedOperations, $incremental.publishedOperations)
    } catch {
        $samples += @{ at = (Get-Date).ToUniversalTime().ToString('o'); error = $_.Exception.Message }
        Write-Host $_.Exception.Message
    }
    @{ samples = $samples } | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath (Join-Path $folder 'pc2-live-check.json') -Encoding UTF8
    if ($attempt -lt 5) { Start-Sleep -Seconds 10 }
}
foreach ($name in @('sync-identity-pending.json','incremental-last-error.json')) {
    $source = Join-Path $dataRoot ('sync-runtime/' + $name)
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $folder ('pc2-live-' + $name)) -Force }
}
Write-Host 'Comprobacion enviada a Drive. La aplicacion sigue abierta y no se borraron datos.'
