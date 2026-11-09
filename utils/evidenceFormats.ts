export type EvidencePreviewKind = 'image' | 'svg' | 'video' | 'audio' | 'pdf' | 'html' | 'text' | 'doc' | 'sheet' | 'slides' | 'archive' | 'custom' | 'generic';

export const EVIDENCE_EXTENSIONS = [
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
] as const;

export const EVIDENCE_ACCEPT = EVIDENCE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
export const VALID_EVIDENCE_EXTENSIONS = new Set<string>(EVIDENCE_EXTENSIONS);

export const getEvidenceExtension = (fileName: string) => {
  const parts = String(fileName || '').split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

export const getEvidencePreviewKind = (fileName: string, mimeType = ''): EvidencePreviewKind => {
  const extension = getEvidenceExtension(fileName);
  const mime = String(mimeType || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(extension) || (mime.startsWith('image/') && extension !== 'svg')) return 'image';
  if (extension === 'svg' || mime === 'image/svg+xml') return 'svg';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(extension) || mime.startsWith('video/')) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(extension) || mime.startsWith('audio/')) return 'audio';
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['html', 'htm'].includes(extension) || mime === 'text/html') return 'html';
  if (['txt', 'md', 'csv', 'json', 'xml', 'py', 'js', 'ts', 'css', 'java', 'c', 'cpp', 'sql'].includes(extension) || mime.startsWith('text/')) return 'text';
  if (['doc', 'docx', 'odt', 'rtf'].includes(extension)) return 'doc';
  if (['xls', 'xlsx', 'ods'].includes(extension)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(extension)) return 'slides';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'archive';
  if (extension === 'armi') return 'custom';
  return 'generic';
};

export const canPreviewEvidence = (kind: EvidencePreviewKind) => (
  ['image', 'svg', 'video', 'audio', 'pdf', 'html', 'text'].includes(kind)
);
