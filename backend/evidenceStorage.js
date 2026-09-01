import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import db from './db.js';
import { uploadsRoot, tempRoot, ensureDir } from './paths.js';
import { getDriveMirrorEvidenceStorage } from './sync.js';
import { portableEvidenceKey, reconcileEvidenceMirrorIndex, writeEvidenceMetadata, writeEvidenceTombstone } from './evidenceMirrorIndex.js';

const defaultEvidenceUploadsFolder = path.join(uploadsRoot, 'evaluacion-evidencias');
const tempEvidenceUploadsFolder = path.join(tempRoot, 'evidence-uploads');
ensureDir(defaultEvidenceUploadsFolder);
ensureDir(tempEvidenceUploadsFolder);

const cleanupStaleEvidenceUploads = () => {
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  try {
    fs.readdirSync(tempEvidenceUploadsFolder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.upload'))
      .forEach((entry) => {
        const target = path.join(tempEvidenceUploadsFolder, entry.name);
        try {
          if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { force: true });
        } catch {}
      });
  } catch {}
};

cleanupStaleEvidenceUploads();

export const getConfiguredEvidenceStoragePath = () => {
  try {
    const row = db.prepare('SELECT evidence_storage_path FROM datos_generales ORDER BY id DESC LIMIT 1').get();
    return String(row?.evidence_storage_path || '').trim();
  } catch {
    return '';
  }
};

export const getEvidenceStorageContext = () => {
  const configuredPath = getConfiguredEvidenceStoragePath();
  let mirror = { enabled: false, mirrorPath: '', evidencePath: '' };
  try {
    mirror = getDriveMirrorEvidenceStorage() || mirror;
  } catch {}

  const effectivePath = mirror.enabled
    ? path.resolve(mirror.evidencePath)
    : configuredPath
      ? path.resolve(configuredPath)
      : defaultEvidenceUploadsFolder;

  return {
    automaticMirror: mirror.enabled,
    mirrorPath: mirror.mirrorPath,
    configuredPath,
    effectivePath,
    legacyConfiguredPath: configuredPath && path.resolve(configuredPath) !== effectivePath
      ? path.resolve(configuredPath)
      : '',
  };
};

export const getEvidenceStorageRoot = () => getEvidenceStorageContext().effectivePath;

const cleanSlug = (value) => String(value || 'sin-dato')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-dato';

const isImageMimeOrExt = (mimeType = '', ext = '') => {
  const cleanMime = String(mimeType || '').toLowerCase();
  const cleanExt = String(ext || '').toLowerCase().replace(/^\./, '');
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tiff', 'svg']);
  return cleanMime.startsWith('image/') || imageExts.has(cleanExt);
};

