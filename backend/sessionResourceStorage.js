import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SESSION_RESOURCE_MAX_DIMENSION = 1920;

const safeRemove = (target) => {
  try {
    if (target && fs.existsSync(target)) fs.rmSync(target, { force: true });
  } catch {}
};

const verifyVariant = async (target, expectedFormat) => {
  const metadata = await sharp(fs.readFileSync(target)).metadata();
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error(`La variante ${expectedFormat} no superó la verificación de integridad.`);
  }
  return metadata;
};

export const createSessionResourceVariants = async ({
  sourceBuffer,
  baseTarget,
  versioned = true,
}) => {
  if (!Buffer.isBuffer(sourceBuffer) || !sourceBuffer.length) {
    throw new Error('La imagen del recurso está vacía.');
  }

  const sourceMetadata = await sharp(sourceBuffer, { animated: false }).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error('No se pudieron verificar las dimensiones de la imagen.');
  }

  const fingerprint = crypto.createHash('sha256').update(sourceBuffer).digest('hex').slice(0, 12);
  const version = versioned ? `-${Date.now()}-${fingerprint}` : `-${fingerprint}`;
  const targetBase = `${baseTarget}${version}`;
  const webpPath = `${targetBase}.webp`;
  const wordPath = `${targetBase}.word.jpg`;

  fs.mkdirSync(path.dirname(targetBase), { recursive: true });

  try {
    const pipeline = sharp(sourceBuffer, { animated: false })
      .rotate()
      .resize({
        width: SESSION_RESOURCE_MAX_DIMENSION,
        height: SESSION_RESOURCE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });

    await Promise.all([
      pipeline.clone().webp({ quality: 82, effort: 4, smartSubsample: true }).toFile(webpPath),
      pipeline.clone().jpeg({
        quality: 88,
        chromaSubsampling: '4:4:4',
        mozjpeg: true,
        progressive: true,
      }).toFile(wordPath),
    ]);

    const [webpMetadata, wordMetadata] = await Promise.all([
      verifyVariant(webpPath, 'webp'),
      verifyVariant(wordPath, 'jpeg'),
    ]);
    if (webpMetadata.width !== wordMetadata.width || webpMetadata.height !== wordMetadata.height) {
      throw new Error('Las variantes del recurso no conservan las mismas dimensiones.');
    }

    const [webpStat, wordStat] = [fs.statSync(webpPath), fs.statSync(wordPath)];
    return {
      webpPath,
      wordPath,
      fingerprint,
      width: webpMetadata.width,
      height: webpMetadata.height,
      originalBytes: sourceBuffer.length,
      webpBytes: webpStat.size,
      wordBytes: wordStat.size,
    };
  } catch (error) {
    safeRemove(webpPath);
    safeRemove(wordPath);
    throw error;
  }
};

const SESSION_RESOURCE_KEYS = ['instructive', 'annex1', 'annex2'];

const safeResourceSlug = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '') || 'session-resource';

