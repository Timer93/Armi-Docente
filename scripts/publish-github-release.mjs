import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const owner = process.env.ARMI_GH_OWNER || '';
const repo = process.env.ARMI_GH_REPO || '';

if (!owner || !repo) {
  console.error('Faltan ARMI_GH_OWNER y ARMI_GH_REPO para publicar releases.');
  process.exit(1);
}

const releaseConfigPath = path.join(process.cwd(), 'electron', 'release-config.json');
const releaseConfig = {
  enabled: true,
  provider: 'github',
  owner,
  repo,
  releaseType: 'release',
  channel: 'latest',
};
fs.writeFileSync(releaseConfigPath, JSON.stringify(releaseConfig, null, 2), 'utf8');

const args = [
  'electron-builder',
  '--win',
  'nsis',
  '--publish',
  'always',
  `-c.publish.provider=github`,
  `-c.publish.owner=${owner}`,
  `-c.publish.repo=${repo}`,
  `-c.publish.releaseType=release`,
];

const child = spawn('npx', args, {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
