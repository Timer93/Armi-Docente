const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hasText = value => Boolean(String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim());
const find = (rows, name) => (rows || []).find(row => key(row.comp) === key(name));

// Recover only the identified first-link failure: the backup was unlinked,
// the current unit baseline is empty, and a previously authored field is now
// empty too. Never replace non-empty current edits or tracked unit deletions.
export const recoverLegacySessionPlanning = (saved, backup, currentPlanning) => {
  if (!saved?.unitPlanningSnapshot || backup?.unitPlanningSnapshot || !currentPlanning) return { data: saved, fields: [] };
  const data = structuredClone(saved);
  // Keep the reference immutable even if an in-memory caller shares objects
  // between its displayed rows and the unit snapshot.
  data.competenciasTrans = structuredClone(saved.competenciasTrans || []);
  const fields = [];
  for (const row of data.competenciasTrans || []) {
    const original = find(backup?.competenciasTrans, row.comp);
    const baseline = find(saved.unitPlanningSnapshot.competenciasTrans, row.comp);
    const unit = find(currentPlanning.competenciasTrans, row.comp);
    if (!original || !baseline || !unit) continue;
    const restored = [];
    for (const field of ['cap', 'des', 'evidence']) {
      if (hasText(row[field]) || !hasText(original[field]) || hasText(baseline[field]) || hasText(unit[field])) continue;
      row[field] = original[field];
      restored.push(field);
      fields.push({ competency: row.comp, field });
    }
    if (!restored.length || !Array.isArray(data.sessionAssessmentModel?.rows)) continue;
    const peers = (backup.sessionAssessmentModel?.rows || []).filter(item => item.source === 'transversal' && key(item.competencyName) === key(row.comp));
    for (const peer of peers) {
      const existing = data.sessionAssessmentModel.rows.find(item => String(item.id) === String(peer.id));
      if (existing && (existing.source !== 'transversal' || key(existing.competencyName) !== key(row.comp))) throw new Error(`ID de criterio incompatible: ${peer.id}`);
      if (!existing) {
        if (restored.includes('des')) data.sessionAssessmentModel.rows.push(structuredClone(peer));
        continue;
      }
      for (const [field, modelField] of [['cap', 'capacityName'], ['des', 'performanceText'], ['evidence', 'evidenceText']]) {
        if (restored.includes(field) && !hasText(existing[modelField]) && hasText(peer[modelField])) existing[modelField] = peer[modelField];
      }
      if (restored.includes('des') && !hasText(existing.criterionText)) existing.criterionText = peer.criterionText;
    }
  }
  return { data: fields.length ? data : saved, fields };
};
