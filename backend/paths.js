import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');

const resolveDefaultDataRoot = () => {
  if (process.env.ARMI_DATA_ROOT) return path.resolve(process.env.ARMI_DATA_ROOT);
  return appRoot;
};

const dataRoot = resolveDefaultDataRoot();
const databaseRoot = path.join(dataRoot, 'database');
const uploadsRoot = path.join(dataRoot, 'uploads');
const tempRoot = path.join(dataRoot, 'temp');
const syncRuntimeRoot = path.join(dataRoot, 'sync-runtime');

const ensureDir = (target) => {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
};

[databaseRoot, uploadsRoot, tempRoot, syncRuntimeRoot].forEach(ensureDir);

const resolveTemplatePath = (filename) => {
  const packagedCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'backend', 'templates', filename)
    : '';
  if (packagedCandidate && fs.existsSync(packagedCandidate)) {
    return packagedCandidate;
  }
  return path.join(appRoot, 'backend', 'templates', filename);
};
const resolveUserDataPath = (...parts) => path.join(dataRoot, ...parts);

export {
  appRoot,
  dataRoot,
  databaseRoot,
  uploadsRoot,
  tempRoot,
  syncRuntimeRoot,
  ensureDir,
  resolveTemplatePath,
  resolveUserDataPath,
};
