import { DEFAULT_LAYOUT_STYLE, clampCount, intersectsLayout, layoutCellId, mkId, normalizeLayout } from './common';
import { InstrumentLayout, LayoutStyle, ScaleBodyRow } from './types';

export const SCALE_DEFAULT_LABELS = ['Deficiente', 'Regular', 'Bueno', 'Muy bueno'];
export const SCALE_LEVEL_COLORS = ['#ef1c24', '#f77b28', '#28a745', '#19b8cf'];
export const SCALE_ACHIEVEMENT_CODES = ['C', 'B', 'A', 'AD'];

const normalizeLegacyCriteria = (criteria: any[], capacitiesPerCompetency: number, criteriaPerCapacity: number) => {
  const safeCriteria = Array.isArray(criteria) ? criteria : [];
  const totalCapacities = Math.max(1, Math.ceil(Math.max(safeCriteria.length, 1) / Math.max(criteriaPerCapacity, 1)));
  const competencies = [{
    id: mkId(),
    name: 'Competencia 1',
    capacities: Array.from({ length: totalCapacities }, (_, capIdx) => ({
      id: mkId(),
      name: `Capacidad ${capIdx + 1}`,
      criteria: Array.from({ length: criteriaPerCapacity }, (_, critIdx) => {
        const flatIndex = capIdx * criteriaPerCapacity + critIdx;
        return {
          id: safeCriteria[flatIndex]?.id || mkId(),
          name: safeCriteria[flatIndex]?.name || `Criterio ${critIdx + 1}`,
          indicator: safeCriteria[flatIndex]?.indicator || ''
        };
      })
    }))
  }];

  return competencies;
};

export const getScaleLabels = (structure: any) => {
  const labels = Array.isArray(structure?.scale?.labels) ? structure.scale.labels.filter(Boolean) : [];
  return labels.length ? labels : SCALE_DEFAULT_LABELS;
};

export const normalizeScaleCompetencies = (structure: any) => {
  const scale = structure?.scale || {};
  const competenciesCount = clampCount(scale.competenciesCount ?? structure?.competenciesCount ?? structure?.competencies?.length, 1, 1, 10);
  const capacitiesPerCompetency = clampCount(scale.capacitiesPerCompetency ?? structure?.capacitiesPerCompetency, 2, 1, 10);
  const criteriaPerCapacity = clampCount(scale.criteriaPerCapacity ?? structure?.criteriaPerCapacity, 2, 1, 10);
  const rawCompetencies = Array.isArray(structure?.competencies) && structure.competencies.length
    ? structure.competencies
    : normalizeLegacyCriteria(structure?.criteria || [], capacitiesPerCompetency, criteriaPerCapacity);

  const competencies = Array.from({ length: competenciesCount }, (_, compIdx) => {
    const currentComp = rawCompetencies[compIdx] || {};
    return {
      id: currentComp.id || mkId(),
      name: currentComp.name || `Competencia ${compIdx + 1}`,
      capacities: Array.from({ length: capacitiesPerCompetency }, (_, capIdx) => {
        const currentCap = currentComp?.capacities?.[capIdx] || {};
        return {
          id: currentCap.id || mkId(),
          name: currentCap.name || `Capacidad ${capIdx + 1}`,
          criteria: Array.from({ length: criteriaPerCapacity }, (_, critIdx) => {
            const currentCrit = currentCap?.criteria?.[critIdx] || {};
            return {
              id: currentCrit.id || mkId(),
              name: currentCrit.name || `Criterio ${critIdx + 1}`,
              indicator: currentCrit.indicator || ''
            };
          })
        };
      })
    };
  });

  return {
    competenciesCount,
    capacitiesPerCompetency,
    criteriaPerCapacity,
    competencies
  };
};

export const flattenScaleCriteria = (structure: any) => {
  const { competencies } = normalizeScaleCompetencies(structure);
  return competencies.flatMap((comp: any) =>
    (comp.capacities || []).flatMap((cap: any) => (cap.criteria || []).map((criterion: any) => ({
      ...criterion,
      competencyName: comp.name,
      capacityName: cap.name
    })))
  );
};

