import { InstrumentLayout } from './types';
import { DEFAULT_LAYOUT_STYLE, clampCount, intersectsLayout, layoutCellId, mkId, normalizeLayout } from './common';

export const GUIDE_LEVELS = ['C', 'B', 'A', 'AD'];
export const GUIDE_LEVEL_COLORS = ['#ef1c24', '#f77b28', '#28a745', '#19b8cf'];
export const GUIDE_LEVEL_BORDER_COLORS = ['#b50f15', '#c55d16', '#1f7a35', '#127f8e'];

const GUIDE_HEADER_ROWS = 4;
const GUIDE_BODY_ROWS = 6;

export const getGuideCompetencies = (structure: any) => {
  const rawCompetencies = Array.isArray(structure?.competencies) ? structure.competencies : [];
  if (rawCompetencies.length > 0) return rawCompetencies;
  const legacyAspects = Array.isArray(structure?.aspects) ? structure.aspects : [];
  return [{
    id: mkId(),
    name: '',
    capacities: legacyAspects.map((aspect: any, idx: number) => ({
      id: aspect?.id || mkId(),
      name: aspect?.name || `CAPACIDAD ${idx + 1}`,
      criteria: [{ id: mkId(), name: `Criterio ${idx + 1}` }]
    }))
  }];
};

export const getFlatGuideCapacities = (structure: any) =>
  getGuideCompetencies(structure).flatMap((competency: any) => Array.isArray(competency?.capacities) ? competency.capacities : []);

export interface GuideCriterionBlock {
  flatIndex: number;
  code: string;
  competencyIndex: number;
  capacityIndex: number;
  criterionIndex: number;
  competencyLabel: string;
  capacityLabel: string;
  criterionLabel: string;
  startCol: number;
}

export interface GuideCapacityBlock {
  competencyIndex: number;
  capacityIndex: number;
  competencyLabel: string;
  capacityLabel: string;
  criteriaCount: number;
  startCol: number;
}

export const getGuideCriterionCode = (flatIndex: number) => `C${flatIndex + 1}`;
export const getGuideLevelForColumn = (col: number) => GUIDE_LEVELS[(col - 2) % GUIDE_LEVELS.length];
export const getGuideCriterionStartCol = (col: number) => col - ((col - 2) % GUIDE_LEVELS.length);
export const getGuideScoreForLevel = (level: string) => {
  const idx = GUIDE_LEVELS.indexOf(level as any);
  return idx >= 0 ? idx + 1 : 0;
};
export const getGuideRowAverageScore = (texts: Record<string, string>, row: number, totalCols: number) => {
  const scores: number[] = [];
  let expected = 0;
  for (let startCol = 2; startCol < totalCols - 1; startCol += GUIDE_LEVELS.length) {
    expected += 1;
    for (let offset = 0; offset < GUIDE_LEVELS.length; offset += 1) {
      const col = startCol + offset;
      const value = String(texts?.[layoutCellId(row, col)] || '').trim();
      if (value === GUIDE_LEVELS[offset]) {
        scores.push(offset + 1);
        break;
      }
    }
  }
  if (scores.length === 0) return { average: null, complete: false, filled: 0, expected };
  return {
    average: scores.reduce((acc, score) => acc + score, 0) / scores.length,
    complete: scores.length === expected,
    filled: scores.length,
    expected
  };
};
export const getGuideRowAverage = (texts: Record<string, string>, row: number, totalCols: number) => {
  const { average, complete } = getGuideRowAverageScore(texts, row, totalCols);
  if (average === null) return '';
  if (!complete) return '◌';
  const roundedIndex = Math.max(0, Math.min(GUIDE_LEVELS.length - 1, Math.round(average) - 1));
  return GUIDE_LEVELS[roundedIndex] || '';
};

