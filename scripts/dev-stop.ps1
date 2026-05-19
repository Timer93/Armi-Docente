$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(node|powershell)(\.exe)?$' -and
  $_.CommandLine -and
  $_.CommandLine -match [regex]::Escape($projectRoot) -and
  (
    $_.CommandLine -match 'scripts/dev\.mjs' -or
    $_.CommandLine -match 'backend/server\.js' -or
    $_.CommandLine -match 'vite'
  )
}

if (-not $processes) {
  Write-Output '[dev:stop] No habia instancias activas de ARMI Docente.'
  exit 0
}

$currentPid = $PID
$stopped = 0

foreach ($process in $processes) {
  if ($process.ProcessId -eq $currentPid) { continue }
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Write-Output "[dev:stop] Cerrado PID $($process.ProcessId) ($($process.Name))"
    $stopped += 1
  } catch {
    Write-Output "[dev:stop] No pude cerrar PID $($process.ProcessId): $($_.Exception.Message)"
  }
}

if ($stopped -eq 0) {
  Write-Output '[dev:stop] No fue necesario cerrar procesos.'
} else {
  Write-Output "[dev:stop] Procesos cerrados: $stopped"
}