export const buildScaleBodyRows = (structure: any): ScaleBodyRow[] => {
  const { competencies } = normalizeScaleCompetencies(structure);
  const rows: ScaleBodyRow[] = [];

  competencies.forEach((competency: any, competencyIndex: number) => {
    rows.push({
      kind: 'comp',
      comp: competencyIndex + 1,
      cap: 0,
      text: competency.name,
      competencyIndex
    });
    (competency.capacities || []).forEach((capacity: any, capacityIndex: number) => {
      rows.push({
        kind: 'cap',
        comp: competencyIndex + 1,
        cap: capacityIndex + 1,
        text: capacity.name,
        competencyIndex,
        capacityIndex
      });
      (capacity.criteria || []).forEach((criterion: any, criterionIndex: number) => {
        rows.push({
          kind: 'crit',
          comp: competencyIndex + 1,
          cap: capacityIndex + 1,
          text: criterion.name,
          competencyIndex,
          capacityIndex,
          criterionIndex
        });
      });
    });
  });

  return rows;
};

const getScaleLevelBaseStyle = (idx: number): Pick<LayoutStyle, 'bg' | 'color'> => ({
  bg: SCALE_LEVEL_COLORS[idx] || '#0f172a',
  color: '#ffffff'
});

export const ensureScaleLayout = (layout: InstrumentLayout, structure: any) => {
  const labels = getScaleLabels(structure);
  const bodyRows = buildScaleBodyRows(structure);
  const nextLayout = normalizeLayout({
    ...layout,
    cols: Math.max(layout.cols, labels.length + 2),
    rows: Math.max(layout.rows, bodyRows.length + 2)
  });
  const baseStyles = { ...(nextLayout.styles || {}) };

  const merges = [
    { sr: 0, sc: 0, er: 1, ec: 0 },
    { sr: 0, sc: 1, er: 1, ec: 1 },
    { sr: 0, sc: 2, er: 0, ec: labels.length + 1 }
  ];

  for (let c = 0; c <= labels.length + 1; c += 1) {
    const topId = layoutCellId(0, c);
    const topCurrent = baseStyles[topId] || DEFAULT_LAYOUT_STYLE;
    baseStyles[topId] = {
      ...topCurrent,
      bg: topCurrent.bg === '#ffffff' ? '#0f172a' : topCurrent.bg,
      color: topCurrent.color === '#0f172a' ? '#ffffff' : topCurrent.color,
      bold: true,
      align: 'center',
      vAlign: 'middle',
      borderColor: '#bfc8d4'
    };

    const bottomId = layoutCellId(1, c);
    const bottomCurrent = baseStyles[bottomId] || DEFAULT_LAYOUT_STYLE;
    const levelStyle = c >= 2 ? getScaleLevelBaseStyle(c - 2) : { bg: '#0f172a', color: '#ffffff' };
    baseStyles[bottomId] = {
      ...bottomCurrent,
      bg: bottomCurrent.bg === '#ffffff' ? levelStyle.bg : bottomCurrent.bg,
      color: bottomCurrent.color === '#0f172a' ? levelStyle.color : bottomCurrent.color,
      bold: true,
      align: 'center',
      vAlign: 'middle',
      borderColor: '#bfc8d4'
    };
  }

  bodyRows.forEach((row, idx) => {
    const r = idx + 2;
    if (row.kind === 'comp' || row.kind === 'cap') merges.push({ sr: r, sc: 0, er: r, ec: labels.length + 1 });

    for (let c = 0; c <= labels.length + 1; c += 1) {
      const id = layoutCellId(r, c);
      const current = baseStyles[id] || DEFAULT_LAYOUT_STYLE;
      const isGroupRow = row.kind === 'comp' || row.kind === 'cap';
      baseStyles[id] = {
        ...current,
        bg: current.bg === '#ffffff'
          ? row.kind === 'comp'
            ? '#e2e8f0'
            : row.kind === 'cap'
              ? '#f8fafc'
              : '#ffffff'
          : current.bg,
        color: current.color === '#0f172a'
          ? isGroupRow
            ? '#0f172a'
            : '#334155'
          : current.color,
        bold: isGroupRow ? true : current.bold,
        align: isGroupRow ? 'left' : (c === 0 ? 'center' : (c === 1 ? 'left' : 'center')),
        vAlign: 'middle',
        borderColor: '#bfc8d4'
      };
    }
  });

  return {
    ...nextLayout,
    styles: baseStyles,
    merges: [
      ...(nextLayout.merges || []).filter((m) => !merges.some((target) => intersectsLayout(m, target))),
      ...merges
    ]
  };
};

