
import React, { useState, useEffect, useMemo } from 'react';
import { GeneralData, TeachingAssignment } from '../types';
import { 
    getDatosGenerales, 
    getProgramacionesAnuales, 
    startWordGeneration, 
    getWordGenerationStatus,
    openWordFolder,
    pickWordFolder,
    getWordTemplateFields
} from '../services/apiService';
import { Select } from './Select';

interface Props {
  onBack: () => void;
  selectedAreaId?: string;
  selectedGrade?: string;
  selectedSection?: string;
}

const InternalToast: React.FC<{ message: string; type: 'success' | 'error' | 'warning'; onClose: () => void }> = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 4500);
        return () => clearTimeout(timer);
    }, [onClose]);

    const bgClass = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-amber-500';
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '!';

    return (
        <div className="fixed top-8 right-8 z-[100000] w-full max-w-md pointer-events-none">
            <div className={`${bgClass} text-white px-6 py-4 rounded-[2rem] shadow-2xl border border-white/20 flex items-center gap-4 pointer-events-auto`}>
                <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-lg font-black shrink-0">{icon}</div>
                <p className="text-[11px] font-black uppercase tracking-tight flex-1">{message}</p>
                <button onClick={onClose} className="text-white/80 hover:text-white text-lg">✕</button>
            </div>
        </div>
    );
};

