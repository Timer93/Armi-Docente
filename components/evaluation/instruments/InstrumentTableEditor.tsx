import React from 'react';
import {
  buildChecklistVisualRows,
  CHECKLIST_LEVEL_COLORS,
  getChecklistOptionConfig,
  getChecklistRowStyle
} from './checklist';
import { getChecklistSummaries } from './checklistSummary';
import {
  GUIDE_LEVEL_COLORS,
  GUIDE_LEVELS,
  getGuideCapacityBlocks,
  getGuideColumnWidths,
  getGuideCriterionBlocks,
  getGuideFallbackText,
  getGuideLevelForColumn,
  getGuideRowAverage,
  getGuideSummaries,
  getGuideShape
} from './guide';
import {
  DEFAULT_LAYOUT_STYLE,
  EditableContent,
  RUBRICA_HEADER_COLORS,
  getCellBorderStyle,
  getOrientationBoxStyle,
  getOrientationStyle,
  getVerticalAlignStyle,
  layoutCellId
} from './common';
import {
  getRubricaFallbackText,
  getRubricaShape
} from './rubrica';
import {
  buildScaleBodyRows,
  getScaleCompetencySummariesDetailed,
  getScaleFallbackText,
  getScaleLevelForColumn,
  getScaleLevelHeaderColor,
  getScaleShape
} from './scale';
import {
  InstrumentLayout,
  InstrumentRecord,
  LayoutMerge,
  LayoutRange
} from './types';

interface InstrumentTableEditorProps {
  editor: InstrumentRecord;
  layout: InstrumentLayout;
  layoutDragTool: 'row' | 'col' | 'cell' | null;
  setLayoutDragTool: React.Dispatch<React.SetStateAction<'row' | 'col' | 'cell' | null>>;
  closeFormatPopovers: () => void;
  inLayoutSelection: (r: number, c: number) => boolean;
  isLayoutCovered: (r: number, c: number) => boolean;
  findLayoutMergeAt: (r: number, c: number) => LayoutMerge | undefined;
  onLayoutCellMouseDown: (r: number, c: number) => void;
  onLayoutCellEnter: (r: number, c: number) => void;
  onLayoutCellContext: (e: React.MouseEvent, r: number, c: number) => void;
  setLayoutText: (r: number, c: number, value: string) => void;
  setLayoutSelection: React.Dispatch<React.SetStateAction<LayoutRange | null>>;
  insertLayoutRow: (at: number) => void;
  insertLayoutCol: (at: number) => void;
  updateRubricaLevel: (idx: number, value: string) => void;
  updateRubricaCriterionName: (idx: number, value: string) => void;
  updateChecklistCompetencyName: (competencyIndex: number, value: string) => void;
  updateChecklistCapacityName: (competencyIndex: number, capacityIndex: number, value: string) => void;
  updateChecklistCriterionName: (competencyIndex: number, capacityIndex: number, criterionIndex: number, value: string) => void;
  updateChecklistSelection: (row: number, col: number, checked: boolean) => void;
  updateScaleCompetencyName: (competencyIndex: number, value: string) => void;
  updateScaleCapacityName: (competencyIndex: number, capacityIndex: number, value: string) => void;
  updateScaleCriterionName: (competencyIndex: number, capacityIndex: number, criterionIndex: number, value: string) => void;
  updateScaleLabel: (idx: number, value: string) => void;
  updateScaleLevelSelection: (row: number, col: number, checked: boolean) => void;
  updateGuideCapacityNameByFlatIndex: (flatIndex: number, value: string) => void;
  updateGuideCriterionNameByFlatIndex: (flatIndex: number, value: string) => void;
  updateGuideLevelSelection: (row: number, col: number, checked: boolean) => void;
}