export const getScaleShape = (structure: any) => {
  const labels = getScaleLabels(structure);
  const bodyRows = buildScaleBodyRows(structure);
  return {
    rows: Math.max(bodyRows.length + 2, 4),
    cols: labels.length + 2
  };
};

export const getScaleLevelForColumn = (structure: any, col: number) => getScaleLabels(structure)[col - 2] || '';

export const getScaleLevelHeaderColor = (layout: InstrumentLayout, structure: any, col: number) => {
  const id = layoutCellId(1, col);
  const style = layout.styles?.[id];
  return style?.bg && style.bg !== '#ffffff'
    ? style.bg
    : (SCALE_LEVEL_COLORS[col - 2] || '#0f172a');
};

export const getScaleFallbackText = (structure: any, r: number, c: number) => {
  const labels = getScaleLabels(structure);
  const bodyRows = buildScaleBodyRows(structure);
  const row = bodyRows[r - 2];

  if (r === 0 && c === 0) return 'N°';
  if (r === 0 && c === 1) return 'Criterios';
  if (r === 0 && c === 2) return 'Niveles de logro';
  if (r === 1 && c >= 2) return labels[c - 2] || '';
  if (r >= 2 && row?.kind === 'comp' && c === 0) return row.text;
  if (r >= 2 && row?.kind === 'cap' && c === 0) return row.text;
  if (r >= 2 && row?.kind === 'crit' && c === 0) {
    const criteriaBefore = bodyRows
      .slice(0, r - 2)
      .filter((it) => it.kind === 'crit' && it.comp === row.comp && it.cap === row.cap).length;
    return String(criteriaBefore + 1);
  }
  if (r >= 2 && row?.kind === 'crit' && c === 1) return row.text;
  return '';
};

export const getScaleCompetencySummaries = (structure: any, texts: Record<string, string>, layout?: InstrumentLayout) => {
  const labels = getScaleLabels(structure);
  const bodyRows = buildScaleBodyRows(structure);
  const { competencies } = normalizeScaleCompetencies(structure);
  const maxScorePerCriterion = labels.length;

  return competencies.map((competency: any, competencyIndex: number) => {
    const criterionRows = bodyRows
      .map((row, idx) => ({ row, layoutRow: idx + 2 }))
      .filter(({ row }) => row.kind === 'crit' && row.competencyIndex === competencyIndex);

    let filled = 0;
    let total = 0;
    let sum = 0;
    criterionRows.forEach(({ layoutRow }) => {
      total += 1;
      const selectedLabel = labels.find((label, idx) => texts[layoutCellId(layoutRow, idx + 2)] === label);
      if (selectedLabel) {
        filled += 1;
        sum += labels.indexOf(selectedLabel) + 1;
      }
    });

    const complete = total > 0 && filled === total;
    const averageIndex = complete ? Math.max(0, Math.min(labels.length - 1, Math.round((sum / total) - 1))) : -1;
    const provisionalIndex = filled > 0 ? Math.max(0, Math.min(labels.length - 1, Math.round((sum / filled) - 1))) : -1;
    const label = complete ? (SCALE_ACHIEVEMENT_CODES[averageIndex] || '') : '◌';
    const pct = total > 0 ? Math.round((sum / Math.max(total * maxScorePerCriterion, 1)) * 100) : 0;
    const color = complete
      ? (layout ? getScaleLevelHeaderColor(layout, structure, averageIndex + 2) : (SCALE_LEVEL_COLORS[averageIndex] || '#94a3b8'))
      : '#e2e8f0';
    const barColor = provisionalIndex >= 0
      ? (layout ? getScaleLevelHeaderColor(layout, structure, provisionalIndex + 2) : (SCALE_LEVEL_COLORS[provisionalIndex] || '#94a3b8'))
      : '#cbd5e1';
    const labelColor = complete
      ? (layout ? getScaleLevelHeaderColor(layout, structure, averageIndex + 2) : (SCALE_LEVEL_COLORS[averageIndex] || '#0f172a'))
      : '#64748b';

    return {
      competencyIndex,
      competencyName: competency.name || `Competencia ${competencyIndex + 1}`,
      complete,
      filled,
      total,
      label,
      pct,
      color
      ,
      barColor,
      labelColor
    };
  });
};

