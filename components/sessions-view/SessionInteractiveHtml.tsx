import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, FileCode2, Gamepad2, Play, RefreshCw, RotateCcw, ShieldCheck, Trash2, Upload, Users, XCircle } from 'lucide-react';
import type { SessionAssessmentModel, Student } from '../../types';
import { TemplateThumbnail } from './TemplateThumbnail';
import { getInteractiveActivityResults, resetInteractiveActivity, getPracticeImageLibrary, bindPracticeImageLibrary } from '../../services/apiService';
import {
    MAX_INTERACTIVE_ACTIVITIES_PER_SESSION,
    buildInteractiveHtmlPrompt,
    buildSandboxedHtml,
    validateInteractiveHtml,
    type InteractiveHtmlActivity
} from './interactiveHtml';

type Props = {
    themeColor: string;
    currentSessionId: string;
    students: Student[];
    activities?: InteractiveHtmlActivity[];
    assessmentModel: SessionAssessmentModel;
    sessionData: any;
    context: {
        area: string;
        grade: string;
        section: string;
        sessionNumber: string;
    };
    onChange: (activities: InteractiveHtmlActivity[]) => void;
    onImport: (activity: InteractiveHtmlActivity) => Promise<void>;
    setToast: (toast: { msg: string; type: 'success' | 'error' | 'warning' }) => void;
};

type ActivityResult = {
    scopeType: 'individual' | 'group';
    scopeKey: string;
    targetId: string;
    targetName: string;
    participantNames?: string[];
    attemptNumber: number;
    score: number | null;
    level: string | null;
    completedAt: string | null;
};