export const InstrumentTableEditor: React.FC<InstrumentTableEditorProps> = ({
  editor,
  layout,
  layoutDragTool,
  setLayoutDragTool,
  closeFormatPopovers,
  inLayoutSelection,
  isLayoutCovered,
  findLayoutMergeAt,
  onLayoutCellMouseDown,
  onLayoutCellEnter,
  onLayoutCellContext,
  setLayoutText,
  setLayoutSelection,
  insertLayoutRow,
  insertLayoutCol,
  updateRubricaLevel,
  updateRubricaCriterionName,
  updateChecklistCompetencyName,
  updateChecklistCapacityName,
  updateChecklistCriterionName,
  updateChecklistSelection,
  updateScaleCompetencyName,
  updateScaleCapacityName,
  updateScaleCriterionName,
  updateScaleLabel,
  updateScaleLevelSelection,
  updateGuideCapacityNameByFlatIndex,
  updateGuideCriterionNameByFlatIndex,
  updateGuideLevelSelection
}) => {
  if (editor.type === 'rubrica') {
    return (
      <div className="overflow-auto p-3 space-y-2" onClick={closeFormatPopovers}>
        <p className="text-[10px] font-bold text-slate-500 uppercase">Tabla editable de rúbrica (clic derecho para formato)</p>
        <div className="rounded-xl overflow-hidden border border-slate-200">
          <table className="w-full table-fixed border-separate border-spacing-0">
            <thead>
              <tr>
                {Array.from({ length: getRubricaShape(editor.structure).cols }).map((_, c) => {
                  const totalCols = getRubricaShape(editor.structure).cols;
                  const id = layoutCellId(0, c);
                  const cellStyle = layout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                  const defaultHeaderBg = c <= 1 ? '#0f172a' : (RUBRICA_HEADER_COLORS[c - 2] || '#0f172a');
                  return (
                    <th
                      key={`rubrica-edit-h-${c}`}
                      className={`border border-slate-700 p-0 text-[10px] font-black ${c === 0 ? 'rounded-tl-lg' : ''} ${c === totalCols - 1 ? 'rounded-tr-lg' : ''} ${inLayoutSelection(0, c) ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                      style={{ ...getCellBorderStyle(cellStyle, '#334155'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg === '#ffffff' ? defaultHeaderBg : cellStyle.bg, width: c === 0 ? '8%' : (c === 1 ? '20%' : `${72 / Math.max(totalCols - 2, 1)}%`) }}
                      onMouseDown={() => onLayoutCellMouseDown(0, c)}
                      onMouseEnter={() => onLayoutCellEnter(0, c)}
                      onContextMenu={(e) => onLayoutCellContext(e, 0, c)}
                    >
                      <div
                        className="min-h-[44px] p-2 outline-none break-words whitespace-pre-wrap"
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => {
                          const value = (e.currentTarget.innerText || '').trim();
                          if (c > 1) updateRubricaLevel(c - 2, value || `Nivel ${c - 1}`);
                          setLayoutText(0, c, value);
                        }}
                        style={{
                          color: cellStyle.color === '#0f172a' ? '#ffffff' : cellStyle.color,
                          fontWeight: 800,
                          fontStyle: cellStyle.italic ? 'italic' : 'normal',
                          textAlign: cellStyle.align,
                          textDecoration: cellStyle.underline ? 'underline' : 'none',
                          ...getOrientationStyle(cellStyle.orientation),
                          ...getOrientationBoxStyle(cellStyle.orientation, layout.texts?.[id] || getRubricaFallbackText(editor.structure, 0, c))
                        }}
                      >
                        {layout.texts?.[id] || getRubricaFallbackText(editor.structure, 0, c)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: getRubricaShape(editor.structure).rows - 1 }).map((__, r0) => {
                const r = r0 + 1;
                return (
                  <tr key={`rubrica-edit-r-${r}`}>
                    {Array.from({ length: getRubricaShape(editor.structure).cols }).map((_, c) => {
                      if (isLayoutCovered(r, c)) return null;
                      const totalCols = getRubricaShape(editor.structure).cols;
                      const lastRow = getRubricaShape(editor.structure).rows - 1;
                      const id = layoutCellId(r, c);
                      const cellStyle = layout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                      const defaultBodyColor = c <= 1 ? '#0f172a' : (RUBRICA_HEADER_COLORS[c - 2] || '#0f172a');
                      const merge = findLayoutMergeAt(r, c);
                      const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                      const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                      return (
                        <td
                          key={`rubrica-edit-c-${r}-${c}`}
                          rowSpan={rowSpan}
                          colSpan={colSpan}
                          className={`border border-slate-200 p-0 ${r === lastRow && c === 0 ? 'rounded-bl-lg' : ''} ${r === lastRow && c === totalCols - 1 ? 'rounded-br-lg' : ''} ${inLayoutSelection(r, c) ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                          style={{ ...getCellBorderStyle(cellStyle, '#cbd5e1'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg, width: c === 0 ? '8%' : (c === 1 ? '20%' : `${72 / Math.max(totalCols - 2, 1)}%`) }}
                          onMouseDown={() => onLayoutCellMouseDown(r, c)}
                          onMouseEnter={() => onLayoutCellEnter(r, c)}
                          onContextMenu={(e) => onLayoutCellContext(e, r, c)}
                        >
                          <div
                            className="min-h-[46px] p-2 text-[10px] outline-none break-words whitespace-pre-wrap"
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => {
                              const value = (e.currentTarget.innerText || '').trim();
                              if (c === 1) updateRubricaCriterionName(r - 1, value || `Criterio ${r}`);
                              setLayoutText(r, c, value);
                            }}
                            style={{
                              color: cellStyle.color || defaultBodyColor,
                              fontWeight: cellStyle.bold ? 800 : (c <= 1 ? 700 : 500),
                              fontStyle: cellStyle.italic ? 'italic' : 'normal',
                              textAlign: c === 0 ? 'center' : cellStyle.align,
                              textDecoration: cellStyle.underline ? 'underline' : 'none',
                              ...getOrientationStyle(cellStyle.orientation),
                              ...getOrientationBoxStyle(cellStyle.orientation, layout.texts?.[id] || getRubricaFallbackText(editor.structure, r, c))
                            }}
                          >
                            {layout.texts?.[id] || getRubricaFallbackText(editor.structure, r, c)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (editor.type === 'lista_cotejo') {
    const rows = buildChecklistVisualRows(editor.structure);
    const checklistOptionPreset = getChecklistOptionConfig(editor.structure?.expectedLabel);
    const checklistSummary = getChecklistSummaries(editor.structure, layout.texts || {});
    const getEditorChecklistMergeAt = (r: number, c: number) =>
      (layout.merges || []).find((m: LayoutMerge) => r >= m.sr && r <= m.er && c >= m.sc && c <= m.ec);
    let runningN = 0;

    return (
      <div className="overflow-auto p-3 space-y-3" onClick={closeFormatPopovers}>
        <p className="text-[10px] font-bold text-slate-500 uppercase">Tabla editable de lista de cotejo (clic derecho para formato)</p>
        <div className="rounded-2xl overflow-hidden border border-emerald-200 bg-white">
          <table className="w-full text-[10px] border-separate border-spacing-0">
            <thead>
              <tr>
                {['N°', 'CRITERIOS OBSERVABLES', checklistOptionPreset.positive.toUpperCase(), checklistOptionPreset.negative.toUpperCase(), 'OBSERVACIONES'].map((label, c) => {
                  const id = layoutCellId(0, c);
                  const cellStyle = layout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                  return (
                    <th
                      key={`check-edit-head-${c}`}
                      className={`border border-emerald-700 p-0 text-white font-black ${c === 0 ? 'rounded-tl-xl' : ''} ${c === 4 ? 'rounded-tr-xl' : ''} ${inLayoutSelection(0, c) ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                      style={{ ...getCellBorderStyle(cellStyle, '#047857'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg === '#ffffff' ? '#059669' : cellStyle.bg }}
                      onMouseDown={() => onLayoutCellMouseDown(0, c)}
                      onMouseEnter={() => onLayoutCellEnter(0, c)}
                      onContextMenu={(e) => onLayoutCellContext(e, 0, c)}
                    >
                      <EditableContent
                        className="min-h-[36px] p-2 outline-none"
                        value={layout.texts?.[id] || label}
                        onLiveChange={(value) => setLayoutText(0, c, value)}
                        onCommit={(value) => setLayoutText(0, c, value)}
                        style={{
                          color: cellStyle.color === '#0f172a' ? '#ffffff' : cellStyle.color,
                          fontWeight: 800,
                          fontStyle: cellStyle.italic ? 'italic' : 'normal',
                          textAlign: cellStyle.align,
                          textDecoration: cellStyle.underline ? 'underline' : 'none',
                          ...getOrientationStyle(cellStyle.orientation),
                          ...getOrientationBoxStyle(cellStyle.orientation, layout.texts?.[id] || label)
                        }}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const r = idx + 1;
                if (row.kind === 'crit') runningN += 1;
                const rowBaseClass = row.kind === 'comp' ? 'bg-emerald-100' : row.kind === 'cap' ? 'bg-emerald-50' : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50');
                const capacityRowStyle = row.kind !== 'crit' ? getChecklistRowStyle(layout, r) : null;
                return (
                  <tr key={`check-edit-row-${r}`} className={rowBaseClass}>
                    {Array.from({ length: 5 }).map((_, c) => {
                      if (isLayoutCovered(r, c)) return null;
                      const id = layoutCellId(r, c);
                      const rawCellStyle = layout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                      const cellStyle = row.kind !== 'crit' && capacityRowStyle ? capacityRowStyle : rawCellStyle;
                      const merge = getEditorChecklistMergeAt(r, c);
                      const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                      const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                      let fallback = '';
                      if (c === 0) fallback = row.kind === 'crit' ? String(runningN) : row.text;
                      if (c === 1) fallback = row.text;
                      if (row.kind !== 'crit' && c === 0 && colSpan > 1 && !layout.texts?.[id]) fallback = row.text;
                      const isLast = idx === rows.length - 1;
                      return (
                        <td
                          key={`check-edit-cell-${r}-${c}`}
                          rowSpan={rowSpan}
                          colSpan={colSpan}
                          className={`border border-slate-200 p-0 ${isLast && c === 0 ? 'rounded-bl-xl' : ''} ${isLast && c === 4 ? 'rounded-br-xl' : ''} ${inLayoutSelection(r, c) ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                          style={{ ...getCellBorderStyle(cellStyle, '#cbd5e1'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg }}
                          onMouseDown={() => onLayoutCellMouseDown(r, c)}
                          onMouseEnter={() => onLayoutCellEnter(r, c)}
                          onContextMenu={(e) => onLayoutCellContext(e, r, c)}
                        >
                          {row.kind === 'crit' && (c === 2 || c === 3) ? (
                            <button
                              type="button"
                              className="flex min-h-[34px] w-full items-center justify-center bg-transparent text-[12px] font-black"
                              style={{
                                position: 'relative',
                                backgroundColor: layout.texts?.[id] ? (c === 2 ? '#059669' : '#ef4444') : 'transparent',
                                color: layout.texts?.[id] ? 'transparent' : '#94a3b8'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateChecklistSelection(r, c, !layout.texts?.[id]);
                              }}
                            >
                              {layout.texts?.[id] ? <span className="absolute inset-0 flex items-center justify-center text-white">{'\u2714'}</span> : null}
                              {layout.texts?.[id] ? '\u2714' : ''}
                            </button>
                          ) : (
                            <EditableContent
                              className="min-h-[34px] p-2 text-[10px] outline-none"
                              value={layout.texts?.[id] || fallback}
                              onLiveChange={(value) => {
                                if (c === 0) {
                                  if (row.kind === 'comp' && row.competencyIndex !== undefined) updateChecklistCompetencyName(row.competencyIndex, value || `COMPETENCIA ${row.comp}`);
                                  if (row.kind === 'cap' && row.competencyIndex !== undefined && row.capacityIndex !== undefined) updateChecklistCapacityName(row.competencyIndex, row.capacityIndex, value || `CAPACIDAD ${row.cap}`);
                                }
                                if (row.kind === 'crit' && c === 1 && row.competencyIndex !== undefined && row.capacityIndex !== undefined && row.criterionIndex !== undefined) {
                                  updateChecklistCriterionName(row.competencyIndex, row.capacityIndex, row.criterionIndex, value || `Criterio ${row.criterionIndex + 1}`);
                                }
                                setLayoutText(r, c, value);
                              }}
                              onCommit={(value) => {
                                if (c === 0) {
                                  if (row.kind === 'comp' && row.competencyIndex !== undefined) updateChecklistCompetencyName(row.competencyIndex, value || `COMPETENCIA ${row.comp}`);
                                  if (row.kind === 'cap' && row.competencyIndex !== undefined && row.capacityIndex !== undefined) updateChecklistCapacityName(row.competencyIndex, row.capacityIndex, value || `CAPACIDAD ${row.cap}`);
                                }
                                if (row.kind === 'crit' && c === 1 && row.competencyIndex !== undefined && row.capacityIndex !== undefined && row.criterionIndex !== undefined) {
                                  updateChecklistCriterionName(row.competencyIndex, row.capacityIndex, row.criterionIndex, value || `Criterio ${row.criterionIndex + 1}`);
                                }
                                setLayoutText(r, c, value);
                              }}
                              style={{
                                color: cellStyle.color,
                                fontWeight: cellStyle.bold ? 800 : (row.kind !== 'crit' ? 700 : 500),
                                fontStyle: cellStyle.italic ? 'italic' : 'normal',
                                textAlign: cellStyle.align,
                                textDecoration: cellStyle.underline ? 'underline' : 'none',
                                ...getOrientationStyle(cellStyle.orientation),
                                ...getOrientationBoxStyle(cellStyle.orientation, layout.texts?.[id] || fallback)
                              }}
                            />
                          )}
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
            <div key={`sum-comp-edit-${comp.id}`} className="space-y-1 rounded-xl border border-emerald-200/70 bg-white/70 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="font-black text-emerald-900 min-w-[150px]">{comp.title}</span>
                <span className="font-black tracking-tight" style={{ color: comp.levelColor }}>{comp.bar}</span>
                <span className="font-bold text-slate-700">{comp.pct}%</span>
                <span className="font-black" style={{ color: comp.levelColor }}>[{comp.level}]</span>
              </div>
              {comp.capacities.map((cap: any) => (
                <div key={`sum-cap-edit-${cap.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1">
                  <span className="font-black text-slate-700 min-w-[120px]">{cap.title}</span>
                  <span className="font-black tracking-tight" style={{ color: cap.levelColor }}>{cap.bar}</span>
                  <span className="font-bold text-slate-700">{cap.pct}%</span>
                  <span className="font-black" style={{ color: cap.levelColor }}>[{cap.level}]</span>
                </div>
              ))}
            </div>
          ))}
          <div className="pt-2 border-t border-emerald-200 font-black text-slate-800">
            NIVEL FINAL GENERAL -&gt; {checklistSummary.finalPct}% <span style={{ color: checklistSummary.finalLevelColor }}>[{checklistSummary.finalLevel}]</span>
          </div>
        </div>
      </div>
    );
  }

  if (editor.type === 'escala_valoracion') {
    const scaleShape = getScaleShape(editor.structure);
    const scaleBodyRows = buildScaleBodyRows(editor.structure);
    const scaleCompetencySummaries = getScaleCompetencySummariesDetailed(editor.structure, layout.texts || {}, layout);
    const getEditorScaleMergeAt = (r: number, c: number) =>
      (layout.merges || []).find((m: LayoutMerge) => r >= m.sr && r <= m.er && c >= m.sc && c <= m.ec);

    return (
      <div className="overflow-hidden p-3 space-y-3" onClick={closeFormatPopovers}>
        <p className="text-[10px] font-bold text-black uppercase">Tabla editable de escala de valoración (clic derecho para formato)</p>
        <div className="rounded-2xl overflow-hidden border border-slate-300 bg-white">
          <table className="w-full table-fixed text-[10px] border-separate border-spacing-0">
            <tbody>
              {Array.from({ length: scaleShape.rows }).map((_, r) => (
                <tr key={`scale-edit-r-${r}`}>
                  {Array.from({ length: scaleShape.cols }).map((_, c) => {
                    if (isLayoutCovered(r, c)) return null;
                    const id = layoutCellId(r, c);
                    const cellStyle = layout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                    const merge = getEditorScaleMergeAt(r, c);
                    const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                    const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                    const fallback = getScaleFallbackText(editor.structure, r, c);
                    const isHeader = r <= 1;
                    const bodyRow = r >= 2 ? scaleBodyRows[r - 2] : null;
                    const isScaleLevelCell = bodyRow?.kind === 'crit' && c >= 2;
                    const currentScaleLevel = isScaleLevelCell && String(layout.texts?.[id] || '') === getScaleLevelForColumn(editor.structure, c);
                    const inheritedLevelBg = c >= 2 ? getScaleLevelHeaderColor(layout, editor.structure, c) : '#0f172a';
                    const resolvedBg = isScaleLevelCell && currentScaleLevel
                      ? inheritedLevelBg
                      : isHeader
                        ? (cellStyle.bg === '#ffffff' ? inheritedLevelBg : cellStyle.bg)
                        : cellStyle.bg;
                    const resolvedColor = isScaleLevelCell && currentScaleLevel
                      ? '#ffffff'
                      : isHeader
                        ? '#ffffff'
                        : (cellStyle.color || '#334155');
                    const width = c === 0 ? '3.5%' : c === 1 ? '18.5%' : `${78 / Math.max(scaleShape.cols - 2, 1)}%`;
                    return (
                      <td
                        key={`scale-edit-c-${r}-${c}`}
                        rowSpan={rowSpan}
                        colSpan={colSpan}
                        className={`border p-0 ${inLayoutSelection(r, c) ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                        style={{ width, ...getCellBorderStyle(cellStyle, '#bfc8d4'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: resolvedBg, borderColor: cellStyle.borderColor || '#bfc8d4' }}
                        onMouseDown={() => onLayoutCellMouseDown(r, c)}
                        onMouseEnter={() => onLayoutCellEnter(r, c)}
                        onContextMenu={(e) => onLayoutCellContext(e, r, c)}
                      >
                        {isScaleLevelCell ? (
                          <button
                            type="button"
                            className="flex min-h-[36px] w-full items-center justify-center bg-transparent text-[12px] font-black"
                            style={{ position: 'relative', color: currentScaleLevel ? 'transparent' : '#94a3b8' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateScaleLevelSelection(r, c, !currentScaleLevel);
                            }}
                          >
                            {currentScaleLevel ? <span className="absolute inset-0 flex items-center justify-center text-white">{'\u2714'}</span> : null}
                            {currentScaleLevel ? '\u2714' : ''}
                          </button>
                        ) : (
                          <EditableContent
                            className={`min-h-[36px] p-2 text-[10px] outline-none ${(bodyRow?.kind === 'comp' || bodyRow?.kind === 'cap') ? 'uppercase' : ''}`}
                            value={layout.texts?.[id] || fallback}
                            onLiveChange={(value) => {
                              if (r === 1 && c >= 2) updateScaleLabel(c - 2, value || getScaleLevelForColumn(editor.structure, c));
                              if (bodyRow?.kind === 'comp' && bodyRow.competencyIndex !== undefined) updateScaleCompetencyName(bodyRow.competencyIndex, value || `Competencia ${bodyRow.comp}`);
                              if (bodyRow?.kind === 'cap' && bodyRow.competencyIndex !== undefined && bodyRow.capacityIndex !== undefined) updateScaleCapacityName(bodyRow.competencyIndex, bodyRow.capacityIndex, value || `Capacidad ${bodyRow.cap}`);
                              if (bodyRow?.kind === 'crit' && c === 1 && bodyRow.competencyIndex !== undefined && bodyRow.capacityIndex !== undefined && bodyRow.criterionIndex !== undefined) updateScaleCriterionName(bodyRow.competencyIndex, bodyRow.capacityIndex, bodyRow.criterionIndex, value || `Criterio ${bodyRow.criterionIndex + 1}`);
                              setLayoutText(r, c, value);
                            }}
                            onCommit={(value) => {
                              if (r === 1 && c >= 2) updateScaleLabel(c - 2, value || getScaleLevelForColumn(editor.structure, c));
                              if (bodyRow?.kind === 'comp' && bodyRow.competencyIndex !== undefined) updateScaleCompetencyName(bodyRow.competencyIndex, value || `Competencia ${bodyRow.comp}`);
                              if (bodyRow?.kind === 'cap' && bodyRow.competencyIndex !== undefined && bodyRow.capacityIndex !== undefined) updateScaleCapacityName(bodyRow.competencyIndex, bodyRow.capacityIndex, value || `Capacidad ${bodyRow.cap}`);
                              if (bodyRow?.kind === 'crit' && c === 1 && bodyRow.competencyIndex !== undefined && bodyRow.capacityIndex !== undefined && bodyRow.criterionIndex !== undefined) updateScaleCriterionName(bodyRow.competencyIndex, bodyRow.capacityIndex, bodyRow.criterionIndex, value || `Criterio ${bodyRow.criterionIndex + 1}`);
                              setLayoutText(r, c, value);
                            }}
                            style={{
                              color: resolvedColor,
                              fontWeight: cellStyle.bold ? 800 : (isHeader || bodyRow?.kind === 'comp' || bodyRow?.kind === 'cap' ? 700 : 500),
                              fontStyle: cellStyle.italic ? 'italic' : 'normal',
                              textAlign: bodyRow?.kind === 'crit' && c === 1 ? 'left' : cellStyle.align,
                              textDecoration: cellStyle.underline ? 'underline' : 'none',
                              ...getOrientationStyle(cellStyle.orientation),
                              ...getOrientationBoxStyle(cellStyle.orientation, layout.texts?.[id] || fallback)
                            }}
                          />
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
            <div key={`scale-summary-edit-${summary.competencyIndex}`} className="space-y-1 rounded-xl border border-emerald-200/70 bg-white/70 px-3 py-2">
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
                <div key={`scale-cap-edit-${summary.competencyIndex}-${capacity.capacityIndex}`} className="flex items-center gap-3 rounded-lg px-2 py-1">
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

  if (editor.type === 'guia_observacion') {
    const guideShape = getGuideShape(editor.structure);
    const guideWidths = getGuideColumnWidths(editor.structure);
    const guideCapacityBlocks = getGuideCapacityBlocks(editor.structure);
    const guideCriterionBlocks = getGuideCriterionBlocks(editor.structure);
    const guideSummaries = getGuideSummaries(editor.structure, layout.texts || {});
    const guideLevelColorMap = new Map(GUIDE_LEVELS.map((level, idx) => [level, GUIDE_LEVEL_COLORS[idx] || GUIDE_LEVEL_COLORS[0]]));
    return (
      <div className="overflow-hidden p-3 space-y-3" onClick={closeFormatPopovers}>
        <p className="text-[10px] font-bold text-slate-500 uppercase">Tabla editable de guía de observación (clic derecho para formato)</p>
        <div className="rounded-2xl overflow-hidden border border-violet-700">
          <table className="w-full table-fixed border-separate border-spacing-0">
            <colgroup>
              <col style={{ width: guideWidths.num }} />
              <col style={{ width: guideWidths.name }} />
              {Array.from({ length: Math.max(guideShape.cols - 3, 0) }).map((_, idx) => (
                <col key={`guide-edit-col-level-${idx}`} style={{ width: ((idx + 1) % GUIDE_LEVELS.length === 0) ? guideWidths.levelWide : guideWidths.level }} />
              ))}
              <col style={{ width: guideWidths.logro }} />
            </colgroup>
            <tbody>
              {Array.from({ length: guideShape.rows }).map((__, r) => (
                <tr key={`guide-edit-r-${r}`}>
                  {Array.from({ length: guideShape.cols }).map((_, c) => {
                    if (isLayoutCovered(r, c)) return null;
                    const id = layoutCellId(r, c);
                    const cellStyle = layout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                    const merge = findLayoutMergeAt(r, c);
                    const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                    const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                    const isHeader = r <= 3;
                    const isGuideLevelCell = r >= 4 && c >= 2 && c < guideShape.cols - 1;
                    const capacityBlockIndex = r === 1 ? guideCapacityBlocks.findIndex((block) => block.startCol === c) : -1;
                    const criterionBlockIndex = r === 2 ? guideCriterionBlocks.findIndex((block) => block.startCol === c) : -1;
                    const capacityBlock = capacityBlockIndex >= 0 ? guideCapacityBlocks[capacityBlockIndex] : null;
                    const criterionBlock = criterionBlockIndex >= 0 ? guideCriterionBlocks[criterionBlockIndex] : null;
                    const currentGuideLevel = String(layout.texts?.[id] || '') === getGuideLevelForColumn(c);
                    const rowAverage = r >= 4 && c === guideShape.cols - 1 ? getGuideRowAverage(layout.texts || {}, r, guideShape.cols) : '';
                    const rowAverageIsLevel = GUIDE_LEVELS.includes(rowAverage as any);
                    return (
                      <td
                        key={`guide-edit-c-${r}-${c}`}
                        rowSpan={rowSpan}
                        colSpan={colSpan}
                        className={`p-0 ${inLayoutSelection(r, c) ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                        style={{ ...getCellBorderStyle(cellStyle, isHeader ? '#ffffff' : '#6b21a8'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: isGuideLevelCell && currentGuideLevel ? (guideLevelColorMap.get(getGuideLevelForColumn(c)) || cellStyle.bg) : (r >= 4 && c === guideShape.cols - 1 ? (rowAverageIsLevel ? (guideLevelColorMap.get(rowAverage) || cellStyle.bg) : (rowAverage ? '#e2e8f0' : cellStyle.bg)) : (isHeader ? (cellStyle.bg === '#ffffff' ? '#6d28d9' : cellStyle.bg) : cellStyle.bg)) }}
                        onMouseDown={() => onLayoutCellMouseDown(r, c)}
                        onMouseEnter={() => onLayoutCellEnter(r, c)}
                        onContextMenu={(e) => onLayoutCellContext(e, r, c)}
                      >
                        {isGuideLevelCell ? (
                          <button
                            type="button"
                            className="flex min-h-[32px] w-full items-center justify-center bg-transparent text-[12px] font-black"
                            style={{
                              position: 'relative',
                              color: currentGuideLevel ? 'transparent' : '#94a3b8'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateGuideLevelSelection(r, c, !currentGuideLevel);
                            }}
                          >
                            {currentGuideLevel ? <span className="absolute inset-0 flex items-center justify-center text-white">{'\u2714'}</span> : null}
                            {currentGuideLevel ? '\u2714' : ''}
                          </button>
                        ) : (r >= 4 && c === guideShape.cols - 1) ? (
                          <div className={`flex min-h-[32px] items-center justify-center px-1 text-[9px] font-black ${rowAverageIsLevel ? 'text-white' : (rowAverage ? 'text-slate-600' : 'text-slate-500')}`}>
                            {rowAverage}
                          </div>
                        ) : (
                          <div
                            className="min-h-[28px] p-1 text-[9px] outline-none"
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => {
                              const value = (e.currentTarget.innerText || '').trim();
                              if (capacityBlock) {
                                updateGuideCapacityNameByFlatIndex(capacityBlockIndex, value || `CAPACIDAD ${capacityBlock.capacityIndex + 1}`);
                              }
                              if (criterionBlock) {
                                updateGuideCriterionNameByFlatIndex(criterionBlockIndex, value || `Criterio ${criterionBlock.criterionIndex + 1}`);
                              }
                              setLayoutText(r, c, value);
                            }}
                            style={{
                              color: isHeader ? (cellStyle.color === '#0f172a' ? '#ffffff' : cellStyle.color) : cellStyle.color,
                              fontWeight: cellStyle.bold ? 800 : (isHeader ? 700 : 500),
                              fontStyle: cellStyle.italic ? 'italic' : 'normal',
                              textAlign: cellStyle.align,
                              textDecoration: cellStyle.underline ? 'underline' : 'none',
                              whiteSpace: c === guideShape.cols - 1 ? 'normal' : 'nowrap',
                              wordBreak: c === guideShape.cols - 1 ? 'keep-all' : 'normal',
                              overflowWrap: c === guideShape.cols - 1 ? 'normal' : 'anywhere',
                              lineHeight: c === guideShape.cols - 1 ? 1.1 : undefined,
                              ...getOrientationStyle(cellStyle.orientation),
                              ...getOrientationBoxStyle(cellStyle.orientation, layout.texts?.[id] || getGuideFallbackText(editor.structure, r, c))
                            }}
                          >
                            <span title={criterionBlock?.criterionLabel || undefined}>{layout.texts?.[id] || getGuideFallbackText(editor.structure, r, c)}</span>
                          </div>
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
            <div key={`guide-summary-edit-${summary.competencyIndex}`} className="space-y-1 rounded-xl border border-emerald-200/70 bg-white/70 px-3 py-2">
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
                <div key={`guide-cap-edit-${summary.competencyIndex}-${capacity.capacityIndex}`} className="flex items-center gap-3 rounded-lg px-2 py-1">
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
  }

  return (
    <div className="overflow-auto p-3" onClick={closeFormatPopovers}>
      <table className="min-w-[680px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="w-10 bg-slate-800 text-white text-[9px] font-black border border-slate-700">#</th>
            {Array.from({ length: layout.cols }).map((_, c) => (
              <th
                key={`layout-col-${c}`}
                className="w-32 bg-slate-800 text-white text-[9px] font-black border border-slate-700 p-2"
                onMouseDown={() => setLayoutSelection({ sr: 0, sc: c, er: layout.rows - 1, ec: c })}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (layoutDragTool === 'col') insertLayoutCol(c + 1);
                  setLayoutDragTool(null);
                }}
              >
                {String.fromCharCode(65 + (c % 26))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: layout.rows }).map((_, r) => (
            <tr key={`layout-row-${r}`}>
              <td
                className="bg-slate-50 text-slate-500 text-[9px] font-black border border-slate-200 text-center"
                onMouseDown={() => setLayoutSelection({ sr: r, sc: 0, er: r, ec: layout.cols - 1 })}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (layoutDragTool === 'row') insertLayoutRow(r + 1);
                  setLayoutDragTool(null);
                }}
              >
                {r + 1}
              </td>
              {Array.from({ length: layout.cols }).map((__, c) => {
                if (isLayoutCovered(r, c)) return null;
                const id = layoutCellId(r, c);
                const cellStyle = layout.styles?.[id] || DEFAULT_LAYOUT_STYLE;
                const merge = findLayoutMergeAt(r, c);
                const rowSpan = merge && merge.sr === r && merge.sc === c ? merge.er - merge.sr + 1 : 1;
                const colSpan = merge && merge.sr === r && merge.sc === c ? merge.ec - merge.sc + 1 : 1;
                return (
                  <td
                    key={id}
                    rowSpan={rowSpan}
                    colSpan={colSpan}
                    className={`border border-slate-200 p-0 ${inLayoutSelection(r, c) ? 'ring-2 ring-emerald-400 ring-inset' : ''}`}
                    style={{ ...getCellBorderStyle(cellStyle, '#6b21a8'), ...getVerticalAlignStyle(cellStyle.vAlign), backgroundColor: cellStyle.bg }}
                    onMouseDown={() => onLayoutCellMouseDown(r, c)}
                    onMouseEnter={() => onLayoutCellEnter(r, c)}
                    onContextMenu={(e) => onLayoutCellContext(e, r, c)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (layoutDragTool === 'cell') setLayoutSelection({ sr: r, sc: c, er: r, ec: c });
                      setLayoutDragTool(null);
                    }}
                  >
                    <div
                      className="min-h-[46px] p-2 text-[10px] outline-none"
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => setLayoutText(r, c, e.currentTarget.innerText || '')}
                      style={{
                        color: cellStyle.color,
                        fontWeight: cellStyle.bold ? 800 : 500,
                        fontStyle: cellStyle.italic ? 'italic' : 'normal',
                        textAlign: cellStyle.align,
                        textDecoration: cellStyle.underline ? 'underline' : 'none',
                        ...getOrientationStyle(cellStyle.orientation),
                        ...getOrientationBoxStyle(cellStyle.orientation, layout.texts?.[id] || '')
                      }}
                    >
                      {layout.texts?.[id] || ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
