// Shared by the lesson loader and the backend. A lesson owns its activities,
// resources and grading data; the unit owns the planning assigned to its slot.
export const UNIT_TRANSVERSAL_NAMES = [
  'Se desenvuelve en los entornos virtuales generados por las TIC',
  'Gestiona su aprendizaje de manera autónoma',
];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const normalize = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const lines = (value) => String(value || '').split(/\r?\n/).map((line) => line.replace(/^\s*[•·*\-]\s*/, '').trim()).filter(Boolean);
const escape = (text) => String(text || '').replace(/[&<>"']/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[letter]));
const html = (items) => items.map((item) => `<p>${escape(typeof item === 'string' ? item : item.text)}</p>`).join('') || '<p></p>';
const plainItems = (value) => lines(String(value || '').replace(/<br\s*\/?>|<\/(p|li|div)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));
const transIndex = (item) => {
  const capacity = normalize(item?.capacidad || item?.capacity);
  const name = normalize(item?.competencia || item?.sourceCriteriaId);
  if (capacity.includes('definemetas') || capacity.includes('organizaacciones') || capacity.includes('monitoreayajusta') || name.includes('gestionasuaprendizaje')) return 1;
  if (capacity.includes('entornosvirtuales') || capacity.includes('objetosvirtuales') || capacity.includes('informaciondelentorno') || name.includes('sedesenvuelve')) return 0;
  const color = String(item?.color || '').toLowerCase();
  return color.includes('00b28c') ? 1 : 0;
};
const isTrans = (item) => {
  const source = String(item?.sourceCriteriaId || item?.sourceEvidenceId || '');
  if (source.startsWith('trans-')) return true;
  if (source.startsWith('area-')) return false;
  const color = String(item?.color || '').toLowerCase();
  return !!color && !['text-black', 'black', '#000', '#000000', 'text-[#000000]'].includes(color);
};
export const isUnitSessionTransversalItem = isTrans;

export const findUnitPlannedSession = (unit, sessionNumber) => {
  const sessions = Array.isArray(unit?.sesiones) ? unit.sesiones : [];
  const number = Number(sessionNumber);
  return sessions.find((session) => Number(session?.sessionNumber ?? session?.id) === number)
    || (sessions.every((session) => session?.id == null && session?.sessionNumber == null) ? sessions[number - 1] : null);
};

export const resolveSelectedUnitSessionItems = (unit, session, kind) => {
  const criteria = kind === 'criteria', key = criteria ? 'criteriaItems' : 'evidenceItems';
  let items = Array.isArray(session?.[key]) ? session[key].map((item) => typeof item === 'string' ? { text: item } : { ...item }) : null;
  const selected = criteria ? session?.selectedCriteriaIds : session?.selectedEvidenceIds;
  const manual = criteria ? session?.criteriaSelectionTouched : session?.evidenceDistributionMode === 'manual';
  const referenceKey = criteria ? 'sourceCriteriaId' : 'sourceEvidenceId';
  if (manual && Array.isArray(selected)) {
    if (!items) items = [];
    const catalog = criteria ? session.availableCriteriaOptions : session.availableEvidenceOptions;
    const byId = new Map(items.filter((item) => item[referenceKey]).map((item) => [item[referenceKey], item]));
    for (const option of catalog || []) if (!byId.has(option.id)) byId.set(option.id, { ...option, [referenceKey]: option.id, sourceCriteriaId: criteria ? option.id : option.criterionGroupId });
    items = [...selected.map((id) => byId.get(id)).filter(Boolean), ...items.filter((item) => !item[referenceKey])];
  }
  if (!items) {
    const direct = lines(criteria ? session?.des : session?.evi);
    if (direct.length) return direct.map((text) => ({ text, color: 'text-black' }));
    // Recover matrix data only for old units with no distributed items. An
    // explicitly empty selection must never resurrect removed evidence.
    const sourceCriteria = Array.isArray(session?.criteriaItems) ? session.criteriaItems : [];
    items = sourceCriteria.flatMap((item) => {
      const match = String(item.sourceCriteriaId || '').match(/-(\d+)$/);
      const source = isTrans(item) ? unit?.evidenciasTrans : unit?.evidencias;
      return match ? lines(source?.[match[1]]).map((text) => ({ ...item, text })) : [];
    });
  }
  return items.flatMap((item) => {
    const sourceId = String(item[referenceKey] || '');
    const match = criteria ? sourceId.match(/^(area|trans)-.*-(\d+)$/) : sourceId.match(/^(area|trans)-(\d+)-(\d+)$/);
    const field = criteria ? (isTrans(item) ? 'criteriosTrans' : 'criterios') : (isTrans(item) ? 'evidenciasTrans' : 'evidencias');
    if (match && own(unit?.[field], match[2])) {
      const text = criteria ? String(unit[field][match[2]] || '').trim() : lines(unit[field][match[2]])[Number(match[3])] || '';
      return text ? [{ ...item, text }] : [];
    }
    return String(item.text || '').trim() ? [item] : [];
  });
};

export const buildUnitSessionPlanning = (unit, sessionNumber) => {
  const session = findUnitPlannedSession(unit, sessionNumber);
  if (!session) return null;
  const criteria = resolveSelectedUnitSessionItems(unit, session, 'criteria');
  const evidences = resolveSelectedUnitSessionItems(unit, session, 'evidence');
  const capacities = Array.isArray(session.capacidades) ? session.capacidades : [];
  const transCapacity = (capacity) => {
    const text = normalize(capacity);
    if (['personalizaentornos', 'gestionainformacion', 'interactuaenentornos', 'creaobjetosvirtuales'].some((prefix) => text.startsWith(prefix))) return 0;
    if (['definemetas', 'organizaacciones', 'monitoreayajusta'].some((prefix) => text.startsWith(prefix))) return 1;
    return -1;
  };
  const transversals = UNIT_TRANSVERSAL_NAMES.flatMap((name, index) => {
    const active = Array.isArray(session.transversales) ? session.transversales.some((entry) => normalize(entry) === normalize(name)) : [...criteria, ...evidences].some((item) => isTrans(item) && transIndex(item) === index);
    if (!active) return [];
    const rowCriteria = criteria.filter((item) => isTrans(item) && transIndex(item) === index);
    const rowEvidence = evidences.filter((item) => isTrans(item) && transIndex(item) === index);
    const matrixIndex = String(rowCriteria[0]?.sourceCriteriaId || '').match(/-(\d+)$/)?.[1];
    const inst = matrixIndex != null && own(unit?.instrumentosTrans, matrixIndex) ? unit.instrumentosTrans[matrixIndex] : session.eval || '';
    return [{ comp: name, cap: capacities.filter((capacity) => transCapacity(capacity) === index).join('\n'), des: html(rowCriteria), evidence: html(rowEvidence), field: '', inst: String(inst || ''), rowColor: index === 0 ? '#007c59' : '#00b28c' }];
  });
  const areaCriteria = criteria.filter((item) => !isTrans(item));
  return {
    title: String(session.title || ''),
    competenciaPrio: {
      comp: String(session.competencia || ''), cap: capacities.filter((capacity) => transCapacity(capacity) < 0).join('\n') || String(session.cap || ''),
      des: html(areaCriteria), evidence: html(evidences.filter((item) => !isTrans(item))), field: String(session.con || ''), inst: String(session.eval || ''),
    },
    competenciasTrans: transversals,
  };
};

export const mergeUnitSessionPlanning = (saved, unit, sessionNumber, previousUnit = null) => {
  const planning = buildUnitSessionPlanning(unit, sessionNumber);
  if (!planning) return saved;
  const previous = saved?.unitPlanningSnapshot || (previousUnit ? buildUnitSessionPlanning(previousUnit, sessionNumber) : null);
  const next = { ...saved, competenciaPrio: { ...saved?.competenciaPrio }, competenciasTrans: (saved?.competenciasTrans || []).map((row) => ({ ...row })) };
  const changed = (before, after) => !previous || JSON.stringify(before) !== JSON.stringify(after);
  // The first link has no history proving that a blank is a deliberate
  // deletion. Adopt the unit baseline without erasing authored lesson data.
  // Once linked, a real non-empty -> empty unit change still propagates.
  const hasText = (value) => plainItems(value).length > 0;
  const shouldCopy = (current, before, value) => changed(before, value)
    && (hasText(before) || hasText(value) || !hasText(current));
  if (shouldCopy(saved?.title, previous?.title, planning.title)) next.title = planning.title;
  for (const [field, value] of Object.entries(planning.competenciaPrio)) if (shouldCopy(next.competenciaPrio[field], previous?.competenciaPrio?.[field], value)) next.competenciaPrio[field] = value;
  const byName = (rows, name) => (rows || []).find((row) => normalize(row.comp) === normalize(name));
  next.competenciasTrans = planning.competenciasTrans.map((target) => {
    const row = byName(saved?.competenciasTrans, target.comp) || {};
    const before = byName(previous?.competenciasTrans, target.comp);
    // A newly added group also lacks a baseline for its individual fields.
    return { ...row, ...Object.fromEntries(Object.entries(target).filter(([field, value]) =>
      shouldCopy(row[field], before?.[field], value)
    )) };
  });
  for (const row of saved?.competenciasTrans || []) {
    if (!byName(planning.competenciasTrans, row.comp) && !byName(previous?.competenciasTrans, row.comp)) next.competenciasTrans.push({ ...row });
  }
  next.unitPlanningSnapshot = planning;
  // Keep existing IDs/descriptors and all external grades. Refresh the wording
  // read by evaluation and the student portal, without regenerating rubrics.
  if (next.assessmentModel && next.competenciaPrio.des !== saved?.competenciaPrio?.des) next.assessmentModel = { ...next.assessmentModel, criterios: plainItems(next.competenciaPrio.des).map((text, index) => ({ ...(saved.assessmentModel.criterios?.[index] || {}), id: String(saved.assessmentModel.criterios?.[index]?.id || index + 1), text })) };
  if (next.assessmentModel && next.competenciaPrio.comp !== saved?.competenciaPrio?.comp) next.assessmentModel = { ...next.assessmentModel, competencia: next.competenciaPrio.comp };
  if (next.assessmentModel && next.competenciaPrio.cap !== saved?.competenciaPrio?.cap) next.assessmentModel = { ...next.assessmentModel, capacidades: lines(next.competenciaPrio.cap) };
  const curriculumChanged = JSON.stringify([next.competenciaPrio, next.competenciasTrans]) !== JSON.stringify([saved?.competenciaPrio, saved?.competenciasTrans]);
  if (curriculumChanged && next.sessionAssessmentModel?.rows && next.rubricaRowMode !== 'capacity') {
    const currentRows = next.sessionAssessmentModel.rows;
    const groups = [{ target: next.competenciaPrio, source: 'primary', groupIndex: 0 }, ...next.competenciasTrans.map((target, groupIndex) => ({ target, source: 'transversal', groupIndex }))];
    const rows = groups.flatMap(({ target, source, groupIndex }) => {
      const peers = currentRows.filter((row) => row.source === source && (source !== 'transversal' || normalize(row.competencyName) === normalize(target.comp)));
      return plainItems(target.des).map((criterionText, index) => {
        const previousRow = peers[index] || {};
        return { ...previousRow, id: previousRow.id || (source === 'primary' ? `primary-${index + 1}` : `transversal-${groupIndex + 1}-${index + 1}`), source, competencyName: target.comp, capacityName: previousRow.capacityName || target.cap, criterionText, evidenceText: target.evidence, fieldText: target.field, performanceText: target.des, instrumentLabel: target.inst };
      });
    });
    next.sessionAssessmentModel = { ...next.sessionAssessmentModel, rows: rows.map((row, index) => ({ ...row, order: index + 1 })) };
  }
  return next;
};
