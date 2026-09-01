import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(projectRoot, 'uploads', 'session-resources');
const outputRoot = path.join(projectRoot, 'artifacts', 'u5-image-optimization');
const webpDir = path.join(outputRoot, 'webp');
const wordDir = path.join(outputRoot, 'word');

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const percentSaved = (original, result) => ((1 - result / original) * 100).toFixed(1);

await fs.mkdir(webpDir, { recursive: true });
await fs.mkdir(wordDir, { recursive: true });

const sourceNames = (await fs.readdir(sourceDir))
  .filter((name) => /-U5-/i.test(name) && /\.png$/i.test(name))
  .sort((a, b) => a.localeCompare(b, 'es'));

if (!sourceNames.length) {
  throw new Error('No se encontraron PNG originales de recursos de la Unidad 5.');
}

const rows = [];
for (const sourceName of sourceNames) {
  const sourcePath = path.join(sourceDir, sourceName);
  const baseName = path.basename(sourceName, path.extname(sourceName));
  const webpPath = path.join(webpDir, `${baseName}.webp`);
  const wordPath = path.join(wordDir, `${baseName}.jpg`);

  const pipeline = sharp(sourcePath).rotate().resize({
    width: 1920,
    height: 1920,
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

  const [sourceStat, webpStat, wordStat, sourceMeta, webpMeta, wordMeta] = await Promise.all([
    fs.stat(sourcePath),
    fs.stat(webpPath),
    fs.stat(wordPath),
    sharp(sourcePath).metadata(),
    sharp(webpPath).metadata(),
    sharp(wordPath).metadata(),
  ]);

  if (sourceMeta.width !== webpMeta.width || sourceMeta.height !== webpMeta.height
    || sourceMeta.width !== wordMeta.width || sourceMeta.height !== wordMeta.height) {
    throw new Error(`Las dimensiones cambiaron inesperadamente para ${sourceName}.`);
  }

  rows.push({
    sourceName,
    width: sourceMeta.width,
    height: sourceMeta.height,
    originalBytes: sourceStat.size,
    webpBytes: webpStat.size,
    wordBytes: wordStat.size,
    combinedBytes: webpStat.size + wordStat.size,
  });
}

const totals = rows.reduce((sum, row) => ({
  originalBytes: sum.originalBytes + row.originalBytes,
  webpBytes: sum.webpBytes + row.webpBytes,
  wordBytes: sum.wordBytes + row.wordBytes,
  combinedBytes: sum.combinedBytes + row.combinedBytes,
}), { originalBytes: 0, webpBytes: 0, wordBytes: 0, combinedBytes: 0 });

const report = {
  generatedAt: new Date().toISOString(),
  sourceDirectory: path.relative(projectRoot, sourceDir),
  outputDirectory: path.relative(projectRoot, outputRoot),
  settings: {
    maxDimensions: '1920x1920 sin ampliar',
    webp: 'calidad 82, esfuerzo 4',
    wordJpeg: 'calidad 88, 4:4:4, mozjpeg, progresivo',
  },
  imageCount: rows.length,
  totals,
  savings: {
    webpPercent: Number(percentSaved(totals.originalBytes, totals.webpBytes)),
    wordPercent: Number(percentSaved(totals.originalBytes, totals.wordBytes)),
    combinedPercent: Number(percentSaved(totals.originalBytes, totals.combinedBytes)),
  },
  files: rows,
};

await fs.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Imágenes verificadas: ${rows.length}`);
console.log(`Originales PNG:       ${formatBytes(totals.originalBytes)}`);
console.log(`Versiones WebP:       ${formatBytes(totals.webpBytes)} (${percentSaved(totals.originalBytes, totals.webpBytes)}% menos)`);
console.log(`Versiones Word JPG:   ${formatBytes(totals.wordBytes)} (${percentSaved(totals.originalBytes, totals.wordBytes)}% menos)`);
console.log(`WebP + Word JPG:      ${formatBytes(totals.combinedBytes)} (${percentSaved(totals.originalBytes, totals.combinedBytes)}% menos)`);
console.log(`Informe: ${path.relative(projectRoot, path.join(outputRoot, 'report.json'))}`);
