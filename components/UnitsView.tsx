import '../styles/ai-provider-dialog.css';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { TeachingAssignment, GeneralData, ScheduleEntry, ScheduleBreak, ScheduleConfig } from '../types';
import { 
    getCompetencias, 
    getProgramacionesAnuales, 
    getDatosGenerales, 
    getEstandares, 
    saveDatosGenerales, 
    getUnidadDidactica, 
    saveUnidadDidactica,
    getAllUnidadesDidacticas,
    deleteUnidadDidactica
} from '../services/apiService';
import { Select } from './Select';
import { Type } from "@google/genai";
import { UnitTemplateMergeView } from './UnitTemplateMergeView';
import { SessionActions } from './sessions-view/SessionActions';
import { readStoredViewSelection, writeStoredViewSelection } from '../utils/viewSelectionStorage';
import { createGeminiClient, generateGeminiContent, generateGeminiContentStream } from '../utils/gemini';
import { fetchGeminiImageCapability, fetchGeminiTextModels, fetchOpenAIImageCapability, fetchOpenAITextModels, getDefaultModelForProvider, getFallbackModelOptions, type AiImageCapability, type AiModelOption } from '../utils/aiModels';
import { getAiUsageProgress, registerAiUsage, type AiUsageProgress } from '../utils/aiUsage';
import { classifyAiIssue } from '../utils/aiErrors';
import { distributeOrderedCriteriaByBlocks } from '../utils/orderedSessionDistribution';
import { editUnitLinkedEvaluation } from '../utils/unitLinkedEvaluation';
import { validateGeneratedUnitSessionTitles } from '../backend/shared/unitSessionTitles.js';

// Keep the draft while typing; commit on blur so list parsing cannot move the
// caret or remove an evidence halfway through replacing its text.
const LinkedEvaluationTextarea: React.FC<{ value: string; onCommit: (value: string) => void; className: string }> = ({ value, onCommit, className }) => {
    const [draft, setDraft] = useState(value);
    const focused = useRef(false);
    useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
    return <textarea className={className} value={draft}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => { setDraft(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`; }}
        onBlur={() => { focused.current = false; if (draft !== value) onCommit(draft); }}
        title="Al terminar la edición se actualiza también la tabla de competencias y las sesiones vinculadas." />;
};

interface Props {
  activeSection: string;
  onSuccess: () => void;
}

const UNITS = [1, 2, 3, 4, 5, 6, 7, 8];
const UNITS_VIEW_SELECTION_STORAGE_KEY = 'armi_view_selection_unidades_v1';

const INSTRUMENTS_OPTIONS = [
    { value: 'Rúbrica', label: 'Rúbrica' },
    { value: 'Lista de Cotejo', label: 'Lista de Cotejo' },
    { value: 'Guía de observación', label: 'Guía de observación' },
    { value: 'Escala de valoración', label: 'Escala de valoración' },
    { value: 'Otros (especificar)', label: 'Otros (especificar)' }
];

const TRANSVERSAL_NAMES = [
    "Se desenvuelve en los entornos virtuales generados por las TIC",
    "Gestiona su aprendizaje de manera autónoma"
];

const ENFOQUES_LIST = [
    "Enfoque de derechos",
    "Enfoque Inclusivo o de Atención a la diversidad",
    "Enfoque Intercultural",
    "Enfoque Igualdad de Género",
    "Enfoque ambiental",
    "Enfoque orientación al bien común",
    "Enfoque búsqueda de la Excelencia"
];

const TRANS_TEXT_COLORS = ['text-[#007c59]', 'text-[#00b28c]'];
const TRANS_TEXT_COLORS_STRONG = ['text-[#007c59]', 'text-[#00b28c]'];
const TRANS_BG_IDLE = ['bg-emerald-50/40 border-emerald-200/60', 'bg-emerald-50/40 border-emerald-200/60'];
const TRANS_BG_SELECTED = ['bg-emerald-50 border-emerald-300', 'bg-emerald-50 border-emerald-300'];
const AREA_TEXT_COLOR = 'text-black';

const ENFOQUE_DETAILS: Record<string, any> = {
    "Enfoque de derechos": {
        valores: "Conciencia de derechos, Libertad y responsabilidad, Diálogo y concertación",
        actitudes: "> Disposición a conocer, comprender y valorar los derechos individuales y colectivos.\n> Disposición a elegir de manera voluntaria y responsable la propia forma de actuar dentro de una sociedad.",
        demuestra: "Los docentes promueven el conocimiento de los Derechos Humanos y la Convención sobre los Derechos del Niño para empoderar a los estudiantes en su ejercicio democrático."
    },
    "Enfoque Inclusivo o de Atención a la diversidad": {
        valores: "Respeto por las diferencias, Equidad en la enseñanza, Confianza en la persona",
        actitudes: "> Reconocimiento al valor inherente de cada persona y de sus derechos, por encima de cualquier diferencia.\n> Disposición a enseñar ofreciendo a los estudiantes las condiciones y oportunidades que cada uno necesita.",
        demuestra: "Docentes y estudiantes demuestran altas expectativas sobre todos los estudiantes, sin distinguir habilidades o procedencia."
    },
    "Enfoque Intercultural": {
        valores: "Respeto a la identidad cultural, Justicia, Diálogo intercultural",
        actitudes: "> Reconocimiento al valor de las diversas identidades culturales y relaciones de pertenencia de los estudiantes.\n> Disposición a actuar de manera justa, respetando el derecho de todos.",
        demuestra: "Los docentes y estudiantes acogen con respeto a todos, sin menospreciar ni excluir a nadie en razón de su lengua, su manera de hablar, su forma de vestir, sus costumbres o sus creencias."
    },
    "Enfoque Igualdad de Género": {
        valores: "Igualdad y Dignidad, Justicia, Empatía",
        actitudes: "> Reconocimiento al valor inherente de cada persona, más allá de su género.\n> Disposición a actuar de modo que se dé a cada quien lo que le corresponde, en especial a quienes se ven perjudicados por la desigualdad de género.",
        demuestra: "Docentes y estudiantes no hacen distinciones discriminatorias entre varones y mujeres."
    },
    "Enfoque ambiental": {
        valores: "Solidaridad planetaria y equidad intergeneracional, Justicia y solidaridad, Respeto a toda forma de vida",
        actitudes: "> Disposición para colaborar con el bienestar y la calidad de vida de las generaciones presentes y futuras.\n> Disposición a evaluar los impactos y costos ambientales de las acciones cotidianas.",
        demuestra: "Docentes y estudiantes promueven la preservación de entornos saludables, a favor del cuidado del medio ambiente."
    },
    "Enfoque orientación al bien común": {
        valores: "Equidad y justicia, Solidaridad, Empatía, Responsabilidad",
        actitudes: "> Disposición a reconocer a que ante situaciones de inicio diferentes, se requieren compensaciones.\n> Disposición a apoyar incondicionalmente a personas en situaciones comprometidas o difíciles.",
        demuestra: "Los estudiantes comparten siempre los bienes disponibles para ellos en los espacios educativos con sentido de equidad y justicia."
    },
    "Enfoque búsqueda de la Excelencia": {
        valores: "Flexibilidad y apertura, Superación personal",
        actitudes: "> Disposición para adaptarse a los cambios, modificando si fuera necesario la propia conducta.\n> Disposición a adquirir cualidades que mejorarán el propio desempeño.",
        demuestra: "Docentes y estudiantes comparan, adquieren y emplean estrategias útiles para aumentar la eficacia de sus esfuerzos en el logro de los objetivos que se proponen."
    }
};

const DEFAULT_EVAL_TEXT = `❖ La evaluación en el marco del CNEB tiene en enfoque FORMATIVO. 
❖ En la evaluación formativa el elemento clave es la retroalimentación oportuna a las producciones o actuaciones de los estudiantes.
❖ La evaluación será del aprendizaje y para el aprendizaje (RVM 094-2020 MINEDU)
❖ Se utilizará como instrumentos de evaluación Rúbricas.
❖ Terminada la unidad se aplicará un Simulacro de evaluación.`;

const normalizeText = (str: string) => {
    if (!str) return "";
    return str.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};

const dayNumberToText = (day: number) => {
    return ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'][day];
};

const superNormalize = (str: string) => {
    if (!str) return "";
    return String(str).toLowerCase().replace(/[^a-z0-9 áéíóúñ]/gi, "").trim();
};

const normalizeLoose = (value: string) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const BULLET_PREFIX_RE = /^\s*(?:[-*•▪◦‣·]|(?:\d+[\.\)]))\s+/;
const LIST_BREAK_RE = /^\s*(?:[-*•▪◦‣·]|(?:\d+[\.\)]))\s+/;
const SESSION_TOKEN_STOPWORDS = new Set([
    'para', 'con', 'como', 'desde', 'entre', 'sobre', 'hacia', 'hasta', 'los', 'las', 'del', 'por',
    'que', 'una', 'uno', 'unos', 'unas', 'este', 'esta', 'estos', 'estas', 'segun', 'mediante', 'proceso',
    'sesion', 'aprendizaje', 'campo', 'tematico', 'area', 'grado', 'grupo', 'estudiantes', 'trabajo',
    'producto', 'actividad', 'actividades', 'propuesta', 'valor', 'desarrollo', 'final', 'inicio'
]);

type SessionEvidenceOption = {
    id: string;
    criterionGroupId: string;
    text: string;
    color: string;
    capacidad: string;
    competencia: string;
    matrixIdx: number;
    isTrans: boolean;
    rowType: 'area' | 'transversal';
    tokens: string[];
};

const cleanListLine = (line: string) => String(line || '').replace(BULLET_PREFIX_RE, '').trim();

const normalizeBulletArtifacts = (value: string) =>
    String(value || '')
        .replace(/Ã¢â‚¬Â¢/g, '•')
        .replace(/â€¢/g, '•')
        .replace(/Â·/g, '•');

const splitBulletLikeText = (value: string) => {
    const raw = normalizeBulletArtifacts(String(value || '').replace(/\r/g, ''));
    if (!normalizeLoose(raw)) return [];

    const lines = raw.split('\n').map((line) => String(line || '').trim()).filter(Boolean);
    const items: string[] = [];
    let current = '';

    lines.forEach((line) => {
        const isListBreak = LIST_BREAK_RE.test(line);
        const cleaned = cleanListLine(line);
        if (!cleaned) return;
        if (!current || isListBreak) {
            if (current) items.push(current.trim());
            current = cleaned;
        } else {
            current = `${current} ${cleaned}`.trim();
        }
    });

    if (current) items.push(current.trim());

    return items.filter((item, index, arr) =>
        normalizeLoose(item).length > 0 &&
        arr.findIndex((candidate) => normalizeLoose(candidate) === normalizeLoose(item)) === index
    );
};

const extractMeaningfulTokens = (value: string) =>
    normalizeLoose(value)
        .split(' ')
        .filter((token) => token.length >= 4 && !SESSION_TOKEN_STOPWORDS.has(token));

const normalizeListText = (value: string) => {
    const raw = String(value || '')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .trim();

    if (!raw) return '';

    const items = splitBulletLikeText(raw);
    if (items.length <= 1) return raw;
    return items.map((item) => `• ${item}`).join('\n');
};

const autoResizeTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
};

const buildEmptySessionFromDetail = (detail?: { id: number; date: string; combinations?: string[] }) => ({
    id: detail?.id ?? 1,
    date: detail?.date || '',
    title: '',
    cap: '',
    des: '',
    con: '',
    evi: '',
    eval: '',
    competencia: '',
    transversales: [],
    capacidades: [],
    selectedCriteriaTexts: [],
    selectedCriteriaIds: null,
    availableCriteriaOptions: [],
    capacityCriteriaOptions: [],
    criteriaSelectionTouched: false,
    selectedEvidenceIds: [],
    availableEvidenceOptions: [],
    evidenceDistributionMode: 'auto',
    fechasPorSeccion: detail?.combinations || []
});

const syncSessionsWithDetails = (sessions: any[], details: { id: number; date: string; combinations: string[] }[]) => {
    if (!Array.isArray(details) || details.length === 0) return Array.isArray(sessions) ? sessions : [];
    const existing = Array.isArray(sessions) ? sessions : [];
    return details.map((detail, idx) => {
        const byId = existing.find((session: any) => Number(session?.id) === Number(detail.id));
        const byIndex = existing[idx];
        const source = byId || byIndex;
        if (!source) return buildEmptySessionFromDetail(detail);
        return {
            ...buildEmptySessionFromDetail(detail),
            ...source,
            id: detail.id,
            date: detail.date,
            fechasPorSeccion: detail.combinations || []
        };
    });
};

const groupRows = (base: any[], estandares: any[]) => {
    if (!base || base.length === 0) return [];
    const groups: Record<string, any[]> = {};
    base.forEach((c, idx) => {
        const compName = c.competencias;
        if (!groups[compName]) groups[compName] = [];
        groups[compName].push({ ...c, originalIdx: idx });
    });

    return Object.entries(groups).map(([compName, items]) => {
        const capCounts: Record<string, number> = {};
        items.forEach(it => { capCounts[it.capacidades] = (capCounts[it.capacidades] || 0) + 1; });
        const itemsWithSpan: any[] = [];
        const capSeen: Record<string, boolean> = {};
        items.forEach(it => {
            const isFirstCap = !capSeen[it.capacidades];
            itemsWithSpan.push({ ...it, capSpan: isFirstCap ? capCounts[it.capacidades] : 0, isFirstCap });
            capSeen[it.capacidades] = true;
        });
        const matchingEstandar = estandares.find(e => e.competencias?.toUpperCase() === compName?.toUpperCase());
        return {
            id: compName, 
            competencia: compName,
            estandar: matchingEstandar?.estandar || 'No se halló estándar registrado para esta competencia.',
            groupHash: compName.split(' ').map((w:string)=>w[0]).join(''),
            rows: itemsWithSpan
        };
    });
};

const InternalToast: React.FC<{ message: string; type: 'success' | 'error' | 'warning'; onClose: () => void; usage?: AiUsageProgress | null }> = ({ message, type, onClose, usage = null }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const bgClass = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-amber-500';
    const icon = type === 'success' ? '✨' : type === 'error' ? '🚫' : '⚠️';

    return (
        <div className="animate-fly-in-right pointer-events-none">
            <div className={`${bgClass} px-8 py-5 rounded-[2.5rem] shadow-[0_30px_90px_rgba(0,0,0,0.4)] border border-white/30 flex items-center gap-6 backdrop-blur-2xl transition-all text-white pointer-events-auto`}>
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0 shadow-inner">
                    {icon}
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70 mb-1">IA Armi Docente</span>
                    <p className="text-xs font-bold leading-tight uppercase tracking-tight break-words">{message}</p>
                    {usage ? (
                        <div className="mt-3">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase opacity-80">
                                <span>Uso local IA hoy</span>
                                <span>{usage.label}</span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-white/20 overflow-hidden">
                                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${usage.percent}%` }} />
                            </div>
                            <p className="mt-1 text-[9px] font-bold opacity-75">{usage.note}</p>
                        </div>
                    ) : null}
                </div>
                <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-black/10 flex items-center justify-center transition-colors text-lg shrink-0">✕</button>
            </div>
        </div>
    );
};

