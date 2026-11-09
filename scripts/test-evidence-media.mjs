import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  EVIDENCE_EXTENSION_SET,
  canPreviewEvidence,
  evidencePreviewKind,
  mustUseSandboxedEvidencePreview,
  safeEvidenceLink,
} from '../backend/evidenceFormats.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-evidence-media-'));
process.env.ARMI_DATA_ROOT = root;
process.env.ARMI_KEEP_EVIDENCE_ORIGINALS = 'true';
let database = null;

try {
  for (const extension of ['html', 'txt', 'csv', 'json', 'zip', 'mp3', 'mp4', 'docx']) {
    assert.ok(EVIDENCE_EXTENSION_SET.has(extension), `Debe admitir .${extension}`);
  }
  assert.equal(evidencePreviewKind('actividad.html', 'text/html'), 'html');
  assert.equal(canPreviewEvidence('actividad.html', 'text/html'), true);
  assert.equal(mustUseSandboxedEvidencePreview('actividad.html', 'text/html'), true);
  assert.equal(canPreviewEvidence('trabajo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
  assert.equal(safeEvidenceLink('javascript:alert(1)'), '');
  assert.equal(safeEvidenceLink('https://example.edu/recurso'), 'https://example.edu/recurso');

  const input = path.join(root, 'video-grande.avi');
  const generated = spawnSync(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-t', '3', '-c:v', 'ffv1', input,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr || 'No se pudo crear el video de prueba.');

  const originalSize = fs.statSync(input).size;
  database = (await import('../backend/db.js')).default;
  database.prepare("UPDATE datos_generales SET evidence_storage_path = ?").run(path.join(root, 'evidencias'));
  const { saveEvidenceTempFile } = await import('../backend/evidenceStorage.js');
  const saved = await saveEvidenceTempFile({
    tempFilePath: input,
    fileName: 'demostracion.avi',
    year: '2026', areaId: 'EPT', grade: '5', section: 'A', unitNumber: '1', sessionNumber: '1',
    mimeType: 'video/x-msvideo',
  });
  assert.equal(saved.detectedMime, 'video/mp4');
  assert.equal(path.extname(saved.fileName), '.mp4');
  assert.ok(saved.size < originalSize, 'El MP4 optimizado debe ocupar menos que el video de entrada.');
  assert.ok(fs.existsSync(saved.absolutePath));
  assert.ok(saved.originalBackupPath && fs.existsSync(saved.originalBackupPath), 'Debe conservar el original cuando la opción está activa.');
  console.log(`Optimización de video: OK (${originalSize} -> ${saved.size} bytes)`);
  console.log('Formatos ampliados y clasificación de vista previa segura: OK');
} finally {
  try { database?.close(); } catch {}
  const resolved = path.resolve(root);
  const safeTemp = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${safeTemp}${path.sep}`) && path.basename(resolved).startsWith('armi-evidence-media-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