export const TemplateMergeView: React.FC<Props> = ({ 
  onBack, 
  selectedAreaId, 
  selectedGrade, 
  selectedSection 
}) => {
    const [generalData, setGeneralData] = useState<GeneralData | null>(null);
    const [allPrograms, setAllPrograms] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [finished, setFinished] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null);
    
    // Filtros
    const [filterArea, setFilterArea] = useState('');
    const [filterGrade, setFilterGrade] = useState(selectedGrade || '');
    const [filterSection, setFilterSection] = useState(selectedSection || '');
    
    // Selección
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    
    // Configuración de Ruta
    const [customPath, setCustomPath] = useState('');
    const [anchorPath, setAnchorPath] = useState(false);
    const [templateFields, setTemplateFields] = useState<string[]>([]);
    const [sessionMarkers, setSessionMarkers] = useState<string[]>([]);
    
    // Estado de Generación
    const [progress, setProgress] = useState<{ active: boolean, total: number, current: number, lastFile: string, error: string | null, outputPath: string, generatedCount: number, missingIds: string[] }>({
        active: false, total: 0, current: 0, lastFile: '', error: null, outputPath: '', generatedCount: 0, missingIds: []
    });
    
    const pollingRef = React.useRef<number | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const gd = await getDatosGenerales();
                setGeneralData(gd);
                if (gd.path_word_default) {
                    setCustomPath(gd.path_word_default);
                    setAnchorPath(true);
                }

                const templateInfo = await getWordTemplateFields();
                if (templateInfo.success) {
                    setTemplateFields(Array.isArray(templateInfo.fields) ? templateInfo.fields : []);
                    setSessionMarkers(Array.isArray(templateInfo.sessionMarkers) ? templateInfo.sessionMarkers : []);
                }

                const progs = await getProgramacionesAnuales();
                const list = Object.values(progs);
                setAllPrograms(list);

                if (selectedAreaId && selectedGrade && selectedSection) {
                    const found = list.find(p => p.areaId === selectedAreaId && p.grade === selectedGrade && p.section === selectedSection);
                    if (found) setFilterArea(found.areaName);
                }
            } catch (e) {
                console.error("Error fetching merge data", e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();

        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, [selectedAreaId, selectedGrade, selectedSection]);

    // --- LÓGICA DE FILTRADO VINCULADO ---
    
    // Opciones de Área dependen del Grado seleccionado
    const uniqueAreas = useMemo(() => {
        let filtered = allPrograms;
        if (filterGrade) {
            filtered = allPrograms.filter(p => p.grade === filterGrade);
        }
        const areas = Array.from(new Set(filtered.map(p => p.areaName))).sort();
        return areas.map(a => ({ value: a, label: a }));
    }, [allPrograms, filterGrade]);

    // Opciones de Grado dependen del Área seleccionada
    const uniqueGrades = useMemo(() => {
        let filtered = allPrograms;
        if (filterArea) {
            filtered = allPrograms.filter(p => p.areaName === filterArea);
        }
        const grades = Array.from(new Set(filtered.map(p => p.grade))).sort();
        return grades.map(g => ({ value: g, label: g }));
    }, [allPrograms, filterArea]);

    const uniqueSections = useMemo(() => {
        let filtered = allPrograms;
        if (filterArea) {
            filtered = filtered.filter(p => p.areaName === filterArea);
        }
        if (filterGrade) {
            filtered = filtered.filter(p => p.grade === filterGrade);
        }

        const sections = Array.from(new Set(filtered.map(p => String(p.section || '').trim()).filter(Boolean) as string[])).sort();
        const options = sections.map(s => ({ value: s, label: s }));

        const atomicSections = Array.from(new Set(
            sections
                .flatMap(section => section.split(/, | y /).map(s => s.trim()).filter(Boolean))
                .filter(section => !section.includes(',') && !section.includes(' y '))
        )).sort();

        if (atomicSections.length > 1) {
            const last = atomicSections[atomicSections.length - 1];
            const others = atomicSections.slice(0, -1);
            const joinedLabel = atomicSections.length === 2
                ? `${atomicSections[0]} y ${atomicSections[1]}`
                : `${others.join(', ')} y ${last}`;
            if (!options.some(option => option.value === joinedLabel)) {
                options.push({ value: joinedLabel, label: joinedLabel });
            }
        }

        return options;
    }, [allPrograms, filterArea, filterGrade]);

    const filterSectionsList = useMemo(() => {
        if (!filterSection) return [];
        return filterSection.split(/, | y /).map(s => s.trim().toUpperCase()).filter(Boolean);
    }, [filterSection]);

    const filteredList = useMemo(() => {
        return allPrograms.filter(p => {
            const areaMatch = !filterArea || p.areaName === filterArea;
            const gradeMatch = !filterGrade || p.grade === filterGrade;
            const rowSection = String(p.section || '').trim().toUpperCase();
            const rowSectionParts = rowSection.split(/, | Y /).map(s => s.trim()).filter(Boolean);
            const exactSectionMatch = p.section === filterSection;
            const groupedSectionMatch = filterSectionsList.length > 0 && (
                filterSectionsList.includes(rowSection) ||
                rowSectionParts.some(part => filterSectionsList.includes(part))
            );
            const sectionMatch = !filterSection || exactSectionMatch || groupedSectionMatch;
            return areaMatch && gradeMatch && sectionMatch;
        });
    }, [allPrograms, filterArea, filterGrade, filterSection, filterSectionsList]);

    const handleToggleAll = () => {
        if (selectedIds.length === filteredList.length) setSelectedIds([]);
        else setSelectedIds(filteredList.map(p => p.id));
    };

    const handleToggleOne = (id: string) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const startGeneration = async () => {
        if (selectedIds.length === 0) {
            setToast({ msg: 'Seleccione al menos un registro de programación anual.', type: 'warning' });
            return;
        }
        
        setFinished(false);
        setProgress({ active: true, total: selectedIds.length, current: 0, lastFile: '', error: null, outputPath: '', generatedCount: 0, missingIds: [] });

        const res = await startWordGeneration(selectedIds, customPath, anchorPath);
        if (res.success) {
            startPolling();
        } else {
            setToast({ msg: res.message || 'No se pudo iniciar la combinación masiva.', type: 'error' });
            setProgress(prev => ({ ...prev, active: false, error: res.message || 'Error desconocido' }));
        }
    };

    const startPolling = () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = window.setInterval(async () => {
            try {
                const status = await getWordGenerationStatus();
                if (!status.active || status.error) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    if (!status.error) {
                        setFinished(true);
                        setProgress(status);
                        
                        // Intento de "minimizar" o pasar atrás la ventana actual
                        // Aunque los navegadores restringen window.blur(), en entornos locales ayuda a que el explorador pase al frente
                        window.blur();
                    } else {
                        setProgress(status);
                    }
                } else {
                    setProgress(status);
                }
            } catch (e) {
                if (pollingRef.current) clearInterval(pollingRef.current);
            }
        }, 800);
    };

    const handleFolderClick = async () => {
        const result = await pickWordFolder();
        if (result.success && result.path) {
            setCustomPath(result.path);
            return;
        }

        if (!(result as any).cancelled && result.message) {
            setToast({ msg: result.message, type: 'error' });
        }
    };

    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="font-black uppercase tracking-widest text-[10px] text-slate-400">Cargando...</p>
        </div>
    );

    return (
        <div className="animate-fade-in space-y-6 pb-20 overflow-visible">
            {toast && <InternalToast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
            {/* CABECERA */}
            <div className="bg-slate-900 text-white p-8 rounded-[3rem] shadow-2xl relative overflow-visible border border-slate-800">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-600 rounded-t-[3rem]"></div>
                <div className="flex justify-between items-center relative z-10">
                    <div className="flex items-center gap-5">
                        <button onClick={onBack} className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group">
                            <span className="text-xl group-hover:-translate-x-1 transition-transform">⬅️</span>
                        </button>
                        <div>
                            <h1 className="text-3xl font-black tracking-tight uppercase leading-none italic">Correspondencia</h1>
                            <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.4em] mt-2">Exportación Masiva Word (.DOCX)</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Motor ARMI Word v4.3</span>
                        <div className="flex items-center gap-2 mt-1 justify-end">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]"></div>
                            <span className="text-[10px] font-bold text-emerald-500">SQL Sincronizado</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 overflow-visible">
                {/* PANEL DE CONFIGURACIÓN */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-200">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-3">
                            <span className="w-2 h-4 bg-blue-600 rounded-full"></span> 1. Destino de Salida
                        </h3>
                        
                        <div className="space-y-6">
                            <div className="relative group">
                                <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Carpeta de Exportación</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        placeholder="Seleccione o escriba ruta..." 
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-inner"
                                        value={customPath}
                                        onChange={e => setCustomPath(e.target.value)}
                                    />
                                    <button 
                                        onClick={handleFolderClick}
                                        className="w-12 h-12 bg-slate-100 hover:bg-blue-600 hover:text-white border border-slate-200 rounded-2xl flex items-center justify-center transition-all shadow-sm"
                                        title="Seleccionar carpeta de destino"
                                    >
                                        <span className="text-xl">📂</span>
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-4 bg-orange-50 rounded-2xl border border-orange-100 cursor-pointer" onClick={() => setAnchorPath(!anchorPath)}>
                                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${anchorPath ? 'bg-orange-500 border-orange-500 shadow-md' : 'bg-white border-orange-200'}`}>
                                    {anchorPath && <span className="text-white text-xs font-black">OK</span>}
                                </div>
                                <span className="text-[10px] font-black text-orange-700 uppercase tracking-tight">Recordar esta ruta</span>
                            </div>

                            <div className="flex gap-3 h-16">
                                <button 
                                    onClick={startGeneration}
                                    disabled={progress.active}
                                    className={`flex-1 rounded-[2rem] text-white transition-all flex items-center justify-center shadow-2xl bg-orange-500 ${progress.active ? 'opacity-50 grayscale' : 'hover:scale-105 active:scale-95'}`}
                                    title="Iniciar Combinación Masiva"
                                >
                                    {progress.active ? (
                                        <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    ) : (
                                        <span className="text-2xl">DOC</span>
                                    )}
                                </button>
                                
                                {finished && !progress.active && (
                                    <button 
                                        onClick={() => openWordFolder(progress.outputPath || customPath)}
                                        className="w-16 bg-white border border-slate-200 rounded-[2rem] flex items-center justify-center hover:bg-slate-50 transition-all shadow-lg text-2xl"
                                        title="Abrir Carpeta"
                                    >
                                        📂
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* BARRA DE PROGRESO BONITA */}
                    {(progress.active || finished) && (
                        <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-800 animate-fade-in relative overflow-hidden">
                            {finished && !progress.active && (
                                <div className="absolute inset-0 bg-emerald-500/10 pointer-events-none"></div>
                            )}
                            
                            <div className="flex justify-between items-center mb-6 relative z-10">
                                <span className="text-[10px] font-black text-white uppercase tracking-widest">Progreso de Generación</span>
                                {progress.active && (
                                    <span className="text-xl font-black font-mono text-blue-400">{percent}%</span>
                                )}
                            </div>

                            <div className="h-4 bg-white/10 rounded-full overflow-hidden border border-white/5 mb-4 shadow-inner">
                                <div 
                                    className={`h-full transition-all duration-700 ease-out shadow-[0_0_15px_rgba(59,130,246,0.5)] ${finished ? 'w-0' : 'bg-gradient-to-r from-blue-500 to-indigo-600'}`}
                                    style={{ width: `${finished ? 0 : percent}%` }}
                                ></div>
                            </div>

                            <div className="flex flex-col gap-1 relative z-10">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter truncate">
                                    {finished ? '✅ ¡Generación exitosa!' : progress.error ? '⚠️ Error en proceso' : `📄 Procesando: ${progress.lastFile || 'Inicializando...'}`}
                                </p>
                                {!!progress.outputPath && (
                                    <p className="text-[10px] text-slate-300 font-mono break-all">
                                        {progress.outputPath}
                                    </p>
                                )}
                                {progress.active && (
                                    <p className="text-[11px] font-black text-white font-mono mt-1">
                                        {progress.current} / {progress.total} Programaciones
                                    </p>
                                )}
                                {!progress.active && !progress.error && progress.generatedCount > 0 && (
                                    <p className="text-[11px] font-black text-emerald-400 mt-1">
                                        {progress.generatedCount} archivo(s) generado(s)
                                    </p>
                                )}
                            </div>

                            {progress.error && (
                                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-[9px] font-bold italic">
                                    ⚠️ ERROR: {progress.error}
                                </div>
                            )}
                            {!progress.active && !progress.error && progress.missingIds.length > 0 && (
                                <div className="mt-4 p-3 bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-300 text-[9px] font-bold italic">
                                    Se omitieron {progress.missingIds.length} registro(s) no encontrados.
                                </div>
                            )}
                        </div>
                    )}

                    <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-200">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <div>
                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">2. Campos de Plantilla</h3>
                                <p className="text-[10px] font-bold text-slate-500 mt-2">Use los campos con el formato <span className="font-mono text-slate-700">&lt;&lt;campo&gt;&gt;</span> dentro del Word.</p>
                            </div>
                            <div className="px-3 py-2 rounded-2xl bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600">
                                {templateFields.length + sessionMarkers.length} marcador(es)
                            </div>
                        </div>

                        {templateFields.length > 0 || sessionMarkers.length > 0 ? (
                            <div className="max-h-80 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                                {templateFields.length > 0 && (
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Campos Word</p>
                                        <div className="flex flex-wrap gap-2">
                                            {templateFields.map((field) => (
                                                <button
                                                    key={field}
                                                    type="button"
                                                    onClick={() => navigator.clipboard?.writeText(`<<${field}>>`)}
                                                    className="px-3 py-2 rounded-2xl bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 text-[10px] font-mono font-bold text-slate-700 transition-colors"
                                                    title={`Copiar <<${field}>>`}
                                                >
                                                    {`<<${field}>>`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {sessionMarkers.length > 0 && (
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Marcadores Detectados</p>
                                        <div className="flex flex-wrap gap-2">
                                            {sessionMarkers.map((marker) => (
                                                <button
                                                    key={marker}
                                                    type="button"
                                                    onClick={() => navigator.clipboard?.writeText(`<<${marker}>>`)}
                                                    className="px-3 py-2 rounded-2xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[10px] font-mono font-bold text-amber-800 transition-colors"
                                                    title={`Copiar <<${marker}>>`}
                                                >
                                                    {`<<${marker}>>`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
                                No se pudieron leer los campos de la plantilla.
                            </div>
                        )}
                    </div>
                </div>

                {/* TABLA DE SELECCIÓN */}
                <div className="lg:col-span-2 bg-white rounded-[3.5rem] shadow-2xl border border-slate-200 overflow-visible flex flex-col min-h-[600px]">
                    <div className="bg-slate-50 p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 overflow-visible rounded-t-[3.5rem]">
                        <div className="flex flex-col">
                            <h4 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Registros de Programación</h4>
                            <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em] mt-1">{selectedIds.length} marcados para exportar</span>
                        </div>
                        <div className="flex items-center gap-4 flex-1 justify-end overflow-visible">
                             <div className="w-48">
                                <Select 
                                    label="Filtrar por Área" 
                                    name="area" 
                                    options={uniqueAreas} 
                                    value={filterArea} 
                                    onChange={e => {
                                        setFilterArea(e.target.value);
                                        setFilterGrade('');
                                        setFilterSection('');
                                    }} 
                                    searchable={true} 
                                    placeholder="Todas las áreas..."
                                    className="h-auto"
                                    labelClassName="text-[8px] font-black text-slate-400"
                                />
                             </div>
                             <div className="w-28">
                                <Select 
                                    label="Grado" 
                                    name="grade" 
                                    options={uniqueGrades} 
                                    value={filterGrade} 
                                    onChange={e => {
                                        setFilterGrade(e.target.value);
                                        setFilterSection('');
                                    }} 
                                    searchable={true} 
                                    placeholder="Todos..."
                                    className="h-auto"
                                    labelClassName="text-[8px] font-black text-slate-400"
                                />
                             </div>
                             <div className="w-28">
                                <Select 
                                    label="Sección" 
                                    name="section" 
                                    options={uniqueSections} 
                                    value={filterSection} 
                                    onChange={e => setFilterSection(e.target.value)} 
                                    searchable={true} 
                                    placeholder="Todas..."
                                    className="h-auto"
                                    labelClassName="text-[8px] font-black text-slate-400"
                                />
                             </div>
                             {(filterArea || filterGrade || filterSection) && (
                                 <button 
                                    onClick={() => { setFilterArea(''); setFilterGrade(''); setFilterSection(''); }}
                                    className="h-8 w-8 shrink-0 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded-full transition-colors text-sm text-slate-600"
                                    title="Limpiar Filtros"
                                 >
                                     ✕
                                 </button>
                             )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse table-fixed">
                            <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-20 shadow-md">
                                <tr className="divide-x divide-white/10">
                                    <th className="p-4 w-12 text-center">
                                        <button onClick={handleToggleAll} className={`w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${selectedIds.length === filteredList.length && filteredList.length > 0 ? 'bg-orange-500 border-orange-500 shadow-lg' : 'bg-white/10 border-white/20'}`}>
                                            {selectedIds.length === filteredList.length && filteredList.length > 0 && <span className="text-[10px]">OK</span>}
                                        </button>
                                    </th>
                                    <th className="p-4 w-12 text-center">N°</th>
                                    <th className="p-4">Área Curricular</th>
                                    <th className="p-4 w-24 text-center">Grado</th>
                                    <th className="p-4 w-20 text-center">Secc.</th>
                                    <th className="p-4 w-24 text-center">Cod. PA</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredList.map((row, idx) => {
                                    const isSelected = selectedIds.includes(row.id);
                                    return (
                                        <tr 
                                            key={row.id} 
                                            onClick={() => handleToggleOne(row.id)}
                                            className={`cursor-pointer transition-colors group ${isSelected ? 'bg-orange-50/50' : 'hover:bg-slate-50'}`}
                                        >
                                            <td className="p-4 text-center">
                                                <div className={`mx-auto w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-orange-500 border-orange-500 shadow-md text-white text-[9px] font-black' : 'bg-slate-100 border-slate-300'}`}>
                                                    {isSelected && 'OK'}
                                                </div>
                                            </td>
                                            <td className="p-4 text-center font-mono text-[10px] text-slate-400">{idx + 1}</td>
                                            <td className={`p-4 font-black uppercase text-[11px] transition-colors ${isSelected ? 'text-orange-700' : 'text-slate-700'}`}>
                                                {row.areaName}
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600 uppercase">{row.grade}</span>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className="w-8 h-8 inline-flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 font-black border border-indigo-100 text-[10px]">{row.section}</span>
                                            </td>
                                            <td className="p-4 text-center font-black text-slate-400 font-mono italic">
                                                {row.nroPa || '01'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredList.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="p-24 text-center text-slate-300 italic font-black uppercase tracking-widest text-[10px] bg-slate-50/30">No hay registros con los filtros aplicados</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            <style dangerouslySetInnerHTML={{ __html: `
                .btn-water { position: relative; overflow: hidden; }
                .animate-fade-in { animation: fadeIn 0.4s ease-out; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            `}} />
        </div>
    );
};
