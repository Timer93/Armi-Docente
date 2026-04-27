import { ChecklistVisualRow, InstrumentLayout, LayoutStyle } from './types';
import { DEFAULT_LAYOUT_STYLE, clampCount, hasCustomLayoutStyle, intersectsLayout, layoutCellId, mkId, normalizeLayout, normalizeLoose } from './common';

export const CHECKLIST_OPTION_PRESETS = [
  { value: 'si_no', label: 'Si/No', positive: 'Si', negative: 'No' },
  { value: 'cumple_no_cumple', label: 'Cumple/No cumple', positive: 'Cumple', negative: 'No cumple' },
  { value: 'logrado_no_logrado', label: 'Logrado/No logrado', positive: 'Logrado', negative: 'No logrado' },
  { value: 'custom', label: 'Personalizado', positive: 'Opcion 1', negative: 'Opcion 2' }
];
export const CHECKLIST_LEVEL_COLORS = {
  C: '#ef1c24',
  B: '#f77b28',
  A: '#28a745',
  AD: '#19b8cf',
  pending: '#64748b'
} as const;

export const normalizeChecklistOptionValue = (value: any) => {
  if (value && typeof value === 'object' && String(value.mode || '').trim().toLowerCase() === 'custom') return 'custom';
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'si_no';
  const match = CHECKLIST_OPTION_PRESETS.find((preset) =>
    preset.value === raw
    || preset.label.toLowerCase() === raw
    || `${preset.positive}/${preset.negative}`.toLowerCase() === raw
    || `${preset.positive} / ${preset.negative}`.toLowerCase() === raw
  );
  return match?.value || 'si_no';
};

export const getChecklistOptionPreset = (value: any) =>
  CHECKLIST_OPTION_PRESETS.find((preset) => preset.value === normalizeChecklistOptionValue(value))
  || CHECKLIST_OPTION_PRESETS[0];

export const getChecklistOptionConfig = (value: any) => {
  if (value && typeof value === 'object' && String(value.mode || '').trim().toLowerCase() === 'custom') {
    return {
      value: 'custom',
      label: 'Personalizado',
      positive: String(value.positive || 'Opcion 1').trim() || 'Opcion 1',
      negative: String(value.negative || 'Opcion 2').trim() || 'Opcion 2'
    };
  }
  return getChecklistOptionPreset(value);
};

const distributeChecklistCriteria = (criteria: any[], bucketCount: number) => {
  const safeBucketCount = Math.max(1, bucketCount || 1);
  const buckets = Array.from({ length: safeBucketCount }, () => [] as any[]);
  let offset = 0;
  for (let idx = 0; idx < safeBucketCount; idx += 1) {
    const remainingCriteria = criteria.length - offset;
    const remainingBuckets = safeBucketCount - idx;
    const take = remainingCriteria > 0 ? Math.max(1, Math.ceil(remainingCriteria / Math.max(remainingBuckets, 1))) : 0;
    buckets[idx] = criteria.slice(offset, offset + take);
    offset += take;
  }
  return buckets;
};

export const buildChecklistHierarchy = (structure: any) => {
  const competencies = Array.isArray(structure?.competencies) ? structure.competencies : [];
  if (competencies.length > 0) {
    return competencies.map((competency: any, compIdx: number) => ({
      id: competency?.id || mkId(),
      title: competency?.name || `COMPETENCIA ${compIdx + 1}`,
      capacities: (Array.isArray(competency?.capacities) ? competency.capacities : []).map((capacity: any, capIdx: number) => ({
        id: capacity?.id || mkId(),
        title: capacity?.name || `CAPACIDAD ${capIdx + 1}`,
        criterios: (Array.isArray(capacity?.criteria) ? capacity.criteria : []).map((criterion: any, critIdx: number) => ({
          id: criterion?.id || mkId(),
          name: criterion?.name || `Criterio ${critIdx + 1}`
        }))
      }))
    }));
  }

  const items = Array.isArray(structure?.items) ? structure.items : [];
  const capacityCount = clampCount(structure?.capacitiesPerCompetency, 2, 1, 10);
  const grouped = distributeChecklistCriteria(items, capacityCount);
  return [{
    id: mkId(),
    title: 'COMPETENCIA 1',
    capacities: Array.from({ length: capacityCount }, (_, idx) => ({
      id: mkId(),
      title: `CAPACIDAD ${idx + 1}`,
      criterios: (grouped[idx] || []).map((item: any, critIdx: number) => ({
        id: item?.id || mkId(),
        name: item?.name || `Criterio ${critIdx + 1}`
      }))
    }))
  }];
};

