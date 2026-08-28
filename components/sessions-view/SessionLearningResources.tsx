import React, { useRef, useState } from 'react';
import {
    CircleHelp,
    CirclePlay,
    ClipboardList,
    Copy,
    Dices,
    FilePenLine,
    Gamepad2,
    Eye,
    Images,
    Link2,
    Plus,
    Sparkles,
    Wrench,
    X,
    type LucideIcon
} from 'lucide-react';
import { ResourceImagePreview } from './ResourceImagePreview';

export type SessionResourceKey = 'instructive' | 'annex1' | 'annex2';

export type SessionResourceVisualFormat =
    | 'concept'
    | 'steps'
    | 'example'
    | 'diagram'
    | 'table'
    | 'checklist'
    | 'questions'
    | 'workspace'
    | 'reminder'
    // La respuesta inicial de una IA es dinámica; SessionsView valida y normaliza
    // cualquier valor desconocido a "concept" antes de guardarlo.
    | (string & {});

export type SessionResourceAIContent = {
    eyebrow: string;
    heading: string;
    summary?: string;
    sessionInfo?: {
        sessionLabel: string;
        sessionTitle: string;
        purpose: string;
        competency: string;
        capacities: string;
        criterion: string;
        evidence: string;
    };
    visualBrief?: {
        layoutIdea: string;
        illustrationIdea: string;
        paletteIdea: string;
    };
    sections: Array<{
        label: string;
        body: string;
        visualFormat?: SessionResourceVisualFormat;
    }>;
};

export type SessionResourceMetadata = {
    platform?: string;
    url?: string;
    videoId?: string;
    thumbnailUrl?: string;
    externalTitle?: string;
    authorName?: string;
    pedagogicalReason?: string;
    searchQuery?: string;
    duration?: string;
    tools?: string[];
    deliverable?: string;
};

export type SessionResourceGeneration = {
    mode: 'ai_image' | 'ai_content_layout' | 'ai_external_resource' | 'manual';
    provider: 'gemini' | 'manual';
    model: string;
    imageModel?: string;
    promptVersion: string;
    generatedAt: string;
};

export type SessionLearningResource = {
    title: string;
    imageUrl: string;
    aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
    kind: string;
    pinned: boolean;
    sourceSessionId?: string;
    aiContent?: SessionResourceAIContent;
    metadata?: SessionResourceMetadata;
    generation?: SessionResourceGeneration;
};

export type SessionLearningResourcesData = Record<SessionResourceKey, SessionLearningResource>;

export const SESSION_RESOURCE_PREFS_KEY = 'armi_session_resource_preferences_v1';

const RESOURCE_DEFINITIONS: Array<{
    key: SessionResourceKey;
    title: string;
    subtitle: string;
    icon: string;
    kinds?: Array<{ value: string; icon: LucideIcon; label: string }>;
}> = [
    {
        key: 'instructive',
        title: 'Instructivo informativo',
        subtitle: 'Teoría, conceptos y subconceptos del campo temático.',
        icon: '📚'
    },
    {
        key: 'annex1',
        title: 'Anexo 1 · Motivación',
        subtitle: 'Recurso inicial para despertar interés y activar saberes.',
        icon: '💡',
        kinds: [
            { value: 'dynamic', icon: Dices, label: 'Dinámica' },
            { value: 'youtube', icon: CirclePlay, label: 'Video de YouTube' },
            { value: 'collage', icon: Images, label: 'Imágenes en una sola lámina' },
            { value: 'questions', icon: CircleHelp, label: 'Preguntas capciosas' }
        ]
    },
    {
        key: 'annex2',
        title: 'Anexo 2 · Evidencia',
        subtitle: 'Práctica o ficha donde el estudiante construye su evidencia.',
        icon: '🧩',
        kinds: [
            { value: 'worksheet', icon: FilePenLine, label: 'Ficha de trabajo' },
            { value: 'form', icon: ClipboardList, label: 'Formulario TIC' },
            { value: 'gamification', icon: Gamepad2, label: 'Gamificación' },
            { value: 'project', icon: Wrench, label: 'Reto o producto digital' }
        ]
    }
];

const ASPECTS: Array<{ value: SessionLearningResource['aspectRatio']; label: string }> = [
    { value: '16:9', label: 'Horizontal' },
    { value: '9:16', label: 'Vertical' },
    { value: '1:1', label: 'Cuadrada' },
    { value: '3:4', label: 'Documento' }
];

