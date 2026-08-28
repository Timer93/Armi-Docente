import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import os from 'os';
import crypto from 'crypto';

const profile = process.argv[2] || 'node';
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const rawElectronVersion = packageJson.devDependencies?.electron || packageJson.dependencies?.electron || '';
const installedElectronPackage = path.join(process.cwd(), 'node_modules', 'electron', 'package.json');
const electronVersion = fs.existsSync(installedElectronPackage)
  ? String(JSON.parse(fs.readFileSync(installedElectronPackage, 'utf8')).version || '')
  : String(rawElectronVersion).replace(/^[^\d]*/, '');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const projectRoot = path.resolve(process.cwd());
const shortPathKey = crypto.createHash('sha1').update(projectRoot).digest('hex').slice(0, 10);
const shortWorkspacePath = path.join(os.tmpdir(), `armi-native-${shortPathKey}`);

const createShortWorkspaceLink = () => {
  if (process.platform !== 'win32' || !/\s/.test(projectRoot)) return projectRoot;
  try {
    if (fs.existsSync(shortWorkspacePath)) fs.unlinkSync(shortWorkspacePath);
  } catch {
    throw new Error(`No se pudo preparar la ruta temporal de compilacion: ${shortWorkspacePath}`);
  }
  fs.symlinkSync(projectRoot, shortWorkspacePath, 'junction');
  return shortWorkspacePath;
};

const removeShortWorkspaceLink = () => {
  if (shortWorkspacePath === projectRoot) return;
  try {
    if (fs.existsSync(shortWorkspacePath)) fs.unlinkSync(shortWorkspacePath);
  } catch {}
};

const run = (args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(npmCmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`npm ${args.join(' ')} fallo con codigo ${code ?? 'desconocido'}.`));
  });

  child.on('error', (error) => {
    reject(error);
  });
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const runWithLockRetries = async (args, cwd, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run(args, cwd);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const delay = attempt * 1500;
      console.warn(`La recompilacion nativa no termino en el intento ${attempt}. Windows puede estar liberando el archivo; reintentando en ${delay / 1000}s...`);
      await wait(delay);
    }
  }
  throw lastError;
};

const main = async () => {
  const buildWorkspace = createShortWorkspaceLink();
  if (buildWorkspace !== projectRoot) {
    console.log(`Ruta corta para node-gyp: ${buildWorkspace}`);
  }

  try {
    if (profile === 'electron') {
      if (!electronVersion) {
        throw new Error('No pude resolver la version instalada de Electron.');
      }

      console.log(`Recompilando better-sqlite3 para Electron ${electronVersion}...`);
      await runWithLockRetries([
        'rebuild',
        'better-sqlite3',
        `--target=${electronVersion}`,
        '--runtime=electron',
        '--disturl=https://electronjs.org/headers',
        '--build-from-source',
      ], buildWorkspace);
      return;
    }

    if (profile === 'node') {
      console.log(`Recompilando better-sqlite3 para Node ${process.versions.node}...`);
      await runWithLockRetries([
        'rebuild',
        'better-sqlite3',
        '--build-from-source',
      ], buildWorkspace);
      return;
    }

    throw new Error(`Perfil no soportado: ${profile}. Usa "node" o "electron".`);
  } finally {
    removeShortWorkspaceLink();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
