const splitEvidenceText = (value) => String(value || '')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((text) => text.replace(/^\s*[>\-•❖✓]+\s*/u, '').trim())
  .filter(Boolean);

const criterionIdsFromSession = (session) => Array.from(new Set([
  ...(Array.isArray(session?.selectedCriteriaIds) ? session.selectedCriteriaIds : []),
  ...(Array.isArray(session?.criteriaItems)
    ? session.criteriaItems.map((item) => item?.sourceCriteriaId)
    : []),
].map((value) => String(value || '').trim()).filter(Boolean)));

export const resolveUnitSessionEvidenceItems = (session, areaEvidence = {}, transversalEvidence = {}) => {
  const storedItems = (Array.isArray(session?.evidenceItems) ? session.evidenceItems : [])
    .map((item) => typeof item === 'string' ? { text: item, color: null } : item)
    .filter((item) => String(item?.text || '').trim());
  if (storedItems.length) return storedItems;

  const directText = splitEvidenceText(session?.evi || session?.evidencia_sesion || '');
  if (directText.length) return directText.map((text) => ({ text, color: 'text-black' }));

  const recovered = [];
  const seen = new Set();
  criterionIdsFromSession(session).forEach((criterionId) => {
    const indexMatch = criterionId.match(/-(\d+)$/);
    if (!indexMatch) return;
    const index = indexMatch[1];
    const isTransversal = criterionId.startsWith('trans-');
    const source = isTransversal ? transversalEvidence : areaEvidence;
    splitEvidenceText(source?.[index]).forEach((text) => {
      const key = text.toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      recovered.push({ text, color: isTransversal ? 'text-[#007c59]' : 'text-black' });
    });
  });
  return recovered;
};

