import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getAllSesiones, getDatosGenerales, getSessionWordGenerationStatus, getSessionWordTemplateFields, openSessionWordFolder, pickSessionWordFolder, startSessionWordGeneration } from '../services/apiService';
import { TeachingAssignment } from '../types';
import { Select } from './Select';
import { InternalToast } from './sessions-view/overlays';

interface Props {
    onBack: () => void;
    selectedAreaId?: string;
    selectedGrade?: string;
    selectedSection?: string;
    selectedUnitNumber?: string;
    selectedSessionNumber?: string;
}

interface SessionRow {
    id: string;
    areaId?: string;
    areaName?: string;
    grade?: string;
    section?: string;
    unitNumber?: string | number;
    sessionNumber?: string | number;
    title?: string;
}

interface ProgressState {
    active: boolean;
    total: number;
    current: number;
    lastFile: string;
    error: string | null;
    outputPath: string;
    generatedCount: number;
    missingIds: string[];
}

const EMPTY_PROGRESS: ProgressState = { active: false, total: 0, current: 0, lastFile: '', error: null, outputPath: '', generatedCount: 0, missingIds: [] };

const dedupeMarkers = (values: string[]) => {
    const seen = new Set<string>();
    return values.filter(v => {
        const key = String(v || '').trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.localeCompare(b, 'es'));
};

const splitSectionTokens = (section: string) => String(section || '').split(/,| y /i).map(p => p.trim()).filter(Boolean);
const normalizeValue = (value: string) => String(value || '').trim().toLowerCase();

export const SessionTemplateMergeView: React.FC<Props> = ({
    onBack,
    selectedAreaId = '',
    selectedGrade = '',
    selectedSection = '',
    selectedUnitNumber = '',
    selectedSessionNumber = ''
}) => {
    const [loading, setLoading] = useState(true);
    const [finished, setFinished] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null);
    const [allSessions, setAllSessions] = useState<SessionRow[]>([]);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    const [customPath, setCustomPath] = useState('');
    const [anchorPath, setAnchorPath] = useState(false);
    const [templateFields, setTemplateFields] = useState<string[]>([]);
    const [sessionMarkers, setSessionMarkers] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [filterArea, setFilterArea] = useState(selectedAreaId);
    const [filterGrade, setFilterGrade] = useState(selectedGrade);
    const [filterSection, setFilterSection] = useState(selectedSection);
    const [filterUnit, setFilterUnit] = useState(selectedUnitNumber);
    const [filterSession, setFilterSession] = useState(selectedSessionNumber);
    const [progress, setProgress] = useState<ProgressState>(EMPTY_PROGRESS);
    const pollingRef = useRef<number | null>(null);
    const autoOpenedFolderRef = useRef(false);

    useEffect(() => {
        const load = async () => {
            try {
                const saved = localStorage.getItem('armi_assignments');
                if (saved) {
                    try { setAssignments(JSON.parse(saved) as TeachingAssignment[]); } catch {}
                }
                const [generalData, templateInfo, sessionsMap] = await Promise.all([
                    getDatosGenerales(),
                    getSessionWordTemplateFields(),
                    getAllSesiones()
                ]);
                if (generalData?.path_word_default) {
                    setCustomPath(generalData.path_word_default);
                    setAnchorPath(true);
                }
                if (templateInfo.success) {
                    setTemplateFields(Array.isArray(templateInfo.fields) ? templateInfo.fields : []);
                    setSessionMarkers(Array.isArray(templateInfo.sessionMarkers) ? templateInfo.sessionMarkers : []);
                }
                setAllSessions(Object.values(sessionsMap || {}) as SessionRow[]);
            } catch (error) {
                console.error('Error loading session merge view', error);
                setToast({ msg: 'No se pudo cargar la combinacion de correspondencia de sesiones.', type: 'error' });
            } finally {
                setLoading(false);
            }
        };
        load();
        return () => { if (pollingRef.current) window.clearInterval(pollingRef.current); };
    }, []);

    useEffect(() => {
        if (progress.error) setToast({ msg: progress.error, type: 'error' });
    }, [progress.error]);

    useEffect(() => {
        if (!finished || progress.error || autoOpenedFolderRef.current) return;
        const path = progress.outputPath || customPath;
        if (!path) return;
        autoOpenedFolderRef.current = true;
        openSessionWordFolder(path).catch(() => undefined);
    }, [finished, progress.error, progress.outputPath, customPath]);

    const resolvedSessions = useMemo(() => allSessions.map(row => {
        const rowAreaId = normalizeValue(String(row.areaId || ''));
        const rowAreaName = normalizeValue(String(row.areaName || ''));
        const found = assignments.find(a => {
            const assignmentAreaId = normalizeValue(String(a.areaId || ''));
            const assignmentAreaName = normalizeValue(String(a.areaName || ''));
            return (rowAreaId && assignmentAreaId === rowAreaId)
                || (rowAreaName && assignmentAreaName === rowAreaName)
                || (rowAreaId && assignmentAreaName === rowAreaId)
                || (rowAreaName && assignmentAreaId === rowAreaName);
        });
        return found ? { ...row, areaName: row.areaName || found.areaName } : row;
    }), [allSessions, assignments]);

    const matchesAreaFilter = (row: SessionRow, selectedArea: string) => {
        if (!selectedArea) return true;
        const selected = normalizeValue(selectedArea);
        const rowAreaId = normalizeValue(String(row.areaId || ''));
        const rowAreaName = normalizeValue(String(row.areaName || ''));
        return rowAreaId === selected || rowAreaName === selected;
    };

    const uniqueAreas = useMemo(() => {
        const map = new Map<string, string>();
        resolvedSessions.forEach(row => {
            const id = String(row.areaId || '').trim();
            if (!id) return;
            map.set(id, String(row.areaName || row.areaId || '').trim() || id);
        });
        return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([value, label]) => ({ value, label }));
    }, [resolvedSessions]);

    const uniqueGrades = useMemo(() => {
        const rows = filterArea ? resolvedSessions.filter(r => matchesAreaFilter(r, filterArea)) : resolvedSessions;
        return Array.from(new Set(rows.map(r => String(r.grade || '').trim()).filter(Boolean))).sort().map(value => ({ value, label: value }));
    }, [resolvedSessions, filterArea]);

    const uniqueSections = useMemo(() => {
        let rows = resolvedSessions;
        if (filterArea) rows = rows.filter(r => matchesAreaFilter(r, filterArea));
        if (filterGrade) rows = rows.filter(r => r.grade === filterGrade);
        const base = Array.from(new Set(rows.map(r => String(r.section || '').trim()).filter(Boolean))).sort();
        const options = base.map(value => ({ value, label: value }));
        const atomic = Array.from(new Set(base.flatMap(splitSectionTokens))).sort();
        if (atomic.length > 1) {
            const last = atomic[atomic.length - 1];
            const rest = atomic.slice(0, -1);
            const joined = atomic.length === 2 ? `${atomic[0]} y ${atomic[1]}` : `${rest.join(', ')} y ${last}`;
            if (!options.some(item => item.value === joined)) options.push({ value: joined, label: joined });
        }
        return options;
    }, [resolvedSessions, filterArea, filterGrade]);

    const uniqueUnits = useMemo(() => {
        let rows = resolvedSessions;
        if (filterArea) rows = rows.filter(r => matchesAreaFilter(r, filterArea));
        if (filterGrade) rows = rows.filter(r => r.grade === filterGrade);
        if (filterSection) {
            const requested = splitSectionTokens(filterSection.toUpperCase());
            rows = rows.filter(r => {
                const current = String(r.section || '').trim().toUpperCase();
                return current === filterSection.toUpperCase() || splitSectionTokens(current).some(piece => requested.includes(piece));
            });
        }
        return Array.from(new Set(rows.map(r => String(r.unitNumber || '').trim()).filter(Boolean))).sort((a, b) => Number(a) - Number(b)).map(value => ({ value, label: `Unidad ${value}` }));
    }, [resolvedSessions, filterArea, filterGrade, filterSection]);

    const uniqueSessionNumbers = useMemo(() => {
        let rows = resolvedSessions;
        if (filterArea) rows = rows.filter(r => matchesAreaFilter(r, filterArea));
        if (filterGrade) rows = rows.filter(r => r.grade === filterGrade);
        if (filterSection) rows = rows.filter(r => String(r.section || '') === filterSection);
        if (filterUnit) rows = rows.filter(r => String(r.unitNumber || '') === String(filterUnit));
        return Array.from(new Set(rows.map(r => String(r.sessionNumber || '').trim()).filter(Boolean))).sort((a, b) => Number(a) - Number(b)).map(value => ({ value, label: `Sesion ${value}` }));
    }, [resolvedSessions, filterArea, filterGrade, filterSection, filterUnit]);

    const sectionTokens = useMemo(() => splitSectionTokens(filterSection.toUpperCase()), [filterSection]);
    const filteredList = useMemo(() => resolvedSessions.filter(row => {
        const areaMatch = matchesAreaFilter(row, filterArea);
        const gradeMatch = !filterGrade || row.grade === filterGrade;
        const currentSection = String(row.section || '').trim().toUpperCase();
        const exactSection = currentSection === String(filterSection || '').trim().toUpperCase();
        const groupedSection = sectionTokens.length > 0 && splitSectionTokens(currentSection).some(piece => sectionTokens.includes(piece));
        const sectionMatch = !filterSection || exactSection || groupedSection;
        const unitMatch = !filterUnit || String(row.unitNumber || '') === String(filterUnit);
        const sessionMatch = !filterSession || String(row.sessionNumber || '') === String(filterSession);
        return areaMatch && gradeMatch && sectionMatch && unitMatch && sessionMatch;
    }), [resolvedSessions, filterArea, filterGrade, filterSection, filterUnit, filterSession, sectionTokens]);

    const allFilteredSelected = filteredList.length > 0 && selectedIds.length === filteredList.length;
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    const dedupedTemplateFields = useMemo(() => dedupeMarkers(templateFields), [templateFields]);
    const dedupedSessionMarkers = useMemo(() => dedupeMarkers(sessionMarkers), [sessionMarkers]);

    const handleToggleAll = () => setSelectedIds(allFilteredSelected ? [] : filteredList.map(row => row.id));
    const handleToggleOne = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);

    const startPolling = () => {
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        pollingRef.current = window.setInterval(async () => {
            try {
                const status = await getSessionWordGenerationStatus();
                setProgress({
                    active: !!status.active,
                    total: Number(status.total || 0),
                    current: Number(status.current || 0),
                    lastFile: String(status.lastFile || ''),
                    error: status.error ? String(status.error) : null,
                    outputPath: String(status.outputPath || ''),
                    generatedCount: Number(status.generatedCount || 0),
                    missingIds: Array.isArray(status.missingIds) ? status.missingIds : []
                });
                if (!status.active) {
                    if (pollingRef.current) window.clearInterval(pollingRef.current);
                    setFinished(!status.error);
                }
            } catch {
                if (pollingRef.current) window.clearInterval(pollingRef.current);
                setProgress(prev => ({ ...prev, active: false, error: 'No se pudo consultar el progreso de generacion.' }));
            }
        }, 900);
    };

    const handleGenerate = async () => {
        if (selectedIds.length === 0) {
            setToast({ msg: 'Seleccione al menos una sesion para generar documentos.', type: 'warning' });
            return;
        }
        autoOpenedFolderRef.current = false;
        setFinished(false);
        setProgress({ ...EMPTY_PROGRESS, active: true, total: selectedIds.length });
        const response = await startSessionWordGeneration(selectedIds, customPath, anchorPath);
        if (!response.success) {
            const message = response.message || 'No se pudo iniciar la combinacion de correspondencia.';
            setProgress(prev => ({ ...prev, active: false, error: message }));
            setToast({ msg: message, type: 'error' });
            return;
        }
        startPolling();
    };

    const handleFolderPick = async () => {
        const result = await pickSessionWordFolder();
        if (result.success && result.path) {
            setCustomPath(result.path);
            return;
        }
        if (!result.cancelled && result.message) setToast({ msg: result.message, type: 'error' });
    };

    const clearFilters = () => {
        setFilterArea('');
        setFilterGrade('');
        setFilterSection('');
        setFilterUnit('');
        setFilterSession('');
    };

    if (loading) {
        return <div className="flex flex-col items-center justify-center h-[60vh] gap-4"><div className="w-12 h-12 border-4 border-fuchsia-500 border-t-transparent rounded-full animate-spin"></div><p className="font-black uppercase tracking-widest text-[10px] text-slate-400">Cargando...</p></div>;
    }

    return (
        <div className="animate-fade-in space-y-6 pb-20 overflow-visible">
            {toast && <InternalToast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

            <div className="bg-slate-900 text-white p-8 rounded-[3rem] shadow-2xl relative overflow-visible border border-slate-800">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500 rounded-t-[3rem]"></div>
                <div className="flex justify-between items-center relative z-10">
                    <div className="flex items-center gap-5">
                        <button onClick={onBack} className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group"><span className="text-xl group-hover:-translate-x-1 transition-transform">&larr;</span></button>
                        <div>
                            <h1 className="text-3xl font-black tracking-tight uppercase leading-none italic">Correspondencia Sesiones</h1>
                            <p className="text-[10px] font-black text-fuchsia-300 uppercase tracking-[0.4em] mt-2">Exportacion Word desde Sesiones de Aprendizaje</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Motor ARMI Word SES</span>
                        <span className="text-[10px] font-bold text-emerald-500">Base: sesiones</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 overflow-visible">
                <div className="space-y-6">
                    <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-200">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-3"><span className="w-2 h-4 bg-fuchsia-500 rounded-full"></span> 1. Destino de Salida</h3>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Carpeta de Exportacion</label>
                                <div className="flex gap-2">
                                    <input type="text" placeholder="Seleccione o escriba ruta..." className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all shadow-inner" value={customPath} onChange={(e) => setCustomPath(e.target.value)} />
                                    <button onClick={handleFolderPick} className="w-12 h-12 bg-slate-100 hover:bg-fuchsia-600 hover:text-white border border-slate-200 rounded-2xl flex items-center justify-center transition-all shadow-sm" title="Seleccionar carpeta de destino"><span className="text-xl">+</span></button>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-4 bg-fuchsia-50 rounded-2xl border border-fuchsia-100 cursor-pointer" onClick={() => setAnchorPath(!anchorPath)}>
                                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${anchorPath ? 'bg-fuchsia-600 border-fuchsia-600 shadow-md' : 'bg-white border-fuchsia-200'}`}>{anchorPath && <span className="text-white text-xs font-black">OK</span>}</div>
                                <span className="text-[10px] font-black text-fuchsia-700 uppercase tracking-tight">Recordar esta ruta</span>
                            </div>
                            <div className="flex gap-3 h-16">
                                <button onClick={handleGenerate} disabled={progress.active || selectedIds.length === 0} className={`flex-1 rounded-[2rem] text-white transition-all flex items-center justify-center shadow-2xl bg-fuchsia-600 ${progress.active || selectedIds.length === 0 ? 'opacity-50 grayscale' : 'hover:scale-105 active:scale-95'}`} title="Iniciar exportacion de sesiones">{progress.active ? <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin"></div> : <span className="text-2xl">DOC</span>}</button>
                                {finished && !progress.active && <button onClick={() => openSessionWordFolder(progress.outputPath || customPath)} className="w-16 bg-white border border-slate-200 rounded-[2rem] flex items-center justify-center hover:bg-slate-50 transition-all shadow-lg text-[10px] font-black uppercase tracking-widest" title="Abrir Carpeta">Abrir</button>}
                            </div>
                        </div>
                    </div>

                    {(progress.active || finished || !!progress.error) && (
                        <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-800 animate-fade-in relative overflow-hidden">
                            <div className="flex justify-between items-center mb-6 relative z-10"><span className="text-[10px] font-black text-white uppercase tracking-widest">Progreso de Generacion</span>{progress.active && <span className="text-xl font-black font-mono text-fuchsia-400">{percent}%</span>}</div>
                            <div className="h-4 bg-white/10 rounded-full overflow-hidden border border-white/5 mb-4 shadow-inner"><div className="h-full transition-all duration-700 ease-out bg-gradient-to-r from-fuchsia-500 to-indigo-500" style={{ width: `${progress.active ? percent : finished ? 100 : 0}%` }}></div></div>
                            <div className="flex flex-col gap-1 relative z-10">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter truncate">{finished ? 'Exportacion de sesiones completada' : progress.error ? `Error: ${progress.error}` : `Procesando: ${progress.lastFile || 'Inicializando...'}`}</p>
                                {!!(progress.outputPath || customPath) && <p className="text-[10px] text-slate-300 font-mono break-all">{progress.outputPath || customPath}</p>}
                            </div>
                        </div>
                    )}

                    <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-200">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <div>
                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">2. Campos de Plantilla</h3>
                                <p className="text-[10px] font-bold text-slate-500 mt-2">Use los campos con el formato <span className="font-mono text-slate-700">&lt;&lt;campo&gt;&gt;</span> en la plantilla de sesion.</p>
                            </div>
                            <div className="px-3 py-2 rounded-2xl bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600">{dedupedTemplateFields.length + dedupedSessionMarkers.length} marcador(es)</div>
                        </div>
                        <div className="max-h-80 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Campos Word</p>
                                <div className="flex flex-wrap gap-2">{dedupedTemplateFields.length > 0 ? dedupedTemplateFields.map(marker => <button key={marker} type="button" onClick={() => navigator.clipboard?.writeText(`<<${marker}>>`)} className="px-3 py-2 rounded-2xl bg-slate-50 hover:bg-fuchsia-50 border border-slate-200 hover:border-fuchsia-200 text-[10px] font-mono font-bold text-slate-700 transition-colors">{`<<${marker}>>`}</button>) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center w-full">No se pudieron leer los campos de la plantilla.</div>}</div>
                            </div>
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Marcadores Sugeridos</p>
                                <div className="flex flex-wrap gap-2">{dedupedSessionMarkers.length > 0 ? dedupedSessionMarkers.map(marker => <button key={marker} type="button" onClick={() => navigator.clipboard?.writeText(`<<${marker}>>`)} className="px-3 py-2 rounded-2xl bg-fuchsia-50 hover:bg-fuchsia-100 border border-fuchsia-200 text-[10px] font-mono font-bold text-fuchsia-800 transition-colors">{`<<${marker}>>`}</button>) : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center w-full">No se pudieron leer los bloques especiales de la plantilla.</div>}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white rounded-[3.5rem] shadow-2xl border border-slate-200 overflow-visible flex flex-col min-h-[600px]">
                    <div className="bg-slate-50 p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 overflow-visible rounded-t-[3.5rem]">
                        <div className="flex flex-col">
                            <h4 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Registros de Sesiones</h4>
                            <span className="text-[10px] font-black text-fuchsia-500 uppercase tracking-[0.2em] mt-1">{selectedIds.length} marcados para exportar</span>
                        </div>
                        <div className="flex items-center gap-3 flex-1 justify-end overflow-visible">
                            <div className="w-40"><Select label="Area" name="area" options={uniqueAreas} value={filterArea} onChange={(e) => { setFilterArea(e.target.value); setFilterGrade(''); setFilterSection(''); setFilterUnit(''); setFilterSession(''); }} searchable={true} placeholder="Todas..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" /></div>
                            <div className="w-24"><Select label="Grado" name="grade" options={uniqueGrades} value={filterGrade} onChange={(e) => { setFilterGrade(e.target.value); setFilterSection(''); setFilterUnit(''); setFilterSession(''); }} searchable={true} placeholder="Todos..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" /></div>
                            <div className="w-24"><Select label="Seccion" name="section" options={uniqueSections} value={filterSection} onChange={(e) => { setFilterSection(e.target.value); setFilterUnit(''); setFilterSession(''); }} searchable={true} placeholder="Todas..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" /></div>
                            <div className="w-24"><Select label="Unidad" name="unit" options={uniqueUnits} value={filterUnit} onChange={(e) => { setFilterUnit(e.target.value); setFilterSession(''); }} searchable={true} placeholder="Todas..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" /></div>
                            <div className="w-24"><Select label="Sesion" name="session" options={uniqueSessionNumbers} value={filterSession} onChange={(e) => setFilterSession(e.target.value)} searchable={true} placeholder="Todas..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" /></div>
                            {(filterArea || filterGrade || filterSection || filterUnit || filterSession) && <button onClick={clearFilters} className="h-8 w-8 shrink-0 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded-full transition-colors text-sm text-slate-600" title="Limpiar Filtros">x</button>}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse table-fixed">
                            <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-20 shadow-md">
                                <tr className="divide-x divide-white/10">
                                    <th className="p-4 w-12 text-center"><button onClick={handleToggleAll} className={`w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${allFilteredSelected ? 'bg-fuchsia-600 border-fuchsia-600 shadow-lg' : 'bg-white/10 border-white/20'}`}>{allFilteredSelected && <span className="text-[10px]">OK</span>}</button></th>
                                    <th className="p-4 w-12 text-center">N</th>
                                    <th className="p-4">Area</th>
                                    <th className="p-4 w-20 text-center">Grado</th>
                                    <th className="p-4 w-20 text-center">Secc.</th>
                                    <th className="p-4 w-20 text-center">Unidad</th>
                                    <th className="p-4 w-20 text-center">Sesion</th>
                                    <th className="p-4">Titulo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredList.length === 0 ? (
                                    <tr><td colSpan={8} className="p-12 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">No hay sesiones registradas con esos filtros.</td></tr>
                                ) : filteredList.map((row, index) => {
                                    const checked = selectedIds.includes(row.id);
                                    const areaLabel = String(row.areaName || row.areaId || '').trim() || 'Sin area';
                                    return (
                                        <tr key={row.id} onClick={() => handleToggleOne(row.id)} className={`cursor-pointer transition-colors group ${checked ? 'bg-fuchsia-50/50' : 'hover:bg-slate-50'}`}>
                                            <td className="p-4 text-center"><div className={`mx-auto w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${checked ? 'bg-fuchsia-600 border-fuchsia-600 shadow-md text-white text-[9px] font-black' : 'bg-slate-100 border-slate-300'}`}>{checked && 'OK'}</div></td>
                                            <td className="p-4 text-center font-mono text-[10px] text-slate-400">{index + 1}</td>
                                            <td className={`p-4 font-black uppercase text-[11px] ${checked ? 'text-fuchsia-700' : 'text-slate-700'}`}>{areaLabel}</td>
                                            <td className="p-4 text-center text-[11px] font-bold text-slate-600">{row.grade || '-'}</td>
                                            <td className="p-4 text-center text-[11px] font-bold text-slate-600">{row.section || '-'}</td>
                                            <td className="p-4 text-center text-[11px] font-bold text-slate-600">U{row.unitNumber || '-'}</td>
                                            <td className="p-4 text-center text-[11px] font-bold text-slate-600">S{row.sessionNumber || '-'}</td>
                                            <td className="p-4 text-[11px] font-bold text-slate-600 truncate">{row.title || 'Sin titulo'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
