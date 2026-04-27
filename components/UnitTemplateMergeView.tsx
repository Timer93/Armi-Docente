import React, { useEffect, useMemo, useState } from 'react';
import { getAllUnidadesDidacticas, getDatosGenerales, getUnidadDidactica, getUnitWordGenerationStatus, getUnitWordTemplateFields, openUnitWordFolder, pickUnitWordFolder, startUnitWordGeneration } from '../services/apiService';
import { Select } from './Select';

interface Props {
  onBack: () => void;
  selectedAreaId?: string;
  selectedGrade?: string;
  selectedSection?: string;
  selectedUnitNumber?: string;
}

const InternalToast: React.FC<{ message: string; type: 'success' | 'error' | 'warning'; onClose: () => void }> = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 4500);
        return () => clearTimeout(timer);
    }, [onClose]);

    const bgClass = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-amber-500';
    const icon = type === 'success' ? 'OK' : type === 'error' ? 'X' : '!';

    return (
        <div className="fixed top-8 right-8 z-[100000] w-full max-w-md pointer-events-none">
            <div className={`${bgClass} text-white px-6 py-4 rounded-[2rem] shadow-2xl border border-white/20 flex items-center gap-4 pointer-events-auto`}>
                <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-sm font-black shrink-0">{icon}</div>
                <p className="text-[11px] font-black uppercase tracking-tight flex-1">{message}</p>
                <button onClick={onClose} className="text-white/80 hover:text-white text-lg">x</button>
            </div>
        </div>
    );
};

