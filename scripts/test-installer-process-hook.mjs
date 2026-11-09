import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const output = path.join(root, 'artifacts', 'installer-process-check');
fs.mkdirSync(output, { recursive: true });
const compiler = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'nsis', 'nsis-3.0.4.1-nsis-3.0.4.1', 'makensis.exe');
const marker = path.join(output, 'passed.txt');
if (fs.existsSync(marker)) fs.unlinkSync(marker);
// A minimal installer exercises the real hook without touching the installed
// application, registry, database or shortcuts. Its own executable lives in
// the test installation folder, reproducing the former false positive.
const script = `Unicode true
!include "LogicLib.nsh"
!define BUILD_RESOURCES_DIR "${path.join(root, 'build')}"
!include "${path.join(root, 'build', 'installer.nsh')}"
Name "ARMI process check test"
OutFile "${path.join(output, 'ARMI_DOCENTE_Setup.exe')}"
InstallDir "${output}"
RequestExecutionLevel user
SilentInstall silent
Var PowerShellPath
Section
  StrCpy $PowerShellPath "$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe"
  !insertmacro customCheckAppRunning
  FileOpen $0 "${marker}" w
  FileWrite $0 "passed"
  FileClose $0
SectionEnd
`;
const source = path.join(output, 'process-check-test.nsi');
fs.writeFileSync(source, script, 'utf8');
const compiled = spawnSync(compiler, ['/V2', source], { encoding: 'utf8', windowsHide: true });
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const executed = spawnSync(path.join(output, 'ARMI_DOCENTE_Setup.exe'), ['/S'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
assert.equal(executed.status, 0, executed.error?.message || executed.stdout + executed.stderr);
assert.equal(fs.readFileSync(marker, 'utf8'), 'passed');
// A harmless NSIS probe stands in for an open app in the isolated directory.
// Confirm that the checker blocks installation without terminating it.
const probeSource = path.join(output, 'probe.nsi');
const probeExe = path.join(output, 'ARMI Docente.exe');
fs.writeFileSync(probeSource, `Unicode true
Name "ARMI test probe"
OutFile "${probeExe}"
RequestExecutionLevel user
SilentInstall silent
Section
Sleep 30000
SectionEnd
`);
const probeCompiled = spawnSync(compiler, ['/V2', probeSource], { encoding: 'utf8', windowsHide: true });
assert.equal(probeCompiled.status, 0, probeCompiled.stdout + probeCompiled.stderr);
const probe = spawn(probeExe, ['/S'], { stdio: 'ignore', windowsHide: true });
try {
  let detected;
  for (let attempt = 0; attempt < 5; attempt++) {
    detected = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'build', 'check-install-processes.ps1'), '-InstallDirectory', output], { encoding: 'utf8', windowsHide: true });
    if (detected.status === 1) break;
  }
  assert.equal(detected.status, 1, 'The test app must be detected');
  assert.match(detected.stdout, /ARMI Docente\.exe \(PID \d+\)/);
  fs.unlinkSync(marker);
  const blocked = spawnSync(path.join(output, 'ARMI_DOCENTE_Setup.exe'), ['/S'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(blocked.status, 2, 'NSIS reports cancellation when a silent installation finds a running app');
  assert.equal(fs.existsSync(marker), false, 'Installation must stop when a real blocker exists');
  assert.equal(process.kill(probe.pid, 0), true, 'The checker must not kill the running app');
} finally {
  probe.kill();
}
console.log('OK: real NSIS hook compiles, ignores its own installer and blocks a test app without killing it. No installed app or data changed.');
