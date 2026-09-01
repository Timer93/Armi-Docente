import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { repairSessionResourceLinksInDatabase } from '../backend/sessionResourceStorage.js';

const dataRoot = path.resolve(process.argv[2] || process.env.ARMI_DATA_ROOT || '');
if (!dataRoot || !fs.existsSync(dataRoot)) {
  throw new Error('Indica una carpeta de datos ARMI existente.');
}

const databasePath = path.join(dataRoot, 'database', 'armi.db');
const uploadsRoot = path.join(dataRoot, 'uploads');
if (!fs.existsSync(databasePath)) throw new Error(`No existe la base: ${databasePath}`);

const backupDirectory = path.join(dataRoot, 'database', 'backups');
fs.mkdirSync(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDirectory, `armi-before-resource-repair-${stamp}.db`);

const db = new Database(databasePath);
try {
  await db.backup(backupPath);
  const result = await repairSessionResourceLinksInDatabase({ db, uploadsRoot });
  console.log(JSON.stringify({ backupPath, ...result }, null, 2));
} finally {
  db.close();
}
