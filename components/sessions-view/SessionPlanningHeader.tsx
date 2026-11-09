import React, { useRef } from 'react';
import { SessionActions } from './SessionActions';
import { Select } from '../Select';
import { SessionGlassButton } from './SessionGlassButton';
import {
    CustomDatePicker,
    cloneInitialSessionData
} from './shared';

type Option = { value: string; label: string };

type SessionPlanningHeaderProps = {
    themeColor: string;
    setThemeColor: (value: string) => void;
    year: number | string;
    bimesterLabel: string;
    headerFilled: boolean;
    isGeneratingIA: boolean;
    aiUsageProgress: { tokenLabel: string };
    handleGenerateAI: () => void;
    setShowAuthScreen: (value: boolean) => void;
    handleSave: () => Promise<any> | void;
    setSessionData: (value: any) => void;
    handleOpenManager: () => void;
    handleOpenTemplateMode: () => Promise<any> | void;
    dynamicHoursLabel: string;
    uniqueAreas: string[];
    selArea: string;
    setSelArea: (value: string) => void;
    availableGrades: string[];
    selGrade: string;
    setSelGrade: (value: string) => void;
    availableSections: Option[];
    selSection: string;
    setSelSection: (value: string) => void;
    unitNumber: string;
    setUnitNumber: (value: string) => void;
    maxSessionsInUnit: number;
    sessionNumber: string;
    setSessionNumber: (value: string) => void;
    dateOptions: Option[];
    sessionDate: string;
    isDatePickerOpen: boolean;
    setIsDatePickerOpen: (value: boolean) => void;
    triggerDateChange: (value: string) => void;
    sessionMode: string;
    activeGradingSection?: string;
    setSessionMode: (value: 'planificacion' | 'calificacion') => void;
};