const resolveUploadUrlPath = (rawUrl, uploadsRoot) => {
  const clean = decodeURIComponent(String(rawUrl || '').split(/[?#]/)[0]).replace(/\\/g, '/');
  if (!clean.startsWith('/uploads/')) return '';
  const resolved = path.resolve(uploadsRoot, clean.replace(/^\/uploads\//, ''));
  const check = path.relative(uploadsRoot, resolved);
  return check.startsWith('..') || path.isAbsolute(check) ? '' : resolved;
};

const uploadUrlFromPath = (absolutePath, uploadsRoot) => {
  const relative = path.relative(uploadsRoot, absolutePath).split(path.sep).join('/');
  return `/uploads/${relative}`;
};

const findNewestCompletePair = (directory, prefixes) => {
  if (!fs.existsSync(directory)) return null;
  const normalizedPrefixes = prefixes.filter(Boolean).map((prefix) => prefix.toLowerCase());
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.webp'))
    .filter((entry) => normalizedPrefixes.some((prefix) => entry.name.toLowerCase().startsWith(prefix)))
    .map((entry) => {
      const webpPath = path.join(directory, entry.name);
      const wordPath = webpPath.replace(/\.webp$/i, '.word.jpg');
      return fs.existsSync(wordPath)
        ? { webpPath, wordPath, modifiedAt: Math.max(fs.statSync(webpPath).mtimeMs, fs.statSync(wordPath).mtimeMs) }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0] || null;
};

const findOriginalResource = (directory, prefixes, referencedPaths) => {
  const direct = referencedPaths.find((candidate) => candidate
    && fs.existsSync(candidate)
    && !/\.webp$/i.test(candidate)
    && !/\.word\.jpe?g$/i.test(candidate));
  if (direct) return direct;
  if (!fs.existsSync(directory)) return '';

  const normalizedPrefixes = prefixes.filter(Boolean).map((prefix) => prefix.toLowerCase());
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => /\.(png|jpe?g|bmp|tiff?)$/i.test(entry.name) && !/\.word\.jpe?g$/i.test(entry.name))
    .filter((entry) => normalizedPrefixes.some((prefix) => entry.name.toLowerCase().startsWith(prefix)))
    .map((entry) => ({
      path: path.join(directory, entry.name),
      priority: /\.png$/i.test(entry.name) ? 2 : 1,
      modifiedAt: fs.statSync(path.join(directory, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.priority - left.priority || right.modifiedAt - left.modifiedAt);
  return candidates[0]?.path || '';
};

const stemFromVariantPath = (value) => path.basename(String(value || ''), path.extname(String(value || '')))
  .replace(/-dual-[a-f0-9]{12}$/i, '')
  .replace(/-\d{10,}-[a-f0-9]{12}$/i, '');

export const ensureSessionResourceVariantLinks = async ({ sessionData, sessionId, uploadsRoot }) => {
  const nextData = sessionData && typeof sessionData === 'object' ? structuredClone(sessionData) : {};
  const resources = nextData?.learningResources;
  if (!resources || typeof resources !== 'object') return { sessionData: nextData, changed: false, repaired: 0 };

  let repaired = 0;
  await Promise.all(SESSION_RESOURCE_KEYS.map(async (key) => {
    const resource = resources[key];
    if (!resource || typeof resource !== 'object') return;
    const referencedImagePath = resolveUploadUrlPath(resource.imageUrl, uploadsRoot);
    const referencedWordPath = resolveUploadUrlPath(resource.wordImageUrl, uploadsRoot);
    if (referencedImagePath && referencedWordPath
      && fs.existsSync(referencedImagePath) && fs.existsSync(referencedWordPath)
      && /\.webp$/i.test(referencedImagePath) && /\.word\.jpe?g$/i.test(referencedWordPath)) return;

    const directory = path.join(uploadsRoot, 'session-resources');
    const expectedPrefix = safeResourceSlug(`${sessionId}-${key}`);
    const referencedStem = stemFromVariantPath(referencedImagePath || referencedWordPath);
    const prefixes = [expectedPrefix, referencedStem].filter(Boolean);
    let pair = findNewestCompletePair(directory, prefixes);

    if (!pair) {
      const originalPath = findOriginalResource(
        directory,
        prefixes,
        [referencedImagePath, referencedWordPath],
      );
      if (!originalPath) return;
      const extension = path.extname(originalPath);
      const baseTarget = `${originalPath.slice(0, -extension.length)}-dual`;
      const variants = await createSessionResourceVariants({
        sourceBuffer: fs.readFileSync(originalPath),
        baseTarget,
        versioned: false,
      });
      pair = { webpPath: variants.webpPath, wordPath: variants.wordPath, modifiedAt: Date.now() };
      resource.imageStorage = {
        fingerprint: variants.fingerprint,
        width: variants.width,
        height: variants.height,
        originalBytes: variants.originalBytes,
        webpBytes: variants.webpBytes,
        wordBytes: variants.wordBytes,
      };
    }

    const version = Math.trunc(pair.modifiedAt || Date.now());
    resource.imageUrl = `${uploadUrlFromPath(pair.webpPath, uploadsRoot)}?v=${version}`;
    resource.wordImageUrl = `${uploadUrlFromPath(pair.wordPath, uploadsRoot)}?v=${version}`;
    repaired += 1;
  }));

  return { sessionData: nextData, changed: repaired > 0, repaired };
};

export const repairSessionResourceLinksInDatabase = async ({ db, uploadsRoot }) => {
  const rows = db.prepare('SELECT id_sesion, session_data FROM sesiones').all();
  const update = db.prepare('UPDATE sesiones SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id_sesion = ?');
  let sessionsUpdated = 0;
  let resourcesRepaired = 0;

  for (const row of rows) {
    let sessionData = {};
    try { sessionData = JSON.parse(row.session_data || '{}'); } catch { continue; }
    const result = await ensureSessionResourceVariantLinks({ sessionData, sessionId: row.id_sesion, uploadsRoot });
    if (!result.changed) continue;
    update.run(JSON.stringify(result.sessionData), row.id_sesion);
    sessionsUpdated += 1;
    resourcesRepaired += result.repaired;
  }

  return { sessionsUpdated, resourcesRepaired };
};