const getGuideSummaryStats = (texts: Record<string, string>, slots: Array<{ row: number; startCol: number }>) => {
  let filled = 0;
  let total = 0;
  let sum = 0;
  slots.forEach(({ row, startCol }) => {
    total += 1;
    for (let offset = 0; offset < GUIDE_LEVELS.length; offset += 1) {
      const value = String(texts?.[layoutCellId(row, startCol + offset)] || '').trim();
      if (value === GUIDE_LEVELS[offset]) {
        filled += 1;
        sum += offset + 1;
        break;
      }
    }
  });
  const complete = total > 0 && filled === total;
  const pct = total > 0 ? Math.round((sum / Math.max(total * GUIDE_LEVELS.length, 1)) * 100) : 0;
  const provisionalIndex = filled > 0 ? Math.max(0, Math.min(GUIDE_LEVELS.length - 1, Math.round((sum / filled) - 1))) : -1;
  const averageIndex = complete ? provisionalIndex : -1;
  const label = complete ? (GUIDE_LEVELS[averageIndex] || '') : '◌';
  const labelColor = complete ? (GUIDE_LEVEL_COLORS[averageIndex] || '#64748b') : '#64748b';
  const barColor = provisionalIndex >= 0 ? (GUIDE_LEVEL_COLORS[provisionalIndex] || '#cbd5e1') : '#cbd5e1';
  return { filled, total, complete, pct, label, labelColor, barColor };
};

export const getGuideSummaries = (structure: any, texts: Record<string, string>) => {
  const shape = getGuideShape(structure);
  const capacityBlocks = getGuideCapacityBlocks(structure);
  const criterionBlocks = getGuideCriterionBlocks(structure);
  const studentRows = Array.from({ length: Math.max(shape.rows - GUIDE_HEADER_ROWS, 0) }, (_, idx) => GUIDE_HEADER_ROWS + idx);
  const capacities = capacityBlocks.map((block) => {
    const criteria = criterionBlocks.filter((criterion) => criterion.competencyIndex === block.competencyIndex && criterion.capacityIndex === block.capacityIndex);
    const slots = studentRows.flatMap((row) => criteria.map((criterion) => ({ row, startCol: criterion.startCol })));
    return {
      competencyIndex: block.competencyIndex,
      capacityIndex: block.capacityIndex,
      competencyLabel: block.competencyLabel,
      capacityLabel: block.capacityLabel,
      ...getGuideSummaryStats(texts, slots)
    };
  });
  const competencies = getGuideCompetencies(structure).map((competency: any, competencyIndex: number) => {
    const criteria = criterionBlocks.filter((criterion) => criterion.competencyIndex === competencyIndex);
    const slots = studentRows.flatMap((row) => criteria.map((criterion) => ({ row, startCol: criterion.startCol })));
    return {
      competencyIndex,
      competencyLabel: competency?.name || `Competencia ${competencyIndex + 1}`,
      capacities: capacities.filter((capacity) => capacity.competencyIndex === competencyIndex),
      ...getGuideSummaryStats(texts, slots)
    };
  });
  return { competencies, capacities };
};

export const getGuideCriterionBlocks = (structure: any): GuideCriterionBlock[] => {
  const competencies = getGuideCompetencies(structure);
  const blocks: GuideCriterionBlock[] = [];
  let startCol = 2;
  let flatIndex = 0;

  competencies.forEach((competency: any, compIdx: number) => {
    const capacities = Array.isArray(competency?.capacities) ? competency.capacities : [];
    capacities.forEach((capacity: any, capIdx: number) => {
      const criteria = Array.isArray(capacity?.criteria) && capacity.criteria.length > 0
        ? capacity.criteria
        : [{ id: mkId(), name: 'Criterio 1' }];
      criteria.forEach((criterion: any, critIdx: number) => {
        blocks.push({
          flatIndex,
          code: getGuideCriterionCode(flatIndex),
          competencyIndex: compIdx,
          capacityIndex: capIdx,
          criterionIndex: critIdx,
          competencyLabel: competency?.name || `Competencia ${compIdx + 1}`,
          capacityLabel: capacity?.name || `CAPACIDAD ${capIdx + 1}`,
          criterionLabel: criterion?.name || `Criterio ${critIdx + 1}`,
          startCol
        });
        flatIndex += 1;
        startCol += GUIDE_LEVELS.length;
      });
    });
  });

  return blocks;
};

