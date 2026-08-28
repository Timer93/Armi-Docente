import React from 'react';

type SessionCoreDetailsPanelProps = {
    themeColor: string;
    sessionData: any;
    handleInputChange: (path: string, value: any) => void;
};

export const SessionCoreDetailsPanel: React.FC<SessionCoreDetailsPanelProps> = ({
    themeColor,
    sessionData,
    handleInputChange
}) => (
<>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10">
                        {[
                            { id: 'I', label: 'TÍTULO DE SESIÓN', field: 'title' },
                            { id: 'II', label: 'PROPÓSITO DE SESIÓN', field: 'purpose' },
                        ].map(sec => (
                            <div key={sec.id} className="bg-white rounded-[2rem] shadow-lg border overflow-hidden" style={{ borderColor: themeColor }}>
                                <div className="text-white px-6 py-2.5 text-center text-[11px] font-black uppercase tracking-widest relative" style={{ backgroundColor: themeColor }}>
                                    {sec.id}. {sec.label}
                                </div>
                                <textarea 
                                    data-session-field={sec.field}
                                    className="w-full p-4 h-24 resize-none outline-none text-slate-700 font-medium italic text-[11px] leading-relaxed text-center focus:bg-slate-50 transition-all"
                                    placeholder="Escriba aquí..."
                                    value={sessionData[sec.field as keyof typeof sessionData]}
                                    onChange={e => handleInputChange(sec.field, e.target.value)}
                                />
                            </div>
                        ))}
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-lg border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white px-6 py-2.5 text-center text-[11px] font-black uppercase tracking-widest" style={{ backgroundColor: themeColor }}>
                            III. SITUACIÓN PROBLEMÁTICA
                        </div>
                        <textarea 
                            data-session-field="situation"
                            className="w-full p-6 h-32 resize-none outline-none text-slate-700 font-medium italic text-[11px] leading-relaxed text-justify focus:bg-slate-50 transition-all"
                            placeholder="Escriba la situación problemática aquí..."
                            value={sessionData.situation}
                            onChange={e => handleInputChange('situation', e.target.value)}
                        />
                    </div>


</>
);