export const optimizeMediaBuffer = async (buffer, originalName, mimeType = '') => {
  const ext = path.extname(originalName).toLowerCase();
  if (!isImageMimeOrExt(mimeType, ext)) {
    return {
      buffer,
      fileName: originalName,
      mimeType: mimeType || 'application/octet-stream',
      optimized: false,
    };
  }

  // Si es SVG o GIF animado, conservarlo tal cual
  if (ext === '.svg' || ext === '.gif' || mimeType.includes('svg') || mimeType.includes('gif')) {
    return {
      buffer,
      fileName: originalName,
      mimeType: mimeType || (ext === '.svg' ? 'image/svg+xml' : 'image/gif'),
      optimized: false,
    };
  }

  try {
    const optimizedBuffer = await sharp(buffer)
      .rotate() // auto-rotar segun EXIF (fotos de celulares)
      .resize({
        width: 1920,
        height: 1920,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    const baseName = path.basename(originalName, ext);
    const newFileName = `${baseName}.webp`;

    return {
      buffer: optimizedBuffer,
      fileName: newFileName,
      mimeType: 'image/webp',
      optimized: true,
    };
  } catch (error) {
    console.warn(`[compresion-webp] No se pudo convertir ${originalName}, conservando original:`, error.message);
    return {
      buffer,
      fileName: originalName,
      mimeType: mimeType || 'application/octet-stream',
      optimized: false,
    };
  }
};

export const saveEvidenceFile = async ({
  fileBuffer,
  fileName,
  year,
  areaId,
  grade,
  section,
  unitNumber,
  sessionNumber,
  mimeType = '',
}) => {
  if (!fileBuffer || !fileBuffer.length) {
    throw new Error('El archivo de evidencia está vacío.');
  }

  const { buffer: finalBuffer, fileName: finalFileName, mimeType: finalMime } = await optimizeMediaBuffer(
    fileBuffer,
    fileName || 'evidencia',
    mimeType
  );

  const ext = path.extname(finalFileName) || '';
  const relativeFolder = path.join(
    cleanSlug(year), cleanSlug(areaId), cleanSlug(grade), cleanSlug(section),
    `U${cleanSlug(unitNumber)}`, `S${cleanSlug(sessionNumber)}`
  );
  const finalUniqueName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${cleanSlug(path.basename(finalFileName, ext))}${ext}`;
  const relativePath = path.join(relativeFolder, finalUniqueName);

  const root = getEvidenceStorageRoot();
  ensureDir(root);
  const absolutePath = path.resolve(root, relativePath);
  const check = path.relative(root, absolutePath);
  if (check.startsWith('..') || path.isAbsolute(check)) {
    throw new Error('Ruta de evidencia no válida.');
  }

  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, finalBuffer);

  return {
    absolutePath,
    relativePath,
    detectedMime: finalMime,
    size: finalBuffer.length,
    fileName: finalFileName,
  };
};

export const saveEvidenceTempFile = async ({
  tempFilePath,
  fileName,
  year,
  areaId,
  grade,
  section,
  unitNumber,
  sessionNumber,
  mimeType = '',
}) => {
  const sourcePath = String(tempFilePath || '').trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('El archivo temporal de evidencia no existe.');

  const originalName = path.basename(fileName || 'evidencia');
  const originalExt = path.extname(originalName).toLowerCase();
  const originalSize = Number((await fs.promises.stat(sourcePath)).size || 0);
  if (!originalSize) throw new Error('El archivo de evidencia está vacío.');

  const relativeFolder = path.join(
    cleanSlug(year), cleanSlug(areaId), cleanSlug(grade), cleanSlug(section),
    `U${cleanSlug(unitNumber)}`, `S${cleanSlug(sessionNumber)}`
  );
  const root = getEvidenceStorageRoot();
  ensureDir(root);

  const createTarget = (targetName) => {
    const ext = path.extname(targetName);
    const uniqueName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${cleanSlug(path.basename(targetName, ext))}${ext}`;
    const relativePath = path.join(relativeFolder, uniqueName);
    const absolutePath = path.resolve(root, relativePath);
    const check = path.relative(root, absolutePath);
    if (check.startsWith('..') || path.isAbsolute(check)) throw new Error('Ruta de evidencia no válida.');
    ensureDir(path.dirname(absolutePath));
    return { relativePath, absolutePath, partialPath: `${absolutePath}.${process.pid}.${crypto.randomUUID()}.partial` };
  };

  const canOptimize = isImageMimeOrExt(mimeType, originalExt)
    && originalExt !== '.svg'
    && originalExt !== '.gif'
    && !String(mimeType).includes('svg')
    && !String(mimeType).includes('gif');
  let target = null;

  try {
    if (canOptimize) {
      const webpName = `${path.basename(originalName, originalExt)}.webp`;
      target = createTarget(webpName);
      try {
        await sharp(sourcePath)
          .rotate()
          .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 3 })
          .toFile(target.partialPath);
        const optimizedSize = Number((await fs.promises.stat(target.partialPath)).size || 0);
        if (optimizedSize > 0 && optimizedSize < originalSize) {
          await fs.promises.rename(target.partialPath, target.absolutePath);
          return {
            absolutePath: target.absolutePath,
            relativePath: target.relativePath,
            detectedMime: 'image/webp',
            size: optimizedSize,
            fileName: webpName,
          };
        }
        await fs.promises.rm(target.partialPath, { force: true });
      } catch (error) {
        try { await fs.promises.rm(target.partialPath, { force: true }); } catch {}
        console.warn(`[compresion-webp] No se pudo convertir ${originalName}, conservando original:`, error.message);
      }
    }

    target = createTarget(originalName);
    await fs.promises.copyFile(sourcePath, target.partialPath);
    await fs.promises.rename(target.partialPath, target.absolutePath);
    return {
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      detectedMime: mimeType || 'application/octet-stream',
      size: originalSize,
      fileName: originalName,
    };
  } finally {
    if (target?.partialPath) {
      try { await fs.promises.rm(target.partialPath, { force: true }); } catch {}
    }
    try { await fs.promises.rm(sourcePath, { force: true }); } catch {}
  }
};

export const saveEvidenceDataUrl = async ({
  dataUrl,
  fileName,
  year,
  areaId,
  grade,
  section,
  unitNumber,
  sessionNumber,
}) => {
  const match = String(dataUrl || '').match(/^data:(.*?);base64,(.*)$/s);
  if (!match) throw new Error('Archivo inválido o formato Base64 corrupto.');
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return saveEvidenceFile({
    fileBuffer: buffer,
    fileName,
    year,
    areaId,
    grade,
    section,
    unitNumber,
    sessionNumber,
    mimeType,
  });
};

