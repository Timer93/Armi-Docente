import { execFileSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes('--dry-run');
const messageArgs = rawArgs.filter((arg) => arg !== '--dry-run');
const rawMessage = messageArgs.join(' ').trim();

const defaultMessage = `Actualizacion ${new Date()
  .toISOString()
  .replace('T', ' ')
  .replace(/\..+$/, ' UTC')}`;

const excludePrefixes = ['uploads/', 'dist/', 'dist_electron/'];

const normalizePath = (value) => value.replace(/\\/g, '/').trim();

const shouldExclude = (filePath) =>
  excludePrefixes.some((prefix) => normalizePath(filePath).startsWith(prefix));

const runGit = (gitArgs, options = {}) => {
  const output = execFileSync('git', gitArgs, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    ...options,
  });
  return typeof output === 'string' ? output.trim() : '';
};

const unstageExcludedChanges = () => {
  const stagedOutput = runGit(['diff', '--cached', '--name-only']);
  const stagedFiles = stagedOutput
    ? stagedOutput.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    : [];
  const excludedStaged = stagedFiles.filter((item) => shouldExclude(item));
  if (excludedStaged.length > 0) {
    runGit(['restore', '--staged', '--', ...excludedStaged]);
  }
};

const stageTrackedChanges = () => {
  const changedTracked = runGit(['ls-files', '-m', '-d'])
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !shouldExclude(item));

  if (changedTracked.length > 0) {
    runGit(['add', '--', ...changedTracked]);
  }

  return changedTracked;
};

const stageUntrackedChanges = () => {
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !shouldExclude(item));

  if (untracked.length > 0) {
    runGit(['add', '--', ...untracked]);
  }

  return untracked;
};

try {
  const branch = runGit(['branch', '--show-current']);
  if (!branch) throw new Error('No se pudo detectar la rama actual.');

  unstageExcludedChanges();
  const tracked = stageTrackedChanges();
  const untracked = stageUntrackedChanges();
  const stagedOutput = runGit(['diff', '--cached', '--name-only']);
  const stagedFiles = stagedOutput
    ? stagedOutput.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    : [];

  if (stagedFiles.length === 0) {
    console.log('No hay cambios listos para subir a GitHub.');
    process.exit(0);
  }

  if (dryRun) {
    console.log('Modo prueba: no se hizo commit ni push.');
    console.log(`Rama: ${branch}`);
    if (tracked.length > 0) console.log(`Rastreados: ${tracked.join(', ')}`);
    if (untracked.length > 0) console.log(`Nuevos: ${untracked.join(', ')}`);
    console.log(`Se subirian: ${stagedFiles.join(', ')}`);
    process.exit(0);
  }

  const commitMessage = rawMessage || defaultMessage;
  runGit(['commit', '-m', commitMessage], { stdio: 'inherit' });
  runGit(['push', 'origin', branch], { stdio: 'inherit' });
  console.log(`Subida completada en origin/${branch}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error al subir a GitHub: ${message}`);
  process.exit(1);
}
