
import React, { useState, useEffect, useMemo } from 'react';
import { getDatosGenerales, getCompetencias, getLearningGoalsStats, saveLearningGoal, getEstudiantes } from '../services/apiService';
import { Select } from './Select';
import { GeneralData, TeachingAssignment, EvaluationLevel, Student } from '../types';

interface MetaData {
    anio: string;
    area: string;
    grado: string;
    seccion: string;
    competencia: string;
    tipo: 'LINEA_BASE' | 'META' | 'DIAGNOSTICO';
    cant_destacado: number;
    cant_esperado: number;
    cant_proceso: number;
    cant_inicio: number;
    cant_no_evaluado: number;
}

const LEVEL_LABELS: Record<string, string> = {
    'AD': 'Destacado',
    'A': 'Esperado',
    'B': 'En proceso',
    'C': 'En inicio',
    'NE': 'No Evaluados'
};

const ORDERED_LEVELS = ['AD', 'A', 'B', 'C', 'NE'];

// Componente Toast Flotante Global
const InfoToast: React.FC<{ message: string; onClose: () => void }> = ({ message, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed top-10 right-10 z-[999999] animate-fly-in w-full max-w-sm pointer-events-none">
            <div className="bg-slate-900/95 text-white px-6 py-5 rounded-[2rem] shadow-[0_30px_90px_rgba(0,0,0,0.6)] border border-white/20 flex items-center gap-5 backdrop-blur-2xl ring-4 ring-black/10 pointer-events-auto">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl shrink-0 animate-pulse">
                    ⚠️
                </div>
                <div className="flex-1 min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-500 mb-1 block">Aviso del Sistema</span>
                    <p className="text-[11px] font-bold leading-tight uppercase tracking-tight break-words">{message}</p>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 text-lg shrink-0">✕</button>
            </div>
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes flyIn {
                    from { opacity: 0; transform: translateX(100px) scale(0.9); }
                    to { opacity: 1; transform: translateX(0) scale(1); }
                }
                .animate-fly-in {
                    animation: flyIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                }
            `}} />
        </div>
    );
};

// Helper para obtener el valor de un objeto meta de forma segura
const getManualCount = (metaObj: MetaData | undefined, lvl: string) => {
    if (!metaObj) return 0;
    if (lvl === 'AD') return metaObj.cant_destacado;
    if (lvl === 'A') return metaObj.cant_esperado;
    if (lvl === 'B') return metaObj.cant_proceso;
    if (lvl === 'C') return metaObj.cant_inicio;
    return metaObj.cant_no_evaluado;
};

export const LearningGoalsView: React.FC = () => {
    const [lineaBaseStats, setLineaBaseStats] = useState<any[]>([]);
    const [generalData, setGeneralData] = useState<GeneralData | null>(null);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    const [selectedArea, setSelectedArea] = useState('');
    const [selectedGrade, setSelectedGrade] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
    const [competenciesList, setCompetenciesList] = useState<string[]>([]);
    const [statsData, setStatsData] = useState<any>(null);
    const [manualMetas, setManualMetas] = useState<MetaData[]>([]);
    const [studentMatricula, setStudentMatricula] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(false);
    const [toastMsg, setToastMsg] = useState<string | null>(null);
    
    // Estado para el tema dinámico
    const [themeColor, setThemeColor] = useState(() => {
        return localStorage.getItem('armi_goals_theme') || '#bf8f00';
    });

    useEffect(() => {
        localStorage.setItem('armi_goals_theme', themeColor);
    }, [themeColor]);

    useEffect(() => {
        const load = async () => {
            const gd = await getDatosGenerales();
            setGeneralData(gd);
            setSelectedYear(gd.year || new Date().getFullYear().toString());
            const savedAssign = localStorage.getItem('armi_assignments');
            if (savedAssign) setAssignments(JSON.parse(savedAssign));
        };
        load();
    }, []);

    const areaOptions = useMemo(() => {
        const unique = new Map();
        assignments.forEach(a => { if(!unique.has(a.areaName)) unique.set(a.areaName, a.areaName); });
        return Array.from(unique.entries()).map(([name]) => ({ value: name, label: name.toUpperCase() }));
    }, [assignments]);

    const gradeOptions = useMemo(() => {
        if (!selectedArea) return [];
        const grades = new Set(assignments.filter(a => a.areaName === selectedArea).map(a => a.grade));
        return Array.from(grades).sort().map(g => ({ value: g, label: g }));
    }, [assignments, selectedArea]);

    const sectionsForSelectedGrade = useMemo(() => {
        return Array.from(new Set(assignments.filter(a => a.grade === selectedGrade && a.areaName === selectedArea).map(a => a.section))).sort();
    }, [assignments, selectedGrade, selectedArea]);

    useEffect(() => {
        if (selectedArea && selectedGrade) {
            getCompetencias(selectedGrade, selectedArea).then(res => {
                const unique = Array.from(new Set(res.map(c => c.competencias))).sort();
                setCompetenciesList(unique);
            });
            fetchStats();
            loadStudentMatricula();
        }
    }, [selectedArea, selectedGrade, selectedYear]);

    const loadStudentMatricula = async () => {
        try {
            const allStudents = await getEstudiantes();
            const counts: Record<string, number> = {};
            allStudents.filter(s => s.grade === selectedGrade && s.estado !== 'R').forEach(s => {
                const sec = String(s.section).trim().toUpperCase();
                counts[sec] = (counts[sec] || 0) + 1;
            });
            setStudentMatricula(counts);
        } catch (e) {
            console.error("Error al cargar matrícula", e);
        }
    };

    const fetchStats = async () => {
        setLoading(true);
        try {
            const res = await getLearningGoalsStats(selectedArea, selectedGrade, selectedYear, generalData?.level || 'Secundaria');
            if (res.success) {
                setStatsData(res.data.diagStats);
                setLineaBaseStats(res.data.lineaBaseStats || []);
                if (res.data.manualMetas) {
                    setManualMetas(res.data.manualMetas);
                }
            }
        } catch (e) {} finally { setLoading(false); }
    };

    const handleManualChange = (seccion: string, competencia: string, tipo: 'LINEA_BASE' | 'META' | 'DIAGNOSTICO', level: string, value: string) => {
        const val = parseInt(value) || 0;
        const colKey = `cant_${level === 'AD' ? 'destacado' : level === 'A' ? 'esperado' : level === 'B' ? 'proceso' : level === 'C' ? 'inicio' : 'no_evaluado'}`;
        
        const normS = String(seccion).trim().toUpperCase();
        const normC = String(competencia).trim().toUpperCase();
        const limit = studentMatricula[normS] || 0;

        if (tipo !== 'LINEA_BASE') {
            const existingManual = manualMetas.find(m => 
                String(m.seccion).trim().toUpperCase() === normS && 
                String(m.competencia).trim().toUpperCase() === normC && 
                m.tipo === tipo
            );

            const sumOtherLevels = ORDERED_LEVELS.filter(l => l !== level).reduce((acc, l) => {
                let currentVal = 0;
                if (tipo === 'DIAGNOSTICO') {
                    const diagDb = (statsData || []).find((s: any) => String(s.seccion).trim().toUpperCase() === normS && String(s.competencia).trim().toUpperCase() === normC && String(s.nivel_logro).trim().toUpperCase() === String(l).trim().toUpperCase());
                    const dbVal = diagDb ? diagDb.cantidad : 0;
                    currentVal = dbVal || getManualCount(existingManual, l);
                } else {
                    currentVal = getManualCount(existingManual, l);
                }
                return acc + currentVal;
            }, 0);

            if (limit > 0 && (sumOtherLevels + val > limit)) {
                const tipoLabel = tipo === 'META' ? 'Metas' : 'Resultados de Diagnóstico';
                setToastMsg(`La cantidad total de ${tipoLabel} (${sumOtherLevels + val}) no puede exceder la matrícula oficial de esta sección (${limit} estudiantes).`);
                return;
            }
        }

        setManualMetas(prev => {
            const existingInPrev = prev.find(m => 
                String(m.seccion).trim().toUpperCase() === normS && 
                String(m.competencia).trim().toUpperCase() === normC && 
                m.tipo === tipo
            );
            if (existingInPrev) {
                return prev.map(m => m === existingInPrev ? { ...m, [colKey]: val } : m);
            } else {
                const newMeta: MetaData = {
                    anio: selectedYear, area: selectedArea, grado: selectedGrade, seccion, competencia, tipo,
                    cant_destacado: 0, cant_esperado: 0, cant_proceso: 0, cant_inicio: 0, cant_no_evaluado: 0,
                    [colKey]: val
                };
                return [...prev, newMeta];
            }
        });
    };

    const handleSave = async (meta: MetaData) => {
        if (!meta) return;
        const res = await saveLearningGoal(meta);
        if (res.success) { /* Sincronización exitosa */ }
    };

    const renderTable = (seccion: string, competencia: string) => {
        const currentYear = parseInt(selectedYear);
        const prevYear = currentYear - 1;

        const normS = String(seccion).trim().toUpperCase();
        const normC = String(competencia).trim().toUpperCase();

        const getLineaBaseDbCount = (lvl: string) =>
            lineaBaseStats
                .filter((s: any) =>
                    String(s.seccion).trim().toUpperCase() === normS &&
                    String(s.competencia).trim().toUpperCase() === normC &&
                    String(s.nivel_logro).trim().toUpperCase() === lvl
                )
                .reduce((a: number, b: any) => a + b.cantidad, 0);

        const getDiagDbCount = (lvl: string) => {
            const sectionStats = (statsData || []).filter((s: any) => 
                String(s.seccion).trim().toUpperCase() === normS && 
                String(s.competencia).trim().toUpperCase() === normC
            );
            const match = sectionStats.find((s: any) => String(s.nivel_logro).trim().toUpperCase() === String(lvl).trim().toUpperCase());
            return match ? match.cantidad : 0;
        };

        const isLbAuto = lineaBaseStats.some(s => 
            String(s.seccion).trim().toUpperCase() === normS && 
            String(s.competencia).trim().toUpperCase() === normC
        );

        const isDiagAuto = (statsData || []).some((s: any) => 
            String(s.seccion).trim().toUpperCase() === normS && 
            String(s.competencia).trim().toUpperCase() === normC
        );

        const lbManual = manualMetas.find(m => String(m.seccion).trim().toUpperCase() === normS && String(m.competencia).trim().toUpperCase() === normC && m.tipo === 'LINEA_BASE');
        const diagManual = manualMetas.find(m => String(m.seccion).trim().toUpperCase() === normS && String(m.competencia).trim().toUpperCase() === normC && m.tipo === 'DIAGNOSTICO');
        const metaManual = manualMetas.find(m => String(m.seccion).trim().toUpperCase() === normS && String(m.competencia).trim().toUpperCase() === normC && m.tipo === 'META');

        const totalMatriculaReal = studentMatricula[normS] || 0;
        
        const totalLBActual = ORDERED_LEVELS.reduce((acc, lvl) => acc + (getLineaBaseDbCount(lvl) || getManualCount(lbManual, lvl)), 0);
        const totalDiagActual = ORDERED_LEVELS.reduce((acc, lvl) => acc + (getDiagDbCount(lvl) || getManualCount(diagManual, lvl)), 0);
        const totalMetaActual = ORDERED_LEVELS.reduce((acc, lvl) => acc + getManualCount(metaManual, lvl), 0);

        const lbDen = totalLBActual || 1;
        const currentDen = totalMatriculaReal || 1;

        const totalLBPerc = totalLBActual > 0 ? "100.0" : "0.0";
        const totalDiagPerc = totalMatriculaReal > 0 ? ((totalDiagActual / totalMatriculaReal) * 100).toFixed(1) : "0.0";
        const totalMetaPerc = totalMatriculaReal > 0 ? ((totalMetaActual / totalMatriculaReal) * 100).toFixed(1) : "0.0";

        return (
            <div key={`${seccion}-${competencia}`} style={{ borderColor: themeColor }} className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden mb-8 animate-fade-in h-fit relative">
                <div style={{ backgroundColor: themeColor }} className="text-white p-4 font-black uppercase text-[11px] tracking-widest text-center border-b-2 border-black/10">
                    COMPETENCIA: {competencia} - {selectedGrade} "{seccion}"
                </div>
                <table className="w-full border-collapse text-center table-fixed">
                    <thead>
                        <tr className="bg-amber-50 text-[11px] font-black uppercase text-amber-900 border-b-2 border-amber-200">
                            <th className="p-3 w-1/4 border-r border-amber-200">NIVEL DE LOGRO</th>
                            <th colSpan={2} className="p-3 border-r border-amber-200 bg-amber-100/50">LÍNEA DE BASE {prevYear}</th>
                            <th colSpan={2} className="p-3 border-r border-amber-200 bg-amber-200/30">RESULTADOS DIAGNÓSTICO MARZO {currentYear}</th>
                            <th colSpan={2} className="p-3 bg-amber-100/30">META DICIEMBRE {currentYear}</th>
                        </tr>
                        <tr className="bg-amber-50/50 text-[10px] font-black uppercase text-amber-600 border-b border-amber-200">
                            <th className="py-2 border-r border-amber-200"></th>
                            <th className="py-2 border-r border-amber-100">Cantidad</th>
                            <th className="py-2 border-r border-amber-200">%</th>
                            <th className="py-2 border-r border-amber-100">Cantidad</th>
                            <th className="py-2 border-r border-amber-200">%</th>
                            <th className="py-2 border-r border-amber-100">Cantidad</th>
                            <th className="py-2">%</th>
                        </tr>
                    </thead>
                    <tbody className="text-[11px] font-bold">
                        {ORDERED_LEVELS.map(lvl => {
                            const lbVal = getLineaBaseDbCount(lvl) || getManualCount(lbManual, lvl);
                            const lbPerc = totalLBActual > 0 ? ((lbVal / lbDen) * 100).toFixed(1) : "0.0";

                            const diagVal = getDiagDbCount(lvl) || getManualCount(diagManual, lvl);
                            const diagPerc = ((diagVal / currentDen) * 100).toFixed(1);

                            const metaVal = getManualCount(metaManual, lvl);
                            const metaPerc = ((metaVal / currentDen) * 100).toFixed(1);

                            const rowColor = lvl === 'AD' ? 'text-sky-500' : lvl === 'A' ? 'text-emerald-600' : lvl === 'B' ? 'text-orange-500' : lvl === 'C' ? 'text-red-600' : 'text-slate-500';
                            return (
                                <tr key={lvl} className={`border-b border-amber-100 hover:bg-amber-50/20 transition-colors ${rowColor}`}>
                                    <td className="p-2 border-r border-amber-200 text-left pl-6 font-black uppercase tracking-tight">{LEVEL_LABELS[lvl]}</td>
                                    
                                    {/* LÍNEA DE BASE */}
                                    <td className="p-1 border-r border-amber-100 relative h-full group">
                                        <div className="relative h-full w-full">
                                            <input 
                                                type="number" 
                                                disabled={isLbAuto}
                                                className={`w-full text-center bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-amber-400 rounded transition-all font-black ${rowColor} text-[11px] disabled:cursor-not-allowed`} 
                                                value={lbVal || ''} 
                                                onChange={e => handleManualChange(seccion, competencia, 'LINEA_BASE', lvl, e.target.value)} 
                                                onBlur={() => { if (!isLbAuto) { const meta = manualMetas.find(m => String(m.seccion).trim().toUpperCase() === normS && String(m.competencia).trim().toUpperCase() === normC && m.tipo === 'LINEA_BASE'); if (meta) handleSave(meta); } }} 
                                            />
                                            {isLbAuto && (
                                                <div 
                                                    className="absolute inset-0 z-20 cursor-not-allowed opacity-0" 
                                                    onClick={() => setToastMsg("Los datos de LÍNEA DE BASE provienen del registro histórico oficial y no pueden editarse.")}
                                                />
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-2 border-r border-amber-200 opacity-80">{lbPerc}%</td>
                                    
                                    {/* DIAGNÓSTICO */}
                                    <td className="p-1 border-r border-amber-100 bg-slate-50/30 font-black relative h-full group">
                                        <div className="relative h-full w-full">
                                            <input 
                                                type="number" 
                                                disabled={isDiagAuto}
                                                className={`w-full text-center bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-amber-400 rounded transition-all font-black ${rowColor} text-[11px] disabled:cursor-not-allowed`} 
                                                value={diagVal || ''} 
                                                onChange={e => handleManualChange(seccion, competencia, 'DIAGNOSTICO', lvl, e.target.value)} 
                                                onBlur={() => { if (!isDiagAuto) { const meta = manualMetas.find(m => String(m.seccion).trim().toUpperCase() === normS && String(m.competencia).trim().toUpperCase() === normC && m.tipo === 'DIAGNOSTICO'); if (meta) handleSave(meta); } }} 
                                            />
                                            {isDiagAuto && (
                                                <div 
                                                    className="absolute inset-0 z-20 cursor-not-allowed opacity-0" 
                                                    onClick={() => setToastMsg("Los RESULTADOS DE DIAGNÓSTICO provienen del módulo de evaluaciones oficial y no pueden editarse aquí.")}
                                                />
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-2 border-r border-amber-200 bg-slate-50/30 opacity-80">{diagPerc}%</td>
                                    
                                    {/* METAS */}
                                    <td className="p-1 border-r border-amber-100">
                                        <input 
                                            type="number" 
                                            className={`w-full text-center bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-amber-400 rounded transition-all font-black ${rowColor} text-[11px]`} 
                                            value={metaVal || ''} 
                                            onChange={e => handleManualChange(seccion, competencia, 'META', lvl, e.target.value)} 
                                            onBlur={() => { const meta = manualMetas.find(m => String(m.seccion).trim().toUpperCase() === normS && String(m.competencia).trim().toUpperCase() === normC && m.tipo === 'META'); if (meta) handleSave(meta); }} 
                                        />
                                    </td>
                                    <td className="p-2 opacity-80">{metaPerc}%</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot className="bg-amber-100/20 font-black text-slate-800 text-[11px] border-t-2 border-amber-200">
                        <tr className="h-10">
                            <td className="border-r border-amber-200 uppercase tracking-widest">TOTAL</td>
                            <td className="border-r border-amber-100">{totalLBActual}</td>
                            <td className="border-r border-amber-200">{totalLBPerc}%</td>
                            <td className="border-r border-amber-100">{totalDiagActual}</td>
                            <td className="border-r border-amber-200">{totalDiagPerc}%</td>
                            <td className="border-r border-amber-100 bg-blue-50 text-blue-800">
                                {totalMetaActual} / {totalMatriculaReal}
                            </td>
                            <td className="bg-blue-50 text-blue-800 font-black">
                                {totalMetaPerc}%
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    return (
        <>
            {toastMsg && <InfoToast message={toastMsg} onClose={() => setToastMsg(null)} />}
            
            <div className="animate-fade-in space-y-8 pb-10 overflow-visible relative">
                <div style={{ backgroundColor: themeColor }} className="text-white p-8 rounded-[3rem] shadow-2xl relative overflow-visible border-t-4 border-white/20 border-x border-b border-black/10 z-50 transition-colors duration-500">
                    {/* Selector de Tema */}
                    <div className="absolute top-6 right-8 flex items-center gap-3">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Personalizar Tema</span>
                        <div className="relative group">
                            <div 
                                className="w-10 h-10 rounded-full border-2 border-white/40 shadow-lg cursor-pointer overflow-hidden transition-transform hover:scale-110 active:scale-95"
                                style={{ backgroundColor: themeColor }}
                            >
                                <input 
                                    type="color" 
                                    value={themeColor} 
                                    onChange={(e) => setThemeColor(e.target.value)}
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    title="Elegir color RGB"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row justify-between items-center gap-8">
                        <div className="flex items-center gap-5">
                            <div className="bg-white/20 p-4 rounded-3xl border border-white/30 shadow-inner backdrop-blur-md">
                                <span className="text-4xl drop-shadow-lg">📈</span>
                            </div>
                            <div className="flex flex-col">
                                <h1 className="text-3xl font-black italic font-serif tracking-tight uppercase leading-none">Metas de Aprendizaje</h1>
                                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60 mt-2">Proyecciones y Línea de Base Curricular</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4 bg-black/10 p-6 rounded-[2.5rem] border border-white/10 backdrop-blur-xl items-end shadow-inner overflow-visible">
                        <div className="relative z-[60]">
                            <Select label="ÁREA" name="area" options={areaOptions} value={selectedArea} onChange={e => { setSelectedArea(e.target.value); setSelectedGrade(''); }} labelClassName="text-white ml-2 text-[9px] font-black" valueClassName="text-slate-800" />
                        </div>
                        <div className="relative z-[60]">
                            <Select label="GRADO" name="grade" options={gradeOptions} value={selectedGrade} onChange={e => setSelectedGrade(e.target.value)} disabled={!selectedArea} labelClassName="text-white ml-2 text-[9px] font-black" valueClassName="text-slate-800" />
                        </div>
                        <div className="md:col-span-2">
                            <div className="flex items-center gap-3 bg-white/10 px-6 py-3 rounded-2xl border border-white/10 shadow-inner">
                                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"></div>
                                <span className="text-[9px] font-black uppercase tracking-widest text-white">Sincronización de totales por matrícula oficial</span>
                            </div>
                        </div>
                    </div>
                </div>

                {!selectedGrade || competenciesList.length === 0 ? (
                    <div className="p-24 text-center border-4 border-dashed border-slate-200 rounded-[4rem] bg-slate-50/20 text-slate-300 flex flex-col items-center">
                        <div className="text-8xl mb-8 grayscale opacity-20 animate-pulse">📊</div>
                        <p className="font-black uppercase tracking-[0.3em] text-xs max-w-sm leading-loose">Seleccione Área y Grado para cargar la matriz de metas comparativas JEC/JER.</p>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {sectionsForSelectedGrade.map(seccion => (
                            <div key={seccion} className="space-y-6 animate-fade-in">
                                <div className="flex justify-between items-center px-4">
                                    <h2 className="text-xl font-black text-slate-700 uppercase tracking-tighter flex items-center gap-4 bg-white w-fit px-8 py-2 rounded-full border-2 border-slate-100 shadow-sm">
                                        <span style={{ backgroundColor: themeColor }} className="text-white w-8 h-8 rounded-full flex items-center justify-center text-[11px] shadow-md transition-colors duration-500">{seccion}</span>
                                        SECCIÓN "{seccion}" - ANÁLISIS DE METAS
                                    </h2>
                                </div>
                                {competenciesList.map(comp => renderTable(seccion, comp))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};
