import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import os from 'os';

const buildStamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join('dist_electron', `build-${buildStamp}`);
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const rawElectronVersion = packageJson.devDependencies?.electron || packageJson.dependencies?.electron || '';
const electronVersion = String(rawElectronVersion).replace(/^[^\d]*/, '');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const requiresSymlinkPrivilege = process.platform === 'win32' && packageJson?.build?.win?.signAndEditExecutable === true;

const stages = [
  { label: 'Cerrando procesos de desarrollo ARMI', command: npmCmd, args: ['run', 'dev:stop'] },
  { label: 'Preparando icono Windows', command: npmCmd, args: ['run', 'prepare:win-icon'] },
  {
    label: 'Recompilando better-sqlite3 para Electron',
    command: npmCmd,
    args: ['run', 'rebuild:native:electron'],
  },
  { label: 'Compilando frontend', command: npmCmd, args: ['run', 'build'] },
  {
    label: 'Generando instalable Windows',
    command: npxCmd,
    args: ['electron-builder', '--win', 'nsis', `--config.directories.output=${outputDir}`],
  },
  {
    label: 'Restaurando better-sqlite3 para desarrollo Node',
    command: npmCmd,
    args: ['run', 'rebuild:native:node'],
  },
];

const renderBar = (completed) => {
  const total = stages.length;
  const percentage = Math.round((completed / total) * 100);
  const filled = Math.round((completed / total) * 24);
  const bar = `${'='.repeat(filled)}${' '.repeat(Math.max(0, 24 - filled))}`;
  process.stdout.write(`\r[${bar}] ${percentage}%`);
  if (completed === total) process.stdout.write('\n');
};

const runStage = (stage, index) => new Promise((resolve, reject) => {
  console.log(`\n${index + 1}. ${stage.label}`);
  const child = spawn(stage.command, stage.args, {
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      renderBar(index + 1);
      resolve();
      return;
    }

    const hint = stage.label.includes('better-sqlite3 para Electron')
      ? '\nCierra antes cualquier instancia de ARMI, Electron, npm run dev o backend abierto, y vuelve a intentar.'
      : '';

    reject(new Error(`Fallo la etapa: ${stage.label}${hint}`));
  });
});

const canCreateSymlink = () => {
  const probeRoot = path.join(os.tmpdir(), `armi-symlink-probe-${Date.now()}`);
  const targetFile = path.join(probeRoot, 'target.txt');
  const linkFile = path.join(probeRoot, 'target-link.txt');

  try {
    fs.mkdirSync(probeRoot, { recursive: true });
    fs.writeFileSync(targetFile, 'armi');
    fs.symlinkSync(targetFile, linkFile, 'file');
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (fs.existsSync(linkFile)) fs.unlinkSync(linkFile);
    } catch {}
    try {
      if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
    } catch {}
    try {
      if (fs.existsSync(probeRoot)) fs.rmdirSync(probeRoot);
    } catch {}
  }
};

const runPreflightChecks = () => {
  if (!requiresSymlinkPrivilege) return;
  if (canCreateSymlink()) return;

  throw new Error(
    [
      'Fallo la verificacion previa del empaquetado Windows.',
      '',
      'Este build necesita permiso para crear enlaces simbolicos porque `signAndEditExecutable` esta activado.',
      'Activa una de estas opciones en tu PC de desarrollo y vuelve a intentar:',
      '1. Abrir PowerShell como Administrador.',
      '   Comando sugerido:',
      `   Start-Process powershell -Verb RunAs -ArgumentList '-NoExit','-Command','Set-Location "${process.cwd()}"'`,
      '2. Activar Developer Mode en Windows.',
      '   Comando sugerido (ejecutar como Administrador):',
      '   reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"',
      '',
      'Asi evitamos que electron-builder falle a mitad del proceso al extraer winCodeSign.'
    ].join('\n')
  );
};

const main = async () => {
  console.log('Construccion de instalable ARMI');
  console.log(`Salida de esta compilacion: ${outputDir}`);
  runPreflightChecks();
  renderBar(0);
  let electronNativeReady = false;
  let nodeNativeRestored = false;
  try {
    for (let index = 0; index < stages.length; index += 1) {
      await runStage(stages[index], index);
      if (stages[index].label.includes('better-sqlite3 para Electron')) electronNativeReady = true;
      if (stages[index].label.includes('better-sqlite3 para desarrollo Node')) nodeNativeRestored = true;
    }
  } finally {
    if (electronNativeReady && !nodeNativeRestored) {
      console.log('\nRestaurando better-sqlite3 para Node despues del fallo...');
      await runStage({
        label: 'Restaurando better-sqlite3 para desarrollo Node',
        command: npmCmd,
        args: ['run', 'rebuild:native:node'],
      }, stages.length - 1).catch((restoreError) => {
        console.error(`No se pudo restaurar better-sqlite3 para Node: ${restoreError.message}`);
      });
    }
  }
  console.log(`\nInstalable generado en ${outputDir}`);
};

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
