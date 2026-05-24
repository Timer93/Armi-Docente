
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.bubble.css';
import { TeachingAssignment, ScheduleEntry, ScheduleConfig, GeneralData, Student, SessionAssessmentModel } from '../types';
import { getCompetencias, getUnidadDidactica, saveSesion, getSesion, getAllSesiones, deleteSesion, getDatosGenerales, getProgramacionesAnuales, saveDatosGenerales, getInstrumentos, getEstudiantes, getEvaluacionRegistros, saveEvaluacionRegistros } from '../services/apiService';
import { Select } from './Select';
import { SessionTemplateMergeView } from './SessionTemplateMergeView';
import { SessionRegisterPanel } from './sessions-view/SessionRegisterPanel';
import { GoogleGenAI } from "@google/genai";
import {
    ENFOQUE_DETAILS,
    TRANSVERSAL_NAMES,
    TRANSVERSAL_CAPACITY_MAP,
    DEFAULT_SEQUENCE_TEMPLATE,
    INITIAL_SESSION_DATA,
    QUILL_MODULES,
    detectInstrumentTypeFromText,
    hasFilledInstrumentRows,
    mapTemplateToSessionRowsByType,
    layoutCellId,
    getTemplateCellStyle,
    getTemplateOrientationStyle,
    getTemplateOrientationBoxStyle,
    getGuideCapacityCountFromTemplate,
    getGuideColumnWidthsFromTemplate,
    TEMPLATE_GUIDE_LEVELS,
    buildChecklistVisualRowsForTemplate,
    buildScaleVisualRowsForTemplate,
    buildScaleBodyRowsForTemplate,
    getScaleLabelsForTemplate,
    getScaleFallbackTextForTemplate,
    getTemplateFillableCellIds,
    buildTemplateTextOverridesFromRows,
    getTemplateFallbackText,
    normalizeFilterValue,
    cloneInitialSessionData,
    extractCapacidades,
    buildCriteriosFromInstrumentRows,
    buildAssessmentModelFromData,
    buildSessionAssessmentModel,
    buildSessionInstrumentRows,
    ensureAssessmentModel,
    ensureSessionAssessmentModel,
    getPathByString,
    setPathByString,
    extractBracketTokens,
    replaceBracketTokens,
    hasPendingTemplateHints,
    superNormalize,
    stripHtml,
    normalizeLoose,
    buildSessionResourceDefaults,
    escapeRegex,
    escapeHtml,
    colorTokenToCss,
    hexToRgba,
    isBlackColorToken,
    itemsToHtml,
    detectTransversalByCapacity,
    isMeaningfulRichText,
    syncResourcesFromActivity,
    getFlexValue,
    autoResizeTextarea,
    AI_ACTIVITY_RESOURCE_PAIRS,
    AI_RICH_TEXT_PATHS,
    instrumentTypeLabelMap,
    MINUTE_DISTRIBUTIONS,
    CustomDatePicker,
    InternalToast,
    AuthOverlay
} from './sessions-view/shared';
import { readStoredViewSelection, writeStoredViewSelection } from '../utils/viewSelectionStorage';

interface Props {
  activeSection: string;
  onSuccess: () => void;
}

const SESSIONS_VIEW_SELECTION_STORAGE_KEY = 'armi_view_selection_sesiones_v1';

const DEFAULT_EXTENSION_ACTIVITIES = [
    'Socialización oral de aprendizajes clave del proyecto entre equipos.',
    'Análisis colectivo de un caso breve de emprendimiento exitoso y otro no sostenible.',
    'Rueda de retroalimentación rápida sobre mejoras posibles del producto.'
].map((item) => `- ${item}`).join('\n');

const mergeUniqueMultilineText = (...values: any[]) => {
    const seen = new Set<string>();
    const lines: string[] = [];
    values.forEach((value) => {
        String(value || '')
            .split(/\r?\n/)
            .map((line) => String(line || '').trim())
            .filter(Boolean)
            .forEach((line) => {
                const key = normalizeLoose(line);
                if (!key || seen.has(key)) return;
                seen.add(key);
                lines.push(line);
            });
    });
    return lines.join('\n');
};

const ensureSessionExtraBlocks = (data: any) => {
    const base = cloneInitialSessionData();
    return {
        ...base,
        ...(data || {}),
        extension: String(data?.extension || ''),
        recursos: {
            ...base.recursos,
            ...(data?.recursos || {})
        },
        bibliografia: {
            ...base.bibliografia,
            ...(data?.bibliografia || {})
        }
    };
};

const buildDefaultAreaTemplateSessionData = () => {
    const base = cloneInitialSessionData();
    return ensureSessionExtraBlocks({
        ...base,
        secuencia: {
            ...base.secuencia,
            inicio: {
                ...base.secuencia.inicio,
                saberes: DEFAULT_SEQUENCE_TEMPLATE.saberes,
                saberes_recursos: DEFAULT_SEQUENCE_TEMPLATE.saberes_recursos,
                conflicto: DEFAULT_SEQUENCE_TEMPLATE.conflicto,
                conflicto_recursos: DEFAULT_SEQUENCE_TEMPLATE.conflicto_recursos
            },
            proceso: {
                ...base.secuencia.proceso,
                construccion: DEFAULT_SEQUENCE_TEMPLATE.construccion,
                construccion_recursos: DEFAULT_SEQUENCE_TEMPLATE.construccion_recursos,
                aplicacion: DEFAULT_SEQUENCE_TEMPLATE.aplicacion,
                aplicacion_recursos: DEFAULT_SEQUENCE_TEMPLATE.aplicacion_recursos,
                metacognicion: DEFAULT_SEQUENCE_TEMPLATE.metacognicion,
                metacognicion_recursos: DEFAULT_SEQUENCE_TEMPLATE.metacognicion_recursos
            },
            salida: {
                ...base.secuencia.salida,
                evaluacion: DEFAULT_SEQUENCE_TEMPLATE.evaluacion,
                evaluacion_recursos: DEFAULT_SEQUENCE_TEMPLATE.evaluacion_recursos
            }
        }
    });
};

const sanitizeAiJsonCandidate = (rawText: string) =>
    String(rawText || '')
        .replace(/^\uFEFF/, '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

const SESSION_AI_DIAGNOSTIC_STORAGE_KEY = 'armi_session_ai_last_failure_v1';

const buildAiDiagnosticPreview = (text: string, maxLength = 1600) => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength)}...`
        : normalized;
};

const recordSessionAiDiagnostic = (payload: {
    stage: 'extract' | 'parse';
    errorMessage: string;
    rawText: string;
    cleanedText?: string;
}) => {
    const diagnosticEntry = {
        timestamp: new Date().toISOString(),
        stage: payload.stage,
        errorMessage: payload.errorMessage,
        rawLength: String(payload.rawText || '').length,
        cleanedLength: String(payload.cleanedText || '').length,
        rawPreview: buildAiDiagnosticPreview(payload.rawText),
        cleanedPreview: buildAiDiagnosticPreview(payload.cleanedText || '')
    };

    try {
        localStorage.setItem(SESSION_AI_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(diagnosticEntry));
    } catch {
        // Si localStorage falla, mantenemos solo el diagnóstico en consola.
    }

    console.error('Session IA diagnostic', diagnosticEntry);
};

const extractFirstBalancedJsonBlock = (rawText: string) => {
    const cleaned = sanitizeAiJsonCandidate(rawText);
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let i = 0; i < cleaned.length; i += 1) {
        const ch = cleaned[i];

        if (start === -1) {
            if (ch === '{' || ch === '[') {
                start = i;
                depth = 1;
            }
            continue;
        }

        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }
            if (ch === '\\') {
                escaping = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{' || ch === '[') {
            depth += 1;
            continue;
        }

        if (ch === '}' || ch === ']') {
            depth -= 1;
            if (depth === 0) {
                return cleaned.slice(start, i + 1);
            }
        }
    }

    if (cleaned) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            return cleaned.slice(firstBrace, lastBrace + 1);
        }
    }

    recordSessionAiDiagnostic({
        stage: 'extract',
        errorMessage: 'La IA no devolvió un JSON utilizable.',
        rawText,
        cleanedText: cleaned
    });

    throw new Error('La IA no devolvió un JSON utilizable.');
};

const parseAiJsonObject = (rawText: string) => {
    const jsonBlock = extractFirstBalancedJsonBlock(rawText);
    try {
        return JSON.parse(jsonBlock);
    } catch (error: any) {
        const rawMessage = String(error?.message || 'JSON inválido');
        recordSessionAiDiagnostic({
            stage: 'parse',
            errorMessage: rawMessage,
            rawText,
            cleanedText: jsonBlock
        });
        throw new Error(`La IA devolvió JSON malformado. ${rawMessage}`);
    }
};

export const SessionsView: React.FC<Props> = ({ activeSection, onSuccess }) => {
    const initialSelection = useMemo(() => readStoredViewSelection(SESSIONS_VIEW_SELECTION_STORAGE_KEY), []);
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
    const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
    const [competenciasBase, setCompetenciasBase] = useState<any[]>([]);
    const [sessionMode, setSessionMode] = useState<'planificacion' | 'calificacion'>('planificacion');
    const [students, setStudents] = useState<Student[]>([]);
    const [gradingRecords, setGradingRecords] = useState<Record<string, { level: string; observation: string }>>({});
    const [gradingLoading, setGradingLoading] = useState(false);
    const [gradingSaving, setGradingSaving] = useState(false);
    const [activeGradingSection, setActiveGradingSection] = useState('');
    const [expandedSessionRegisterObservations, setExpandedSessionRegisterObservations] = useState<Record<string, boolean>>({});
    const gradingAutosaveRef = useRef<{ initialized: boolean; lastSaved: string; saving: boolean }>({ initialized: false, lastSaved: '', saving: false });
    
    const [selArea, setSelArea] = useState(initialSelection.areaName || '');
    const [selGrade, setSelGrade] = useState(initialSelection.grade || '');
    const [selSection, setSelSection] = useState(initialSelection.section || '');

    const [unitNumber, setUnitNumber] = useState(initialSelection.unitNumber || '1');
    const [sessionNumber, setSessionNumber] = useState(initialSelection.sessionNumber || '1');
    const [maxSessionsInUnit, setMaxSessionsInUnit] = useState(15);
    const [sessionDate, setSessionDate] = useState('');
    const [dateOptions, setDateOptions] = useState<{value: string, label: string}[]>([]);
    const [year, setYear] = useState(initialSelection.year || new Date().getFullYear().toString());
    const [themeColor, setThemeColor] = useState(localStorage.getItem('armi_sessions_theme') || '#6b21a8');
    const [toasts, setToasts] = useState<Array<{ id: string; msg: string; type: 'success' | 'error' | 'warning' }>>([]);
    const [allSavedPrograms, setAllSavedPrograms] = useState<Record<string, any>>({});
    const [generalData, setGeneralData] = useState<GeneralData | null>(null);
    const [isGeneratingIA, setIsGeneratingIA] = useState(false);
    const [showAuthScreen, setShowAuthScreen] = useState(false);
    const [savingKey, setSavingKey] = useState(false);
    
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [allSavedSessionsList, setAllSavedSessionsList] = useState<any[]>([]);
    const [showTemplateMode, setShowTemplateMode] = useState(false);

    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const [pendingDate, setPendingDate] = useState('');
    const [showMotiveModal, setShowMotiveModal] = useState(false);
    const [motiveInput, setMotiveInput] = useState('');
    const lastToastRef = useRef<{ msg: string; type: 'success' | 'error' | 'warning'; at: number } | null>(null);

    const bimesterLabel = useMemo(() => {
        const u = parseInt(unitNumber);
        if (u <= 2) return 'I';
        if (u <= 4) return 'II';
        if (u <= 6) return 'III';
        return 'IV';
    }, [unitNumber]);

    const getTransversalSurfaceColor = useCallback((color: string, alpha = 0.14) => {
        const base = String(color || '#00b28c').trim();
        const rgbMatch = base.match(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
        if (rgbMatch) {
            const [, r, g, b] = rgbMatch;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return hexToRgba(base, alpha);
    }, []);

    const getTransversalSurfaceStyle = useCallback((color: string, alpha = 0.14) => {
        return {
            backgroundColor: getTransversalSurfaceColor(color, alpha)
        };
    }, [getTransversalSurfaceColor]);

    const getTransversalTextColor = useCallback((color: string) => String(color || '#00b28c'), []);

    const headerFilled = useMemo(() => {
        return !!(selArea && selGrade && selSection && unitNumber && sessionNumber);
    }, [selArea, selGrade, selSection, unitNumber, sessionNumber]);

    const currentProgramKey = useMemo(() => {
        const currentAreaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
        if (!(year && currentAreaId && selGrade && selSection)) return '';
        return `${year}-${currentAreaId}-${selGrade}-${selSection}`;
    }, [year, assignments, selArea, selGrade, selSection]);

    const currentProgram = useMemo(() => currentProgramKey ? allSavedPrograms[currentProgramKey] : null, [allSavedPrograms, currentProgramKey]);

    const [sessionData, setSessionData] = useState<any>(INITIAL_SESSION_DATA);
    const lastSelectionKeyRef = useRef('');
    const sessionAssessmentModel = useMemo<SessionAssessmentModel>(() => buildSessionAssessmentModel(sessionData, {
        areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
        grade: selGrade,
        section: selSection,
        unitNumber,
        sessionNumber,
        bimester: bimesterLabel
    }), [sessionData, assignments, selArea, selGrade, selSection, unitNumber, sessionNumber, bimesterLabel]);

    const setToast = useCallback((nextToast: { msg: string, type: 'success' | 'error' | 'warning' } | null) => {
        if (!nextToast) {
            setToasts([]);
            lastToastRef.current = null;
            return;
        }
        const normalizedMsg = String(nextToast.msg || '').trim();
        const now = Date.now();
        const lastToast = lastToastRef.current;
        if (
            lastToast
            && lastToast.type === nextToast.type
            && lastToast.msg === normalizedMsg
            && now - lastToast.at < 1800
        ) {
            return;
        }
        lastToastRef.current = { msg: normalizedMsg, type: nextToast.type, at: now };
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts(prev => [...prev, { id, ...nextToast, msg: normalizedMsg }]);
    }, []);

    const closeToastById = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const handleOpenLastAiDiagnostic = useCallback(() => {
        try {
            const raw = localStorage.getItem(SESSION_AI_DIAGNOSTIC_STORAGE_KEY);
            if (!raw) {
                setToast({ msg: 'No hay diagnóstico IA guardado.', type: 'warning' });
                return;
            }
            const parsed = JSON.parse(raw);
            const message = [
                `Fecha: ${parsed?.timestamp || '-'}`,
                `Etapa: ${parsed?.stage || '-'}`,
                `Error: ${parsed?.errorMessage || '-'}`,
                `Largo bruto: ${parsed?.rawLength || 0}`,
                `Largo limpio: ${parsed?.cleanedLength || 0}`,
                '',
                'Vista previa:',
                String(parsed?.cleanedPreview || parsed?.rawPreview || '-')
            ].join('\n');
            window.alert(message);
        } catch (error) {
            console.error('No se pudo abrir el diagnóstico IA guardado.', error);
            setToast({ msg: 'No se pudo leer el diagnóstico IA.', type: 'error' });
        }
    }, [setToast]);

    const loadTemplateRowsByInstrument = useCallback(async (instrumentLabel: string) => {
        if (!selArea || !selGrade || !selSection) {
            return { status: 'skip' as const, reason: 'Faltan filtros de área, grado o sección.' };
        }
        const instrumentType = detectInstrumentTypeFromText(instrumentLabel);
        if (!instrumentType) {
            return { status: 'unsupported' as const, reason: `Instrumento no compatible: "${instrumentLabel || 'sin definir'}".` };
        }

        const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
        const res = await getInstrumentos({ year });
        if (!res.success) {
            return { status: 'error' as const, reason: res.message || 'No se pudieron consultar plantillas de instrumentos.' };
        }

        const desired = {
            year: normalizeFilterValue(year),
            areaId: normalizeFilterValue(areaId),
            grade: normalizeFilterValue(selGrade),
            section: normalizeFilterValue(selSection)
        };

        const templatesByType = (Array.isArray(res.data) ? res.data : []).filter((item: any) =>
            normalizeLoose(String(item?.type || '')) === normalizeLoose(instrumentType)
        );

        const scoreTemplate = (item: any) => {
            const rawArea = item?.area_id ?? item?.areaId ?? '';
            const rawGrade = item?.grade ?? '';
            const rawSection = item?.section ?? '';
            const itemFilters = {
                areaId: normalizeFilterValue(rawArea),
                grade: normalizeFilterValue(rawGrade),
                section: normalizeFilterValue(rawSection)
            };

            const scoreOptionalField = (value: string, wanted: string) => {
                if (!value) return 1; // plantilla general
                if (value === wanted) return 3; // exacta
                return 0; // específica para otro grado/sección, pero válida por área
            };

            // Área es obligatoria: debe coincidir sí o sí.
            const areaScore = itemFilters.areaId === desired.areaId ? 5 : -100;
            const gradeScore = scoreOptionalField(itemFilters.grade, desired.grade);
            const sectionScore = scoreOptionalField(itemFilters.section, desired.section);
            if (areaScore < 0 || gradeScore < 0 || sectionScore < 0) return -1;
            return areaScore + gradeScore + sectionScore;
        };

        const compatibleTemplates = templatesByType
            .map((item: any) => {
                const rawArea = item?.area_id ?? item?.areaId ?? '';
                const rawGrade = item?.grade ?? '';
                const rawSection = item?.section ?? '';
                const itemFilters = {
                    areaId: normalizeFilterValue(rawArea),
                    grade: normalizeFilterValue(rawGrade),
                    section: normalizeFilterValue(rawSection)
                };
                const score = scoreTemplate(item);
                const isFullMatch = itemFilters.areaId === desired.areaId
                    && itemFilters.grade === desired.grade
                    && itemFilters.section === desired.section;
                return { item, score, isFullMatch };
            })
            .filter((x: any) => x.score >= 0)
            .sort((a: any, b: any) =>
                b.score - a.score || String(b.item?.updated_at || '').localeCompare(String(a.item?.updated_at || ''))
            );

        if (!templatesByType.length) {
            return { status: 'missing-template' as const, instrumentType };
        }

        if (!compatibleTemplates.length) {
            return {
                status: 'error' as const,
                reason: `Hay plantillas de ${instrumentTypeLabelMap[instrumentType]}, pero ninguna coincide con el Área actual.`
            };
        }

        const selected = compatibleTemplates[0];
        const selectedTemplate = selected.item;
        const rows = mapTemplateToSessionRowsByType(selectedTemplate, instrumentType);
        if (!Array.isArray(rows) || rows.length === 0) {
            return { status: 'error' as const, reason: `La plantilla "${selectedTemplate?.name || 'sin nombre'}" no tiene estructura utilizable.` };
        }

        return {
            status: 'loaded' as const,
            instrumentType,
            instrumentName: selectedTemplate?.name || '',
            matchQuality: selected.isFullMatch ? 'full' as const : 'area' as const,
            template: {
                id: selectedTemplate?.id ?? null,
                type: instrumentType,
                name: selectedTemplate?.name || '',
                structure: selectedTemplate?.structure || {}
            },
            rows
        };
    }, [assignments, selArea, selGrade, selSection, year]);

    const hydrateMissingInstrumentTemplate = useCallback(async (rawSessionData: any) => {
        const instrumentLabel = String(rawSessionData?.instrumentoTemplate?.name || rawSessionData?.competenciaPrio?.inst || '').trim();
        const hasTemplate = !!rawSessionData?.instrumentoTemplate;
        const hasRows = hasFilledInstrumentRows(rawSessionData?.instrumento);

        if (hasTemplate || !hasRows || !instrumentLabel) {
            return { data: rawSessionData, hydrated: false, reason: '' };
        }

        const templateResult = await loadTemplateRowsByInstrument(instrumentLabel);
        if (templateResult.status !== 'loaded') {
            return {
                data: rawSessionData,
                hydrated: false,
                reason: templateResult.status === 'error' || templateResult.status === 'unsupported'
                    ? templateResult.reason
                    : ''
            };
        }

        return {
            hydrated: true,
            reason: '',
            data: {
                ...rawSessionData,
                instrumentoTemplate: {
                    ...templateResult.template,
                    lockedLayout: true,
                    fillableCellIds: getTemplateFillableCellIds(templateResult.template)
                }
            }
        };
    }, [loadTemplateRowsByInstrument]);

    useEffect(() => {
        const runResize = () => {
            const els = document.querySelectorAll<HTMLTextAreaElement>('textarea[data-comp-table="1"]');
            els.forEach(el => autoResizeTextarea(el));
        };
        runResize();
        requestAnimationFrame(runResize);
    }, [sessionData]);

    useEffect(() => {
        const load = async () => {
            const saved = localStorage.getItem('armi_assignments');
            if (saved) setAssignments(JSON.parse(saved));
            setAssignmentsLoaded(true);
            const gd = await getDatosGenerales();
            setGeneralData(gd);
            if (!initialSelection.year && gd.year) setYear(gd.year);
            const progs = await getProgramacionesAnuales();
            setAllSavedPrograms(progs);
            const studentRows = await getEstudiantes();
            setStudents(studentRows);
        };
        load();
    }, [initialSelection.year]);

    const uniqueAreas = useMemo(() => Array.from(new Set(assignments.map(a => a.areaName))).sort(), [assignments]);
    
    const availableGrades = useMemo(() => 
        Array.from(new Set(assignments.filter(a => a.areaName === selArea).map(a => a.grade))).sort(), 
    [assignments, selArea]);
    
    const availableSections = useMemo(() => {
        const baseSections = Array.from(new Set(assignments.filter(a => a.areaName === selArea && a.grade === selGrade).map(a => a.section))).sort();
        let options = baseSections.map(s => ({ value: s, label: s }));
        
        if (baseSections.length > 1) {
            const joinedLabel = baseSections.join(', ').replace(/, ([^,]*)$/, ' y $1');
            options.push({ value: joinedLabel, label: joinedLabel });
        }
        return options;
    }, [assignments, selArea, selGrade]);

    useEffect(() => {
        writeStoredViewSelection(SESSIONS_VIEW_SELECTION_STORAGE_KEY, {
            areaName: selArea,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            year
        });
    }, [selArea, selGrade, selSection, unitNumber, sessionNumber, year]);

    useEffect(() => {
        if (!assignmentsLoaded) return;
        if (selArea && !uniqueAreas.includes(selArea)) {
            setSelArea('');
            setSelGrade('');
            setSelSection('');
            return;
        }
        if (selGrade && !availableGrades.includes(selGrade)) {
            setSelGrade('');
            setSelSection('');
            return;
        }
        if (selSection && !availableSections.some(option => option.value === selSection)) {
            setSelSection('');
            return;
        }
        if (unitNumber && !Array.from({ length: 8 }, (_, i) => String(i + 1)).includes(String(unitNumber))) {
            setUnitNumber('1');
            return;
        }
        const availableSessionNumbers = Array.from({ length: Math.max(maxSessionsInUnit, 1) }, (_, i) => String(i + 1));
        if (sessionNumber && !availableSessionNumbers.includes(String(sessionNumber))) {
            setSessionNumber('1');
        }
    }, [assignmentsLoaded, selArea, selGrade, selSection, unitNumber, sessionNumber, uniqueAreas, availableGrades, availableSections, maxSessionsInUnit]);

    const handleInputChange = (path: string, value: any) => {
        const keys = path.split('.');
        setSessionData((prev: any) => {
            const newData = { ...prev };
            let current = newData;
            for (let i = 0; i < keys.length - 1; i++) {
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
            return newData;
        });
    };

    /**
     * Sincroniza anexos, instructivos e instrumentos detectados en actividades hacia recursos.
     * Soporta variaciones comunes de escritura (acentos, mayúsculas/minúsculas, N°, nro, etc.).
     */
    const syncResourcesRealtime = useCallback((activityContent: string, _activityPath: string, resourcePath: string) => {
        if (!activityContent) return;

        setSessionData((prev: any) => {
            const resourceKeys = resourcePath.split('.');

            let currentResourceHtml = prev;
            for (const k of resourceKeys) currentResourceHtml = currentResourceHtml?.[k];

            const customInstrument = String(prev.competenciaPrio?.inst || '');
            const { updatedResources, changed } = syncResourcesFromActivity(activityContent, String(currentResourceHtml || ''), customInstrument);
            if (!changed) return prev;

            const newData = { ...prev };
            let resPtr = newData;
            for (let i = 0; i < resourceKeys.length - 1; i++) resPtr = resPtr[resourceKeys[i]];
            resPtr[resourceKeys[resourceKeys.length - 1]] = updatedResources;

            return newData;
        });
    }, []);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionLoadRequestRef = useRef(0);

    const debouncedSync = (val: string, actPath: string, resPath: string) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        const norm = normalizeLoose(stripHtml(String(val || '')));
        const hasImmediateNumberedMention = /\b(?:anexo|instructivo)\s*(?:n|nro|numero)?\s*[1-9](?:\b|$)/.test(norm);
        if (hasImmediateNumberedMention) {
            syncResourcesRealtime(val, actPath, resPath);
            return;
        }
        timeoutRef.current = setTimeout(() => {
            syncResourcesRealtime(val, actPath, resPath);
        }, 120);
    };

    const triggerDateChange = (newDate: string) => {
        if (newDate === sessionDate) return;
        setPendingDate(newDate);
        setMotiveInput('');
        setShowMotiveModal(true);
    };

    const confirmDateChange = () => {
        if (!motiveInput.trim()) return;
        setSessionDate(pendingDate);
        handleInputChange('dateChangeMotive', motiveInput);
        setShowMotiveModal(false);
        setIsDatePickerOpen(false);
    };

    const handleSaveIAKey = async (key: string) => {
        if (!generalData || !key) return;
        setSavingKey(true);
        try {
            const updated = { ...generalData, gemini_api_key: key };
            const res = await saveDatosGenerales(updated);
            if (res.success) {
                setGeneralData(updated);
                setShowAuthScreen(false);
                setToast({ msg: "✅ Llave IA guardada correctamente.", type: 'success' });
            } else {
                setToast({ msg: "❌ No se pudo guardar la llave IA.", type: 'error' });
            }
        } catch {
            setToast({ msg: "❌ Error al guardar llave IA.", type: 'error' });
        } finally {
            setSavingKey(false);
        }
    };

    const handleGenerateAI = async () => {
        if (!headerFilled) {
            setToast({ msg: "⚠️ Completa Área, Grado, Sección, Unidad y Sesión.", type: 'warning' });
            return;
        }

        const apiKey = (generalData?.gemini_api_key || process.env.API_KEY || '').trim();
        if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.length < 10) {
            setShowAuthScreen(true);
            return;
        }

        setIsGeneratingIA(true);
        try {
            const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
            const ai = new GoogleGenAI({ apiKey });
            const currentSessionAssessmentModel = buildSessionAssessmentModel(sessionData, {
                areaId,
                grade: selGrade,
                section: selSection,
                unitNumber,
                sessionNumber,
                bimester: bimesterLabel
            });
            const currentTemplateType = String(sessionData?.instrumentoTemplate?.type || detectInstrumentTypeFromText(String(sessionData?.competenciaPrio?.inst || '')) || 'rubrica');
            const currentInstrumentName = String(sessionData?.instrumentoTemplate?.name || sessionData?.competenciaPrio?.inst || 'Rúbrica');
            const targetInstrumentRows = (() => {
                const canonicalRows = (Array.isArray(currentSessionAssessmentModel?.rows) ? currentSessionAssessmentModel.rows : [])
                    .filter((row: any) => normalizeLoose(String(row?.criterionText || row?.capacityName || row?.competencyName || '')));
                if (canonicalRows.length > 0) {
                    return canonicalRows.map((row: any, idx: number) => ({
                        id: String(row?.id || idx + 1),
                        competencia: String(row?.competencyName || '').trim(),
                        capacidad: String(row?.capacityName || '').trim(),
                        criterio: String(row?.criterionText || '').trim(),
                        c: String(row?.levelDescriptors?.c || '').trim(),
                        b: String(row?.levelDescriptors?.b || '').trim(),
                        a: String(row?.levelDescriptors?.a || '').trim(),
                        ad: String(row?.levelDescriptors?.ad || '').trim(),
                        source: String(row?.source || 'primary').trim(),
                        rowColor: String(row?.rowColor || '').trim()
                    }));
                }
                return (Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : []).map((row: any, idx: number) => ({
                    id: String(row?.id || idx + 1),
                    competencia: String(row?.competencia || row?.comp || '').trim(),
                    capacidad: String(row?.capacidad || row?.cap || '').trim(),
                    criterio: String(row?.criterio || '').trim(),
                    c: String(row?.c || '').trim(),
                    b: String(row?.b || '').trim(),
                    a: String(row?.a || '').trim(),
                    ad: String(row?.ad || '').trim(),
                    source: String(row?.source || 'primary').trim(),
                    rowColor: String(row?.rowColor || '').trim()
                }));
            })();
            const instrumentRowsTarget = targetInstrumentRows.map((row: any, idx: number) => ({
                index: idx,
                source: String(row?.source || 'primary').trim(),
                competencia: String(row?.competencia || '').trim(),
                capacidad: String(row?.capacidad || '').trim(),
                criterio: String(row?.criterio || '').trim(),
                requiredLevels: ['c', 'b', 'a', 'ad']
            }));

            const placeholderSet = new Set<string>();
            AI_RICH_TEXT_PATHS.forEach(path => {
                extractBracketTokens(String(getPathByString(sessionData, path) || '')).forEach(t => placeholderSet.add(t));
            });
            (sessionData?.competenciasTrans || []).forEach((ct: any) => {
                extractBracketTokens(String(ct?.des || '')).forEach(t => placeholderSet.add(t));
                extractBracketTokens(String(ct?.evidence || '')).forEach(t => placeholderSet.add(t));
            });

            const aiPedagogicalRoute = String((generalData as any)?.ai_pedagogical_route || '').trim();
            const institutionalProblems = String((generalData as any)?.ai_institutional_problems || '').trim();
            const unitPedagogicalFocus = String((generalData as any)?.ai_unit_pedagogical_focus || '').trim();

            const aiExtraContext = {
                aiPedagogicalRoute,
                institutionalProblems,
                unitPedagogicalFocus
            };

            const contextForAI = {
                year,
                areaId,
                areaName: selArea,
                grade: selGrade,
                section: selSection,
                unitNumber,
                sessionNumber,
                date: sessionDate || '',
                title: sessionData?.title || '',
                purpose: sessionData?.purpose || '',
                situation: sessionData?.situation || '',
                competenciaPrio: sessionData?.competenciaPrio || {},
                competenciasTrans: sessionData?.competenciasTrans || [],
                enfoqueTrans: sessionData?.enfoqueTrans || {},
                secuencia: sessionData?.secuencia || {},
                extension: sessionData?.extension || '',
                recursos: sessionData?.recursos || {},
                bibliografia: sessionData?.bibliografia || {},
                assessmentModel: sessionData?.assessmentModel || {},
                sessionAssessmentModel: currentSessionAssessmentModel,
                instrumentTemplateType: currentTemplateType,
                instrumentTemplateName: currentInstrumentName,
                targetInstrumentRows,
                currentInstrumentoRows: sessionData?.instrumento || [],
                aiExtraContext,
                currentProgram: {
                    areaPurpose: currentProgram?.areaPurpose || '',
                    areaEnfoque: currentProgram?.areaEnfoque || '',
                    didacticUnits: currentProgram?.didacticUnits || {},
                    resourceFields: currentProgram?.resourceFields || {},
                    bibliographyFields: currentProgram?.bibliographyFields || {}
                }
            };

            const prompt = `