export const getGuideCapacityBlocks = (structure: any): GuideCapacityBlock[] => {
  const competencies = getGuideCompetencies(structure);
  const blocks: GuideCapacityBlock[] = [];
  let startCol = 2;

  competencies.forEach((competency: any, compIdx: number) => {
    const capacities = Array.isArray(competency?.capacities) ? competency.capacities : [];
    capacities.forEach((capacity: any, capIdx: number) => {
      const criteria = Array.isArray(capacity?.criteria) && capacity.criteria.length > 0
        ? capacity.criteria
        : [{ id: mkId(), name: 'Criterio 1' }];
      blocks.push({
        competencyIndex: compIdx,
        capacityIndex: capIdx,
        competencyLabel: competency?.name || `Competencia ${compIdx + 1}`,
        capacityLabel: capacity?.name || `CAPACIDAD ${capIdx + 1}`,
        criteriaCount: criteria.length,
        startCol
      });
      startCol += criteria.length * GUIDE_LEVELS.length;
    });
  });

  return blocks;
};

export const getGuideCapacityCount = (structure: any) => clampCount(
  getFlatGuideCapacities(structure).length || (structure?.capacitiesCount ?? structure?.aspectsCount ?? structure?.aspects?.length),
  4,
  1,
  6
);

export const getGuideCriteriaCount = (structure: any) => Math.max(getGuideCriterionBlocks(structure).length, 1);

export const getGuideLegendEntries = (structure: any) =>
  getGuideCriterionBlocks(structure).map((block) => ({
    id: `${block.competencyIndex}-${block.capacityIndex}-${block.criterionIndex}`,
    code: block.code,
    text: block.criterionLabel,
    capacityLabel: block.capacityLabel,
    competencyLabel: block.competencyLabel
  }));