// Added AuthOverlay component to provide UI for API key input
const AuthOverlay: React.FC<{ 
    onSave: (config: {
        provider: 'gemini' | 'openai';
        geminiKey: string;
        openaiKey: string;
        geminiModel: string;
        openaiModel: string;
        aiPedagogicalRoute: string;
        institutionalProblems: string;
        unitPedagogicalFocus: string;
    }) => void; 
    onClose: () => void;
    isSaving: boolean;
    initialProvider?: 'gemini' | 'openai';
    initialGeminiKey?: string;
    initialOpenAIKey?: string;
    initialGeminiModel?: string;
    initialOpenAIModel?: string;
    initialAiPedagogicalRoute?: string;
    initialInstitutionalProblems?: string;
    initialUnitPedagogicalFocus?: string;
}> = ({
    onSave,
    onClose,
    isSaving,
    initialProvider = 'gemini',
    initialGeminiKey = '',
    initialOpenAIKey = '',
    initialGeminiModel = '',
    initialOpenAIModel = '',
    initialAiPedagogicalRoute = '',
    initialInstitutionalProblems = '',
    initialUnitPedagogicalFocus = ''
}) => {
    const [provider, setProvider] = useState<'gemini' | 'openai'>(initialProvider);
    const [inputKey, setInputKey] = useState(initialGeminiKey);
    const [openaiKey, setOpenaiKey] = useState(initialOpenAIKey);
    const [geminiModel, setGeminiModel] = useState(initialGeminiModel || getDefaultModelForProvider('gemini'));
    const [openaiModel, setOpenaiModel] = useState(initialOpenAIModel || getDefaultModelForProvider('openai'));
    const [geminiModelOptions, setGeminiModelOptions] = useState<AiModelOption[]>(getFallbackModelOptions('gemini'));
    const [openaiModelOptions, setOpenaiModelOptions] = useState<AiModelOption[]>(getFallbackModelOptions('openai'));
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [modelsMessage, setModelsMessage] = useState('');
    const [imageCapability, setImageCapability] = useState<AiImageCapability>({ available: false, models: [], source: 'unknown' });
    const [aiPedagogicalRoute, setAiPedagogicalRoute] = useState(initialAiPedagogicalRoute);
    const [institutionalProblems, setInstitutionalProblems] = useState(initialInstitutionalProblems);
    const [unitPedagogicalFocus, setUnitPedagogicalFocus] = useState(initialUnitPedagogicalFocus);
    const canSave = provider === 'gemini' ? !!inputKey.trim() : !!openaiKey.trim();

    const saveConfiguration = () => onSave({
        provider,
        geminiKey: inputKey.trim(),
        openaiKey: openaiKey.trim(),
        geminiModel,
        openaiModel,
        aiPedagogicalRoute: aiPedagogicalRoute.trim(),
        institutionalProblems: institutionalProblems.trim(),
        unitPedagogicalFocus: unitPedagogicalFocus.trim()
    });

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.defaultPrevented || isSaving || !canSave) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
            event.preventDefault();
            saveConfiguration();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [provider, inputKey, openaiKey, geminiModel, openaiModel, aiPedagogicalRoute, institutionalProblems, unitPedagogicalFocus, isSaving, canSave]);

    useEffect(() => {
        let cancelled = false;
        const loadModels = async () => {
            const activeKey = provider === 'gemini' ? inputKey.trim() : openaiKey.trim();
            if (!activeKey) {
                setModelsMessage('Ingresa una clave para cargar modelos actuales.');
                return;
            }

            setIsLoadingModels(true);
            setModelsMessage('');
            try {
                const options = provider === 'gemini'
                    ? await fetchGeminiTextModels(activeKey)
                    : await fetchOpenAITextModels(activeKey);
                const nextImageCapability = provider === 'gemini'
                    ? await fetchGeminiImageCapability(activeKey)
                    : await fetchOpenAIImageCapability(activeKey);
                if (cancelled) return;
                setImageCapability(nextImageCapability);
                if (provider === 'gemini') {
                    setGeminiModelOptions(options);
                    if (!options.some((item) => item.id === geminiModel)) {
                        setGeminiModel(options[0]?.id || getDefaultModelForProvider('gemini'));
                    }
                } else {
                    setOpenaiModelOptions(options);
                    if (!options.some((item) => item.id === openaiModel)) {
                        setOpenaiModel(options[0]?.id || getDefaultModelForProvider('openai'));
                    }
                }
            } catch (error: any) {
                if (cancelled) return;
                setModelsMessage(String(error?.message || 'No se pudieron cargar modelos actuales. Se usarán opciones seguras.'));
                setImageCapability({ available: false, models: [], source: 'unknown' });
                if (provider === 'gemini') {
                    const fallback = getFallbackModelOptions('gemini');
                    setGeminiModelOptions(fallback);
                    if (!fallback.some((item) => item.id === geminiModel)) {
                        setGeminiModel(fallback[0]?.id || getDefaultModelForProvider('gemini'));
                    }
                } else {
                    const fallback = getFallbackModelOptions('openai');
                    setOpenaiModelOptions(fallback);
                    if (!fallback.some((item) => item.id === openaiModel)) {
                        setOpenaiModel(fallback[0]?.id || getDefaultModelForProvider('openai'));
                    }
                }
            } finally {
                if (!cancelled) setIsLoadingModels(false);
            }
        };
        void loadModels();
        return () => { cancelled = true; };
    }, [provider, inputKey, openaiKey]);

    return (
        <div role="dialog" aria-modal="true" aria-label="Configuración de proveedor IA" className="ai-provider-overlay fixed inset-0 z-[5000] flex items-start justify-center overflow-y-auto overscroll-contain p-4 bg-slate-900/80 backdrop-blur-xl animate-fade-in">
            <div className="ai-provider-dialog my-2 bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col md:flex-row">
                <div className="ai-provider-aside bg-blue-600 w-full md:w-72 p-8 text-white flex flex-col justify-between">
                    <div>
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-inner">🤖</div>
                        <h3 className="text-xl font-black uppercase tracking-tight leading-tight mb-4">Asistente IA Armi</h3>
                        <p className="text-[10px] font-bold text-blue-100 leading-relaxed uppercase tracking-wider">Configuración necesaria para habilitar la generación automática de unidades pedagógicas.</p>
                    </div>
                    <div className="mt-8 space-y-4">
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Ingresa a <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline decoration-2 underline-offset-2">Google AI Studio</a>.</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Pulsa "Create API Key".</p>
                        </div>
                        <div className="flex gap-3 items-start">
                            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                            <p className="text-[9px] font-bold leading-tight uppercase">Copia el código y pégalo aquí.</p>
                        </div>
                    </div>
                </div>

                <div className="ai-provider-content flex-1 p-10 flex flex-col">
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Motor IA</h4>
                            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Configuracion de Proveedor</h2>
                        </div>
                        <button type="button" aria-label="Cerrar configuración de IA" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">✕</button>
                    </div>

                    <div className="ai-provider-fields space-y-6 flex-1">
                        <div className="group">
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Proveedor IA activo:</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setProvider('gemini')}
                                    className={`rounded-2xl px-4 py-4 text-xs font-black uppercase transition-all border-2 ${provider === 'gemini' ? 'bg-blue-600 text-white border-blue-600 shadow-lg' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                >
                                    Gemini
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setProvider('openai')}
                                    className={`rounded-2xl px-4 py-4 text-xs font-black uppercase transition-all border-2 ${provider === 'openai' ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                >
                                    ChatGPT / OpenAI
                                </button>
                            </div>
                        </div>
                        <div className="group">
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Copia tu API KEY aquí:</label>
                            <div className="relative">
                                <input 
                                    type="password"
                                    value={inputKey}
                                    onChange={(e) => setInputKey(e.target.value)}
                                    placeholder="AIzaSy..."
                                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-mono focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">🔑</div>
                            </div>
                        </div>
                        <div className="group">
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Clave ChatGPT / OpenAI:</label>
                            <div className="relative">
                                <input
                                    type="password"
                                    value={openaiKey}
                                    onChange={(e) => setOpenaiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className={`w-full bg-slate-50 border-2 rounded-2xl px-5 py-4 text-sm font-mono transition-all outline-none shadow-inner ${provider === 'openai' ? 'border-emerald-200 focus:border-emerald-500 focus:bg-white' : 'border-slate-100 focus:border-slate-300 focus:bg-white'}`}
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">AI</div>
                            </div>
                        </div>
                        <div className="group">
                            <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">Modelo actual:</label>
                            <select
                                value={provider === 'gemini' ? geminiModel : openaiModel}
                                onChange={(e) => provider === 'gemini' ? setGeminiModel(e.target.value) : setOpenaiModel(e.target.value)}
                                className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-bold focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner"
                            >
                                {(provider === 'gemini' ? geminiModelOptions : openaiModelOptions).map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                            </select>
                            <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase">
                                <span className="text-slate-400">{isLoadingModels ? 'Cargando modelos vigentes...' : 'Solo se muestran modelos de texto útiles y no preview.'}</span>
                                {modelsMessage ? <span className="text-amber-600">{modelsMessage}</span> : null}
                            </div>
                            <p className={`mt-2 text-[10px] font-black uppercase ${imageCapability.available ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {imageCapability.available
                                    ? `Imágenes detectadas: ${imageCapability.models.slice(0, 2).map((item) => item.label).join(', ')}${imageCapability.models.length > 2 ? '...' : ''}`
                                    : 'Imágenes no detectadas con esta clave en este momento.'}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">
                                    Ruta pedagógica anual:
                                </label>
                                <textarea
                                    value={aiPedagogicalRoute}
                                    onChange={(e) => setAiPedagogicalRoute(e.target.value)}
                                    placeholder="Ejemplo: Durante el año se desarrollará un portafolio de emprendimiento orientado al concurso Crea y Emprende..."
                                    className="w-full min-h-[110px] bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-xs font-bold focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner resize-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">
                                    Problemáticas institucionales por bimestre:
                                </label>
                                <textarea
                                    value={institutionalProblems}
                                    onChange={(e) => setInstitutionalProblems(e.target.value)}
                                    placeholder="Ejemplo: I Bimestre: Bajo rendimiento académico. II Bimestre: Escasos hábitos de lectura..."
                                    className="w-full min-h-[110px] bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-xs font-bold focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner resize-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 mb-3 ml-1 uppercase tracking-widest">
                                    Enfoque o producto esperado por unidad:
                                </label>
                                <textarea
                                    value={unitPedagogicalFocus}
                                    onChange={(e) => setUnitPedagogicalFocus(e.target.value)}
                                    placeholder="Ejemplo: Unidad 2: Identificación del problema y mapa de empatía. Unidad 3: Propuesta de valor y Lean Canvas..."
                                    className="w-full min-h-[120px] bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-xs font-bold focus:border-blue-500 focus:bg-white transition-all outline-none shadow-inner resize-none"
                                />
                            </div>
                        </div>
                        <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 flex gap-4">
                            <span className="text-xl shrink-0">🛡️</span>
                            <p className="text-[10px] text-amber-700 font-bold leading-relaxed uppercase">Tu llave se guardará en armi.db de forma privada.</p>
                        </div>
                    </div>

                    <button 
                        onClick={saveConfiguration}
                        disabled={!canSave || isSaving}
                        className="btn-water water-blue w-full py-5 rounded-[2rem] text-white font-black text-[11px] uppercase tracking-[0.2em] shadow-xl disabled:opacity-50 mt-8 h-[64px]"
                    >
                        {isSaving ? "Guardando en SQL..." : "Guardar configuración IA"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const UnitsView: React.FC<Props> = ({ activeSection, onSuccess }) => {
    const planningHeaderRef = useRef<HTMLDivElement>(null);
    const initialSelection = useMemo(() => readStoredViewSelection(UNITS_VIEW_SELECTION_STORAGE_KEY), []);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    const [selectedAreaId, setSelectedAreaId] = useState(initialSelection.areaId || '');
    const [selectedGrade, setSelectedGrade] = useState(initialSelection.grade || '');
    const [selectedSection, setSelectedSection] = useState(initialSelection.section || '');
    const [unitNumber, setUnitNumber] = useState(initialSelection.unitNumber || '1');
    const [competenciasBase, setCompetenciasBase] = useState<any[]>([]);
    const [loadedCurriculumKey, setLoadedCurriculumKey] = useState('');
    const [loadedUnitKey, setLoadedUnitKey] = useState('');
    const [estandaresBase, setEstandaresBase] = useState<any[]>([]);
    const [generalData, setGeneralData] = useState<GeneralData | null>(null);
    
    const [transversalesBase, setTransversalesBase] = useState<any[]>([]);
    const [transversalesEstandares, setTransversalesEstandares] = useState<any[]>([]);

    const [allPrograms, setAllPrograms] = useState<Record<string, any>>({});
    const [year, setYear] = useState(initialSelection.year || new Date().getFullYear().toString());
    const [isGeneratingIA, setIsGeneratingIA] = useState(false);
    const [showCompSelector, setShowCompSelector] = useState(false);
    const [showTemplateMode, setShowTemplateMode] = useState(false);
    const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' | 'warning', usage?: AiUsageProgress | null } | null>(null);
    const [hasStoredUnits, setHasStoredUnits] = useState(false);
    const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
    const [isManageUnitsModalOpen, setIsManageUnitsModalOpen] = useState(false);
    const [allSavedUnitsList, setAllSavedUnitsList] = useState<any[]>([]);
    const [deletingUnitId, setDeletingUnitId] = useState<string | null>(null);
    
    const [isDirty, setIsDirty] = useState(false);
    const [fieldsGenerating, setFieldsGenerating] = useState<Record<string, boolean>>({});
    const [collapsedSessions, setCollapsedSessions] = useState<Record<number, boolean>>({});
    const [evidenceDropdownOpen, setEvidenceDropdownOpen] = useState<Record<number, boolean>>({});
    const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [collapseEligible, setCollapseEligible] = useState<Record<number, boolean>>({});

    // Added missing state variables for API key auth
    const [showAuthScreen, setShowAuthScreen] = useState(false);
    const [aiUsageProgress, setAiUsageProgress] = useState<AiUsageProgress>(() => getAiUsageProgress());
    const [savingKey, setSavingKey] = useState(false);
    
    const [unitData, setUnitData] = useState<any>({
        title: '', purpose: '', product: '', situation: '',
        selectedComps: {}, 
        desempenos: {}, criterios: {}, evidencias: {}, instrumentos: {},
        criteriosTrans: {}, evidenciasTrans: {}, instrumentosTrans: {},
        enfoques: {}, 
        sesiones: [
            buildEmptySessionFromDetail({ id: 1, date: '', combinations: [] }),
            buildEmptySessionFromDetail({ id: 2, date: '', combinations: [] })
        ],
        recursos: { actividades: '', medios: '', materiales: '', software: '', espacios: '' },
        bibliografia: { libros: '', links: '' },
        evaluacion: DEFAULT_EVAL_TEXT
    });
    const [themeColor, setThemeColor] = useState(localStorage.getItem('armi_units_theme') || '#d35400');
    const curriculumKey = JSON.stringify([selectedAreaId, selectedGrade]);
    const unitKey = JSON.stringify([year, selectedAreaId, selectedGrade, selectedSection, unitNumber]);
    const unitPlanningReady = loadedCurriculumKey === curriculumKey && loadedUnitKey === unitKey;

    // REFS PARA FOCUS Y SCROLL
    const purposeRef = useRef<HTMLTextAreaElement>(null);
    const productRef = useRef<HTMLTextAreaElement>(null);
    const situationRef = useRef<HTMLTextAreaElement>(null);
    const sesionesRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
    const sessionFieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
    const tableFieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
    const sessionRowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
    const fieldAnimationTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const latestUnitDataRef = useRef(unitData);
    const lastLoadedToastKeyRef = useRef('');

    // Refs para contenedores de sección para focus
    const sectionIRef = useRef<HTMLDivElement>(null);
    const matrixRef = useRef<HTMLDivElement>(null);
    const sessionsTableRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        latestUnitDataRef.current = unitData;
    }, [unitData]);

    useEffect(() => () => {
        Object.values(fieldAnimationTimers.current).forEach(clearTimeout);
    }, []);

    useEffect(() => {
        Object.values(sesionesRefs.current).forEach(autoResizeTextarea);
        Object.values(sessionFieldRefs.current).forEach(autoResizeTextarea);
    }, [unitData.sesiones]);

    useEffect(() => {
        Object.values(sesionesRefs.current).forEach(autoResizeTextarea);
        Object.values(sessionFieldRefs.current).forEach(autoResizeTextarea);
    }, [collapsedSessions]);

    useEffect(() => {
        const raf = requestAnimationFrame(() => {
            document.querySelectorAll('.session-auto-textarea').forEach((el) => {
                autoResizeTextarea(el as HTMLTextAreaElement);
            });
        });
        return () => cancelAnimationFrame(raf);
    }, [unitData.sesiones, collapsedSessions]);

    useEffect(() => {
        const raf = requestAnimationFrame(() => {
            const next: Record<number, boolean> = {};
            Object.entries(sessionRowRefs.current).forEach(([id, row]) => {
                if (!row) return;
                const height = (row as HTMLTableRowElement).getBoundingClientRect().height;
                next[Number(id)] = height > 180;
            });
            setCollapseEligible(next);
        });
        return () => cancelAnimationFrame(raf);
    }, [unitData.sesiones, collapsedSessions]);

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            setCursorPos({ x: e.clientX, y: e.clientY });
        };
        document.addEventListener('mousemove', handleMove, { passive: true });
        return () => document.removeEventListener('mousemove', handleMove);
    }, []);


    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    useEffect(() => {
        const load = async () => {
            const programsRequest = getProgramacionesAnuales();
            const unitsRequest = getAllUnidadesDidacticas();
            const gd = await getDatosGenerales();
            setGeneralData(gd);
            if (!initialSelection.year && gd.year) setYear(gd.year);
            const saved = localStorage.getItem('armi_assignments');
            if (saved) setAssignments(JSON.parse(saved));
            setAssignmentsLoaded(true);
            programsRequest.then(setAllPrograms);
            unitsRequest.then(unitsMap => setHasStoredUnits(Object.keys(unitsMap || {}).length > 0));
        };
        load();
    }, [initialSelection.year]);

    const areaOptions = useMemo(() => {
        const unique = new Map();
        assignments.forEach(a => { if(!unique.has(a.areaId)) unique.set(a.areaId, a.areaName); });
        return Array.from(unique.entries()).map(([id, name]) => ({ value: id, label: name.toUpperCase() }));
    }, [assignments]);

    const isEPT = useMemo(() => {
        const a = assignments.find(a => a.areaId === selectedAreaId);
        return a?.areaName?.toUpperCase().includes("TRABAJO");
    }, [selectedAreaId, assignments]);

    const gradeOptions = useMemo(() => {
        if (!selectedAreaId) return [];
        const grades = new Set(assignments.filter(a => a.areaId === selectedAreaId).map(a => a.grade));
        return Array.from(grades).map(g => ({ value: g, label: g }));
    }, [assignments, selectedAreaId]);

    const sectionOptions = useMemo(() => {
        if (!selectedAreaId || !selectedGrade) return [];
        const sections = Array.from(new Set(assignments
            .filter(a => a.areaId === selectedAreaId && a.grade === selectedGrade)
            .map(a => a.section))).sort();
        
        const options = sections.map(s => ({ value: s, label: s }));
        if (sections.length > 1) {
            const last = sections[sections.length - 1];
            const others = sections.slice(0, -1);
            const joinedLabel = sections.length === 2 
                ? `${sections[0]} y ${sections[1]}` 
                : `${others.join(', ')} y ${last}`;
            options.push({ value: joinedLabel, label: joinedLabel });
        }
        return options;
    }, [assignments, selectedAreaId, selectedGrade]);

    useEffect(() => {
        writeStoredViewSelection(UNITS_VIEW_SELECTION_STORAGE_KEY, {
            areaId: selectedAreaId,
            grade: selectedGrade,
            section: selectedSection,
            unitNumber,
            year
        });
    }, [selectedAreaId, selectedGrade, selectedSection, unitNumber, year]);

    useEffect(() => {
        if (!assignmentsLoaded) return;
        if (selectedAreaId && !areaOptions.some(option => option.value === selectedAreaId)) {
            setSelectedAreaId('');
            setSelectedGrade('');
            setSelectedSection('');
            return;
        }
        if (selectedGrade && !gradeOptions.some(option => option.value === selectedGrade)) {
            setSelectedGrade('');
            setSelectedSection('');
            return;
        }
        if (selectedSection && !sectionOptions.some(option => option.value === selectedSection)) {
            setSelectedSection('');
            return;
        }
        if (unitNumber && !UNITS.some(unit => String(unit) === String(unitNumber))) {
            setUnitNumber('1');
        }
    }, [assignmentsLoaded, selectedAreaId, selectedGrade, selectedSection, unitNumber, areaOptions, gradeOptions, sectionOptions]);

    const currentBimesterRoman = useMemo(() => {
        const u = parseInt(unitNumber);
        if (u <= 2) return 'I';
        if (u <= 4) return 'II';
        if (u <= 6) return 'III';
        return 'IV';
    }, [unitNumber]);

    const sessionDetails = useMemo(() => {
        if (!selectedAreaId || !selectedGrade || !selectedSection || !generalData) return [];

        const calendarMapRaw = localStorage.getItem('armi_calendar_state');
        const calendarMap: Record<string, string> = calendarMapRaw ? JSON.parse(calendarMapRaw) : {};
        
        const scheduleEntriesRaw = localStorage.getItem('armi_schedule_entries');
        const scheduleEntries: ScheduleEntry[] = scheduleEntriesRaw ? JSON.parse(scheduleEntriesRaw) : [];
        
        const scheduleConfigRaw = localStorage.getItem('armi_schedule_config');
        const scheduleConfig: ScheduleConfig = scheduleConfigRaw ? JSON.parse(scheduleConfigRaw) : { breaks: [] } as any;
        const breaks = scheduleConfig.breaks || [];

        const start = (generalData as any)[`u${unitNumber}_start`] || '';
        const end = (generalData as any)[`u${unitNumber}_end`] || '';

        if (!start || !end) return [];

        const normAreaId = superNormalize(selectedAreaId);
        const normGrade = superNormalize(selectedGrade);
        const normSections = selectedSection.split(/, | y /).map(s => s.trim().toUpperCase());

        const scheduleBySectionAndDay: Record<string, Record<string, number[]>> = {};
        normSections.forEach(sec => {
            scheduleBySectionAndDay[sec] = {};
            scheduleEntries.filter(e => 
                (superNormalize(e.areaId) === normAreaId || superNormalize(e.areaName) === normAreaId) &&
                superNormalize(e.grade) === normGrade &&
                String(e.section).trim().toUpperCase() === sec
            ).forEach(e => {
                const dayText = normalizeText(e.day);
                if (!scheduleBySectionAndDay[sec][dayText]) scheduleBySectionAndDay[sec][dayText] = [];
                scheduleBySectionAndDay[sec][dayText].push(e.hourIndex);
            });
        });

        const diagnosticWeeksForUnit1 = unitNumber === '1'
            ? Math.max(0, Number(generalData.management_weeks_u1 || 0))
            : 0;

        const startUnitDate = new Date(start + 'T00:00:00');
        if (diagnosticWeeksForUnit1 > 0) {
            startUnitDate.setDate(startUnitDate.getDate() + diagnosticWeeksForUnit1 * 7);
        }
        const lastUnitDate = new Date(end + 'T00:00:00');

        if (startUnitDate > lastUnitDate) return [];

        const weekGroups: Date[][] = [];
        let tempDate = new Date(startUnitDate);
        while (tempDate <= lastUnitDate) {
            const diffDays = Math.floor((tempDate.getTime() - startUnitDate.getTime()) / (1000 * 60 * 60 * 24));
            const wIdx = Math.floor(diffDays / 7);
            if (!weekGroups[wIdx]) weekGroups[wIdx] = [];
            weekGroups[wIdx].push(new Date(tempDate));
            tempDate.setDate(tempDate.getDate() + 1);
        }

        let sessionsFound: { id: number, week: number, date: string, combinations: string[] }[] = [];
        let globalSessionId = 0;

        weekGroups.forEach((weekDays, wIdx) => {
            const sectionBlocks: Record<string, string[]> = {};
            normSections.forEach(sec => {
                sectionBlocks[sec] = [];
                weekDays.forEach(day => {
                    const iso = day.toISOString().split('T')[0];
                    if (calendarMap[iso] !== 'A') return;

                    const dayName = dayNumberToText(day.getDay());
                    const hours = scheduleBySectionAndDay[sec][normalizeText(dayName)];
                    
                    const sortedH = [...(hours || [])].sort((a,b)=>a-b);
                    let blocksCount = (sortedH.length > 0) ? 1 : 0;
                    for(let i=1; i<sortedH.length; i++) {
                        const prevH = sortedH[i-1];
                        const currH = sortedH[i];
                        const hasBreak = breaks.some(b => b.afterHour === prevH);
                        if(currH !== prevH + 1 || hasBreak) blocksCount++;
                    }
                    
                    const dateFormatted = day.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    for (let b = 0; b < blocksCount; b++) {
                        sectionBlocks[sec].push(dateFormatted);
                    }
                });
            });

            const maxBlocksInWeek = Math.max(0, ...Object.values(sectionBlocks).map(b => b.length));

            for (let sIdx = 0; sIdx < maxBlocksInWeek; sIdx++) {
                globalSessionId++;
                const datesInThisSession: string[] = [];
                const combinations: string[] = [];
                normSections.forEach(sec => {
                    if (sectionBlocks[sec][sIdx]) {
                        datesInThisSession.push(sectionBlocks[sec][sIdx]);
                        combinations.push(`${selectedGrade} ${sec} (${sectionBlocks[sec][sIdx]})`);
                    }
                });

                const uniqueDates = Array.from(new Set(datesInThisSession)).sort((a, b) => {
                    const [da, ma, ya] = a.split('/').map(Number);
                    const [db, mb, yb] = b.split('/').map(Number);
                    return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
                });

                sessionsFound.push({
                    id: globalSessionId,
                    week: wIdx + 1,
                    date: uniqueDates.join(' --- '),
                    combinations: combinations
                });
            }
        });

        return sessionsFound;
    }, [selectedAreaId, selectedGrade, selectedSection, unitNumber, generalData]);

    const calculatedSessionCount = sessionDetails.length;

    const groupedByCompetency = useMemo(() => {
        return groupRows(competenciasBase, estandaresBase);
    }, [competenciasBase, estandaresBase]);

    const groupedTransversales = useMemo(() => {
        return groupRows(transversalesBase, transversalesEstandares);
    }, [transversalesBase, transversalesEstandares]);

    const prioritizedCompetencies = useMemo(() => {
        const explicitlySelected = groupedByCompetency.filter(g => !!unitData.selectedComps[g.id]);
        // EPT has a single curricular competency. Treat that catalog fact as the
        // selection even during the render before the persistence effect commits.
        if (isEPT && explicitlySelected.length === 0 && groupedByCompetency.length === 1) {
            return groupedByCompetency;
        }
        return explicitlySelected;
    }, [groupedByCompetency, unitData.selectedComps, isEPT]);

    const buildSessionEvidenceCatalog = (sourceData: any): SessionEvidenceOption[] => {
        const areaOptions: SessionEvidenceOption[] = prioritizedCompetencies.flatMap((group) =>
            (group.rows || []).flatMap((row: any) =>
                splitBulletLikeText(sourceData.evidencias?.[row.originalIdx] || '').map((text, evidenceIdx) => ({
                    id: `area-${row.originalIdx}-${evidenceIdx}`,
                    criterionGroupId: `area-${group.id}-${row.originalIdx}`,
                    text,
                    color: AREA_TEXT_COLOR,
                    capacidad: String(row.capacidades || ''),
                    competencia: String(group.id || group.competencia || ''),
                    matrixIdx: Number(row.originalIdx),
                    isTrans: false,
                    rowType: 'area' as const,
                    tokens: extractMeaningfulTokens(`${row.capacidades || ''} ${text}`)
                }))
            )
        );

        const transOptions: SessionEvidenceOption[] = groupedTransversales.flatMap((group, transIdx) =>
            (group.rows || []).flatMap((row: any) =>
                splitBulletLikeText(sourceData.evidenciasTrans?.[row.originalIdx] || '').map((text, evidenceIdx) => ({
                    id: `trans-${row.originalIdx}-${evidenceIdx}`,
                    criterionGroupId: `trans-${group.id}-${row.originalIdx}`,
                    text,
                    color: TRANS_TEXT_COLORS_STRONG[transIdx % TRANS_TEXT_COLORS_STRONG.length],
                    capacidad: String(row.capacidades || ''),
                    competencia: String(group.id || group.competencia || ''),
                    matrixIdx: Number(row.originalIdx),
                    isTrans: true,
                    rowType: 'transversal' as const,
                    tokens: extractMeaningfulTokens(`${row.capacidades || ''} ${text}`)
                }))
            )
        );

        return [...areaOptions, ...transOptions];
    };

    const sessionEvidenceCatalog = useMemo(
        () => buildSessionEvidenceCatalog(unitData),
        [prioritizedCompetencies, groupedTransversales, unitData.evidencias, unitData.evidenciasTrans]
    );

    const sessionEvidenceContextSignature = useMemo(() => JSON.stringify(
        (unitData.sesiones || []).map((session: any) => ({
            id: session?.id,
            title: session?.title || '',
            con: session?.con || '',
            competencia: session?.competencia || '',
            transversales: session?.transversales || [],
            capacidades: session?.capacidades || [],
            selectedCriteriaIds: session?.selectedCriteriaIds || [],
            selectedEvidenceIds: session?.selectedEvidenceIds || []
        }))
    ), [unitData.sesiones]);

    const evidenceUsageMap = useMemo(() => {
        const usage = new Map<string, number[]>();
        (unitData.sesiones || []).forEach((session: any) => {
            const sessionId = Number(session?.id);
            const evidenceIds = Array.isArray(session?.selectedEvidenceIds) ? session.selectedEvidenceIds : [];
            evidenceIds.forEach((evidenceId: string) => {
                if (!usage.has(evidenceId)) usage.set(evidenceId, []);
                const sessions = usage.get(evidenceId)!;
                if (!sessions.includes(sessionId)) sessions.push(sessionId);
            });
        });
        return usage;
    }, [unitData.sesiones]);

    const criteriaUsageMap = useMemo(() => {
        const usage = new Map<string, number[]>();
        (unitData.sesiones || []).forEach((session: any) => {
            (Array.isArray(session?.selectedCriteriaIds) ? session.selectedCriteriaIds : []).forEach((criteriaId: string) => {
                if (!usage.has(criteriaId)) usage.set(criteriaId, []);
                const sessions = usage.get(criteriaId)!;
                const sessionId = Number(session.id);
                if (!sessions.includes(sessionId)) sessions.push(sessionId);
            });
        });
        return usage;
    }, [unitData.sesiones]);

    // Lógica para autoseleccionar competencia si solo hay una
    useEffect(() => {
        if (prioritizedCompetencies.length === 1) {
            setUnitData((prev: any) => {
                const newSesiones = prev.sesiones.map((s: any) => {
                    if (!s.competencia) return { ...s, competencia: prioritizedCompetencies[0].id };
                    return s;
                });
                return { ...prev, sesiones: newSesiones };
            });
        }
    }, [prioritizedCompetencies]);

    useEffect(() => {
        if (isEPT && groupedByCompetency.length > 0) {
            setUnitData((prev: any) => {
                const firstId = groupedByCompetency[0].id;
                if (prev.selectedComps[firstId]) return prev;
                return {
                    ...prev,
                    selectedComps: { [firstId]: true }
                };
            });
        }
    }, [isEPT, groupedByCompetency]);

    useEffect(() => {
        if (selectedAreaId && selectedGrade && selectedSection && allPrograms) {
            const currentAssign = assignments.find(a => a.areaId === selectedAreaId && a.grade === selectedGrade);
            if (!currentAssign) return;

            const unitIdx = parseInt(unitNumber) - 1;
            let cancelled = false;

            const loadUnitData = async () => {
                setLoadedUnitKey('');
                const sqlData = await getUnidadDidactica(year, selectedAreaId, selectedGrade, selectedSection, unitNumber);
                if (cancelled) return;
                const loadKey = `${year}-${selectedAreaId}-${selectedGrade}-${selectedSection}-U${unitNumber}`;
                
                const programKey = `${year}-${selectedAreaId}-${selectedGrade}-${selectedSection}`;
                const program = allPrograms[programKey];

                let syncTitle = '';
                let syncEnfoques: Record<number, any> = {};

                if (program) {
                    if (program.didacticUnits) {
                        const sourceUnit = program.didacticUnits[unitIdx] || program.didacticUnits[unitIdx.toString()];
                        if (sourceUnit) syncTitle = sourceUnit.title || '';
                    }
                    if (program.matrixChecks) {
                        ENFOQUES_LIST.forEach((enf, idx) => {
                            const checkKey = `enfoque-${superNormalize(enf)}-${unitIdx}`;
                            if (program.matrixChecks[checkKey]) {
                                const details = ENFOQUE_DETAILS[enf];
                                if (details) syncEnfoques[idx] = { ...details };
                            }
                        });
                    }
                }

                setUnitData((prev: any) => ({
                    ...prev,
                    ...(sqlData || { 
                        purpose: '', product: '', 
                        selectedComps: {},
                        desempenos: {}, criterios: {}, evidencias: {}, instrumentos: {},
                        criteriosTrans: {}, evidenciasTrans: {}, instrumentosTrans: {},
                        sesiones: sessionDetails.length > 0 
                            ? sessionDetails.map(d => buildEmptySessionFromDetail(d))
                            : [
                                buildEmptySessionFromDetail({ id: 1, date: '', combinations: [] }),
                                buildEmptySessionFromDetail({ id: 2, date: '', combinations: [] })
                              ],
                        recursos: { actividades: '', medios: '', materiales: '', software: '', espacios: '' },
                        bibliografia: { libros: '', links: '' },
                        evaluacion: DEFAULT_EVAL_TEXT
                    }),
                    sesiones: syncSessionsWithDetails(sqlData?.sesiones || [], sessionDetails),
                    title: syncTitle || (sqlData?.title || ''),
                    situation: sqlData?.situation || '',
                    enfoques: Object.keys(syncEnfoques).length > 0 ? syncEnfoques : (sqlData?.enfoques || {})
                }));
                setIsDirty(false);
                setLoadedUnitKey(unitKey);

                if (sqlData && lastLoadedToastKeyRef.current !== loadKey) {
                    lastLoadedToastKeyRef.current = loadKey;
                    setToast({ msg: `✅ Datos de la Unidad ${unitNumber} cargados desde SQL.`, type: 'success' });
                }
            };

            loadUnitData();

            return () => { cancelled = true; };
        }
    }, [selectedAreaId, selectedGrade, selectedSection, unitNumber, allPrograms, assignments, year, sessionDetails.length]);

    // Curriculum depends on area and grade, not the selected unit or its sessions.
    useEffect(() => {
        const assignment = assignments.find(a => a.areaId === selectedAreaId && a.grade === selectedGrade);
        if (!assignment) return;
        let cancelled = false;
        setLoadedCurriculumKey('');
        Promise.all([
            getCompetencias(selectedGrade, assignment.areaName),
            getEstandares(selectedGrade, assignment.areaName),
            Promise.all(TRANSVERSAL_NAMES.map(name => getCompetencias(selectedGrade, name))),
            Promise.all(TRANSVERSAL_NAMES.map(name => getEstandares(selectedGrade, name)))
        ]).then(([comps, standards, transComps, transStandards]) => {
            if (cancelled) return;
            setCompetenciasBase(comps);
            setEstandaresBase(standards);
            setTransversalesBase(transComps.flat());
            setTransversalesEstandares(transStandards.flat());
            // Empty API results also mean a failed/incomplete load. Never use
            // them to invalidate selections already saved in the unit.
            if (comps.length > 0 && transComps.every(rows => rows.length > 0)) {
                setLoadedCurriculumKey(curriculumKey);
            }
        });
        return () => { cancelled = true; };
    }, [selectedAreaId, selectedGrade, assignments]);

    const handleInputChange = (section: string, field: string, value: any) => {
        setIsDirty(true);
        setUnitData((prev: any) => {
            if (!field) return { ...prev, [section]: value };
            return { ...prev, [section]: { ...prev[section], [field]: value } };
        });
    };

    const deriveSessionEvaluationData = (session: any, sourceData: any) => {
        if (!unitPlanningReady) return {};
        const selectedCapacities = Array.isArray(session.capacidades) ? session.capacidades : [];
        const relevantAreaComp = prioritizedCompetencies.find((group) => group.id === session.competencia);
        const relevantTransComps = groupedTransversales.filter((group) =>
            (session.transversales || []).some((id: string) => normalizeLoose(id) === normalizeLoose(group.id))
        );
        const transIdxById = new Map(groupedTransversales.map((group, index) => [group.id, index]));

        const relevantRows = [
            ...(relevantAreaComp?.rows || []).map((row: any) => ({ row, source: 'area' as const, owner: relevantAreaComp })),
            ...relevantTransComps.flatMap((group) =>
                group.rows.map((row: any) => ({ row, source: 'transversal' as const, owner: group }))
            )
        ].filter((entry, index, all) =>
            all.findIndex((candidate) =>
                candidate.source === entry.source
                && candidate.owner.id === entry.owner.id
                && candidate.row.originalIdx === entry.row.originalIdx
            ) === index
        );

        const capacityCriteriaOptions = relevantRows.map((entry) => {
            const matrixIdx = entry.row.originalIdx;
            const isTrans = entry.source === 'transversal';
            const rawCriteria = isTrans
                ? sourceData.criteriosTrans[matrixIdx] || ''
                : sourceData.criterios[matrixIdx] || '';
            const criterionText = normalizeBulletArtifacts(rawCriteria).replace(/^\s*•\s*•\s*/gm, '• ').trim();
            const transIdx = isTrans ? Number(transIdxById.get(entry.owner.id) ?? 0) : -1;
            const id = isTrans
                ? `trans-${entry.owner.id}-${matrixIdx}`
                : `area-${entry.owner.id}-${matrixIdx}`;
            return criterionText ? {
                id,
                text: criterionText,
                color: isTrans ? TRANS_TEXT_COLORS_STRONG[transIdx % TRANS_TEXT_COLORS_STRONG.length] : AREA_TEXT_COLOR,
                capacidad: String(entry.row.capacidades || ''),
                competencia: String(entry.owner.id || ''),
                isTrans,
                matrixIdx: Number(matrixIdx)
            } : null;
        }).filter(Boolean) as any[];

        const availableCriteriaOptions = capacityCriteriaOptions.filter((criterion) =>
            selectedCapacities.some((capacity: string) => normalizeLoose(capacity) === normalizeLoose(criterion.capacidad))
        );
        const availableCriteriaIds = new Set(availableCriteriaOptions.map((criterion) => criterion.id));
        const selectedCriteriaIds = session.criteriaSelectionTouched && Array.isArray(session.selectedCriteriaIds)
            ? session.selectedCriteriaIds.filter((criteriaId: string) => availableCriteriaIds.has(criteriaId))
            : availableCriteriaOptions.map((criterion) => criterion.id);
        const selectedCriteriaOptions = availableCriteriaOptions.filter((criterion) => selectedCriteriaIds.includes(criterion.id));
        const criteriaItems = selectedCriteriaOptions.map((criterion) => ({
            text: criterion.text,
            color: criterion.color,
            sourceCriteriaId: criterion.id,
            capacidad: criterion.capacidad
        }));
        const criteriaText = criteriaItems.map((item) => item.text).join('\n').trim();

        const selectedCriteriaSet = new Set(selectedCriteriaIds);
        const availableEvidenceOptions = buildSessionEvidenceCatalog(sourceData).filter((candidate) =>
            selectedCriteriaSet.has(candidate.criterionGroupId)
            && selectedCapacities.some((capacity: string) => normalizeLoose(capacity) === normalizeLoose(candidate.capacidad))
            && (candidate.isTrans
                ? (session.transversales || []).some((id: string) => normalizeLoose(id) === normalizeLoose(candidate.competencia))
                : !session.competencia || candidate.competencia === session.competencia)
        );
        const validSelectedEvidenceIds = Array.isArray(session.selectedEvidenceIds)
            ? session.selectedEvidenceIds.filter((id: string) => availableEvidenceOptions.some((candidate) => candidate.id === id))
            : [];
        const selectedEvidenceOptions = session.evidenceDistributionMode === 'manual'
            ? availableEvidenceOptions.filter((candidate) => validSelectedEvidenceIds.includes(candidate.id))
            : availableEvidenceOptions;

        let evalInstrument = session.eval || '';
        relevantRows
            .filter((entry) => selectedCapacities.some((capacity: string) => normalizeLoose(capacity) === normalizeLoose(entry.row.capacidades)))
            .forEach((entry) => {
                const matrixIdx = entry.row.originalIdx;
                const instrument = entry.source === 'transversal'
                    ? sourceData.instrumentosTrans[matrixIdx] || ''
                    : sourceData.instrumentos[matrixIdx] || '';
                if ((instrument && entry.source === 'area') || (instrument && !evalInstrument)) evalInstrument = instrument;
            });

        const evidenceItems = session.evidenceDistributionMode === 'manual' && selectedEvidenceOptions.length === 0
            ? (Array.isArray(session.evidenceItems) ? session.evidenceItems.filter((item: any) => !item.sourceEvidenceId) : [])
            : selectedEvidenceOptions.map((candidate) => ({
                text: `${selectedEvidenceOptions.length > 1 ? '• ' : ''}${normalizeBulletArtifacts(candidate.text)}`.trim(),
                color: candidate.color,
                sourceEvidenceId: candidate.id,
                sourceCriteriaId: candidate.criterionGroupId,
                capacidad: candidate.capacidad
            }));
        const derivedEvidenceText = evidenceItems.map((item: any) => item.text).join('\n').trim();

        return {
            des: criteriaText,
            evi: session.evidenceDistributionMode === 'manual' && evidenceItems.length === 0
                ? (!(session.evidenceItems || []).length && !(session.selectedEvidenceIds || []).length ? String(session.evi || '').trim() : '')
                : derivedEvidenceText,
            eval: evalInstrument,
            criteriaItems,
            availableCriteriaOptions,
            capacityCriteriaOptions,
            selectedCriteriaIds,
            criteriaSelectionTouched: Boolean(session.criteriaSelectionTouched),
            evidenceItems,
            selectedEvidenceIds: session.evidenceDistributionMode === 'manual'
                ? validSelectedEvidenceIds
                : availableEvidenceOptions.map((candidate) => candidate.id),
            availableEvidenceOptions,
            evidenceDistributionMode: session.evidenceDistributionMode || 'auto'
        };
    };

    const normalizeSessionCriterionOwnership = (sessions: any[]) => {
        if (!unitPlanningReady) return sessions;
        return sessions.map((session: any) => {
            const availableIds = new Set(
                (session.availableCriteriaOptions || []).map((criterion: any) => criterion.id)
            );
            const selectedCriteriaIds = (Array.isArray(session.selectedCriteriaIds)
                ? session.selectedCriteriaIds
                : []
            ).filter((criterionId: string) => availableIds.has(criterionId));
            const selectedCriteria = (session.availableCriteriaOptions || []).filter((criterion: any) =>
                selectedCriteriaIds.includes(criterion.id)
            );
            const criteriaItems = selectedCriteria.map((criterion: any) => ({
                text: criterion.text,
                color: criterion.color,
                sourceCriteriaId: criterion.id,
                capacidad: criterion.capacidad
            }));
            const selectedSet = new Set(selectedCriteriaIds);
            const availableEvidenceOptions = (session.availableEvidenceOptions || []).filter((evidence: any) =>
                selectedSet.has(evidence.criterionGroupId)
            );

            if (session.evidenceDistributionMode === 'manual') {
                return {
                    ...session,
                    selectedCriteriaIds,
                    criteriaItems,
                    des: criteriaItems.map((item: any) => item.text).join('\n').trim(),
                    availableEvidenceOptions
                };
            }

            const evidenceItems = availableEvidenceOptions.map((evidence: any) => ({
                text: `${availableEvidenceOptions.length > 1 ? '• ' : ''}${normalizeBulletArtifacts(evidence.text)}`.trim(),
                color: evidence.color,
                sourceEvidenceId: evidence.id,
                sourceCriteriaId: evidence.criterionGroupId,
                capacidad: evidence.capacidad
            }));
            return {
                ...session,
                selectedCriteriaIds,
                criteriaItems,
                des: criteriaItems.map((item: any) => item.text).join('\n').trim(),
                availableEvidenceOptions,
                selectedEvidenceIds: availableEvidenceOptions.map((evidence: any) => evidence.id),
                evidenceItems,
                evi: evidenceItems.map((item: any) => item.text).join('\n').trim()
            };
        });
    };


    const updateSessionAtIndex = (prev: any, index: number, field: string, value: any) => {
        const newSesiones = [...prev.sesiones];
        const previousSession = newSesiones[index] || {};
        newSesiones[index] = { ...previousSession, [field]: value };

        if (field === 'capacidades' || field === 'competencia' || field === 'transversales' || field === 'selectedCriteriaIds') {
            if (field !== 'selectedCriteriaIds') {
                const previousAvailableIds = new Set(
                    (previousSession.availableCriteriaOptions || []).map((criterion: any) => criterion.id)
                );
                newSesiones[index].selectedCriteriaIds = Array.isArray(previousSession.selectedCriteriaIds)
                    ? [...previousSession.selectedCriteriaIds]
                    : [];
                newSesiones[index].criteriaSelectionTouched = true;
                newSesiones[index].evidenceDistributionMode = 'auto';

                const firstDerived = deriveSessionEvaluationData(newSesiones[index], prev);
                const newlyAvailableIds = (firstDerived.availableCriteriaOptions || [])
                    .map((criterion: any) => criterion.id)
                    .filter((criterionId: string) => !previousAvailableIds.has(criterionId));
                newSesiones[index] = {
                    ...newSesiones[index],
                    ...firstDerived,
                    selectedCriteriaIds: Array.from(new Set([
                        ...(firstDerived.selectedCriteriaIds || []),
                        ...newlyAvailableIds
                    ])),
                    criteriaSelectionTouched: true
                };
                newSesiones[index] = {
                    ...newSesiones[index],
                    ...deriveSessionEvaluationData(newSesiones[index], prev)
                };
            } else {
                newSesiones[index] = {
                    ...newSesiones[index],
                    ...deriveSessionEvaluationData(newSesiones[index], prev)
                };
            }
        }

        return { ...prev, sesiones: normalizeSessionCriterionOwnership(newSesiones) };
    };

    useEffect(() => {
        if (!unitPlanningReady) return;
        setUnitData((prev: any) => {
            let changed = false;
            const sesiones = prev.sesiones.map((session: any) => {
                if (!session?.competencia && !(session?.transversales || []).length && !(session?.capacidades || []).length) {
                    return session;
                }

                const derived = deriveSessionEvaluationData(session, prev);
                const same =
                    session.des === derived.des &&
                    session.evi === derived.evi &&
                    session.eval === derived.eval &&
                    JSON.stringify(session.criteriaItems || []) === JSON.stringify(derived.criteriaItems || []) &&
                    JSON.stringify(session.availableCriteriaOptions || []) === JSON.stringify(derived.availableCriteriaOptions || []) &&
                    JSON.stringify(session.capacityCriteriaOptions || []) === JSON.stringify(derived.capacityCriteriaOptions || []) &&
                    JSON.stringify(session.selectedCriteriaIds || []) === JSON.stringify(derived.selectedCriteriaIds || []) &&
                    Boolean(session.criteriaSelectionTouched) === Boolean(derived.criteriaSelectionTouched) &&
                    JSON.stringify(session.evidenceItems || []) === JSON.stringify(derived.evidenceItems || []) &&
                    JSON.stringify(session.selectedEvidenceIds || []) === JSON.stringify(derived.selectedEvidenceIds || []) &&
                    JSON.stringify(session.availableEvidenceOptions || []) === JSON.stringify(derived.availableEvidenceOptions || []);

                if (same) return session;
                changed = true;
                return { ...session, ...derived };
            });

            const normalizedSessions = normalizeSessionCriterionOwnership(sesiones);
            return changed || JSON.stringify(normalizedSessions) !== JSON.stringify(sesiones)
                ? { ...prev, sesiones: normalizedSessions }
                : prev;
        });
    }, [
        unitPlanningReady,
        unitData.criterios,
        unitData.evidencias,
        unitData.instrumentos,
        unitData.criteriosTrans,
        unitData.evidenciasTrans,
        unitData.instrumentosTrans,
        sessionEvidenceCatalog,
        sessionEvidenceContextSignature,
        prioritizedCompetencies,
        groupedTransversales
    ]);

    useEffect(() => {
        if (!Array.isArray(sessionDetails) || sessionDetails.length === 0) return;
        setUnitData((prev: any) => {
            const syncedSessions = syncSessionsWithDetails(prev?.sesiones || [], sessionDetails);
            const same = JSON.stringify(prev?.sesiones || []) === JSON.stringify(syncedSessions);
            return same ? prev : { ...prev, sesiones: syncedSessions };
        });
    }, [sessionDetails]);

    const handleSessionInputChange = (index: number, field: string, value: any) => {
        setIsDirty(true);
        setUnitData((prev: any) => updateSessionAtIndex(prev, index, field, value));
    };

    const handleSessionInputChangeById = (sessionId: number, field: string, value: any) => {
        setIsDirty(true);
        setUnitData((prev: any) => {
            const index = prev.sesiones.findIndex((s: any) => s.id === sessionId);
            if (index === -1) return prev;
            if (field === 'evi') {
                const sessions = [...prev.sesiones];
                sessions[index] = {
                    ...sessions[index],
                    evi: value,
                    evidenceItems: [],
                    selectedEvidenceIds: [],
                    evidenceDistributionMode: 'manual'
                };
                return { ...prev, sesiones: sessions };
            }
            return updateSessionAtIndex(prev, index, field, value);
        });
    };

    const handleSessionItemChange = (sessionId: number, kind: 'criteria' | 'evidence', itemIdx: number, value: string) => {
        setIsDirty(true);
        setUnitData((prev: any) => {
            const index = prev.sesiones.findIndex((s: any) => s.id === sessionId);
            if (index === -1) return prev;
            const newSesiones = [...prev.sesiones];
            const session = { ...newSesiones[index] };
            const itemsKey = kind === 'criteria' ? 'criteriaItems' : 'evidenceItems';
            const textKey = kind === 'criteria' ? 'des' : 'evi';
            const items = Array.isArray(session[itemsKey]) ? [...session[itemsKey]] : [];
            if (!items[itemIdx]) return prev;
            const sourceId = kind === 'criteria' ? items[itemIdx].sourceCriteriaId : items[itemIdx].sourceEvidenceId;
            const linked = sourceId ? editUnitLinkedEvaluation(prev, sessionId, kind, sourceId, value, splitBulletLikeText) : prev;
            if (linked !== prev) {
                return { ...linked, sesiones: normalizeSessionCriterionOwnership(linked.sesiones.map((candidate: any) => ({
                    ...candidate, ...deriveSessionEvaluationData(candidate, linked)
                }))) };
            }
            items[itemIdx] = { ...items[itemIdx], text: value };
            session[itemsKey] = items;
            if (kind === 'evidence') session.evidenceDistributionMode = 'manual';
            session[textKey] = items.map((it: any) => it.text).join('\n').trim();
            newSesiones[index] = session;
            return { ...prev, sesiones: newSesiones };
        });
    };

    const handleSessionCriterionEdit = (sessionId: number, criterionId: string, value: string) => {
        setIsDirty(true);
        setUnitData((prev: any) => {
            const linked = editUnitLinkedEvaluation(prev, sessionId, 'criteria', criterionId, value, splitBulletLikeText);
            if (linked === prev) return prev;
            return { ...linked, sesiones: normalizeSessionCriterionOwnership(linked.sesiones.map((session: any) => ({
                ...session, ...deriveSessionEvaluationData(session, linked)
            }))) };
        });
    };

    const handleSessionItemRemove = (sessionId: number, kind: 'criteria' | 'evidence', itemIdx: number) => {
        setIsDirty(true);
        setUnitData((prev: any) => {
            const index = prev.sesiones.findIndex((s: any) => s.id === sessionId);
            if (index === -1) return prev;
            const newSesiones = [...prev.sesiones];
            const session = { ...newSesiones[index] };
            const itemsKey = kind === 'criteria' ? 'criteriaItems' : 'evidenceItems';
            const textKey = kind === 'criteria' ? 'des' : 'evi';
            const items = Array.isArray(session[itemsKey]) ? [...session[itemsKey]] : [];
            const removedItem = items[itemIdx];
            items.splice(itemIdx, 1);
            session[itemsKey] = items;
            session[textKey] = items.map((it: any) => it.text).join('\n').trim();
            if (kind === 'evidence' && removedItem?.sourceEvidenceId) {
                session.selectedEvidenceIds = (Array.isArray(session.selectedEvidenceIds) ? session.selectedEvidenceIds : [])
                    .filter((id: string) => id !== removedItem.sourceEvidenceId);
            }
            if (kind === 'evidence') session.evidenceDistributionMode = 'manual';
            newSesiones[index] = session;
            return { ...prev, sesiones: newSesiones };
        });
    };

    const toggleSessionCriterion = (sessionId: number, criterionId: string) => {
        setIsDirty(true);
        setUnitData((prev: any) => {
            const index = prev.sesiones.findIndex((session: any) => session.id === sessionId);
            if (index === -1) return prev;
            const sessions = [...prev.sesiones];
            const session = { ...sessions[index] };
            const current = Array.isArray(session.selectedCriteriaIds) ? [...session.selectedCriteriaIds] : [];
            session.selectedCriteriaIds = current.includes(criterionId)
                ? current.filter((id: string) => id !== criterionId)
                : Array.from(new Set([...current, criterionId]));
            session.criteriaSelectionTouched = true;
            session.evidenceDistributionMode = 'auto';
            Object.assign(session, deriveSessionEvaluationData(session, prev));
            sessions[index] = session;
            return { ...prev, sesiones: normalizeSessionCriterionOwnership(sessions) };
        });
    };

    const handleSessionEvidenceSelection = (sessionId: number, evidenceId: string, checked: boolean) => {
        setIsDirty(true);
        setUnitData((prev: any) => {
            const index = prev.sesiones.findIndex((s: any) => s.id === sessionId);
            if (index === -1) return prev;
            const newSesiones = [...prev.sesiones];
            const session = { ...newSesiones[index] };
            const current = Array.isArray(session.selectedEvidenceIds) ? [...session.selectedEvidenceIds] : [];
            const nextIds = checked
                ? Array.from(new Set([...current, evidenceId]))
                : current.filter((id: string) => id !== evidenceId);
            const available = Array.isArray(session.availableEvidenceOptions) ? session.availableEvidenceOptions : [];
            const selectedItems = available.filter((candidate: SessionEvidenceOption) => nextIds.includes(candidate.id));

            session.selectedEvidenceIds = nextIds;
            session.evidenceDistributionMode = 'manual';
            session.evidenceItems = selectedItems.map((candidate: SessionEvidenceOption) => ({
                text: `${selectedItems.length > 1 ? '• ' : ''}${normalizeBulletArtifacts(candidate.text)}`.trim(),
                color: candidate.color,
                sourceEvidenceId: candidate.id,
                capacidad: candidate.capacidad
            }));
            session.evi = session.evidenceItems.map((item: any) => item.text).join('\n').trim();

            newSesiones[index] = session;
            return { ...prev, sesiones: newSesiones };
        });
    };

    const handleAddSessionRow = () => {
        setIsDirty(true);
        setUnitData((prev: any) => ({
            ...prev,
            sesiones: [
                ...prev.sesiones,
                { id: prev.sesiones.length + 1,
                    date: '', 
                    title: '',
                    cap: '',
                    des: '',
                    con: '',
                    evi: '',
                    eval: '',
                    competencia: prioritizedCompetencies.length === 1 ? prioritizedCompetencies[0].id : '',
                    transversales: [],
                    capacidades: [],
                    selectedEvidenceIds: [],
                    availableEvidenceOptions: []
                }
            ]
        }));
    };

    const handleSaveIAKey = async (config: {
        provider: 'gemini' | 'openai';
        geminiKey: string;
        openaiKey: string;
        geminiModel: string;
        openaiModel: string;
        aiPedagogicalRoute: string;
        institutionalProblems: string;
        unitPedagogicalFocus: string;
    }) => {
        if (!generalData) return;
        setSavingKey(true);
        try {
            const updated = {
                ...generalData,
                gemini_api_key: config.geminiKey,
                openai_api_key: config.openaiKey,
                ai_provider: config.provider,
                gemini_model: config.geminiModel,
                openai_model: config.openaiModel,
                ai_pedagogical_route: config.aiPedagogicalRoute,
                ai_institutional_problems: config.institutionalProblems,
                ai_unit_pedagogical_focus: config.unitPedagogicalFocus
            };
            const res = await saveDatosGenerales(updated);
            if (res.success) {
                setGeneralData(updated);
                setShowAuthScreen(false);
                setToast({ msg: "✅ Llave IA guardada correctamente.", type: 'success' });
            }
        } catch (e) {
            setToast({ msg: "Error al guardar llave en la base de datos.", type: 'error' });
        } finally {
            setSavingKey(false);
        }
    };

    const triggerFieldAnimation = (fieldPath: string) => {
        if (fieldAnimationTimers.current[fieldPath]) {
            clearTimeout(fieldAnimationTimers.current[fieldPath]);
        }
        setFieldsGenerating((prev) => ({ ...prev, [fieldPath]: true }));
        fieldAnimationTimers.current[fieldPath] = setTimeout(() => {
            setFieldsGenerating((prev) => ({ ...prev, [fieldPath]: false }));
            delete fieldAnimationTimers.current[fieldPath];
        }, 950);
    };

    const startTypingField = (fieldPath: string, targetText: string, ref?: any) => {
        const shouldNormalizeAsList =
            fieldPath.startsWith('evidencias.') ||
            fieldPath.startsWith('evidenciasTrans.') ||
            fieldPath.startsWith('criterios.') ||
            fieldPath.startsWith('criteriosTrans.');
        const normalizedTargetText = shouldNormalizeAsList ? normalizeListText(targetText) : targetText;
        if (!normalizedTargetText) return;
        
        const keys = fieldPath.split('.');
        setUnitData((prev: any) => {
            const next = { ...prev };
            let source: any = prev;
            let target: any = next;
            for (let i = 0; i < keys.length - 1; i++) {
                const key = keys[i];
                const sourceChild = source?.[key];
                const clonedChild = Array.isArray(sourceChild)
                    ? [...sourceChild]
                    : { ...(sourceChild || {}) };
                target[key] = clonedChild;
                source = sourceChild;
                target = clonedChild;
            }
            target[keys[keys.length - 1]] = normalizedTargetText;
            latestUnitDataRef.current = next;
            return next;
        });

        // El dato completo ya estÃ¡ guardado; la escritura es solo una animaciÃ³n CSS.
        triggerFieldAnimation(fieldPath);
        // Mantener visible el inicio evita que los conocimientos parezcan truncados.
        if (ref?.current) ref.current.scrollTop = 0;
    };

    const extractJsonBlock = (rawText: string) => {
        const cleaned = String(rawText || '').replace(/```json/gi, '').replace(/```/g, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            throw new Error('La IA no devolvio un JSON valido.');
        }
        return cleaned.slice(firstBrace, lastBrace + 1);
    };

    const getOpenAIOutputText = (payload: any): string => {
        if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
        const output = Array.isArray(payload?.output) ? payload.output : [];
        const parts = output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : []);
        const text = parts
            .filter((part: any) => typeof part?.text === 'string')
            .map((part: any) => part.text)
            .join('\n')
            .trim();
        if (text) return text;
        throw new Error('OpenAI no devolvio texto utilizable.');
    };

    const requestOpenAIJson = async (apiKey: string, prompt: string, model: string) => {
        const res = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                input: prompt
            })
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok) {
            const message = payload?.error?.message || 'Error al consultar OpenAI.';
            throw new Error(message);
        }

        return {
            data: JSON.parse(extractJsonBlock(getOpenAIOutputText(payload))),
            totalTokens: Number(payload?.usage?.total_tokens || 0)
        };
    };

    const normalizeInstrumentInternal = (inst: string) => {
        const norm = inst.toLowerCase();
        if (norm.includes('rúbrica') || norm.includes('rubrica')) return 'Rúbrica';
        if (norm.includes('cotejo')) return 'Lista de Cotejo';
        if (norm.includes('observación') || norm.includes('observacion')) return 'Guía de observación';
        if (norm.includes('escala')) return 'Escala de valoración';
        return 'Otros (especificar)';
    };

    const handleGenerateAI = async () => {
        if (!unitPlanningReady) {
            setToast({ msg: 'Espere a que se carguen la unidad y sus competencias antes de generar.', type: 'warning' });
            return;
        }
        const areaName = assignments.find(a => a.areaId === selectedAreaId)?.areaName;
        if (!areaName || !selectedGrade || !unitData.title) {
            setToast({ msg: "⚠️ Área, Grado y Título son obligatorios.", type: 'warning' });
            return;
        }

        const aiProvider = generalData?.ai_provider || 'gemini';
        const preferredOpenAIModel = String(generalData?.openai_model || getDefaultModelForProvider('openai')).trim();
        const preferredGeminiModel = String(generalData?.gemini_model || getDefaultModelForProvider('gemini')).trim();
        const apiKey = aiProvider === 'openai'
            ? (generalData?.openai_api_key || '').trim()
            : (generalData?.gemini_api_key || process.env.API_KEY || '').trim();
        if (!apiKey || apiKey.length < 10) {
            // Trigger auth screen if API key is missing
            setShowAuthScreen(true);
            return;
        }

        let activeComps = prioritizedCompetencies;
        // The AI button can be pressed while the background curriculum request is
        // still completing. EPT can safely recover its one competency on demand.
        if (activeComps.length === 0 && isEPT) {
            const [freshCompetencies, freshStandards] = await Promise.all([
                getCompetencias(selectedGrade, areaName),
                getEstandares(selectedGrade, areaName)
            ]);
            const freshGroups = groupRows(freshCompetencies, freshStandards);
            if (freshGroups.length === 1) {
                activeComps = freshGroups;
                setCompetenciasBase(freshCompetencies);
                setEstandaresBase(freshStandards);
                setUnitData((prev: any) => ({
                    ...prev,
                    selectedComps: { ...prev.selectedComps, [freshGroups[0].id]: true }
                }));
            }
        }
        if (activeComps.length === 0) {
            setToast({
                msg: isEPT
                    ? "⚠️ No se pudo cargar la competencia de EPT. Intente nuevamente."
                    : "⚠️ Seleccione al menos una competencia.",
                type: 'warning'
            });
            return;
        }

        setIsGeneratingIA(true);
        Object.values(fieldAnimationTimers.current).forEach(clearTimeout);
        fieldAnimationTimers.current = {};
        setFieldsGenerating({});

        try {
            const ai = aiProvider === 'gemini' ? createGeminiClient(apiKey) : null;
            let activeGeminiModel = preferredGeminiModel;
            let usedGeminiFallback = false;
            const unavailableGeminiModels = new Set<string>();
            const geminiFallbackOptions = {
                unavailableModels: unavailableGeminiModels,
                onModelSelected: (model: string, usedFallback: boolean) => {
                    if (usedFallback || model !== preferredGeminiModel) usedGeminiFallback = true;
                    activeGeminiModel = model;
                }
            };
            let totalTokensUsed = 0;
            const areaRows = activeComps.flatMap(g => g.rows);
            const transRows = groupedTransversales.flatMap(g => g.rows);
            const aiPedagogicalRoute = String((generalData as any)?.ai_pedagogical_route || '').trim();
            const institutionalProblems = String((generalData as any)?.ai_institutional_problems || '').trim();
            const unitPedagogicalFocus = String((generalData as any)?.ai_unit_pedagogical_focus || '').trim();
            const aiExtraContext = `
Contexto pedagógico configurable del docente:
- Ruta pedagógica anual:
${aiPedagogicalRoute || 'No especificada.'}

- Problemáticas institucionales:
${institutionalProblems || 'No especificadas.'}

- Enfoque o producto esperado por unidad:
${unitPedagogicalFocus || 'No especificado.'}

Usa este contexto solo cuando sea pertinente para la unidad actual, el área, el grado y la situación de aprendizaje. No fuerces el contenido si no corresponde.
`;

            if (sectionIRef.current) sectionIRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });

            const step1Prompt = `Actúa como experto pedagógico del MINEDU Perú. Unidad: "${unitData.title}" Área: ${areaName} – ${selectedGrade}. Genera Propósito, Producto y Situación.

${aiExtraContext}

Devuelve SOLO JSON: {"purpose": "...", "product": "...", "situation": "..."}`;
            let generatedEvaluations: any[] = [];
            if (aiProvider === 'openai') {
                const step1Result = await requestOpenAIJson(apiKey, step1Prompt, preferredOpenAIModel);
                totalTokensUsed += step1Result.totalTokens;
                const step1Data = step1Result.data;
                if (step1Data?.purpose) startTypingField('purpose', step1Data.purpose, purposeRef);
                if (step1Data?.product) startTypingField('product', step1Data.product, productRef);
                if (step1Data?.situation) startTypingField('situation', step1Data.situation, situationRef);
            } else if (ai) {
                const step1Stream = await generateGeminiContentStream(ai, { contents: [{ parts: [{ text: step1Prompt }] }] }, activeGeminiModel, geminiFallbackOptions);
                let fullStep1 = "";
                let step1Tokens = 0;
                for await (const chunk of step1Stream) {
                    fullStep1 += chunk.text;
                    step1Tokens = Number(chunk?.usageMetadata?.totalTokenCount || step1Tokens || 0);
                }
                const finalStep1 = JSON.parse(extractJsonBlock(fullStep1));
                if (finalStep1?.purpose) startTypingField('purpose', finalStep1.purpose, purposeRef);
                if (finalStep1?.product) startTypingField('product', finalStep1.product, productRef);
                if (finalStep1?.situation) startTypingField('situation', finalStep1.situation, situationRef);
                totalTokensUsed += step1Tokens;
            }

            if (matrixRef.current) matrixRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const allDesempenos = [...areaRows, ...transRows];
            const promptEvaluacion = `Genera Criterio, Evidencia e Instrumento para los desempeños: ${allDesempenos.map((r, i) => `${i + 1}. ${r.desempenos_dcbn}`).join('\n')}.

${aiExtraContext}

Reglas:
- La evidencia debe ser coherente con la capacidad y el desempeÃ±o.
- Si una fila admite varias evidencias, devuÃ©lvelas en lista con viÃ±etas y saltos de lÃ­nea.
- Evita mezclar en una misma evidencia productos de etapas pedagÃ³gicas distintas si pueden separarse.

Devuelve SOLO JSON: {"evaluaciones": [{"criterio": "...", "evidencia": "...", "instrumento": "..."}]}`;
            if (aiProvider === 'openai') {
                const step2Result = await requestOpenAIJson(apiKey, promptEvaluacion, preferredOpenAIModel);
                totalTokensUsed += step2Result.totalTokens;
                const step2Data = step2Result.data;
                const evaluaciones = Array.isArray(step2Data?.evaluaciones) ? step2Data.evaluaciones : [];
                generatedEvaluations = evaluaciones;
                areaRows.forEach((row, i) => {
                    const item = evaluaciones[i] || {};
                    if (item.criterio) startTypingField(`criterios.${row.originalIdx}`, item.criterio);
                    if (item.evidencia) startTypingField(`evidencias.${row.originalIdx}`, item.evidencia);
                    if (item.instrumento) handleInputChange('instrumentos', row.originalIdx.toString(), normalizeInstrumentInternal(item.instrumento));
                });
                transRows.forEach((row, i) => {
                    const item = evaluaciones[areaRows.length + i] || {};
                    if (item.criterio) startTypingField(`criteriosTrans.${row.originalIdx}`, item.criterio);
                    if (item.evidencia) startTypingField(`evidenciasTrans.${row.originalIdx}`, item.evidencia);
                    if (item.instrumento) handleInputChange('instrumentosTrans', row.originalIdx.toString(), normalizeInstrumentInternal(item.instrumento));
                });
            } else if (ai) {
                const step2Stream = await generateGeminiContentStream(ai, { contents: [{ parts: [{ text: promptEvaluacion }] }] }, activeGeminiModel, geminiFallbackOptions);
                let fullStep2 = "";
                let step2Tokens = 0;
                for await (const chunk of step2Stream) {
                    fullStep2 += chunk.text;
                    step2Tokens = Number(chunk?.usageMetadata?.totalTokenCount || step2Tokens || 0);
                }
                const parsedStep2 = JSON.parse(extractJsonBlock(fullStep2));
                generatedEvaluations = Array.isArray(parsedStep2?.evaluaciones) ? parsedStep2.evaluaciones : [];
                areaRows.forEach((row, i) => {
                    const item = generatedEvaluations[i] || {};
                    if (item.criterio) startTypingField(`criterios.${row.originalIdx}`, item.criterio);
                    if (item.evidencia) startTypingField(`evidencias.${row.originalIdx}`, item.evidencia);
                    if (item.instrumento) handleInputChange('instrumentos', row.originalIdx.toString(), normalizeInstrumentInternal(item.instrumento));
                });
                transRows.forEach((row, i) => {
                    const item = generatedEvaluations[areaRows.length + i] || {};
                    if (item.criterio) startTypingField(`criteriosTrans.${row.originalIdx}`, item.criterio);
                    if (item.evidencia) startTypingField(`evidenciasTrans.${row.originalIdx}`, item.evidencia);
                    if (item.instrumento) handleInputChange('instrumentosTrans', row.originalIdx.toString(), normalizeInstrumentInternal(item.instrumento));
                });
                totalTokensUsed += step2Tokens;
            }

            if (generatedEvaluations.length < areaRows.length + transRows.length) {
                throw new Error('La IA devolvió evaluaciones incompletas. Vuelve a intentarlo.');
            }

            if (sessionsTableRef.current) sessionsTableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // --- Asignación de capacidades por sesión asistida por IA ---
            const sessionCount = unitData.sesiones.length;
            const areaCompCapPairs: { compId: string, cap: string }[] = [];
            const transCompCapPairs: { compId: string, cap: string }[] = [];
            const areaCriteriaCatalog = areaRows.map((row: any, rowIndex: number) => {
                const owner = activeComps.find((comp: any) => comp.rows.includes(row));
                const generated = generatedEvaluations[rowIndex] || {};
                return {
                    id: `area-${owner?.id}-${row.originalIdx}`,
                    compId: owner?.id || '',
                    cap: row.capacidades,
                    performance: row.desempenos_dcbn || '',
                    criterion: generated.criterio || '',
                    evidence: generated.evidencia || '',
                    instrument: normalizeInstrumentInternal(generated.instrumento || unitData.instrumentos?.[row.originalIdx] || '')
                };
            }).filter((item: any) => item.compId);
            const transversalCriteriaCatalog = transRows.map((row: any, rowIndex: number) => {
                const owner = groupedTransversales.find((comp: any) => comp.rows.includes(row));
                const generated = generatedEvaluations[areaRows.length + rowIndex] || {};
                return {
                    id: `trans-${owner?.id}-${row.originalIdx}`,
                    compId: owner?.id || '',
                    cap: row.capacidades,
                    performance: row.desempenos_dcbn || '',
                    criterion: generated.criterio || '',
                    evidence: generated.evidencia || '',
                    instrument: normalizeInstrumentInternal(generated.instrumento || unitData.instrumentosTrans?.[row.originalIdx] || '')
                };
            }).filter((item: any) => item.compId);
            
            activeComps.forEach(comp => {
                const uniqueCaps = Array.from(new Set(comp.rows.map((r: any) => r.capacidades)));
                uniqueCaps.forEach(cap => {
                    areaCompCapPairs.push({ compId: comp.id, cap: cap as string });
                });
            });

            groupedTransversales.forEach(trans => {
                const uniqueCaps = Array.from(new Set(trans.rows.map((r: any) => r.capacidades)));
                uniqueCaps.forEach(cap => {
                    transCompCapPairs.push({ compId: trans.id, cap: cap as string });
                });
            });

            if (areaCriteriaCatalog.length === 0) throw new Error("No hay competencias/capacidades/criterios disponibles.");

            const generatedAreaCriteria: Record<number, string> = {};
            const generatedAreaEvidence: Record<number, string> = {};
            const generatedAreaInstruments: Record<number, string> = {};
            const generatedTransCriteria: Record<number, string> = {};
            const generatedTransEvidence: Record<number, string> = {};
            const generatedTransInstruments: Record<number, string> = {};
            areaRows.forEach((row: any, index: number) => {
                const item = generatedEvaluations[index] || {};
                if (item.criterio) generatedAreaCriteria[row.originalIdx] = item.criterio;
                if (item.evidencia) generatedAreaEvidence[row.originalIdx] = item.evidencia;
                if (item.instrumento) generatedAreaInstruments[row.originalIdx] = normalizeInstrumentInternal(item.instrumento);
            });
            transRows.forEach((row: any, index: number) => {
                const item = generatedEvaluations[areaRows.length + index] || {};
                if (item.criterio) generatedTransCriteria[row.originalIdx] = item.criterio;
                if (item.evidencia) generatedTransEvidence[row.originalIdx] = item.evidencia;
                if (item.instrumento) generatedTransInstruments[row.originalIdx] = normalizeInstrumentInternal(item.instrumento);
            });

            let updatedState = {
                ...latestUnitDataRef.current,
                criterios: { ...(latestUnitDataRef.current.criterios || {}), ...generatedAreaCriteria },
                evidencias: { ...(latestUnitDataRef.current.evidencias || {}), ...generatedAreaEvidence },
                instrumentos: { ...(latestUnitDataRef.current.instrumentos || {}), ...generatedAreaInstruments },
                criteriosTrans: { ...(latestUnitDataRef.current.criteriosTrans || {}), ...generatedTransCriteria },
                evidenciasTrans: { ...(latestUnitDataRef.current.evidenciasTrans || {}), ...generatedTransEvidence },
                instrumentosTrans: { ...(latestUnitDataRef.current.instrumentosTrans || {}), ...generatedTransInstruments },
                sesiones: [...(latestUnitDataRef.current?.sesiones || [])]
            };

            const assignmentPrompt = `Asigna criterios por sesión para una unidad del área ${areaName}, grado ${selectedGrade}, con ${sessionCount} sesiones.

Unidad: ${unitData.title}
Propósito: ${latestUnitDataRef.current.purpose || unitData.purpose || 'No definido'}
Producto: ${latestUnitDataRef.current.product || unitData.product || 'No definido'}
Situación: ${latestUnitDataRef.current.situation || unitData.situation || 'No definida'}

${aiExtraContext}

Catálogo de criterios del área:
${areaCriteriaCatalog.map((item, idx) => `${idx + 1}. Competencia: ${item.compId} | Capacidad: ${item.cap} | Desempeño base: ${item.performance} | Criterio: ${item.criterion} | Evidencia: ${item.evidence} | Instrumento: ${item.instrument}`).join('\n')}

Catálogo de criterios transversales:
${transversalCriteriaCatalog.length > 0 ? transversalCriteriaCatalog.map((item, idx) => `${idx + 1}. Competencia: ${item.compId} | Capacidad: ${item.cap} | Desempeño base: ${item.performance}`).join('\n') : 'Sin opciones transversales.'}

Devuelve SOLO JSON:
{"sesiones":[{"areaCriterionIndexes":[1,2],"transversalCriterionIndexes":[1]}]}

Reglas:
- Usa exactamente ${sessionCount} sesiones.
- Distribuye las capacidades del área en bloques consecutivos, respetando el orden del catálogo y la secuencia natural del proyecto.
- Primero abarca todas las capacidades del área. Puedes repetir un criterio o capacidad en varias sesiones consecutivas cuando necesite mayor desarrollo.
- No regreses a una capacidad anterior después de avanzar a la siguiente.
- Reserva para las sesiones finales las capacidades orientadas a evaluar resultados, reflexionar, validar o mejorar el producto.
- Ninguna sesión puede quedar sin criterio del área.
- Elige conscientemente los índices según lo que debe ocurrir en cada sesión: capacidad, criterio, evidencia e instrumento viajan vinculados.
- Puedes repetir un índice en sesiones consecutivas si el aprendizaje requiere desarrollo, práctica, aplicación o evaluación durante más de una sesión.
- Evita cargar una sesión con criterios que correspondan a momentos distintos del proyecto.
- Cada índice de criterio transversal debe aparecer exactamente una vez en toda la unidad: no lo omitas ni lo repitas.
- Los criterios determinan automáticamente sus competencias y capacidades; no devuelvas nombres libres.
- En una misma sesión, los criterios del área deben pertenecer a una sola competencia del área.
- Los criterios transversales son opcionales en una sesión.`;

            let aiAssignments: Array<{ areaCriterionIndexes?: number[]; transversalCriterionIndexes?: number[] }> = [];
            if (aiProvider === 'openai') {
                const assignmentResult = await requestOpenAIJson(apiKey, assignmentPrompt, preferredOpenAIModel);
                totalTokensUsed += assignmentResult.totalTokens;
                const assignmentData = assignmentResult.data;
                aiAssignments = Array.isArray(assignmentData?.sesiones) ? assignmentData.sesiones : [];
            } else if (ai) {
                const assignmentResponse = await generateGeminiContent(ai, {
                    contents: [{ parts: [{ text: assignmentPrompt }] }]
                }, activeGeminiModel, geminiFallbackOptions);
                totalTokensUsed += Number(assignmentResponse?.usageMetadata?.totalTokenCount || 0);
                const assignmentText = assignmentResponse.text || '';
                const assignmentData = JSON.parse(extractJsonBlock(assignmentText));
                aiAssignments = Array.isArray(assignmentData?.sesiones) ? assignmentData.sesiones : [];
            }

            const distributeUniqueCriteria = (
                field: 'areaCriterionIndexes' | 'transversalCriterionIndexes',
                catalog: any[],
                singleAreaCompetency: boolean
            ) => {
                const distributed: any[][] = Array.from({ length: sessionCount }, () => []);
                const used = new Set<number>();
                aiAssignments.slice(0, sessionCount).forEach((assignment, sessionIndex) => {
                    const indexes = Array.isArray(assignment?.[field]) ? assignment[field]! : [];
                    indexes.forEach((rawIndex) => {
                        const criterionIndex = Number(rawIndex) - 1;
                        if (
                            criterionIndex < 0
                            || criterionIndex >= catalog.length
                            || used.has(criterionIndex)
                            || (singleAreaCompetency
                                && distributed[sessionIndex].length > 0
                                && distributed[sessionIndex][0].compId !== catalog[criterionIndex].compId)
                        ) return;
                        distributed[sessionIndex].push(catalog[criterionIndex]);
                        used.add(criterionIndex);
                    });
                });
                catalog.forEach((criterion, criterionIndex) => {
                    if (used.has(criterionIndex)) return;
                    let target = distributed
                        .map((items, index) => ({ items, index }))
                        .filter(({ items }) => !singleAreaCompetency || items.length === 0 || items[0].compId === criterion.compId)
                        .sort((left, right) => left.items.length - right.items.length)[0];
                    if (!target) target = { items: distributed[0], index: 0 };
                    target.items.push(criterion);
                    used.add(criterionIndex);
                });
                return distributed;
            };

            const assignedAreaCriteria = distributeOrderedCriteriaByBlocks(
                sessionCount,
                areaCriteriaCatalog,
                aiAssignments.map((assignment) => assignment?.areaCriterionIndexes || [])
            );
            const assignedTransversalCriteria = distributeUniqueCriteria('transversalCriterionIndexes', transversalCriteriaCatalog, false);
            const generatedSessions = updatedState.sesiones.map((session: any, index: number) => {
                const areaCriteria = assignedAreaCriteria[index] || [];
                const transversalCriteria = assignedTransversalCriteria[index] || [];
                const preparedSession = {
                    ...session,
                    competencia: areaCriteria[0]?.compId || '',
                    transversales: Array.from(new Set(transversalCriteria.map((item: any) => item.compId))),
                    capacidades: Array.from(new Set([
                        ...areaCriteria.map((item: any) => item.cap),
                        ...transversalCriteria.map((item: any) => item.cap)
                    ])),
                    selectedCriteriaIds: [
                        ...areaCriteria.map((item: any) => item.id),
                        ...transversalCriteria.map((item: any) => item.id)
                    ],
                    criteriaSelectionTouched: true,
                    evidenceDistributionMode: 'auto'
                };
                return { ...preparedSession, ...deriveSessionEvaluationData(preparedSession, updatedState) };
            });
            updatedState = { ...updatedState, sesiones: normalizeSessionCriterionOwnership(generatedSessions) };

            setUnitData((prev: any) => {
                const next = {
                    ...prev,
                    criterios: { ...(prev.criterios || {}), ...generatedAreaCriteria },
                    evidencias: { ...(prev.evidencias || {}), ...generatedAreaEvidence },
                    instrumentos: { ...(prev.instrumentos || {}), ...generatedAreaInstruments },
                    criteriosTrans: { ...(prev.criteriosTrans || {}), ...generatedTransCriteria },
                    evidenciasTrans: { ...(prev.evidenciasTrans || {}), ...generatedTransEvidence },
                    instrumentosTrans: { ...(prev.instrumentosTrans || {}), ...generatedTransInstruments },
                    sesiones: updatedState.sesiones
                };
                latestUnitDataRef.current = next;
                return next;
            });
            updatedState.sesiones.forEach((_session: any, index: number) => {
                triggerFieldAnimation(`sesiones.${index}.des`);
                triggerFieldAnimation(`sesiones.${index}.evi`);
            });

            // Ahora pedimos a la IA que genere los Títulos y Conocimientos basándose en lo ya asignado
            const step3Prompt = `Como experto pedagógico, genera un "title" (estructura del título: Verbo + contenido + condición) y "con" (Conocimientos específicos/temario necesario) para las siguientes ${sessionCount} sesiones del área ${areaName}. 

            ${aiExtraContext}
            
            Contexto de asignación:
            ${updatedState.sesiones.map((s: any, i: number) => {
                return `Sesión ${i+1}: Competencia "${s.competencia || 'Sin competencia de área'}", Capacidades "${(s.capacidades || []).join(', ') || 'Sin capacidad asignada'}", Criterios "${(s.criteriaItems || []).map((item: any) => item.text).join(' | ') || 'Sin criterio asignado'}"`;
            }).join('\n')}
            
            Instrucciones:
            1. El título debe ser motivador para estudiantes de ${selectedGrade}.
            2. Los conocimientos deben ser coherentes con la competencia y capacidad asignada a cada sesión.
            
            Devuelve SOLO JSON: {"sesiones": [{"title": "...", "con": "..."}]}`;

            if (aiProvider === 'openai') {
                const step3Result = await requestOpenAIJson(apiKey, step3Prompt, preferredOpenAIModel);
                totalTokensUsed += step3Result.totalTokens;
                const step3Data = step3Result.data;
                const sesiones = validateGeneratedUnitSessionTitles(step3Data, sessionCount);
                updatedState.sesiones.forEach((s: any, i: number) => {
                    const item = sesiones[i] || {};
                    if (item.title) startTypingField(`sesiones.${i}.title`, item.title, { current: sesionesRefs.current[s.id] });
                    if (item.con) startTypingField(`sesiones.${i}.con`, item.con, { current: sessionFieldRefs.current[`con-${s.id}`] });
                });
            } else if (ai) {
                const step3Stream = await generateGeminiContentStream(ai, { contents: [{ parts: [{ text: step3Prompt }] }] }, activeGeminiModel, geminiFallbackOptions);
                let fullStep3 = "";
                let step3Tokens = 0;
                for await (const chunk of step3Stream) {
                    fullStep3 += chunk.text;
                    step3Tokens = Number(chunk?.usageMetadata?.totalTokenCount || step3Tokens || 0);
                }
                const finalStep3 = JSON.parse(extractJsonBlock(fullStep3));
                const finalSessions = validateGeneratedUnitSessionTitles(finalStep3, sessionCount);
                updatedState.sesiones.forEach((s: any, i: number) => {
                    const item = finalSessions[i] || {};
                    if (item.title) startTypingField(`sesiones.${i}.title`, item.title, { current: sesionesRefs.current[s.id] });
                    if (item.con) startTypingField(`sesiones.${i}.con`, item.con, { current: sessionFieldRefs.current[`con-${s.id}`] });
                });
                totalTokensUsed += step3Tokens;
            }

            setIsDirty(true);
            registerAiUsage(aiProvider, 'unit_plan', totalTokensUsed);
            const nextUsage = getAiUsageProgress();
            setAiUsageProgress(nextUsage);
            setToast({
                msg: usedGeminiFallback
                    ? `✨ IA Armi completó la unidad usando ${activeGeminiModel}, porque el modelo seleccionado no tenía cuota disponible.`
                    : "✨ IA Armi completó la unidad correctamente.",
                type: 'success',
                usage: nextUsage
            });
        } catch (e: any) {
            const issue = classifyAiIssue(e);
            if (issue.kind === 'auth') setShowAuthScreen(true);
            if (issue.kind === 'quota_minute' || issue.kind === 'quota_daily' || issue.kind === 'quota_general' || issue.kind === 'billing_required' || issue.kind === 'saturation' || issue.kind === 'malformed_json' || issue.kind === 'empty_response' || issue.kind === 'model_access') {
                const toastType = issue.kind === 'quota_minute' || issue.kind === 'quota_daily' || issue.kind === 'quota_general' || issue.kind === 'saturation' ? 'warning' : 'error';
                setToast({ msg: `${toastType === 'warning' ? "Aviso:" : "Error:"} ${issue.userMessage}`, type: toastType });
                return;
            }
            const msg = String(e?.message || "");
            if (msg.includes("overloaded") || msg.includes("503") || msg.includes("UNAVAILABLE")) {
                setToast({ msg: "⚠️ El modelo está saturado, intenta en unos minutos.", type: 'warning' });
            } else {
                setToast({ msg: "❌ Error IA: " + e.message, type: 'error' });
            }
        } finally {
            setIsGeneratingIA(false);
        }
    };

    const handleSave = async () => {
        if (!unitPlanningReady) {
            setToast({ msg: 'Espere a que se carguen la unidad y sus competencias antes de guardar.', type: 'warning' });
            return false;
        }
        if (!selectedAreaId || !selectedGrade || !selectedSection) {
            setToast({ msg: '⚠️ Seleccione Área, Grado y Sección.', type: 'warning' });
            return false;
        }

        const sessionsForSave = normalizeSessionCriterionOwnership(
            (unitData.sesiones || []).map((session: any) => ({
                ...session,
                ...deriveSessionEvaluationData(session, unitData)
            }))
        );

        const payload = {
            year,
            areaId: selectedAreaId,
            grade: selectedGrade,
            section: selectedSection,
            unitNumber,
            title: unitData.title,
            purpose: unitData.purpose,
            product: unitData.product,
            situation: unitData.situation,
            criterios: unitData.criterios,
            evidencias: unitData.evidencias,
            instrumentos: unitData.instrumentos,
            criteriosTrans: unitData.criteriosTrans,
            evidenciasTrans: unitData.evidenciasTrans,
            instrumentosTrans: unitData.instrumentosTrans,
            sesiones: sessionsForSave.map((s: any) => ({
                ...s,
                fechasPorSeccion: sessionDetails.find(sd => sd.id === s.id)?.combinations || []
            })),
            recursos: {
                materiales: removeVisualBullets(unitData.recursos.materiales),
                medios: removeVisualBullets(unitData.recursos.medios),
                actividades: removeVisualBullets(unitData.recursos.actividades),
                espacios: removeVisualBullets(unitData.recursos.espacios),
            },
            bibliografia: {
                libros: removeVisualBullets(unitData.bibliografia.libros),
                links: removeVisualBullets(unitData.bibliografia.links),
            },
            evaluacion: unitData.evaluacion
        };

        const res = await saveUnidadDidactica(payload);
        if (res.success) {
            setUnitData((previous: any) => ({ ...previous, sesiones: sessionsForSave }));
            const updatedLessons = Number(res.data?.updatedLessons || 0);
            setToast({ msg: updatedLessons ? `✅ Unidad guardada. ${updatedLessons} sesión(es) actualizada(s).` : '✅ Unidad Sincronizada.', type: 'success' });
            setIsDirty(false);
            setHasStoredUnits(true);
            onSuccess();
            return true;
        } else {
            setToast({ msg: '❌ Error SQL: ' + res.message, type: 'error' });
            return false;
        }
    };

    const handleOpenUnitManager = async () => {
        setIsManageUnitsModalOpen(true);
        const unitsMap = await getAllUnidadesDidacticas();
        const list = Object.values(unitsMap || {});
        setAllSavedUnitsList(list);
        setHasStoredUnits(list.length > 0);
    };

    const handleLoadSpecificUnit = (unit: any) => {
        setSelectedAreaId(unit.areaId || '');
        setSelectedGrade(unit.grade || '');
        setSelectedSection(unit.section || '');
        setUnitNumber(String(unit.unitNumber || '1'));
        setIsManageUnitsModalOpen(false);
    };

    const handleDeleteSpecificUnit = async (unit: any, event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const confirmed = window.confirm(`Se eliminara la unidad ${unit.unitNumber} de ${unit.areaName || unit.areaId} (${unit.grade} ${unit.section}). Esta accion no se puede deshacer. ¿Desea continuar?`);
        if (!confirmed) return;

        setDeletingUnitId(unit.id);
        try {
            const res = await deleteUnidadDidactica(unit.id);
            if (!res.success) {
                setToast({ msg: 'No se pudo eliminar la unidad.', type: 'error' });
                return;
            }
            setAllSavedUnitsList(prev => {
                const next = prev.filter(item => item.id !== unit.id);
                setHasStoredUnits(next.length > 0);
                return next;
            });
            setToast({ msg: 'Unidad eliminada correctamente.', type: 'success' });
        } catch {
            setToast({ msg: 'Ocurrio un error al eliminar la unidad.', type: 'error' });
        } finally {
            setDeletingUnitId(null);
        }
    };



const formatBulletsForView = (text: string, bullet = "•") => {
    return String(text || "")
        .split("\n")
        .filter(line => line.trim())
        .map(line => `${bullet} ${line.trim()}`)
        .join("\n");
};

const removeVisualBullets = (text: string) => {
    return String(text || "")
        .split("\n")
        .map(line => line.replace(/^[\s•\-–—]+/, "").trim())
        .join("\n");
};

const handleFillDefaultRecursos = () => {
    setIsDirty(true);
    setUnitData((prev: any) => ({
        ...prev,
        recursos: {
            materiales:
                "Computadoras de escritorio.\n" +
                "Proyector multimedia.\n" +
                "Altavoces y sistemas de sonido.\n" +
                "Impresoras y escáneres.\n" +
                "Servidor personal.\n" +
                "Wifi e Internet.\n" +
                "TV de aula.",
            medios:
                "Presentaciones de diapositivas (.PPTX).\n" +
                "Videos educativos (.MP4).\n" +
                "Plantillas digitales.",
            actividades:
                "Actividades en grupo.\n" +
                "Discusiones en clase.\n" +
                "Lecturas y materiales de estudio.\n" +
                "Cuadernos y papel.\n" +
                "Bolígrafos y lápices.\n" +
                "Marcadores y resaltadores.\n" +
                "Reglas.\n" +
                "Materiales de reciclaje.",
            espacios:
                "Centro de cómputo.\n" +
                "Aula de innovaciones.\n" +
                "Salón de clases."
        }
    }));
};

const handleFillDefaultBiblio = () => {
    setIsDirty(true);
    setUnitData((prev: any) => ({
        ...prev,
        bibliografia: {
            libros:
                "Ministerio de Educación. (2019). Diseño Curricular Nacional. Ministerio de Educación del Perú.\n" +
                "Dingolabs. (2025). Innovación & emprendimiento. Dingolabs.\n" +
                "Ministerio de Educación. (2020). Cuaderno de trabajo: Crea y emprende. Ministerio de Educación del Perú.\n" +
                "Ministerio de Educación. (2019). Programa curricular - Secundaria. Ministerio de Educación del Perú.\n" +
                "Ministerio de Educación. (2022). Guía del docente - Emprende CRFA. Ministerio de Educación del Perú.",
            links:
                "Microsoft. (s. f.). Microsoft. Recuperado de https://www.microsoft.com\n" +
                "Ministerio de Educación del Perú. (s. f.). Ministerio de Educación. Recuperado de https://www.minedu.gob.pe\n" +
                "Emprendedor Peruano. (s. f.). Emprendedor Peruano. Recuperado de https://www.emprendedorperuano.pe\n" +
                "Arca del Papel. (s. f.). Arca del Papel. Recuperado de https://www.arcadepapel.net\n" +
                "Wikipedia. (s. f.). Wikipedia. Recuperado de https://www.wikipedia.org\n" +
                "Dingolab. (s. f.). Dingolab. Recuperado de https://dinngolab.es/inicio/index.php\n" +
                "Design Thinking España. (s. f.). Design Thinking. Recuperado de https://designthinking.es"
        }
    }));
};

    const handleBulletKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, section: string, field: string, bullet: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const t = e.currentTarget;
            const start = t.selectionStart;
            const value = t.value;
            const newValue = value.substring(0, start) + "\n" + bullet + " " + value.substring(t.selectionEnd);
            if (!field) handleInputChange(section, '', newValue);
            else handleInputChange(section, field, newValue);
            setTimeout(() => { t.selectionStart = t.selectionEnd = start + bullet.length + 2; }, 0);
        }
    };

    const toggleCompSelection = (compId: string) => {
        if (isEPT) return; 
        setIsDirty(true);
        setUnitData((prev: any) => ({
            ...prev,
            selectedComps: { ...prev.selectedComps, [compId]: !prev.selectedComps[compId] }
        }));
    };

    const selectedCompsCount = prioritizedCompetencies.length;

    const headerFilled = !!(selectedAreaId && selectedGrade && selectedSection && unitNumber && (isEPT || selectedCompsCount > 0));

    if (showTemplateMode) {
        return <UnitTemplateMergeView onBack={() => setShowTemplateMode(false)} selectedAreaId={selectedAreaId} selectedGrade={selectedGrade} selectedSection={selectedSection} selectedUnitNumber={unitNumber} />;
    }

    return (
        <div className="animate-fade-in pb-20 space-y-6 relative">

            {typeof document !== 'undefined' && toast && createPortal(
                <div className="fixed top-10 right-10 z-[2147483000] w-full max-w-md pointer-events-none">
                    <InternalToast message={toast.msg} type={toast.type} usage={toast.usage} onClose={() => setToast(null)} />
                </div>,
                document.body
            )}

            {/* Added AuthOverlay to handle missing API key errors and configuration */}
            {typeof document !== 'undefined' && showAuthScreen && createPortal(
                <AuthOverlay 
                    onSave={handleSaveIAKey} 
                    onClose={() => setShowAuthScreen(false)} 
                    isSaving={savingKey}
                    initialProvider={generalData?.ai_provider || 'gemini'}
                    initialGeminiKey={generalData?.gemini_api_key || ''}
                    initialOpenAIKey={generalData?.openai_api_key || ''}
                    initialGeminiModel={generalData?.gemini_model || ''}
                    initialOpenAIModel={generalData?.openai_model || ''}
                    initialAiPedagogicalRoute={(generalData as any)?.ai_pedagogical_route || ''}
                    initialInstitutionalProblems={(generalData as any)?.ai_institutional_problems || ''}
                    initialUnitPedagogicalFocus={(generalData as any)?.ai_unit_pedagogical_focus || ''}
                />,
                document.body
            )}

              {isDirty && createPortal(
                  <div
                      className="pointer-events-none fixed z-[100000] left-0 top-0"
                      style={{ transform: `translate3d(${cursorPos.x + 8}px, ${cursorPos.y + 8}px, 0)` }}
                  >
                      <div className="w-8 h-8 rounded-full bg-amber-400 text-white flex items-center justify-center shadow-lg ring-4 ring-amber-200/40">
                          <span className="text-xs font-black">!</span>
                      </div>
                  </div>,
                  document.body
              )}

            {showCompSelector && (
                <div className="fixed inset-0 z-[10000] flex items-start justify-center p-4 pt-10 bg-slate-900/80 backdrop-blur-md animate-fade-in" onClick={() => setShowCompSelector(false)}>
                    <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 mt-10" onClick={e => e.stopPropagation()}>
                        <div className="text-white p-6" style={{ backgroundColor: themeColor }}><h3 className="text-xl font-black uppercase tracking-tight">Priorizar Competencias del Área</h3><p className="text-[10px] font-bold text-orange-100 mt-1 uppercase tracking-widest">Seleccione las competencias que se trabajarán en esta unidad.</p></div>
                        <div className="p-8 grid grid-cols-1 gap-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {groupedByCompetency.map(comp => {
                                const isSelected = !!unitData.selectedComps[comp.id];
                                return (
                                    <div key={comp.id} onClick={() => toggleCompSelection(comp.id)} className={`p-5 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-5 group ${isSelected ? 'border-orange-500 bg-orange-50 shadow-md' : 'border-slate-100 bg-slate-50 hover:border-slate-300'}`}>
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${isSelected ? 'bg-orange-500 text-white shadow-lg' : 'bg-white text-slate-300 border border-slate-200'}`}>{isSelected ? <span className="text-xl font-black">✓</span> : <span className="text-xl">○</span>}</div>
                                        <div className="flex-1"><h4 className={`text-sm font-black uppercase tracking-tight ${isSelected ? 'text-orange-900' : 'text-slate-50'}`}>{comp.competencia}</h4><p className="text-[10px] text-slate-400 mt-1 font-bold italic line-clamp-1">{comp.estandar}</p></div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Seleccionadas: {selectedCompsCount}</span><button onClick={() => setShowCompSelector(false)} className="btn-water water-blue px-10 py-3 rounded-2xl text-white font-black uppercase text-xs">Cerrar Selección</button></div>
                    </div>
                </div>
            )}

            <div ref={planningHeaderRef} className="text-white p-7 rounded-[3rem] shadow-2xl relative z-[100] overflow-visible" style={{ backgroundColor: themeColor }}>
                <div className="session-header-top mb-8">
                    <div className="flex items-center gap-5"><div className="bg-white/20 p-4 rounded-3xl border border-white/30 shadow-inner backdrop-blur-md"><span className="text-4xl drop-shadow-lg">📗</span></div><div className="flex flex-col"><h1 className="text-3xl font-black italic font-serif tracking-tight uppercase leading-none">Unidades Didácticas {year}</h1><span className="text-[10px] font-black uppercase tracking-[0.4em] text-orange-200 mt-2">Planificación de Unidades - {currentBimesterRoman} Bimestre</span></div></div>
                    <SessionActions module="units" headerRef={planningHeaderRef} themeColor={themeColor} setThemeColor={setThemeColor}
                        contextLabel={`${selectedGrade || 'Grado'} ${selectedSection || ''} · U${unitNumber}`}
                        headerFilled={headerFilled} isGeneratingIA={isGeneratingIA} aiTokenLabel={aiUsageProgress.tokenLabel}
                        saveDisabled={!headerFilled} managerDisabled={!hasStoredUnits} templateDisabled={!hasStoredUnits}
                        onAI={handleGenerateAI} onAISettings={() => setShowAuthScreen(true)} onSave={handleSave}
                        onManager={handleOpenUnitManager} onTemplate={() => setShowTemplateMode(true)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-black/10 p-6 rounded-[2.5rem] border border-white/10 backdrop-blur-xl items-end overflow-visible relative z-[110]">
                    <div className="md:col-span-4"><Select label="ÁREA" name="area" options={areaOptions} value={selectedAreaId} onChange={e => { setSelectedAreaId(e.target.value); setSelectedGrade(''); setSelectedSection(''); }} className="text-orange-900 font-black h-auto" placeholder="Área..." labelClassName="text-white" /></div>
                    <div className="md:col-span-2"><Select label="GRADO" name="grade" options={gradeOptions} value={selectedGrade} onChange={e => { setSelectedGrade(e.target.value); setSelectedSection(''); }} disabled={!selectedAreaId} className="text-orange-900 font-black h-auto" placeholder="Grado..." labelClassName="text-white" /></div>
                    <div className="md:col-span-2"><Select label="SECCIÓN" name="section" options={sectionOptions} value={selectedSection} onChange={e => setSelectedSection(e.target.value)} disabled={!selectedGrade} className="text-orange-900 font-black h-auto" placeholder="-" labelClassName="text-white" /></div>
                    <div className="md:col-span-1"><Select label="UNID." name="unit" options={UNITS.map(u => ({ value: u.toString(), label: u.toString() }))} value={unitNumber} onChange={e => setUnitNumber(e.target.value)} disabled={!selectedSection} className="text-orange-900 font-black h-auto" labelClassName="text-white" /></div>
                        <div className="md:col-span-1"><label className="block text-[10px] font-black text-white mb-2 ml-1 uppercase tracking-[0.15em] leading-none">PRIO.</label><button disabled={!selectedSection || isEPT} onClick={() => setShowCompSelector(true)} className={`w-full h-[42px] bg-slate-50 border border-slate-200 rounded-xl px-3 font-black text-[11px] uppercase transition-all shadow-inner text-center ${selectedCompsCount > 0 ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-slate-400'} disabled:opacity-50 disabled:cursor-not-allowed`}>{isEPT ? (selectedCompsCount > 0 ? '1 CP' : 'CARGANDO') : (selectedCompsCount > 0 ? `${selectedCompsCount} CP` : 'S/P')}</button></div>
                    <div className="md:col-span-2"><div className="bg-white/10 px-4 py-2.5 rounded-2xl border border-white/10 flex items-center gap-2 shadow-inner w-full justify-center h-[42px]"><div className="flex flex-col items-center"><span className="text-[10px] font-black text-white">{calculatedSessionCount} SES.</span><span className="text-[7px] font-black uppercase tracking-widest text-white-400">DETECTADAS</span></div></div></div>
                </div>
            </div>

            {!headerFilled ? (
                <div className="p-20 text-center border-4 border-dashed border-orange-200 rounded-[4rem] bg-orange-50/20 text-orange-300 flex flex-col items-center"><div className="text-8xl mb-8 grayscale opacity-20 animate-pulse">📗</div><p className="font-black uppercase tracking-[0.3em] text-xs max-w-xs leading-loose">Seleccione los parámetros de ÁREA, GRADO, SECCIÓN, UNID. y PRIO. para redactar su Unidad Didáctica.</p></div>
            ) : (
                <>
                    <div ref={sectionIRef} className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10 scroll-mt-24">
                        {[{ id: 'I', label: 'TÍTULO DE LA UNIDAD / EdA', field: 'title', icon: '🏷️', ref: null }, { id: 'III', label: 'PRODUCTO DE UNIDAD', field: 'product', icon: '📦', ref: productRef }, { id: 'II', label: 'PROPÓSITO DE APRENDIZAJE', field: 'purpose', icon: '🎯', ref: purposeRef }, { id: 'IV', label: 'SITUACIÓN SIGNIFICATIVA', field: 'situation', icon: '🔥', ref: situationRef }].map(sec => (
                            <div key={sec.id} className={`bg-white rounded-[2.5rem] shadow-lg border overflow-hidden transition-all duration-500 ${fieldsGenerating[sec.field] ? 'generating-glow' : ''}`} style={{ borderColor: themeColor }}><div className="text-white px-6 py-3 flex justify-between items-center relative overflow-hidden" style={{ backgroundColor: themeColor }}><span className="text-[10px] font-black uppercase tracking-widest relative z-10">{sec.id}. {sec.label}</span><span className="text-xl relative z-10 opacity-50">{sec.icon}</span></div><textarea ref={sec.ref} className="w-full p-6 h-40 resize-none outline-none text-slate-700 font-bold italic text-[11px] leading-relaxed text-justify focus:bg-orange-50/20 transition-all placeholder:text-slate-300" placeholder={sec.id === 'IV' ? "Redacte aquí la situación significativa..." : "Escriba el contenido..."} value={unitData[sec.field] || ''} onChange={e => handleInputChange(sec.field, '', e.target.value)} /></div>
                        ))}
                    </div>

                    <div ref={matrixRef} className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10 scroll-mt-24" style={{borderColor: themeColor}}>
                        <div className="text-white p-4 text-center text-sm font-black uppercase tracking-widest flex items-center justify-center gap-3 rounded-t-[2.5rem]" style={{ backgroundColor: themeColor }}><span className="text-xl">📊</span> COMPETENCIAS Y CAPACIDADES PRIORIZADAS - UNIDAD {unitNumber}</div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[11px]">
                                <tbody className="divide-y divide-white/20">
                                    {prioritizedCompetencies.map((group) => (
                                        <React.Fragment key={`area-${group.id}`}>
                                            <tr style={{ backgroundColor: `${themeColor}90` }} className="text-white font-black uppercase text-[11px] tracking-[0.2em] shadow-lg">
                                                <td colSpan={5} className="p-3 text-center italic border-b border-white/20 relative">
                                                    COMPETENCIA: {group.competencia}
                                                </td>
                                            </tr>
                                           <tr style={{ backgroundColor: `${themeColor}25` }} className="text-slate-900 font-bold italic text-[10px] shadow-inner">
                                                <td colSpan={5} className="p-3 text-justify px-12 leading-tight">
                                                    <span style={{ color: themeColor }} className="text-[8px] font-black uppercase tracking-widest block mb-1 opacity-80">
                                                        Estándar de Aprendizaje:
                                                    </span>
                                                    {group.estandar}
                                                </td>
                                            </tr>
                                           <tr style={{ backgroundColor: `${themeColor}90`, borderBottomColor: `${themeColor}80` }} className="text-white font-black uppercase text-[9px] tracking-wider text-center divide-x divide-white/30">
                                                <th className="p-3 w-48 border-b border-white/20">CAPACIDAD</th>
                                                <th className="p-3 w-64 border-b border-white/20">DESEMPEÑO CNEB</th>
                                                <th className="p-3 border-b border-white/20">CRITERIOS DE EVALUACIÓN</th>
                                                <th className="p-3 w-52 border-b border-white/20">EVIDENCIA</th>
                                                <th className="p-3 w-56 border-b border-white/20">INSTRUMENTO</th>
                                            </tr>
                                            {group.rows.map((row, i) => (
                                                <tr key={i} className="align-top group hover:bg-white/95 transition-colors">{row.isFirstCap && (<td rowSpan={row.capSpan} className="p-4 bg-white/80 text-black/60 font-black italic leading-tight text-center align-middle border-b border-r border-black/20 uppercase text-[10px]">{row.capacidades}</td>)}<td className="p-4 text-justify font-medium text-slate-700 bg-white/90 border-b border-r border-black/20 leading-relaxed">{row.desempenos_dcbn}</td>
                                                <td className={`p-4 bg-white/90 border-b border-r border-black/20 transition-all duration-500 align-top ${fieldsGenerating[`criterios.${row.originalIdx}`] ? 'generating-glow' : ''}`}>
                                                <textarea ref={el => { tableFieldRefs.current[`criterios.${row.originalIdx}`] = el; }} className="block w-full min-h-[120px] border-0 outline-none bg-transparent focus:bg-white transition-all text-slate-700 font-medium text-justify resize-none text-[11px] leading-relaxed overflow-hidden" value={unitData.criterios[row.originalIdx] || ''} onChange={e => handleInputChange('criterios', row.originalIdx.toString(), e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'criterios', row.originalIdx.toString(), '•')} onInput={e => {e.currentTarget.style.height = 'auto';e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';}} placeholder="Defina los criterios..."/></td>
                                                <td className={`p-4 bg-white/90 border-b border-r border-black/20 transition-all duration-500 align-top ${fieldsGenerating[`evidencias.${row.originalIdx}`] ? 'generating-glow' : ''}`}><textarea ref={el => { tableFieldRefs.current[`evidencias.${row.originalIdx}`] = el; }} className="block w-full min-h-[120px] border-0 outline-none bg-transparent focus:bg-white transition-all text-blue-800 font-bold italic text-[10px] leading-relaxed resize-none overflow-hidden" value={unitData.evidencias[row.originalIdx] || ''} onChange={e => handleInputChange('evidencias', row.originalIdx.toString(), e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'evidencias', row.originalIdx.toString(), '•')} onInput={e => {e.currentTarget.style.height = 'auto';e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';}} placeholder="Describa evidencia..."/></td><td className="p-4 border-b border-black/20 bg-white/90 align-middle"><Select label="" name={`instrumento-${row.originalIdx}`} options={INSTRUMENTS_OPTIONS} value={unitData.instrumentos[row.originalIdx] || ''} onChange={e => handleInputChange('instrumentos', row.originalIdx.toString(), e.target.value)} placeholder="Seleccionar..." className="h-auto w-[160px]" valueClassName="text-[10px] font-bold" /></td></tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                    {groupedTransversales.map((group) => (
                                        <React.Fragment key={`trans-${group.id}`}><tr className="bg-emerald-900/80 text-white font-black uppercase text-[11px] tracking-[0.2em] shadow-lg border-t-8 border-emerald-700"><td colSpan={5} className="p-3 text-center italic border-b border-emerald-700/40">COMPETENCIA TRANSVERSAL: {group.competencia}</td></tr><tr className="bg-emerald-50 text-emerald-900 font-bold italic text-[10px] shadow-inner"><td colSpan={5} className="p-3 text-justify px-12 leading-tight"><span className="text-[8px] font-black uppercase tracking-widest block mb-1 opacity-60 text-emerald-700">Estándar Transversal:</span>{group.estandar}</td></tr>
                                        <tr className="bg-emerald-700 text-white font-black uppercase text-[9px] tracking-wider text-center divide-x divide-emerald-200/40 border-b-2 border-emerald-400">
                                        <th className="p-2.5 w-48">CAPACIDAD</th>
                                        <th className="p-2.5 w-64">DESEMPEÑO CNEB</th>
                                        <th className="p-2.5">CRITERIOS DE EVALUACIÓN</th>
                                        <th className="p-2.5 w-52">EVIDENCIA</th>
                                        <th className="p-2.5 w-56">INSTRUMENTO</th></tr>{group.rows.map((row, i) => (<tr key={`tr-row-${i}`} className="divide-x divide-black/30 align-top group hover:bg-white/90 transition-colors">{row.isFirstCap && (<td rowSpan={row.capSpan} className="p-4 bg-white/70 text-black/60 font-black italic leading-tight text-center align-middle border-b border-black/30 uppercase text-[10px]">{row.capacidades}</td>)}<td className="p-4 text-justify font-medium text-slate-700 bg-white/90 border-b border-black/30 leading-relaxed">{row.desempenos_dcbn}</td><td className={`p-4 border-b border-emerald-400 bg-white/95 align-top transition-all duration-500 ${fieldsGenerating[`criteriosTrans.${row.originalIdx}`] ? 'generating-glow' : ''}`}><textarea ref={el => { tableFieldRefs.current[`criteriosTrans.${row.originalIdx}`] = el; }} className="block w-full min-h-[120px] border-0 outline-none bg-transparent focus:bg-white/80 transition-all text-black/60 font-bold italic text-[11px] leading-relaxed resize-none overflow-hidden" value={unitData.criteriosTrans[row.originalIdx] || ''} onChange={e => handleInputChange('criteriosTrans', row.originalIdx.toString(), e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'criteriosTrans', row.originalIdx.toString(), '•')} onInput={e => {e.currentTarget.style.height = 'auto';e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';}} placeholder="Defina los criterios..." /></td><td className={`p-4 border-b border-orange-400 bg-white/95 align-top transition-all duration-500 ${fieldsGenerating[`evidenciasTrans.${row.originalIdx}`] ? 'generating-glow' : ''}`}><textarea ref={el => { tableFieldRefs.current[`evidenciasTrans.${row.originalIdx}`] = el; }} className="block w-full min-h-[120px] border-0 outline-none bg-transparent focus:bg-white/80 transition-all text-black/70 font-bold italic text-[10px] leading-relaxed resize-none overflow-hidden" value={unitData.evidenciasTrans[row.originalIdx] || ''} onChange={e => handleInputChange('evidenciasTrans', row.originalIdx.toString(), e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'evidenciasTrans', row.originalIdx.toString(), '•')} onInput={e => {e.currentTarget.style.height = 'auto';e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';}} placeholder="Describa evidencia..." /></td><td className="p-4 border-b border-orange-400 bg-white align-top"><Select label="" name={`instrumentoTrans-${row.originalIdx}`} options={INSTRUMENTS_OPTIONS} value={unitData.instrumentosTrans[row.originalIdx] || ''} onChange={e => handleInputChange('instrumentosTrans', row.originalIdx.toString(), e.target.value)} placeholder="Seleccionar..." className="h-auto w-[140px]" valueClassName="text-[10px] font-bold"/></td></tr>))}</React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ backgroundColor: themeColor }}>
                        <div className="text-white p-4 text-center text-sm font-black uppercase tracking-widest flex items-center justify-center gap-3" style={{ backgroundColor: themeColor }}><span className="text-xl">🌍</span> V. ENFOQUES TRANSVERSALES</div><div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0 text-[11px] min-w-[1000px]"><thead>
                        <tr className="bg-white/20 text-wTÍTULO hite font-black uppercase text-[10px] tracking-wider text-center divide-x divide-white/20">
                        <th className="p-4 w-64 border-b border-white/10 text-white font-bold">ENFOQUE</th>
                        <th className="p-4 w-64 border-b border-white/10 text-white font-bold">VALORES</th>
                        <th className="p-4 border-b border-white/10 text-white font-bold">ACTITUDES</th>
                        <th className="p-4 border-b border-white/10 text-white font-bold">SE DEMUESTRA CUANDO</th>
                        </tr></thead><tbody className="divide-y divide-white/20">{ENFOQUES_LIST.map((enf, idx) => { const hasData = unitData.enfoques?.[idx]?.valores; if (!hasData) return null; return (<tr key={idx} className="divide-x divide-black/50 align-top group hover:bg-white/20 transition-colors"><td className="p-4 bg-white/90 font-black align-middle text-center uppercase text-[10px]">{enf}</td><td className="p-0 bg-white/90 font-black"><textarea className="w-full h-full p-4 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic text-center min-h-[150px] resize-none text-[11px] bg-transparent" value={unitData.enfoques?.[idx]?.valores || ''} onChange={e => handleInputChange('enfoques', `${idx}.valores`, e.target.value)} /></td><td className="p-0 bg-white/90 font-black"><textarea className="w-full h-full p-4 border-0 outline-none focus:bg-white transition-all text-slate-700 font-medium italic text-justify min-h-[150px] resize-none text-[11px] bg-transparent" value={unitData.enfoques?.[idx]?.actitudes || ''} onChange={e => handleInputChange('enfoques', `${idx}.actitudes`, e.target.value)} /></td><td className="p-0 bg-white/90 font-black"><textarea className="w-full h-full p-4 border-0 outline-none focus:bg-white transition-all text-slate-600 font-medium italic text-justify min-h-[150px] resize-none text-[11px] bg-transparent" value={unitData.enfoques?.[idx]?.demuestra || ''} onChange={e => handleInputChange('enfoques', `${idx}.demuestra`, e.target.value)} /></td></tr>); })}</tbody></table></div></div>

                    <div ref={sessionsTableRef} className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10 scroll-mt-24" style={{borderColor: themeColor}}>
                        <div className="text-white p-4 text-center text-sm font-black uppercase tracking-widest flex items-center justify-center gap-3" style={{ backgroundColor: themeColor }}><span className="text-xl">📅</span> VI. SECUENCIA DE SESIONES DE APRENDIZAJE ({unitData.sesiones.length} Sesiones)</div>
                        <p className="bg-white px-4 py-2 text-[10px] text-slate-600">Al terminar de editar un criterio o evidencia, se actualiza también su fila en Competencias y capacidades priorizadas y las sesiones que usan el mismo dato. La selección se mantiene independiente de la edición.</p>
                          <div className="overflow-x-auto overflow-y-visible relative">
                              <table className="w-full border-collapse text-[11px]">
                                <thead className="sticky top-0 z-10">
                                    <tr className="bg-white/20 text-white font-black uppercase text-[10px] tracking-wider text-center divide-x divide-white/20" style={{ backgroundColor: `${themeColor}cc` }}>
                                        <th className="p-3 w-28 border-b border-white/20">
                                            <div className="flex items-center justify-center gap-2">
                                                <span>Nº</span>
                                                <button
                                                    type="button"
                                                    className="text-[9px] font-black bg-white/20 hover:bg-white/30 rounded px-2 py-1 uppercase tracking-wider"
                                                    onClick={() => {
                                                        const anyExpanded = unitData.sesiones.some((s: any) => !collapsedSessions[s.id]);
                                                        const next: Record<number, boolean> = {};
                                                        unitData.sesiones.forEach((s: any) => { next[s.id] = anyExpanded; });
                                                        setCollapsedSessions(next);
                                                    }}
                                                    title="Expandir/Contraer todas"
                                                >
                                                    {unitData.sesiones.some((s: any) => !collapsedSessions[s.id]) ? '🔼' : '🔽'}
                                                </button>
                                            </div>
                                        </th>
                                        <th className="p-3 w-80 border-b border-white/20">TÍTULO DE LA SESIÓN</th>
                                        <th className="p-3 w-50 border-b border-white/20">COMPETENCIA</th>
                                        <th className="p-3 w-60 border-b border-white/20">CAPACIDAD</th>
                                        <th className="p-3 w-80 border-b border-white/20">CRITERIOS DE EVALUACIÓN</th>
                                        <th className="p-3 w-56 border-b border-white/20">CONOCIMIENTOS</th>
                                        <th className="p-3 w-64 border-b border-white/20">EVIDENCIA DE APRENDIZAJE</th>
                                        <th className="p-3 w-56 border-b border-white/20">EVALUACIÓN</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/80">
                                    {unitData.sesiones.map((ses: any, idx: number) => {
                                        const detail = sessionDetails.find(d => d.id === ses.id);
                                        const sessionEvidenceOptions: SessionEvidenceOption[] = Array.isArray(ses.availableEvidenceOptions) ? ses.availableEvidenceOptions : [];
                                        const selectedEvidenceIds = Array.isArray(ses.selectedEvidenceIds) ? ses.selectedEvidenceIds : [];
                                        const selectedEvidenceCount = selectedEvidenceIds.length;
                                        const usedEvidenceCount = sessionEvidenceOptions.filter((option) => {
                                            const usage = evidenceUsageMap.get(option.id) || [];
                                            return usage.some((sessionId) => sessionId !== ses.id);
                                        }).length;
                                        const allEvidenceAlreadyUsed = sessionEvidenceOptions.length > 0 && usedEvidenceCount === sessionEvidenceOptions.length;
                                        
                                        // Extraer capacidades basadas en competencias seleccionadas
                                        const areaComp = prioritizedCompetencies.find(pc => pc.id === ses.competencia);
                                        const transComps = groupedTransversales.filter(gt => (ses.transversales || []).includes(gt.id));
                                        const transIndexById = new Map(groupedTransversales.map((gt, i) => [gt.id, i]));
                                        
                                        const availableCapacities = [
                                            ...(areaComp?.rows || []).map(r => ({ ...r, __source: 'area' })),
                                            ...transComps.flatMap(gt => gt.rows.map(r => ({ ...r, __source: 'transversal', __transId: gt.id, __transIdx: transIndexById.get(gt.id) ?? 0 })))
                                        ].reduce((acc: any[], curr: any) => {
                                            if (!acc.find(a => a.value === curr.capacidades)) {
                                                acc.push({
                                                    value: curr.capacidades,
                                                    label: curr.capacidades,
                                                    source: curr.__source,
                                                    transIdx: curr.__transIdx ?? 0
                                                });
                                            }
                                            return acc;
                                        }, []);

                                        // Opciones de instrumentos de evaluación de las competencias seleccionadas
                                        const evaluationInstruments = [
                                            ...(areaComp ? areaComp.rows.map(r => unitData.instrumentos[r.originalIdx]) : []),
                                            ...transComps.flatMap(gt => gt.rows.map(r => unitData.instrumentosTrans[r.originalIdx]))
                                        ].filter((v, i, a) => v && a.indexOf(v) === i).map(v => ({ value: v, label: v }));

                                        return (
                                            <React.Fragment key={idx}>
                                            <tr ref={el => { sessionRowRefs.current[ses.id] = el; }} className={`align-top group hover:bg-white/10 transition-colors ${collapsedSessions[ses.id] ? 'ring-1 ring-emerald-200/70 bg-emerald-50/20' : ''}`}>
                                                <td className="px-2 py-3 bg-white/90 text-center border-b border-r border-black/40 align-middle relative">
                                                    {collapseEligible[ses.id] && (
                                                        <button
                                                            type="button"
                                                            className="absolute top-1 left-1 w-5 h-5 rounded-full bg-emerald-600/90 hover:bg-emerald-700 text-white text-[10px] font-black shadow-md"
                                                            onClick={() => setCollapsedSessions(prev => ({ ...prev, [ses.id]: !prev[ses.id] }))}
                                                            title={collapsedSessions[ses.id] ? 'Expandir fila' : 'Contraer fila'}
                                                        >
                                                            {collapsedSessions[ses.id] ? '🔽' : '🔼'}
                                                        </button>
                                                    )}
                                                    <div className="flex flex-col items-center justify-center gap-1.5">
                                                        <div className="font-black text-black-900 uppercase text-8px] whitespace-nowrap">Sesión {ses.id}</div>
                                                        <div className="font-bold text-orange-700 text-[8px] italic leading-none">(Semana {detail?.week || Math.ceil(ses.id / 2)})</div>
                                                        <div className="mt-2 w-full flex flex-col gap-1 items-center">
                                                            {(detail?.combinations || []).map((comb: string, cIdx: number) => (
                                                                <span key={cIdx} className="text-[8px] font-bold text-slate-700 leading-tight bg-slate-100 px-2 py-0.5 rounded border border-slate-200 w-full text-center">{comb}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className={`p-0 bg-white text-center relative border-b border-r border-black/40 transition-all duration-500 align-top ${fieldsGenerating[`sesiones.${idx}.title`] ? 'generating-glow' : ''}`}>
                                                    <textarea
                                                        ref={el => { sesionesRefs.current[ses.id] = el; }}
                                                        className={`w-full p-2 border-0 outline-none focus:bg-white/90 transition-all text-slate-800 font-bold italic text-center min-h-[100px] resize-none text-[10px] ${collapsedSessions[ses.id] ? 'bg-emerald-50/40 max-h-[80px]' : 'bg-white/98'} overflow-hidden`}
                                                        value={ses.title}
                                                        onChange={e => handleSessionInputChangeById(ses.id, 'title', e.target.value)}
                                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                                        placeholder="Título..."
                                                        style={collapsedSessions[ses.id] ? { height: '80px' } : undefined}
                                                    />
                                                </td>
                                                <td className="p-3 bg-white border-b border-r border-black/40 space-y-4">
                                                    <Select
                                                        label="Competencia del Área"
                                                        name={`comp-area-${idx}`}
                                                        options={prioritizedCompetencies.map(pc => ({ value: pc.id, label: pc.competencia }))}
                                                        value={ses.competencia || ''}
                                                        onChange={e => handleSessionInputChangeById(ses.id, 'competencia', e.target.value)}
                                                        placeholder="Seleccionar..."
                                                        className="min-w-[160px] max-w-[220px] !w-full"
                                                        valueClassName="text-[9px] leading-tight whitespace-normal"
                                                        />
                                                    <div className="border-t border-slate-100 pt-3">
                                                        <span className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-1.5 block">Transversales (Opcional)</span>
                                                        <div className="flex flex-col gap-1.5">
                                                            {groupedTransversales.map(gt => {
                                                                const isChecked = (ses.transversales || []).includes(gt.id);
                                                                return (
                                                                    <label key={gt.id} className={`flex items-start gap-2 p-1.5 rounded cursor-pointer transition-colors ${isChecked ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                                                                <input type="checkbox" checked={isChecked} onChange={e => {
                                                                            const current = ses.transversales || [];
                                                                            const next = e.target.checked ? [...current, gt.id] : current.filter((id: string) => id !== gt.id);
                                                                            handleSessionInputChangeById(ses.id, 'transversales', next);
                                                                            
                                                                            const allTransCaps = new Set(groupedTransversales.flatMap(g => g.rows.map(r => r.capacidades)));
                                                                            const remainingTransCaps = new Set(groupedTransversales.filter(g => next.includes(g.id)).flatMap(g => g.rows.map(r => r.capacidades)));
                                                                            const currentCaps = ses.capacidades || [];
                                                                            const nextCaps = currentCaps.filter((cap: string) => !allTransCaps.has(cap) || remainingTransCaps.has(cap));
                                                                            if (nextCaps.length !== currentCaps.length) {
                                                                                handleSessionInputChangeById(ses.id, 'capacidades', nextCaps);
                                                                            }
                                                                        }} className="mt-0.5" />
                                                        {(() => {
                                                            const tIdx = Number(transIndexById.get(gt.id) ?? 0);
                                                            return (
                                                                <span className={`text-[7px] font-bold leading-tight ${isChecked ? TRANS_TEXT_COLORS_STRONG[tIdx % TRANS_TEXT_COLORS_STRONG.length] : TRANS_TEXT_COLORS[tIdx % TRANS_TEXT_COLORS.length]}`}>{gt.competencia}</span>
                                                            );
                                                        })()}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-3 bg-white border-b border-r border-black/40 align-top">
                                                    <div className={`flex flex-col gap-1 p-1 ${collapsedSessions[ses.id] ? 'max-h-[140px] overflow-hidden' : ''}`}>
                                                        {availableCapacities.map(cap => {
                                                            const isSelected = ses.capacidades?.includes(cap.value);
                                                            const isTrans = cap.source === 'transversal';
                                                            const idx = (cap.transIdx ?? 0) % TRANS_TEXT_COLORS.length;
                                                            const transClasses = isSelected ? TRANS_BG_SELECTED[idx] : TRANS_BG_IDLE[idx];
                                                            const capacityCriteria = (ses.capacityCriteriaOptions || []).filter((criterion: any) =>
                                                                normalizeLoose(criterion.capacidad) === normalizeLoose(cap.value)
                                                            );
                                                            const usedInSessions = Array.from(new Set(capacityCriteria.flatMap((criterion: any) =>
                                                                criteriaUsageMap.get(criterion.id) || []
                                                            ))).filter((sessionId: number) => sessionId !== Number(ses.id));
                                                            return (
                                                                <label
                                                                    key={cap.value}
                                                                    title={usedInSessions.length > 0
                                                                        ? `${cap.label}. También usada en sesión${usedInSessions.length > 1 ? 'es' : ''} ${usedInSessions.join(', ')}.`
                                                                        : cap.label}
                                                                    className={`flex items-start gap-2 p-1 rounded border cursor-pointer ${isSelected ? (isTrans ? transClasses : 'bg-blue-50 border-blue-200') : (isTrans ? transClasses : 'bg-slate-50 border-slate-100')}`}
                                                                >
                                                                    <input type="checkbox" checked={isSelected} onChange={e => {
                                                                        const current = ses.capacidades || [];
                                                                        const next = e.target.checked ? [...current, cap.value] : current.filter((v: string) => v !== cap.value);
                                                                        handleSessionInputChangeById(ses.id, 'capacidades', next);
                                                                    }} className="mt-0.5" />
                                                                    <span className={`block text-[7px] font-bold leading-tight truncate max-w-[100px] ${isTrans ? (isSelected ? TRANS_TEXT_COLORS_STRONG[idx] : TRANS_TEXT_COLORS[idx]) : AREA_TEXT_COLOR}`} title={cap.label}>{cap.label}</span>
                                                                </label>
                                                            );
                                                        })}
                                                        {availableCapacities.length === 0 && <span className="text-[9px] text-slate-400 italic">Seleccione competencia primero</span>}
                                                    </div>
                                                </td>
                                                <td className={`p-0 bg-white text-center relative border-b border-r border-black/40 transition-all duration-500 align-top ${fieldsGenerating[`sesiones.${idx}.des`] ? 'generating-glow' : ''}`}>
                                                    <div className={`p-2 ${collapsedSessions[ses.id] ? 'bg-emerald-50/40 max-h-[140px] overflow-hidden' : 'bg-white/98'}`}>
                                                        {(ses.availableCriteriaOptions || []).length > 0 ? (
                                                            (ses.availableCriteriaOptions || []).map((criterion: any) => {
                                                                const selected = (ses.selectedCriteriaIds || []).includes(criterion.id);
                                                                const usedInOtherSessions = (criteriaUsageMap.get(criterion.id) || [])
                                                                    .filter((sessionId) => sessionId !== Number(ses.id));
                                                                return (
                                                                    <div
                                                                        key={`crit-${ses.id}-${criterion.id}`}
                                                                        className={`w-full mb-1.5 rounded-lg border px-2 py-1.5 text-left text-[9px] leading-tight font-medium italic transition-all ${criterion.color || AREA_TEXT_COLOR} ${selected ? 'border-emerald-400 bg-emerald-50 shadow-sm' : 'border-slate-200 bg-slate-50 opacity-55 hover:opacity-80'}`}
                                                                        title={selected
                                                                            ? 'Criterio incluido. Clic para excluir todo este bloque vinculado.'
                                                                            : usedInOtherSessions.length > 0
                                                                                ? `Disponible. También se usa en sesión${usedInOtherSessions.length > 1 ? 'es' : ''} ${usedInOtherSessions.join(', ')}.`
                                                                                : 'Criterio disponible. Clic para incluir todo este bloque vinculado.'}
                                                                    >
                                                                        <button type="button" onClick={() => toggleSessionCriterion(ses.id, criterion.id)} className="mb-1 block w-full text-left text-[8px] font-bold not-italic">
                                                                            {selected ? '✓ Incluido · clic para excluir' : '+ Incluir criterio'}
                                                                        </button>
                                                                        {selected ? <LinkedEvaluationTextarea
                                                                            value={criterion.text}
                                                                            onCommit={(value) => handleSessionCriterionEdit(ses.id, criterion.id, value)}
                                                                            className={`session-auto-textarea block w-full border-0 outline-none bg-transparent resize-none text-[9px] leading-tight font-medium italic overflow-hidden ${criterion.color || AREA_TEXT_COLOR}`}
                                                                        /> : <span>{criterion.text}</span>}
                                                                        {usedInOtherSessions.length > 0 ? (
                                                                            <span className="mt-1 block text-[7px] not-italic text-slate-400">
                                                                                Usado también en S. {usedInOtherSessions.join(', ')}
                                                                            </span>
                                                                        ) : null}
                                                                    </div>
                                                                );
                                                            })
                                                        ) : <span className="text-[9px] text-slate-400 italic">Seleccione capacidades para mostrar sus criterios.</span>}
                                                    </div>
                                                </td>
                                                <td className={`p-0 bg-white text-center relative border-b border-r border-black/40 transition-all duration-500 align-top ${fieldsGenerating[`sesiones.${idx}.con`] ? 'generating-glow' : ''}`}>
                                                <textarea
                                                    ref={el => { sessionFieldRefs.current[`con-${ses.id}`] = el; }}
                                                    className={`w-full p-2 border-0 outline-none focus:bg-white/90 transition-all text-slate-700 font-medium text-justify min-h-[100px] resize-none text-[9px] leading-tight overflow-hidden ${collapsedSessions[ses.id] ? 'bg-emerald-50/40 max-h-[100px]' : 'bg-white/98'}`}
                                                    value={ses.con}
                                                    onChange={e => handleSessionInputChangeById(ses.id, 'con', e.target.value)}
                                                    onInput={e => autoResizeTextarea(e.currentTarget)}
                                                    placeholder="Conocimientos..."
                                                    style={collapsedSessions[ses.id] ? { height: '100px' } : undefined}
                                                /></td>
                                                <td className={`p-0 bg-white text-center relative border-b border-r border-black/40 transition-all duration-500 align-top ${fieldsGenerating[`sesiones.${idx}.evi`] ? 'generating-glow' : ''}`}>
                                                    <div className={`p-2 ${collapsedSessions[ses.id] ? 'bg-emerald-50/40 max-h-[140px] overflow-hidden' : 'bg-white/98'}`}>
                                                        {(ses.evidenceItems || []).length > 0 ? (
                                                            (ses.evidenceItems || []).map((item: any, itemIdx: number) => (
                                                                <div key={`evi-${ses.id}-${itemIdx}`} className="relative">
                                                                    <LinkedEvaluationTextarea
                                                                        className={`session-auto-textarea w-full border-0 outline-none bg-transparent resize-none text-[9px] leading-tight font-medium overflow-hidden pr-6 ${item.color || AREA_TEXT_COLOR}`}
                                                                        value={item.text}
                                                                        onCommit={(value) => handleSessionItemChange(ses.id, 'evidence', itemIdx, value)}
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        className="absolute right-0 top-0 w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] leading-[14px] font-black hover:bg-slate-300"
                                                                        onClick={() => handleSessionItemRemove(ses.id, 'evidence', itemIdx)}
                                                                title="Eliminar"
                                                                    >
                                                                        -
                                                                    </button>
                                                                </div>
                                                            ))
                                                        ) : (
                                                        <textarea
                                                            ref={el => { sessionFieldRefs.current[`evi-${ses.id}`] = el; }}
                                                            className={`session-auto-textarea w-full border-0 outline-none bg-transparent resize-none text-[9px] font-black leading-tight font-medium overflow-hidden ${AREA_TEXT_COLOR}`}
                                                            value={ses.evi}
                                                            onChange={e => handleSessionInputChangeById(ses.id, 'evi', e.target.value)}
                                                            onInput={e => autoResizeTextarea(e.currentTarget)}
                                                            placeholder="Evidencia..."
                                                        />
                                                        )}
                                                        {false && sessionEvidenceOptions.length > 0 && (
                                                            <div className="mt-3 border-t border-slate-200 pt-2 text-left">
                                                                <button
                                                                    type="button"
                                                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100 transition-colors"
                                                                    onClick={() => setEvidenceDropdownOpen((prev) => ({ ...prev, [ses.id]: !prev[ses.id] }))}
                                                                >
                                                                    <span className="flex items-center justify-between gap-3">
                                                                        <span className="min-w-0">
                                                                            <span className="block text-[8px] font-black uppercase tracking-widest text-slate-500">
                                                                                Evidencias sugeridas por capacidad y campo temático
                                                                            </span>
                                                                            <span className="block text-[9px] font-bold text-slate-700 mt-1">
                                                                                {selectedEvidenceCount > 0
                                                                                    ? `${selectedEvidenceCount} evidencia${selectedEvidenceCount === 1 ? '' : 's'} seleccionada${selectedEvidenceCount === 1 ? '' : 's'}`
                                                                                    : 'Seleccionar evidencias'}
                                                                            </span>
                                                                            {allEvidenceAlreadyUsed && (
                                                                                <span className="block text-[8px] font-bold text-amber-600 mt-1">
                                                                                    Todas las evidencias de esta capacidad ya se usan en otra sesión.
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                        <span className="shrink-0 text-slate-500 text-xs font-black">
                                                                            {evidenceDropdownOpen[ses.id] ? '▲' : '▼'}
                                                                        </span>
                                                                    </span>
                                                                </button>
                                                                {evidenceDropdownOpen[ses.id] && (
                                                                    <div className="mt-2 space-y-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                                                                        {sessionEvidenceOptions.map((option: SessionEvidenceOption) => {
                                                                            const isChecked = selectedEvidenceIds.includes(option.id);
                                                                            const usage = evidenceUsageMap.get(option.id) || [];
                                                                            const usedInOtherSessions = usage.filter((sessionId) => sessionId !== ses.id);
                                                                            const isUsedElsewhere = usedInOtherSessions.length > 0;
                                                                            return (
                                                                                <label
                                                                                    key={option.id}
                                                                                    className={`flex items-start gap-2 rounded border px-2 py-1 cursor-pointer transition-colors ${isChecked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'} ${isUsedElsewhere && !isChecked ? 'opacity-55' : ''}`}
                                                                                    title={option.capacidad}
                                                                                >
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={isChecked}
                                                                                        onChange={e => handleSessionEvidenceSelection(ses.id, option.id, e.target.checked)}
                                                                                        className="mt-0.5"
                                                                                    />
                                                                                    <span className="min-w-0 flex-1">
                                                                                        <span className={`block text-[9px] leading-tight font-semibold ${option.color}`}>{option.text}</span>
                                                                                        <span className="block text-[7px] uppercase tracking-wide text-slate-400 mt-1">{option.capacidad}</span>
                                                                                        {isUsedElsewhere && (
                                                                                            <span className="block text-[8px] font-bold text-amber-600 mt-1">
                                                                                                Ya usada en sesi{usedInOtherSessions.length > 1 ? 'ones' : 'ón'} {usedInOtherSessions.join(', ')}
                                                                                            </span>
                                                                                        )}
                                                                                    </span>
                                                                                </label>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3 bg-white border-b border-black/40">
                                                    <Select 
                                                    label="" 
                                                    name={`sesion-eval-${idx}`} 
                                                    options={evaluationInstruments.length > 0 ? evaluationInstruments : INSTRUMENTS_OPTIONS} 
                                                    value={ses.eval || ''} 
                                                    onChange={e => handleSessionInputChangeById(ses.id, 'eval', e.target.value)} 
                                                    placeholder="Instrumento..." 
                                                    className="min-w-[10px] max-w-[100px] !w-full"
                                                    />
                                                                                                    
                                                </td>
                                            </tr>
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-6 bg-slate-50 border-t border-white/90 flex justify-center"><button onClick={handleAddSessionRow} className="btn-3d-plus w-12 h-12 flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all" title="Agregar Sesión"><span>+</span></button></div>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{borderColor: themeColor}}>
                        <div className="text-white p-4 text-center text-sm font-black uppercase tracking-widest flex items-center justify-between gap-3 px-10" style={{ backgroundColor: themeColor }}>
                            <div className="w-10"></div>
                            <span className="flex items-center gap-3">
                                <span className="text-xl">🛠️</span> VII. MATERIALES Y RECURSOS EDUCATIVOS</span>
                                <button onClick={handleFillDefaultRecursos} className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-all shadow-inner text-lg" title="Llenar con valores por defecto">✨</button></div>
                                <div className="overflow-x-auto">
                                    <table className="w-full border-separate border-spacing-0 text-[11px] min-w-[1000px]"><thead>
                                        <tr className="bg-white/20 text-white font-black uppercase text-[10px] tracking-wider text-center divide-x divide-white/20" style={{ backgroundColor: `${themeColor}cc` }}>
                                        <th className="p-4 w-1/4 border-b border-white/20">MATERIALES</th>
                                        <th className="p-4 w-1/4 border-b border-white/20">MEDIOS</th>
                                        <th className="p-4 w-1/4 border-b border-white/20">RECURSOS</th>
                                        <th className="p-4 w-1/4 border-b border-white/20">ESPACIOS DE APRENDIZAJE</th></tr></thead>
                                        <tbody className="divide-y" style={{ borderColor: `${themeColor}55` }}>
                                        <tr className="divide-x align-top bg-orange-50/20" style={{ borderColor: `${themeColor}55` }}>
                                        <td className="p-0">
                                            <textarea className="w-full h-full min-h-[200px] p-6 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic resize-none leading-relaxed" value={formatBulletsForView(unitData.recursos.materiales, "📦")} onChange={e => handleInputChange('recursos', 'materiales', e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'recursos', 'materiales', '❖')} placeholder="❖ Listado..." /></td><td className="p-0">
                                                <textarea className="w-full h-full min-h-[200px] p-6 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic resize-none leading-relaxed" value={formatBulletsForView(unitData.recursos.medios, "🎥")} onChange={e => handleInputChange('recursos', 'medios', e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'recursos', 'medios', '✓')} placeholder="✓ Listado..." /></td><td className="p-0">
                                                    <textarea className="w-full h-full min-h-[200px] p-6 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic resize-none leading-relaxed" value={formatBulletsForView(unitData.recursos.actividades, "🧠")} onChange={e => handleInputChange('recursos', 'actividades', e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'recursos', 'actividades', '❖')} placeholder="❖ Listado..." /></td><td className="p-0">
                                                        <textarea className="w-full h-full min-h-[200px] p-6 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic resize-none leading-relaxed" value={formatBulletsForView(unitData.recursos.espacios, "🏫")} onChange={e => handleInputChange('recursos', 'espacios', e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'recursos', 'espacios', '❖')} placeholder="❖ Listado..." /></td></tr></tbody></table></div></div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{borderColor: themeColor}}>
                        <div className="text-white p-4 text-center text-sm font-black uppercase tracking-widest flex items-center justify-between gap-3 px-10" style={{ backgroundColor: themeColor }}>
                            <div className="w-10"></div>
                            <span className="flex items-center gap-3">
                                <span className="text-xl">📚</span> VIII. REFERENCIAS BIBLIOGRÁFICAS Y LINKOGRAFÍA</span>
                                <button onClick={handleFillDefaultBiblio} className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-all shadow-inner text-lg" title="Llenar bibliografía">📚</button></div>
                                <div className="w-full"><table className="w-full border-collapse text-[11px] table-fixed">
                                    <thead>
                                        <tr className="bg-white/20 text-white font-black uppercase text-[10px] tracking-wider text-center divide-x divide-white/20" style={{ backgroundColor: `${themeColor}cc` }}>
                                        <th className="p-4 w-1/2 border-b border-white/20">📚 REFERENCIAS BIBLIOGRÁFICAS</th>
                                        <th className="p-4 w-1/2 border-b border-white/20">🌐 LINKOGRAFÍA</th></tr>
                                        </thead>
                                        <tbody className="divide-y" style={{ borderColor: `${themeColor}55` }}>
                                            <tr className="divide-x align-top bg-orange-50/20" style={{ borderColor: `${themeColor}55` }}>
                                            <td className="p-0">
                                                <textarea className="w-full min-h-[150px] p-6 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic resize-none leading-relaxed" value={formatBulletsForView(unitData.bibliografia.libros, "📚")} onChange={e => handleInputChange('bibliografia', 'libros', e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'bibliografia', 'libros', '📚')} placeholder="📚 Fuentes..." /></td>
                                                <td className="p-0">
                                                    <textarea className="w-full min-h-[150px] p-6 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic resize-none leading-relaxed" value={formatBulletsForView(unitData.bibliografia.links, "🌐")} onChange={e => handleInputChange('bibliografia', 'links', e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'bibliografia', 'links', '🌐')} placeholder="🌐 Enlaces..." /></td></tr></tbody></table></div></div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{borderColor: themeColor}}>
                        <div className="text-white p-4 text-center text-sm font-black uppercase tracking-widest flex items-center justify-center gap-3" style={{ backgroundColor: themeColor }}>
                            <span className="text-xl">📝</span> IX. EVALUACIÓN</div>
                            <div className="p-0 bg-orange-50/20">
                            <textarea className="w-full min-h-[150px] p-8 border-0 outline-none focus:bg-white transition-all text-slate-700 font-bold italic resize-none leading-relaxed text-[11px]" value={unitData.evaluacion} onChange={e => handleInputChange('evaluacion', '', e.target.value)} onKeyDown={e => handleBulletKeyDown(e, 'evaluacion', '', '❖')} placeholder="❖ Defina el enfoque de evaluación..." />
                                </div></div>

                </>
            )}
            {isManageUnitsModalOpen && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col h-[80vh]">
                        <div className="p-8 text-white flex justify-between items-center" style={{ backgroundColor: themeColor }}>
                            <div>
                                <h3 className="text-2xl font-black uppercase tracking-tight leading-none italic">Gestor de Unidades</h3>
                                <p className="text-[10px] font-bold text-white/70 mt-2 uppercase tracking-[0.2em]">Registros guardados en Servidor SQL</p>
                            </div>
                            <button onClick={() => setIsManageUnitsModalOpen(false)} className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-2xl transition-all">✕</button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            {allSavedUnitsList.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 opacity-50 italic">
                                    <span className="text-6xl">📁</span>
                                    <p className="font-black text-xs uppercase tracking-widest">No hay unidades guardadas todavía.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {allSavedUnitsList.map((unit, idx) => (
                                        <div
                                            key={unit.id || idx}
                                            onClick={() => handleLoadSpecificUnit(unit)}
                                            className="group bg-slate-50 border border-slate-200 p-5 rounded-[2rem] hover:bg-white hover:border-orange-300 hover:shadow-xl transition-all cursor-pointer relative overflow-hidden"
                                        >
                                            <button
                                                type="button"
                                                onClick={(event) => handleDeleteSpecificUnit(unit, event)}
                                                disabled={deletingUnitId === unit.id}
                                                className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full bg-white text-rose-600 border border-rose-100 shadow-sm hover:bg-rose-50 hover:border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-lg font-black transition-all"
                                                title="Eliminar unidad"
                                                aria-label={`Eliminar unidad ${unit.unitNumber}`}
                                            >
                                                {deletingUnitId === unit.id ? '...' : '×'}
                                            </button>
                                            <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 rounded-full translate-x-12 -translate-y-12 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            <div className="flex items-center gap-4 relative z-10">
                                                <div className="w-14 h-14 rounded-2xl bg-white flex flex-col items-center justify-center shadow-sm border border-slate-100 shrink-0">
                                                    <span className="text-[8px] font-black text-slate-400 uppercase">UNID.</span>
                                                    <span className="text-lg font-black text-orange-600">U{unit.unitNumber}</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-sm font-black text-slate-800 uppercase truncate">{unit.areaName || unit.areaId}</h4>
                                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mt-1">{unit.grade} - {unit.section}</p>
                                                    <p className="text-[11px] font-bold text-slate-600 mt-3 line-clamp-2">{unit.title || 'Sin título'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes flyInRight { 0% { opacity: 0; transform: translateX(200px) scale(0.8); } 100% { opacity: 1; transform: translateX(0) scale(1); } }
                .animate-fly-in-right { animation: flyInRight 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
                @keyframes bounceSlow { 0%, 100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, -10px); } }
                .animate-bounce-slow { animation: bounceSlow 3s infinite ease-in-out; }
                .generating-glow {
                    position: relative;
                    overflow: hidden;
                    animation: glow-pulse-border 1.5s infinite, safe-typewriter-reveal 900ms steps(18, end) both;
                }
                .generating-glow::after {
                    content: '';
                    position: absolute;
                    z-index: 20;
                    top: 0;
                    bottom: 0;
                    width: 2px;
                    pointer-events: none;
                    background: rgba(211, 84, 0, 0.75);
                    box-shadow: 0 0 7px rgba(211, 84, 0, 0.55);
                    animation: safe-typewriter-caret 900ms steps(18, end) both;
                }
                @keyframes safe-typewriter-reveal {
                    from { clip-path: inset(0 100% 0 0); opacity: 0.45; }
                    to { clip-path: inset(0 0 0 0); opacity: 1; }
                }
                @keyframes safe-typewriter-caret {
                    0% { left: 0; opacity: 1; }
                    92% { left: calc(100% - 2px); opacity: 1; }
                    100% { left: calc(100% - 2px); opacity: 0; }
                }
                @keyframes glow-pulse-border { 0% { box-shadow: 0 0 5px rgba(211, 84, 0, 0.2); border-color: rgba(211, 84, 0, 0.3); } 50% { box-shadow: 0 0 20px rgba(211, 84, 0, 0.5); border-color: rgba(211, 84, 0, 0.6); } 100% { box-shadow: 0 0 5px rgba(211, 84, 0, 0.2); border-color: rgba(211, 84, 0, 0.3); } }
                .scroll-mt-24 { scroll-margin-top: 6rem; }
            `}} />
        </div>
    );
};
