import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getAllSesiones, getDatosGenerales, getSessionWordGenerationStatus, getSessionWordTemplateFields, openSessionWordFolder, pickSessionWordFolder, startSessionWordGeneration } from '../services/apiService';
import { TeachingAssignment } from '../types';
import { Select } from './Select';
import { InternalToast } from './sessions-view/overlays';
import { WordNumberFilter } from './sessions-view/WordNumberFilter';
import { WordMarkerGroups } from './sessions-view/WordMarkerGroups';
import { matchesMergeSection, matchesMergeNumbers, toggleVisibleSessionIds } from '../utils/sessionWordMerge';

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
    const [filterUnits, setFilterUnits] = useState<string[]>(selectedUnitNumber ? [selectedUnitNumber] : []);
    const [filterSessions, setFilterSessions] = useState<string[]>(selectedSessionNumber ? [selectedSessionNumber] : []);
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
        atomic.forEach(value => {
            if (!options.some(option => option.value === value)) options.push({ value, label: value });
        });
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
        if (filterSection) rows = rows.filter(row => matchesMergeSection(String(row.section || ''), filterSection));
        return Array.from(new Set(rows.map(r => String(r.unitNumber || '').trim()).filter(Boolean))).sort((a, b) => Number(a) - Number(b)).map(value => ({ value, label: `Unidad ${value}` }));
    }, [resolvedSessions, filterArea, filterGrade, filterSection]);

    const uniqueSessionNumbers = useMemo(() => {
        let rows = resolvedSessions;
        if (filterArea) rows = rows.filter(r => matchesAreaFilter(r, filterArea));
        if (filterGrade) rows = rows.filter(r => r.grade === filterGrade);
        if (filterSection) rows = rows.filter(row => matchesMergeSection(String(row.section || ''), filterSection));
        if (filterUnits.length) rows = rows.filter(row => matchesMergeNumbers(row.unitNumber, filterUnits));
        return Array.from(new Set(rows.map(r => String(r.sessionNumber || '').trim()).filter(Boolean))).sort((a, b) => Number(a) - Number(b)).map(value => ({ value, label: `Sesión ${value}` }));
    }, [resolvedSessions, filterArea, filterGrade, filterSection, filterUnits]);

    const filteredList = useMemo(() => resolvedSessions.filter(row =>
        matchesAreaFilter(row, filterArea) && (!filterGrade || row.grade === filterGrade)
        && matchesMergeSection(String(row.section || ''), filterSection)
        && matchesMergeNumbers(row.unitNumber, filterUnits)
        && matchesMergeNumbers(row.sessionNumber, filterSessions)
    ), [resolvedSessions, filterArea, filterGrade, filterSection, filterUnits, filterSessions]);
    const visibleIds = filteredList.map(row => row.id);
    const allFilteredSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
    const hiddenSelectedCount = selectedIds.filter(id => !visibleIds.includes(id)).length;
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    const handleToggleAll = () => setSelectedIds(current => toggleVisibleSessionIds(current, visibleIds));
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
        setFilterUnits([]);
        setFilterSessions([]);
    };

    if (loading) {
        return <div className="flex flex-col items-center justify-center h-[60vh] gap-4"><div className="w-12 h-12 border-4 border-fuchsia-500 border-t-transparent rounded-full animate-spin"></div><p className="font-black uppercase tracking-widest text-[10px] text-slate-400">Cargando...</p></div>;
    }

    return (
        <div className="session-word-merge min-w-0 animate-fade-in space-y-4 pb-20">
            {toast && <InternalToast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

            <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-2xl relative overflow-hidden border border-slate-800">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500" aria-hidden="true"></div>
                <div className="flex flex-wrap justify-between items-center gap-3 relative z-10">
                    <div className="flex min-w-0 items-center gap-3">
                        <button onClick={onBack} className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group"><span className="text-xl group-hover:-translate-x-1 transition-transform">&larr;</span></button>
                        <div className="min-w-0">
                            <h1 className="break-words text-xl sm:text-2xl font-black tracking-tight uppercase leading-tight">Correspondencia Sesiones</h1>
                            <p className="text-[10px] font-black text-fuchsia-300 uppercase tracking-widest mt-1">Exportacion Word desde Sesiones de Aprendizaje</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Motor ARMI Word SES</span>
                        <span className="text-[10px] font-bold text-emerald-500">Base: sesiones</span>
                    </div>
                </div>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-4">
                    <div className="min-w-0 bg-white p-4 rounded-3xl shadow-lg border border-slate-200">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-3"><span className="w-2 h-4 bg-fuchsia-500 rounded-full"></span> 1. Destino de Salida</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Carpeta de Exportacion</label>
                                <div className="flex min-w-0 gap-2">
                                    <input type="text" placeholder="Seleccione o escriba ruta..." className="min-w-0 flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-all shadow-inner" value={customPath} onChange={(e) => setCustomPath(e.target.value)} />
                                    <button onClick={handleFolderPick} className="w-10 h-10 shrink-0 bg-slate-100 hover:bg-fuchsia-600 hover:text-white border border-slate-200 rounded-2xl flex items-center justify-center transition-all shadow-sm" title="Seleccionar carpeta de destino"><span className="text-xl">+</span></button>
                                </div>
                            </div>
                            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 transition-colors hover:text-violet-700">
                                <input type="checkbox" checked={anchorPath} onChange={event => setAnchorPath(event.target.checked)} className="h-4 w-4 shrink-0 rounded border-slate-300 accent-violet-600" />
                                <span>Recordar esta ruta</span>
                            </label>
                            <div className="flex gap-2 h-11">
                                <button onClick={handleGenerate} disabled={progress.active || selectedIds.length === 0} className={`flex-1 rounded-[2rem] text-white transition-all flex items-center justify-center shadow-2xl bg-fuchsia-600 ${progress.active || selectedIds.length === 0 ? 'opacity-50 grayscale' : 'hover:scale-105 active:scale-95'}`} title="Iniciar exportacion de sesiones">{progress.active ? <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin"></div> : <span className="text-xs font-black">Exportar Word</span>}</button>
                                {finished && !progress.active && <button onClick={() => openSessionWordFolder(progress.outputPath || customPath)} className="w-16 bg-white border border-slate-200 rounded-[2rem] flex items-center justify-center hover:bg-slate-50 transition-all shadow-lg text-[10px] font-black uppercase tracking-widest" title="Abrir Carpeta">Abrir</button>}
                            </div>
                        </div>
                    </div>

                    {(progress.active || finished || !!progress.error) && (
                        <div className="bg-slate-900 p-4 rounded-3xl shadow-lg border border-slate-800 animate-fade-in relative overflow-hidden">
                            <div className="flex justify-between items-center mb-6 relative z-10"><span className="text-[10px] font-black text-white uppercase tracking-widest">Progreso de Generacion</span>{progress.active && <span className="text-xl font-black font-mono text-fuchsia-400">{percent}%</span>}</div>
                            <div className="h-4 bg-white/10 rounded-full overflow-hidden border border-white/5 mb-4 shadow-inner"><div className="h-full transition-all duration-700 ease-out bg-gradient-to-r from-fuchsia-500 to-indigo-500" style={{ width: `${progress.active ? percent : finished ? 100 : 0}%` }}></div></div>
                            <div className="flex flex-col gap-1 relative z-10">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter truncate">{finished ? 'Exportacion de sesiones completada' : progress.error ? `Error: ${progress.error}` : `Procesando: ${progress.lastFile || 'Inicializando...'}`}</p>
                                {!!(progress.outputPath || customPath) && <p className="text-[10px] text-slate-300 font-mono break-all">{progress.outputPath || customPath}</p>}
                            </div>
                        </div>
                    )}

                    <WordMarkerGroups templateFields={templateFields} suggested={sessionMarkers} onError={msg => setToast({ msg, type: 'warning' })} />
                </div>

                <div className="min-w-0 bg-white rounded-3xl shadow-lg border border-slate-200 flex flex-col min-h-[520px]">
                    <div className="rounded-t-3xl border-b border-slate-100 bg-slate-50 p-4">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0"><h4 className="text-base font-black text-slate-800">Registros de sesiones</h4><p className="mt-0.5 text-[11px] font-semibold text-slate-500">{filteredList.length} visibles · <span className="text-violet-700">{selectedIds.length} marcadas para exportar</span>{hiddenSelectedCount > 0 && <span className="text-amber-700"> · {hiddenSelectedCount} fuera del filtro</span>}</p></div>
                            <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                                {selectedIds.length > 0 && <button type="button" onClick={() => setSelectedIds([])} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600">Limpiar selección</button>}
                                {(filterArea || filterGrade || filterSection || filterUnits.length > 0 || filterSessions.length > 0) && <button type="button" onClick={clearFilters} className="rounded-lg bg-violet-100 px-2.5 py-1.5 text-violet-700">Limpiar filtros</button>}
                            </div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
                            <div className="w-full min-w-0 sm:w-56"><Select label="Área" name="area" options={uniqueAreas} value={filterArea} onChange={(e) => { setFilterArea(e.target.value); setFilterGrade(''); setFilterSection(''); setFilterUnits([]); setFilterSessions([]); }} searchable variant="compact" placeholder="Todas" /></div>
                            <div className="w-20 min-w-0"><Select label="Grado" name="grade" options={uniqueGrades} value={filterGrade} onChange={(e) => { setFilterGrade(e.target.value); setFilterSection(''); setFilterUnits([]); setFilterSessions([]); }} searchable variant="compact" placeholder="Todos" /></div>
                            <div className="w-24 min-w-0"><Select label="Sección" name="section" options={uniqueSections} value={filterSection} onChange={(e) => { setFilterSection(e.target.value); setFilterUnits([]); setFilterSessions([]); }} searchable variant="compact" placeholder="Todas" /></div>
                            <div className="w-28 min-w-0"><WordNumberFilter label="Unidad" prefix="U" options={uniqueUnits} values={filterUnits} onChange={values => { setFilterUnits(values); setFilterSessions([]); }} /></div>
                            <div className="w-28 min-w-0"><WordNumberFilter label="Sesión" prefix="S" options={uniqueSessionNumbers} values={filterSessions} onChange={setFilterSessions} /></div>
                        </div>
                    </div>

                    <div className="min-w-0 flex-1 overflow-auto rounded-b-3xl custom-scrollbar">
                        <table className="w-full min-w-[640px] text-left border-collapse table-fixed">
                            <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-20 shadow-md">
                                <tr className="divide-x divide-white/10">
                                    <th className="p-3 w-10 text-center"><button type="button" aria-label={allFilteredSelected ? 'Desmarcar sesiones visibles' : 'Marcar sesiones visibles'} onClick={handleToggleAll} className={`w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${allFilteredSelected ? 'bg-fuchsia-600 border-fuchsia-600 shadow-lg' : 'bg-white/10 border-white/20'}`}>{allFilteredSelected && <span className="text-[10px]">OK</span>}</button></th>
                                    <th className="p-3 w-10 text-center">N</th>
                                    <th className="p-3">Area</th>
                                    <th className="p-3 w-16 text-center">Grado</th>
                                    <th className="p-3 w-16 text-center">Secc.</th>
                                    <th className="p-3 w-16 text-center">Unidad</th>
                                    <th className="p-3 w-16 text-center">Sesion</th>
                                    <th className="p-3">Titulo</th>
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
                                            <td className="p-3 text-center"><div className={`mx-auto w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${checked ? 'bg-fuchsia-600 border-fuchsia-600 shadow-md text-white text-[9px] font-black' : 'bg-slate-100 border-slate-300'}`}>{checked && 'OK'}</div></td>
                                            <td className="p-3 text-center font-mono text-[10px] text-slate-400">{index + 1}</td>
                                            <td className={`p-3 font-black uppercase text-[11px] ${checked ? 'text-fuchsia-700' : 'text-slate-700'}`}>{areaLabel}</td>
                                            <td className="p-3 text-center text-[11px] font-bold text-slate-600">{row.grade || '-'}</td>
                                            <td className="p-3 text-center text-[11px] font-bold text-slate-600">{row.section || '-'}</td>
                                            <td className="p-3 text-center text-[11px] font-bold text-slate-600">U{row.unitNumber || '-'}</td>
                                            <td className="p-3 text-center text-[11px] font-bold text-slate-600">S{row.sessionNumber || '-'}</td>
                                            <td className="p-3 text-[11px] font-bold text-slate-600 truncate" title={row.title || 'Sin título'}>{row.title || 'Sin titulo'}</td>
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
