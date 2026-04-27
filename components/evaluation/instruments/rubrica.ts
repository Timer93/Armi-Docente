import { InstrumentLayout } from './types';
import { DEFAULT_LAYOUT_STYLE, RUBRICA_HEADER_COLORS, clampCount, layoutCellId, mkId, normalizeLayout } from './common';

export const ensureRubricaHeaderStyles = (layout: InstrumentLayout, levelCount: number, rowCount: number): InstrumentLayout => {
  const nextStyles = { ...(layout.styles || {}) };
  nextStyles[layoutCellId(0, 0)] = { ...(nextStyles[layoutCellId(0, 0)] || DEFAULT_LAYOUT_STYLE), bg: '#0f172a', color: '#ffffff', bold: true, align: 'left' };
  nextStyles[layoutCellId(0, 1)] = { ...(nextStyles[layoutCellId(0, 1)] || DEFAULT_LAYOUT_STYLE), bg: '#0f172a', color: '#ffffff', bold: true, align: 'left' };
  for (let i = 0; i < levelCount; i += 1) {
    const col = i + 2;
    const id = layoutCellId(0, col);
    nextStyles[id] = {
      ...(nextStyles[id] || DEFAULT_LAYOUT_STYLE),
      bg: RUBRICA_HEADER_COLORS[i] || RUBRICA_HEADER_COLORS[RUBRICA_HEADER_COLORS.length - 1],
      color: '#ffffff',
      bold: true,
      align: 'left'
    };
    for (let r = 1; r < rowCount; r += 1) {
      const bodyId = layoutCellId(r, col);
      const current = nextStyles[bodyId] || DEFAULT_LAYOUT_STYLE;
      if (!nextStyles[bodyId]) {
        nextStyles[bodyId] = { ...current, color: RUBRICA_HEADER_COLORS[i] || RUBRICA_HEADER_COLORS[RUBRICA_HEADER_COLORS.length - 1] };
      }
    }
  }
  return normalizeLayout({ ...layout, styles: nextStyles, cols: Math.max(layout.cols, levelCount + 2), rows: Math.max(layout.rows, rowCount) });
};

export const getRubricaShape = (structure: any) => {
  const levels = Array.isArray(structure?.levels) ? structure.levels : [];
  const criteria = Array.isArray(structure?.criteria) ? structure.criteria : [];
  return {
    rows: Math.max(criteria.length + 1, 2),
    cols: Math.max(levels.length + 2, 3)
  };
};

export const getRubricaFallbackText = (structure: any, r: number, c: number) => {
  const levels = Array.isArray(structure?.levels) ? structure.levels : [];
  const criteria = Array.isArray(structure?.criteria) ? structure.criteria : [];
  if (r === 0 && c === 0) return 'N°';
  if (r === 0 && c === 1) return 'Criterio';
  if (r === 0 && c > 1) return levels[c - 2]?.label || `Nivel ${c - 1}`;
  if (c === 0 && r > 0) return String(r);
  if (c === 1 && r > 0) return criteria[r - 1]?.name || `Criterio ${r}`;
  const levelLabel = levels[c - 2]?.label || `Nivel ${c - 1}`;
  return `Descriptor ${levelLabel}`;
};

export const normalizeRubricaStructure = (s: any, layout: InstrumentLayout) => {
  const levels = Array.isArray(s.levels) && s.levels.length
    ? s.levels
    : [
        { id: 'c', label: 'Inicio' },
        { id: 'b', label: 'Proceso' },
        { id: 'a', label: 'Logrado' },
        { id: 'ad', label: 'Destacado' }
      ];
  const criteriaCount = clampCount(s.criteriaCount ?? s.criteria?.length, 4, 1, 30);
  const criteria = Array.from({ length: criteriaCount }, (_, idx) => ({
    id: s?.criteria?.[idx]?.id || mkId(),
    name: s?.criteria?.[idx]?.name || `Criterio ${idx + 1}`
  }));
  return { levels, criteria, criteriaCount, layout: ensureRubricaHeaderStyles(layout, levels.length, criteriaCount + 1) };
};
