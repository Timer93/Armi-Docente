$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$armiPorts = @(3000, 3001, 5173)
$armiPortPids = @(
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $armiPorts -contains $_.LocalPort } |
    Select-Object -ExpandProperty OwningProcess -Unique
)

$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(node|powershell|electron)(\.exe)?$' -and
  $_.CommandLine -and
  (
    (
      $_.CommandLine -match [regex]::Escape($projectRoot) -and
      (
        $_.CommandLine -match 'scripts[/\\]dev\.mjs' -or
        $_.CommandLine -match 'backend[/\\]server\.js' -or
        $_.CommandLine -match 'vite' -or
        $_.Name -match '^electron(\.exe)?$'
      )
    ) -or
    (
      $armiPortPids -contains $_.ProcessId -and
      (
        $_.CommandLine -match 'backend[/\\]server\.js' -or
        $_.CommandLine -match '(?:^|[/\\])vite(?:\.js)?(?:\s|$)'
      )
    )
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

if ($stopped -gt 0) {
  $deadline = (Get-Date).AddSeconds(5)
  do {
    $remaining = @($processes | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
}

if ($stopped -eq 0) {
  Write-Output '[dev:stop] No fue necesario cerrar procesos.'
} else {
  Write-Output "[dev:stop] Procesos cerrados: $stopped"
}
