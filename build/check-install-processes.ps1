param(
    [string]$InstallDirectory,
    [int]$IgnoreProcessId = 0,
    [switch]$FunctionsOnly
)

function Get-ArmiInstallationBlockers {
    param(
        [string]$Directory,
        [object[]]$Processes,
        [int]$IgnoredId = 0
    )

    if ([string]::IsNullOrWhiteSpace($Directory)) { throw 'No installation directory was supplied.' }
    $directoryPath = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/')
    $directoryPrefix = $directoryPath + [IO.Path]::DirectorySeparatorChar
    foreach ($item in $Processes) {
        if ([int]$item.ProcessId -eq $IgnoredId) { continue }
        $name = [string]$item.Name
        # NSIS can run both its launcher and elevated worker. Neither is ARMI.
        if ($name -match '^(ARMI_DOCENTE_Setup(?:[ ._-].*)?|Uninstall ARMI Docente)\.exe$') { continue }
        $executable = [string]$item.ExecutablePath
        if ([string]::IsNullOrWhiteSpace($executable)) {
            # An elevated ARMI process may hide its path; its exact name still blocks.
            if ($name -ieq 'ARMI Docente.exe') { $item }
            continue
        }
        if ($executable.StartsWith($directoryPrefix, [StringComparison]::OrdinalIgnoreCase)) { $item }
    }
}

if ($FunctionsOnly) { return }

try {
    $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $blockers = @(Get-ArmiInstallationBlockers -Directory $InstallDirectory -Processes $processes -IgnoredId $IgnoreProcessId)
    if ($blockers.Count -eq 0) { exit 0 }
    $blockers | Select-Object -First 8 | ForEach-Object { Write-Output ('{0} (PID {1})' -f $_.Name, $_.ProcessId) }
    exit 1
} catch {
    Write-Output ('Process check failed: ' + $_.Exception.Message)
    exit 2
}