export const ensureGuideLayout = (layout: InstrumentLayout, structure: any): InstrumentLayout => {
  const criterionBlocks = getGuideCriterionBlocks(structure);
  const capacityBlocks = getGuideCapacityBlocks(structure);
  const rows = GUIDE_HEADER_ROWS + GUIDE_BODY_ROWS;
  const cols = 2 + (getGuideCriteriaCount(structure) * GUIDE_LEVELS.length) + 1;
  const nextLayout = normalizeLayout({
    ...layout,
    rows,
    cols
  });
  const styles = { ...(nextLayout.styles || {}) };

  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < GUIDE_HEADER_ROWS; r += 1) {
      const id = layoutCellId(r, c);
      const current = styles[id] || DEFAULT_LAYOUT_STYLE;
      const hasCustomStyle = !!styles[id];
      styles[id] = {
        ...current,
        bg: current.bg === DEFAULT_LAYOUT_STYLE.bg ? '#6d28d9' : current.bg,
        color: current.color === DEFAULT_LAYOUT_STYLE.color ? '#ffffff' : current.color,
        bold: hasCustomStyle ? current.bold : true,
        align: hasCustomStyle && current.align !== DEFAULT_LAYOUT_STYLE.align ? current.align : 'center',
        vAlign: hasCustomStyle && current.vAlign !== DEFAULT_LAYOUT_STYLE.vAlign ? current.vAlign : 'middle',
        borderColor: current.borderColor === DEFAULT_LAYOUT_STYLE.borderColor ? '#ffffff' : current.borderColor
      };
    }
  }

  for (let c = 2; c < cols - 1; c += 1) {
    const levelIdx = (c - 2) % GUIDE_LEVELS.length;
    const levelColor = GUIDE_LEVEL_COLORS[levelIdx] || GUIDE_LEVEL_COLORS[GUIDE_LEVEL_COLORS.length - 1];
    const levelBorderColor = GUIDE_LEVEL_BORDER_COLORS[levelIdx] || GUIDE_LEVEL_BORDER_COLORS[GUIDE_LEVEL_BORDER_COLORS.length - 1];
    const headerId = layoutCellId(GUIDE_HEADER_ROWS - 1, c);
    const headerBase = nextLayout.styles?.[headerId] || null;
    const headerCurrent = styles[headerId] || DEFAULT_LAYOUT_STYLE;
    const useAutoLevelBg = !headerBase || headerBase.bg === DEFAULT_LAYOUT_STYLE.bg || headerBase.bg === '#6d28d9';
    const useAutoLevelColor = !headerBase || headerBase.color === DEFAULT_LAYOUT_STYLE.color || headerBase.color === '#ffffff';
    const useAutoLevelBorder = !headerBase || headerBase.borderColor === DEFAULT_LAYOUT_STYLE.borderColor || headerBase.borderColor === '#ffffff';

    styles[headerId] = {
      ...headerCurrent,
      bg: useAutoLevelBg ? levelColor : headerCurrent.bg,
      color: useAutoLevelColor ? '#ffffff' : headerCurrent.color,
      bold: headerBase ? headerCurrent.bold : true,
      align: headerBase && headerBase.align !== DEFAULT_LAYOUT_STYLE.align ? headerCurrent.align : 'center',
      vAlign: headerBase && headerBase.vAlign !== DEFAULT_LAYOUT_STYLE.vAlign ? headerCurrent.vAlign : 'middle',
      borderColor: useAutoLevelBorder ? levelBorderColor : headerCurrent.borderColor
    };

    for (let r = GUIDE_HEADER_ROWS; r < rows; r += 1) {
      const bodyId = layoutCellId(r, c);
      const bodyCurrent = styles[bodyId] || DEFAULT_LAYOUT_STYLE;
      styles[bodyId] = {
        ...bodyCurrent,
        color: bodyCurrent.color === DEFAULT_LAYOUT_STYLE.color ? levelColor : bodyCurrent.color,
        borderColor: bodyCurrent.borderColor === DEFAULT_LAYOUT_STYLE.borderColor ? levelBorderColor : bodyCurrent.borderColor
      };
    }
  }

  const autoMerges = [
    { sr: 0, sc: 0, er: GUIDE_HEADER_ROWS - 1, ec: 0 },
    { sr: 0, sc: 1, er: GUIDE_HEADER_ROWS - 1, ec: 1 },
    { sr: 0, sc: cols - 1, er: GUIDE_HEADER_ROWS - 1, ec: cols - 1 }
  ];

  const competencies = getGuideCompetencies(structure);
  let competencyStartCol = 2;
  competencies.forEach((competency: any) => {
    const capacities = Array.isArray(competency?.capacities) ? competency.capacities : [];
    const competencyCriteriaCount = capacities.reduce((acc: number, capacity: any) => {
      const criteria = Array.isArray(capacity?.criteria) && capacity.criteria.length > 0 ? capacity.criteria : [null];
      return acc + criteria.length;
    }, 0);
    const competencySpan = Math.max(competencyCriteriaCount, 1) * GUIDE_LEVELS.length;
    autoMerges.push({
      sr: 0,
      sc: competencyStartCol,
      er: 0,
      ec: competencyStartCol + competencySpan - 1
    });
    competencyStartCol += competencySpan;
  });

  capacityBlocks.forEach((block) => {
    autoMerges.push({
      sr: 1,
      sc: block.startCol,
      er: 1,
      ec: block.startCol + (block.criteriaCount * GUIDE_LEVELS.length) - 1
    });
  });

  criterionBlocks.forEach((block) => {
    autoMerges.push({
      sr: 2,
      sc: block.startCol,
      er: 2,
      ec: block.startCol + GUIDE_LEVELS.length - 1
    });
  });

  const customMerges = (nextLayout.merges || []).filter((merge) => autoMerges.every((autoMerge) => !intersectsLayout(autoMerge, merge)));

  return normalizeLayout({
    ...nextLayout,
    rows,
    cols,
    styles,
    merges: [...autoMerges, ...customMerges]
  });
};

export const getGuideShape = (structure: any) => ({
  rows: GUIDE_HEADER_ROWS + GUIDE_BODY_ROWS,
  cols: 2 + (getGuideCriteriaCount(structure) * GUIDE_LEVELS.length) + 1
});

