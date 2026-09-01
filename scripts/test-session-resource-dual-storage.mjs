import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createSessionResourceVariants, ensureSessionResourceVariantLinks } from '../backend/sessionResourceStorage.js';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-session-resource-dual-'));

try {
  const sourcePath = path.resolve('artifacts', 'u5-image-optimization', 'word', '2026-1774917929135-5to-A_y_B-U5-S2-instructive.jpg');
  assert.equal(fs.existsSync(sourcePath), true, 'Falta la imagen documental de prueba de Unidad 5.');
  const sourceBuffer = fs.readFileSync(sourcePath);
  const result = await createSessionResourceVariants({
    sourceBuffer,
    baseTarget: path.join(temporaryRoot, 'resource'),
    versioned: false,
  });

  assert.equal(fs.existsSync(result.webpPath), true);
  assert.equal(fs.existsSync(result.wordPath), true);
  const [webp, word] = await Promise.all([
    sharp(fs.readFileSync(result.webpPath)).metadata(),
    sharp(fs.readFileSync(result.wordPath)).metadata(),
  ]);
  assert.equal(webp.format, 'webp');
  assert.equal(word.format, 'jpeg');
  assert.equal(webp.width, word.width);
  assert.equal(webp.height, word.height);
  assert.ok(result.webpBytes < result.originalBytes);
  assert.ok(result.wordBytes < result.originalBytes);

  const recoveryUploadsRoot = path.join(temporaryRoot, 'recovery', 'uploads');
  const recoveryResourceRoot = path.join(recoveryUploadsRoot, 'session-resources');
  fs.mkdirSync(recoveryResourceRoot, { recursive: true });
  const recoverySessionId = '2026-area-5to-A-U5-S1';
  const recoverySource = path.join(recoveryResourceRoot, `${recoverySessionId}-instructive.png`);
  fs.copyFileSync(sourcePath, recoverySource);
  const recovered = await ensureSessionResourceVariantLinks({
    uploadsRoot: recoveryUploadsRoot,
    sessionId: recoverySessionId,
    sessionData: {
      learningResources: {
        instructive: {
          imageUrl: `/uploads/session-resources/${recoverySessionId}-instructive-dual-deadbeef0000.webp`,
          wordImageUrl: '',
        },
      },
    },
  });
  assert.equal(recovered.changed, true);
  assert.equal(recovered.repaired, 1);
  assert.match(recovered.sessionData.learningResources.instructive.imageUrl, /\.webp\?v=/);
  assert.match(recovered.sessionData.learningResources.instructive.wordImageUrl, /\.word\.jpg\?v=/);
  const recoveredWebp = path.resolve(
    recoveryUploadsRoot,
    recovered.sessionData.learningResources.instructive.imageUrl.split(/[?#]/)[0].replace(/^\/uploads\//, ''),
  );
  const recoveredWord = path.resolve(
    recoveryUploadsRoot,
    recovered.sessionData.learningResources.instructive.wordImageUrl.split(/[?#]/)[0].replace(/^\/uploads\//, ''),
  );
  assert.equal(fs.existsSync(recoveredWebp), true);
  assert.equal(fs.existsSync(recoveredWord), true);
  console.log(`OK: WebP ${result.webpBytes} bytes + Word JPEG ${result.wordBytes} bytes; original ${result.originalBytes} bytes.`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
}