export const getScaleCompetencySummariesDetailed = (structure: any, texts: Record<string, string>, layout?: InstrumentLayout) => {
  const labels = getScaleLabels(structure);
  const bodyRows = buildScaleBodyRows(structure);
  const { competencies } = normalizeScaleCompetencies(structure);
  const maxScorePerCriterion = labels.length;

  const summarizeRows = (criterionRows: Array<{ row: any; layoutRow: number }>) => {
    let filled = 0;
    let total = 0;
    let sum = 0;
    criterionRows.forEach(({ layoutRow }) => {
      total += 1;
      const selectedLabel = labels.find((label, idx) => texts[layoutCellId(layoutRow, idx + 2)] === label);
      if (selectedLabel) {
        filled += 1;
        sum += labels.indexOf(selectedLabel) + 1;
      }
    });

    const complete = total > 0 && filled === total;
    const averageIndex = complete ? Math.max(0, Math.min(labels.length - 1, Math.round((sum / total) - 1))) : -1;
    const provisionalIndex = filled > 0 ? Math.max(0, Math.min(labels.length - 1, Math.round((sum / filled) - 1))) : -1;
    const label = complete ? (SCALE_ACHIEVEMENT_CODES[averageIndex] || '') : '◌';
    const pct = total > 0 ? Math.round((sum / Math.max(total * maxScorePerCriterion, 1)) * 100) : 0;
    const color = complete
      ? (layout ? getScaleLevelHeaderColor(layout, structure, averageIndex + 2) : (SCALE_LEVEL_COLORS[averageIndex] || '#94a3b8'))
      : '#e2e8f0';
    const barColor = provisionalIndex >= 0
      ? (layout ? getScaleLevelHeaderColor(layout, structure, provisionalIndex + 2) : (SCALE_LEVEL_COLORS[provisionalIndex] || '#94a3b8'))
      : '#cbd5e1';
    const labelColor = complete
      ? (layout ? getScaleLevelHeaderColor(layout, structure, averageIndex + 2) : (SCALE_LEVEL_COLORS[averageIndex] || '#0f172a'))
      : '#64748b';

    return { complete, filled, total, label, pct, color, barColor, labelColor };
  };

  return competencies.map((competency: any, competencyIndex: number) => {
    const competencyRows = bodyRows
      .map((row, idx) => ({ row, layoutRow: idx + 2 }))
      .filter(({ row }) => row.kind === 'crit' && row.competencyIndex === competencyIndex);
    const capacities = (competency.capacities || []).map((capacity: any, capacityIndex: number) => {
      const capacityRows = bodyRows
        .map((row, idx) => ({ row, layoutRow: idx + 2 }))
        .filter(({ row }) => row.kind === 'crit' && row.competencyIndex === competencyIndex && row.capacityIndex === capacityIndex);
      return {
        capacityIndex,
        capacityName: capacity.name || `Capacidad ${capacityIndex + 1}`,
        ...summarizeRows(capacityRows)
      };
    });

    return {
      competencyIndex,
      competencyName: competency.name || `Competencia ${competencyIndex + 1}`,
      capacities,
      ...summarizeRows(competencyRows)
    };
  });
};

export const normalizeScaleStructure = (s: any, layout: InstrumentLayout) => {
  const min = Number(s?.scale?.min || 1);
  const max = Number(s?.scale?.max || 5);
  const labels = getScaleLabels(s);
  const { competenciesCount, capacitiesPerCompetency, criteriaPerCapacity, competencies } = normalizeScaleCompetencies(s);
  return {
    scale: { min, max, labels, competenciesCount, capacitiesPerCompetency, criteriaPerCapacity },
    competencies,
    criteria: flattenScaleCriteria({ ...s, competencies }),
    criteriaCount: competenciesCount * capacitiesPerCompetency * criteriaPerCapacity,
    layout: ensureScaleLayout(layout, { ...s, scale: { min, max, labels, competenciesCount, capacitiesPerCompetency, criteriaPerCapacity }, competencies })
  };
};