Eres un experto pedagógico del MINEDU Perú.
Completa la sesión de aprendizaje con lenguaje profesional, concreto y aplicable.
Debes respetar y completar la plantilla aunque el usuario haya editado partes.
Debes tener en cuenta la configuración pedagógica global del docente, la programación anual y la unidad didáctica cargada. Si la unidad corresponde a un proyecto, portafolio, concurso, metodología o ruta específica indicada por el docente, la sesión debe alinearse a ese proceso sin omitir los productos, evidencias y actividades esperadas.

REGLAS:
1) Devuelve SOLO JSON válido (sin markdown).
2) Si ves placeholders tipo [ ... ], genera reemplazos concretos en "placeholderMap".
3) Para campos HTML devuelve contenido en formato HTML simple (<p>, <ul>, <li>, <strong>, <em>, <span style="color: green;">).
4) Respeta el instrumento actual del contexto: "${currentInstrumentName}" (tipo: "${currentTemplateType}").
5) Debes devolver "instrumentRows" con exactamente ${Math.max(targetInstrumentRows.length, currentTemplateType === 'rubrica' ? 4 : 1)} filas.
6) Cada fila de "instrumentRows" debe incluir: index, criterio, c, b, a, ad.
7) En TODOS los instrumentos, aunque visualmente no se muestren, c/b/a/ad deben ser descriptores pedagógicos reales de nivel de logro para ese criterio.
8) No devuelvas etiquetas sueltas como "Deficiente", "Regular", "Bueno", "Muy bueno" dentro de c/b/a/ad; devuelve descripciones de desempeño observables.
9) Si el instrumento es rúbrica, los descriptores pueden ser más extensos. Si es lista, escala o guía, los descriptores pueden ser breves pero específicos.
10) Redacta pensando en estudiantes de ${selGrade}, área ${selArea}.
11) Debes completar TODOS los índices listados en "FILAS DEL INSTRUMENTO A COMPLETAR", incluyendo criterios del área y competencias transversales.
12) No omitas ninguna fila aunque sea la 5, 6 o posterior.
13) Usa el mismo criterio base de cada índice y devuelve descriptores para todos los niveles de logro.

PLACEHOLDERS DETECTADOS:
${JSON.stringify(Array.from(placeholderSet), null, 2)}

FILAS DEL INSTRUMENTO A COMPLETAR:
${JSON.stringify(instrumentRowsTarget, null, 2)}

CONTEXTO ACTUAL:
${JSON.stringify(contextForAI, null, 2)}