export const evidenceRelativePathFromRow = (row) => {
  const stored = String(row?.relative_path || '').trim();
  if (stored) return stored.replace(/[\\/]+/g, path.sep);
  const absolute = String(row?.file_path || '').trim();
  if (!absolute) return '';
  const marker = `${path.sep}evaluacion-evidencias${path.sep}`.toLowerCase();
  const normalized = path.resolve(absolute);
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length);
  const relativeToDefault = path.relative(defaultEvidenceUploadsFolder, normalized);
  return relativeToDefault && !relativeToDefault.startsWith('..') && !path.isAbsolute(relativeToDefault)
    ? relativeToDefault
    : '';
};

export const resolveEvidenceCandidate = (root, relative) => {
  if (!root || !relative) return '';
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relative);
  const check = path.relative(resolvedRoot, candidate);
  if (check.startsWith('..') || path.isAbsolute(check)) return '';
  return fs.existsSync(candidate) ? candidate : '';
};

export const evidenceFileMatchesRecord = (row, candidate) => {
  if (!candidate) return false;
  try {
    const stats = fs.statSync(candidate);
    if (!stats.isFile()) return false;
    const expectedSize = Number(row?.file_size || 0);
    return expectedSize <= 0 || Number(stats.size) === expectedSize;
  } catch {
    return false;
  }
};

export const resolveEvidenceFilePathDetailed = (row, storageContext = null) => {
  const relative = evidenceRelativePathFromRow(row);
  const context = storageContext && typeof storageContext === 'object' && storageContext.effectivePath
    ? storageContext
    : getEvidenceStorageContext();
  const canonicalPath = resolveEvidenceCandidate(context.effectivePath, relative);
  if (evidenceFileMatchesRecord(row, canonicalPath)) return { path: canonicalPath, source: context.automaticMirror ? 'drive-mirror' : 'configured' };

  const storedAbsolute = String(row?.file_path || '').trim();
  if (evidenceFileMatchesRecord(row, storedAbsolute)) return { path: storedAbsolute, source: 'legacy-absolute' };

  const configuredLegacy = resolveEvidenceCandidate(context.legacyConfiguredPath, relative);
  if (evidenceFileMatchesRecord(row, configuredLegacy)) return { path: configuredLegacy, source: 'legacy-configured' };

  const defaultLegacy = resolveEvidenceCandidate(defaultEvidenceUploadsFolder, relative);
  if (evidenceFileMatchesRecord(row, defaultLegacy)) return { path: defaultLegacy, source: 'legacy-default' };
  return { path: '', source: 'missing' };
};

export const resolveEvidenceFilePath = (row) => {
  return resolveEvidenceFilePathDetailed(row).path;
};

export const persistEvidencePortableMetadata = (row) => {
  try {
    const context = getEvidenceStorageContext();
    if (!context.automaticMirror || !row) return null;
    const relativePath = evidenceRelativePathFromRow(row);
    const evidenceKey = String(row.evidence_key || portableEvidenceKey(relativePath));
    if (!evidenceKey || !relativePath) return null;
    if (!row.evidence_key) {
      const existingOwner = db.prepare('SELECT id FROM evaluacion_evidencias WHERE evidence_key = ? LIMIT 1').get(evidenceKey);
      if (existingOwner && Number(existingOwner.id) !== Number(row.id)) return null;
      db.prepare('UPDATE evaluacion_evidencias SET evidence_key = ? WHERE id = ?').run(evidenceKey, row.id);
    }
    const resolved = resolveEvidenceFilePathDetailed({ ...row, evidence_key: evidenceKey, relative_path: relativePath });
    if (!resolved.path) return null;
    const student = String(row.student_id || '').trim()
      ? db.prepare('SELECT dni, grado, secc, estudiantes FROM db_estudiantes WHERE id = ?').get(String(row.student_id))
      : null;
    return writeEvidenceMetadata({
      root: context.effectivePath,
      row: {
        ...row,
        evidence_key: evidenceKey,
        relative_path: relativePath,
        file_path: '',
        student_dni: String(student?.dni || ''),
        grade: String(student?.grado || row.grade || ''),
        section: String(student?.secc || row.section || ''),
      },
      evidencePath: resolved.path,
    });
  } catch (error) {
    console.error(`[evidencias] La evidencia ${row?.id || ''} quedo guardada, pero su ficha portatil sigue pendiente: ${error.message}`);
    return null;
  }
};