const ASPECT_PREVIEW_SIZE: Record<SessionLearningResource['aspectRatio'], { width: number; height: number }> = {
    '16:9': { width: 14, height: 8 },
    '9:16': { width: 8, height: 14 },
    '1:1': { width: 11, height: 11 },
    '3:4': { width: 9, height: 12 }
};

const readPreferences = () => {
    if (typeof window === 'undefined') return {} as any;
    try {
        return JSON.parse(window.localStorage.getItem(SESSION_RESOURCE_PREFS_KEY) || '{}');
    } catch {
        return {} as any;
    }
};

export const createSessionLearningResourceDefaults = (existing?: Partial<SessionLearningResourcesData> | null): SessionLearningResourcesData => {
    const prefs = readPreferences();
    const make = (key: SessionResourceKey, title: string, fallbackKind: string): SessionLearningResource => ({
        title,
        imageUrl: '',
        aspectRatio: prefs?.[key]?.aspectRatio || '16:9',
        kind: prefs?.[key]?.kind || fallbackKind,
        pinned: false,
        ...(existing?.[key] || {})
    });
    return {
        instructive: make('instructive', 'Instructivo informativo', 'informative'),
        annex1: make('annex1', 'Anexo 1 · Motivación', 'dynamic'),
        annex2: make('annex2', 'Anexo 2 · Evidencia', 'worksheet')
    };
};

type Props = {
    value: SessionLearningResourcesData;
    generating: boolean;
    generatingKey: SessionResourceKey | null;
    generationErrors?: Partial<Record<SessionResourceKey, string>>;
    suggestion?: { sessionId: string; label: string; resources: SessionLearningResourcesData } | null;
    onChange: (next: SessionLearningResourcesData) => void;
    onGenerateAll: () => void;
    onGenerateOne: (key: SessionResourceKey) => void;
    onCopyAllPrompts: () => void;
    onCopyPrompt: (key: SessionResourceKey) => void;
    onUpload: (key: SessionResourceKey, file: File) => void;
    onUseSuggestion: () => void;
};