export const buildChecklistCapacities = (structure: any) => {
  const competencies = buildChecklistHierarchy(structure);
  return competencies.flatMap((competency: any, compIdx: number) =>
    (competency.capacities || []).map((capacity: any, idx: number) => ({
      id: `${compIdx + 1}-${idx + 1}`,
      title: capacity.title || `CAPACIDAD ${idx + 1}`,
      competencia: competency.title || '',
      criterios: (capacity.criterios || []).map((it: any) => it.name)
    }))
  );
};

export const buildChecklistVisualRows = (structure: any): ChecklistVisualRow[] => {
  const hierarchy = buildChecklistHierarchy(structure);
  const rows: ChecklistVisualRow[] = [];
  let itemIndex = 0;

  hierarchy.forEach((competency: any, compIdx: number) => {
    rows.push({
      kind: 'comp',
      comp: compIdx + 1,
      cap: 0,
      text: competency.title || `COMPETENCIA ${compIdx + 1}`,
      competencyIndex: compIdx
    });

    (competency.capacities || []).forEach((capacity: any, capIdx: number) => {
      rows.push({
        kind: 'cap',
        comp: compIdx + 1,
        cap: capIdx + 1,
        text: capacity.title || `CAPACIDAD ${capIdx + 1}`,
        competencyIndex: compIdx,
        capacityIndex: capIdx
      });

      const criterios = Array.isArray(capacity?.criterios) ? capacity.criterios : [];
      if (criterios.length === 0) {
        rows.push({
          kind: 'crit',
          comp: compIdx + 1,
          cap: capIdx + 1,
          text: '',
          competencyIndex: compIdx,
          capacityIndex: capIdx,
          criterionIndex: 0,
          itemIndex
        });
        itemIndex += 1;
        return;
      }

      criterios.forEach((criterion: any, criterionIdx: number) => {
        rows.push({
          kind: 'crit',
          comp: compIdx + 1,
          cap: capIdx + 1,
          text: criterion?.name || '',
          competencyIndex: compIdx,
          capacityIndex: capIdx,
          criterionIndex: criterionIdx,
          itemIndex
        });
        itemIndex += 1;
      });
    });
  });

  return rows;
};