const createActivityId = () => `html-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const SessionInteractiveHtml: React.FC<Props> = ({
    themeColor,
    currentSessionId,
    students,
    activities = [],
    assessmentModel,
    sessionData,
    context,
    onChange,
    onImport,
    setToast
}) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const importingRef = useRef(false);
    const [importing, setImporting] = useState(false);
    const activeSessionRef = useRef(currentSessionId);
    activeSessionRef.current = currentSessionId;
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
    const [selectedCriterionId, setSelectedCriterionId] = useState('');
    const [selectedMode, setSelectedMode] = useState<'individual' | 'group'>('individual');
    const [preview, setPreview] = useState<InteractiveHtmlActivity | null>(null);
    const [previewResult, setPreviewResult] = useState('');
    const [resultsByActivity, setResultsByActivity] = useState<Record<string, ActivityResult[]>>({});
    const [resetTargetByActivity, setResetTargetByActivity] = useState<Record<string, string>>({});
    const [busyActivityId, setBusyActivityId] = useState('');
    const criteria = useMemo(() => (assessmentModel?.rows || []).filter((row) => row.source !== 'transversal'), [assessmentModel]);
    const resolvedCriterionId = criteria.some((row) => row.id === selectedCriterionId)
        ? selectedCriterionId
        : String(criteria[0]?.id || '');
    const normalize = (value: unknown) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const sectionTokens = (value: unknown) => String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
    const currentStudents = useMemo(() => students.filter((student) => {
        const status = normalize(student.estado);
        const active = !(status === 'r' || status.startsWith('retir') || status === 't' || status.startsWith('traslad'));
        const sections = sectionTokens(context.section);
        return active && normalize(student.grade) === normalize(context.grade) && sectionTokens(student.section).some((section) => sections.includes(section));
    }), [students, context.grade, context.section]);

    const loadResults = async (activity: InteractiveHtmlActivity, showError = false) => {
        if (!currentSessionId) return;
        const response = await getInteractiveActivityResults(currentSessionId, activity.id);
        if (response.success) {
            setResultsByActivity((current) => ({ ...current, [activity.id]: response.data || [] }));
        } else if (showError) {
            setToast({ msg: response.message || 'Guarda la sesión antes de consultar resultados.', type: 'warning' });
        }
    };

    useEffect(() => {
        if (!currentSessionId) return;
        activities.forEach((activity) => { void loadResults(activity); });
    }, [currentSessionId, activities.map((activity) => activity.id).join('|')]);

    useEffect(() => {
        if (!preview) return;
        const receiveResult = (event: MessageEvent) => {
            if (event.source !== previewFrameRef.current?.contentWindow) return;
            const payload = event.data;
            if (!payload || payload.type !== 'armi:activity-result') return;
            const score = Number(payload.score);
            const maxScore = Number(payload.maxScore);
            if (payload.version !== 1 || payload.completed !== true || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
                setPreviewResult('La actividad respondió, pero el resultado no cumple el contrato ARMI.');
                return;
            }
            const normalized = Math.max(0, Math.min(20, (score / maxScore) * 20));
            setPreviewResult(`Conexión correcta · Resultado de prueba: ${normalized.toFixed(1)}/20`);
        };
        window.addEventListener('message', receiveResult);
        return () => window.removeEventListener('message', receiveResult);
    }, [preview]);

    const copyPrompt = async () => {
        const library = await getPracticeImageLibrary();
        if (!library.success) { setToast({ msg: library.message || 'No se pudo consultar la biblioteca de imágenes.', type: 'error' }); return; }
        const criterion = criteria.find((row) => row.id === resolvedCriterionId);
        const prompt = buildInteractiveHtmlPrompt({
            ...context,
            title: sessionData?.title || '',
            purpose: sessionData?.purpose || '',
            thematicField: sessionData?.competenciaPrio?.field || '',
            competency: criterion?.competencyName || sessionData?.competenciaPrio?.comp || '',
            capacity: criterion?.capacityName || sessionData?.competenciaPrio?.cap || '',
            criterion: criterion?.criterionText || sessionData?.competenciaPrio?.des || '',
            evidence: criterion?.evidenceText || sessionData?.competenciaPrio?.evidence || '',
            mode: selectedMode,
            imageNames: library.data?.images.map((image) => image.name) || []
        });
        try {
            await navigator.clipboard.writeText(prompt);
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = prompt;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        setToast({ msg: 'Prompt HTML copiado. Pégalo en ChatGPT para crear la actividad.', type: 'success' });
    };

    const importFile = async (file: File) => {
        if (importingRef.current) return;
        if (!currentSessionId) { setToast({ msg: 'Selecciona una sesión antes de importar.', type: 'warning' }); return; }
        importingRef.current = true; setImporting(true);
        const importingSession = currentSessionId;
        try {
            if (activities.length >= MAX_INTERACTIVE_ACTIVITIES_PER_SESSION) {
                setToast({ msg: `Puedes publicar hasta ${MAX_INTERACTIVE_ACTIVITIES_PER_SESSION} actividades HTML por sesión.`, type: 'warning' });
                return;
            }
            if (!/\.html?$/i.test(file.name) && !/text\/html/i.test(file.type)) {
                setToast({ msg: 'Selecciona un archivo HTML.', type: 'warning' });
                return;
            }
            let html = await file.text();
            let validation = validateInteractiveHtml(html);
            if (!validation.valid) {
                setToast({ msg: `HTML rechazado: ${validation.errors[0]}`, type: 'error' });
                return;
            }
            const bound = await bindPracticeImageLibrary(html);
            if (!bound.success || !bound.data) { setToast({ msg: bound.message || 'No se pudieron conectar las imágenes.', type: 'error' }); return; }
            html = bound.data.html;
            validation = validateInteractiveHtml(html);
            if (!validation.valid) { setToast({ msg: `HTML rechazado: ${validation.errors[0]}`, type: 'error' }); return; }
            validation.warnings = [...new Set([...validation.warnings, ...bound.data.warnings])];
            const criterion = criteria.find((row) => row.id === resolvedCriterionId);
            if (!criterion) {
                setToast({ msg: 'La sesión necesita al menos un criterio de evaluación antes de importar la actividad.', type: 'warning' });
                return;
            }
            const activity: InteractiveHtmlActivity = {
                id: createActivityId(),
                title: validation.title,
                fileName: file.name.slice(0, 180),
                html,
                criterionId: criterion.id,
                criterionText: criterion.criterionText,
                mode: selectedMode,
                enabled: true,
                importedAt: new Date().toISOString(),
                validation: {
                    valid: validation.valid,
                    errors: validation.errors,
                    warnings: validation.warnings
                }
            };
            await onImport(activity);
            if (!mountedRef.current || activeSessionRef.current !== importingSession) return;
            onChange([...activities, activity]);
            setToast(validation.warnings.length
                ? { msg: `HTML guardado automáticamente con advertencias: ${validation.warnings.join(' ')}`, type: 'warning' }
                : { msg: 'HTML importado y guardado automáticamente.', type: 'success' });
            setPreview(activity);
            setPreviewResult('Completa la actividad para probar la conexión con ARMI.');
        } catch (error: any) {
            if (mountedRef.current) setToast({ msg: `No se guardó el HTML: ${error?.message || 'Comprueba la conexión e impórtalo de nuevo.'}`, type: 'error' });
        } finally {
            importingRef.current = false;
            if (mountedRef.current) setImporting(false);
        }
    };

    const resetActivity = async (activity: InteractiveHtmlActivity) => {
        const mode = activity.mode === 'group' ? 'group' : 'individual';
        const targetId = resetTargetByActivity[activity.id] || '';
        if (!currentSessionId) {
            setToast({ msg: 'Guarda la sesión antes de reiniciar intentos.', type: 'warning' });
            return;
        }
        if (!targetId) {
            setToast({ msg: `Selecciona ${mode === 'group' ? 'un grupo' : 'un estudiante'} para reiniciar.`, type: 'warning' });
            return;
        }
        setBusyActivityId(activity.id);
        const response = await resetInteractiveActivity(currentSessionId, activity.id, { scopeType: mode, targetId });
        setBusyActivityId('');
        if (!response.success) {
            setToast({ msg: response.message || 'No se pudo reiniciar la actividad.', type: 'error' });
            return;
        }
        setToast({ msg: response.data?.message || 'Actividad reiniciada.', type: response.data?.reset ? 'success' : 'warning' });
        await loadResults(activity);
    };

    return (
        <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
            <div className="text-white p-4 text-center font-black uppercase text-xs tracking-widest flex items-center justify-center gap-3" style={{ backgroundColor: themeColor }}>
                <Gamepad2 className="h-5 w-5" /> Práctica HTML
            </div>
            <div className="p-4 space-y-3 bg-slate-50/60">
                <details>
                <summary className="cursor-pointer text-xs font-black text-violet-700">Crear o importar práctica · configuración</summary>
                <div className="mt-3 flex flex-col gap-4">
                    <div className="max-w-2xl">
                        <h3 className="text-sm font-black text-slate-800">Juegos y actividades autocorregibles</h3>
                        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-500">
                            ARMI revisa la estructura, bloquea conexiones externas y vincula el resultado con un criterio real de la sesión.
                        </p>
                        <p className="mt-2 text-[10px] font-semibold leading-relaxed text-indigo-700">
                            Un intento en computadora: 5 minutos y una continuación de 5 desde el avance guardado. Los HTML anteriores deben adaptarse con el nuevo prompt. Reiniciar desde aquí es una excepción autorizada por el docente.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-[220px]">
                            <span className="mb-1 block text-[8px] font-black uppercase tracking-widest text-slate-500">Criterio que evaluará</span>
                            <select
                                value={resolvedCriterionId}
                                onChange={(event) => setSelectedCriterionId(event.target.value)}
                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-700"
                            >
                                {criteria.length ? criteria.map((criterion) => (
                                    <option key={criterion.id} value={criterion.id}>{criterion.criterionText}</option>
                                )) : <option value="">Sin criterios disponibles</option>}
                            </select>
                        </label>
                        <label className="min-w-[145px]">
                            <span className="mb-1 block text-[8px] font-black uppercase tracking-widest text-slate-500">Modalidad</span>
                            <select value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as 'individual' | 'group')} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-700">
                                <option value="individual">Individual</option>
                                <option value="group">Grupal</option>
                            </select>
                        </label>
                        <button type="button" onClick={() => { void copyPrompt(); }} disabled={!criteria.length} className="flex h-10 items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 text-[9px] font-black uppercase text-violet-700 disabled:opacity-40" title="Copiar prompt compatible con ARMI">
                            <Copy className="h-4 w-4" /> Prompt
                        </button>
                        <button type="button" onClick={() => inputRef.current?.click()} disabled={importing || !criteria.length || activities.length >= MAX_INTERACTIVE_ACTIVITIES_PER_SESSION} className="flex h-10 items-center gap-2 rounded-xl bg-violet-700 px-4 text-[9px] font-black uppercase text-white shadow-lg disabled:opacity-40">
                            <Upload className="h-4 w-4" />{importing ? 'Guardando HTML…' : 'Importar HTML'}
                        </button>
                        <input ref={inputRef} type="file" accept="text/html,.html,.htm" className="hidden" onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void importFile(file);
                            event.currentTarget.value = '';
                        }} />
                    </div>
                </div>
                </details>

                {activities.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                        <FileCode2 className="mx-auto h-9 w-9 text-slate-300" />
                        <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Sin actividades HTML</p>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {activities.map((activity) => {
                            const mode = activity.mode === 'group' ? 'group' : 'individual';
                            const results = resultsByActivity[activity.id] || [];
                            const completedResults = results.filter((result) => result.completedAt);
                            const currentGroups = currentStudents
                                .filter((student) => String(student.group || '').trim())
                                .map((student) => [normalize(student.group), String(student.group).trim()] as const);
                            const historicGroups = results
                                .filter((result) => result.scopeType === 'group')
                                .map((result) => [result.scopeKey, result.targetName] as const);
                            const groupOptions = Array.from(new Map([...currentGroups, ...historicGroups]).entries());
                            const historicStudents = results
                                .filter((result) => result.scopeType === 'individual')
                                .map((result) => [result.targetId, result.targetName] as const);
                            const studentOptions = Array.from(new Map([
                                ...currentStudents.map((student) => [String(student.id), student.name] as const),
                                ...historicStudents,
                            ]).entries());
                            return (
                            <article key={activity.id} className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center gap-3"><TemplateThumbnail html={activity.html} title={activity.title} onClick={()=>{setPreview(activity);setPreviewResult('Completa la actividad para probar la conexión con ARMI.');}}/><div className="min-w-0"><b className="block text-xs text-slate-800">{activity.title}</b><span className="text-[10px] text-slate-500">{mode==='group'?'Grupal':'Individual'} · {activity.enabled?'Publicada':'Sin publicar'}</span></div></div>
                                <details><summary className="cursor-pointer text-[11px] font-bold text-slate-600">Datos, controles y resultados ({completedResults.length})</summary>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-emerald-700"><ShieldCheck className="h-4 w-4" /><span className="text-[8px] font-black uppercase tracking-widest">Validado y aislado</span></div>
                                        <h4 className="mt-2 truncate text-xs font-black text-slate-800">{activity.title}</h4>
                                        <p className="mt-1 truncate text-[8px] text-slate-400">{activity.fileName}</p>
                                        <p className="mt-1 flex items-center gap-1 text-[8px] font-black uppercase text-violet-700"><Users className="h-3 w-3" /> {mode === 'group' ? 'Grupal · un resultado por grupo' : 'Individual · un resultado por estudiante'}</p>
                                        <p className="mt-2 line-clamp-2 text-[9px] font-semibold text-slate-600">{activity.criterionText}</p>
                                        {activity.validation.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-700">{warning}</p>)}
                                    </div>
                                    <label className="flex shrink-0 items-center gap-1 text-[8px] font-bold text-slate-500">
                                        <input type="checkbox" checked={activity.enabled} onChange={(event) => onChange(activities.map((item) => item.id === activity.id ? { ...item, enabled: event.target.checked } : item))} /> Publicar
                                    </label>
                                </div>
                                <div className="mt-4 flex gap-2">
                                    <button type="button" onClick={() => { setPreview(activity); setPreviewResult('Completa la actividad para probar la conexión con ARMI.'); }} className="flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-[8px] font-black uppercase text-white"><Play className="h-3.5 w-3.5" /> Probar</button>
                                    <button type="button" onClick={() => { void loadResults(activity, true); }} className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-[8px] font-black uppercase text-slate-600"><RefreshCw className="h-3.5 w-3.5" /> Resultados ({completedResults.length})</button>
                                    <button type="button" onClick={() => onChange(activities.filter((item) => item.id !== activity.id))} className="flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-2 text-[8px] font-black uppercase text-rose-700"><Trash2 className="h-3.5 w-3.5" /> Quitar</button>
                                </div>
                                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <select value={resetTargetByActivity[activity.id] || ''} onChange={(event) => setResetTargetByActivity((current) => ({ ...current, [activity.id]: event.target.value }))} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-bold text-slate-700">
                                            <option value="">{mode === 'group' ? 'Seleccionar grupo…' : 'Seleccionar estudiante…'}</option>
                                            {mode === 'group'
                                                ? groupOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)
                                                : studentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                        </select>
                                        <button type="button" disabled={busyActivityId === activity.id} onClick={() => { void resetActivity(activity); }} className="flex h-9 items-center justify-center gap-1 rounded-lg bg-amber-500 px-3 text-[8px] font-black uppercase text-white disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> Reiniciar intento</button>
                                    </div>
                                    {completedResults.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
                                        {completedResults.slice(0, 8).map((result) => <span key={`${result.scopeType}-${result.scopeKey}`} className="rounded-full bg-white px-2 py-1 text-[8px] font-bold text-slate-600 shadow-sm">{result.targetName}: {result.score}/20 · intento {result.attemptNumber}</span>)}
                                    </div>}
                                </div>
                                </details>
                            </article>
                            );
                        })}
                    </div>
                )}
            </div>

            {preview && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
                    <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3">
                            <div><h3 className="text-sm font-black text-slate-800">Prueba segura · {preview.title}</h3><p className="text-[9px] font-semibold text-slate-500">La prueba no registra una nota de estudiante.</p></div>
                            <button type="button" onClick={() => setPreview(null)} className="rounded-full bg-slate-100 p-2 text-slate-600"><XCircle className="h-5 w-5" /></button>
                        </div>
                        <iframe ref={previewFrameRef} title={preview.title} srcDoc={buildSandboxedHtml(preview.html)} sandbox="allow-scripts allow-forms allow-modals" className="min-h-0 flex-1 bg-white" />
                        <div className={`flex items-center gap-2 px-5 py-3 text-[10px] font-black ${previewResult.startsWith('Conexión correcta') ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}>
                            {previewResult.startsWith('Conexión correcta') ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}{previewResult}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
