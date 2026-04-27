import React from 'react';
import { GeneralData } from '../../../types';
import {
  buildChecklistCapacities,
  buildChecklistHierarchy,
  buildChecklistVisualRows,
  checklistBlocks,
  checklistLevelFromPct,
  CHECKLIST_LEVEL_COLORS,
  ensureChecklistLayout,
  getChecklistCapacityStyleMap,
  getChecklistFallbackText,
  getChecklistOptionConfig,
  getChecklistRowStyle
} from './checklist';
import { getChecklistSummaries } from './checklistSummary';
import {
  GUIDE_LEVEL_COLORS,
  GUIDE_LEVELS,
  ensureGuideLayout,
  getGuideColumnWidths,
  getGuideFallbackText,
  getGuideLevelForColumn,
  getGuideRowAverage,
  getGuideSummaries,
  getGuideShape
} from './guide';
import { getRubricaFallbackText, getRubricaShape } from './rubrica';
import { buildScaleBodyRows, getScaleCompetencySummariesDetailed, getScaleFallbackText, getScaleLevelForColumn, getScaleLevelHeaderColor, getScaleShape } from './scale';
import {
  DEFAULT_LAYOUT_STYLE,
  RUBRICA_HEADER_COLORS,
  getCellBorderStyle,
  getOrientationBoxStyle,
  getOrientationStyle,
  getVerticalAlignStyle,
  layoutCellId,
  normalizeDesign,
  normalizeLoose,
  normalizeLayout
} from './common';
import { InstrumentRecord, LayoutMerge } from './types';

interface InstrumentTableProps {
  inst: InstrumentRecord;
}