export const ensureChecklistLayout = (layout: InstrumentLayout, structure: any): InstrumentLayout => {
  const rows = buildChecklistVisualRows(structure);
  const nextLayout = normalizeLayout({
    ...layout,
    rows: Math.max(rows.length + 1, 2),
    cols: 5
  });
  const styles = { ...(nextLayout.styles || {}) };

  for (let c = 0; c < 5; c += 1) {
    const id = layoutCellId(0, c);
    styles[id] = {
      ...(styles[id] || DEFAULT_LAYOUT_STYLE),
      bg: styles[id]?.bg && styles[id].bg !== DEFAULT_LAYOUT_STYLE.bg ? styles[id].bg : '#059669',
      color: styles[id]?.color && styles[id].color !== DEFAULT_LAYOUT_STYLE.color ? styles[id].color : '#ffffff',
      bold: true,
      align: styles[id]?.align && styles[id].align !== DEFAULT_LAYOUT_STYLE.align
        ? styles[id].align
        : (c === 1 || c === 4 ? 'left' : 'center'),
      vAlign: 'middle',
      borderColor: styles[id]?.borderColor && styles[id].borderColor !== DEFAULT_LAYOUT_STYLE.borderColor ? styles[id].borderColor : '#047857'
    };
  }

  const autoMerges: Array<{ sr: number; sc: number; er: number; ec: number }> = [];
  rows.forEach((row, idx) => {
    const r = idx + 1;
    if (row.kind !== 'crit') autoMerges.push({ sr: r, sc: 0, er: r, ec: 4 });
    for (let c = 0; c < 5; c += 1) {
      const id = layoutCellId(r, c);
      const current = styles[id] || DEFAULT_LAYOUT_STYLE;
      const defaultAlign = row.kind === 'crit'
        ? (c === 1 || c === 4 ? 'left' : 'center')
        : 'left';
      styles[id] = {
        ...current,
        bg: current.bg === DEFAULT_LAYOUT_STYLE.bg
          ? (row.kind === 'comp' ? '#d1fae5' : row.kind === 'cap' ? '#ecfdf5' : '#ffffff')
          : current.bg,
        color: current.color === DEFAULT_LAYOUT_STYLE.color
          ? (row.kind === 'comp' ? '#065f46' : row.kind === 'cap' ? '#065f46' : '#0f172a')
          : current.color,
        bold: row.kind !== 'crit' ? true : current.bold,
        align: current.align === DEFAULT_LAYOUT_STYLE.align ? defaultAlign : current.align,
        vAlign: current.vAlign === DEFAULT_LAYOUT_STYLE.vAlign ? 'middle' : current.vAlign,
        borderColor: current.borderColor === DEFAULT_LAYOUT_STYLE.borderColor ? '#cbd5e1' : current.borderColor
      };
    }
  });

  return normalizeLayout({
    ...nextLayout,
    styles,
    merges: [
      ...(nextLayout.merges || []).filter((merge) => autoMerges.every((autoMerge) => !intersectsLayout(autoMerge, merge))),
      ...autoMerges
    ]
  });
};

export const getChecklistShape = (structure: any) => {
  const rows = buildChecklistVisualRows(structure);
  return {
    rows: Math.max(rows.length + 1, 2),
    cols: 5
  };
};

export const getChecklistFallbackText = (structure: any, r: number, c: number) => {
  const rows = buildChecklistVisualRows(structure);
  const row = rows[r - 1];
  if (r === 0 && c === 0) return 'N°';
  if (r === 0 && c === 1) return 'CRITERIOS OBSERVABLES';
  if (r === 0 && c === 2) return 'SÍ';
  if (r === 0 && c === 3) return 'NO';
  if (r === 0 && c === 4) return 'OBSERVACIONES';
  if (!row) return '';
  if (row.kind === 'comp' && c === 0) return row.text;
  if (row.kind === 'cap' && c === 0) return row.text;
  if (row.kind === 'crit' && c === 0) return String(rows.slice(0, r - 1).filter((entry) => entry.kind === 'crit').length + 1);
  if (row.kind === 'crit' && c === 1) return row.text || `Criterio ${rows.slice(0, r).filter((entry) => entry.kind === 'crit').length}`;
  if (row.kind === 'crit' && c === 4) return '-';
  return '';
};

export const getChecklistRowStyle = (layout: InstrumentLayout, row: number) => {
  const rowStyles = Array.from({ length: 5 }, (_, c) => layout.styles?.[layoutCellId(row, c)] || DEFAULT_LAYOUT_STYLE);
  return rowStyles.find(hasCustomLayoutStyle) || DEFAULT_LAYOUT_STYLE;
};

export const getChecklistCapacityStyleMap = (layout: InstrumentLayout, rows: ChecklistVisualRow[]) => {
  const map = new Map<string, LayoutStyle>();
  rows.forEach((row, idx) => {
    if (row.kind !== 'cap') return;
    map.set(`${row.comp}-${row.cap}`, getChecklistRowStyle(layout, idx + 1));
  });
  return map;
};

