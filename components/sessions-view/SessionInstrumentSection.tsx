import React from 'react';
import { SessionInstrumentPreview } from './SessionInstrumentPreview';
import { autoResizeTextarea, normalizeLoose } from './shared';

interface SessionInstrumentSectionProps {
    themeColor: string;
    sessionData: any;
    canonicalInstrumentRows: any[];
    assessmentTemplateModel: any;
    checklistLevelMapping: any;
    gradingCriteriaRows: any[];
    gradingGuideLevels: any[];
    rubricRowMode: string;
    rubricAutoRowsByMode: Record<string, any[]>;
    handleInputChange: (path: string, value: any) => void;
    getTransversalSurfaceStyle: (color: string, alpha?: number) => React.CSSProperties;
    getTransversalSurfaceColor: (color: string, alpha?: number) => string;
    getTransversalTextColor: (color: string) => string;
}

export const SessionInstrumentSection: React.FC<SessionInstrumentSectionProps> = ({
    themeColor,
    sessionData,
    canonicalInstrumentRows,
    assessmentTemplateModel,
    checklistLevelMapping,
    gradingCriteriaRows,
    gradingGuideLevels,
    rubricRowMode,
    rubricAutoRowsByMode,
    handleInputChange,
    getTransversalSurfaceStyle,
    getTransversalSurfaceColor,
    getTransversalTextColor
}) => (
    <div data-session-field="instrumento" className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
        <div className="text-white p-4 text-center font-black uppercase text-xs tracking-widest flex items-center justify-center gap-3" style={{ backgroundColor: themeColor }}>
            <span className="text-xl"></span> X. INSTRUMENTO DE EVALUACIÓN: {sessionData?.instrumentoTemplate?.name || sessionData?.competenciaPrio?.inst || 'RÚBRICA ANALÍTICA - GENERAL'}
        </div>
        <div className="overflow-x-auto">
            <SessionInstrumentPreview
                sessionData={sessionData}
                instrumentType={String(sessionData?.instrumentoTemplate?.type || '')}
                canonicalInstrumentRows={canonicalInstrumentRows}
                assessmentTemplateModel={assessmentTemplateModel}
                checklistLevelMapping={checklistLevelMapping}
                gradingCriteriaRows={gradingCriteriaRows}
                gradingGuideLevels={gradingGuideLevels}
                handleInputChange={handleInputChange}
                getTransversalSurfaceStyle={getTransversalSurfaceStyle}
                fallback={(
                <table className="w-full text-[11px] border-collapse min-w-[1000px]">
                    <thead>
                        <tr className="bg-slate-800 text-white font-black uppercase text-[9px] divide-x divide-white/50">
                            <th className="p-3 w-12 text-center">N°</th>
                            <th className="p-3 w-48 text-center">CRITERIO</th>
                            <th className="p-3 w-48 bg-red-600 text-center">C (INICIO)</th>
                            <th className="p-3 w-48 bg-orange-500 text-center">B (EN PROCESO)</th>
                            <th className="p-3 w-48 bg-cyan-500 text-center">A (LOGRADO)</th>
                            <th className="p-3 w-48 bg-emerald-500 text-center">AD (DESTACADO)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="border-b border-black/20 bg-slate-50/40">
                            <td className="p-3 font-black text-slate-700 text-center border-b border-black/20">MODO</td>
                            <td colSpan={5} className="p-2 border-b border-black/20">
                                <select
                                    className="w-full bg-transparent px-2 py-1 text-center text-[10px] font-black uppercase tracking-wide text-slate-700 outline-none"
                                    value={rubricRowMode}
                                    onChange={e => {
                                        const nextMode = String(e.target.value || 'criterion') as 'criterion' | 'capacity';
                                        const nextRows = (rubricAutoRowsByMode[nextMode] || []).map((row: any, idx: number) => ({
                                            ...row,
                                            id: idx + 1
                                        }));
                                        handleInputChange('rubricaRowMode', nextMode);
                                        handleInputChange('instrumento', nextRows);
                                    }}
                                >
                                    <option value="criterion">Evaluar por criterio</option>
                                    <option value="capacity">Evaluar por capacidad</option>
                                </select>
                            </td>
                        </tr>
                        {(() => {
                            const rows = Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : [];
                            const rendered: React.ReactNode[] = [];
                            let currentCompetencia = '';
                            let currentCapacidad = '';
    
                            rows.forEach((row: any, i: number) => {
                                const updateRow = (field: string, val: string) => {
                                    const newInst = [...rows];
                                    newInst[i][field] = val;
                                    handleInputChange('instrumento', newInst);
                                };
    
                                const competencia = String(row?.competencia || '').trim();
                                const capacidad = String(row?.capacidad || '').trim();
                                const isTransversal = String(row?.source || '') === 'transversal';
                                const transversalColor = String(row?.rowColor || '#00b28c');
                                const rowTone = isTransversal ? 'hover:bg-emerald-50/80' : 'hover:bg-slate-50';
                                const toneCellClass = isTransversal ? '' : '';
                                const toneCellStyle = isTransversal ? getTransversalSurfaceStyle(transversalColor, 0.12) : undefined;
                                const transversalHeaderStyle = isTransversal ? { backgroundColor: transversalColor, color: '#ffffff' } : undefined;
                                const transversalSubheaderStyle = isTransversal
                                    ? {
                                        backgroundColor: getTransversalSurfaceColor(transversalColor, 0.18),
                                        color: getTransversalTextColor(transversalColor)
                                    }
                                    : undefined;
    
                                if (competencia && normalizeLoose(competencia) !== normalizeLoose(currentCompetencia)) {
                                    currentCompetencia = competencia;
                                    currentCapacidad = '';
                                    rendered.push(
                                        <tr key={`rubrica-comp-${i}`}>
                                            <td className={`p-3 text-center font-black border-b border-black/20 ${isTransversal ? '' : 'bg-slate-800 text-white'}`} style={transversalHeaderStyle}>
                                                COMP.
                                            </td>
                                            <td colSpan={5} className={`p-3 text-center font-black uppercase tracking-wide border-b border-black/20 ${isTransversal ? '' : 'bg-slate-100 text-slate-800'}`} style={isTransversal ? { ...transversalHeaderStyle, opacity: 0.94 } : undefined}>
                                                {competencia}
                                            </td>
                                        </tr>
                                    );
                                }
    
                                if (capacidad && normalizeLoose(capacidad) !== normalizeLoose(currentCapacidad)) {
                                    currentCapacidad = capacidad;
                                    rendered.push(
                                        <tr key={`rubrica-cap-${i}`}>
                                            <td className={`p-3 text-center font-black border-b border-black/20 ${isTransversal ? '' : 'bg-slate-100 text-slate-700'}`} style={transversalSubheaderStyle}>
                                                CAP.
                                            </td>
                                            <td colSpan={5} className={`p-3 text-center font-bold border-b border-black/20 ${isTransversal ? '' : 'bg-slate-50 text-slate-700'}`} style={toneCellStyle}>
                                                {capacidad}
                                            </td>
                                        </tr>
                                    );
                                }
    
                                rendered.push(
                                    <tr key={row.id || i} className={`divide-x divide-y divide-black/20 border-b border-slate-50 align-top group transition-all ${rowTone}`}>
                                        <td className={`p-4 text-center font-black text-slate-900 bg-slate-50/30 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}>{i + 1}</td>
                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}>
                                            <textarea data-comp-table="1" className="w-full p-3 border-0 outline-none font-bold text-slate-800 resize-none overflow-hidden text-center bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.criterio} onChange={e => updateRow('criterio', e.target.value)} placeholder={rubricRowMode === 'capacity' ? 'Capacidad...' : 'Defina criterio...'} />
                                        </td>
                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-red-600 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.c} onChange={e => updateRow('c', e.target.value)} placeholder="..." /></td>
                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-orange-700 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.b} onChange={e => updateRow('b', e.target.value)} placeholder="..." /></td>
                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-blue-700 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.a} onChange={e => updateRow('a', e.target.value)} placeholder="..." /></td>
                                        <td className={`p-0 align-middle border-r border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-emerald-700 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.ad} onChange={e => updateRow('ad', e.target.value)} placeholder="..." /></td>
                                    </tr>
                                );
                            });
    
                            return rendered;
                        })()}
                    </tbody>
                </table>
                )}
            />
        </div>
    </div>
);
