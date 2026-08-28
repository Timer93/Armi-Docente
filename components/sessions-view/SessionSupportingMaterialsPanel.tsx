import React from 'react';

type SessionSupportingMaterialsPanelProps = {
    themeColor: string;
    sessionData: any;
    handleInputChange: (path: string, value: any) => void;
    handleFillExtensionDefaults: () => void;
    handleFillResourceDefaults: () => void;
    handleFillBibliographyDefaults: () => void;
};

export const SessionSupportingMaterialsPanel: React.FC<SessionSupportingMaterialsPanelProps> = ({
    themeColor,
    sessionData,
    handleInputChange,
    handleFillExtensionDefaults,
    handleFillResourceDefaults,
    handleFillBibliographyDefaults
}) => (
<>
                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 font-black uppercase text-xs tracking-widest flex items-center justify-between gap-3" style={{ backgroundColor: themeColor }}>
                            <div className="flex items-center gap-3">
                                <span className="text-xl"></span> VII. ACTIVIDADES DE EXTENSIÓN
                            </div>
                            <button onClick={handleFillExtensionDefaults} className="px-4 py-2 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg">
                                ✨ Sugerir
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-[11px] font-bold italic text-slate-500 text-center">
                                Para las actividades de extensión puedes usar una sugerencia base o redactarlas manualmente según la sesión.
                            </p>
                            <textarea
                                data-session-field="extension"
                                className="w-full min-h-[140px] resize-none rounded-[1.8rem] border border-slate-200 bg-slate-50 px-5 py-5 outline-none text-[11px] leading-relaxed font-medium italic text-slate-700 focus:border-violet-300 focus:bg-white transition-all"
                                value={sessionData.extension || ''}
                                onChange={e => handleInputChange('extension', e.target.value)}
                                placeholder="Escribe aquí las actividades de extensión..."
                            />
                        </div>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 font-black uppercase text-xs tracking-widest flex items-center justify-between gap-3" style={{ backgroundColor: themeColor }}>
                            <div className="flex items-center gap-3">
                                <span className="text-xl"></span> VIII. RECURSOS, MEDIOS Y MATERIALES A UTILIZAR
                            </div>
                            <button onClick={handleFillResourceDefaults} className="px-4 py-2 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg">
                                ✨ Valores por defecto
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[10px] min-w-[900px]">
                                <thead className="text-white font-black uppercase text-[9px]" style={{ backgroundColor: themeColor }}>
                                    <tr className="divide-x divide-white/20">
                                        <th className="p-3 text-center">RECURSOS</th>
                                        <th className="p-3 text-center">MEDIOS</th>
                                        <th className="p-3 text-center">MATERIALES</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="divide-x divide-black/20">
                                        <td className="p-0"><textarea data-session-field="recursos.rec" className="w-full min-h-[150px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.rec || ''} onChange={e => handleInputChange('recursos.rec', e.target.value)} placeholder="Recursos..." /></td>
                                        <td className="p-0"><textarea data-session-field="recursos.med" className="w-full min-h-[150px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.med || ''} onChange={e => handleInputChange('recursos.med', e.target.value)} placeholder="Medios..." /></td>
                                        <td className="p-0"><textarea data-session-field="recursos.mat" className="w-full min-h-[150px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.mat || ''} onChange={e => handleInputChange('recursos.mat', e.target.value)} placeholder="Materiales..." /></td>
                                    </tr>
                                    <tr className="text-white font-black uppercase text-[9px] divide-x divide-white/20" style={{ backgroundColor: themeColor }}>
                                        <th className="p-3 text-center" colSpan={2}>APS O SOFTWARES</th>
                                        <th className="p-3 text-center">ESPACIOS DE APRENDIZAJE</th>
                                    </tr>
                                    <tr className="divide-x divide-black/20">
                                        <td className="p-0" colSpan={2}><textarea data-session-field="recursos.soft" className="w-full min-h-[140px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.soft || ''} onChange={e => handleInputChange('recursos.soft', e.target.value)} placeholder="Apps, softwares o plataformas..." /></td>
                                        <td className="p-0"><textarea data-session-field="recursos.esp" className="w-full min-h-[140px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.esp || ''} onChange={e => handleInputChange('recursos.esp', e.target.value)} placeholder="Espacios de aprendizaje..." /></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 font-black uppercase text-xs tracking-widest flex items-center justify-between gap-3" style={{ backgroundColor: themeColor }}>
                            <div className="flex items-center gap-3">
                                <span className="text-xl"></span> IX. REFERENCIAS BIBLIOGRÁFICAS
                            </div>
                            <button onClick={handleFillBibliographyDefaults} className="px-4 py-2 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg">
                                ✨ Valores por defecto
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[10px] min-w-[900px]">
                                <thead className="text-white font-black uppercase text-[9px]" style={{ backgroundColor: themeColor }}>
                                    <tr className="divide-x divide-white/20">
                                        <th className="p-3 text-center">BIBLIOGRAFÍA</th>
                                        <th className="p-3 text-center">LINKOGRAFÍA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="divide-x divide-black/20">
                                        <td className="p-0"><textarea data-session-field="bibliografia.bib" className="w-full min-h-[180px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.bibliografia?.bib || ''} onChange={e => handleInputChange('bibliografia.bib', e.target.value)} placeholder="Bibliografía..." /></td>
                                        <td className="p-0"><textarea data-session-field="bibliografia.link" className="w-full min-h-[180px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.bibliografia?.link || ''} onChange={e => handleInputChange('bibliografia.link', e.target.value)} placeholder="Linkografía..." /></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

</>
);