export const normalizeChecklistStructure = (s: any, layout: InstrumentLayout, expectedLabel: string) => {
  const legacyItems = Array.isArray(s?.items) ? s.items : [];
  const rawCompetencies = Array.isArray(s?.competencies) ? s.competencies : [];
  const competenciesCount = clampCount(s.competenciesCount ?? rawCompetencies.length, 1, 1, 10);
  const capacitiesPerCompetency = clampCount(
    s.capacitiesPerCompetency ?? rawCompetencies[0]?.capacities?.length ?? 2,
    2,
    1,
    10
  );
  const criteriaPerCapacity = clampCount(
    s.criteriaPerCapacity
      ?? rawCompetencies[0]?.capacities?.[0]?.criteria?.length
      ?? Math.max(1, Math.ceil(Math.max(legacyItems.length, 1) / Math.max(competenciesCount * capacitiesPerCompetency, 1))),
    3,
    1,
    20
  );

  const legacyCriteria = legacyItems.map((item: any, idx: number) => ({
    id: item?.id || mkId(),
    name: item?.name || `Criterio ${idx + 1}`,
    competencia: item?.competencia || '',
    capacidad: item?.capacidad || item?.cap || ''
  }));

  const normalizedCompetencies = rawCompetencies.length > 0
    ? Array.from({ length: competenciesCount }, (_, compIdx) => {
        const sourceCompetency = rawCompetencies[compIdx] || {};
        const sourceCapacities = Array.isArray(sourceCompetency?.capacities) ? sourceCompetency.capacities : [];
        return {
          id: sourceCompetency?.id || mkId(),
          name: sourceCompetency?.name || `COMPETENCIA ${compIdx + 1}`,
          capacities: Array.from({ length: capacitiesPerCompetency }, (_, capIdx) => {
            const sourceCapacity = sourceCapacities[capIdx] || {};
            const sourceCriteria = Array.isArray(sourceCapacity?.criteria) ? sourceCapacity.criteria : [];
            return {
              id: sourceCapacity?.id || mkId(),
              name: sourceCapacity?.name || `CAPACIDAD ${capIdx + 1}`,
              criteria: Array.from({ length: criteriaPerCapacity }, (_, critIdx) => ({
                id: sourceCriteria[critIdx]?.id || mkId(),
                name: sourceCriteria[critIdx]?.name || `Criterio ${critIdx + 1}`
              }))
            };
          })
        };
      })
    : Array.from({ length: competenciesCount }, (_, compIdx) => {
        const groupedCriteria = distributeChecklistCriteria(
          legacyCriteria.filter((item) => {
            if (item.competencia) return normalizeLoose(item.competencia) === normalizeLoose(`COMPETENCIA ${compIdx + 1}`);
            return true;
          }),
          capacitiesPerCompetency
        );
        return {
          id: mkId(),
          name: `COMPETENCIA ${compIdx + 1}`,
          capacities: Array.from({ length: capacitiesPerCompetency }, (_, capIdx) => ({
            id: mkId(),
            name: `CAPACIDAD ${capIdx + 1}`,
            criteria: Array.from({ length: criteriaPerCapacity }, (_, critIdx) => ({
              id: groupedCriteria[capIdx]?.[critIdx]?.id || mkId(),
              name: groupedCriteria[capIdx]?.[critIdx]?.name || `Criterio ${critIdx + 1}`
            }))
          }))
        };
      });

  const items = normalizedCompetencies.flatMap((competency: any) =>
    (competency.capacities || []).flatMap((capacity: any) =>
      (capacity.criteria || []).map((criterion: any) => ({
        id: criterion.id || mkId(),
        name: criterion.name || 'Criterio',
        competencia: competency.name || '',
        capacidad: capacity.name || '',
        expected: expectedLabel,
        weight: 1
      }))
    )
  );

  return {
    competencies: normalizedCompetencies,
    competenciesCount,
    capacitiesPerCompetency,
    criteriaPerCapacity,
    items,
    itemsCount: items.length,
    expectedLabel,
    layout: ensureChecklistLayout(layout, {
      ...s,
      competencies: normalizedCompetencies,
      capacitiesPerCompetency
    })
  };
};

export const checklistLevelFromPct = (pct: number) => {
  if (pct >= 90) return 'AD';
  if (pct >= 70) return 'A';
  if (pct >= 50) return 'B';
  return 'C';
};

export const checklistBlocks = (pct: number) => {
  const filled = Math.max(0, Math.min(5, Math.round((pct / 100) * 5)));
  return `${'█'.repeat(filled)}${'░'.repeat(5 - filled)}`;
};