export const SessionPlanningHeader: React.FC<SessionPlanningHeaderProps> = ({
    themeColor,
    setThemeColor,
    year,
    bimesterLabel,
    headerFilled,
    isGeneratingIA,
    aiUsageProgress,
    handleGenerateAI,
    setShowAuthScreen,
    handleSave,
    setSessionData,
    handleOpenManager,
    handleOpenTemplateMode,
    dynamicHoursLabel,
    uniqueAreas,
    selArea,
    setSelArea,
    availableGrades,
    selGrade,
    setSelGrade,
    availableSections,
    selSection,
    setSelSection,
    unitNumber,
    setUnitNumber,
    maxSessionsInUnit,
    sessionNumber,
    setSessionNumber,
    dateOptions,
    sessionDate,
    isDatePickerOpen,
    setIsDatePickerOpen,
    triggerDateChange,
    sessionMode,
    activeGradingSection,
    setSessionMode
}) => {
const headerRef = useRef<HTMLDivElement>(null);
return (
<>
            <div ref={headerRef} className="p-5 rounded-[2rem] shadow-xl relative overflow-visible text-white transition-colors duration-500 print:hidden" style={{ backgroundColor: themeColor, backgroundImage: 'radial-gradient(ellipse at 84% -35%, rgba(255,255,255,.24), transparent 52%)' }}>
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-white/30 to-transparent"></div>
                <div className="session-header-top">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="bg-white/10 p-2 rounded-xl border border-white/20">
                        <span className="text-2xl">📘</span></div>
                        <div className="flex min-w-0 flex-col">
                            <h1 className="text-xl xl:text-2xl font-black italic font-serif tracking-tight uppercase leading-tight">Sesiones de Aprendizaje {year}</h1><span className="text-[10px] font-bold text-white/70 uppercase tracking-widest mt-1">Planificación de sesiones - {bimesterLabel} Bimestre</span></div>
                    </div>
                    
                    <SessionActions headerRef={headerRef} themeColor={themeColor} setThemeColor={setThemeColor}
                        contextLabel={`${selGrade || 'Grado'} ${sessionMode === 'calificacion' ? activeGradingSection || selSection : selSection} · U${unitNumber} · S${sessionNumber}`}
                        headerFilled={headerFilled} isGeneratingIA={isGeneratingIA} aiTokenLabel={aiUsageProgress.tokenLabel}
                        onAI={handleGenerateAI} onAISettings={() => setShowAuthScreen(true)} onSave={handleSave}
                        onClear={() => setSessionData(cloneInitialSessionData())} onManager={handleOpenManager} onTemplate={handleOpenTemplateMode} />
                </div>

                <div className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-3 bg-black/10 p-4 rounded-[1.5rem] border border-white/10 backdrop-blur-md relative z-[200] overflow-visible">
                    <div className="absolute -top-3 right-8 z-30 pointer-events-none">
                        <div className="bg-slate-900/80 backdrop-blur-xl px-4 py-1.5 rounded-full border border-white/20 shadow-2xl flex items-center gap-2.5 ring-4 ring-black/5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></div>
                            <span className="text-[8px] font-black text-white/50 uppercase tracking-[0.2em]">Carga Horaria</span>
                            <span className="text-[11px] font-black text-blue-400 tracking-tighter">{dynamicHoursLabel}</span>
                        </div>
                    </div>

                    <div className="md:col-span-4">
                        <Select 
                            label="AREA" name="selArea" 
                            options={uniqueAreas.map(a => ({ value: a, label: a.toUpperCase() }))} 
                            value={selArea} onChange={e => { setSelArea(e.target.value); setSelGrade(''); setSelSection(''); }}
                            className="text-slate-900"
                            labelClassName="text-white"
                            placeholder="Área..."
                        />
                    </div>
                    <div className="md:col-span-1">
                        <Select 
                            label="GRADO" name="selGrade" 
                            options={availableGrades.map(g => ({ value: g, label: g }))} 
                            value={selGrade} onChange={e => { setSelGrade(e.target.value); setSelSection(''); }}
                            className="text-slate-900"
                            labelClassName="text-white"
                            placeholder="-"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <Select 
                            label="SECC" name="selSection" 
                            options={availableSections} 
                            value={selSection} onChange={e => setSelSection(e.target.value)}
                            className="text-slate-900"
                            labelClassName="text-white"
                            placeholder="-"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <Select 
                            label="UNID." name="unit" 
                            options={Array.from({ length: 8 }, (_, i) => ({ value: (i + 1).toString(), label: `U${i + 1}` }))} 
                            value={unitNumber} onChange={e => setUnitNumber(e.target.value)}
                            className="text-slate-900"
                            labelClassName="text-white"
                        />
                    </div>
                    <div className="md:col-span-1">
                        <Select 
                            label="N° SESIÓN" name="session" 
                            options={Array.from({ length: maxSessionsInUnit }, (_, i) => ({ value: (i + 1).toString(), label: `S${i + 1}` }))} 
                            value={sessionNumber} onChange={e => setSessionNumber(e.target.value)}
                            className="text-slate-900"
                            labelClassName="text-white"
                        />
                    </div>
                    <div className="md:col-span-3 relative rounded-2xl" data-session-field="date">
                        <label className="block text-[10px] font-black text-white mb-2 ml-1 uppercase tracking-[0.15em] leading-none">FECHA</label>
                        <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                                {(dateOptions.length > 0 ? dateOptions : [{value: sessionDate, label: sessionDate.split('-').reverse().join('/')}]).map(d => (
                                    <button 
                                        key={d.value} 
                                        onClick={() => {
                                            if (sessionDate === d.value) {
                                                setIsDatePickerOpen(!isDatePickerOpen);
                                            } else {
                                                triggerDateChange(d.value);
                                            }
                                        }}
                                        className={`px-3 py-1 rounded-full text-[9px] font-black uppercase transition-all shadow-sm border flex items-center gap-1.5 ${sessionDate === d.value ? 'bg-white text-blue-700 border-white ring-2 ring-white/20 shadow-md scale-105' : 'bg-white/10 text-white border-white/10 hover:bg-white/20'}`}
                                    >
                                        <span>{d.label || 'dd/mm/aa'}</span>
                                        {sessionDate === d.value && <span className="text-[8px] animate-pulse">●</span>}
                                    </button>
                                ))}
                            </div>
                            
                            <CustomDatePicker 
                                value={sessionDate} 
                                isOpen={isDatePickerOpen}
                                onChange={triggerDateChange} 
                                onClose={() => setIsDatePickerOpen(false)}
                            />
                        </div>
                    </div>
                </div>

                <div className="session-glass-modes" data-mode={sessionMode} role="group" aria-label="Modo de sesión">
                    <SessionGlassButton
                        onClick={() => setSessionMode('planificacion')}
                        className="session-glass-mode" aria-pressed={sessionMode === 'planificacion'}
                    >
                        Planificación
                    </SessionGlassButton>
                    <SessionGlassButton
                        onClick={() => setSessionMode('calificacion')}
                        className="session-glass-mode" aria-pressed={sessionMode === 'calificacion'}
                    >
                        Calificación
                    </SessionGlassButton>
                </div>
            </div>


</>
);
};