let evidenceIndexReconciliationRunning = false;
export const reconcilePortableEvidenceIndex = () => {
  const context = getEvidenceStorageContext();
  if (!context.automaticMirror || evidenceIndexReconciliationRunning) return null;
  evidenceIndexReconciliationRunning = true;
  try {
    return reconcileEvidenceMirrorIndex({ db, root: context.effectivePath });
  } catch (error) {
    console.error(`[evidencias] No se pudo reconciliar el indice portatil: ${error.message}`);
    return null;
  } finally {
    evidenceIndexReconciliationRunning = false;
  }
};

export const mapEvidenceRow = (row, storageContext = null) => {
  const resolved = resolveEvidenceFilePathDetailed(
    row,
    storageContext && typeof storageContext === 'object' && storageContext.effectivePath
      ? storageContext
      : null
  );
  return {
    id: row.id,
    year: row.year || '',
    areaId: row.area_id || '',
    grade: row.grade || '',
    section: row.section || '',
    bimester: row.bimester || '',
    unitNumber: row.unit_number || '',
    sessionNumber: row.session_number || '',
    sessionId: row.session_id || '',
    studentId: row.student_id || '',
    criteriaId: row.criteria_id || '',
    observation: row.observation || '',
    studentIds: JSON.parse(row.student_ids || '[]'),
    studentNames: JSON.parse(row.student_names || '[]'),
    fileName: row.file_name || path.basename(row.file_path || ''),
    fileSize: Number(row.file_size || 0),
    fileType: row.file_type || '',
    filePath: resolved.path,
    fileUrl: `/api/evaluacion/evidencias/${row.id}/file`,
    source: row.source || 'teacher',
    versionGroupId: row.version_group_id || `legacy-${row.id}`,
    versionNumber: Number(row.version_number || 1),
    isLatest: Number(row.is_latest ?? 1) === 1,
    submittedAt: row.submitted_at || row.updated_at,
    submissionIp: row.submission_ip || '',
    submissionUserAgent: row.submission_user_agent || '',
    available: !!resolved.path,
    availabilitySource: resolved.source,
    portable: resolved.source === 'drive-mirror' || resolved.source === 'configured',
    updatedAt: row.updated_at,
  };
};

export const requireLocalTeacherRequest = (req, res, next) => {
  const remote = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (remote === '127.0.0.1' || remote === '::1' || remote === 'localhost') return next();
  return res.status(403).json({ success: false, message: 'Esta operación solo puede realizarse desde el equipo docente.' });
};

export const hashEvidenceFile = (targetPath) => {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(targetPath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
};

export const copyEvidenceToMirrorSafely = (sourcePath, destinationPath) => {
  ensureDir(path.dirname(destinationPath));
  const tempPath = `${destinationPath}.${process.pid}.${crypto.randomUUID()}.partial`;
  try {
    fs.copyFileSync(sourcePath, tempPath);
    const sourceSize = Number(fs.statSync(sourcePath).size);
    const copiedSize = Number(fs.statSync(tempPath).size);
    if (sourceSize !== copiedSize || hashEvidenceFile(sourcePath) !== hashEvidenceFile(tempPath)) {
      throw new Error('La copia no superó la verificación de integridad.');
    }
    if (fs.existsSync(destinationPath)) {
      if (Number(fs.statSync(destinationPath).size) === sourceSize
        && hashEvidenceFile(destinationPath) === hashEvidenceFile(sourcePath)) {
        fs.unlinkSync(tempPath);
        return destinationPath;
      }
      throw new Error('Ya existe otro archivo distinto con la misma ruta en Drive.');
    }
    fs.renameSync(tempPath, destinationPath);
    return destinationPath;
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    ensureDir(tempEvidenceUploadsFolder);
    callback(null, tempEvidenceUploadsFolder);
  },
  filename: (_req, _file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}.upload`),
});
const evidenceUploader = multer({
  storage,
  limits: {
    fileSize: 40 * 1024 * 1024, // 40 MB max
    files: 1,
  },
});

export const uploadEvidenceMiddleware = (req, res, next) => {
  evidenceUploader.single('file')(req, res, (error) => {
    if (error) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        message: tooLarge ? 'El archivo supera el límite de 40 MB.' : `No se pudo recibir el archivo: ${error.message}`,
      });
    }
    if (req.file?.path) {
      const tempPath = req.file.path;
      res.once('finish', () => {
        try { fs.rmSync(tempPath, { force: true }); } catch {}
      });
    }
    return next();
  });
};
