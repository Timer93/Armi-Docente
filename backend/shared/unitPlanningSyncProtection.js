const parseSessions = value => {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
};
const timestamp = value => {
  const text = String(value || '').trim();
  if (!text) return NaN;
  const iso = text.replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(iso) ? iso : `${iso}Z`);
};
const hasPlanning = (session, kind) => (kind === 'criteria' ? ['selectedCriteriaIds', 'criteriaItems'] : ['selectedEvidenceIds', 'evidenceItems'])
  .some(key => Array.isArray(session?.[key]) && session[key].length > 0)
  || Boolean(String(session?.[kind === 'criteria' ? 'des' : 'evi'] || '').trim());

// An offline PC can have a larger revision counter while holding an older,
// damaged unit. Republish the newer recovery rather than silently erasing it.
// Newer deliberate removals and tombstones retain the normal sync behavior.
export const wouldEraseNewerUnitPlanning = (operation, currentRow) => {
  if (operation?.table !== 'unidades_didacticas' || operation.action !== 'upsert' || !currentRow) return false;
  const currentTime = timestamp(currentRow.updated_at), incomingTime = timestamp(operation.row?.updated_at);
  if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime) || currentTime <= incomingTime) return false;
  const current = parseSessions(currentRow.sesiones), incoming = parseSessions(operation.row?.sesiones);
  if (!Array.isArray(current) || !Array.isArray(incoming)) return false;
  return current.some((session, index) => {
    const number = session?.sessionNumber ?? session?.id;
    const other = number == null ? incoming[index] : incoming.find(item => String(item?.sessionNumber ?? item?.id) === String(number));
    return ['criteria', 'evidence'].some(kind => hasPlanning(session, kind) && !hasPlanning(other, kind));
  });
};
