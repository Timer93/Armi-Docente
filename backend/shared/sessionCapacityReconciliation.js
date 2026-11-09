// Planning owns curricular labels. Never change criterion IDs, text, grades or
// descriptors when repairing old instrument/assessment copies.
const key = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.\s]+/g, ' ').trim();
const capacities = (value) => [...new Set(String(value || '')
  .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|li)>/gi, '\n').replace(/<[^>]*>/g, '')
  .split(/[\n;,]|(?:\s+-\s+)|(?:\s+[•·]\s+)|(?:\r?\n\s*\d+[.)]\s*)/)
  .map(value => value.trim()).filter(Boolean))];
const resolve = (value, names) => names.find(name => key(name) === key(value)) || (names.length === 1 ? names[0] : value);

export const reconcileSessionCapacities = (data) => {
  if (!data || typeof data !== 'object') return data;
  const primary = data.competenciaPrio;
  const primaryNames = capacities(primary?.cap);
  const trans = Array.isArray(data.competenciasTrans) ? data.competenciasTrans : [];
  const groupFor = (row) => {
    // Older instruments sometimes omit source/competency. Recover them only
    // through a unique stored criterion ID, never by table position.
    if (!row.source && !row.competencyName && !row.competencia && !row.comp && row.id != null) {
      const peers = (data.sessionAssessmentModel?.rows || []).filter(peer => String(peer.id) === String(row.id));
      if (peers.length === 1) row = peers[0];
    }
    const name = row.competencyName || row.competencia || row.comp;
    if (row.source === 'transversal') return trans.find(group => key(group.comp) === key(name));
    if (row.source === 'primary') return primary;
    const matches = [primary, ...trans].filter(group => group?.comp && key(group.comp) === key(name));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const repairRow = (row, field) => {
    const group = groupFor(row);
    const names = capacities(group?.cap);
    if (!names.length) return row;
    const value = resolve(row[field] || row.cap, names);
    if (!value || value === row[field]) return row;
    const textField = field === 'capacityName' ? 'criterionText' : 'criterio';
    const capacityLabel = row.rowType === 'capacity' && key(row[textField]) === key(row[field] || row.cap);
    return { ...row, [field]: value, ...(capacityLabel ? { [textField]: value } : {}) };
  };
  const next = { ...data };
  if (data.assessmentModel && primaryNames.length) {
    next.assessmentModel = {
      ...data.assessmentModel,
      capacidades: primaryNames,
      ...(Array.isArray(data.assessmentModel.criterios) ? { criterios: data.assessmentModel.criterios.map(row => {
        if (!row.capacidad && !row.capacity) return row;
        const field = row.capacidad ? 'capacidad' : 'capacity';
        return { ...row, [field]: resolve(row[field], primaryNames) };
      }) } : {})
    };
  }
  if (Array.isArray(data.sessionAssessmentModel?.rows)) next.sessionAssessmentModel = {
    ...data.sessionAssessmentModel,
    rows: data.sessionAssessmentModel.rows.map(row => repairRow(row, 'capacityName'))
  };
  if (Array.isArray(data.instrumento)) next.instrumento = data.instrumento.map(row => repairRow(row, 'capacidad'));
  return next;
};
