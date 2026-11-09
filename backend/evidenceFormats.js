import path from 'path';

// Draw.io exports store their diagram inline and load the official renderer.
// No application origin, arbitrary external scripts, or network API access is granted.
export const HTML_EVIDENCE_PREVIEW_POLICY = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' data: blob: https://app.diagrams.net/js/viewer-static.min.js https://viewer.diagrams.net/js/viewer-static.min.js; img-src data: blob: https://app.diagrams.net https://viewer.diagrams.net; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

export const EVIDENCE_EXTENSIONS = Object.freeze([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v',
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac',
  'pdf', 'doc', 'docx', 'odt', 'rtf',
  'xls', 'xlsx', 'ods', 'csv',
  'ppt', 'pptx', 'odp',
  'html', 'htm', 'txt', 'md', 'json', 'xml',
  'zip', 'rar', '7z', 'tar', 'gz',
  'py', 'js', 'ts', 'css', 'java', 'c', 'cpp', 'sql',
  'armi',
]);

export const EVIDENCE_EXTENSION_SET = new Set(EVIDENCE_EXTENSIONS);
export const EVIDENCE_ACCEPT = EVIDENCE_EXTENSIONS.map((extension) => `.${extension}`).join(',');

const RASTER_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'xml', 'py', 'js', 'ts', 'css', 'java', 'c', 'cpp', 'sql']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

export const evidenceExtension = (fileName = '') => path.extname(String(fileName)).slice(1).toLowerCase();

export const evidencePreviewKind = (fileName = '', mimeType = '') => {
  const extension = evidenceExtension(fileName);
  const mime = String(mimeType || '').toLowerCase();
  if (RASTER_IMAGE_EXTENSIONS.has(extension) || (mime.startsWith('image/') && extension !== 'svg')) return 'image';
  if (extension === 'svg' || mime === 'image/svg+xml') return 'svg';
  if (VIDEO_EXTENSIONS.has(extension) || mime.startsWith('video/')) return 'video';
  if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith('audio/')) return 'audio';
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (HTML_EXTENSIONS.has(extension) || mime === 'text/html') return 'html';
  if (TEXT_EXTENSIONS.has(extension) || mime.startsWith('text/')) return 'text';
  if (['doc', 'docx', 'odt', 'rtf'].includes(extension)) return 'doc';
  if (['xls', 'xlsx', 'ods'].includes(extension)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(extension)) return 'slides';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'archive';
  if (extension === 'armi') return 'custom';
  return 'generic';
};

export const canPreviewEvidence = (fileName = '', mimeType = '') => (
  ['image', 'svg', 'video', 'audio', 'pdf', 'html', 'text'].includes(evidencePreviewKind(fileName, mimeType))
);

export const mustUseSandboxedEvidencePreview = (fileName = '', mimeType = '') => (
  ['svg', 'html', 'text'].includes(evidencePreviewKind(fileName, mimeType))
);

export const safeEvidenceLink = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1000) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
};