export const SessionLearningResources: React.FC<Props> = ({
    value,
    generating,
    generatingKey,
    generationErrors,
    suggestion,
    onChange,
    onGenerateAll,
    onGenerateOne,
    onCopyAllPrompts,
    onCopyPrompt,
    onUpload,
    onUseSuggestion
}) => {
    const inputs = useRef<Partial<Record<SessionResourceKey, HTMLInputElement | null>>>({});
    const [preview, setPreview] = useState<{ src: string; title: string } | null>(null);

    const update = (key: SessionResourceKey, patch: Partial<SessionLearningResource>, remember = false) => {
        const next = { ...value, [key]: { ...value[key], ...patch } };
        onChange(next);
        if (remember && typeof window !== 'undefined') {
            const prefs = readPreferences();
            prefs[key] = {
                ...(prefs[key] || {}),
                aspectRatio: next[key].aspectRatio,
                kind: next[key].kind
            };
            window.localStorage.setItem(SESSION_RESOURCE_PREFS_KEY, JSON.stringify(prefs));
        }
    };

    return (
        <>
        <div className="bg-slate-50/60 p-5 md:p-7">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">Recursos visuales de la sesión</h3>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">Opcionales · Modo estricto: solo imagen IA, sin sustitución local.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={onGenerateAll}
                        disabled={generating}
                        className="rounded-2xl bg-violet-700 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-lg transition hover:bg-violet-800 disabled:cursor-wait disabled:opacity-60"
                    >
                        {generating ? '✨ Generando…' : '✨ Generar todos'}
                    </button>
                    <button
                        type="button"
                        onClick={onCopyAllPrompts}
                        className="flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
                        title="Copiar instrucciones en texto plano para generar los tres recursos en otra IA"
                    >
                        <Copy className="h-4 w-4" strokeWidth={2.4} />
                        Copiar prompt
                    </button>
                </div>
            </div>

            {suggestion && (
                <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 md:flex-row md:items-center md:justify-between">
                    <p className="text-[10px] font-bold text-amber-900">
                        ♻️ Hay recursos de una sesión con campos temáticos similares: {suggestion.label}. Puedes reutilizarlos y ahorrar IA.
                    </p>
                    <button type="button" onClick={onUseSuggestion} className="shrink-0 rounded-xl bg-amber-600 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white">
                        Usar recursos
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                {RESOURCE_DEFINITIONS.map((definition) => {
                    const resource = value[definition.key];
                    const isGenerating = generatingKey === definition.key;
                    return (
                        <article key={definition.key} className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
                            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                                <div className="flex gap-3">
                                    <span className="text-2xl" aria-hidden="true">{definition.icon}</span>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <h4 className="text-[11px] font-black uppercase text-slate-800">{definition.title}</h4>
                                            {resource.generation?.mode && resource.generation.mode !== 'manual' && (
                                                <span
                                                    className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wide text-violet-700"
                                                    title={resource.generation.mode === 'ai_image'
                                                        ? `Imagen generada con IA: ${resource.generation.imageModel || resource.generation.model}`
                                                        : resource.generation.mode === 'ai_external_resource'
                                                            ? `Recurso localizado con IA: ${resource.generation.model}`
                                                            : `Contenido creado con IA y diagramado por el sistema: ${resource.generation.model}`}
                                                >
                                                    {resource.generation.mode === 'ai_image' ? 'IA imagen' : resource.generation.mode === 'ai_external_resource' ? 'IA recurso' : 'IA + diseño'}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 text-[9px] font-medium leading-relaxed text-slate-500">{definition.subtitle}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => update(definition.key, { pinned: !resource.pinned })}
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-lg ${resource.pinned ? 'border-amber-300 bg-amber-100' : 'border-slate-200 bg-white'}`}
                                    title={resource.pinned ? 'Desanclar recurso' : 'Anclar para reutilizar'}
                                    aria-label={resource.pinned ? 'Desanclar recurso' : 'Anclar recurso'}
                                >
                                    {resource.pinned ? '📌' : '📍'}
                                </button>
                            </div>

                            {generationErrors?.[definition.key] && (
                                <details className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
                                    <summary className="cursor-pointer text-[8px] font-black uppercase tracking-wide">No se generó la imagen · Ver motivo</summary>
                                    <p className="mt-2 break-words text-[8px] font-semibold leading-relaxed">{generationErrors[definition.key]}</p>
                                </details>
                            )}

                            <div className="p-4">
                                <div className="group/resource relative flex min-h-[210px] items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50">
                                    {resource.imageUrl ? (
                                        <img
                                            src={resource.imageUrl}
                                            alt={definition.title}
                                            className="h-full max-h-[330px] w-full object-contain"
                                            onError={() => update(definition.key, { imageUrl: '', sourceSessionId: '', aiContent: undefined, metadata: undefined, generation: undefined })}
                                        />
                                    ) : (
                                        <div className="px-6 text-center text-slate-400">
                                            <div className="text-4xl">{isGenerating ? '✨' : '🖼️'}</div>
                                            <p className="mt-2 text-[9px] font-black uppercase tracking-widest">{isGenerating ? 'Creando imagen…' : 'Sin recurso asignado'}</p>
                                        </div>
                                    )}
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-slate-950/0 opacity-0 backdrop-blur-0 transition-all duration-200 group-hover/resource:pointer-events-auto group-hover/resource:bg-slate-950/35 group-hover/resource:opacity-100 group-hover/resource:backdrop-blur-[1px] group-focus-within/resource:pointer-events-auto group-focus-within/resource:bg-slate-950/35 group-focus-within/resource:opacity-100">
                                        <button
                                            type="button"
                                            onClick={() => inputs.current[definition.key]?.click()}
                                            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/95 text-slate-800 shadow-xl transition hover:scale-110 hover:bg-white"
                                            title="Cargar imagen"
                                            aria-label="Cargar imagen"
                                        >
                                            <Plus className="h-5 w-5" strokeWidth={2.6} />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={generating || resource.pinned}
                                            onClick={() => onGenerateOne(definition.key)}
                                            className="flex h-10 w-10 items-center justify-center rounded-full border border-violet-300 bg-violet-600 text-white shadow-xl transition hover:scale-110 hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                                            title={resource.pinned ? 'Desancla el recurso para regenerarlo' : 'Generar con IA'}
                                            aria-label="Generar con IA"
                                        >
                                            <Sparkles className="h-5 w-5" strokeWidth={2.4} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onCopyPrompt(definition.key)}
                                            className="flex h-10 w-10 items-center justify-center rounded-full border border-indigo-300 bg-indigo-600 text-white shadow-xl transition hover:scale-110 hover:bg-indigo-700"
                                            title={`Copiar instrucciones externas solo para ${definition.title}`}
                                            aria-label={`Copiar instrucciones externas solo para ${definition.title}`}
                                        >
                                            <Copy className="h-5 w-5" strokeWidth={2.4} />
                                        </button>
                                        {resource.imageUrl && (
                                            <button
                                                type="button"
                                                onClick={() => setPreview({ src: resource.imageUrl, title: definition.title })}
                                                className="flex h-10 w-10 items-center justify-center rounded-full border border-sky-300 bg-sky-600 text-white shadow-xl transition hover:scale-110 hover:bg-sky-700"
                                                title="Ver imagen en tamaño grande"
                                                aria-label="Ver imagen en tamaño grande"
                                            >
                                                <Eye className="h-5 w-5" strokeWidth={2.4} />
                                            </button>
                                        )}
                                        {resource.imageUrl && (
                                            <button
                                                type="button"
                                                onClick={() => update(definition.key, { imageUrl: '', sourceSessionId: '', aiContent: undefined, metadata: undefined, generation: undefined })}
                                                className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-300 bg-rose-600 text-white shadow-xl transition hover:scale-110 hover:bg-rose-700"
                                                title="Eliminar recurso"
                                                aria-label="Eliminar recurso"
                                            >
                                                <X className="h-5 w-5" strokeWidth={2.6} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {definition.key === 'annex1' && resource.kind === 'youtube' && (
                                    <label className="mt-2.5 block">
                                        <span className="mb-1 flex items-center gap-1 text-[7px] font-black uppercase tracking-wider text-slate-400">
                                            <Link2 className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
                                            Enlace del video
                                        </span>
                                        <input
                                            type="url"
                                            value={String(resource.metadata?.url || '')}
                                            onChange={(event) => update(definition.key, {
                                                metadata: {
                                                    ...(resource.metadata || {}),
                                                    url: event.target.value
                                                }
                                            })}
                                            onBlur={(event) => update(definition.key, {
                                                metadata: {
                                                    ...(resource.metadata || {}),
                                                    url: event.target.value.trim()
                                                }
                                            })}
                                            placeholder="https://www.youtube.com/watch?v=..."
                                            className="h-7 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[9px] font-medium text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
                                            title="Enlace real del video de YouTube que se insertará en la plantilla Word"
                                            aria-label="Enlace del video de YouTube"
                                        />
                                    </label>
                                )}

                                <div className="mt-3 flex min-h-[38px] items-end gap-2 overflow-x-auto pb-1">
                                    {definition.kinds && (
                                        <div className="shrink-0">
                                            <p className="mb-1 text-[7px] font-black uppercase tracking-wider text-slate-400">Tipo</p>
                                            <div className="flex gap-1">
                                                {definition.kinds.map((kind) => {
                                                    const KindIcon = kind.icon;
                                                    const selected = resource.kind === kind.value;
                                                    return (
                                                        <button
                                                            key={kind.value}
                                                            type="button"
                                                            onClick={() => update(definition.key, { kind: kind.value }, true)}
                                                            className={`flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[4px] border transition ${selected ? 'border-violet-600 bg-violet-100 text-violet-700 ring-1 ring-violet-300' : 'border-slate-300 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-600'}`}
                                                            title={kind.label}
                                                            aria-label={kind.label}
                                                        >
                                                            <KindIcon aria-hidden="true" className="h-3 w-3" strokeWidth={2.2} />
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {definition.kinds && <div className="mb-0.5 h-7 w-px shrink-0 bg-slate-300" aria-hidden="true" />}

                                    <div className="shrink-0">
                                        <p className="mb-1 text-[7px] font-black uppercase tracking-wider text-slate-400">Aspecto</p>
                                        <div className="flex gap-1">
                                            {ASPECTS.map((aspect) => {
                                                const preview = ASPECT_PREVIEW_SIZE[aspect.value];
                                                const selected = resource.aspectRatio === aspect.value;
                                                return (
                                                    <button
                                                        key={aspect.value}
                                                        type="button"
                                                        onClick={() => update(definition.key, { aspectRatio: aspect.value }, true)}
                                                        className={`flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[4px] border transition ${selected ? 'border-violet-600 bg-violet-100 ring-1 ring-violet-300' : 'border-slate-300 bg-white hover:border-violet-300'}`}
                                                        title={`${aspect.value} · ${aspect.label}`}
                                                        aria-label={`${aspect.value} · ${aspect.label}`}
                                                    >
                                                        <span
                                                            aria-hidden="true"
                                                            className={`block border ${selected ? 'border-violet-700 bg-violet-50' : 'border-slate-700 bg-slate-50'}`}
                                                            style={{ width: preview.width, height: preview.height }}
                                                        />
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                <input
                                    ref={(node) => { inputs.current[definition.key] = node; }}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) onUpload(definition.key, file);
                                        event.currentTarget.value = '';
                                    }}
                                />
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
        {preview && <ResourceImagePreview src={preview.src} title={preview.title} onClose={() => setPreview(null)} />}
        </>
    );
};
