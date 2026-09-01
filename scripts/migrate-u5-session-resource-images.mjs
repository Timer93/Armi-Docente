import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createSessionResourceVariants } from '../backend/sessionResourceStorage.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const databasePath = path.join(projectRoot, 'database', 'armi.db');
const uploadsRoot = path.join(projectRoot, 'uploads');
const reportRoot = path.join(projectRoot, 'artifacts', 'u5-image-optimization');
const applyChanges = process.argv.includes('--apply');

const cleanUploadPath = (rawUrl) => {
  const clean = decodeURIComponent(String(rawUrl || '').split(/[?#]/)[0]).replace(/\\/g, '/');
  if (!clean.startsWith('/uploads/session-resources/')) return '';
  const resolved = path.resolve(uploadsRoot, clean.replace(/^\/uploads\//, ''));
  const check = path.relative(uploadsRoot, resolved);
  return check.startsWith('..') || path.isAbsolute(check) ? '' : resolved;
};

const uploadUrl = (absolutePath) => `/uploads/${path.relative(uploadsRoot, absolutePath).split(path.sep).join('/')}`;

if (!fs.existsSync(databasePath)) throw new Error(`No existe la base de datos: ${databasePath}`);
fs.mkdirSync(reportRoot, { recursive: true });

const db = new Database(databasePath);
const rows = db.prepare(`
  SELECT id_sesion, session_data
  FROM sesiones
  WHERE CAST(unit_number AS TEXT) = '5'
  ORDER BY id_sesion
`).all();

const updates = [];
const files = [];

try {
  for (const row of rows) {
    let sessionData = {};
    try { sessionData = JSON.parse(row.session_data || '{}'); } catch { continue; }
    const resources = sessionData?.learningResources;
    if (!resources || typeof resources !== 'object') continue;
    let changed = false;

    for (const [key, resource] of Object.entries(resources)) {
      if (!resource?.imageUrl) continue;
      const sourcePath = cleanUploadPath(resource.imageUrl);
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;

      const currentWordPath = cleanUploadPath(resource.wordImageUrl);
      if (/\.webp$/i.test(sourcePath) && currentWordPath && fs.existsSync(currentWordPath)) continue;

      const sourceBuffer = fs.readFileSync(sourcePath);
      const extension = path.extname(sourcePath);
      const baseTarget = `${sourcePath.slice(0, -extension.length)}-dual`;
      const variants = await createSessionResourceVariants({ sourceBuffer, baseTarget, versioned: false });
      const imageUrl = `${uploadUrl(variants.webpPath)}?v=${variants.fingerprint}`;
      const wordImageUrl = `${uploadUrl(variants.wordPath)}?v=${variants.fingerprint}`;

      resources[key] = {
        ...resource,
        imageUrl,
        wordImageUrl,
        imageStorage: {
          fingerprint: variants.fingerprint,
          width: variants.width,
          height: variants.height,
          originalBytes: variants.originalBytes,
          webpBytes: variants.webpBytes,
          wordBytes: variants.wordBytes,
        },
      };
      files.push({
        sessionId: row.id_sesion,
        resourceKey: key,
        originalPath: path.relative(projectRoot, sourcePath),
        webpPath: path.relative(projectRoot, variants.webpPath),
        wordPath: path.relative(projectRoot, variants.wordPath),
        originalBytes: variants.originalBytes,
        webpBytes: variants.webpBytes,
        wordBytes: variants.wordBytes,
      });
      changed = true;
    }

    if (changed) updates.push({ id: row.id_sesion, sessionData: JSON.stringify(sessionData) });
  }

  let backupPath = '';
  if (applyChanges && updates.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(projectRoot, 'database', 'backups', `armi-before-u5-dual-images-${stamp}.db`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await db.backup(backupPath);
    const update = db.prepare('UPDATE sesiones SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id_sesion = ?');
    db.transaction((pending) => pending.forEach((item) => update.run(item.sessionData, item.id)))(updates);
  }

  const totals = files.reduce((sum, file) => ({
    originalBytes: sum.originalBytes + file.originalBytes,
    webpBytes: sum.webpBytes + file.webpBytes,
    wordBytes: sum.wordBytes + file.wordBytes,
  }), { originalBytes: 0, webpBytes: 0, wordBytes: 0 });
  const report = {
    generatedAt: new Date().toISOString(),
    applied: applyChanges,
    sessionsUpdated: updates.length,
    resourcesMigrated: files.length,
    originalsDeleted: false,
    backupPath: backupPath ? path.relative(projectRoot, backupPath) : '',
    totals: { ...totals, combinedBytes: totals.webpBytes + totals.wordBytes },
    files,
  };
  const reportPath = path.join(reportRoot, 'migration-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, files: undefined, reportPath: path.relative(projectRoot, reportPath) }, null, 2));
} finally {
  db.close();
}

