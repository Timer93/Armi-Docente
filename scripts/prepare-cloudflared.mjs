import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';

const CLOUDFLARED_VERSION = '2026.8.2';
const EXPECTED_SHA256 = 'c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5';
const DOWNLOAD_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`;
const destinationDir = path.resolve('build', 'cloudflared');
const destinationPath = path.join(destinationDir, 'cloudflared.exe');

const sha256File = async (filePath) => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const verifyExecutable = () => new Promise((resolve, reject) => {
  const child = spawn(destinationPath, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  child.once('error', reject);
  child.once('exit', (code) => {
    if (code !== 0 || !output.toLowerCase().includes('cloudflared')) {
      reject(new Error(`cloudflared no pudo ejecutarse (codigo ${code}).`));
      return;
    }
    resolve(output.trim());
  });
});

const downloadVerifiedBinary = async () => {
  fs.mkdirSync(destinationDir, { recursive: true });
  if (fs.existsSync(destinationPath) && await sha256File(destinationPath) === EXPECTED_SHA256) {
    return;
  }

  const temporaryPath = `${destinationPath}.download`;
  fs.rmSync(temporaryPath, { force: true });
  const response = await fetch(DOWNLOAD_URL, {
    redirect: 'follow',
    headers: { 'User-Agent': 'ARMI-Docente-Installer' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar cloudflared ${CLOUDFLARED_VERSION} (HTTP ${response.status}).`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryPath, { flags: 'wx' }));
  const actualSha256 = await sha256File(temporaryPath);
  if (actualSha256 !== EXPECTED_SHA256) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error(`cloudflared no supero la verificacion SHA-256. Esperado ${EXPECTED_SHA256}; recibido ${actualSha256}.`);
  }
  fs.rmSync(destinationPath, { force: true });
  fs.renameSync(temporaryPath, destinationPath);
};

await downloadVerifiedBinary();
const versionOutput = await verifyExecutable();
console.log(`cloudflared preparado y verificado: ${versionOutput}`);
console.log(`SHA-256: ${EXPECTED_SHA256}`);