export const getGuideFallbackText = (structure: any, r: number, c: number) => {
  const criterionBlocks = getGuideCriterionBlocks(structure);
  const capacityBlocks = getGuideCapacityBlocks(structure);
  const lastCol = getGuideShape(structure).cols - 1;

  if (r === 0 && c === 0) return 'N°';
  if (r === 0 && c === 1) return 'APELLIDOS Y NOMBRES';
  if (r === 0 && c === lastCol) return 'NL';
  if (r === 0 && c >= 2 && c < lastCol) {
    const block = capacityBlocks.find((item) => c >= item.startCol && c < item.startCol + (item.criteriaCount * GUIDE_LEVELS.length));
    return block?.competencyLabel || '';
  }
  if (r === 1 && c >= 2 && c < lastCol) {
    const block = capacityBlocks.find((item) => c >= item.startCol && c < item.startCol + (item.criteriaCount * GUIDE_LEVELS.length));
    return block?.capacityLabel || '';
  }
  if (r === 2 && c >= 2 && c < lastCol) {
    const block = criterionBlocks.find((item) => c >= item.startCol && c < item.startCol + GUIDE_LEVELS.length);
    return block?.code || '';
  }
  if (r === 3 && c >= 2 && c < lastCol) return GUIDE_LEVELS[(c - 2) % GUIDE_LEVELS.length];
  if (r >= GUIDE_HEADER_ROWS && c === 0) return String(r - (GUIDE_HEADER_ROWS - 1));
  return '';
};

export const getGuideColumnWidths = (structure: any) => {
  const criterionCount = getGuideCriteriaCount(structure);
  const numPct = 4;
  const logroPct = 6;
  const namePct = 30;
  const levelBudgetPct = 100 - numPct - logroPct - namePct;
  const totalLevelUnits = Math.max(criterionCount * (3 + 1.35), 1);
  const unitWidth = levelBudgetPct / totalLevelUnits;
  const compactLevelWidth = `${unitWidth}%`;
  const wideLevelWidth = `${unitWidth * 1.35}%`;

  return {
    num: `${numPct}%`,
    name: `${namePct}%`,
    level: compactLevelWidth,
    levelWide: wideLevelWidth,
    logro: `${logroPct}%`
  };
};

export const normalizeGuideStructure = (s: any, layout: InstrumentLayout) => {
  const rawCompetencies = Array.isArray(s?.competencies) ? s.competencies : [];
  const legacyAspects = Array.isArray(s?.aspects) ? s.aspects : [];
  const competenciesCount = 1;
  const capacitiesPerCompetency = clampCount(
    s.capacitiesPerCompetency
      ?? rawCompetencies[0]?.capacities?.length
      ?? Math.max(1, legacyAspects.length || 4),
    4,
    1,
    6
  );
  const criteriaPerCapacity = clampCount(
    s.criteriaPerCapacity
      ?? rawCompetencies[0]?.capacities?.[0]?.criteria?.length
      ?? 4,
    4,
    1,
    10
  );

  const normalizedCompetencies = rawCompetencies.length > 0
    ? Array.from({ length: competenciesCount }, (_, compIdx) => {
        const sourceCompetency = rawCompetencies[compIdx] || {};
        const sourceCapacities = Array.isArray(sourceCompetency?.capacities) ? sourceCompetency.capacities : [];
        return {
          id: sourceCompetency?.id || mkId(),
          name: '',
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
    : [{
        id: mkId(),
        name: '',
        capacities: Array.from({ length: Math.max(capacitiesPerCompetency, legacyAspects.length || 0) }, (_, capIdx) => ({
          id: legacyAspects[capIdx]?.id || mkId(),
          name: legacyAspects[capIdx]?.name || `CAPACIDAD ${capIdx + 1}`,
          criteria: Array.from({ length: criteriaPerCapacity }, (_, critIdx) => ({
            id: mkId(),
            name: `Criterio ${critIdx + 1}`
          }))
        }))
      }];

  const capacitiesCount = normalizedCompetencies.reduce((acc: number, competency: any) => acc + (competency?.capacities?.length || 0), 0);

  return {
    competencies: normalizedCompetencies,
    competenciesCount,
    capacitiesPerCompetency,
    criteriaPerCapacity,
    aspects: normalizedCompetencies.flatMap((competency: any) => competency.capacities || []),
    aspectsCount: capacitiesCount,
    capacitiesCount,
    layout: ensureGuideLayout(layout, {
      competencies: normalizedCompetencies,
      competenciesCount,
      capacitiesPerCompetency,
      criteriaPerCapacity
    })
  };
};
