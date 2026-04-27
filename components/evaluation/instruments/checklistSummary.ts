import { layoutCellId, normalizeLoose } from './common';
import {
  buildChecklistCapacities,
  buildChecklistHierarchy,
  buildChecklistVisualRows,
  CHECKLIST_LEVEL_COLORS,
  checklistBlocks,
  checklistLevelFromPct,
  getChecklistOptionConfig
} from './checklist';

export const getChecklistSummaries = (structure: any, texts: Record<string, string>) => {
  const rows = buildChecklistVisualRows(structure);
  const competencies = buildChecklistHierarchy(structure);
  const capacities = buildChecklistCapacities(structure);
  const optionPreset = getChecklistOptionConfig(structure?.expectedLabel);

  const capacityResults = capacities.map((cap) => {
    const criteriaRows = rows
      .map((row, rowIdx) => ({ row, layoutRow: rowIdx + 1 }))
      .filter(({ row }) => row.kind === 'crit' && row.itemIndex !== undefined && `${row.comp}-${row.cap}` === cap.id);

    let total = 0;
    let filled = 0;
    let positive = 0;
    criteriaRows.forEach(({ layoutRow }) => {
      total += 1;
      const positiveSelected = texts[layoutCellId(layoutRow, 2)] === optionPreset.positive;
      const negativeSelected = texts[layoutCellId(layoutRow, 3)] === optionPreset.negative;
      if (positiveSelected || negativeSelected) filled += 1;
      if (positiveSelected) positive += 1;
    });

    const pct = total > 0 ? Math.round((positive / total) * 100) : 0;
    const complete = total > 0 && filled === total;
    const level = complete ? checklistLevelFromPct(pct) : '◌';

    return {
      ...cap,
      total,
      filled,
      positive,
      pct,
      complete,
      level,
      bar: checklistBlocks(pct),
      levelColor: complete ? CHECKLIST_LEVEL_COLORS[level as 'C' | 'B' | 'A' | 'AD'] : CHECKLIST_LEVEL_COLORS.pending
    };
  });

  const competencySummaries = competencies.map((competency: any, compIdx: number) => {
    const competencyCapacities = capacityResults.filter((cap) => normalizeLoose(cap.competencia) === normalizeLoose(competency.title || `COMPETENCIA ${compIdx + 1}`));
    const totals = competencyCapacities.reduce((acc, cap) => {
      acc.total += cap.total;
      acc.filled += cap.filled;
      acc.positive += cap.positive;
      return acc;
    }, { total: 0, filled: 0, positive: 0 });
    const pct = totals.total > 0 ? Math.round((totals.positive / totals.total) * 100) : 0;
    const complete = totals.total > 0 && totals.filled === totals.total;
    const level = complete ? checklistLevelFromPct(pct) : '◌';

    return {
      id: competency.id || compIdx,
      title: competency.title || `COMPETENCIA ${compIdx + 1}`,
      capacities: competencyCapacities,
      pct,
      complete,
      level,
      bar: checklistBlocks(pct),
      levelColor: complete ? CHECKLIST_LEVEL_COLORS[level as 'C' | 'B' | 'A' | 'AD'] : CHECKLIST_LEVEL_COLORS.pending
    };
  });

  const totals = competencySummaries.reduce((acc, comp) => {
    acc.pctSum += comp.pct;
    acc.count += 1;
    acc.complete = acc.complete && comp.complete;
    return acc;
  }, { pctSum: 0, count: 0, complete: true });
  const finalPct = totals.count > 0 ? Math.round(totals.pctSum / totals.count) : 0;
  const finalLevel = totals.complete ? checklistLevelFromPct(finalPct) : '◌';

  return {
    optionPreset,
    competencySummaries,
    finalPct,
    finalLevel,
    finalLevelColor: totals.complete ? CHECKLIST_LEVEL_COLORS[finalLevel as 'C' | 'B' | 'A' | 'AD'] : CHECKLIST_LEVEL_COLORS.pending
  };
};
