import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const profile = process.argv[2] || 'node';
const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const rawElectronVersion = packageJson.devDependencies?.electron || packageJson.dependencies?.electron || '';
const electronVersion = String(rawElectronVersion).replace(/^[^\d]*/, '');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(npmCmd, args, {
    stdio: 'inherit',
    shell: true,
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

const main = async () => {
  if (profile === 'electron') {
    if (!electronVersion) {
      throw new Error('No pude resolver la version de Electron desde package.json.');
    }

    console.log(`Recompilando better-sqlite3 para Electron ${electronVersion}...`);
    await run([
      'rebuild',
      'better-sqlite3',
      `--target=${electronVersion}`,
      '--runtime=electron',
      '--disturl=https://electronjs.org/headers',
      '--build-from-source',
    ]);
    return;
  }

  if (profile === 'node') {
    console.log(`Recompilando better-sqlite3 para Node ${process.versions.node}...`);
    await run([
      'rebuild',
      'better-sqlite3',
      '--build-from-source',
    ]);
    return;
  }

  throw new Error(`Perfil no soportado: ${profile}. Usa "node" o "electron".`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
