import React from 'react';
import {
    TEMPLATE_GUIDE_LEVELS,
    autoResizeTextarea,
    buildChecklistVisualRowsForTemplate,
    buildScaleVisualRowsForTemplate,
    buildTemplateTextOverridesFromRows,
    detectInstrumentTypeFromText,
    getGuideColumnWidthsFromTemplate,
    getScaleLabelsForTemplate,
    getTemplateCellStyle,
    getTemplateFallbackText,
    getTemplateOrientationBoxStyle,
    getTemplateOrientationStyle,
    layoutCellId,
    normalizeLoose
} from './shared';

type SessionInstrumentPreviewProps = {
    sessionData: any;
    instrumentType: string;
    canonicalInstrumentRows: any[];
    assessmentTemplateModel: any;
    checklistLevelMapping: {
        positiveLabel: string;
        negativeLabel: string;
        positiveLevel: string;
        negativeLevel: string;
    };
    gradingCriteriaRows: any[];
    gradingGuideLevels: any[];
    handleInputChange: (path: string, value: any) => void;
    getTransversalSurfaceStyle: (
        color: string,
        alpha?: number
    ) => React.CSSProperties;
    fallback?: React.ReactNode;
};

export const SessionInstrumentPreview: React.FC<SessionInstrumentPreviewProps> = ({
    sessionData,
    instrumentType,
    canonicalInstrumentRows,
    assessmentTemplateModel,
    checklistLevelMapping,
    gradingCriteriaRows,
    gradingGuideLevels,
    handleInputChange,
    getTransversalSurfaceStyle,
    fallback = null
}) => {
    const renderInstrumentTemplateTable = () => {
        const template = sessionData?.instrumentoTemplate;
        const layout = template?.structure?.layout;
        const templateType = String(
            detectInstrumentTypeFromText(String(template?.type || ''))
            || detectInstrumentTypeFromText(String(template?.name || ''))
            || template?.type
            || ''
        );
        const instrumentRows = canonicalInstrumentRows;
        const desiredCriteriaCount = Math.max(4, instrumentRows.length);
        const textOverrides = buildTemplateTextOverridesFromRows(template, instrumentRows);
        const rows = Math.max(0, Number(layout?.rows || 0));
        const cols = Math.max(0, Number(layout?.cols || 0));
        if (!layout || rows <= 0 || cols <= 0) return null;

        const merges = Array.isArray(layout?.merges) ? layout.merges : [];
        const texts = layout?.texts && typeof layout.texts === 'object' ? layout.texts : {};
        const styles = layout?.styles && typeof layout.styles === 'object' ? layout.styles : {};

        const getMergeAtOrigin = (r: number, c: number) =>
            merges.find((m: any) => Number(m?.sr) === r && Number(m?.sc) === c);
        const isCoveredByOtherMerge = (r: number, c: number) =>
            merges.some((m: any) =>
                Number.isFinite(Number(m?.sr)) &&
                Number.isFinite(Number(m?.sc)) &&
                Number.isFinite(Number(m?.er)) &&
                Number.isFinite(Number(m?.ec)) &&
                r >= Number(m.sr) && r <= Number(m.er) &&
                c >= Number(m.sc) && c <= Number(m.ec) &&
                !(r === Number(m.sr) && c === Number(m.sc))
            );

        if (templateType === 'lista_cotejo') {
            const checklistLayout = layout || {};
            const checklistMerges = Array.isArray(checklistLayout?.merges) ? checklistLayout.merges : [];
            const checklistTexts = checklistLayout?.texts && typeof checklistLayout.texts === 'object' ? checklistLayout.texts : {};
            const checklistStyles = checklistLayout?.styles && typeof checklistLayout.styles === 'object' ? checklistLayout.styles : {};
            const checklistRows = buildChecklistVisualRowsForTemplate(template?.structure || {}, assessmentTemplateModel);
            const checklistExpectedLabel = template?.structure?.expectedLabel;
            const checklistOptionPreset = checklistExpectedLabel && typeof checklistExpectedLabel === 'object' && String(checklistExpectedLabel.mode || '').trim().toLowerCase() === 'custom'
                ? {
                    positive: String(checklistExpectedLabel.positive || 'Opción 1').trim() || 'Opción 1',
                    negative: String(checklistExpectedLabel.negative || 'Opción 2').trim() || 'Opción 2'
                }
                : String(checklistExpectedLabel || '').trim().toLowerCase() === 'cumple_no_cumple'
                    ? { positive: 'Cumple', negative: 'No cumple' }
                    : String(checklistExpectedLabel || '').trim().toLowerCase() === 'logrado_no_logrado'
                        ? { positive: 'Logrado', negative: 'No logrado' }
                        : { positive: 'Sí', negative: 'No' };

            const findChecklistMergeAt = (r: number, c: number) =>
                checklistMerges.find((m: any) => r >= Number(m?.sr) && r <= Number(m?.er) && c >= Number(m?.sc) && c <= Number(m?.ec));
            const isChecklistCovered = (r: number, c: number) => {
                const row = checklistRows[r - 1];
                if (row && row.kind !== 'crit' && c > 0) return true;
                const m = findChecklistMergeAt(r, c);
                return !!m && !(Number(m.sr) === r && Number(m.sc) === c);
            };

            const headerDefaults = ['N°', 'CRITERIOS OBSERVABLES', checklistOptionPreset.positive.toUpperCase(), checklistOptionPreset.negative.toUpperCase(), 'OBSERVACIONES'];
            let runningN = 1;
            let runningCriterionIndex = -1;
            const updateChecklistRow = (rowIndex: number, patch: Record<string, string>) => {
                const currentRows = Array.isArray(sessionData?.instrumento) ? [...sessionData.instrumento] : [];
                const current = currentRows[rowIndex] || { id: rowIndex + 1, criterio: '', c: '', b: '', a: '', ad: '' };
                currentRows[rowIndex] = { ...current, ...patch };
                handleInputChange('instrumento', currentRows);
            };

            return (
                <table className="w-full table-fixed border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '63%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '20%' }} />
                    </colgroup>
                    <thead>
                        <tr>
                            {Array.from({ length: 5 }).map((_, c) => {
                                const id = layoutCellId(0, c);
                                const cellStyle = checklistStyles[id] || {};
                                const text = String(textOverrides[id] || checklistTexts[id] || headerDefaults[c] || '');
                                const style = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...style,
                                    backgroundColor: !cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff' ? '#059669' : style.backgroundColor,
                                    color: !cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a' ? '#ffffff' : style.color
                                };
                                return (
                                    <th key={`check-head-${c}`} className="p-2 text-left font-black" style={resolvedStyle}>
                                        {text}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {checklistRows.map((row, idx) => {
                            const r = idx + 1;
                            const n = runningN;
                            if (row.kind === 'crit') runningN += 1;
                            if (row.kind === 'crit') runningCriterionIndex += 1;
                            const criterionIndex = row.kind === 'crit' ? runningCriterionIndex : -1;
                            const criterionRowData = criterionIndex >= 0
                                ? (instrumentRows[criterionIndex] || { id: criterionIndex + 1, criterio: row.text || '', c: '', b: '', a: '', ad: '' })
                                : null;
                            const isTransversalRow = String(row?.source || '').trim() === 'transversal';
                            const rowClassName = row.kind === 'comp'
                                ? (isTransversalRow ? 'bg-emerald-700/90 text-white' : 'bg-slate-200/90 text-slate-900')
                                : row.kind === 'cap'
                                    ? (isTransversalRow ? 'bg-emerald-100/70 text-emerald-950' : 'bg-slate-100/90 text-slate-800')
                                    : (isTransversalRow ? 'bg-emerald-50/40' : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'));
                            return (
                                <tr key={`check-row-${r}`} className={rowClassName}>
                                    {Array.from({ length: 5 }).map((_, c) => {
                                        if (isChecklistCovered(r, c)) return null;
                                        const id = layoutCellId(r, c);
                                        const cellStyle = checklistStyles[id] || {};
                                        const merge = findChecklistMergeAt(r, c);
                                        const rowSpan = merge && Number(merge.sr) === r && Number(merge.sc) === c ? Number(merge.er) - Number(merge.sr) + 1 : 1;
                                        const colSpan = row.kind !== 'crit'
                                            ? 5
                                            : (merge && Number(merge.sr) === r && Number(merge.sc) === c ? Number(merge.ec) - Number(merge.sc) + 1 : 1);

                                        let fallback = '';
                                        if (c === 0) fallback = row.kind === 'crit' ? String(n) : row.text;
                                        if (c === 1) fallback = row.text;
                                        if (c === 4 && row.kind === 'crit') fallback = '-';
                                        if (row.kind !== 'crit' && c === 0 && colSpan > 1 && !checklistTexts[id]) fallback = row.text;

                                        const value = String(checklistTexts[id] || fallback || '');
                                        const resolvedValue = row.kind === 'crit'
                                            ? c === 1
                                                ? String(criterionRowData?.criterio || fallback || '')
                                                : c === 4
                                                    ? String(criterionRowData?.ad || '')
                                                    : String(fallback || '')
                                            : String(textOverrides[id] || value || '');
                                        const orientation = String(cellStyle?.orientation || 'normal');
                                        const style = getTemplateCellStyle(cellStyle);
                                        const groupCellStyle: React.CSSProperties = row.kind === 'comp'
                                            ? {
                                                backgroundColor: isTransversalRow ? 'rgba(4, 120, 87, 0.88)' : 'rgba(148, 163, 184, 0.92)',
                                                color: isTransversalRow ? '#ffffff' : '#0f172a'
                                            }
                                            : row.kind === 'cap'
                                                ? {
                                                    backgroundColor: isTransversalRow ? 'rgba(209, 250, 229, 0.95)' : 'rgba(241, 245, 249, 0.96)',
                                                    color: isTransversalRow ? '#064e3b' : '#334155'
                                                }
                                                : {};

                                        return (
                                            <td key={`check-cell-${r}-${c}`} rowSpan={rowSpan} colSpan={colSpan} className="p-2" style={{ ...style, ...groupCellStyle }}>
                                                {row.kind === 'crit' && (c === 2 || c === 3)
                                                    ? (
                                                        <div className="flex items-center justify-center">
                                                            <input
                                                                type="checkbox"
                                                                className="h-4 w-4 accent-emerald-600"
                                                                checked={false}
                                                                readOnly
                                                                disabled
                                                                aria-label={`${checklistLevelMapping.positiveLabel} (${checklistLevelMapping.positiveLevel.toUpperCase()})`}
                                                            />
                                                        </div>
                                                    )
                                                    : row.kind === 'crit' && c === 4
                                                        ? (
                                                            <textarea
                                                                className="w-full min-h-[34px] resize-none border-0 bg-transparent p-1.5 outline-none text-[10px]"
                                                                value={resolvedValue}
                                                                onInput={e => autoResizeTextarea(e.currentTarget)}
                                                                onChange={e => {
                                                                    if (criterionIndex < 0) return;
                                                                    updateChecklistRow(criterionIndex, { ad: e.target.value });
                                                                }}
                                                                placeholder="Observaciones..."
                                                            />
                                                        )
                                                        : row.kind === 'crit' && c === 1
                                                            ? (
                                                                <textarea
                                                                    className="w-full min-h-[34px] resize-none border-0 bg-transparent p-1.5 outline-none text-[10px] font-medium"
                                                                    value={resolvedValue}
                                                                    onInput={e => autoResizeTextarea(e.currentTarget)}
                                                                    onChange={e => {
                                                                        if (criterionIndex < 0) return;
                                                                        updateChecklistRow(criterionIndex, { criterio: e.target.value });
                                                                    }}
                                                                    placeholder="Criterio..."
                                                                />
                                                            )
                                                    : (
                                                        <div
                                                            className={`whitespace-pre-wrap break-words leading-tight min-h-[18px] ${row.kind === 'comp' ? 'font-black uppercase tracking-wide text-left' : row.kind === 'cap' ? 'font-bold text-left' : ''}`}
                                                            style={{
                                                                ...getTemplateOrientationBoxStyle(orientation, resolvedValue),
                                                                ...getTemplateOrientationStyle(row.kind !== 'crit' ? 'normal' : orientation),
                                                                ...(row.kind !== 'crit' ? { textAlign: 'left', justifyContent: 'flex-start', alignItems: 'flex-start' } : {})
                                                            }}
                                                        >
                                                            {resolvedValue}
                                                        </div>
                                                    )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            );
        }

        if (templateType === 'escala_valoracion') {
            const scaleLayout = layout || {};
            const scaleStyles = scaleLayout?.styles && typeof scaleLayout.styles === 'object' ? scaleLayout.styles : {};
            const scaleLabels = getScaleLabelsForTemplate(template?.structure || {});
            const resolvedScaleLabels = scaleLabels.length > 0 ? scaleLabels : ['Deficiente', 'Regular', 'Bueno', 'Muy bueno'];
            const scaleBodyRows = buildScaleVisualRowsForTemplate(template?.structure || {}, assessmentTemplateModel);
            let runningCriterionIndex = -1;

            return (
                <table className="w-full table-fixed border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '38%' }} />
                        {resolvedScaleLabels.map((_: any, idx: number) => (
                            <col key={`scale-col-${idx}`} style={{ width: `${56 / Math.max(resolvedScaleLabels.length, 1)}%` }} />
                        ))}
                    </colgroup>
                    <tbody>
                        <tr>
                            {(() => {
                                const cellStyle = scaleStyles[layoutCellId(0, 0)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? '#0f172a' : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td rowSpan={2} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        N°
                                    </td>
                                );
                            })()}
                            {(() => {
                                const cellStyle = scaleStyles[layoutCellId(0, 1)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? '#0f172a' : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td rowSpan={2} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        CRITERIOS
                                    </td>
                                );
                            })()}
                            {(() => {
                                const cellStyle = scaleStyles[layoutCellId(0, 2)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? '#0f172a' : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td colSpan={resolvedScaleLabels.length} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        Niveles de logro
                                    </td>
                                );
                            })()}
                        </tr>
                        <tr>
                            {resolvedScaleLabels.map((label: string, idx: number) => {
                                const c = idx + 2;
                                const cellStyle = scaleStyles[layoutCellId(1, c)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const palette = ['#ef1c24', '#f77b28', '#28a745', '#19b8cf'];
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? (palette[idx] || '#0f172a') : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td key={`scale-head-${idx}`} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        {label}
                                    </td>
                                );
                            })}
                        </tr>
                        {scaleBodyRows.map((bodyRow, idx) => {
                            const r = idx + 2;
                            if (bodyRow.kind === 'comp' || bodyRow.kind === 'cap') {
                                const cellStyle = scaleStyles[layoutCellId(2, 0)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: bodyRow.kind === 'comp' ? '#e2e8f0' : '#f8fafc',
                                    color: '#0f172a',
                                    fontWeight: 700,
                                    textAlign: 'left',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <tr key={`scale-body-${r}`}>
                                        <td colSpan={resolvedScaleLabels.length + 2} className="p-2 align-middle" style={resolvedStyle}>
                                            {bodyRow.text}
                                        </td>
                                    </tr>
                                );
                            }

                            runningCriterionIndex += 1;
                            const criterionIndex = runningCriterionIndex;
                            const criterionRowData = instrumentRows[criterionIndex] || {
                                id: criterionIndex + 1,
                                criterio: bodyRow.text || '',
                                c: '',
                                b: '',
                                a: '',
                                ad: ''
                            };

                            return (
                                <tr key={`scale-body-${r}`}>
                                    <td className="p-2 text-center align-middle" style={getTemplateCellStyle(scaleStyles[layoutCellId(2, 0)] || {})}>
                                        {scaleBodyRows
                                            .slice(0, idx)
                                            .filter((item: any) => item.kind === 'crit' && item.comp === bodyRow.comp && item.cap === bodyRow.cap).length + 1}
                                    </td>
                                    <td className="p-2 align-middle" style={{ ...getTemplateCellStyle(scaleStyles[layoutCellId(2, 1)] || {}), textAlign: 'left' }}>
                                        <textarea
                                            className="w-full min-h-[34px] resize-none border-0 bg-transparent p-1.5 outline-none text-[10px] font-medium"
                                            value={String(criterionRowData?.criterio || bodyRow.text || '')}
                                            onInput={e => autoResizeTextarea(e.currentTarget)}
                                            onChange={e => {
                                                const currentRows = Array.isArray(sessionData?.instrumento) ? [...sessionData.instrumento] : [];
                                                const current = currentRows[criterionIndex] || { id: criterionIndex + 1, criterio: '', c: '', b: '', a: '', ad: '' };
                                                currentRows[criterionIndex] = { ...current, criterio: e.target.value };
                                                handleInputChange('instrumento', currentRows);
                                            }}
                                            placeholder="Criterio..."
                                        />
                                    </td>
                                    {resolvedScaleLabels.map((_: any, idxLabel: number) => (
                                        <td
                                            key={`scale-crit-${criterionIndex}-${idxLabel}`}
                                            className="p-2 align-middle"
                                            style={getTemplateCellStyle(scaleStyles[layoutCellId(2, idxLabel + 2)] || {})}
                                        />
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            );
        }

        if (templateType === 'rubrica') {
            const updateRubricaRow = (rowIndex: number, patch: Record<string, string>) => {
                const currentRows = Array.isArray(sessionData?.instrumento) ? [...sessionData.instrumento] : [];
                const current = currentRows[rowIndex] || { id: rowIndex + 1, criterio: '', c: '', b: '', a: '', ad: '' };
                currentRows[rowIndex] = { ...current, ...patch, id: rowIndex + 1 };
                handleInputChange('instrumento', currentRows);
            };

            const rubricRows = instrumentRows.length > 0
                ? instrumentRows
                : Array.from({ length: 4 }, (_, idx) => ({ id: idx + 1, criterio: '', c: '', b: '', a: '', ad: '' }));

            return (
                <table className="w-full table-fixed border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '19%' }} />
                        <col style={{ width: '18.25%' }} />
                        <col style={{ width: '18.25%' }} />
                        <col style={{ width: '18.25%' }} />
                        <col style={{ width: '18.25%' }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th className="border border-white/10 bg-slate-900 p-3 text-center font-black text-white">N°</th>
                            <th className="border border-white/10 bg-slate-900 p-3 text-center font-black text-white">CRITERIO</th>
                            <th className="border border-white/10 bg-red-600 p-3 text-center font-black text-white">C (INICIO)</th>
                            <th className="border border-white/10 bg-orange-500 p-3 text-center font-black text-white">B (EN PROCESO)</th>
                            <th className="border border-white/10 bg-cyan-500 p-3 text-center font-black text-white">A (LOGRADO)</th>
                            <th className="border border-white/10 bg-emerald-500 p-3 text-center font-black text-white">AD (DESTACADO)</th>
                        </tr>
                    </thead>
                        <tbody>
                        {rubricRows.map((row: any, idx: number) => {
                            const isTransversal = String(row?.source || '') === 'transversal';
                            const transversalColor = String(row?.rowColor || '#00b28c');
                            const rowSurfaceStyle = isTransversal ? getTransversalSurfaceStyle(transversalColor, 0.12) : undefined;
                            return (
                            <tr key={`rubrica-template-row-${idx}`} className="align-top">
                                <td className="border border-slate-200 bg-slate-50/50 p-3 text-center font-black text-slate-700" style={rowSurfaceStyle}>
                                    {idx + 1}
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-center text-[10px] font-bold text-slate-800 outline-none"
                                        value={String(row?.criterio || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { criterio: e.target.value })}
                                        placeholder="Defina criterio..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-red-600 outline-none"
                                        value={String(row?.c || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { c: e.target.value })}
                                        placeholder="Descriptor inicio..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-orange-700 outline-none"
                                        value={String(row?.b || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { b: e.target.value })}
                                        placeholder="Descriptor proceso..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-blue-700 outline-none"
                                        value={String(row?.a || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { a: e.target.value })}
                                        placeholder="Descriptor logrado..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-emerald-700 outline-none"
                                        value={String(row?.ad || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { ad: e.target.value })}
                                        placeholder="Descriptor destacado..."
                                    />
                                </td>
                            </tr>
                        )})}
                    </tbody>
                </table>
            );
        }

        const effectiveRows = templateType === 'rubrica'
            ? Math.max(rows, desiredCriteriaCount + 1)
            : templateType === 'guia_observacion'
                ? Math.max(rows, desiredCriteriaCount + 2)
                : rows;

        return (
            <table className="w-full table-fixed border-collapse text-[10px]">
                {templateType === 'guia_observacion' && (
                    <colgroup>
                        {(() => {
                            const w = getGuideColumnWidthsFromTemplate(template?.structure || {});
                            return (
                                <>
                                    <col style={{ width: w.num }} />
                                    <col style={{ width: w.name }} />
                                    {Array.from({ length: Math.max(cols - 3, 0) }).map((_, idx) => (
                                        <col
                                            key={`tpl-guide-col-${idx}`}
                                            style={{ width: ((idx + 1) % TEMPLATE_GUIDE_LEVELS.length === 0) ? w.levelWide : w.level }}
                                        />
                                    ))}
                                    <col style={{ width: w.logro }} />
                                </>
                            );
                        })()}
                    </colgroup>
                )}
                <tbody>
                    {Array.from({ length: effectiveRows }).map((_, r) => (
                        <tr key={`tpl-row-${r}`}>
                            {Array.from({ length: cols }).map((__, c) => {
                                if (isCoveredByOtherMerge(r, c)) return null;
                                const merge = getMergeAtOrigin(r, c);
                                const rowSpan = merge ? Math.max(1, Number(merge.er) - Number(merge.sr) + 1) : 1;
                                const colSpan = merge ? Math.max(1, Number(merge.ec) - Number(merge.sc) + 1) : 1;
                                const id = layoutCellId(r, c);
                                const value = String(textOverrides[id] || texts[id] || getTemplateFallbackText(template, r, c) || '');
                                const baseCellStyle = styles[id] || {};
                                const style = getTemplateCellStyle(baseCellStyle);
                                const orientation = String(baseCellStyle?.orientation || 'normal');

                                const isRubricaHeader = templateType === 'rubrica' && r === 0;
                                const isChecklistHeader = templateType === 'lista_cotejo' && r === 0;
                                const isScaleHeader = templateType === 'escala_valoracion' && r <= 1;
                                const isGuideHeader = templateType === 'guia_observacion' && r <= 1;

                                let resolvedStyle: React.CSSProperties = { ...style };
                                if (isRubricaHeader) {
                                    const palette = ['#ef1c24', '#f77b28', '#28a745', '#84c7d8'];
                                    const defaultBg = c <= 1 ? '#0f172a' : (palette[c - 2] || '#0f172a');
                                    const defaultColor = '#ffffff';
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = defaultBg;
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = defaultColor;
                                } else if (isChecklistHeader) {
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = '#059669';
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = '#ffffff';
                                } else if (isScaleHeader) {
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = '#0f172a';
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = '#ffffff';
                                } else if (isGuideHeader) {
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = '#6d28d9';
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = '#ffffff';
                                }

                                return (
                                    <td key={`tpl-cell-${id}`} rowSpan={rowSpan} colSpan={colSpan} style={resolvedStyle} className="p-2 align-top">
                                        <div
                                            className="whitespace-pre-wrap break-words leading-tight min-h-[18px]"
                                            style={{
                                                ...getTemplateOrientationBoxStyle(orientation, value),
                                                ...getTemplateOrientationStyle(orientation)
                                            }}
                                        >
                                            {value}
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    const renderGuideInstrumentTable = () => {
        if (!gradingCriteriaRows.length) {
            return (
                <div className="p-10 text-center text-slate-400 text-sm font-bold">
                    La guía de observación no tiene criterios cargados.
                </div>
            );
        }

        const groupedCompetencies = gradingCriteriaRows.reduce((acc: any[], row: any) => {
            const competencia = String(row?.competencia || 'Competencia 1').trim() || 'Competencia 1';
            const capacidad = String(row?.capacidad || 'Capacidad 1').trim() || 'Capacidad 1';
            const source = String(row?.source || 'primary').trim() || 'primary';
            let compGroup = acc.find((item: any) => normalizeLoose(item.name) === normalizeLoose(competencia) && item.source === source);
            if (!compGroup) {
                compGroup = { name: competencia, source, capacities: [] as any[] };
                acc.push(compGroup);
            }
            let capGroup = compGroup.capacities.find((item: any) => normalizeLoose(item.name) === normalizeLoose(capacidad) && item.source === source);
            if (!capGroup) {
                capGroup = { name: capacidad, source, criteria: [] as any[] };
                compGroup.capacities.push(capGroup);
            }
            capGroup.criteria.push(row);
            return acc;
        }, []);

        let globalCriterionIndex = 0;
        const criterionBlocks = groupedCompetencies.flatMap((competency: any) =>
            competency.capacities.flatMap((capacity: any) =>
                capacity.criteria.map((criterion: any) => {
                    globalCriterionIndex += 1;
                    return {
                        code: `C${globalCriterionIndex}`,
                        competencia: competency.name,
                        source: competency.source,
                        capacidad: capacity.name,
                        criterio: String(criterion?.criterio || '').trim(),
                        criterion
                    };
                })
            )
        );
        const guideLevels = gradingGuideLevels;
        const blankRows = Array.from({ length: 6 }, (_, idx) => idx + 1);
        const totalGuideDataColumns = groupedCompetencies.reduce(
            (sum: number, competency: any) => sum + (competency.capacities.reduce((capSum: number, capacity: any) => capSum + capacity.criteria.length, 0) * guideLevels.length) + 1,
            0
        );

        return (
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1280px] border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '24%' }} />
                        {groupedCompetencies.flatMap((competency: any, compIdx: number) => {
                            const competencyCriteria = competency.capacities.reduce((sum: number, capacity: any) => sum + capacity.criteria.length, 0);
                            const criterionCols = Array.from({ length: competencyCriteria }).flatMap((_, critIdx) =>
                                guideLevels.map((level: any) => (
                                    <col
                                        key={`guide-col-${compIdx}-${critIdx}-${level.id}`}
                                        style={{ width: `${68 / Math.max(totalGuideDataColumns, 1)}%` }}
                                    />
                                ))
                            );
                            return [
                                ...criterionCols,
                                <col key={`guide-col-nl-${compIdx}`} style={{ width: `${4 / Math.max(groupedCompetencies.length, 1)}%` }} />
                            ];
                        })}
                    </colgroup>
                    <thead>
                        <tr className="bg-violet-700 text-white uppercase text-[9px]">
                            <th rowSpan={4} className="border border-white/20 p-3 w-12">N°</th>
                            <th rowSpan={4} className="border border-white/20 p-3 min-w-[240px]">Apellidos y Nombres</th>
                            {groupedCompetencies.map((competency: any, compIdx: number) => {
                                const criteriaCount = competency.capacities.reduce((sum: number, capacity: any) => sum + capacity.criteria.length, 0);
                                const isTransversal = String(competency.source || '') === 'transversal';
                                return (
                                    <th
                                        key={`guide-head-comp-${compIdx}`}
                                        colSpan={(Math.max(criteriaCount, 1) * guideLevels.length) + 1}
                                        className="border border-white/20 p-2 text-center"
                                        style={{ backgroundColor: isTransversal ? '#0f766e' : '#6d28d9' }}
                                    >
                                        {competency.name}
                                    </th>
                                );
                            })}
                        </tr>
                        <tr className="bg-violet-700 text-white uppercase text-[9px]">
                            {groupedCompetencies.flatMap((competency: any, compIdx: number) =>
                                [
                                    ...competency.capacities.map((capacity: any, capIdx: number) => {
                                        const isTransversal = String(capacity.source || competency.source || '') === 'transversal';
                                        return (
                                            <th
                                                key={`guide-head-cap-${compIdx}-${capIdx}`}
                                                colSpan={Math.max(capacity.criteria.length, 1) * guideLevels.length}
                                                className="border border-white/20 p-2 text-center"
                                                style={{ backgroundColor: isTransversal ? '#0d9488' : '#7c3aed' }}
                                            >
                                                {capacity.name}
                                            </th>
                                        );
                                    }),
                                    <th
                                        key={`guide-head-nl-${compIdx}`}
                                        rowSpan={3}
                                        className="border border-white/20 p-2 text-center"
                                        style={{ backgroundColor: String(competency.source || '') === 'transversal' ? '#0f766e' : '#6d28d9' }}
                                    >
                                        NL
                                    </th>
                                ]
                            )}
                        </tr>
                        <tr className="text-white text-[9px]">
                            {criterionBlocks.map((block: any, idx: number) => (
                                <th
                                    key={`guide-head-crit-${idx}`}
                                    colSpan={guideLevels.length}
                                    className="border border-white/20 p-2 text-center normal-case leading-tight"
                                    style={{ backgroundColor: String(block.source || '') === 'transversal' ? '#0f766e' : '#6d28d9' }}
                                >
                                    <div className="font-black uppercase text-[8px] tracking-wide">{block.code}</div>
                                    <div className="mt-1 text-[9px] font-medium">{block.criterio}</div>
                                </th>
                            ))}
                        </tr>
                        <tr className="uppercase text-[9px] font-black">
                            {criterionBlocks.flatMap((block: any, idx: number) =>
                                guideLevels.map((level: any, levelIdx: number) => {
                                    const colorMap = ['bg-rose-600', 'bg-orange-500', 'bg-sky-500', 'bg-emerald-500'];
                                    return (
                                        <th
                                            key={`guide-head-level-${idx}-${level.id}`}
                                            className={`border border-white/20 p-1 text-center text-white ${colorMap[levelIdx] || 'bg-violet-600'}`}
                                        >
                                            {level.label}
                                        </th>
                                    );
                                })
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {blankRows.map((rowNumber, idx) => (
                            <tr key={`guide-blank-row-${rowNumber}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                <td className="border border-slate-200 p-2 text-center font-medium text-slate-600">{rowNumber}</td>
                                <td className="border border-slate-200 p-2" />
                                {groupedCompetencies.flatMap((competency: any, compIdx: number) => {
                                    const competencyBlocks = criterionBlocks.filter((block: any) =>
                                        normalizeLoose(block.competencia) === normalizeLoose(competency.name)
                                        && String(block.source || '') === String(competency.source || '')
                                    );
                                    return [
                                        ...competencyBlocks.flatMap((block: any, blockIdx: number) =>
                                            guideLevels.map((level: any, levelIdx: number) => {
                                                const borderColorMap = ['border-rose-500', 'border-orange-500', 'border-sky-500', 'border-emerald-500'];
                                                return (
                                                    <td
                                                        key={`guide-blank-cell-${rowNumber}-${compIdx}-${blockIdx}-${level.id}`}
                                                        className={`border p-2 h-8 ${borderColorMap[levelIdx] || 'border-slate-200'}`}
                                                    />
                                                );
                                            })
                                        ),
                                        <td key={`guide-blank-nl-${rowNumber}-${compIdx}`} className="border border-slate-200 p-2 h-8 text-center font-black text-slate-400">
                                            NL
                                        </td>
                                    ];
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };



    const preview = instrumentType === 'guia_observacion'
        ? renderGuideInstrumentTable()
        : renderInstrumentTemplateTable();

    return preview || fallback;
};

