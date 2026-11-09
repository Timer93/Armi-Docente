import crypto from 'node:crypto';

const normalize = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const plain = (value) => String(value || '').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&').trim();

export const readRequestedEvidence = (value) => {
  try {
    const item = typeof value === 'string' ? JSON.parse(value || 'null') : value;
    return item && typeof item === 'object' && typeof item.id === 'string' && typeof item.text === 'string' ? item : null;
  } catch { return null; }
};

export const getPortalRequestedEvidences = (data = {}) => {
  const groups = [{ row: data.competenciaPrio || {}, source: 'primary' },
    ...(Array.isArray(data.competenciasTrans) ? data.competenciasTrans : []).map(row => ({ row, source: 'transversal' }))];
  const seen = new Set();
  return groups.flatMap(({ row, source }, index) => {
    const competency = plain(row.comp);
    const fallbackColor = source === 'primary' ? '#334155' : normalize(competency).includes('gestiona su aprendizaje') ? '#00b28c' : '#007c59';
    const rawColor = String(row.rowColor || '');
    const color = /^#[a-f0-9]{6}$/i.test(rawColor) ? rawColor : fallbackColor;
    // Preserve actual paragraphs/lists. Commas and examples belong to the same product.
    const items = (Array.isArray(row.evidence) ? row.evidence : [row.evidence]).flatMap(value => String(value || '')
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, '\n')
      .replace(/<(?:p|div|li|h[1-6])\b[^>]*>/gi, '\n').split(/\r?\n|[•●▪]/))
      .map(value => plain(value).replace(/^(?:[-–—*]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
    return items.flatMap(text => {
      const key = JSON.stringify([source, normalize(competency) || index, normalize(text)]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ id: `requested-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`,
        text, source, competency, color, criteriaId: competency ? `summary::${source}::${normalize(competency)}` : '' }];
    });
  });
};

export const resolvePortalRequestedEvidence = (data, requestedId, previous = null) => {
  const prior = readRequestedEvidence(previous?.requested_evidence);
  if (previous) {
    if (requestedId && String(requestedId) !== prior?.id) {
      const error = new Error('La nueva versión debe conservar la evidencia solicitada de la entrega original.');
      error.statusCode = 400; throw error;
    }
    return prior;
  }
  if (!requestedId) return null; // Older clients and existing uncategorized deliveries remain supported.
  const item = getPortalRequestedEvidences(data).find(item => item.id === String(requestedId));
  if (!item) { const error = new Error('La evidencia solicitada cambió. Actualiza la sesión y vuelve a elegir dónde entregar el archivo.'); error.statusCode = 400; throw error; }
  return item;
};
