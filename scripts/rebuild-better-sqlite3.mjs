import path from 'path';
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import os from 'os';
import crypto from 'crypto';
import { createRequire } from 'node:module';

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
const betterSqliteSource = path.join(projectRoot, 'node_modules', 'better-sqlite3');
const nodeGypScript = path.join(projectRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const electronNativeOutput = path.join(projectRoot, 'build', 'native', `electron-${electronVersion}`, 'better_sqlite3.node');

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

const runNode = (args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    shell: false,
    cwd,
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('exit', (code) => code === 0
    ? resolve()
    : reject(new Error(`node ${args.join(' ')} fallo con codigo ${code ?? 'desconocido'}.`)));
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const nodeBindingIsReady = () => {
  const probe = spawnSync(process.execPath, ['-e', "const Database=require('better-sqlite3');const db=new Database(':memory:');if(db.prepare('SELECT 42 AS value').get().value!==42)process.exit(1);db.close();process.stdout.write('ready')"], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  return probe.status === 0 && String(probe.stdout || '').includes('ready');
};

const electronBindingIsReady = () => {
  if (!fs.existsSync(electronNativeOutput)) return false;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const probe = spawnSync(createRequire(import.meta.url)('electron'), [
    path.join(projectRoot, 'scripts', 'test-electron-native-binding.cjs'), electronNativeOutput,
  ], { cwd: projectRoot, env, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  return probe.status === 0 && String(probe.stdout || '').includes('better-sqlite3 funciona en Electron');
};

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

const buildElectronBindingInIsolation = async () => {
  if (!fs.existsSync(betterSqliteSource)) throw new Error('No se encontró node_modules/better-sqlite3. Ejecuta npm install.');
  if (!fs.existsSync(nodeGypScript)) throw new Error('No se encontró node-gyp en node_modules. Ejecuta npm install.');

  const isolatedRoot = path.join(os.tmpdir(), `armi-electron-native-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const isolatedModule = path.join(isolatedRoot, 'better-sqlite3');
  const resolvedTempRoot = path.resolve(os.tmpdir());
  try {
    fs.mkdirSync(isolatedRoot, { recursive: true });
    fs.cpSync(betterSqliteSource, isolatedModule, {
      recursive: true,
      filter(source) {
        const relative = path.relative(betterSqliteSource, source);
        return !(relative === 'build' || relative.startsWith(`build${path.sep}`));
      },
    });
    console.log(`Compilación aislada: ${isolatedModule}`);
    await runNode([
      nodeGypScript,
      'rebuild',
      '--release',
      `--target=${electronVersion}`,
      '--arch=x64',
      '--dist-url=https://electronjs.org/headers',
    ], isolatedModule);

    const compiledBinding = path.join(isolatedModule, 'build', 'Release', 'better_sqlite3.node');
    if (!fs.existsSync(compiledBinding) || fs.statSync(compiledBinding).size < 100_000) {
      throw new Error('La compilación terminó sin producir un binario válido de better-sqlite3.');
    }
    fs.mkdirSync(path.dirname(electronNativeOutput), { recursive: true });
    fs.copyFileSync(compiledBinding, electronNativeOutput);
    console.log(`Binario Electron preparado en ${electronNativeOutput}`);
  } finally {
    const resolvedIsolatedRoot = path.resolve(isolatedRoot);
    if (resolvedIsolatedRoot.startsWith(`${resolvedTempRoot}${path.sep}armi-electron-native-`)) {
      try { fs.rmSync(resolvedIsolatedRoot, { recursive: true, force: true }); } catch {}
    }
  }
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

      // A prepared binding must be tested in Electron, not merely required in
      // Node: better-sqlite3 loads its native library when a database is opened.
      if (electronBindingIsReady()) {
        console.log(`SQLite verificado con una consulta real en Electron ${electronVersion}; se reutiliza ${electronNativeOutput}`);
        return;
      }

      console.log(`Compilando better-sqlite3 para Electron ${electronVersion} sin modificar node_modules...`);
      await buildElectronBindingInIsolation();
      if (!electronBindingIsReady()) throw new Error('El binario compilado de SQLite no supero la prueba en Electron.');
      return;
    }

    if (profile === 'node') {
      // El instalador usa Node para preparar una copia coherente de SQLite. Si el
      // módulo ya carga con esta versión de Node, recompilarlo no aporta nada y
      // en Windows puede fallar cuando un antivirus aún inspecciona el .node.
      if (nodeBindingIsReady()) {
        console.log(`better-sqlite3 ya funciona con Node ${process.versions.node}; se omite la recompilación nativa.`);
        return;
      }
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