FORMATO DE RESPUESTA:
{
  "title": "string",
  "purpose": "string",
  "situation": "string",
  "extension": "string",
  "placeholderMap": { "placeholder original": "reemplazo" },
  "competenciaPrio": {
    "field": "string",
    "inst": "string",
    "des": "html",
    "evidence": "html"
  },
  "competenciasTrans": [
    { "cap": "string", "inst": "string", "des": "html", "evidence": "html" }
  ],
  "secuencia": {
    "inicio": { "saberes": "html", "conflicto": "html" },
    "proceso": { "construccion": "html", "aplicacion": "html", "metacognicion": "html" },
    "salida": { "evaluacion": "html" }
  },
  "instrumentRows": [
    { "index": 0, "criterio": "string", "capacidad": "string", "c": "string", "b": "string", "a": "string", "ad": "string" }
  ],
  "rubrica": [
    { "index": 0, "criterio": "string", "c": "string", "b": "string", "a": "string", "ad": "string" }
  ]
}
`;

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ parts: [{ text: prompt }] }],
                config: { responseMimeType: "application/json", temperature: 0.4 }
            });

            const raw = String(response.text || '').trim();
            if (!raw) throw new Error("EMPTY_RESPONSE");
            const aiData = parseAiJsonObject(raw);

            const placeholderMapRaw = aiData?.placeholderMap && typeof aiData.placeholderMap === 'object' ? aiData.placeholderMap : {};
            const placeholderMap: Record<string, string> = {};
            Object.keys(placeholderMapRaw).forEach((k) => {
                const key = String(k || '').trim();
                const val = String(placeholderMapRaw[k] || '').trim();
                if (key && val) placeholderMap[key] = val;
            });

            const fillHtmlField = (current: string, generated: string) => {
                const curr = String(current || '');
                const gen = String(generated || '');
                const replacedCurrent = replaceBracketTokens(curr, placeholderMap);
                const replacedGenerated = replaceBracketTokens(gen, placeholderMap);
                if (hasPendingTemplateHints(replacedCurrent) || !isMeaningfulRichText(replacedCurrent)) {
                    return replacedGenerated || replacedCurrent;
                }
                return replacedCurrent;
            };

            const nextData = JSON.parse(JSON.stringify(sessionData));
            const nextTitle = replaceBracketTokens(String(aiData?.title || nextData.title || ''), placeholderMap);
            const nextPurpose = replaceBracketTokens(String(aiData?.purpose || nextData.purpose || ''), placeholderMap);
            const nextSituation = replaceBracketTokens(String(aiData?.situation || nextData.situation || ''), placeholderMap);
            const nextExtension = replaceBracketTokens(String(aiData?.extension || nextData.extension || ''), placeholderMap);
            if (nextTitle.trim()) nextData.title = nextTitle;
            if (nextPurpose.trim()) nextData.purpose = nextPurpose;
            if (nextSituation.trim()) nextData.situation = nextSituation;
            if (nextExtension.trim()) nextData.extension = nextExtension;

            const aiPrio = aiData?.competenciaPrio || {};
            nextData.competenciaPrio.des = fillHtmlField(nextData.competenciaPrio.des, aiPrio.des);
            nextData.competenciaPrio.evidence = fillHtmlField(nextData.competenciaPrio.evidence, aiPrio.evidence);
            nextData.competenciaPrio.field = replaceBracketTokens(String(aiPrio.field || nextData.competenciaPrio.field || ''), placeholderMap);
            nextData.competenciaPrio.inst = replaceBracketTokens(String(aiPrio.inst || nextData.competenciaPrio.inst || 'Rúbrica'), placeholderMap);

            const aiTrans = Array.isArray(aiData?.competenciasTrans) ? aiData.competenciasTrans : [];
            nextData.competenciasTrans = (nextData.competenciasTrans || []).map((ct: any, idx: number) => {
                const row = aiTrans[idx] || {};
                return {
                    ...ct,
                    cap: replaceBracketTokens(String(row.cap || ct.cap || ''), placeholderMap),
                    inst: replaceBracketTokens(String(row.inst || ct.inst || ''), placeholderMap),
                    des: fillHtmlField(String(ct.des || ''), String(row.des || '')),
                    evidence: fillHtmlField(String(ct.evidence || ''), String(row.evidence || ''))
                };
            });

            const aiSec = aiData?.secuencia || {};
            nextData.secuencia.inicio.saberes = fillHtmlField(nextData.secuencia.inicio.saberes, aiSec?.inicio?.saberes);
            nextData.secuencia.inicio.conflicto = fillHtmlField(nextData.secuencia.inicio.conflicto, aiSec?.inicio?.conflicto);
            nextData.secuencia.proceso.construccion = fillHtmlField(nextData.secuencia.proceso.construccion, aiSec?.proceso?.construccion);
            nextData.secuencia.proceso.aplicacion = fillHtmlField(nextData.secuencia.proceso.aplicacion, aiSec?.proceso?.aplicacion);
            nextData.secuencia.proceso.metacognicion = fillHtmlField(nextData.secuencia.proceso.metacognicion, aiSec?.proceso?.metacognicion);
            nextData.secuencia.salida.evaluacion = fillHtmlField(nextData.secuencia.salida.evaluacion, aiSec?.salida?.evaluacion);

            AI_RICH_TEXT_PATHS.forEach(path => {
                const currentValue = String(getPathByString(nextData, path) || '');
                setPathByString(nextData, path, replaceBracketTokens(currentValue, placeholderMap));
            });
            (nextData.competenciasTrans || []).forEach((ct: any) => {
                ct.des = replaceBracketTokens(String(ct.des || ''), placeholderMap);
                ct.evidence = replaceBracketTokens(String(ct.evidence || ''), placeholderMap);
            });

            const aiInstrumentRows = Array.isArray(aiData?.instrumentRows) && aiData.instrumentRows.length > 0
                ? aiData.instrumentRows
                : (Array.isArray(aiData?.rubrica) ? aiData.rubrica : []);
            const aiInstrumentRowsByIndex = new Map<number, any>();
            aiInstrumentRows.forEach((row: any, idx: number) => {
                const rawIndex = row?.index;
                const parsedIndex = Number(rawIndex);
                const effectiveIndex = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : idx;
                aiInstrumentRowsByIndex.set(effectiveIndex, row);
            });
            const targetRowCount = Math.max(
                targetInstrumentRows.length,
                aiInstrumentRows.length,
                currentTemplateType === 'rubrica' ? 4 : 1
            );
            nextData.instrumento = Array.from({ length: targetRowCount }, (_, i) => {
                const base = targetInstrumentRows[i] || nextData.instrumento?.[i] || { id: i + 1, criterio: '', c: '', b: '', a: '', ad: '' };
                const aiRow = aiInstrumentRowsByIndex.get(i) || aiInstrumentRows[i] || {};
                return {
                    ...base,
                    id: base?.id || i + 1,
                    competencia: replaceBracketTokens(String(aiRow.competencia || base.competencia || ''), placeholderMap),
                    capacidad: replaceBracketTokens(String(aiRow.capacidad || base.capacidad || ''), placeholderMap),
                    criterio: replaceBracketTokens(String(aiRow.criterio || base.criterio || ''), placeholderMap),
                    c: replaceBracketTokens(String(aiRow.c || base.c || ''), placeholderMap),
                    b: replaceBracketTokens(String(aiRow.b || base.b || ''), placeholderMap),
                    a: replaceBracketTokens(String(aiRow.a || base.a || ''), placeholderMap),
                    ad: replaceBracketTokens(String(aiRow.ad || base.ad || ''), placeholderMap),
                    source: String(base?.source || aiRow?.source || 'primary').trim(),
                    rowColor: String(base?.rowColor || aiRow?.rowColor || '').trim()
                };
            }).filter((row: any) =>
                normalizeLoose(String(row?.criterio || row?.capacidad || row?.competencia || row?.c || row?.b || row?.a || row?.ad || '')).length > 0
            );

            nextData.assessmentModel = buildAssessmentModelFromData(nextData, 'ai');
            nextData.sessionAssessmentModel = buildSessionAssessmentModel(nextData, {
                areaId,
                grade: selGrade,
                section: selSection,
                unitNumber,
                sessionNumber,
                bimester: bimesterLabel
            });

            AI_ACTIVITY_RESOURCE_PAIRS.forEach(([activityPath, resourcePath]) => {
                const activity = String(getPathByString(nextData, activityPath) || '');
                const resources = String(getPathByString(nextData, resourcePath) || '');
                const customInstrument = String(nextData?.competenciaPrio?.inst || '');
                const { updatedResources, changed } = syncResourcesFromActivity(activity, resources, customInstrument);
                if (changed) setPathByString(nextData, resourcePath, updatedResources);
            });

            const resourceDefaults = currentProgram?.resourceFields || {};
            const bibliographyDefaults = currentProgram?.bibliographyFields || {};
            const generatedResourceDefaults = buildSessionResourceDefaults(nextData, resourceDefaults);

            const isEmpty = (value: any) => !String(value || '').trim();
            const recursosActuales = nextData?.recursos || {};
            const bibliografiaActual = nextData?.bibliografia || {};

            nextData.recursos = {
                ...recursosActuales,
                rec: mergeUniqueMultilineText(recursosActuales.rec, generatedResourceDefaults.rec),
                med: mergeUniqueMultilineText(recursosActuales.med, generatedResourceDefaults.med),
                mat: mergeUniqueMultilineText(recursosActuales.mat, generatedResourceDefaults.mat),
                soft: mergeUniqueMultilineText(recursosActuales.soft, generatedResourceDefaults.soft),
                esp: mergeUniqueMultilineText(recursosActuales.esp, generatedResourceDefaults.esp)
            };

            if (isEmpty(bibliografiaActual.bib) && isEmpty(bibliografiaActual.link)) {
                nextData.bibliografia = {
                    ...bibliografiaActual,
                    bib: String(bibliographyDefaults.referencias || ''),
                    link: String(bibliographyDefaults.linkografia || '')
                };
            }

            setSessionData(ensureSessionExtraBlocks(ensureSessionAssessmentModel(ensureAssessmentModel(nextData, 'ai'), {
                areaId,
                grade: selGrade,
                section: selSection,
                unitNumber,
                sessionNumber,
                bimester: bimesterLabel
            })));
            setToast({ msg: "✅ IA Armi completó la sesión y llenó los descriptores internos del instrumento.", type: 'success' });
        } catch (e: any) {
            const msg = String(e?.message || e || '');
            if (msg.toLowerCase().includes('api') || msg.toLowerCase().includes('401') || msg.toLowerCase().includes('403')) {
                setShowAuthScreen(true);
                setToast({ msg: "⚠️ Revisa tu API Key de IA.", type: 'warning' });
            } else {
                setToast({ msg: "❌ Error IA: " + msg, type: 'error' });
            }
        } finally {
            setIsGeneratingIA(false);
        }
    };


    const handleSaveAsTemplate = async () => {
        if (!selArea || !selGrade || !selSection) {
            setToast({ msg: '⚠️ Seleccione Área, Grado y Sección.', type: 'warning' });
            return;
        }
        if (confirm(`¿Desea anclar esta configuración como plantilla permanente para ${selArea} - ${selGrade} "${selSection}" en SQL?`)) {
            const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
            try {
                const response = await fetch('/api/plantillas-area', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        areaId,
                        grade: selGrade,
                        section: selSection,
                        sessionData
                    })
                });
                const res = await response.json();
                if (res.success) {
                    setToast({ msg: '✅ Plantilla de Área anclada correctamente', type: 'success' });
                } else {
                    setToast({ msg: '❌ Error al guardar plantilla: ' + res.message, type: 'error' });
                }
            } catch (e: any) {
                setToast({ msg: '❌ Error de conexión al anclar plantilla', type: 'error' });
            }
        }
    };

    const handleExportJson = () => {
        if (!selArea) return;
        const exportObj = {
            metadata: { area: selArea, grade: selGrade, section: selSection, year, type: 'ARMI_SESSION_TEMPLATE' },
            sessionData
        };
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Plantilla_${selArea}_${selGrade}_${selSection}.json`.replace(/\s+/g, '_');
        a.click();
        setToast({ msg: '✅ Archivo JSON generado', type: 'success' });
    };

    const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const json = JSON.parse(evt.target?.result as string);
                if (json.sessionData && json.sessionData.secuencia) {
                    if (json.metadata?.area !== selArea || json.metadata?.grade !== selGrade) {
                        if (!confirm("⚠️ Aviso: Esta plantilla pertenece a otra área o grado. ¿Desea cargar los datos de todas formas?")) return;
                    }
                    setSessionData(ensureSessionExtraBlocks(ensureSessionAssessmentModel(json.sessionData, {
                        areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                        grade: selGrade,
                        section: selSection,
                        unitNumber,
                        sessionNumber,
                        bimester: bimesterLabel
                    })));
                    setToast({ msg: '✅ Plantilla cargada en el editor', type: 'success' });
                } else {
                    setToast({ msg: '❌ El archivo JSON no es una plantilla válida', type: 'error' });
                }
            } catch (err) {
                setToast({ msg: '❌ Error al procesar el archivo JSON', type: 'error' });
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    useEffect(() => {
        if (selArea && selGrade && selSection && unitNumber && sessionNumber) {
            const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
            const requestId = ++sessionLoadRequestRef.current;
            const isStaleRequest = () => sessionLoadRequestRef.current !== requestId;
            const selectionKey = `${year}-${selArea}-${selGrade}-${selSection}-U${unitNumber}-S${sessionNumber}`;

            if (lastSelectionKeyRef.current !== selectionKey) {
                lastSelectionKeyRef.current = selectionKey;
                setSessionData(ensureSessionAssessmentModel(cloneInitialSessionData(), {
                    areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                    grade: selGrade,
                    section: selSection,
                    unitNumber,
                    sessionNumber,
                    bimester: bimesterLabel
                }));
                setDateOptions([]);
                setSessionDate('');
            }
            
            const loadUnitInfo = async (options?: { source?: 'unit-prefill' | 'silent' }) => {
                const comps = await getCompetencias(selGrade, selArea);
                if (isStaleRequest()) return;
                setCompetenciasBase(comps);

                const unit = await getUnidadDidactica(year, areaId, selGrade, selSection, unitNumber);
                if (isStaleRequest()) return;
                if (unit) {
                    const unitSessions = Array.isArray(unit.sesiones) ? unit.sesiones : [];
                    const sessionCount = unitSessions.length || 15;
                    setMaxSessionsInUnit(sessionCount);

                    const targetSessionId = parseInt(sessionNumber, 10);
                    const unitSession =
                        unitSessions.find((s: any) => Number(s?.id) === targetSessionId || Number(s?.sessionNumber) === targetSessionId)
                        || unitSessions[targetSessionId - 1];

                    if (unitSession?.date) {
                        const isMultipleSections = selSection.includes(' y ');
                        if (unitSession.date.includes(' --- ')) {
                            const dates = unitSession.date.split(' --- ').map((d: string) => ({
                                value: d.includes('/') ? d.split('/').reverse().join('-') : d,
                                label: d
                            }));
                            setDateOptions(dates);
                            if (!isMultipleSections) {
                                setSessionDate(dates[0].value);
                            } else {
                                setSessionDate(''); 
                            }
                        } else {
                            setDateOptions([]);
                            setSessionDate(
                                unitSession.date.includes('/')
                                    ? unitSession.date.split('/').reverse().join('-')
                                    : unitSession.date
                            );
                        }
                    } else {
                        setDateOptions([]);
                        setSessionDate('');
                    }

                    let actualCompAreaName = unitSession?.competencia || ('Área: ' + selArea);
                    if (!unitSession?.competencia && unitSession?.capacidades?.length > 0 && comps.length > 0) {
                        const targetCap = unitSession.capacidades[0];
                        const match = comps.find(c => 
                            String(getFlexValue(c, 'capacidades')).trim().toLowerCase() === String(targetCap).trim().toLowerCase()
                        );
                        if (match) actualCompAreaName = getFlexValue(match, 'competencias');
                    }

                    const criteriaItems = Array.isArray(unitSession?.criteriaItems) ? unitSession.criteriaItems : [];
                    const evidenceItems = Array.isArray(unitSession?.evidenceItems) ? unitSession.evidenceItems : [];
                    const sessionCapacidades = Array.isArray(unitSession?.capacidades)
                        ? unitSession.capacidades.map((c: any) => String(c || '').trim()).filter(Boolean)
                        : [];
                    const sessionTransversales = Array.isArray(unitSession?.transversales)
                        ? unitSession.transversales.map((t: any) => String(t || '').trim()).filter(Boolean)
                        : [];
                    const activeTransversalSet = new Set(sessionTransversales.map((t: string) => normalizeLoose(t)));

                    const prioCriteriaItems = criteriaItems.filter((it: any) => isBlackColorToken(String(it?.color || 'text-black')));
                    const prioEvidenceItems = evidenceItems.filter((it: any) => isBlackColorToken(String(it?.color || 'text-black')));
                    const transCriteriaItems = criteriaItems.filter((it: any) => !isBlackColorToken(String(it?.color || 'text-black')));
                    const transEvidenceItems = evidenceItems.filter((it: any) => !isBlackColorToken(String(it?.color || 'text-black')));

                    const transCapsByName: Record<string, string[]> = {
                        [TRANSVERSAL_NAMES[0]]: [],
                        [TRANSVERSAL_NAMES[1]]: []
                    };
                    const areaCaps: string[] = [];

                    sessionCapacidades.forEach((cap: string) => {
                        const transName = detectTransversalByCapacity(cap);
                        if (transName && (activeTransversalSet.size === 0 || activeTransversalSet.has(normalizeLoose(transName)))) {
                            transCapsByName[transName].push(cap);
                        } else {
                            areaCaps.push(cap);
                        }
                    });

                    let prioComp = {
                        comp: actualCompAreaName,
                        cap: areaCaps.join('\n') || unitSession?.cap || '',
                        des: itemsToHtml(prioCriteriaItems, unitSession?.des || ''),
                        field: unitSession?.con || '',
                        evidence: itemsToHtml(prioEvidenceItems, unitSession?.evi || ''),
                        inst: unitSession?.eval || ''
                    };

                    const transEvals = TRANSVERSAL_NAMES.map((name, idx) => {
                        const isActive = activeTransversalSet.size === 0 || activeTransversalSet.has(normalizeLoose(name));
                        const criteria = isActive ? (unit.criteriosTrans?.[idx] || '') : '';
                        const evidence = isActive ? (unit.evidenciasTrans?.[idx] || '') : '';
                        const inst = isActive ? (unit.instrumentosTrans?.[idx] || '') : '';
                        return {
                            comp: name,
                            cap: transCapsByName[name].join('\n'),
                            des: criteria ? `<p>${escapeHtml(criteria)}</p>` : '<p></p>',
                            field: '',
                            evidence: evidence ? `<p>${escapeHtml(evidence)}</p>` : '<p></p>',
                            inst: inst,
                            rowColor: name === TRANSVERSAL_NAMES[0] ? '#007c59' : '#00b28c'
                        };
                    });

                    if (transCriteriaItems.length || transEvidenceItems.length) {
                        const transColorToIndex: Record<string, number> = {
                            '#007c59': 0,
                            '#00b28c': 1
                        };

                        const groupedCriteria: Array<Array<{ text?: string; color?: string }>> = [[], []];
                        const groupedEvidence: Array<Array<{ text?: string; color?: string }>> = [[], []];

                        transCriteriaItems.forEach((item: any, i: number) => {
                            const color = colorTokenToCss(String(item?.color || ''));
                            const idx = transColorToIndex[color.toLowerCase()] ?? (i % TRANSVERSAL_NAMES.length);
                            groupedCriteria[idx].push(item);
                        });
                        transEvidenceItems.forEach((item: any, i: number) => {
                            const color = colorTokenToCss(String(item?.color || ''));
                            const idx = transColorToIndex[color.toLowerCase()] ?? (i % TRANSVERSAL_NAMES.length);
                            groupedEvidence[idx].push(item);
                        });

                        transEvals.forEach((row, idx) => {
                            const isActive = activeTransversalSet.size === 0 || activeTransversalSet.has(normalizeLoose(row.comp));
                            if (!isActive) return;
                            if (groupedCriteria[idx].length) {
                                row.des = itemsToHtml(groupedCriteria[idx], '');
                                const fromCriteriaColor = colorTokenToCss(String(groupedCriteria[idx][0]?.color || ''));
                                if (!isBlackColorToken(fromCriteriaColor)) row.rowColor = fromCriteriaColor;
                            }
                            if (groupedEvidence[idx].length) {
                                row.evidence = itemsToHtml(groupedEvidence[idx], '');
                                const fromEvidenceColor = colorTokenToCss(String(groupedEvidence[idx][0]?.color || ''));
                                if (!isBlackColorToken(fromEvidenceColor)) row.rowColor = fromEvidenceColor;
                            }
                        });
                    }

                    const programKey = `${year}-${areaId}-${selGrade}-${selSection}`;
                    const program = allSavedPrograms[programKey];
                    let enfObj = { enfoque: '', valor: '', acciones: '', demuestra: '' };
                    
                    if (program?.matrixChecks) {
                        const currentUnitIndex = Math.max(0, parseInt(unitNumber || '1', 10) - 1);
                        const selectedApproachNames = Object.keys(ENFOQUE_DETAILS).filter((enf) => {
                            const checkKey = `enfoque-${superNormalize(enf)}-${currentUnitIndex}`;
                            return !!program.matrixChecks?.[checkKey];
                        });

                        if (selectedApproachNames.length > 0) {
                            const selectedDetails = selectedApproachNames
                                .map((name) => ({
                                    name,
                                    details: ENFOQUE_DETAILS[name] || {}
                                }));

                            const uniqueLines = (values: string[]) =>
                                Array.from(
                                    new Set(
                                        values
                                            .flatMap((value) => String(value || '').split(/\r?\n/))
                                            .map((line) => String(line || '').trim())
                                            .filter(Boolean)
                                    )
                                )
                                .join('\n');

                            enfObj = {
                                enfoque: selectedApproachNames.join('\n'),
                                valor: uniqueLines(selectedDetails.map((item) => item.details?.valores || '')),
                                acciones: uniqueLines(selectedDetails.map((item) => item.details?.actitudes || item.details?.acciones || '')),
                                demuestra: uniqueLines(selectedDetails.map((item) => item.details?.demuestra || ''))
                            };
                        }
                    }

                    setSessionData((prev: any) => ({
                        ...prev,
                        title: unitSession?.title || prev.title,
                        competenciaPrio: prioComp,
                        competenciasTrans: transEvals,
                        enfoqueTrans: enfObj,
                        situation: unit.situation || prev.situation,
                        assessmentModel: (() => {
                            const base = buildAssessmentModelFromData({
                                ...prev,
                                competenciaPrio: prioComp
                            }, 'unit');
                            const criteriosFromUnidad = (prioCriteriaItems || [])
                                .map((it: any, idx: number) => ({
                                    id: String(idx + 1),
                                    text: String(it?.text || '').trim()
                                }))
                                .filter((x: any) => !!x.text);
                            return {
                                ...base,
                                criterios: criteriosFromUnidad.length > 0 ? criteriosFromUnidad : base.criterios
                            };
                        })(),
                        sessionAssessmentModel: buildSessionAssessmentModel({
                            ...prev,
                            competenciaPrio: prioComp,
                            competenciasTrans: transEvals,
                            instrumento: prev?.instrumento || []
                        }, {
                            areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                            grade: selGrade,
                            section: selSection,
                            unitNumber,
                            sessionNumber,
                            bimester: bimesterLabel
                        })
                    }));

                    let shouldShowLoadedToast = true;
                    const instrumentLabel = String(prioComp.inst || '').trim();
                    const detectedType = detectInstrumentTypeFromText(instrumentLabel);

                    if (detectedType) {
                        const templateResult = await loadTemplateRowsByInstrument(instrumentLabel);
                        if (isStaleRequest()) return;

                        if (templateResult.status === 'loaded') {
                            setSessionData((prev: any) => ({
                                ...ensureAssessmentModel(prev, 'unit'),
                                instrumento: templateResult.rows,
                                instrumentoTemplate: {
                                    ...templateResult.template,
                                    lockedLayout: true,
                                    fillableCellIds: getTemplateFillableCellIds(templateResult.template)
                                },
                                assessmentModel: (() => {
                                    const base = buildAssessmentModelFromData({
                                        ...prev,
                                        instrumento: templateResult.rows
                                    }, 'unit');
                                    const criteriosFromUnidad = (prioCriteriaItems || [])
                                        .map((it: any, idx: number) => ({
                                            id: String(idx + 1),
                                            text: String(it?.text || '').trim()
                                        }))
                                        .filter((x: any) => !!x.text);
                                        return {
                                            ...base,
                                            criterios: criteriosFromUnidad.length > 0 ? criteriosFromUnidad : base.criterios
                                        };
                                    })(),
                                    sessionAssessmentModel: buildSessionAssessmentModel({
                                        ...prev,
                                        instrumento: templateResult.rows,
                                        instrumentoTemplate: {
                                            ...templateResult.template,
                                            lockedLayout: true,
                                            fillableCellIds: getTemplateFillableCellIds(templateResult.template)
                                        }
                                    }, {
                                        areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                                        grade: selGrade,
                                        section: selSection,
                                        unitNumber,
                                        sessionNumber,
                                        bimester: bimesterLabel
                                    })
                            }));
                            const matchEmoji = templateResult.matchQuality === 'full' ? '🎯' : '📎';
                            setToast({
                                msg: `Instrumento cargado: ${instrumentTypeLabelMap[templateResult.instrumentType]}${templateResult.instrumentName ? ` (${templateResult.instrumentName})` : ''} ${matchEmoji}`,
                                type: 'success'
                            });
                        } else if (templateResult.status === 'missing-template') {
                            shouldShowLoadedToast = false;
                            setToast({
                                msg: `❌ No hay plantilla de ${instrumentTypeLabelMap[templateResult.instrumentType]} en Evaluación > Instrumentos para este filtro.`,
                                type: 'error'
                            });
                        } else if (templateResult.status === 'unsupported') {
                            shouldShowLoadedToast = false;
                            setToast({ msg: `❌ ${templateResult.reason}`, type: 'error' });
                        } else if (templateResult.status === 'skip') {
                            shouldShowLoadedToast = false;
                            setToast({ msg: `❌ No se pudo cargar instrumento: ${templateResult.reason}`, type: 'error' });
                        } else if (templateResult.status === 'error') {
                            shouldShowLoadedToast = false;
                            setToast({ msg: `❌ Error al cargar instrumento: ${templateResult.reason}`, type: 'error' });
                        }
                    }

                    if (shouldShowLoadedToast && options?.source === 'unit-prefill') {
                        setToast({ msg: `✅ Sesión ${sessionNumber} pre llenada desde la unidad U${unitNumber}`, type: 'success' });
                    }
                } else {
                    setToast({ msg: `⚠️ No se halló la Unidad U${unitNumber} para estos filtros en SQL.`, type: 'warning' });
                    setSessionDate('');
                    setDateOptions([]);
                    setMaxSessionsInUnit(15);
                }
            };

            const loadSessionDateFromUnit = async () => {
                const unit = await getUnidadDidactica(year, areaId, selGrade, selSection, unitNumber);
                if (isStaleRequest()) return;

                if (!unit) {
                    setSessionDate('');
                    setDateOptions([]);
                    return;
                }

                const unitSessions = Array.isArray(unit.sesiones) ? unit.sesiones : [];
                const targetSessionId = parseInt(sessionNumber, 10);
                const unitSession =
                    unitSessions.find((s: any) => Number(s?.id) === targetSessionId || Number(s?.sessionNumber) === targetSessionId)
                    || unitSessions[targetSessionId - 1];

                if (unitSession?.date) {
                    const isMultipleSections = selSection.includes(' y ');
                    if (unitSession.date.includes(' --- ')) {
                        const dates = unitSession.date.split(' --- ').map((d: string) => ({
                            value: d.includes('/') ? d.split('/').reverse().join('-') : d,
                            label: d
                        }));
                        setDateOptions(dates);
                        if (!isMultipleSections) {
                            setSessionDate(dates[0].value);
                        } else {
                            setSessionDate('');
                        }
                    } else {
                        setDateOptions([]);
                        setSessionDate(
                            unitSession.date.includes('/')
                                ? unitSession.date.split('/').reverse().join('-')
                                : unitSession.date
                        );
                    }
                } else {
                    setSessionDate('');
                    setDateOptions([]);
                }
            };

            const checkSavedSession = async () => {
                const saved = await getSesion(year, areaId, selGrade, selSection, unitNumber, sessionNumber);
                if (isStaleRequest()) return;
                if (saved) {
                    const hydratedSavedResult = await hydrateMissingInstrumentTemplate(saved);
                    if (isStaleRequest()) return;
                    const savedWithTemplate = hydratedSavedResult.data;

                    setSessionData(ensureSessionExtraBlocks(ensureSessionAssessmentModel(ensureAssessmentModel(savedWithTemplate, 'sql'), {
                        areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                        grade: selGrade,
                        section: selSection,
                        unitNumber,
                        sessionNumber,
                        bimester: bimesterLabel
                    })));
                    if (saved.date) {
                        setSessionDate(saved.date);
                        setDateOptions([]);
                    } else {
                        await loadSessionDateFromUnit();
                        if (isStaleRequest()) return;
                    }
                    setToast({
                        msg: hydratedSavedResult.hydrated
                            ? `✅ Sesión ${sessionNumber} completa cargada desde DB e instrumento reconectado`
                            : `✅ Sesión ${sessionNumber} completa cargada desde DB`,
                        type: 'success'
                    });
                } else {
                    // SE BUSCA PLANTILLA DE ÁREA EN LA NUEVA TABLA
                    try {
                        const resp = await fetch(`/api/plantillas-area?areaId=${areaId}&grade=${selGrade}&section=${selSection}`);
                        const resJson = await resp.json();
                        if (isStaleRequest()) return;
                        if (resJson.success && resJson.data) {
                            setSessionData(ensureSessionExtraBlocks(ensureSessionAssessmentModel(ensureAssessmentModel(resJson.data, 'sql'), {
                                areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                                grade: selGrade,
                                section: selSection,
                                unitNumber,
                                sessionNumber,
                                bimester: bimesterLabel
                            })));
                            loadUnitInfo({ source: 'unit-prefill' });
                        } else {
                            const defaultTemplate = buildDefaultAreaTemplateSessionData();
                            setSessionData(ensureSessionExtraBlocks(ensureSessionAssessmentModel(ensureAssessmentModel(defaultTemplate, 'system'), {
                                areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                                grade: selGrade,
                                section: selSection,
                                unitNumber,
                                sessionNumber,
                                bimester: bimesterLabel
                            })));
                            await fetch('/api/plantillas-area', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    areaId,
                                    grade: selGrade,
                                    section: selSection,
                                    sessionData: defaultTemplate
                                })
                            }).catch(() => null);
                            loadUnitInfo({ source: 'unit-prefill' });
                        }
                    } catch (e) {
                        const defaultTemplate = buildDefaultAreaTemplateSessionData();
                        setSessionData(ensureSessionExtraBlocks(ensureSessionAssessmentModel(ensureAssessmentModel(defaultTemplate, 'system'), {
                            areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                            grade: selGrade,
                            section: selSection,
                            unitNumber,
                            sessionNumber,
                            bimester: bimesterLabel
                        })));
                        loadUnitInfo({ source: 'unit-prefill' });
                    }
                }
            };
            
            checkSavedSession();
        } else {
            sessionLoadRequestRef.current += 1;
            setSessionData(ensureSessionAssessmentModel(cloneInitialSessionData(), {
                areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
                grade: selGrade,
                section: selSection,
                unitNumber,
                sessionNumber,
                bimester: bimesterLabel
            }));
            setSessionDate('');
            setDateOptions([]);
            setMaxSessionsInUnit(15);
        }
    }, [selArea, selGrade, selSection, unitNumber, sessionNumber, year, assignments, allSavedPrograms]);

    const handleSave = async (options?: { silent?: boolean }) => {
        const silent = !!options?.silent;
        if (!selArea || !selGrade || !selSection) {
            if (!silent) setToast({ msg: 'Seleccione Area, Grado y Seccion.', type: 'warning' });
            return false;
        }

        
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        const syncedData = JSON.parse(JSON.stringify(sessionData));
        const pairs = [
            ['secuencia.inicio.saberes', 'secuencia.inicio.saberes_recursos'],
            ['secuencia.inicio.conflicto', 'secuencia.inicio.conflicto_recursos'],
            ['secuencia.proceso.construccion', 'secuencia.proceso.construccion_recursos'],
            ['secuencia.proceso.aplicacion', 'secuencia.proceso.aplicacion_recursos'],
            ['secuencia.proceso.metacognicion', 'secuencia.proceso.metacognicion_recursos'],
            ['secuencia.salida.evaluacion', 'secuencia.salida.evaluacion_recursos']
        ] as const;

        const getPath = (obj: any, path: string) => path.split('.').reduce((acc: any, key: string) => acc?.[key], obj);
        const setPath = (obj: any, path: string, value: string) => {
            const keys = path.split('.');
            let ptr = obj;
            for (let i = 0; i < keys.length - 1; i++) ptr = ptr[keys[i]];
            ptr[keys[keys.length - 1]] = value;
        };

        pairs.forEach(([activityPath, resourcePath]) => {
            const activity = String(getPath(syncedData, activityPath) || '');
            const resources = String(getPath(syncedData, resourcePath) || '');
            const customInstrument = String(syncedData?.competenciaPrio?.inst || '');
            const { updatedResources, changed } = syncResourcesFromActivity(activity, resources, customInstrument);
            if (changed) setPath(syncedData, resourcePath, updatedResources);
        });

        syncedData.assessmentModel = buildAssessmentModelFromData(syncedData, 'system');
        syncedData.sessionAssessmentModel = buildSessionAssessmentModel(syncedData, {
            areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            bimester: bimesterLabel
        });

        setSessionData(ensureSessionAssessmentModel(ensureAssessmentModel(syncedData, 'system'), {
            areaId: assignments.find(a => a.areaName === selArea)?.areaId || selArea,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            bimester: bimesterLabel
        }));
        const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
        
        const payload = {
            year,
            areaId,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            date: sessionDate,
            sessionData: {
                ...syncedData,
                date: sessionDate
            }
        };

        const res = await saveSesion(payload);
        if (res.success) {
            if (!silent) setToast({ msg: '✅ Sesión sincronizada correctamente en SQL.', type: 'success' });
            onSuccess();
            return true;
        } else {
            if (!silent) setToast({ msg: '❌ Error al guardar en SQL: ' + res.message, type: 'error' });
            return false;
        }
    };

    const handleOpenTemplateMode = async () => {
        const hasSessionContext = !!(selArea && selGrade && selSection && unitNumber && sessionNumber);
        if (hasSessionContext) {
            const saved = await handleSave({ silent: true });
            if (!saved) {
                setToast({ msg: '❌ No se pudo sincronizar la sesión actual antes de abrir la exportación Word.', type: 'error' });
                return;
            }
            setToast({ msg: '✅ Sesión actual sincronizada antes de exportar Word.', type: 'success' });
        }
        setShowTemplateMode(true);
    };

    const handleRestoreTemplate = () => {
        if (confirm("¿Estás seguro de restaurar el contenido de la secuencia a la plantilla por defecto? Se sobrescribirá lo actual.")) {
            let evaluacionFinal = DEFAULT_SEQUENCE_TEMPLATE.evaluacion;
            const grado = selGrade || "1°";
            const seccion = selSection || "Única";
            const gradoSeccion = `${grado}° ${seccion}`.trim();
            const unidad = unitNumber || "1";
            const sesion = sessionNumber || "1";
            const bimestre = bimesterLabel;
            const instrumento = sessionData?.competenciaPrio?.inst?.trim() || "Guía de observación";
            
            evaluacionFinal = evaluacionFinal.replace("[INSTRUMENTO]", instrumento);
            
            let aplicacionFinal = DEFAULT_SEQUENCE_TEMPLATE.aplicacion
            .replace("[GRADO_SECCION]", gradoSeccion)
            .replace("[BIMESTRE]", `BIM ${bimestre}`)
            .replace("[UNIDAD]", unidad)
            .replace("[SESION]", sesion)
            .replace("[INSTRUMENTO]", instrumento);

            setSessionData((prev: any) => ({
                ...prev,
                secuencia: {
                    ...prev.secuencia,
                    inicio: {
                        ...prev.secuencia.inicio,
                        saberes: DEFAULT_SEQUENCE_TEMPLATE.saberes,
                        saberes_recursos: DEFAULT_SEQUENCE_TEMPLATE.saberes_recursos,
                        conflicto: DEFAULT_SEQUENCE_TEMPLATE.conflicto,
                        conflicto_recursos: DEFAULT_SEQUENCE_TEMPLATE.conflicto_recursos,
                    },
                    proceso: {
                        ...prev.secuencia.proceso,
                        construccion: DEFAULT_SEQUENCE_TEMPLATE.construccion,
                        construccion_recursos: DEFAULT_SEQUENCE_TEMPLATE.construccion_recursos,
                        aplicacion: aplicacionFinal,
                        aplicacion_recursos: DEFAULT_SEQUENCE_TEMPLATE.aplicacion_recursos,
                        metacognicion: DEFAULT_SEQUENCE_TEMPLATE.metacognicion,
                        metacognicion_recursos: DEFAULT_SEQUENCE_TEMPLATE.metacognicion_recursos,
                    },
                    salida: {
                        ...prev.secuencia.salida,
                        evaluacion: evaluacionFinal,
                        evaluacion_recursos: DEFAULT_SEQUENCE_TEMPLATE.evaluacion_recursos,
                    }
                }
            }));
            setToast({ msg: "Plantilla restaurada correctamente", type: "success" });
        }
    };

    const handleFillExtensionDefaults = () => {
        handleInputChange('extension', DEFAULT_EXTENSION_ACTIVITIES);
        setToast({ msg: '✅ Actividades de extensión sugeridas cargadas.', type: 'success' });
    };

    const handleFillResourceDefaults = () => {
        const resourceFields = currentProgram?.resourceFields || {};
        const defaults = buildSessionResourceDefaults(sessionData, resourceFields);

        if (!defaults.rec && !defaults.med && !defaults.mat && !defaults.esp && !defaults.soft) {
            setToast({ msg: '⚠️ La programación anual no tiene recursos cargados para usar como base.', type: 'warning' });
            return;
        }

        setSessionData((prev: any) => ensureSessionExtraBlocks({
            ...prev,
            recursos: {
                ...prev?.recursos,
                rec: defaults.rec,
                med: defaults.med,
                mat: defaults.mat,
                soft: defaults.soft,
                esp: defaults.esp
            }
        }));
        setToast({ msg: '✅ Recursos sugeridos cargados con base anual y detecciones dinámicas de la sesión.', type: 'success' });
    };

    const handleFillBibliographyDefaults = () => {
        const bibliographyFields = currentProgram?.bibliographyFields || {};
        if (!bibliographyFields.referencias && !bibliographyFields.linkografia) {
            setToast({ msg: '⚠️ La programación anual no tiene bibliografía o linkografía cargada.', type: 'warning' });
            return;
        }

        setSessionData((prev: any) => ensureSessionExtraBlocks({
            ...prev,
            bibliografia: {
                ...prev?.bibliografia,
                bib: String(bibliographyFields.referencias || ''),
                link: String(bibliographyFields.linkografia || '')
            }
        }));
        setToast({ msg: '✅ Bibliografía y linkografía sugeridas cargadas.', type: 'success' });
    };

    const handleOpenManager = async () => {
        const sessions = await getAllSesiones();
        setAllSavedSessionsList(Object.values(sessions));
        setIsManageModalOpen(true);
    };

    const getGradingKey = (studentId: string | number, criteriaId: string | number) => `${studentId}::${criteriaId}`;

    const updateGradingRecord = (studentId: string | number, criteriaId: string | number, patch: Partial<{ level: string; observation: string }>) => {
        const key = getGradingKey(studentId, criteriaId);
        setGradingRecords(prev => ({
            ...prev,
            [key]: {
                level: patch.level ?? prev[key]?.level ?? '',
                observation: patch.observation ?? prev[key]?.observation ?? ''
            }
        }));
    };

    const serializeGradingRecords = useCallback((records: Record<string, { level: string; observation: string }>) =>
        JSON.stringify(
            Object.keys(records)
                .sort()
                .map((key) => [key, String(records[key]?.level || ''), String(records[key]?.observation || '')])
        )
    , []);

    const handleSaveGrading = async (options?: { silent?: boolean }) => {
        const silent = !!options?.silent;
        if (!currentSessionId || !currentUnitId) {
            if (!silent) setToast({ msg: 'Seleccione una sesión válida para guardar la calificación.', type: 'warning' });
            return false;
        }
        if (!gradingCriteriaRows.length || !gradingStudents.length) {
            if (!silent) setToast({ msg: 'No hay estudiantes o criterios disponibles para guardar.', type: 'warning' });
            return false;
        }

        const instrumentId = sessionData?.instrumentoTemplate?.id || null;
        const summaryRecordIds = gradingSessionGroups.groups.map((competency: any) =>
            `summary::${String(competency.source || 'primary')}::${normalizeLoose(String(competency.name || ''))}`
        );
        const records = [
            ...gradingStudents.flatMap((student) =>
            gradingCriteriaRows.map((criterion: any) => {
                const key = getGradingKey(student.id, criterion.id);
                const current = gradingRecords[key] || { level: '', observation: '' };
                return {
                    student_id: String(student.id),
                    session_id: currentSessionId,
                    unit_id: currentUnitId,
                    instrument_id: instrumentId,
                    criteria_id: String(criterion.id),
                    level: String(current.level || ''),
                    observation: String(current.observation || '')
                };
            })
            ),
            ...gradingStudents.flatMap((student) =>
                summaryRecordIds.map((criteriaId) => {
                    const key = getGradingKey(student.id, criteriaId);
                    const current = gradingRecords[key] || { level: '', observation: '' };
                    return {
                        student_id: String(student.id),
                        session_id: currentSessionId,
                        unit_id: currentUnitId,
                        instrument_id: instrumentId,
                        criteria_id: String(criteriaId),
                        level: '',
                        observation: String(current.observation || '')
                    };
                })
            )
        ];

        if (!silent) setGradingSaving(true);
        try {
            const res = await saveEvaluacionRegistros({ records });
            if (!res.success) {
                if (!silent) setToast({ msg: `No se pudo guardar la calificación: ${res.message || 'error'}`, type: 'error' });
                return false;
            }
            if (!silent) setToast({ msg: 'Calificación guardada correctamente.', type: 'success' });
            return true;
        } finally {
            if (!silent) setGradingSaving(false);
        }
    };

    const handleLoadSpecific = (s: any) => {
        setSelArea(assignments.find(a => a.areaId === s.areaId)?.areaName || s.areaId);
        setSelGrade(s.grade);
        setSelSection(s.section);
        setUnitNumber(s.unitNumber);
        setSessionNumber(s.sessionNumber);
        setYear(s.year);
        setIsManageModalOpen(false);
        if (s.date) {
            setSessionDate(s.date);
            setDateOptions([]);
        }
    };

    const handleDeleteSession = async (id: string) => {
        if (confirm("¿Eliminar permanentemente esta sesión de la base de datos?")) {
            const res = await deleteSesion(id);
            if (res.success) {
                setAllSavedSessionsList(prev => prev.filter(s => s.id !== id));
                setToast({ msg: "Sesión eliminada", type: 'success' });
            }
        }
    };

    const dynamicHoursLabel = useMemo(() => {
        if (!selArea || !selGrade || !selSection) return "-----";
        
        const datesToProcess = dateOptions.length > 0 
            ? dateOptions.map(d => d.value) 
            : (sessionDate ? [sessionDate] : []);
            
        if (datesToProcess.length === 0) return "-----";

        const savedSchedule = localStorage.getItem('armi_schedule_entries');
        const savedConfig = localStorage.getItem('armi_schedule_config');
        if (!savedSchedule) return "-----";
        
        try {
            const scheduleEntries: ScheduleEntry[] = JSON.parse(savedSchedule);
            const scheduleConfig: ScheduleConfig = savedConfig ? JSON.parse(savedConfig) : { breaks: [] } as any;
            const breaks = scheduleConfig.breaks || [];
            const sectionsToCalculate = selSection.split(/, | y /).map(s => s.trim().toUpperCase());
            const dayNames = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
            
            const allBlocks: string[] = [];

            datesToProcess.forEach(dStr => {
                if (!dStr) return;
                const dObj = new Date(dStr + 'T00:00:00');
                if (isNaN(dObj.getTime())) return;
                
                const dayText = dayNames[dObj.getDay()];
                sectionsToCalculate.forEach(sec => {
                    const sectionEntries = scheduleEntries.filter(e => 
                        e.day.toUpperCase() === dayText && 
                        e.grade.toLowerCase() === selGrade.toLowerCase() && 
                        String(e.section).toUpperCase() === sec && 
                        (e.areaName.toLowerCase() === selArea.toLowerCase() || e.areaId === selArea)
                    ).sort((a, b) => a.hourIndex - b.hourIndex);

                    if (sectionEntries.length > 0) {
                        const sessionBlocks: number[] = [];
                        let currentSize = 0;
                        for (let i = 0; i < sectionEntries.length; i++) {
                            currentSize++;
                            const current = sectionEntries[i];
                            const next = sectionEntries[i + 1];
                            const hasBreakAfter = breaks.some(b => b.afterHour === current.hourIndex);
                            const isNextConsecutive = next && next.hourIndex === current.hourIndex + 1;
                            if (!isNextConsecutive || hasBreakAfter) {
                                sessionBlocks.push(currentSize);
                                currentSize = 0;
                            }
                        }
                        sessionBlocks.forEach(h => {
                            allBlocks.push(`${h}h (${h * 45} min)`);
                        });
                    }
                });
            });

            const uniqueBlocks = Array.from(new Set(allBlocks)).sort();
            if (uniqueBlocks.length === 0) return "-----";
            return uniqueBlocks.join(' - ');
        } catch (e) { return "-----"; }
    }, [selArea, selGrade, selSection, sessionDate, dateOptions]);

    const visibleTransRows = useMemo(() => {
        const rows = Array.isArray(sessionData?.competenciasTrans) ? sessionData.competenciasTrans : [];
        return rows
        .map((ct: any, originalIdx: number) => ({ ct, originalIdx }))
        .filter(({ ct }: { ct: any; originalIdx: number }) => {
            const hasCap = normalizeLoose(String(ct?.cap || '')).length > 0;
            const hasDes = isMeaningfulRichText(String(ct?.des || ''));
            const hasEvidence = isMeaningfulRichText(String(ct?.evidence || ''));
            const hasInst = normalizeLoose(String(ct?.inst || '')).length > 0;
            return hasCap || hasDes || hasEvidence || hasInst;
        });
    }, [sessionData?.competenciasTrans]);

    const tiempoValues = useMemo(() => {
        const minuteMatches = Array.from(String(dynamicHoursLabel || '').matchAll(/\((\d+)\s*min\)/gi));
        const mins = minuteMatches
            .map(m => parseInt(m[1], 10))
            .filter(n => Number.isFinite(n) && !!MINUTE_DISTRIBUTIONS[n]);

        const unique = Array.from(new Set(mins));
        const low = unique.length ? Math.min(...unique) : 90;
        const high = unique.length ? Math.max(...unique) : 90;
        const lowDist = MINUTE_DISTRIBUTIONS[low] || MINUTE_DISTRIBUTIONS[90];
        const highDist = MINUTE_DISTRIBUTIONS[high] || MINUTE_DISTRIBUTIONS[90];

        if (low === high) return lowDist.map(v => `${v}'`);
        return lowDist.map((v, idx) => {
            const h = highDist[idx] ?? v;
            const min = Math.min(v, h);
            const max = Math.max(v, h);
            return `${min}'-${max}'`;
        });
    }, [dynamicHoursLabel]);

    const currentAreaId = useMemo(
        () => assignments.find(a => a.areaName === selArea)?.areaId || selArea,
        [assignments, selArea]
    );

    const currentSessionId = useMemo(() => {
        if (!(year && currentAreaId && selGrade && selSection && unitNumber && sessionNumber)) return '';
        return `${year}-${currentAreaId}-${selGrade}-${selSection}-U${unitNumber}-S${sessionNumber}`;
    }, [year, currentAreaId, selGrade, selSection, unitNumber, sessionNumber]);

    const currentUnitId = useMemo(() => {
        if (!(year && currentAreaId && selGrade && selSection && unitNumber)) return '';
        return `${year}-${currentAreaId}-${selGrade}-${selSection}-U${unitNumber}`;
    }, [year, currentAreaId, selGrade, selSection, unitNumber]);

    const gradingSections = useMemo(() => {
        return String(selSection || '')
            .split(/,| y /)
            .map(section => section.trim())
            .filter(Boolean);
    }, [selSection]);

    useEffect(() => {
        if (!gradingSections.length) {
            setActiveGradingSection('');
            return;
        }
        setActiveGradingSection(prev => (prev && gradingSections.includes(prev) ? prev : gradingSections[0]));
    }, [gradingSections]);

    const gradingStudents = useMemo(() => {
        const gradeNorm = normalizeLoose(selGrade);
        const sectionSet = new Set(gradingSections.map(section => normalizeLoose(section)));
        return (students || [])
            .filter((student) =>
                normalizeLoose(student.grade) === gradeNorm
                && sectionSet.has(normalizeLoose(student.section))
            )
            .sort((a, b) =>
                String(a.section || '').localeCompare(String(b.section || ''))
                || String(a.name || '').localeCompare(String(b.name || ''))
            );
    }, [students, selGrade, gradingSections]);

    const assessmentTemplateModel = useMemo(() => {
        const rows = Array.isArray(sessionAssessmentModel?.rows) ? sessionAssessmentModel.rows : [];
        const capacidades = Array.from(new Set(rows.map((row: any) => String(row?.capacityName || '').trim()).filter(Boolean)));
        const criterios = rows
            .map((row: any, idx: number) => ({
                id: String(row?.id || `criterion-${idx + 1}`),
                competencia: String(row?.competencyName || '').trim(),
                text: String(row?.criterionText || '').trim(),
                capacidad: String(row?.capacityName || '').trim(),
                source: String(row?.source || 'primary').trim(),
                rowType: String(row?.rowType || 'criterion').trim(),
                levelDescriptors: row?.levelDescriptors && typeof row.levelDescriptors === 'object'
                    ? {
                        c: String(row.levelDescriptors.c || '').trim(),
                        b: String(row.levelDescriptors.b || '').trim(),
                        a: String(row.levelDescriptors.a || '').trim(),
                        ad: String(row.levelDescriptors.ad || '').trim()
                    }
                    : undefined
            }))
            .filter((row: any) => row.text);
        return {
            competencia: String(sessionAssessmentModel?.competency?.name || '').trim(),
            capacidades,
            criterios,
            rows
        };
    }, [sessionAssessmentModel]);

    const canonicalInstrumentRows = useMemo(() => {
        return buildSessionInstrumentRows(
            sessionData?.instrumentoTemplate,
            sessionAssessmentModel,
            Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : []
        );
    }, [sessionData?.instrumentoTemplate, sessionData?.instrumento, sessionAssessmentModel]);

    const rubricRowMode = useMemo(() => {
        const explicit = String(sessionData?.rubricaRowMode || '').trim();
        if (explicit === 'capacity' || explicit === 'criterion') return explicit;
        const rows = Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : [];
        const capacityRows = rows.filter((row: any) => String(row?.rowType || '').trim() === 'capacity').length;
        return capacityRows > 0 ? 'capacity' : 'criterion';
    }, [sessionData?.rubricaRowMode, sessionData?.instrumento]);

    const rubricAutoRowsByMode = useMemo(() => {
        const rows = Array.isArray(sessionAssessmentModel?.rows) ? sessionAssessmentModel.rows : [];
        const orderedRows = rows
            .filter((row: any) => !!normalizeLoose(String(row?.criterionText || row?.capacityName || row?.competencyName || '')))
            .slice()
            .sort((a: any, b: any) => Number(a?.order || 0) - Number(b?.order || 0));

        const currentRows = Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : [];
        const makeDescriptors = (row: any, fallback: any = {}) => ({
            c: String(row?.c || row?.levelDescriptors?.c || fallback?.c || '').trim(),
            b: String(row?.b || row?.levelDescriptors?.b || fallback?.b || '').trim(),
            a: String(row?.a || row?.levelDescriptors?.a || fallback?.a || '').trim(),
            ad: String(row?.ad || row?.levelDescriptors?.ad || fallback?.ad || '').trim()
        });

        const criterionRows = orderedRows.map((row: any, idx: number) => {
            const fallback = currentRows[idx] || {};
            return {
                id: String(fallback?.id || row?.id || idx + 1),
                rowType: 'criterion',
                source: String(row?.source || 'primary').trim(),
                competencia: String(row?.competencyName || '').trim(),
                capacidad: String(row?.capacityName || '').trim(),
                criterio: String(row?.criterionText || '').trim(),
                ...makeDescriptors(row, fallback)
            };
        });

        const seenCapKeys = new Set<string>();
        const capacityRows = orderedRows.reduce((acc: any[], row: any) => {
            const competencia = String(row?.competencyName || '').trim();
            const capacidad = String(row?.capacityName || '').trim();
            const source = String(row?.source || 'primary').trim();
            const key = `${normalizeLoose(competencia)}::${normalizeLoose(capacidad)}::${source}`;
            if (!capacidad || seenCapKeys.has(key)) return acc;
            seenCapKeys.add(key);
            const fallback = currentRows.find((item: any) =>
                String(item?.rowType || '').trim() === 'capacity'
                && normalizeLoose(String(item?.criterio || '')) === normalizeLoose(capacidad)
                && normalizeLoose(String(item?.competencia || '')) === normalizeLoose(competencia)
            ) || {};
            acc.push({
                id: String(fallback?.id || row?.id || acc.length + 1),
                rowType: 'capacity',
                source,
                competencia,
                capacidad,
                criterio: capacidad,
                c: '',
                b: '',
                a: '',
                ad: ''
            });
            return acc;
        }, []);

        return {
            criterion: criterionRows,
            capacity: capacityRows
        };
    }, [sessionAssessmentModel, sessionData?.instrumento]);

    const filteredStudents = useMemo(() => {
        const activeSectionNorm = normalizeLoose(activeGradingSection || gradingSections[0] || '');
        if (!activeSectionNorm) return gradingStudents;
        return gradingStudents.filter((student) => normalizeLoose(student.section) === activeSectionNorm);
    }, [gradingStudents, activeGradingSection, gradingSections]);

    const gradingCriteriaRows = useMemo(() => {
        return canonicalInstrumentRows
            .map((row: any, idx: number) => ({
                id: String(row?.id || idx + 1),
                competencia: String(row?.competencia || row?.comp || '').trim(),
                capacidad: String(row?.capacidad || row?.cap || '').trim(),
                criterio: String(row?.criterio || '').trim(),
                source: String(row?.source || 'primary').trim(),
                rowType: String(row?.rowType || 'criterion').trim(),
                c: String(row?.c || '').trim(),
                b: String(row?.b || '').trim(),
                a: String(row?.a || '').trim(),
                ad: String(row?.ad || '').trim()
            }))
            .filter((row: any) => row.criterio.length > 0);
    }, [canonicalInstrumentRows]);

    const gradingChecklistOptionPreset = useMemo(() => {
        const expectedLabel = sessionData?.instrumentoTemplate?.structure?.expectedLabel;
        if (expectedLabel && typeof expectedLabel === 'object' && String(expectedLabel.mode || '').trim().toLowerCase() === 'custom') {
            return {
                positive: String(expectedLabel.positive || 'Opción 1').trim() || 'Opción 1',
                negative: String(expectedLabel.negative || 'Opción 2').trim() || 'Opción 2'
            };
        }
        const raw = String(expectedLabel || '').trim().toLowerCase();
        if (raw === 'cumple_no_cumple') return { positive: 'Cumple', negative: 'No cumple' };
        if (raw === 'logrado_no_logrado') return { positive: 'Logrado', negative: 'No logrado' };
        return { positive: 'Sí', negative: 'No' };
    }, [sessionData?.instrumentoTemplate]);

    const checklistLevelMapping = useMemo(() => ({
        positiveLabel: gradingChecklistOptionPreset.positive,
        negativeLabel: gradingChecklistOptionPreset.negative,
        positiveLevel: 'a',
        negativeLevel: 'c'
    }), [gradingChecklistOptionPreset]);

    const gradingRubricaLevels = useMemo(() => {
        const levels = Array.isArray(sessionData?.instrumentoTemplate?.structure?.levels)
            ? sessionData.instrumentoTemplate.structure.levels
            : [];
        const fallback = [
            { id: 'c', label: 'Inicio', color: 'text-rose-700 border-rose-200 bg-rose-50' },
            { id: 'b', label: 'Proceso', color: 'text-orange-700 border-orange-200 bg-orange-50' },
            { id: 'a', label: 'Logrado', color: 'text-sky-700 border-sky-200 bg-sky-50' },
            { id: 'ad', label: 'Destacado', color: 'text-emerald-700 border-emerald-200 bg-emerald-50' }
        ];
        const source = levels.length ? levels : fallback;
        return source.map((level: any, idx: number) => ({
            id: String(level?.id || fallback[idx]?.id || `nivel_${idx + 1}`),
            label: String(level?.label || fallback[idx]?.label || `Nivel ${idx + 1}`),
            color: fallback[idx]?.color || 'text-slate-700 border-slate-200 bg-slate-50'
        }));
    }, [sessionData?.instrumentoTemplate]);

    const gradingGuideLevels = useMemo(() => ([
        { id: 'c', label: 'C', color: 'text-rose-700 border-rose-200 bg-rose-50' },
        { id: 'b', label: 'B', color: 'text-orange-700 border-orange-200 bg-orange-50' },
        { id: 'a', label: 'A', color: 'text-sky-700 border-sky-200 bg-sky-50' },
        { id: 'ad', label: 'AD', color: 'text-emerald-700 border-emerald-200 bg-emerald-50' }
    ]), []);

    const gradingCanonicalLevels = useMemo(() => ([
        { id: 'c', label: 'Inicio', short: 'C', color: 'bg-rose-600 text-white border-rose-500' },
        { id: 'b', label: 'Proceso', short: 'B', color: 'bg-orange-500 text-white border-orange-500' },
        { id: 'a', label: 'Logrado', short: 'A', color: 'bg-emerald-500 text-white border-emerald-500' },
        { id: 'ad', label: 'Destacado', short: 'AD', color: 'bg-sky-500 text-white border-sky-500' }
    ]), []);

    const normalizeGradingLevelToCode = useCallback((rawLevel: any) => {
        const level = String(rawLevel || '').trim();
        const levelNorm = normalizeLoose(level);
        if (!levelNorm) return '';
        if (['c', 'b', 'a', 'ad'].includes(levelNorm)) return levelNorm;
        if (levelNorm === normalizeLoose(gradingChecklistOptionPreset.positive)) return 'a';
        if (levelNorm === normalizeLoose(gradingChecklistOptionPreset.negative)) return 'c';
        const rubricMatch = gradingRubricaLevels.find((item: any) => normalizeLoose(item.label) === levelNorm || normalizeLoose(item.id) === levelNorm);
        if (rubricMatch) return String(rubricMatch.id || '').trim().toLowerCase();
        const guideMatch = gradingGuideLevels.find((item) => normalizeLoose(item.label) === levelNorm || normalizeLoose(item.id) === levelNorm);
        if (guideMatch) return String(guideMatch.id || '').trim().toLowerCase();
        if (levelNorm === 'inicio') return 'c';
        if (levelNorm === 'proceso') return 'b';
        if (levelNorm === 'logrado') return 'a';
        if (levelNorm === 'destacado') return 'ad';
        return '';
    }, [gradingChecklistOptionPreset, gradingRubricaLevels, gradingGuideLevels]);

    const gradingCodeToStoredLevel = useCallback((code: string) => {
        const norm = String(code || '').trim().toLowerCase();
        if (norm === 'c') return 'Inicio';
        if (norm === 'b') return 'Proceso';
        if (norm === 'a') return 'Logrado';
        if (norm === 'ad') return 'Destacado';
        return '';
    }, []);

    const gradingSessionGroups = useMemo(() => {
        const groups = gradingCriteriaRows.reduce((acc: any[], row: any) => {
            const competencia = String(row?.competencia || 'Competencia').trim() || 'Competencia';
            const capacidad = String(row?.capacidad || 'Capacidad').trim() || 'Capacidad';
            const source = String(row?.source || 'primary').trim() || 'primary';
            let compGroup = acc.find((item: any) => normalizeLoose(item.name) === normalizeLoose(competencia) && item.source === source);
            if (!compGroup) {
                compGroup = { name: competencia, source, capacities: [] as any[] };
                acc.push(compGroup);
            }
            let capGroup = compGroup.capacities.find((item: any) => normalizeLoose(item.name) === normalizeLoose(capacidad) && item.source === source);
            if (!capGroup) {
                capGroup = { name: capacidad, source, criteria: [] as any[] };
                compGroup.capacities.push(capGroup);
            }
            capGroup.criteria.push(row);
            return acc;
        }, []);

        let globalCriterionIndex = 0;
        const criterionBlocks = groups.flatMap((competency: any) =>
            competency.capacities.flatMap((capacity: any) =>
                capacity.criteria.map((criterion: any) => {
                    globalCriterionIndex += 1;
                    return {
                        code: `C${globalCriterionIndex}`,
                        competencia: competency.name,
                        capacidad: capacity.name,
                        source: competency.source,
                        criterion
                    };
                })
            )
        );

        return { groups, criterionBlocks };
    }, [gradingCriteriaRows]);

    const renderGradingSectionTabs = () => {
        if (gradingSections.length <= 1) return null;
        return (
            <div className="flex flex-wrap gap-2">
                {gradingSections.map((section) => {
                    const isActive = section === activeGradingSection;
                    const sectionCount = gradingStudents.filter(student => normalizeLoose(student.section) === normalizeLoose(section)).length;
                    return (
                        <button
                            key={`grading-section-${section}`}
                            type="button"
                            onClick={() => setActiveGradingSection(section)}
                            className={`px-4 py-2 rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${isActive ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                        >
                            {section} · {sectionCount} est.
                        </button>
                    );
                })}
            </div>
        );
    };

    useEffect(() => {
        if (sessionMode !== 'calificacion' || !currentSessionId) {
            setGradingRecords({});
            gradingAutosaveRef.current = { initialized: false, lastSaved: '', saving: false };
            return;
        }
        let cancelled = false;
        const loadGradingRecords = async () => {
            setGradingLoading(true);
            try {
                const res = await getEvaluacionRegistros({ sessionId: currentSessionId });
                if (cancelled) return;
                if (!res.success) {
                    setGradingRecords({});
                    setToast({ msg: `No se pudieron cargar registros de calificación: ${res.message || 'error'}`, type: 'error' });
                    return;
                }
                const nextRecords: Record<string, { level: string; observation: string }> = {};
                (res.data || []).forEach((record: any) => {
                    nextRecords[`${record.student_id}::${record.criteria_id}`] = {
                        level: String(record.level || ''),
                        observation: String(record.observation || '')
                    };
                });
                gradingAutosaveRef.current = {
                    initialized: true,
                    lastSaved: serializeGradingRecords(nextRecords),
                    saving: false
                };
                setGradingRecords(nextRecords);
            } finally {
                if (!cancelled) setGradingLoading(false);
            }
        };
        loadGradingRecords();
        return () => { cancelled = true; };
    }, [sessionMode, currentSessionId, serializeGradingRecords]);

    useEffect(() => {
        if (sessionMode !== 'calificacion' || !currentSessionId || gradingLoading) return;
        const snapshot = serializeGradingRecords(gradingRecords);
        if (!gradingAutosaveRef.current.initialized) {
            gradingAutosaveRef.current = { initialized: true, lastSaved: snapshot, saving: false };
            return;
        }
        if (snapshot === gradingAutosaveRef.current.lastSaved || gradingAutosaveRef.current.saving) return;
        const timeout = window.setTimeout(async () => {
            gradingAutosaveRef.current = { ...gradingAutosaveRef.current, saving: true, lastSaved: snapshot };
            const ok = await handleSaveGrading({ silent: true });
            if (ok) {
                gradingAutosaveRef.current = { initialized: true, lastSaved: snapshot, saving: false };
            } else {
                gradingAutosaveRef.current = { ...gradingAutosaveRef.current, saving: false };
            }
        }, 900);
        return () => window.clearTimeout(timeout);
    }, [gradingRecords, sessionMode, currentSessionId, gradingLoading, serializeGradingRecords]);

    const renderInstrumentTemplateTable = () => {
        const template = sessionData?.instrumentoTemplate;
        const layout = template?.structure?.layout;
        const templateType = String(
            detectInstrumentTypeFromText(String(template?.type || ''))
            || detectInstrumentTypeFromText(String(template?.name || ''))
            || template?.type
            || ''
        );
        const instrumentRows = canonicalInstrumentRows;
        const desiredCriteriaCount = Math.max(4, instrumentRows.length);
        const textOverrides = buildTemplateTextOverridesFromRows(template, instrumentRows);
        const rows = Math.max(0, Number(layout?.rows || 0));
        const cols = Math.max(0, Number(layout?.cols || 0));
        if (!layout || rows <= 0 || cols <= 0) return null;

        const merges = Array.isArray(layout?.merges) ? layout.merges : [];
        const texts = layout?.texts && typeof layout.texts === 'object' ? layout.texts : {};
        const styles = layout?.styles && typeof layout.styles === 'object' ? layout.styles : {};

        const getMergeAtOrigin = (r: number, c: number) =>
            merges.find((m: any) => Number(m?.sr) === r && Number(m?.sc) === c);
        const isCoveredByOtherMerge = (r: number, c: number) =>
            merges.some((m: any) =>
                Number.isFinite(Number(m?.sr)) &&
                Number.isFinite(Number(m?.sc)) &&
                Number.isFinite(Number(m?.er)) &&
                Number.isFinite(Number(m?.ec)) &&
                r >= Number(m.sr) && r <= Number(m.er) &&
                c >= Number(m.sc) && c <= Number(m.ec) &&
                !(r === Number(m.sr) && c === Number(m.sc))
            );

        if (templateType === 'lista_cotejo') {
            const checklistLayout = layout || {};
            const checklistMerges = Array.isArray(checklistLayout?.merges) ? checklistLayout.merges : [];
            const checklistTexts = checklistLayout?.texts && typeof checklistLayout.texts === 'object' ? checklistLayout.texts : {};
            const checklistStyles = checklistLayout?.styles && typeof checklistLayout.styles === 'object' ? checklistLayout.styles : {};
            const checklistRows = buildChecklistVisualRowsForTemplate(template?.structure || {}, assessmentTemplateModel);
            const checklistExpectedLabel = template?.structure?.expectedLabel;
            const checklistOptionPreset = checklistExpectedLabel && typeof checklistExpectedLabel === 'object' && String(checklistExpectedLabel.mode || '').trim().toLowerCase() === 'custom'
                ? {
                    positive: String(checklistExpectedLabel.positive || 'Opción 1').trim() || 'Opción 1',
                    negative: String(checklistExpectedLabel.negative || 'Opción 2').trim() || 'Opción 2'
                }
                : String(checklistExpectedLabel || '').trim().toLowerCase() === 'cumple_no_cumple'
                    ? { positive: 'Cumple', negative: 'No cumple' }
                    : String(checklistExpectedLabel || '').trim().toLowerCase() === 'logrado_no_logrado'
                        ? { positive: 'Logrado', negative: 'No logrado' }
                        : { positive: 'Sí', negative: 'No' };

            const findChecklistMergeAt = (r: number, c: number) =>
                checklistMerges.find((m: any) => r >= Number(m?.sr) && r <= Number(m?.er) && c >= Number(m?.sc) && c <= Number(m?.ec));
            const isChecklistCovered = (r: number, c: number) => {
                const row = checklistRows[r - 1];
                if (row && row.kind !== 'crit' && c > 0) return true;
                const m = findChecklistMergeAt(r, c);
                return !!m && !(Number(m.sr) === r && Number(m.sc) === c);
            };

            const headerDefaults = ['N°', 'CRITERIOS OBSERVABLES', checklistOptionPreset.positive.toUpperCase(), checklistOptionPreset.negative.toUpperCase(), 'OBSERVACIONES'];
            let runningN = 1;
            let runningCriterionIndex = -1;
            const updateChecklistRow = (rowIndex: number, patch: Record<string, string>) => {
                const currentRows = Array.isArray(sessionData?.instrumento) ? [...sessionData.instrumento] : [];
                const current = currentRows[rowIndex] || { id: rowIndex + 1, criterio: '', c: '', b: '', a: '', ad: '' };
                currentRows[rowIndex] = { ...current, ...patch };
                handleInputChange('instrumento', currentRows);
            };

            return (
                <table className="w-full table-fixed border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '63%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '20%' }} />
                    </colgroup>
                    <thead>
                        <tr>
                            {Array.from({ length: 5 }).map((_, c) => {
                                const id = layoutCellId(0, c);
                                const cellStyle = checklistStyles[id] || {};
                                const text = String(textOverrides[id] || checklistTexts[id] || headerDefaults[c] || '');
                                const style = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...style,
                                    backgroundColor: !cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff' ? '#059669' : style.backgroundColor,
                                    color: !cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a' ? '#ffffff' : style.color
                                };
                                return (
                                    <th key={`check-head-${c}`} className="p-2 text-left font-black" style={resolvedStyle}>
                                        {text}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {checklistRows.map((row, idx) => {
                            const r = idx + 1;
                            const n = runningN;
                            if (row.kind === 'crit') runningN += 1;
                            if (row.kind === 'crit') runningCriterionIndex += 1;
                            const criterionIndex = row.kind === 'crit' ? runningCriterionIndex : -1;
                            const criterionRowData = criterionIndex >= 0
                                ? (instrumentRows[criterionIndex] || { id: criterionIndex + 1, criterio: row.text || '', c: '', b: '', a: '', ad: '' })
                                : null;
                            const isTransversalRow = String(row?.source || '').trim() === 'transversal';
                            const rowClassName = row.kind === 'comp'
                                ? (isTransversalRow ? 'bg-emerald-700/90 text-white' : 'bg-slate-200/90 text-slate-900')
                                : row.kind === 'cap'
                                    ? (isTransversalRow ? 'bg-emerald-100/70 text-emerald-950' : 'bg-slate-100/90 text-slate-800')
                                    : (isTransversalRow ? 'bg-emerald-50/40' : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'));
                            return (
                                <tr key={`check-row-${r}`} className={rowClassName}>
                                    {Array.from({ length: 5 }).map((_, c) => {
                                        if (isChecklistCovered(r, c)) return null;
                                        const id = layoutCellId(r, c);
                                        const cellStyle = checklistStyles[id] || {};
                                        const merge = findChecklistMergeAt(r, c);
                                        const rowSpan = merge && Number(merge.sr) === r && Number(merge.sc) === c ? Number(merge.er) - Number(merge.sr) + 1 : 1;
                                        const colSpan = row.kind !== 'crit'
                                            ? 5
                                            : (merge && Number(merge.sr) === r && Number(merge.sc) === c ? Number(merge.ec) - Number(merge.sc) + 1 : 1);

                                        let fallback = '';
                                        if (c === 0) fallback = row.kind === 'crit' ? String(n) : row.text;
                                        if (c === 1) fallback = row.text;
                                        if (c === 4 && row.kind === 'crit') fallback = '-';
                                        if (row.kind !== 'crit' && c === 0 && colSpan > 1 && !checklistTexts[id]) fallback = row.text;

                                        const value = String(checklistTexts[id] || fallback || '');
                                        const resolvedValue = row.kind === 'crit'
                                            ? c === 1
                                                ? String(criterionRowData?.criterio || fallback || '')
                                                : c === 4
                                                    ? String(criterionRowData?.ad || '')
                                                    : String(fallback || '')
                                            : String(textOverrides[id] || value || '');
                                        const orientation = String(cellStyle?.orientation || 'normal');
                                        const style = getTemplateCellStyle(cellStyle);
                                        const groupCellStyle: React.CSSProperties = row.kind === 'comp'
                                            ? {
                                                backgroundColor: isTransversalRow ? 'rgba(4, 120, 87, 0.88)' : 'rgba(148, 163, 184, 0.92)',
                                                color: isTransversalRow ? '#ffffff' : '#0f172a'
                                            }
                                            : row.kind === 'cap'
                                                ? {
                                                    backgroundColor: isTransversalRow ? 'rgba(209, 250, 229, 0.95)' : 'rgba(241, 245, 249, 0.96)',
                                                    color: isTransversalRow ? '#064e3b' : '#334155'
                                                }
                                                : {};

                                        return (
                                            <td key={`check-cell-${r}-${c}`} rowSpan={rowSpan} colSpan={colSpan} className="p-2" style={{ ...style, ...groupCellStyle }}>
                                                {row.kind === 'crit' && (c === 2 || c === 3)
                                                    ? (
                                                        <div className="flex items-center justify-center">
                                                            <input
                                                                type="checkbox"
                                                                className="h-4 w-4 accent-emerald-600"
                                                                checked={false}
                                                                readOnly
                                                                disabled
                                                                aria-label={`${checklistLevelMapping.positiveLabel} (${checklistLevelMapping.positiveLevel.toUpperCase()})`}
                                                            />
                                                        </div>
                                                    )
                                                    : row.kind === 'crit' && c === 4
                                                        ? (
                                                            <textarea
                                                                className="w-full min-h-[34px] resize-none border-0 bg-transparent p-1.5 outline-none text-[10px]"
                                                                value={resolvedValue}
                                                                onInput={e => autoResizeTextarea(e.currentTarget)}
                                                                onChange={e => {
                                                                    if (criterionIndex < 0) return;
                                                                    updateChecklistRow(criterionIndex, { ad: e.target.value });
                                                                }}
                                                                placeholder="Observaciones..."
                                                            />
                                                        )
                                                        : row.kind === 'crit' && c === 1
                                                            ? (
                                                                <textarea
                                                                    className="w-full min-h-[34px] resize-none border-0 bg-transparent p-1.5 outline-none text-[10px] font-medium"
                                                                    value={resolvedValue}
                                                                    onInput={e => autoResizeTextarea(e.currentTarget)}
                                                                    onChange={e => {
                                                                        if (criterionIndex < 0) return;
                                                                        updateChecklistRow(criterionIndex, { criterio: e.target.value });
                                                                    }}
                                                                    placeholder="Criterio..."
                                                                />
                                                            )
                                                    : (
                                                        <div
                                                            className={`whitespace-pre-wrap break-words leading-tight min-h-[18px] ${row.kind === 'comp' ? 'font-black uppercase tracking-wide text-left' : row.kind === 'cap' ? 'font-bold text-left' : ''}`}
                                                            style={{
                                                                ...getTemplateOrientationBoxStyle(orientation, resolvedValue),
                                                                ...getTemplateOrientationStyle(row.kind !== 'crit' ? 'normal' : orientation),
                                                                ...(row.kind !== 'crit' ? { textAlign: 'left', justifyContent: 'flex-start', alignItems: 'flex-start' } : {})
                                                            }}
                                                        >
                                                            {resolvedValue}
                                                        </div>
                                                    )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            );
        }

        if (templateType === 'escala_valoracion') {
            const scaleLayout = layout || {};
            const scaleStyles = scaleLayout?.styles && typeof scaleLayout.styles === 'object' ? scaleLayout.styles : {};
            const scaleLabels = getScaleLabelsForTemplate(template?.structure || {});
            const resolvedScaleLabels = scaleLabels.length > 0 ? scaleLabels : ['Deficiente', 'Regular', 'Bueno', 'Muy bueno'];
            const scaleBodyRows = buildScaleVisualRowsForTemplate(template?.structure || {}, assessmentTemplateModel);
            let runningCriterionIndex = -1;

            return (
                <table className="w-full table-fixed border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '38%' }} />
                        {resolvedScaleLabels.map((_: any, idx: number) => (
                            <col key={`scale-col-${idx}`} style={{ width: `${56 / Math.max(resolvedScaleLabels.length, 1)}%` }} />
                        ))}
                    </colgroup>
                    <tbody>
                        <tr>
                            {(() => {
                                const cellStyle = scaleStyles[layoutCellId(0, 0)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? '#0f172a' : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td rowSpan={2} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        N°
                                    </td>
                                );
                            })()}
                            {(() => {
                                const cellStyle = scaleStyles[layoutCellId(0, 1)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? '#0f172a' : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td rowSpan={2} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        CRITERIOS
                                    </td>
                                );
                            })()}
                            {(() => {
                                const cellStyle = scaleStyles[layoutCellId(0, 2)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? '#0f172a' : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td colSpan={resolvedScaleLabels.length} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        Niveles de logro
                                    </td>
                                );
                            })()}
                        </tr>
                        <tr>
                            {resolvedScaleLabels.map((label: string, idx: number) => {
                                const c = idx + 2;
                                const cellStyle = scaleStyles[layoutCellId(1, c)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const palette = ['#ef1c24', '#f77b28', '#28a745', '#19b8cf'];
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: (!cellStyle?.bg || String(cellStyle.bg).toLowerCase() === '#ffffff') ? (palette[idx] || '#0f172a') : baseStyle.backgroundColor,
                                    color: (!cellStyle?.color || String(cellStyle.color).toLowerCase() === '#0f172a') ? '#ffffff' : baseStyle.color,
                                    textAlign: 'center',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <td key={`scale-head-${idx}`} className="p-2 align-middle font-black" style={resolvedStyle}>
                                        {label}
                                    </td>
                                );
                            })}
                        </tr>
                        {scaleBodyRows.map((bodyRow, idx) => {
                            const r = idx + 2;
                            if (bodyRow.kind === 'comp' || bodyRow.kind === 'cap') {
                                const cellStyle = scaleStyles[layoutCellId(2, 0)] || {};
                                const baseStyle = getTemplateCellStyle(cellStyle);
                                const resolvedStyle: React.CSSProperties = {
                                    ...baseStyle,
                                    backgroundColor: bodyRow.kind === 'comp' ? '#e2e8f0' : '#f8fafc',
                                    color: '#0f172a',
                                    fontWeight: 700,
                                    textAlign: 'left',
                                    verticalAlign: 'middle'
                                };
                                return (
                                    <tr key={`scale-body-${r}`}>
                                        <td colSpan={resolvedScaleLabels.length + 2} className="p-2 align-middle" style={resolvedStyle}>
                                            {bodyRow.text}
                                        </td>
                                    </tr>
                                );
                            }

                            runningCriterionIndex += 1;
                            const criterionIndex = runningCriterionIndex;
                            const criterionRowData = instrumentRows[criterionIndex] || {
                                id: criterionIndex + 1,
                                criterio: bodyRow.text || '',
                                c: '',
                                b: '',
                                a: '',
                                ad: ''
                            };

                            return (
                                <tr key={`scale-body-${r}`}>
                                    <td className="p-2 text-center align-middle" style={getTemplateCellStyle(scaleStyles[layoutCellId(2, 0)] || {})}>
                                        {scaleBodyRows
                                            .slice(0, idx)
                                            .filter((item: any) => item.kind === 'crit' && item.comp === bodyRow.comp && item.cap === bodyRow.cap).length + 1}
                                    </td>
                                    <td className="p-2 align-middle" style={{ ...getTemplateCellStyle(scaleStyles[layoutCellId(2, 1)] || {}), textAlign: 'left' }}>
                                        <textarea
                                            className="w-full min-h-[34px] resize-none border-0 bg-transparent p-1.5 outline-none text-[10px] font-medium"
                                            value={String(criterionRowData?.criterio || bodyRow.text || '')}
                                            onInput={e => autoResizeTextarea(e.currentTarget)}
                                            onChange={e => {
                                                const currentRows = Array.isArray(sessionData?.instrumento) ? [...sessionData.instrumento] : [];
                                                const current = currentRows[criterionIndex] || { id: criterionIndex + 1, criterio: '', c: '', b: '', a: '', ad: '' };
                                                currentRows[criterionIndex] = { ...current, criterio: e.target.value };
                                                handleInputChange('instrumento', currentRows);
                                            }}
                                            placeholder="Criterio..."
                                        />
                                    </td>
                                    {resolvedScaleLabels.map((_: any, idxLabel: number) => (
                                        <td
                                            key={`scale-crit-${criterionIndex}-${idxLabel}`}
                                            className="p-2 align-middle"
                                            style={getTemplateCellStyle(scaleStyles[layoutCellId(2, idxLabel + 2)] || {})}
                                        />
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            );
        }

        if (templateType === 'rubrica') {
            const updateRubricaRow = (rowIndex: number, patch: Record<string, string>) => {
                const currentRows = Array.isArray(sessionData?.instrumento) ? [...sessionData.instrumento] : [];
                const current = currentRows[rowIndex] || { id: rowIndex + 1, criterio: '', c: '', b: '', a: '', ad: '' };
                currentRows[rowIndex] = { ...current, ...patch, id: rowIndex + 1 };
                handleInputChange('instrumento', currentRows);
            };

            const rubricRows = instrumentRows.length > 0
                ? instrumentRows
                : Array.from({ length: 4 }, (_, idx) => ({ id: idx + 1, criterio: '', c: '', b: '', a: '', ad: '' }));

            return (
                <table className="w-full table-fixed border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '19%' }} />
                        <col style={{ width: '18.25%' }} />
                        <col style={{ width: '18.25%' }} />
                        <col style={{ width: '18.25%' }} />
                        <col style={{ width: '18.25%' }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th className="border border-white/10 bg-slate-900 p-3 text-center font-black text-white">N°</th>
                            <th className="border border-white/10 bg-slate-900 p-3 text-center font-black text-white">CRITERIO</th>
                            <th className="border border-white/10 bg-red-600 p-3 text-center font-black text-white">C (INICIO)</th>
                            <th className="border border-white/10 bg-orange-500 p-3 text-center font-black text-white">B (EN PROCESO)</th>
                            <th className="border border-white/10 bg-cyan-500 p-3 text-center font-black text-white">A (LOGRADO)</th>
                            <th className="border border-white/10 bg-emerald-500 p-3 text-center font-black text-white">AD (DESTACADO)</th>
                        </tr>
                    </thead>
                        <tbody>
                        {rubricRows.map((row: any, idx: number) => {
                            const isTransversal = String(row?.source || '') === 'transversal';
                            const transversalColor = String(row?.rowColor || '#00b28c');
                            const rowSurfaceStyle = isTransversal ? getTransversalSurfaceStyle(transversalColor, 0.12) : undefined;
                            return (
                            <tr key={`rubrica-template-row-${idx}`} className="align-top">
                                <td className="border border-slate-200 bg-slate-50/50 p-3 text-center font-black text-slate-700" style={rowSurfaceStyle}>
                                    {idx + 1}
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-center text-[10px] font-bold text-slate-800 outline-none"
                                        value={String(row?.criterio || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { criterio: e.target.value })}
                                        placeholder="Defina criterio..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-red-600 outline-none"
                                        value={String(row?.c || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { c: e.target.value })}
                                        placeholder="Descriptor inicio..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-orange-700 outline-none"
                                        value={String(row?.b || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { b: e.target.value })}
                                        placeholder="Descriptor proceso..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-blue-700 outline-none"
                                        value={String(row?.a || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { a: e.target.value })}
                                        placeholder="Descriptor logrado..."
                                    />
                                </td>
                                <td className="border border-slate-200 p-0 align-top" style={rowSurfaceStyle}>
                                    <textarea
                                        data-comp-table="1"
                                        className="w-full resize-none overflow-hidden border-0 bg-transparent p-3 text-justify text-[10px] italic font-medium text-emerald-700 outline-none"
                                        value={String(row?.ad || '')}
                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                        onChange={e => updateRubricaRow(idx, { ad: e.target.value })}
                                        placeholder="Descriptor destacado..."
                                    />
                                </td>
                            </tr>
                        )})}
                    </tbody>
                </table>
            );
        }

        const effectiveRows = templateType === 'rubrica'
            ? Math.max(rows, desiredCriteriaCount + 1)
            : templateType === 'guia_observacion'
                ? Math.max(rows, desiredCriteriaCount + 2)
                : rows;

        return (
            <table className="w-full table-fixed border-collapse text-[10px]">
                {templateType === 'guia_observacion' && (
                    <colgroup>
                        {(() => {
                            const w = getGuideColumnWidthsFromTemplate(template?.structure || {});
                            return (
                                <>
                                    <col style={{ width: w.num }} />
                                    <col style={{ width: w.name }} />
                                    {Array.from({ length: Math.max(cols - 3, 0) }).map((_, idx) => (
                                        <col
                                            key={`tpl-guide-col-${idx}`}
                                            style={{ width: ((idx + 1) % TEMPLATE_GUIDE_LEVELS.length === 0) ? w.levelWide : w.level }}
                                        />
                                    ))}
                                    <col style={{ width: w.logro }} />
                                </>
                            );
                        })()}
                    </colgroup>
                )}
                <tbody>
                    {Array.from({ length: effectiveRows }).map((_, r) => (
                        <tr key={`tpl-row-${r}`}>
                            {Array.from({ length: cols }).map((__, c) => {
                                if (isCoveredByOtherMerge(r, c)) return null;
                                const merge = getMergeAtOrigin(r, c);
                                const rowSpan = merge ? Math.max(1, Number(merge.er) - Number(merge.sr) + 1) : 1;
                                const colSpan = merge ? Math.max(1, Number(merge.ec) - Number(merge.sc) + 1) : 1;
                                const id = layoutCellId(r, c);
                                const value = String(textOverrides[id] || texts[id] || getTemplateFallbackText(template, r, c) || '');
                                const baseCellStyle = styles[id] || {};
                                const style = getTemplateCellStyle(baseCellStyle);
                                const orientation = String(baseCellStyle?.orientation || 'normal');

                                const isRubricaHeader = templateType === 'rubrica' && r === 0;
                                const isChecklistHeader = templateType === 'lista_cotejo' && r === 0;
                                const isScaleHeader = templateType === 'escala_valoracion' && r <= 1;
                                const isGuideHeader = templateType === 'guia_observacion' && r <= 1;

                                let resolvedStyle: React.CSSProperties = { ...style };
                                if (isRubricaHeader) {
                                    const palette = ['#ef1c24', '#f77b28', '#28a745', '#84c7d8'];
                                    const defaultBg = c <= 1 ? '#0f172a' : (palette[c - 2] || '#0f172a');
                                    const defaultColor = '#ffffff';
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = defaultBg;
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = defaultColor;
                                } else if (isChecklistHeader) {
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = '#059669';
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = '#ffffff';
                                } else if (isScaleHeader) {
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = '#0f172a';
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = '#ffffff';
                                } else if (isGuideHeader) {
                                    if (!baseCellStyle?.bg || String(baseCellStyle.bg).toLowerCase() === '#ffffff') resolvedStyle.backgroundColor = '#6d28d9';
                                    if (!baseCellStyle?.color || String(baseCellStyle.color).toLowerCase() === '#0f172a') resolvedStyle.color = '#ffffff';
                                }

                                return (
                                    <td key={`tpl-cell-${id}`} rowSpan={rowSpan} colSpan={colSpan} style={resolvedStyle} className="p-2 align-top">
                                        <div
                                            className="whitespace-pre-wrap break-words leading-tight min-h-[18px]"
                                            style={{
                                                ...getTemplateOrientationBoxStyle(orientation, value),
                                                ...getTemplateOrientationStyle(orientation)
                                            }}
                                        >
                                            {value}
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    const renderChecklistGradingPanel = () => {
        if (!gradingCriteriaRows.length) {
            return (
                <div className="p-10 text-center text-slate-400 text-sm font-bold">
                    La sesión no tiene criterios cargados en la lista de cotejo.
                </div>
            );
        }

        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-black text-slate-800 uppercase">Calificación por Estudiante</h3>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            {gradingStudents.length} estudiantes · {gradingCriteriaRows.length} criterios{gradingSections.length > 1 ? ` · ${gradingSections.length} secciones` : ''}
                        </p>
                    </div>
                    <button
                        onClick={() => { void handleSaveGrading(); }}
                        disabled={gradingSaving || gradingLoading}
                        className={`px-5 py-3 rounded-2xl text-white text-[11px] font-black uppercase tracking-widest ${gradingSaving ? 'bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                        {gradingSaving ? 'Guardando...' : 'Guardar Calificación'}
                    </button>
                </div>

                {renderGradingSectionTabs()}

                {gradingLoading ? (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">Cargando registros de calificación...</div>
                ) : gradingStudents.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">No hay estudiantes para el grado y sección seleccionados.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1100px] border-collapse text-[10px]">
                            <thead>
                                <tr className="bg-slate-900 text-white uppercase text-[9px]">
                                    <th className="border border-white/10 p-3 min-w-[220px] text-left">Estudiante</th>
                                    {gradingCriteriaRows.map((criterion: any, idx: number) => (
                                        <th key={`grading-head-${criterion.id}-${idx}`} className="border border-white/10 p-3 min-w-[170px] text-center">
                                            <div className="space-y-1">
                                                <div className="font-black">C{idx + 1}</div>
                                                <div className="normal-case font-medium text-[10px] leading-tight">{criterion.criterio}</div>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map((student, studentIdx) => (
                                    <tr key={`grading-student-${student.id}`} className={studentIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                        <td className="border border-slate-200 p-3 align-top">
                                            <div className="font-black text-slate-800">{student.name}</div>
                                            <div className="text-[9px] text-slate-500 font-bold">{student.grade} {student.section}</div>
                                        </td>
                                        {gradingCriteriaRows.map((criterion: any) => {
                                            const key = getGradingKey(student.id, criterion.id);
                                            const current = gradingRecords[key] || { level: '', observation: '' };
                                            const isPositive = current.level === gradingChecklistOptionPreset.positive;
                                            const isNegative = current.level === gradingChecklistOptionPreset.negative;
                                            return (
                                                <td key={`grading-cell-${student.id}-${criterion.id}`} className="border border-slate-200 p-2 align-top">
                                                    <div className="flex items-center justify-center gap-4 mb-2">
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="h-4 w-4 accent-emerald-600"
                                                                checked={isPositive}
                                                                onChange={(e) => updateGradingRecord(student.id, criterion.id, {
                                                                    level: e.target.checked ? gradingChecklistOptionPreset.positive : ''
                                                                })}
                                                            />
                                                            <span className="text-[10px] font-black text-emerald-700">{gradingChecklistOptionPreset.positive}</span>
                                                        </label>
                                                        <label className="flex items-center gap-2 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="h-4 w-4 accent-rose-600"
                                                                checked={isNegative}
                                                                onChange={(e) => updateGradingRecord(student.id, criterion.id, {
                                                                    level: e.target.checked ? gradingChecklistOptionPreset.negative : ''
                                                                })}
                                                            />
                                                            <span className="text-[10px] font-black text-rose-700">{gradingChecklistOptionPreset.negative}</span>
                                                        </label>
                                                    </div>
                                                    <textarea
                                                        className="w-full min-h-[64px] resize-none rounded-xl border border-slate-200 p-2 text-[10px] outline-none focus:border-sky-300"
                                                        value={current.observation}
                                                        onInput={e => autoResizeTextarea(e.currentTarget)}
                                                        onChange={e => updateGradingRecord(student.id, criterion.id, { observation: e.target.value })}
                                                        placeholder="Observación..."
                                                    />
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    const renderRubricaGradingPanel = () => {
        if (!gradingCriteriaRows.length) {
            return (
                <div className="p-10 text-center text-slate-400 text-sm font-bold">
                    La sesión no tiene criterios cargados en la rúbrica.
                </div>
            );
        }

        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-black text-slate-800 uppercase">Calificación por Estudiante</h3>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            {gradingStudents.length} estudiantes · {gradingCriteriaRows.length} criterios · {gradingRubricaLevels.length} niveles{gradingSections.length > 1 ? ` · ${gradingSections.length} secciones` : ''}
                        </p>
                    </div>
                    <button
                        onClick={() => { void handleSaveGrading(); }}
                        disabled={gradingSaving || gradingLoading}
                        className={`px-5 py-3 rounded-2xl text-white text-[11px] font-black uppercase tracking-widest ${gradingSaving ? 'bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                        {gradingSaving ? 'Guardando...' : 'Guardar Calificación'}
                    </button>
                </div>

                {renderGradingSectionTabs()}

                {gradingLoading ? (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">Cargando registros de calificación...</div>
                ) : gradingStudents.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">No hay estudiantes para el grado y sección seleccionados.</div>
                ) : (
                    <div className="space-y-5">
                        {filteredStudents.map((student, studentIdx) => (
                            <div key={`grading-rubrica-${student.id}`} className={`rounded-[1.75rem] border overflow-hidden ${studentIdx % 2 === 0 ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/80'}`}>
                                <div className="px-5 py-4 border-b border-slate-200 bg-slate-900 text-white">
                                    <div className="font-black text-sm uppercase tracking-wide">{student.name}</div>
                                    <div className="text-[10px] font-bold text-white/70 uppercase tracking-[0.18em]">{student.grade} {student.section}</div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[980px] border-collapse text-[10px]">
                                        <thead>
                                            <tr className="bg-slate-100 text-slate-700 uppercase text-[9px]">
                                                <th className="border border-slate-200 p-3 w-12">N°</th>
                                                <th className="border border-slate-200 p-3 min-w-[240px] text-left">Criterio</th>
                                                {gradingRubricaLevels.map((level: any) => (
                                                    <th key={`rubrica-level-head-${level.id}`} className="border border-slate-200 p-3 min-w-[110px] text-center">
                                                        {level.label}
                                                    </th>
                                                ))}
                                                <th className="border border-slate-200 p-3 min-w-[260px] text-left">Observación</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {gradingCriteriaRows.map((criterion: any, idx: number) => {
                                                const key = getGradingKey(student.id, criterion.id);
                                                const current = gradingRecords[key] || { level: '', observation: '' };
                                                return (
                                                    <tr key={`rubrica-row-${student.id}-${criterion.id}`} className="align-top">
                                                        <td className="border border-slate-200 p-3 text-center font-black text-slate-500">{idx + 1}</td>
                                                        <td className="border border-slate-200 p-3">
                                                            <div className="font-black text-slate-800">{criterion.criterio}</div>
                                                        </td>
                                                        {gradingRubricaLevels.map((level: any) => {
                                                            const checked = current.level === level.label;
                                                            const descriptor = criterion[level.id as 'c' | 'b' | 'a' | 'ad']
                                                                || criterion[['c', 'b', 'a', 'ad'][gradingRubricaLevels.findIndex((item: any) => item.id === level.id)] as 'c' | 'b' | 'a' | 'ad']
                                                                || '';
                                                            return (
                                                                <td key={`rubrica-level-${student.id}-${criterion.id}-${level.id}`} className="border border-slate-200 p-2">
                                                                    <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl border p-3 cursor-pointer transition-all ${checked ? level.color : 'border-slate-200 bg-white text-slate-500'}`}>
                                                                        <input
                                                                            type="radio"
                                                                            name={`rubrica-${student.id}-${criterion.id}`}
                                                                            className="h-4 w-4 print:h-3 print:w-3 accent-slate-800"
                                                                            checked={checked}
                                                                            onChange={() => updateGradingRecord(student.id, criterion.id, { level: level.label })}
                                                                        />
                                                                        <span className="font-black text-center leading-tight">{level.label}</span>
                                                                        {descriptor ? (
                                                                            <span className="text-[9px] font-medium text-center normal-case leading-tight">{descriptor}</span>
                                                                        ) : null}
                                                                    </label>
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="border border-slate-200 p-2">
                                                            <textarea
                                                                className="w-full min-h-[72px] resize-none rounded-xl border border-slate-200 p-2 text-[10px] outline-none focus:border-sky-300"
                                                                value={current.observation}
                                                                onInput={e => autoResizeTextarea(e.currentTarget)}
                                                                onChange={e => updateGradingRecord(student.id, criterion.id, { observation: e.target.value })}
                                                                placeholder="Observación..."
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const renderGuideInstrumentTable = () => {
        if (!gradingCriteriaRows.length) {
            return (
                <div className="p-10 text-center text-slate-400 text-sm font-bold">
                    La guía de observación no tiene criterios cargados.
                </div>
            );
        }

        const groupedCompetencies = gradingCriteriaRows.reduce((acc: any[], row: any) => {
            const competencia = String(row?.competencia || 'Competencia 1').trim() || 'Competencia 1';
            const capacidad = String(row?.capacidad || 'Capacidad 1').trim() || 'Capacidad 1';
            const source = String(row?.source || 'primary').trim() || 'primary';
            let compGroup = acc.find((item: any) => normalizeLoose(item.name) === normalizeLoose(competencia) && item.source === source);
            if (!compGroup) {
                compGroup = { name: competencia, source, capacities: [] as any[] };
                acc.push(compGroup);
            }
            let capGroup = compGroup.capacities.find((item: any) => normalizeLoose(item.name) === normalizeLoose(capacidad) && item.source === source);
            if (!capGroup) {
                capGroup = { name: capacidad, source, criteria: [] as any[] };
                compGroup.capacities.push(capGroup);
            }
            capGroup.criteria.push(row);
            return acc;
        }, []);

        let globalCriterionIndex = 0;
        const criterionBlocks = groupedCompetencies.flatMap((competency: any) =>
            competency.capacities.flatMap((capacity: any) =>
                capacity.criteria.map((criterion: any) => {
                    globalCriterionIndex += 1;
                    return {
                        code: `C${globalCriterionIndex}`,
                        competencia: competency.name,
                        source: competency.source,
                        capacidad: capacity.name,
                        criterio: String(criterion?.criterio || '').trim(),
                        criterion
                    };
                })
            )
        );
        const guideLevels = gradingGuideLevels;
        const blankRows = Array.from({ length: 6 }, (_, idx) => idx + 1);
        const totalGuideDataColumns = groupedCompetencies.reduce(
            (sum: number, competency: any) => sum + (competency.capacities.reduce((capSum: number, capacity: any) => capSum + capacity.criteria.length, 0) * guideLevels.length) + 1,
            0
        );

        return (
            <div className="overflow-x-auto">
                <table className="w-full min-w-[1280px] border-collapse text-[10px]">
                    <colgroup>
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '24%' }} />
                        {groupedCompetencies.flatMap((competency: any, compIdx: number) => {
                            const competencyCriteria = competency.capacities.reduce((sum: number, capacity: any) => sum + capacity.criteria.length, 0);
                            const criterionCols = Array.from({ length: competencyCriteria }).flatMap((_, critIdx) =>
                                guideLevels.map((level: any) => (
                                    <col
                                        key={`guide-col-${compIdx}-${critIdx}-${level.id}`}
                                        style={{ width: `${68 / Math.max(totalGuideDataColumns, 1)}%` }}
                                    />
                                ))
                            );
                            return [
                                ...criterionCols,
                                <col key={`guide-col-nl-${compIdx}`} style={{ width: `${4 / Math.max(groupedCompetencies.length, 1)}%` }} />
                            ];
                        })}
                    </colgroup>
                    <thead>
                        <tr className="bg-violet-700 text-white uppercase text-[9px]">
                            <th rowSpan={4} className="border border-white/20 p-3 w-12">N°</th>
                            <th rowSpan={4} className="border border-white/20 p-3 min-w-[240px]">Apellidos y Nombres</th>
                            {groupedCompetencies.map((competency: any, compIdx: number) => {
                                const criteriaCount = competency.capacities.reduce((sum: number, capacity: any) => sum + capacity.criteria.length, 0);
                                const isTransversal = String(competency.source || '') === 'transversal';
                                return (
                                    <th
                                        key={`guide-head-comp-${compIdx}`}
                                        colSpan={(Math.max(criteriaCount, 1) * guideLevels.length) + 1}
                                        className="border border-white/20 p-2 text-center"
                                        style={{ backgroundColor: isTransversal ? '#0f766e' : '#6d28d9' }}
                                    >
                                        {competency.name}
                                    </th>
                                );
                            })}
                        </tr>
                        <tr className="bg-violet-700 text-white uppercase text-[9px]">
                            {groupedCompetencies.flatMap((competency: any, compIdx: number) =>
                                [
                                    ...competency.capacities.map((capacity: any, capIdx: number) => {
                                        const isTransversal = String(capacity.source || competency.source || '') === 'transversal';
                                        return (
                                            <th
                                                key={`guide-head-cap-${compIdx}-${capIdx}`}
                                                colSpan={Math.max(capacity.criteria.length, 1) * guideLevels.length}
                                                className="border border-white/20 p-2 text-center"
                                                style={{ backgroundColor: isTransversal ? '#0d9488' : '#7c3aed' }}
                                            >
                                                {capacity.name}
                                            </th>
                                        );
                                    }),
                                    <th
                                        key={`guide-head-nl-${compIdx}`}
                                        rowSpan={3}
                                        className="border border-white/20 p-2 text-center"
                                        style={{ backgroundColor: String(competency.source || '') === 'transversal' ? '#0f766e' : '#6d28d9' }}
                                    >
                                        NL
                                    </th>
                                ]
                            )}
                        </tr>
                        <tr className="text-white text-[9px]">
                            {criterionBlocks.map((block: any, idx: number) => (
                                <th
                                    key={`guide-head-crit-${idx}`}
                                    colSpan={guideLevels.length}
                                    className="border border-white/20 p-2 text-center normal-case leading-tight"
                                    style={{ backgroundColor: String(block.source || '') === 'transversal' ? '#0f766e' : '#6d28d9' }}
                                >
                                    <div className="font-black uppercase text-[8px] tracking-wide">{block.code}</div>
                                    <div className="mt-1 text-[9px] font-medium">{block.criterio}</div>
                                </th>
                            ))}
                        </tr>
                        <tr className="uppercase text-[9px] font-black">
                            {criterionBlocks.flatMap((block: any, idx: number) =>
                                guideLevels.map((level: any, levelIdx: number) => {
                                    const colorMap = ['bg-rose-600', 'bg-orange-500', 'bg-sky-500', 'bg-emerald-500'];
                                    return (
                                        <th
                                            key={`guide-head-level-${idx}-${level.id}`}
                                            className={`border border-white/20 p-1 text-center text-white ${colorMap[levelIdx] || 'bg-violet-600'}`}
                                        >
                                            {level.label}
                                        </th>
                                    );
                                })
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {blankRows.map((rowNumber, idx) => (
                            <tr key={`guide-blank-row-${rowNumber}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                <td className="border border-slate-200 p-2 text-center font-medium text-slate-600">{rowNumber}</td>
                                <td className="border border-slate-200 p-2" />
                                {groupedCompetencies.flatMap((competency: any, compIdx: number) => {
                                    const competencyBlocks = criterionBlocks.filter((block: any) =>
                                        normalizeLoose(block.competencia) === normalizeLoose(competency.name)
                                        && String(block.source || '') === String(competency.source || '')
                                    );
                                    return [
                                        ...competencyBlocks.flatMap((block: any, blockIdx: number) =>
                                            guideLevels.map((level: any, levelIdx: number) => {
                                                const borderColorMap = ['border-rose-500', 'border-orange-500', 'border-sky-500', 'border-emerald-500'];
                                                return (
                                                    <td
                                                        key={`guide-blank-cell-${rowNumber}-${compIdx}-${blockIdx}-${level.id}`}
                                                        className={`border p-2 h-8 ${borderColorMap[levelIdx] || 'border-slate-200'}`}
                                                    />
                                                );
                                            })
                                        ),
                                        <td key={`guide-blank-nl-${rowNumber}-${compIdx}`} className="border border-slate-200 p-2 h-8 text-center font-black text-slate-400">
                                            NL
                                        </td>
                                    ];
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderSessionRegisterPanel = () => {
        return (
            <SessionRegisterPanel
                bimesterLabel={bimesterLabel}
                filteredStudents={filteredStudents}
                generalData={generalData}
                gradingCanonicalLevels={gradingCanonicalLevels}
                gradingCriteriaRows={gradingCriteriaRows}
                gradingLoading={gradingLoading}
                gradingRecords={gradingRecords}
                gradingSectionTabs={renderGradingSectionTabs()}
                gradingSessionGroups={gradingSessionGroups}
                gradingCodeToStoredLevel={gradingCodeToStoredLevel}
                normalizeGradingLevelToCode={normalizeGradingLevelToCode}
                sessionData={sessionData}
                selArea={selArea}
                selGrade={selGrade}
                selSection={selSection}
                sessionDate={sessionDate}
                sessionNumber={sessionNumber}
                unitNumber={unitNumber}
                expandedSessionRegisterObservations={expandedSessionRegisterObservations}
                setExpandedSessionRegisterObservations={setExpandedSessionRegisterObservations}
                updateGradingRecord={updateGradingRecord}
                getGradingKey={getGradingKey}
            />
        );
    };

    const renderGuideGradingPanel = () => {
        if (!gradingCriteriaRows.length) {
            return (
                <div className="p-10 text-center text-slate-400 text-sm font-bold">
                    La sesión no tiene criterios cargados en la guía de observación.
                </div>
            );
        }

        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-black text-slate-800 uppercase">Calificación por Estudiante</h3>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            {gradingStudents.length} estudiantes · {gradingCriteriaRows.length} criterios · {gradingGuideLevels.length} niveles{gradingSections.length > 1 ? ` · ${gradingSections.length} secciones` : ''}
                        </p>
                    </div>
                    <button
                        onClick={() => { void handleSaveGrading(); }}
                        disabled={gradingSaving || gradingLoading}
                        className={`px-5 py-3 rounded-2xl text-white text-[11px] font-black uppercase tracking-widest ${gradingSaving ? 'bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                        {gradingSaving ? 'Guardando...' : 'Guardar Calificación'}
                    </button>
                </div>

                {renderGradingSectionTabs()}

                {gradingLoading ? (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">Cargando registros de calificación...</div>
                ) : gradingStudents.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">No hay estudiantes para el grado y sección seleccionados.</div>
                ) : (
                    <div className="space-y-5">
                        {filteredStudents.map((student, studentIdx) => (
                            <div key={`grading-guide-${student.id}`} className={`rounded-[1.75rem] border overflow-hidden ${studentIdx % 2 === 0 ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/80'}`}>
                                <div className="px-5 py-4 border-b border-slate-200 bg-violet-900 text-white">
                                    <div className="font-black text-sm uppercase tracking-wide">{student.name}</div>
                                    <div className="text-[10px] font-bold text-white/70 uppercase tracking-[0.18em]">{student.grade} {student.section}</div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[1180px] border-collapse text-[10px]">
                                        <thead>
                                            <tr className="bg-slate-100 text-slate-700 uppercase text-[9px]">
                                                <th className="border border-slate-200 p-3 w-12">N°</th>
                                                <th className="border border-slate-200 p-3 min-w-[260px] text-left">Criterio</th>
                                                {gradingGuideLevels.map((level) => (
                                                    <th key={`guide-level-head-${level.id}`} className="border border-slate-200 p-3 min-w-[84px] text-center">
                                                        {level.label}
                                                    </th>
                                                ))}
                                                <th className="border border-slate-200 p-3 min-w-[240px] text-left">Observación</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(() => {
                                                const rows: React.ReactNode[] = [];
                                                let currentCompetencia = '';
                                                let currentCapacidad = '';
                                                let visibleNumber = 0;
                                                gradingCriteriaRows.forEach((criterion: any, idx: number) => {
                                                    const competencia = criterion.competencia || 'COMPETENCIA';
                                                    const capacidad = criterion.capacidad || 'CAPACIDAD';
                                                    if (normalizeLoose(competencia) !== normalizeLoose(currentCompetencia)) {
                                                        currentCompetencia = competencia;
                                                        currentCapacidad = '';
                                                        rows.push(
                                                            <tr key={`guide-grade-comp-${student.id}-${idx}`}>
                                                                <td colSpan={7} className="border border-slate-200 bg-violet-100 px-4 py-3 font-black uppercase tracking-wide text-violet-900">
                                                                    {competencia}
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                    if (normalizeLoose(capacidad) !== normalizeLoose(currentCapacidad)) {
                                                        currentCapacidad = capacidad;
                                                        rows.push(
                                                            <tr key={`guide-grade-cap-${student.id}-${idx}`}>
                                                                <td colSpan={7} className="border border-slate-200 bg-violet-50 px-4 py-3 font-bold uppercase tracking-wide text-slate-700">
                                                                    {capacidad}
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                    visibleNumber += 1;
                                                    const criterionCode = `C${visibleNumber}`;
                                                    const key = getGradingKey(student.id, criterion.id);
                                                    const current = gradingRecords[key] || { level: '', observation: '' };
                                                    rows.push(
                                                        <tr key={`guide-grade-row-${student.id}-${criterion.id}`} className="align-top">
                                                            <td className="border border-slate-200 p-3 text-center font-black text-slate-500">{visibleNumber}</td>
                                                            <td className="border border-slate-200 p-3 text-slate-800">
                                                                <div className="flex items-start gap-2">
                                                                    <span className="rounded-lg bg-violet-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-violet-800">
                                                                        {criterionCode}
                                                                    </span>
                                                                    <span>{criterion.criterio}</span>
                                                                </div>
                                                            </td>
                                                            {gradingGuideLevels.map((level) => {
                                                                const checked = current.level === level.label;
                                                                return (
                                                                    <td key={`guide-level-${student.id}-${criterion.id}-${level.id}`} className="border border-slate-200 p-2">
                                                                        <div className="group relative flex items-center justify-center">
                                                                            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-xl bg-slate-950 px-3 py-2 text-[10px] font-medium normal-case text-white shadow-2xl group-hover:block group-focus-within:block">
                                                                                <div className="mb-1 text-[9px] font-black uppercase tracking-wide text-violet-300">{criterionCode} · {level.label}</div>
                                                                                <div className="leading-tight">{criterion.criterio}</div>
                                                                            </div>
                                                                            <label className={`flex items-center justify-center rounded-2xl border p-3 cursor-pointer transition-all ${checked ? level.color : 'border-slate-200 bg-white text-slate-500'}`}>
                                                                            <input
                                                                                type="radio"
                                                                                name={`guide-${student.id}-${criterion.id}`}
                                                                                className="h-4 w-4 accent-violet-800"
                                                                                checked={checked}
                                                                                onChange={() => updateGradingRecord(student.id, criterion.id, { level: level.label })}
                                                                            />
                                                                            </label>
                                                                        </div>
                                                                    </td>
                                                                );
                                                            })}
                                                            <td className="border border-slate-200 p-2">
                                                                <textarea
                                                                    className="w-full min-h-[72px] resize-none rounded-xl border border-slate-200 p-2 text-[10px] outline-none focus:border-violet-300"
                                                                    value={current.observation}
                                                                    onInput={e => autoResizeTextarea(e.currentTarget)}
                                                                    onChange={e => updateGradingRecord(student.id, criterion.id, { observation: e.target.value })}
                                                                    placeholder="Observación..."
                                                                />
                                                            </td>
                                                        </tr>
                                                    );
                                                });
                                                return rows;
                                            })()}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const renderCalificacionView = () => {
        const templateType = String(
            detectInstrumentTypeFromText(String(sessionData?.instrumentoTemplate?.type || ''))
            || detectInstrumentTypeFromText(String(sessionData?.instrumentoTemplate?.name || ''))
            || sessionData?.instrumentoTemplate?.type
            || ''
        );
        const sessionInstrumentName = sessionData?.instrumentoTemplate?.name || sessionData?.competenciaPrio?.inst || 'Sin instrumento';
        const sessionPerformanceText = String(sessionData?.competenciaPrio?.des || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<li[^>]*>/gi, '\n• ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;|&#160;|&amp;nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .trim();
        return (
            <div className="space-y-6">
                <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden print:rounded-none print:shadow-none print:border-none" style={{ borderColor: themeColor }}>
                    <div className="text-white p-4 text-center font-black uppercase text-xs tracking-widest flex flex-wrap items-center justify-center gap-2 print:hidden" style={{ backgroundColor: themeColor }}>
                        <span>Calificación de Sesión</span>
                        <span className="opacity-50">|</span>
                        <span className="text-white/85">{sessionInstrumentName}</span>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 print:hidden">
                            <p className="text-[10px] font-black uppercase text-slate-500">Desempeño</p>
                            <p className="text-sm font-bold text-slate-700 mt-2 leading-relaxed">{sessionPerformanceText || '-'}</p>
                        </div>

                        {!currentSessionId ? (
                            <div className="p-8 text-center text-slate-400 font-bold">Seleccione una sesión para comenzar a calificar.</div>
                        ) : !sessionData?.instrumentoTemplate ? (
                            <div className="p-8 text-center text-slate-400 font-bold">La sesión seleccionada no tiene plantilla de instrumento cargada.</div>
                        ) : ['lista_cotejo', 'rubrica', 'guia_observacion', 'escala_valoracion'].includes(templateType) ? (
                            renderSessionRegisterPanel()
                        ) : (
                            <div className="p-8 text-center text-slate-400 font-bold">Por ahora la calificación en Sesiones está habilitada para instrumentos con núcleo de evaluación compatible.</div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    if (showTemplateMode) {
        return (
            <SessionTemplateMergeView
                onBack={() => setShowTemplateMode(false)}
                selectedAreaId={assignments.find(a => a.areaName === selArea)?.areaId || selArea}
                selectedGrade={selGrade}
                selectedSection={selSection}
                selectedUnitNumber={unitNumber}
                selectedSessionNumber={sessionNumber}
            />
        );
    }

    return (
        <div className="animate-fade-in pb-20 space-y-6 relative">
            {typeof document !== 'undefined' && toasts.length > 0 && createPortal(
                <div className="fixed right-4 top-4 z-[2147483000] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2.5 pointer-events-none print:hidden sm:right-6 sm:top-6">
                    {toasts.map(t => (
                        <InternalToast
                            key={t.id}
                            message={t.msg}
                            type={t.type}
                            onClose={() => closeToastById(t.id)}
                        />
                    ))}
                </div>,
                document.body
            )}
            {showAuthScreen && (
                <AuthOverlay
                    onSave={handleSaveIAKey}
                    onClose={() => setShowAuthScreen(false)}
                    isSaving={savingKey}
                />
            )}
            
            {showMotiveModal && (
                <div className="fixed inset-0 z-[10000] flex items-start justify-center p-6 bg-slate-900/60 backdrop-blur-md pt-20">
                    <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 animate-scale-in">
                        <div className="bg-blue-600 text-white p-8">
                            <h3 className="text-xl font-black uppercase tracking-tight leading-none italic">Motivo de Reprogramación</h3>
                            <p className="text-[10px] text-blue-100 mt-2 uppercase font-bold tracking-widest">Justifique el cambio de fecha de la sesión</p>
                        </div>
                        <div className="p-10 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Escriba el motivo aquí:</label>
                                <textarea 
                                    autoFocus
                                    className="w-full p-6 h-40 bg-slate-50 border border-slate-200 rounded-[2rem] outline-none focus:border-blue-500 text-[11px] font-bold text-slate-700 shadow-inner resize-none italic"
                                    value={motiveInput}
                                    placeholder="Ej: Feriado local no previsto, Suspensión por mantenimiento..."
                                    onChange={e => setMotiveInput(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-3">
                                <button 
                                    onClick={confirmDateChange}
                                    disabled={!motiveInput.trim()}
                                    className="btn-water water-blue w-full py-5 rounded-[2rem] text-white font-black uppercase text-[11px] tracking-[0.2em] shadow-xl disabled:opacity-50"
                                >
                                    Confirmar Reprogramación
                                </button>
                                <button onClick={() => {setShowMotiveModal(false); setIsDatePickerOpen(false);}} className="w-full py-2 text-slate-400 font-black uppercase text-[10px] tracking-widest hover:text-slate-600 transition-colors">Cancelar</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="absolute top-6 right-12 z-[300] print:hidden">
                <div 
                    className="w-10 h-10 rounded-full border-2 border-white/40 shadow-lg cursor-pointer overflow-hidden transition-transform hover:scale-110 active:scale-95 flex items-center justify-center bg-white/20 backdrop-blur-md"
                    title="Personalizar color del apartado"
                >
                    <span className="text-xl">🎨</span>
                    <input 
                        type="color" 
                        value={themeColor} 
                        onChange={(e) => {
                            setThemeColor(e.target.value);
                            localStorage.setItem('armi_sessions_theme', e.target.value);
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                </div>
            </div>

            <div className="p-6 rounded-[2.5rem] shadow-xl relative overflow-visible text-white transition-colors duration-500 print:hidden" style={{ backgroundColor: themeColor }}>
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-white/30 to-transparent"></div>
                <div className="flex flex-col lg:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-white/20 p-3 rounded-2xl border border-white/30 shadow-inner">
                        <span className="text-3xl">📘</span></div>
                        <div className="flex flex-col">
                            <h1 className="text-4xl font-black italic font-serif tracking-tight uppercase leading-none">Sesiones de Aprendizaje {year}</h1><span className="text-xs font-bold text-white/70 uppercase tracking-widest mt-1">Planificación de sesiones - {bimesterLabel} Bimestre</span></div>
                    </div>
                    
                    <div className="bg-white/20 p-3 rounded-[3rem] border border-white/30 shadow-inner backdrop-blur-md flex gap-3 ml-auto lg:mr-16">
                        <button onClick={handleGenerateAI} disabled={!headerFilled || isGeneratingIA} className={`btn-3d-purple scale-90 ${!headerFilled ? 'opacity-40 grayscale cursor-not-allowed' : (isGeneratingIA ? 'animate-pulse' : '')}`} title="Completar con IA Armi">
                            {isGeneratingIA ? <span className="text-xl">✨</span> : <span>🤖</span>}
                        </button>
                        <button
                            onClick={handleOpenLastAiDiagnostic}
                            className="h-9 w-9 rounded-full border border-white/35 bg-black/15 text-[11px] font-black text-white/90 transition hover:bg-black/25"
                            title="Ver último diagnóstico IA"
                        >
                            IA
                        </button>
                        <button onClick={() => { void handleSave(); }} className="btn-3d-plus scale-90" title="Guardar Sesión">
                            <span>+</span>
                        </button>
                        <button onClick={() => setSessionData(cloneInitialSessionData())} className="btn-3d-clear scale-90" title="Limpiar Formulario">
                            <span>🧹</span>
                        </button>
                        <button onClick={handleOpenManager} className="btn-3d-purple scale-90" title="Ver Database">
                            <span>🗄️</span>
                        </button>
                        <button onClick={() => { void handleOpenTemplateMode(); }} className="btn-3d-blue scale-90" title="Ver Plantilla">
                            <span>📄</span>
                        </button>
                    </div>
                </div>

                <div className="mt-8 grid grid-cols-1 md:grid-cols-12 gap-4 bg-black/10 p-5 rounded-[2.5rem] border border-white/10 backdrop-blur-md relative z-[200] overflow-visible">
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
                    <div className="md:col-span-3 relative">
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

                <div className="mt-5 flex gap-2">
                    <button
                        onClick={() => setSessionMode('planificacion')}
                        className={`px-5 py-2 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${sessionMode === 'planificacion' ? 'bg-white text-slate-900 shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                        Planificación
                    </button>
                    <button
                        onClick={() => setSessionMode('calificacion')}
                        className={`px-5 py-2 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${sessionMode === 'calificacion' ? 'bg-white text-slate-900 shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                        Calificación
                    </button>
                </div>
            </div>

            {headerFilled ? (
                sessionMode === 'calificacion' ? (
                    renderCalificacionView()
                ) : (
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
                            className="w-full p-6 h-32 resize-none outline-none text-slate-700 font-medium italic text-[11px] leading-relaxed text-justify focus:bg-slate-50 transition-all"
                            placeholder="Escriba la situación problemática aquí..."
                            value={sessionData.situation}
                            onChange={e => handleInputChange('situation', e.target.value)}
                        />
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <table className="comp-table w-full border-collapse text-[10px] min-w-[1000px] table-fixed">
                            <thead>
                                <tr className="text-white font-black uppercase text-[9px] tracking-wider text-center divide-x divide-white/20" style={{ backgroundColor: themeColor }}>
                                    <th className="p-3 w-40">COMPETENCIA PRIORIZADA</th>
                                    <th className="p-3 w-40">CAPACIDAD PRIORIZADA</th>
                                    <th className="p-3">CRITERIOS</th>
                                    <th className="p-3 w-40">CAMPOS TEMÁTICOS</th>
                                    <th className="p-3 w-40">EVIDENCIA DE APRENDIZAJE</th>
                                    <th className="p-3 w-40">INSTRUMENTO</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-black/20">
                                <tr className="divide-x divide-black/20">
                                    <td className="p-4 bg-slate-50/50 font-black text-slate-900 text-center align-middle">{sessionData.competenciaPrio.comp}</td>
                                    <td className="p-4 bg-slate-50/30 text-slate-800 font-bold italic text-center whitespace-pre-wrap align-middle">{sessionData.competenciaPrio.cap}</td>
                                    <td className="p-0 align-middle [&_.ql-container]:border-0 [&_.ql-container]:h-full [&_.ql-editor]:min-h-[96px] [&_.ql-editor]:h-full [&_.ql-editor]:w-full [&_.ql-editor]:px-4 [&_.ql-editor]:py-4 [&_.ql-editor]:text-[10px] [&_.ql-editor]:font-bold [&_.ql-editor]:text-slate-700 [&_.ql-editor]:bg-slate-50/40 [&_.ql-editor]:whitespace-pre-wrap">
                                        <ReactQuill
                                            theme="bubble"
                                            modules={QUILL_MODULES}
                                            value={sessionData.competenciaPrio.des}
                                            onChange={(val) => handleInputChange('competenciaPrio.des', val)}
                                        />
                                    </td>
                                    <td className="p-0 align-middle" rowSpan={1 + visibleTransRows.length}>
                                        <textarea data-comp-table="1" className="w-full p-4 border-0 outline-none text-center font-bold text-slate-700 resize-none overflow-y-hidden text-[10px] bg-slate-50/50" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.competenciaPrio.field} onChange={e => handleInputChange('competenciaPrio.field', e.target.value)} placeholder="Campo..." />
                                    </td>
                                    <td className="p-0 align-middle [&_.ql-container]:border-0 [&_.ql-container]:h-full [&_.ql-editor]:min-h-[96px] [&_.ql-editor]:h-full [&_.ql-editor]:w-full [&_.ql-editor]:px-4 [&_.ql-editor]:py-4 [&_.ql-editor]:text-[10px] [&_.ql-editor]:font-bold [&_.ql-editor]:text-slate-700 [&_.ql-editor]:bg-blue-200 [&_.ql-editor]:whitespace-pre-wrap">
                                        <ReactQuill
                                            theme="bubble"
                                            modules={QUILL_MODULES}
                                            value={sessionData.competenciaPrio.evidence}
                                            onChange={(val) => handleInputChange('competenciaPrio.evidence', val)}
                                        />
                                    </td>
                                    <td className="p-0 align-middle">
                                        <textarea data-comp-table="1" className="w-full p-4 border-0 outline-none text-center font-bold text-slate-500 resize-none overflow-y-hidden text-[10px]" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.competenciaPrio.inst} onChange={e => handleInputChange('competenciaPrio.inst', e.target.value)} placeholder="Instrumento..." /></td>
                                </tr>
                                {visibleTransRows.map(({ ct, originalIdx }: any, idx: number) => (
                                    <tr key={originalIdx} className="divide-x divide-black/20">
                                        <td
                                            className="p-4 font-black text-center uppercase tracking-tighter align-middle"
                                            style={{ ...getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.12), color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')) }}
                                        >
                                            <span className="text-[8px] opacity-60 block mb-1">Competencia Transversal:</span>
                                            {ct.comp}
                                        </td>
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <textarea
                                                data-comp-table="1"
                                                className="bg-transparent w-full h-full min-h-[96px] p-4 border-0 outline-none text-center font-black italic resize-none overflow-y-hidden text-[10px]"
                                                style={{ color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')) }}
                                                onInput={e => autoResizeTextarea(e.currentTarget)}
                                                value={ct.cap}
                                                onChange={e => handleInputChange(`competenciasTrans.${originalIdx}.cap`, e.target.value)}
                                                placeholder="Capacidad..."
                                            />
                                        </td>                               
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <div
                                                className="trans-quill-surface min-h-[112px] h-full w-full
                                                [&_.ql-container]:!border-0
                                                [&_.ql-container]:h-full
                                                [&_.ql-editor]:min-h-[112px]
                                                [&_.ql-editor]:h-full
                                                [&_.ql-editor]:w-full
                                                [&_.ql-editor]:px-4
                                                [&_.ql-editor]:py-4
                                                [&_.ql-editor]:text-[10px]
                                                [&_.ql-editor]:font-black
                                                [&_.ql-editor]:!text-[inherit]
                                                [&_.ql-editor]:whitespace-pre-wrap
                                                [&_.ql-editor_p]:!m-0"
                                                style={{
                                                    ...getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')),
                                                    ['--trans-surface' as any]: getTransversalSurfaceColor(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    ['--trans-text' as any]: getTransversalTextColor(String(ct?.rowColor || '#00b28c'))
                                                }}
                                            >
                                                <ReactQuill
                                                    className="trans-quill"
                                                    theme="bubble"
                                                    modules={QUILL_MODULES}
                                                    value={ct.des}
                                                    onChange={(val) => handleInputChange(`competenciasTrans.${originalIdx}.des`, val)}
                                                />
                                            </div>
                                        </td>
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <div
                                                className="trans-quill-surface min-h-[112px] h-full w-full
                                                [&_.ql-container]:!border-0
                                                [&_.ql-container]:h-full
                                                [&_.ql-editor]:min-h-[112px]
                                                [&_.ql-editor]:h-full
                                                [&_.ql-editor]:w-full
                                                [&_.ql-editor]:px-4
                                                [&_.ql-editor]:py-4
                                                [&_.ql-editor]:text-[10px]
                                                [&_.ql-editor]:font-black
                                                [&_.ql-editor]:!text-[inherit]
                                                [&_.ql-editor]:whitespace-pre-wrap
                                                [&_.ql-editor_p]:!m-0"
                                                style={{
                                                    ...getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')),
                                                    ['--trans-surface' as any]: getTransversalSurfaceColor(String(ct?.rowColor || '#00b28c'), 0.14),
                                                    ['--trans-text' as any]: getTransversalTextColor(String(ct?.rowColor || '#00b28c'))
                                                }}
                                            >
                                                <ReactQuill
                                                    className="trans-quill"
                                                    theme="bubble"
                                                    modules={QUILL_MODULES}
                                                    value={ct.evidence}
                                                    onChange={(val) => handleInputChange(`competenciasTrans.${originalIdx}.evidence`, val)}
                                                />
                                            </div>
                                        </td>
                                        <td className="p-0 align-middle" style={getTransversalSurfaceStyle(String(ct?.rowColor || '#00b28c'), 0.14)}>
                                            <textarea
                                                data-comp-table="1"
                                                className="bg-transparent w-full h-full min-h-[96px] p-4 border-0 outline-none text-center font-bold resize-none overflow-y-hidden text-[10px]"
                                                style={{ color: getTransversalTextColor(String(ct?.rowColor || '#00b28c')) }}
                                                onInput={e => autoResizeTextarea(e.currentTarget)}
                                                value={ct.inst}
                                                onChange={(e) => handleInputChange(`competenciasTrans.${originalIdx}.inst`, e.target.value)}
                                                placeholder="Instrumento..."
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <table className="w-full border-collapse text-[10px]">
                            <thead className="text-white font-black uppercase text-[9px]" style={{ backgroundColor: themeColor }}>
                                <tr className="divide-x divide-white/20">
                                    <th className="p-3 w-40 text-center">ENFOQUE TRANSVERSAL</th>
                                    <th className="p-3 w-40 text-center">VALORES</th>
                                    <th className="p-3 w-1/3 text-center">ACCIONES OBSERVABLES</th>
                                    <th className="p-3 text-center">SE DEMUESTRA CUANDO...</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-black/20">
                                <tr className="divide-x divide-black/20 align-top">
                                    <td className="p-4 bg-slate-50/50 font-black text-slate-900 text-center align-middle">{sessionData.enfoqueTrans.enfoque || 'N/A'}</td>
                                    <td className="p-0 align-middle">
                                        <textarea className="w-full h-full p-4 border-0 outline-none text-center font-bold text-slate-800 resize-none italic text-[11px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.enfoqueTrans.valor} onChange={e => handleInputChange('enfoqueTrans.valor', e.target.value)} placeholder="Valores..." /></td>
                                    <td className="p-0 align-middle">
                                        <textarea className="w-full p-4 border-0 outline-none text-slate-700 font-medium italic text-justify resize-none text-[11px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.enfoqueTrans.acciones} onChange={e => handleInputChange('enfoqueTrans.acciones', e.target.value)} placeholder="Acciones..." /></td>
                                    <td className="p-0 align-middle">
                                        <textarea className="w-full p-4 border-0 outline-none text-slate-600 font-medium italic text-justify resize-none text-[11px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={sessionData.enfoqueTrans.demuestra} onChange={e => handleInputChange('enfoqueTrans.demuestra', e.target.value)} placeholder="Se demuestra cuando..." /></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="bg-slate-50 px-6 py-2 border-b border-slate-200 flex justify-end gap-3">
                        <button onClick={handleSaveAsTemplate} className="btn-3d-darkgreen scale-90" title="Anclar como Plantilla de Área (SQL)">
                            <span>⚓</span>
                        </button>
                        <button onClick={handleExportJson} className="btn-3d-orange scale-90" title="Exportar Plantilla (.JSON)">
                            <span>⬇</span>
                        </button>
                        <label className="btn-3d-grey scale-90 cursor-pointer" title="Importar Plantilla (.JSON)">
                            <span>⬆</span>
                            <input type="file" className="hidden" accept=".json" onChange={handleImportJson} />
                        </label>
                            <button onClick={handleRestoreTemplate} className="btn-3d-clear scale-90" title="Restaurar Plantilla Global">
                            <span>↻</span>
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[10px]">
                                <thead>
                                    <tr className="text-white font-black uppercase text-[9px] tracking-widest" style={{ backgroundColor: themeColor }}>
                                        <th className="border border-white/30 p-3 w-24 text-center">FASES</th>
                                        <th colSpan={2} className="border border-white/30 p-3 w-64 text-center">PROCESOS PEDAGÓGICOS</th>
                                        <th className="border border-white/30 p-3 text-center">ESTRATEGIAS / ACTIVIDADES</th>
                                        <th className="border border-white/30 p-3 w-64 text-center">MEDIOS, MATERIALES Y/O RECURSOS</th>
                                        <th className="border border-white/30 p-3 w-24 text-center">TIEMPO</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* ================= INICIO ================= */}
                                    <tr>
                                        <td rowSpan={2} className="border border-black/20 p-4 font-black text-center align-middle bg-slate-50">INICIO</td>
                                        {/* MOTIVACIÓN TRANSVERSAL TOTAL */}
                                        <td rowSpan={6} className="border border-black/20 bg-slate-100 align-middle">
                                            <div className="h-full flex items-center justify-center">
                                                <span className="font-black tracking-widest text-[9px]" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>MOTIVACIÓN</span>
                                            </div>
                                        </td>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">RECUPERACIÓN DE SABERES PREVIOS</td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.saberes}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.inicio.saberes', val);
                                                    debouncedSync(val, 'secuencia.inicio.saberes', 'secuencia.inicio.saberes_recursos');
                                                }}
                                            />
                                        </td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.saberes_recursos}
                                                onChange={(val) => handleInputChange('secuencia.inicio.saberes_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[0]}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">CONFLICTO COGNITIVO</td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.conflicto}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.inicio.conflicto', val);
                                                    debouncedSync(val, 'secuencia.inicio.conflicto', 'secuencia.inicio.conflicto_recursos');
                                                }}
                                            />
                                        </td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.inicio.conflicto_recursos}
                                                onChange={(val) => handleInputChange('secuencia.inicio.conflicto_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[1]}</td>
                                    </tr>
                                    {/* ================= DESARROLLO ================= */}
                                    <tr>
                                        <td rowSpan={3} className="border border-black/20 p-4 font-black text-center align-middle bg-slate-50">DESARROLLO</td>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">CONSTRUCCIÓN DEL CONOCIMIENTO</td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.construccion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.proceso.construccion', val);
                                                    debouncedSync(val, 'secuencia.proceso.construccion', 'secuencia.proceso.construccion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.construccion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.proceso.construccion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[2]}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">APLICACIÓN DE LO APRENDIDO</td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.aplicacion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.proceso.aplicacion', val);
                                                    debouncedSync(val, 'secuencia.proceso.aplicacion', 'secuencia.proceso.aplicacion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.aplicacion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.proceso.aplicacion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[3]}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">METACOGNICIÓN</td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.metacognicion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.proceso.metacognicion', val);
                                                    debouncedSync(val, 'secuencia.proceso.metacognicion', 'secuencia.proceso.metacognicion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.proceso.metacognicion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.proceso.metacognicion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[4]}</td>
                                    </tr>
                                    {/* ================= SALIDA ================= */}
                                    <tr>
                                        <td className="border border-black/20 p-4 font-black text-center align-middle bg-slate-50">SALIDA</td>
                                        <td className="border border-black/20 p-4 font-black text-center bg-slate-50/40">EVALUACIÓN</td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.salida.evaluacion}
                                                onChange={(val) => {
                                                    handleInputChange('secuencia.salida.evaluacion', val);
                                                    debouncedSync(val, 'secuencia.salida.evaluacion', 'secuencia.salida.evaluacion_recursos');
                                                }}
                                            />
                                        </td>
                                        <td className="border border-black/20 p-0 bg-white">
                                            <ReactQuill 
                                                theme="bubble" 
                                                modules={QUILL_MODULES} 
                                                value={sessionData.secuencia.salida.evaluacion_recursos}
                                                onChange={(val) => handleInputChange('secuencia.salida.evaluacion_recursos', val)}
                                            />
                                        </td>
                                        <td className="border border-black/20 text-center font-black bg-slate-50">{tiempoValues[5]}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    
                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 font-black uppercase text-xs tracking-widest flex items-center justify-between gap-3" style={{ backgroundColor: themeColor }}>
                            <div className="flex items-center gap-3">
                                <span className="text-xl"></span> VII. ACTIVIDADES DE EXTENSIÓN
                            </div>
                            <button onClick={handleFillExtensionDefaults} className="px-4 py-2 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg">
                                ✨ Sugerir
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-[11px] font-bold italic text-slate-500 text-center">
                                Para las actividades de extensión puedes usar una sugerencia base o redactarlas manualmente según la sesión.
                            </p>
                            <textarea
                                className="w-full min-h-[140px] resize-none rounded-[1.8rem] border border-slate-200 bg-slate-50 px-5 py-5 outline-none text-[11px] leading-relaxed font-medium italic text-slate-700 focus:border-violet-300 focus:bg-white transition-all"
                                value={sessionData.extension || ''}
                                onChange={e => handleInputChange('extension', e.target.value)}
                                placeholder="Escribe aquí las actividades de extensión..."
                            />
                        </div>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 font-black uppercase text-xs tracking-widest flex items-center justify-between gap-3" style={{ backgroundColor: themeColor }}>
                            <div className="flex items-center gap-3">
                                <span className="text-xl"></span> VIII. RECURSOS, MEDIOS Y MATERIALES A UTILIZAR
                            </div>
                            <button onClick={handleFillResourceDefaults} className="px-4 py-2 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg">
                                ✨ Valores por defecto
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[10px] min-w-[900px]">
                                <thead className="text-white font-black uppercase text-[9px]" style={{ backgroundColor: themeColor }}>
                                    <tr className="divide-x divide-white/20">
                                        <th className="p-3 text-center">RECURSOS</th>
                                        <th className="p-3 text-center">MEDIOS</th>
                                        <th className="p-3 text-center">MATERIALES</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="divide-x divide-black/20">
                                        <td className="p-0"><textarea className="w-full min-h-[150px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.rec || ''} onChange={e => handleInputChange('recursos.rec', e.target.value)} placeholder="Recursos..." /></td>
                                        <td className="p-0"><textarea className="w-full min-h-[150px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.med || ''} onChange={e => handleInputChange('recursos.med', e.target.value)} placeholder="Medios..." /></td>
                                        <td className="p-0"><textarea className="w-full min-h-[150px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.mat || ''} onChange={e => handleInputChange('recursos.mat', e.target.value)} placeholder="Materiales..." /></td>
                                    </tr>
                                    <tr className="text-white font-black uppercase text-[9px] divide-x divide-white/20" style={{ backgroundColor: themeColor }}>
                                        <th className="p-3 text-center" colSpan={2}>APS O SOFTWARES</th>
                                        <th className="p-3 text-center">ESPACIOS DE APRENDIZAJE</th>
                                    </tr>
                                    <tr className="divide-x divide-black/20">
                                        <td className="p-0" colSpan={2}><textarea className="w-full min-h-[140px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.soft || ''} onChange={e => handleInputChange('recursos.soft', e.target.value)} placeholder="Apps, softwares o plataformas..." /></td>
                                        <td className="p-0"><textarea className="w-full min-h-[140px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.recursos?.esp || ''} onChange={e => handleInputChange('recursos.esp', e.target.value)} placeholder="Espacios de aprendizaje..." /></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 font-black uppercase text-xs tracking-widest flex items-center justify-between gap-3" style={{ backgroundColor: themeColor }}>
                            <div className="flex items-center gap-3">
                                <span className="text-xl"></span> IX. REFERENCIAS BIBLIOGRÁFICAS
                            </div>
                            <button onClick={handleFillBibliographyDefaults} className="px-4 py-2 rounded-2xl bg-white/15 hover:bg-white/25 border border-white/20 text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg">
                                ✨ Valores por defecto
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[10px] min-w-[900px]">
                                <thead className="text-white font-black uppercase text-[9px]" style={{ backgroundColor: themeColor }}>
                                    <tr className="divide-x divide-white/20">
                                        <th className="p-3 text-center">BIBLIOGRAFÍA</th>
                                        <th className="p-3 text-center">LINKOGRAFÍA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="divide-x divide-black/20">
                                        <td className="p-0"><textarea className="w-full min-h-[180px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.bibliografia?.bib || ''} onChange={e => handleInputChange('bibliografia.bib', e.target.value)} placeholder="Bibliografía..." /></td>
                                        <td className="p-0"><textarea className="w-full min-h-[180px] border-0 outline-none resize-none px-4 py-4 text-[11px] italic font-medium text-slate-700" value={sessionData?.bibliografia?.link || ''} onChange={e => handleInputChange('bibliografia.link', e.target.value)} placeholder="Linkografía..." /></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 text-center font-black uppercase text-xs tracking-widest flex items-center justify-center gap-3" style={{ backgroundColor: themeColor }}>
                            <span className="text-xl"></span> X. INSTRUMENTO DE EVALUACIÓN: {sessionData?.instrumentoTemplate?.name || sessionData?.competenciaPrio?.inst || 'RÚBRICA'}
                        </div>
                        <div className="overflow-x-auto">
                            {String(sessionData?.instrumentoTemplate?.type || '') === 'guia_observacion'
                                ? renderGuideInstrumentTable()
                                : renderInstrumentTemplateTable() || (
                                <table className="w-full text-[11px] border-collapse min-w-[1000px]">
                                    <thead>
                                        <tr className="bg-slate-800 text-white font-black uppercase text-[9px] divide-x divide-white/50">
                                            <th className="p-3 w-12 text-center">N°</th>
                                            <th className="p-3 w-48 text-center">CRITERIO</th>
                                            <th className="p-3 w-48 bg-red-600 text-center">C (INICIO)</th>
                                            <th className="p-3 w-48 bg-orange-500 text-center">B (EN PROCESO)</th>
                                            <th className="p-3 w-48 bg-cyan-500 text-center">A (LOGRADO)</th>
                                            <th className="p-3 w-48 bg-emerald-500 text-center">AD (DESTACADO)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b border-black/20 bg-slate-50/40">
                                            <td className="p-3 font-black text-slate-700 text-center border-b border-black/20">MODO</td>
                                            <td colSpan={5} className="p-2 border-b border-black/20">
                                                <select
                                                    className="w-full bg-transparent px-2 py-1 text-center text-[10px] font-black uppercase tracking-wide text-slate-700 outline-none"
                                                    value={rubricRowMode}
                                                    onChange={e => {
                                                        const nextMode = String(e.target.value || 'criterion') as 'criterion' | 'capacity';
                                                        const nextRows = (rubricAutoRowsByMode[nextMode] || []).map((row: any, idx: number) => ({
                                                            ...row,
                                                            id: idx + 1
                                                        }));
                                                        handleInputChange('rubricaRowMode', nextMode);
                                                        handleInputChange('instrumento', nextRows);
                                                    }}
                                                >
                                                    <option value="criterion">Evaluar por criterio</option>
                                                    <option value="capacity">Evaluar por capacidad</option>
                                                </select>
                                            </td>
                                        </tr>
                                        {(() => {
                                            const rows = Array.isArray(sessionData?.instrumento) ? sessionData.instrumento : [];
                                            const rendered: React.ReactNode[] = [];
                                            let currentCompetencia = '';
                                            let currentCapacidad = '';

                                            rows.forEach((row: any, i: number) => {
                                                const updateRow = (field: string, val: string) => {
                                                    const newInst = [...rows];
                                                    newInst[i][field] = val;
                                                    handleInputChange('instrumento', newInst);
                                                };

                                                const competencia = String(row?.competencia || '').trim();
                                                const capacidad = String(row?.capacidad || '').trim();
                                                const isTransversal = String(row?.source || '') === 'transversal';
                                                const transversalColor = String(row?.rowColor || '#00b28c');
                                                const rowTone = isTransversal ? 'hover:bg-emerald-50/80' : 'hover:bg-slate-50';
                                                const toneCellClass = isTransversal ? '' : '';
                                                const toneCellStyle = isTransversal ? getTransversalSurfaceStyle(transversalColor, 0.12) : undefined;
                                                const transversalHeaderStyle = isTransversal ? { backgroundColor: transversalColor, color: '#ffffff' } : undefined;
                                                const transversalSubheaderStyle = isTransversal
                                                    ? {
                                                        backgroundColor: getTransversalSurfaceColor(transversalColor, 0.18),
                                                        color: getTransversalTextColor(transversalColor)
                                                    }
                                                    : undefined;

                                                if (competencia && normalizeLoose(competencia) !== normalizeLoose(currentCompetencia)) {
                                                    currentCompetencia = competencia;
                                                    currentCapacidad = '';
                                                    rendered.push(
                                                        <tr key={`rubrica-comp-${i}`}>
                                                            <td className={`p-3 text-center font-black border-b border-black/20 ${isTransversal ? '' : 'bg-slate-800 text-white'}`} style={transversalHeaderStyle}>
                                                                COMP.
                                                            </td>
                                                            <td colSpan={5} className={`p-3 text-center font-black uppercase tracking-wide border-b border-black/20 ${isTransversal ? '' : 'bg-slate-100 text-slate-800'}`} style={isTransversal ? { ...transversalHeaderStyle, opacity: 0.94 } : undefined}>
                                                                {competencia}
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                if (capacidad && normalizeLoose(capacidad) !== normalizeLoose(currentCapacidad)) {
                                                    currentCapacidad = capacidad;
                                                    rendered.push(
                                                        <tr key={`rubrica-cap-${i}`}>
                                                            <td className={`p-3 text-center font-black border-b border-black/20 ${isTransversal ? '' : 'bg-slate-100 text-slate-700'}`} style={transversalSubheaderStyle}>
                                                                CAP.
                                                            </td>
                                                            <td colSpan={5} className={`p-3 text-center font-bold border-b border-black/20 ${isTransversal ? '' : 'bg-slate-50 text-slate-700'}`} style={toneCellStyle}>
                                                                {capacidad}
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                rendered.push(
                                                    <tr key={row.id || i} className={`divide-x divide-y divide-black/20 border-b border-slate-50 align-top group transition-all ${rowTone}`}>
                                                        <td className={`p-4 text-center font-black text-slate-900 bg-slate-50/30 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}>{i + 1}</td>
                                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}>
                                                            <textarea data-comp-table="1" className="w-full p-3 border-0 outline-none font-bold text-slate-800 resize-none overflow-hidden text-center bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.criterio} onChange={e => updateRow('criterio', e.target.value)} placeholder={rubricRowMode === 'capacity' ? 'Capacidad...' : 'Defina criterio...'} />
                                                        </td>
                                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-red-600 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.c} onChange={e => updateRow('c', e.target.value)} placeholder="..." /></td>
                                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-orange-700 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.b} onChange={e => updateRow('b', e.target.value)} placeholder="..." /></td>
                                                        <td className={`p-0 align-middle border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-blue-700 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.a} onChange={e => updateRow('a', e.target.value)} placeholder="..." /></td>
                                                        <td className={`p-0 align-middle border-r border-b border-black/20 ${toneCellClass}`} style={toneCellStyle}><textarea data-comp-table="1" className="w-full p-3 border-0 outline-none text-emerald-700 italic font-medium resize-none overflow-hidden text-justify bg-transparent text-[10px] h-full" onInput={e => autoResizeTextarea(e.currentTarget)} value={row.ad} onChange={e => updateRow('ad', e.target.value)} placeholder="..." /></td>
                                                    </tr>
                                                );
                                            });

                                            return rendered;
                                        })()}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </>
                )
            ) : (
                <div className="p-20 text-center border-4 border-dashed border-slate-200 rounded-[4rem] bg-slate-50/20 text-slate-300 flex flex-col items-center">
                    <div className="text-8xl mb-8 grayscale opacity-20 animate-pulse"></div>
                    <p className="font-black uppercase tracking-[0.3em] text-xs max-w-xs leading-loose">Seleccione los parámetros del encabezado (ÁREA, GRADO, SECC, UNID, SESIÓN) para redactar su sesión de aprendizaje.</p>
                </div>
            )}
            
            {/* MODAL DE GESTIÓN DE SESIONES */}
            {isManageModalOpen && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 flex flex-col h-[80vh]">
                        <div className="p-8 text-white flex justify-between items-center" style={{ backgroundColor: themeColor }}>
                            <div>
                                <h3 className="text-2xl font-black uppercase tracking-tight leading-none italic">Gestor de Sesiones</h3>
                                <p className="text-[10px] font-bold text-white/70 mt-2 uppercase tracking-[0.2em]">Registros guardados en Servidor SQL</p>
                            </div>
                            <button onClick={() => setIsManageModalOpen(false)} className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-2xl transition-all">x</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            {allSavedSessionsList.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 opacity-50 italic">
                                    <span className="text-6xl"></span>
                                    <p className="font-black text-xs uppercase tracking-widest">No hay sesiones guardadas todavía.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {allSavedSessionsList.map((s, idx) => (
                                        <div 
                                            key={idx} 
                                            onClick={() => handleLoadSpecific(s)}
                                            className="group bg-slate-50 border border-slate-200 p-5 rounded-[2rem] hover:bg-white hover:border-blue-300 hover:shadow-xl transition-all cursor-pointer relative overflow-hidden"
                                        >
                                            <div className="flex items-center gap-4 relative z-10">
                                                <div className="w-14 h-14 rounded-2xl bg-white flex flex-col items-center justify-center shadow-sm border border-slate-100 shrink-0">
                                                    <span className="text-[8px] font-black text-slate-400 uppercase">AÑO</span>
                                                    <span className="text-lg font-black text-blue-600">{s.year}</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-black text-slate-800 text-sm uppercase truncate pr-4">{s.title}</h4>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="px-2 py-0.5 rounded-lg bg-slate-200 text-slate-600 text-[9px] font-black uppercase">{s.grade} {s.section}</span>
                                                        <span className="px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-700 text-[9px] font-black uppercase">U{s.unitNumber} S{s.sessionNumber}</span>
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                                                    className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-md"
                                                >
                                                    
                                                </button>
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
                @keyframes scaleIn {
                    from { opacity: 0; transform: scale(0.95) translateY(10px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                .animate-scale-in { animation: scaleIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
                @keyframes flyInRight {
                    0% { opacity: 0; transform: translateX(200px) scale(0.8); }
                    100% { opacity: 1; transform: translateX(0) scale(1); }
                }
                .animate-fly-in-right {
                    animation: flyInRight 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                }
                .generating-glow { position: relative; animation: glow-pulse-border 1.5s infinite; }
                @keyframes glow-pulse-border { 0% { box-shadow: 0 0 5px rgba(211, 84, 0, 0.2); border-color: rgba(211, 84, 0, 0.3); } 50% { box-shadow: 0 0 20px rgba(211, 84, 0, 0.5); border-color: rgba(211, 84, 0, 0.6); } 100% { box-shadow: 0 0 5px rgba(211, 84, 0, 0.2); border-color: rgba(211, 84, 0, 0.3); } }
                .comp-table .ql-container.ql-bubble,
                .comp-table .ql-container.ql-bubble .ql-editor {
                    background: transparent !important;
                }
                .comp-table .trans-quill .ql-container,
                .comp-table .trans-quill .ql-editor,
                .comp-table .trans-quill .ql-editor * {
                    background: transparent !important;
                    background-color: transparent !important;
                }
                .comp-table .trans-quill-surface .ql-container,
                .comp-table .trans-quill-surface .ql-editor {
                    background: var(--trans-surface) !important;
                    background-color: var(--trans-surface) !important;
                    color: var(--trans-text) !important;
                }
                .comp-table .trans-quill-surface .ql-editor {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                .comp-table .trans-quill-surface .ql-editor *,
                .comp-table .trans-quill-surface .ql-editor p,
                .comp-table .trans-quill-surface .ql-editor span,
                .comp-table .trans-quill-surface .ql-editor li {
                    color: inherit !important;
                    background: transparent !important;
                    background-color: transparent !important;
                }
                .comp-table .trans-quill,
                .comp-table .trans-quill .ql-container,
                .comp-table .trans-quill .ql-editor {
                    height: 100%;
                    min-height: inherit;
                }
                .ql-editor { min-height: 80px !important; }
            `}} />
        </div>
    );
};