export const InstrumentTable: React.FC<InstrumentTableProps> = ({ inst }) => {
  const design = normalizeDesign(inst.structure?.design);
  const tableBoxStyle: React.CSSProperties = {
    borderColor: design.borderColor,
    borderRadius: `${design.borderRadius}px`
  };
  const headerStyle: React.CSSProperties = { backgroundColor: design.headerBg, color: design.headerText };
  const cellBaseStyle: React.CSSProperties = { borderColor: design.borderColor };

  if (inst.type === 'rubrica') {
    const rubricaLayout = normalizeLayout(inst.structure?.layout);
    const { rows, cols } = getRubricaShape(inst.structure);
    const totalCols = cols;
    return (
      <div className="overflow-x-auto border bg-white" style={tableBoxStyle}>
        <table className="w-full text-[10px] border-separate border-spacing-0">
          <thead>
            {design.mergeHeader && (
              <tr style={headerStyle}>
                <th className="p-2 text-center uppercase tracking-wide" colSpan={totalCols}>{inst.name}</th>
              </tr>
            )}
            <tr style={headerStyle}>
              {Array.from({ length: cols }).map((_, c) => {
                const id = layoutCellId(0, c);
                const text = rubricaLayout.texts?.[id] || getRubricaFallbackText(inst.structure, 0, c);
                const cellStyle = rubricaLayout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                const defaultHeaderBg = c <= 1 ? '#0f172a' : (RUBRICA_HEADER_COLORS[c - 2] || '#0f172a');
                return (
                  <th
                    key={`rubrica-prev-h-${c}`}
                    className="p-2 border-t text-left font-black"
                    style={{ ...cellBaseStyle, ...getCellBorderStyle(cellStyle, design.borderColor), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg || defaultHeaderBg, color: cellStyle.color || design.headerText, textAlign: cellStyle.align }}
                  >
                    <div style={{ ...getOrientationBoxStyle(cellStyle.orientation, text), ...getOrientationStyle(cellStyle.orientation) }}>{text}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows - 1 }).map((__, r0) => {
              const r = r0 + 1;
              return (
                <tr key={`rubrica-prev-r-${r}`} style={{ backgroundColor: r % 2 === 0 ? design.altRowBg : design.cellBg }}>
                  {Array.from({ length: cols }).map((_, c) => {
                    const id = layoutCellId(r, c);
                    const text = rubricaLayout.texts?.[id] || getRubricaFallbackText(inst.structure, r, c);
                    const cellStyle = rubricaLayout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                    const defaultBodyColor = c <= 1 ? '#0f172a' : (RUBRICA_HEADER_COLORS[c - 2] || '#0f172a');
                    return (
                      <td
                        key={`rubrica-prev-c-${r}-${c}`}
                        className={`p-2 border-t ${c <= 1 ? 'font-bold' : ''}`}
                        style={{ ...cellBaseStyle, ...getCellBorderStyle(cellStyle, design.borderColor), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg, color: cellStyle.color || defaultBodyColor, fontWeight: cellStyle.bold ? 800 : (c <= 1 ? 700 : 500), fontStyle: cellStyle.italic ? 'italic' : 'normal', textDecoration: cellStyle.underline ? 'underline' : 'none', textAlign: c === 0 ? 'center' : cellStyle.align }}
                      >
                        <div style={{ ...getOrientationBoxStyle(cellStyle.orientation, text), ...getOrientationStyle(cellStyle.orientation) }}>{text}</div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (inst.type === 'lista_cotejo') {
    const rows = buildChecklistVisualRows(inst.structure);
    const checklistLayout = ensureChecklistLayout(normalizeLayout(inst.structure?.layout), inst.structure);
    const checklistSummary = getChecklistSummaries(inst.structure, checklistLayout.texts || {});
    const checklistOptionPreset = checklistSummary.optionPreset;
    const capacityStyleMap = getChecklistCapacityStyleMap(checklistLayout, rows);
    const findChecklistMergeAt = (r: number, c: number) =>
      (checklistLayout.merges || []).find((m: LayoutMerge) => r >= m.sr && r <= m.er && c >= m.sc && c <= m.ec);
    const isChecklistCovered = (r: number, c: number) => {
      const m = findChecklistMergeAt(r, c);
      return !!m && !(m.sr === r && m.sc === c);
    };
    let rowN = 1;

    return (
      <div className="space-y-3">
        <div className="overflow-x-auto rounded-2xl border border-emerald-200 bg-white">
          <table className="w-full text-[10px] border-separate border-spacing-0">
            <thead>
              <tr className="bg-emerald-600 text-white">
                {['N°', 'CRITERIOS OBSERVABLES', checklistOptionPreset.positive.toUpperCase(), checklistOptionPreset.negative.toUpperCase(), 'OBSERVACIONES'].map((label, c) => {
                  const id = layoutCellId(0, c);
                  const cellStyle = checklistLayout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                  return (
                    <th
                      key={`check-prev-head-${c}`}
                      className={`p-2 font-black ${c === 0 ? 'text-center w-10 rounded-tl-2xl' : ''} ${c === 1 ? 'text-left' : ''} ${c === 2 ? 'text-center w-14' : ''} ${c === 3 ? 'text-center w-14' : ''} ${c === 4 ? 'text-left w-36 rounded-tr-2xl' : ''}`}
                      style={{ ...getCellBorderStyle(cellStyle, design.borderColor), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg === '#ffffff' ? '#059669' : cellStyle.bg, color: cellStyle.color === '#0f172a' ? '#ffffff' : cellStyle.color, fontWeight: 800, fontStyle: cellStyle.italic ? 'italic' : 'normal', textDecoration: cellStyle.underline ? 'underline' : 'none', textAlign: cellStyle.align }}
                    >
                      <div style={{ ...getOrientationBoxStyle(cellStyle.orientation, checklistLayout.texts?.[id] || label), ...getOrientationStyle(cellStyle.orientation) }}>{checklistLayout.texts?.[id] || label}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const r = idx + 1;
                const n = rowN;
                if (row.kind === 'crit') rowN += 1;
                const rowBaseClass = row.kind === 'comp' ? 'bg-emerald-100' : row.kind === 'cap' ? 'bg-emerald-50' : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50');
                const capacityRowStyle = row.kind !== 'crit' ? getChecklistRowStyle(checklistLayout, r) : null;
                return (
                  <tr key={`check-prev-row-${r}`} className={rowBaseClass}>
                    {Array.from({ length: 5 }).map((_, c) => {
                      if (isChecklistCovered(r, c)) return null;
                      const id = layoutCellId(r, c);
                      const baseCellStyle = checklistLayout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                      const cellStyle = row.kind === 'cap' && capacityRowStyle ? capacityRowStyle : baseCellStyle;
                      const merge = findChecklistMergeAt(r, c);
                      const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                      const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                      let fallback = '';
                      if (c === 0) fallback = row.kind === 'crit' ? String(n) : row.text;
                      if (c === 1) fallback = row.text;
                      if (c === 4 && row.kind === 'crit') fallback = '-';
                      if (row.kind !== 'crit' && c === 0 && colSpan > 1 && !checklistLayout.texts?.[id]) fallback = row.text;
                      return (
                        <td
                          key={`check-prev-cell-${r}-${c}`}
                          rowSpan={rowSpan}
                          colSpan={colSpan}
                          className={`p-2 border-t ${c === 0 ? 'text-center' : ''}`}
                          style={{ ...getCellBorderStyle(cellStyle, design.borderColor), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg, color: cellStyle.color, fontWeight: cellStyle.bold ? 800 : (row.kind === 'cap' ? 700 : (c === 0 ? 600 : 500)), fontStyle: cellStyle.italic ? 'italic' : 'normal', textDecoration: cellStyle.underline ? 'underline' : 'none', textAlign: cellStyle.align }}
                        >
                          {row.kind === 'crit' && (c === 2 || c === 3)
                            ? (
                              <div
                                className="relative flex min-h-[24px] items-center justify-center text-[10px] font-black text-transparent"
                                style={{ backgroundColor: checklistLayout.texts?.[id] ? (c === 2 ? '#059669' : '#ef4444') : 'transparent' }}
                              >
                                {checklistLayout.texts?.[id] ? <span className="absolute inset-0 flex items-center justify-center text-white">{'\u2714'}</span> : null}
                                {checklistLayout.texts?.[id] ? '\u2714' : ''}
                              </div>
                            )
                            : <div style={{ ...getOrientationBoxStyle(cellStyle.orientation, checklistLayout.texts?.[id] || fallback), ...getOrientationStyle(cellStyle.orientation) }}>{checklistLayout.texts?.[id] || fallback}</div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-1 text-[10px]">
          {checklistSummary.competencySummaries.map((comp) => (
            <div key={`sum-comp-${comp.id}`} className="space-y-1 rounded-xl border border-emerald-200/70 bg-white/70 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="font-black text-emerald-900 min-w-[150px]">{comp.title}</span>
                <span className="font-black tracking-tight" style={{ color: comp.levelColor }}>{comp.bar}</span>
                <span className="font-bold text-slate-700">{comp.pct}%</span>
                <span className="font-black" style={{ color: comp.levelColor }}>[{comp.level}]</span>
              </div>
              {comp.capacities.map((cap) => {
                return (
                  <div key={`sum-cap-${cap.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1">
                    <span className="font-black text-slate-700 min-w-[120px]">{cap.title}</span>
                    <span className="font-black tracking-tight" style={{ color: cap.levelColor }}>{cap.bar}</span>
                    <span className="font-bold text-slate-700">{cap.pct}%</span>
                    <span className="font-black" style={{ color: cap.levelColor }}>[{cap.level}]</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="pt-2 border-t border-emerald-200 font-black text-slate-800">NIVEL FINAL GENERAL -&gt; {checklistSummary.finalPct}% <span style={{ color: checklistSummary.finalLevelColor }}>[{checklistSummary.finalLevel}]</span></div>
        </div>
      </div>
    );
  }

  if (inst.type === 'escala_valoracion') {
    const scaleLayout = normalizeLayout(inst.structure?.layout);
    const scaleShape = getScaleShape(inst.structure);
    const scaleBodyRows = buildScaleBodyRows(inst.structure);
    const scaleCompetencySummaries = getScaleCompetencySummariesDetailed(inst.structure, scaleLayout.texts || {}, scaleLayout);
    const findScaleMergeAt = (r: number, c: number) =>
      (scaleLayout.merges || []).find((m: LayoutMerge) => r >= m.sr && r <= m.er && c >= m.sc && c <= m.ec);
    const isScaleCovered = (r: number, c: number) => {
      const m = findScaleMergeAt(r, c);
      return !!m && !(m.sr === r && m.sc === c);
    };
    return (
      <div className="space-y-3">
        <div className="overflow-hidden border bg-white" style={tableBoxStyle}>
          <table className="w-full table-fixed text-[10px] border-separate border-spacing-0">
            <tbody>
              {Array.from({ length: scaleShape.rows }).map((_, r) => (
                <tr key={`scale-prev-r-${r}`}>
                  {Array.from({ length: scaleShape.cols }).map((_, c) => {
                    if (isScaleCovered(r, c)) return null;
                    const id = layoutCellId(r, c);
                    const cellStyle = scaleLayout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                    const merge = findScaleMergeAt(r, c);
                    const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                    const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                    const text = scaleLayout.texts?.[id] || getScaleFallbackText(inst.structure, r, c);
                    const isHeader = r <= 1;
                    const bodyRow = r >= 2 ? scaleBodyRows[r - 2] : null;
                    const isScaleLevelCell = bodyRow?.kind === 'crit' && c >= 2;
                    const currentScaleLevel = isScaleLevelCell && String(text || '') === getScaleLevelForColumn(inst.structure, c);
                    const inheritedLevelBg = c >= 2 ? getScaleLevelHeaderColor(scaleLayout, inst.structure, c) : '#0f172a';
                    const resolvedBg = isScaleLevelCell && currentScaleLevel
                      ? inheritedLevelBg
                      : cellStyle.bg === '#ffffff'
                        ? (isHeader ? inheritedLevelBg : design.cellBg)
                        : cellStyle.bg;
                    const resolvedColor = isScaleLevelCell && currentScaleLevel ? '#ffffff' : (isHeader ? '#ffffff' : (cellStyle.color === '#0f172a' ? '#334155' : cellStyle.color));
                    const width = c === 0 ? '3.5%' : c === 1 ? '18.5%' : `${78 / Math.max(scaleShape.cols - 2, 1)}%`;
                    return (
                      <td
                        key={`scale-prev-c-${r}-${c}`}
                        rowSpan={rowSpan}
                        colSpan={colSpan}
                        className="p-2 border"
                        style={{ width, ...getCellBorderStyle(cellStyle, '#d946ef'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: resolvedBg, color: resolvedColor, fontWeight: cellStyle.bold ? 800 : (isHeader || bodyRow?.kind === 'cap' ? 700 : 500), fontStyle: cellStyle.italic ? 'italic' : 'normal', textDecoration: cellStyle.underline ? 'underline' : 'none', textAlign: bodyRow?.kind === 'crit' && c === 1 ? 'left' : (bodyRow?.kind === 'crit' && c === 0 ? 'center' : cellStyle.align) }}
                      >
                        {isScaleLevelCell ? (
                          <div className="relative flex min-h-[24px] items-center justify-center text-[10px] font-black text-transparent">
                            {currentScaleLevel ? <span className="absolute inset-0 flex items-center justify-center text-white">{'\u2714'}</span> : null}
                            {currentScaleLevel ? '\u2714' : ''}
                          </div>
                        ) : (
                          <div style={{ ...getOrientationBoxStyle(cellStyle.orientation, text), ...getOrientationStyle(cellStyle.orientation) }}>{text}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-2 text-[10px]">
          {scaleCompetencySummaries.map((summary) => (
            <div key={`scale-summary-prev-${summary.competencyIndex}`} className="space-y-1 rounded-xl border border-emerald-200/70 bg-white/70 px-3 py-2">
              <div className="font-black text-emerald-900">{`COMPETENCIA ${summary.competencyIndex + 1}`}</div>
              <div className="text-[10px] leading-4 text-slate-600 break-words" title={summary.competencyName}>{summary.competencyName}</div>
              <div className="flex items-center gap-3">
                <span className="h-4 w-28 overflow-hidden rounded-sm bg-emerald-100">
                  <span className="block h-full" style={{ width: `${summary.pct}%`, backgroundColor: summary.barColor }} />
                </span>
                <span className="font-bold text-slate-700">{`${summary.pct}%`}</span>
                <span className="font-black" style={{ color: summary.labelColor }}>[{summary.label}]</span>
              </div>
              {summary.capacities.map((capacity) => (
                <div key={`scale-cap-prev-${summary.competencyIndex}-${capacity.capacityIndex}`} className="flex items-center gap-3 rounded-lg px-2 py-1">
                  <span className="font-black text-slate-700 min-w-[120px]">{capacity.capacityName}</span>
                  <span className="h-4 w-24 overflow-hidden rounded-sm bg-emerald-100">
                    <span className="block h-full" style={{ width: `${capacity.pct}%`, backgroundColor: capacity.barColor }} />
                  </span>
                  <span className="font-bold text-slate-700">{`${capacity.pct}%`}</span>
                  <span className="font-black" style={{ color: capacity.labelColor }}>[{capacity.label}]</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const guideLayout = ensureGuideLayout(normalizeLayout(inst.structure?.layout), inst.structure);
  const guideShape = getGuideShape(inst.structure);
  const guideCols = guideShape.cols;
  const guideRows = guideShape.rows;
  const guideWidths = getGuideColumnWidths(inst.structure);
  const guideSummaries = getGuideSummaries(inst.structure, guideLayout.texts || {});
  const guideLevelColorMap = new Map(GUIDE_LEVELS.map((level, idx) => [level, GUIDE_LEVEL_COLORS[idx] || GUIDE_LEVEL_COLORS[0]]));
  const findGuideMergeAt = (r: number, c: number) =>
    (guideLayout.merges || []).find((m: LayoutMerge) => r >= m.sr && r <= m.er && c >= m.sc && c <= m.ec);
  const isGuideCovered = (r: number, c: number) => {
    const merge = findGuideMergeAt(r, c);
    return !!merge && !(merge.sr === r && merge.sc === c);
  };
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border bg-white" style={tableBoxStyle}>
      <table className="w-full table-fixed text-[9px] border-separate border-spacing-0">
        <colgroup>
          <col style={{ width: guideWidths.num }} />
          <col style={{ width: guideWidths.name }} />
          {Array.from({ length: Math.max(guideCols - 3, 0) }).map((_, idx) => (
            <col key={`guide-prev-col-level-${idx}`} style={{ width: ((idx + 1) % GUIDE_LEVELS.length === 0) ? guideWidths.levelWide : guideWidths.level }} />
          ))}
          <col style={{ width: guideWidths.logro }} />
        </colgroup>
        <tbody>
          {Array.from({ length: guideRows }).map((__, r) => (
            <tr key={`guide-prev-r-${r}`}>
              {Array.from({ length: guideCols }).map((_, c) => {
                if (isGuideCovered(r, c)) return null;
                const id = layoutCellId(r, c);
                const cellStyle = guideLayout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                const merge = findGuideMergeAt(r, c);
                const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                const text = guideLayout.texts?.[id] || getGuideFallbackText(inst.structure, r, c);
                const baseHeader = r <= 3;
                const isGuideLevelCell = r >= 4 && c >= 2 && c < guideCols - 1;
                const selectedLevel = String(text || '') === getGuideLevelForColumn(c);
                const rowAverage = r >= 4 && c === guideCols - 1 ? getGuideRowAverage(guideLayout.texts || {}, r, guideCols) : '';
                const rowAverageIsLevel = GUIDE_LEVELS.includes(rowAverage as any);
                return (
                  <td
                    key={`guide-prev-c-${r}-${c}`}
                    rowSpan={rowSpan}
                    colSpan={colSpan}
                    className={`p-1 ${c === 1 && r >= 2 ? 'italic' : ''}`}
                    style={{ ...getCellBorderStyle(cellStyle, baseHeader ? '#ffffff' : design.borderColor), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: isGuideLevelCell && selectedLevel ? (guideLevelColorMap.get(getGuideLevelForColumn(c)) || cellStyle.bg) : (r >= 4 && c === guideCols - 1 ? (rowAverageIsLevel ? (guideLevelColorMap.get(rowAverage) || cellStyle.bg) : (rowAverage ? '#e2e8f0' : cellStyle.bg)) : (baseHeader ? (cellStyle.bg === '#ffffff' ? '#6d28d9' : cellStyle.bg) : cellStyle.bg)), color: baseHeader ? (cellStyle.color === '#0f172a' ? '#ffffff' : cellStyle.color) : ((r >= 4 && c === guideCols - 1 && rowAverageIsLevel) ? '#ffffff' : ((r >= 4 && c === guideCols - 1 && rowAverage) ? '#475569' : cellStyle.color)), textAlign: cellStyle.align, fontWeight: cellStyle.bold ? 800 : (baseHeader ? 700 : 500), fontStyle: cellStyle.italic ? 'italic' : 'normal', textDecoration: cellStyle.underline ? 'underline' : 'none', whiteSpace: c === guideCols - 1 ? 'normal' : 'nowrap', lineHeight: c === guideCols - 1 ? 1.1 : undefined }}
                  >
                    {isGuideLevelCell ? (
                      <div className="relative flex min-h-[24px] items-center justify-center text-[10px] font-black text-transparent">
                        {selectedLevel ? <span className="absolute inset-0 flex items-center justify-center text-white">✔</span> : null}
                        {selectedLevel ? '✓' : ''}
                      </div>
                    ) : (r >= 4 && c === guideCols - 1) ? (
                      <div className="flex min-h-[24px] items-center justify-center text-[8px] font-black">{rowAverage}</div>
                    ) : (
                      <div style={{ ...getOrientationBoxStyle(cellStyle.orientation, text), ...getOrientationStyle(cellStyle.orientation) }}>{text}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-2 text-[10px]">
        <div className="text-[10px] font-black uppercase text-slate-700">Nivel de logro de aula</div>
        {guideSummaries.competencies.map((summary) => (
          <div key={`guide-summary-prev-${summary.competencyIndex}`} className="space-y-1 rounded-xl border border-emerald-200/70 bg-white/70 px-3 py-2">
            <div className="font-black text-emerald-900">{`COMPETENCIA ${summary.competencyIndex + 1}`}</div>
            <div className="text-[10px] leading-4 text-slate-600 break-words" title={summary.competencyLabel}>{summary.competencyLabel}</div>
            <div className="flex items-center gap-3">
              <span className="h-4 w-28 overflow-hidden rounded-sm bg-emerald-100">
                <span className="block h-full" style={{ width: `${summary.pct}%`, backgroundColor: summary.barColor }} />
              </span>
              <span className="font-bold text-slate-700">{`${summary.pct}%`}</span>
              <span className="font-black" style={{ color: summary.labelColor }}>[{summary.label}]</span>
            </div>
            {summary.capacities.map((capacity) => (
              <div key={`guide-cap-prev-${summary.competencyIndex}-${capacity.capacityIndex}`} className="flex items-center gap-3 rounded-lg px-2 py-1">
                <span className="font-black text-slate-700 min-w-[120px]">{capacity.capacityLabel}</span>
                <span className="h-4 w-24 overflow-hidden rounded-sm bg-emerald-100">
                  <span className="block h-full" style={{ width: `${capacity.pct}%`, backgroundColor: capacity.barColor }} />
                </span>
                <span className="font-bold text-slate-700">{`${capacity.pct}%`}</span>
                <span className="font-black" style={{ color: capacity.labelColor }}>[{capacity.label}]</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

interface InstrumentPreviewCardProps {
  inst: InstrumentRecord;
  generalData: GeneralData | null;
  getAreaName: (areaId: string) => string;
}

export const InstrumentPreviewCard: React.FC<InstrumentPreviewCardProps> = ({ inst, generalData, getAreaName }) => {
  const design = normalizeDesign(inst.structure?.design);
  const institution = generalData?.institution || 'INSTITUCIÓN EDUCATIVA';
  const district = generalData?.district || 'Distrito';
  const province = generalData?.province || 'Provincia';
  const motto = generalData?.motto || 'Lema institucional';
  const teacher = generalData?.teacher || 'Docente';
  const areaName = getAreaName(inst.areaId);

  return (
    <div className="bg-white border border-slate-300 rounded-2xl shadow-sm p-4 md:p-6 space-y-4">
      <div className="border-b border-slate-300 pb-3">
        <div className="grid grid-cols-[64px_1fr_64px] gap-3 items-center">
          <div className="w-16 h-16 rounded-full border-2 border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center text-[8px] font-bold text-slate-400">
            {generalData?.insignia ? <img src={generalData.insignia} alt="Insignia IE" className="w-full h-full object-contain" /> : <span>INSIGNIA</span>}
          </div>
          <div className="text-center">
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-800">{institution}</p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{district} - {province}</p>
            <p className="text-[10px] font-medium italic text-slate-600">{motto}</p>
          </div>
          <div className="w-16 h-16 rounded-full border-2 border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center text-[8px] font-bold text-slate-400 ml-auto">
            {generalData?.logo ? <img src={generalData.logo} alt="Logo IE" className="w-full h-full object-contain" /> : <span>LOGO</span>}
          </div>
        </div>
        <div className="mt-3 text-center border border-slate-300 rounded-lg p-2 bg-slate-50">
          <p className="text-[10px] font-black uppercase text-slate-800">{inst.name}</p>
          <p className="text-[9px] font-bold uppercase text-slate-500">{inst.type.replace('_', ' ')} | {inst.grade || 'General'} {inst.section || ''}</p>
          {design.titleLine ? <p className="text-[9px] mt-1 text-slate-600 font-bold">{design.titleLine}</p> : null}
        </div>
      </div>
      <InstrumentTable inst={inst} />
      <div className="border-t border-slate-300 pt-2 flex items-center justify-between text-[10px]">
        <span className="font-black uppercase text-slate-700">{areaName}</span>
        <span className="font-bold uppercase text-slate-600">{teacher}</span>
      </div>
    </div>
  );
};

export const InstrumentThumbnail: React.FC<{ inst: InstrumentRecord }> = ({ inst }) => (
  <div className="h-44 rounded-xl border border-slate-200 bg-white overflow-hidden pointer-events-none">
    <div className="origin-top-left scale-[0.62] w-[161%]">
      <InstrumentTable inst={inst} />
    </div>
  </div>
);