export const UnitTemplateMergeView: React.FC<Props> = ({
    onBack,
    selectedAreaId,
    selectedGrade,
    selectedSection,
    selectedUnitNumber
}) => {
    const [loading, setLoading] = useState(true);
    const [finished, setFinished] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null);
    const [allUnits, setAllUnits] = useState<any[]>([]);
    const [customPath, setCustomPath] = useState('');
    const [anchorPath, setAnchorPath] = useState(false);
    const [templateFields, setTemplateFields] = useState<string[]>([]);
    const [sessionMarkers, setSessionMarkers] = useState<string[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    const [filterArea, setFilterArea] = useState(selectedAreaId || '');
    const [filterGrade, setFilterGrade] = useState(selectedGrade || '');
    const [filterSection, setFilterSection] = useState(selectedSection || '');
    const [filterUnit, setFilterUnit] = useState(selectedUnitNumber || '');

    const [progress, setProgress] = useState<{ active: boolean, total: number, current: number, lastFile: string, error: string | null, outputPath: string, generatedCount: number, missingIds: string[] }>({
        active: false, total: 0, current: 0, lastFile: '', error: null, outputPath: '', generatedCount: 0, missingIds: []
    });

    const pollingRef = React.useRef<number | null>(null);
    const autoOpenedFolderRef = React.useRef(false);

    const normalizeMarker = (value: string) => String(value || '').trim().toLowerCase();
    const markerAliasMap: Record<string, string> = {
        year: 'anio',
        anio: 'anio',
        year_name: 'nombre_del_ano',
        nombre_del_ano: 'nombre_del_ano',
        area: 'area',
        area_curricular: 'area',
        grade: 'grado',
        grado: 'grado',
        section: 'seccion',
        seccion: 'seccion',
        unit_number: 'unidad',
        unidad: 'unidad',
        title: 'titulo',
        titulo: 'titulo',
        ciclo: 'ciclo',
        horas: 'horas',
        horas_sem: 'horas',
        estudiantes: 'estudiantes',
        alumnos: 'estudiantes',
        inicio: 'inicio',
        fin: 'fin',
        sesiones: 'sesiones',
        sesiones_total: 'sesiones_total',
        duracion: 'duracion',
        fecha_creacion_unidad: 'fecha_creacion_unidad',
        fecha_registro_unidad: 'fecha_creacion_unidad',
        purpose: 'proposito',
        proposito: 'proposito',
        product: 'producto',
        producto: 'producto',
        situation: 'situacion',
        situacion: 'situacion',
        teacher: 'docente',
        docente: 'docente',
        institution: 'ie',
        ie: 'ie',
        motto: 'lema',
        lema: 'lema',
        province: 'provincia',
        provincia: 'provincia',
        district: 'distrito',
        distrito: 'distrito',
        coord_ped: 'coord_ped',
        coordinador_pedagogico: 'coord_ped',
        bimestre: 'bimestre',
        tabla_propositos_aprendizaje: 'tabla_propositos_aprendizaje',
        tabla_propositos_aprendizaje_trans1: 'tabla_propositos_aprendizaje_trans1',
        tabla_propositos_aprendizaje_trans2: 'tabla_propositos_aprendizaje_trans2',
        tabla_enfoques_transversales: 'tabla_enfoques_transversales',
        tabla_sesiones_aprendizaje: 'tabla_sesiones_aprendizaje',
        tabla_recursos_educativos: 'tabla_recursos_educativos',
        'propositos_aprendizaje[].competencia': 'propositos_aprendizaje[].competencia',
        'propositos_aprendizaje[].estandar': 'propositos_aprendizaje[].estandar',
        'propositos_aprendizaje[].filas[].capacidad': 'propositos_aprendizaje[].filas[].capacidad',
        'propositos_aprendizaje[].filas[].desempeno': 'propositos_aprendizaje[].filas[].desempeno',
        'propositos_aprendizaje[].filas[].criterio': 'propositos_aprendizaje[].filas[].criterio',
        'propositos_aprendizaje[].filas[].evidencia': 'propositos_aprendizaje[].filas[].evidencia',
        'propositos_aprendizaje[].filas[].instrumento': 'propositos_aprendizaje[].filas[].instrumento',
        competencia_trans1: 'competencia_trans1',
        estandar_trans1: 'estandar_trans1',
        capacidad_trans1: 'capacidad_trans1',
        desempeno_trans1: 'desempeno_trans1',
        criterio_trans1: 'criterio_trans1',
        evidencia_trans1: 'evidencia_trans1',
        instrumento_trans1: 'instrumento_trans1',
        competencia_trans2: 'competencia_trans2',
        estandar_trans2: 'estandar_trans2',
        capacidad_trans2: 'capacidad_trans2',
        desempeno_trans2: 'desempeno_trans2',
        criterio_trans2: 'criterio_trans2',
        evidencia_trans2: 'evidencia_trans2',
        instrumento_trans2: 'instrumento_trans2',
        enfoque: 'enfoque',
        valor: 'valor',
        actitud: 'actitud',
        demuestra: 'demuestra',
        sesion_numero: 'sesion_numero',
        sesion_rotulo: 'sesion_rotulo',
        titulo_sesion: 'titulo_sesion',
        competencia_sesion: 'competencia_sesion',
        competencia: 'competencia',
        capacidad_sesion: 'capacidad_sesion',
        desempeno_sesion: 'desempeno_sesion',
        conocimiento_sesion: 'conocimiento_sesion',
        evidencia_sesion: 'evidencia_sesion',
        evaluacion_sesion: 'evaluacion_sesion',
        materiales_educativos: 'materiales_educativos',
        medios_educativos: 'medios_educativos',
        recursos_educativos: 'recursos_educativos',
        espacios_aprendizaje: 'espacios_aprendizaje',
        referencias_bibliograficas: 'referencias_bibliograficas',
        linkografia: 'linkografia',
    };
    const canonicalizeMarker = (value: string) => markerAliasMap[normalizeMarker(value)] || normalizeMarker(value);
    const dedupeMarkers = (markers: string[]) => {
        const canonicalToPreferred = new Map<string, string>();
        markers.forEach((marker) => {
            const clean = String(marker || '').trim();
            if (!clean) return;
            const canonical = canonicalizeMarker(clean);
            const existing = canonicalToPreferred.get(canonical);
            if (!existing) {
                canonicalToPreferred.set(canonical, clean);
                return;
            }
            const currentNormalized = normalizeMarker(clean);
            const existingNormalized = normalizeMarker(existing);
            if (currentNormalized === canonical && existingNormalized !== canonical) {
                canonicalToPreferred.set(canonical, clean);
            }
        });
        return Array.from(canonicalToPreferred.values()).sort((a, b) => a.localeCompare(b, 'es'));
    };

    useEffect(() => {
        const load = async () => {
            try {
                const gd = await getDatosGenerales();
                if (gd.path_word_default) {
                    setCustomPath(gd.path_word_default);
                    setAnchorPath(true);
                }

                const [templateInfo, unitsMap] = await Promise.all([
                    getUnitWordTemplateFields(),
                    getAllUnidadesDidacticas()
                ]);

                if (templateInfo.success) {
                    setTemplateFields(Array.isArray(templateInfo.fields) ? templateInfo.fields : []);
                    setSessionMarkers(Array.isArray(templateInfo.sessionMarkers) ? templateInfo.sessionMarkers : []);
                }

                setAllUnits(Object.values(unitsMap));
            } catch (e) {
                console.error('Error loading unit merge view', e);
            } finally {
                setLoading(false);
            }
        };

        load();
        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, []);

    useEffect(() => {
        if (progress.error) {
            setToast({ msg: progress.error, type: 'error' });
        }
    }, [progress.error]);

    const uniqueAreas = useMemo(() => {
        const values = Array.from(
            new Map(
                allUnits
                    .filter((unit) => unit.areaId)
                    .map((unit) => [unit.areaId, unit.areaName || unit.areaId])
            ).entries()
        ).sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'es'));
        return values.map(([value, label]) => ({ value, label: String(label).toUpperCase() }));
    }, [allUnits]);

    const uniqueGrades = useMemo(() => {
        let filtered = allUnits;
        if (filterArea) filtered = filtered.filter((unit) => unit.areaId === filterArea);
        const values = Array.from(new Set(filtered.map((unit) => unit.grade).filter(Boolean))).sort();
        return values.map((value) => ({ value, label: value }));
    }, [allUnits, filterArea]);

    const uniqueSections = useMemo(() => {
        let filtered = allUnits;
        if (filterArea) filtered = filtered.filter((unit) => unit.areaId === filterArea);
        if (filterGrade) filtered = filtered.filter((unit) => unit.grade === filterGrade);
        const values = Array.from(new Set(filtered.map((unit) => unit.section).filter(Boolean))).sort();
        return values.map((value) => ({ value, label: value }));
    }, [allUnits, filterArea, filterGrade]);

    const uniqueUnits = useMemo(() => {
        let filtered = allUnits;
        if (filterArea) filtered = filtered.filter((unit) => unit.areaId === filterArea);
        if (filterGrade) filtered = filtered.filter((unit) => unit.grade === filterGrade);
        if (filterSection) filtered = filtered.filter((unit) => unit.section === filterSection);
        const values = Array.from(new Set(filtered.map((unit) => String(unit.unitNumber || '')).filter(Boolean))).sort((a, b) => Number(a) - Number(b));
        return values.map((value) => ({ value, label: `Unidad ${value}` }));
    }, [allUnits, filterArea, filterGrade, filterSection]);

    const filteredList = useMemo(() => allUnits.filter((unit) => {
        const areaMatch = !filterArea || unit.areaId === filterArea;
        const gradeMatch = !filterGrade || unit.grade === filterGrade;
        const sectionMatch = !filterSection || unit.section === filterSection;
        const unitMatch = !filterUnit || String(unit.unitNumber) === String(filterUnit);
        return areaMatch && gradeMatch && sectionMatch && unitMatch;
    }), [allUnits, filterArea, filterGrade, filterSection, filterUnit]);

    const handleToggleAll = () => {
        if (selectedIds.length === filteredList.length) {
            setSelectedIds([]);
            return;
        }
        setSelectedIds(filteredList.map((unit) => unit.id));
    };

    const handleToggleOne = (id: string) => {
        setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
    };

    const startPolling = () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = window.setInterval(async () => {
            try {
                const status = await getUnitWordGenerationStatus();
                if (!status.active || status.error) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    if (!status.error) {
                        setFinished(true);
                        setProgress(status);
                        if (!autoOpenedFolderRef.current && (status.outputPath || customPath)) {
                            autoOpenedFolderRef.current = true;
                            window.blur();
                            await openUnitWordFolder(status.outputPath || customPath);
                        }
                        return;
                    }
                }
                setProgress(status);
            } catch (e) {
                if (pollingRef.current) clearInterval(pollingRef.current);
            }
        }, 800);
    };

    const handleFolderClick = async () => {
        const result = await pickUnitWordFolder();
        if (result.success && result.path) {
            setCustomPath(result.path);
            return;
        }
        if (!(result as any).cancelled && result.message) {
            setToast({ msg: result.message, type: 'error' });
        }
    };

    const handleGenerate = async () => {
        if (selectedIds.length === 0) {
            setToast({ msg: 'Seleccione al menos una unidad didactica.', type: 'warning' });
            return;
        }

        const hasEducationalResources = (unit: any) => {
            const rawResources = unit?.recursos ?? unit?.resources ?? {};
            const parsed = typeof rawResources === 'string'
                ? (() => {
                    try { return JSON.parse(rawResources || '{}'); } catch { return {}; }
                })()
                : rawResources;

            return [
                parsed?.materiales,
                parsed?.medios,
                parsed?.actividades,
                parsed?.espacios
            ].some((value) => String(value || '').trim());
        };

        const selectedUnits = allUnits.filter((unit) => selectedIds.includes(unit.id));
        const selectedUnitsWithFreshData = await Promise.all(
            selectedUnits.map(async (unit) => {
                try {
                    const freshUnit = await getUnidadDidactica(
                        String(unit.year || ''),
                        String(unit.areaId || ''),
                        String(unit.grade || ''),
                        String(unit.section || ''),
                        String(unit.unitNumber || '')
                    );
                    return freshUnit ? { ...unit, ...freshUnit } : unit;
                } catch {
                    return unit;
                }
            })
        );
        const missingResourcesUnits = selectedUnitsWithFreshData.filter((unit) => !hasEducationalResources(unit));
        if (missingResourcesUnits.length > 0) {
            const sample = missingResourcesUnits
                .slice(0, 2)
                .map((unit) => `${unit.areaName || unit.areaId || 'Área'} ${unit.grade || ''} ${unit.section || ''} U${unit.unitNumber || ''}`.trim())
                .join(', ');
            const suffix = missingResourcesUnits.length > 2 ? '...' : '';
            setToast({
                msg: missingResourcesUnits.length === 1
                    ? `La unidad seleccionada no tiene cargada la seccion Materiales y recursos educativos. Se exportara en blanco. ${sample}${suffix}`
                    : `${missingResourcesUnits.length} unidades seleccionadas no tienen cargada la seccion Materiales y recursos educativos. Se exportaran en blanco. ${sample}${suffix}`,
                type: 'warning'
            });
        }

        setFinished(false);
        autoOpenedFolderRef.current = false;
        setProgress({ active: true, total: selectedIds.length, current: 0, lastFile: '', error: null, outputPath: '', generatedCount: 0, missingIds: [] });
        const response = await startUnitWordGeneration(selectedIds, customPath, anchorPath);
        if (!response.success) {
            setToast({ msg: response.message || 'No se pudo iniciar la exportacion.', type: 'error' });
            setProgress((prev) => ({ ...prev, active: false, error: response.message || 'Error desconocido' }));
            return;
        }
        startPolling();
    };

    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    const dedupedTemplateFields = useMemo(
        () => dedupeMarkers(templateFields.map((field) => String(field || '').trim()).filter(Boolean) as string[]),
        [templateFields]
    );
    const dedupedSessionMarkers = useMemo(() => {
        const used = new Set(dedupedTemplateFields.map(canonicalizeMarker));
        return dedupeMarkers(sessionMarkers.map((marker) => String(marker || '').trim()).filter(Boolean) as string[])
            .filter((marker) => !used.has(canonicalizeMarker(marker)));
    }, [dedupedTemplateFields, sessionMarkers]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="font-black uppercase tracking-widest text-[10px] text-slate-400">Cargando...</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6 pb-20 overflow-visible">
            {toast && <InternalToast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

            <div className="bg-slate-900 text-white p-8 rounded-[3rem] shadow-2xl relative overflow-visible border border-slate-800">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 via-amber-500 to-red-500 rounded-t-[3rem]"></div>
                <div className="flex justify-between items-center relative z-10">
                    <div className="flex items-center gap-5">
                        <button onClick={onBack} className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group">
                            <span className="text-xl group-hover:-translate-x-1 transition-transform">&larr;</span>
                        </button>
                        <div>
                            <h1 className="text-3xl font-black tracking-tight uppercase leading-none italic">Correspondencia Unidades</h1>
                            <p className="text-[10px] font-black text-orange-300 uppercase tracking-[0.4em] mt-2">Exportacion Word desde Unidades Didacticas</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Motor ARMI Word UD</span>
                        <span className="text-[10px] font-bold text-emerald-500">Base: unidades_didacticas</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 overflow-visible">
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-200">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-3">
                            <span className="w-2 h-4 bg-orange-500 rounded-full"></span> 1. Destino de Salida
                        </h3>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Carpeta de Exportacion</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Seleccione o escriba ruta..."
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-inner"
                                        value={customPath}
                                        onChange={(e) => setCustomPath(e.target.value)}
                                    />
                                    <button onClick={handleFolderClick} className="w-12 h-12 bg-slate-100 hover:bg-orange-500 hover:text-white border border-slate-200 rounded-2xl flex items-center justify-center transition-all shadow-sm" title="Seleccionar carpeta de destino">
                                        <span className="text-xl">+</span>
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
                                <button onClick={handleGenerate} disabled={progress.active} className={`flex-1 rounded-[2rem] text-white transition-all flex items-center justify-center shadow-2xl bg-orange-500 ${progress.active ? 'opacity-50 grayscale' : 'hover:scale-105 active:scale-95'}`} title="Iniciar exportacion de unidades">
                                    {progress.active ? <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin"></div> : <span className="text-2xl">DOC</span>}
                                </button>
                                {finished && !progress.active && (
                                    <button onClick={() => openUnitWordFolder(progress.outputPath || customPath)} className="w-16 bg-white border border-slate-200 rounded-[2rem] flex items-center justify-center hover:bg-slate-50 transition-all shadow-lg text-2xl" title="Abrir Carpeta">
                                        📂
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {(progress.active || finished) && (
                        <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-slate-800 animate-fade-in relative overflow-hidden">
                            <div className="flex justify-between items-center mb-6 relative z-10">
                                <span className="text-[10px] font-black text-white uppercase tracking-widest">Progreso de Generacion</span>
                                {progress.active && <span className="text-xl font-black font-mono text-orange-400">{percent}%</span>}
                            </div>
                            <div className="h-4 bg-white/10 rounded-full overflow-hidden border border-white/5 mb-4 shadow-inner">
                                <div className="h-full transition-all duration-700 ease-out bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${progress.active ? percent : finished ? 100 : 0}%` }}></div>
                            </div>
                            <div className="flex flex-col gap-1 relative z-10">
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter truncate">
                                    {finished ? 'Exportacion de unidades completada' : progress.error ? `Error: ${progress.error}` : `Procesando: ${progress.lastFile || 'Inicializando...'}`}
                                </p>
                                {!!progress.outputPath && <p className="text-[10px] text-slate-300 font-mono break-all">{progress.outputPath}</p>}
                            </div>
                        </div>
                    )}

                    <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-slate-200">
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <div>
                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">2. Campos de Plantilla</h3>
                                <p className="text-[10px] font-bold text-slate-500 mt-2">Use los campos con el formato <span className="font-mono text-slate-700">&lt;&lt;campo&gt;&gt;</span> en la plantilla de unidad.</p>
                            </div>
                            <div className="px-3 py-2 rounded-2xl bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600">
                                {dedupedTemplateFields.length + dedupedSessionMarkers.length} marcador(es)
                            </div>
                        </div>

                        <div className="max-h-80 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                            {dedupedTemplateFields.length > 0 && (
                                <div>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Campos Word</p>
                                    <div className="flex flex-wrap gap-2">
                                        {dedupedTemplateFields.map((field) => (
                                            <button
                                                key={field}
                                                type="button"
                                                onClick={() => navigator.clipboard?.writeText(`<<${field}>>`)}
                                                className="px-3 py-2 rounded-2xl bg-slate-50 hover:bg-orange-50 border border-slate-200 hover:border-orange-200 text-[10px] font-mono font-bold text-slate-700 transition-colors"
                                                title={`Copiar <<${field}>>`}
                                            >
                                                {`<<${field}>>`}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {dedupedSessionMarkers.length > 0 && (
                                <div>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Marcadores Sugeridos</p>
                                    <div className="flex flex-wrap gap-2">
                                        {dedupedSessionMarkers.map((marker) => (
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

                            {dedupedTemplateFields.length === 0 && dedupedSessionMarkers.length === 0 && (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center w-full">
                                    No se pudieron leer los campos o marcadores de la plantilla de unidades.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white rounded-[3.5rem] shadow-2xl border border-slate-200 overflow-visible flex flex-col min-h-[600px]">
                    <div className="bg-slate-50 p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 overflow-visible rounded-t-[3.5rem]">
                        <div className="flex flex-col">
                            <h4 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Registros de Unidades</h4>
                            <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em] mt-1">{selectedIds.length} marcados para exportar</span>
                        </div>
                        <div className="flex items-center gap-3 flex-1 justify-end overflow-visible">
                            <div className="w-36">
                                <Select label="Area" name="area" options={uniqueAreas} value={filterArea} onChange={(e) => { setFilterArea(e.target.value); setFilterGrade(''); setFilterSection(''); setFilterUnit(''); }} searchable={true} placeholder="Todas..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" />
                            </div>
                            <div className="w-24">
                                <Select label="Grado" name="grade" options={uniqueGrades} value={filterGrade} onChange={(e) => { setFilterGrade(e.target.value); setFilterSection(''); setFilterUnit(''); }} searchable={true} placeholder="Todos..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" />
                            </div>
                            <div className="w-24">
                                <Select label="Seccion" name="section" options={uniqueSections} value={filterSection} onChange={(e) => { setFilterSection(e.target.value); setFilterUnit(''); }} searchable={true} placeholder="Todas..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" />
                            </div>
                            <div className="w-24">
                                <Select label="Unidad" name="unit" options={uniqueUnits} value={filterUnit} onChange={(e) => setFilterUnit(e.target.value)} searchable={true} placeholder="Todas..." className="h-auto" labelClassName="text-[8px] font-black text-slate-400" />
                            </div>
                            {(filterArea || filterGrade || filterSection || filterUnit) && (
                                <button onClick={() => { setFilterArea(''); setFilterGrade(''); setFilterSection(''); setFilterUnit(''); }} className="h-8 w-8 shrink-0 flex items-center justify-center bg-slate-200 hover:bg-slate-300 rounded-full transition-colors text-sm text-slate-600" title="Limpiar Filtros">
                                    x
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
                                    <th className="p-4 w-12 text-center">N</th>
                                    <th className="p-4">Area</th>
                                    <th className="p-4 w-20 text-center">Grado</th>
                                    <th className="p-4 w-20 text-center">Secc.</th>
                                    <th className="p-4 w-20 text-center">Unidad</th>
                                    <th className="p-4">Titulo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredList.map((row, idx) => {
                                    const isSelected = selectedIds.includes(row.id);
                                    return (
                                        <tr key={row.id} onClick={() => handleToggleOne(row.id)} className={`cursor-pointer transition-colors group ${isSelected ? 'bg-orange-50/50' : 'hover:bg-slate-50'}`}>
                                            <td className="p-4 text-center">
                                                <div className={`mx-auto w-5 h-5 rounded border-2 transition-all flex items-center justify-center ${isSelected ? 'bg-orange-500 border-orange-500 shadow-md text-white text-[9px] font-black' : 'bg-slate-100 border-slate-300'}`}>
                                                    {isSelected && 'OK'}
                                                </div>
                                            </td>
                                            <td className="p-4 text-center font-mono text-[10px] text-slate-400">{idx + 1}</td>
                                            <td className={`p-4 font-black uppercase text-[11px] ${isSelected ? 'text-orange-700' : 'text-slate-700'}`}>{row.areaName || row.areaId}</td>
                                            <td className="p-4 text-center text-[11px] font-bold text-slate-600">{row.grade}</td>
                                            <td className="p-4 text-center text-[11px] font-bold text-slate-600">{row.section}</td>
                                            <td className="p-4 text-center text-[11px] font-bold text-slate-600">U{row.unitNumber}</td>
                                            <td className="p-4 text-[11px] font-bold text-slate-600 truncate">{row.title || 'Sin titulo'}</td>
                                        </tr>
                                    );
                                })}
                                {filteredList.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="p-12 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                                            No hay unidades didacticas registradas con esos filtros.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
