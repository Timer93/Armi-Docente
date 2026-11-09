$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\build\check-install-processes.ps1" -FunctionsOnly

function Assert-Ids($actual, $expected, $message) {
    $ids = @($actual | ForEach-Object { $_.ProcessId } | Sort-Object)
    if (($ids -join ',') -ne (($expected | Sort-Object) -join ',')) { throw "$message : got $($ids -join ',')" }
}

$directory = 'C:\Program Files\ARMI Docente'
$processes = @(
    [pscustomobject]@{ ProcessId = 1; Name = 'ARMI_DOCENTE_Setup.exe'; ExecutablePath = "$directory\ARMI_DOCENTE_Setup.exe" },
    [pscustomobject]@{ ProcessId = 2; Name = 'ARMI_DOCENTE_Setup (1).exe'; ExecutablePath = "$directory\ARMI_DOCENTE_Setup (1).exe" },
    [pscustomobject]@{ ProcessId = 3; Name = 'Uninstall ARMI Docente.exe'; ExecutablePath = "$directory\Uninstall ARMI Docente.exe" },
    [pscustomobject]@{ ProcessId = 4; Name = 'ARMI Docente.exe'; ExecutablePath = "$directory Backup\ARMI Docente.exe" },
    [pscustomobject]@{ ProcessId = 5; Name = 'node.exe'; ExecutablePath = 'C:\Program Files\nodejs\node.exe' },
    [pscustomobject]@{ ProcessId = 6; Name = 'installer-worker.exe'; ExecutablePath = "$directory\installer-worker.exe" }
)
Assert-Ids @(Get-ArmiInstallationBlockers -Directory $directory -Processes $processes -IgnoredId 6) @() 'Installer, uninstaller, sibling directory and development must not block'
$processes += @(
    [pscustomobject]@{ ProcessId = 7; Name = 'ARMI Docente.exe'; ExecutablePath = "$directory\ARMI Docente.exe" },
    [pscustomobject]@{ ProcessId = 8; Name = 'cloudflared.exe'; ExecutablePath = "$directory\resources\cloudflared\cloudflared.exe" },
    [pscustomobject]@{ ProcessId = 9; Name = 'ARMI Docente.exe'; ExecutablePath = $null }
)
Assert-Ids @(Get-ArmiInstallationBlockers -Directory ($directory.ToUpper() + '\') -Processes $processes -IgnoredId 6) @(7, 8, 9) 'App, installed helper and elevated app must be reported'
Assert-Ids @(Get-ArmiInstallationBlockers -Directory $directory -Processes @()) @() 'Closed app must allow installation'
Write-Output 'OK: installer/self excluded, path boundary enforced, real app/helpers/elevated app detected, no processes terminated.'
