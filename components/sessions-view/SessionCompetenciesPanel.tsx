import React from 'react';
import ReactQuill from 'react-quill-new';
import {
    QUILL_MODULES,
    autoResizeTextarea
} from './shared';

type SessionCompetenciesPanelProps = {
    themeColor: string;
    sessionData: any;
    visibleTransRows: Array<{ ct: any; originalIdx: number }>;
    handleInputChange: (path: string, value: any) => void;
    getTransversalSurfaceStyle: (
        color: string,
        alpha?: number
    ) => React.CSSProperties;
    getTransversalTextColor: (color: string) => string;
    getTransversalSurfaceColor: (color: string, alpha?: number) => string;
};

export const SessionCompetenciesPanel: React.FC<SessionCompetenciesPanelProps> = ({
    themeColor,
    sessionData,
    visibleTransRows,
    handleInputChange,
    getTransversalSurfaceStyle,
    getTransversalTextColor,
    getTransversalSurfaceColor
}) => (
<>
                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <table className="comp-table w-full border-collapse text-[10px] min-w-[1000px] table-fixed">
                            <thead>
                                <tr className="text-white font-black uppercase text-[9px] tracking-wider text-center divide-x divide-white/20" style={{ backgroundColor: themeColor }}>
                                    <th className="p-3 w-40">COMPETENCIA PRIORIZADA</th>
                                    <th className="p-3 w-40">CAPACIDAD PRIORIZADA</th>
                                    <th className="p-3">CRITERIOS</th>
                                    <th className="p-3 w-40">CAMPOS TEMÁTICOS</th>
                                    <th className="p-3 w-40">EVIDENCIA DE APRENDIZAJE</th>
                                    <th className="p-3 w-40">INSTRUMENTO</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-black/20">
                                <tr className="divide-x divide-black/20">
                                    <td data-session-field="competenciaPrio.comp" className="p-4 bg-slate-50/50 font-black text-slate-900 text-center align-middle">{sessionData.competenciaPrio.comp}</td>
                                    <td data-session-field="competenciaPrio.cap" className="p-4 bg-slate-50/30 text-slate-800 font-bold italic text-center whitespace-pre-wrap align-middle">{sessionData.competenciaPrio.cap}</td>
                                    <td data-session-field="competenciaPrio.des" className="p-0 align-middle [&_.ql-container]:border-0 [&_.ql-container]:h-full [&_.ql-editor]:min-h-[96px] [&_.ql-editor]:h-full [&_.ql-editor]:w-full [&_.ql-editor]:px-4 [&_.ql-editor]:py-4 [&_.ql-editor]:text-[10px] [&_.ql-editor]:font-bold [&_.ql-editor]:text-slate-700 [&_.ql-editor]:bg-slate-50/40 [&_.ql-editor]:whitespace-pre-wrap">
                                        <ReactQuill
                                            theme="bubble"
                                            modules={QUILL_MODULES}
                                            value={sessionData.competenciaPrio.des}
                                            onChange={(val) => handleInputChange('competenciaPrio.des', val)}
                                        />
                                    </td>
                                    <td className="p-0 align-middle" rowSpan={1 + visibleTransRows.length}>
                                        <textarea data-session-field="competenciaPrio.field" data-comp-table="1" className="w-full p-4 border-0 outline-none text-center font-bold text-slate-700 resize-none overflow-y-hidden text-[10px] bg-slate-50/50" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.competenciaPrio.field} onChange={e => handleInputChange('competenciaPrio.field', e.target.value)} placeholder="Campo..." />
                                    </td>
                                    <td data-session-field="competenciaPrio.evidence" className="p-0 align-middle [&_.ql-container]:border-0 [&_.ql-container]:h-full [&_.ql-editor]:min-h-[96px] [&_.ql-editor]:h-full [&_.ql-editor]:w-full [&_.ql-editor]:px-4 [&_.ql-editor]:py-4 [&_.ql-editor]:text-[10px] [&_.ql-editor]:font-bold [&_.ql-editor]:text-slate-700 [&_.ql-editor]:bg-blue-200 [&_.ql-editor]:whitespace-pre-wrap">
                                        <ReactQuill
                                            theme="bubble"
                                            modules={QUILL_MODULES}
                                            value={sessionData.competenciaPrio.evidence}
                                            onChange={(val) => handleInputChange('competenciaPrio.evidence', val)}
                                        />
                                    </td>
                                    <td className="p-0 align-middle">
                                        <textarea data-session-field="competenciaPrio.inst" data-comp-table="1" className="w-full p-4 border-0 outline-none text-center font-bold text-slate-500 resize-none overflow-y-hidden text-[10px]" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.competenciaPrio.inst} onChange={e => handleInputChange('competenciaPrio.inst', e.target.value)} placeholder="Instrumento..." /></td>
                                </tr>
                                {visibleTransRows.map(({ ct, originalIdx }: any, idx: number) => (
                                    <tr key={originalIdx} className="divide-x divide-black/20">
                                        <td
                                            className="p-4 font-black text-center uppercase tracking-tighter align-middle"
                                            style={{ ...getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.12), color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')) }}
                                        >
                                            <span className="text-[8px] opacity-60 block mb-1">Competencia Transversal:</span>
                                            {ct.comp}
                                        </td>
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <textarea
                                                data-comp-table="1"
                                                className="bg-transparent w-full h-full min-h-[96px] p-4 border-0 outline-none text-center font-black italic resize-none overflow-y-hidden text-[10px]"
                                                style={{ color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')) }}
                                                onInput={e => autoResizeTextarea(e.currentTarget)}
                                                value={ct.cap}
                                                onChange={e => handleInputChange(`competenciasTrans.${originalIdx}.cap`, e.target.value)}
                                                placeholder="Capacidad..."
                                            />
                                        </td>                               
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <div
                                                className="trans-quill-surface min-h-[112px] h-full w-full
                                                [&_.ql-container]:!border-0
                                                [&_.ql-container]:h-full
                                                [&_.ql-editor]:min-h-[112px]
                                                [&_.ql-editor]:h-full
                                                [&_.ql-editor]:w-full
                                                [&_.ql-editor]:px-4
                                                [&_.ql-editor]:py-4
                                                [&_.ql-editor]:text-[10px]
                                                [&_.ql-editor]:font-black
                                                [&_.ql-editor]:!text-[inherit]
                                                [&_.ql-editor]:whitespace-pre-wrap
                                                [&_.ql-editor_p]:!m-0"
                                                style={{
                                                    ...getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')),
                                                    ['--trans-surface' as any]: getTransversalSurfaceColor(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    ['--trans-text' as any]: getTransversalTextColor(String(ct?.rowColor || '#00b28c'))
                                                }}
                                            >
                                                <ReactQuill
                                                    className="trans-quill"
                                                    theme="bubble"
                                                    modules={QUILL_MODULES}
                                                    value={ct.des}
                                                    onChange={(val) => handleInputChange(`competenciasTrans.${originalIdx}.des`, val)}
                                                />
                                            </div>
                                        </td>
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <div
                                                className="trans-quill-surface min-h-[112px] h-full w-full
                                                [&_.ql-container]:!border-0
                                                [&_.ql-container]:h-full
                                                [&_.ql-editor]:min-h-[112px]
                                                [&_.ql-editor]:h-full
                                                [&_.ql-editor]:w-full
                                                [&_.ql-editor]:px-4
                                                [&_.ql-editor]:py-4
                                                [&_.ql-editor]:text-[10px]
                                                [&_.ql-editor]:font-black
                                                [&_.ql-editor]:!text-[inherit]
                                                [&_.ql-editor]:whitespace-pre-wrap
                                                [&_.ql-editor_p]:!m-0"
                                                style={{
                                                    ...getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')),
                                                    ['--trans-surface' as any]: getTransversalSurfaceColor(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    ['--trans-text' as any]: getTransversalTextColor(String(ct?.rowColor || '#00b28c'))
                                                }}
                                            >
                                                <ReactQuill
                                                    className="trans-quill"
                                                    theme="bubble"
                                                    modules={QUILL_MODULES}
                                                    value={ct.evidence}
                                                    onChange={(val) => handleInputChange(`competenciasTrans.${originalIdx}.evidence`, val)}
                                                />
                                            </div>
                                        </td>
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <textarea
                                                data-comp-table="1"
                                                className="bg-transparent w-full h-full min-h-[96px] p-4 border-0 outline-none text-center font-bold resize-none overflow-y-hidden text-[10px]"
                                                style={{ color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')) }}
                                                onInput={e => autoResizeTextarea(e.currentTarget)}
                                                value={ct.inst}
                                                onChange={(e) => handleInputChange(`competenciasTrans.${originalIdx}.inst`, e.target.value)}
                                                placeholder="Instrumento..."
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <table className="w-full border-collapse text-[10px]">
                            <thead className="text-white font-black uppercase text-[9px]" style={{ backgroundColor: themeColor }}>
                                <tr className="divide-x divide-white/20">
                                    <th className="p-3 w-40 text-center">ENFOQUE TRANSVERSAL</th>
                                    <th className="p-3 w-40 text-center">VALORES</th>
                                    <th className="p-3 w-1/3 text-center">ACCIONES OBSERVABLES</th>
                                    <th className="p-3 text-center">SE DEMUESTRA CUANDO...</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-black/20">
                                <tr className="divide-x divide-black/20 align-top">
                                    <td data-session-field="enfoqueTrans.enfoque" className="p-4 bg-slate-50/50 font-black text-slate-900 text-center align-middle">{sessionData.enfoqueTrans.enfoque || 'N/A'}</td>
                                    <td className="p-0 align-middle">
                                        <textarea data-session-field="enfoqueTrans.valor" className="w-full h-full p-4 border-0 outline-none text-center font-bold text-slate-800 resize-none italic text-[11px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.enfoqueTrans.valor} onChange={e => handleInputChange('enfoqueTrans.valor', e.target.value)} placeholder="Valores..." /></td>
                                    <td className="p-0 align-middle">
                                        <textarea data-session-field="enfoqueTrans.acciones" className="w-full p-4 border-0 outline-none text-slate-700 font-medium italic text-justify resize-none text-[11px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.enfoqueTrans.acciones} onChange={e => handleInputChange('enfoqueTrans.acciones', e.target.value)} placeholder="Acciones..." /></td>
                                    <td className="p-0 align-middle">
                                        <textarea data-session-field="enfoqueTrans.demuestra" className="w-full p-4 border-0 outline-none text-slate-600 font-medium italic text-justify resize-none text-[11px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.enfoqueTrans.demuestra} onChange={e => handleInputChange('enfoqueTrans.demuestra', e.target.value)} placeholder="Se demuestra cuando..." /></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>


</>
);

