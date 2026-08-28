
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import 'react-quill-new/dist/quill.bubble.css';
import { TeachingAssignment, GeneralData, Student, SessionAssessmentModel } from '../types';
import { getAllSesiones, deleteSesion, getDatosGenerales, getProgramacionesAnuales, saveDatosGenerales, getInstrumentos, getEstudiantes, getEvaluacionRegistros } from '../services/apiService';
import { SessionTemplateMergeView } from './SessionTemplateMergeView';
import { SessionRegisterPanel } from './sessions-view/SessionRegisterPanel';
import { createGeminiClient, generateGeminiContent } from '../utils/gemini';
import { getAiUsageProgress, registerAiUsage, type AiUsageProgress } from '../utils/aiUsage';
import { classifyAiIssue } from '../utils/aiErrors';
import {
    TRANSVERSAL_CAPACITY_MAP,
    DEFAULT_SEQUENCE_TEMPLATE,
    INITIAL_SESSION_DATA,
    detectInstrumentTypeFromText,
    hasFilledInstrumentRows,
    mapTemplateToSessionRowsByType,
    getTemplateFillableCellIds,
    normalizeFilterValue,
    cloneInitialSessionData,
    extractCapacidades,
    buildCriteriosFromInstrumentRows,
    buildSessionAssessmentModel,
    ensureSessionAssessmentModel,
    getPathByString,
    setPathByString,
    stripHtml,
    normalizeLoose,
    buildSessionResourceDefaults,
    escapeRegex,
    hexToRgba,
    isMeaningfulRichText,
    syncResourcesFromActivity,
    autoResizeTextarea,
    instrumentTypeLabelMap,
    MINUTE_DISTRIBUTIONS,
    InternalToast,
    AuthOverlay
} from './sessions-view/shared';
import { readStoredViewSelection, writeStoredViewSelection } from '../utils/viewSelectionStorage';
import {
    createSessionLearningResourceDefaults,
    SessionLearningResources
} from './sessions-view/SessionLearningResources';
import { prepareReusedSessionResources } from './sessions-view/resourceMutations';
import { useSessionAssessmentModel } from './sessions-view/useSessionAssessmentModel';
import { GradingSectionTabs } from './sessions-view/GradingSectionTabs';
import { SessionSequencePanel } from './sessions-view/SessionSequencePanel';
import { SessionSupportingMaterialsPanel } from './sessions-view/SessionSupportingMaterialsPanel';
import { SessionCoreDetailsPanel } from './sessions-view/SessionCoreDetailsPanel';
import { SessionCompetenciesPanel } from './sessions-view/SessionCompetenciesPanel';
import { SessionPlanningHeader } from './sessions-view/SessionPlanningHeader';
import {
    DEFAULT_EXTENSION_ACTIVITIES,
    buildDefaultAreaTemplateSessionData,
    ensureSessionExtraBlocks,
    parseAiJsonObject
} from './sessions-view/sessionAiSupport';
import { buildSessionAiRequest } from './sessions-view/sessionAiRequest';
import { applySessionAiResponse } from './sessions-view/sessionAiResponse';
import { useSessionLoader } from './sessions-view/useSessionLoader';
import { useSessionPersistence } from './sessions-view/useSessionPersistence';
import { useSessionGradingPersistence } from './sessions-view/useSessionGradingPersistence';
import { getSessionDynamicHoursLabel } from './sessions-view/sessionSchedule';
import { useSessionLearningResourceActions } from './sessions-view/useSessionLearningResourceActions';
import { SessionInstrumentSection } from './sessions-view/SessionInstrumentSection';

interface Props {
  activeSection: string;
  onSuccess: () => void;
}

const SESSIONS_VIEW_SELECTION_STORAGE_KEY = 'armi_view_selection_sesiones_v1';
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
    const [toasts, setToasts] = useState<Array<{ id: string; msg: string; type: 'success' | 'error' | 'warning'; usage?: AiUsageProgress | null }>>([]);
    const [allSavedPrograms, setAllSavedPrograms] = useState<Record<string, any>>({});
    const [generalData, setGeneralData] = useState<GeneralData | null>(null);
    const [isGeneratingIA, setIsGeneratingIA] = useState(false);
    const [aiUsageProgress, setAiUsageProgress] = useState<AiUsageProgress>(() => getAiUsageProgress());
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
    const lastAiPromptRef = useRef('');

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

    const setToast = useCallback((nextToast: { msg: string, type: 'success' | 'error' | 'warning'; usage?: AiUsageProgress | null } | null) => {
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

    const dynamicHoursLabel = useMemo(() => getSessionDynamicHoursLabel({
        selArea,
        selGrade,
        selSection,
        sessionDate,
        dateOptions
    }), [selArea, selGrade, selSection, sessionDate, dateOptions]);
    const aiDynamicHoursLabel = dynamicHoursLabel;

    const aiTiempoValues = useMemo(() => {
        const minuteMatches = Array.from(String(aiDynamicHoursLabel || '').matchAll(/\((\d+)\s*min\)/gi));
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
    }, [aiDynamicHoursLabel]);

    const buildCurrentAiRequest = useCallback(() => buildSessionAiRequest({
        aiTiempoValues,
        assignments,
        bimesterLabel,
        currentProgram,
        generalData,
        selArea,
        selGrade,
        selSection,
        sessionData,
        sessionDate,
        sessionNumber,
        unitNumber,
        year
    }), [aiTiempoValues, assignments, bimesterLabel, currentProgram, generalData, selArea, selGrade, selSection, sessionData, sessionDate, sessionNumber, unitNumber, year]);

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
            if (path === 'situation') newData.situationSource = 'manual';
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
        if (!sessionDate) {
            setSessionDate(newDate);
            setIsDatePickerOpen(false);
            return;
        }
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

    const handleSaveIAKey = async (key: string, model: string) => {
        if (!generalData || !key) return;
        setSavingKey(true);
        try {
            const updated = { ...generalData, gemini_api_key: key, gemini_model: model };
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
        const preferredGeminiModel = String(generalData?.gemini_model || '').trim();
        if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.length < 10) {
            setShowAuthScreen(true);
            return;
        }

        setIsGeneratingIA(true);
        try {
            const { areaId, currentSessionAssessmentModel, currentTemplateType, currentInstrumentName, targetInstrumentRows, prompt } = buildCurrentAiRequest();
            const ai = createGeminiClient(apiKey);
            lastAiPromptRef.current = prompt;

            const response = await generateGeminiContent(ai, {
                contents: [{ parts: [{ text: prompt }] }],
                config: { responseMimeType: "application/json", temperature: 0.4 }
            }, preferredGeminiModel);

            const raw = String(response.text || '').trim();
            if (!raw) throw new Error("EMPTY_RESPONSE");
            const aiData = parseAiJsonObject(raw);

            const nextData = applySessionAiResponse({
                aiData,
                sessionData,
                targetInstrumentRows,
                areaId,
                selGrade,
                selSection,
                unitNumber,
                sessionNumber,
                bimesterLabel,
                currentProgram
            });
            setSessionData(nextData);
            registerAiUsage('gemini', 'learning_session', Number(response?.usageMetadata?.totalTokenCount || 0));
            const nextUsage = getAiUsageProgress();
            setAiUsageProgress(nextUsage);
            setToast({ msg: "✅ IA Armi completó la sesión y llenó los descriptores internos del instrumento.", type: 'success', usage: nextUsage });
        } catch (e: any) {
            const issue = classifyAiIssue(e);
            if (issue.kind === 'auth') setShowAuthScreen(true);
            const toastType = issue.kind === 'quota_minute' || issue.kind === 'quota_daily' || issue.kind === 'quota_general' || issue.kind === 'saturation' ? 'warning' : 'error';
            setToast({ msg: `${toastType === 'warning' ? '⚠️' : '❌'} ${issue.userMessage}`, type: toastType });
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

    useSessionLoader({
        selArea,
        selGrade,
        selSection,
        unitNumber,
        sessionNumber,
        year,
        assignments,
        allSavedPrograms,
        bimesterLabel,
        sessionLoadRequestRef,
        lastSelectionKeyRef,
        setSessionData,
        setDateOptions,
        setSessionDate,
        setCompetenciasBase,
        setMaxSessionsInUnit,
        setToast,
        loadTemplateRowsByInstrument,
        hydrateMissingInstrumentTemplate
    });

    const focusMissingSessionField = (field: { key: string; label: string }) => {
        if (field.key === 'date') setIsDatePickerOpen(true);
        window.requestAnimationFrame(() => {
            const target = document.querySelector<HTMLElement>(`[data-session-field="${field.key}"]`);
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            target.classList.add('session-field-missing');
            const focusable = target.matches('input, textarea, select, button, [contenteditable="true"]')
                ? target
                : target.querySelector<HTMLElement>('input, textarea, select, button, [contenteditable="true"]');
            window.setTimeout(() => focusable?.focus({ preventScroll: true }), 350);
            window.setTimeout(() => target.classList.remove('session-field-missing'), 3500);
        });
    };

    const { handleSave } = useSessionPersistence({
        year,
        selArea,
        selGrade,
        selSection,
        unitNumber,
        sessionNumber,
        bimesterLabel,
        assignments,
        sessionData,
        sessionDate,
        dateOptions,
        timeoutRef,
        setSessionData,
        setToast,
        focusMissingSessionField,
        onSuccess
    });

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

    useEffect(() => {
        if (!headerFilled) return;
        let cancelled = false;
        getAllSesiones().then((sessions) => {
            if (!cancelled) setAllSavedSessionsList(Object.values(sessions));
        });
        return () => { cancelled = true; };
    }, [headerFilled, year, currentAreaId, unitNumber]);

    const resourceSuggestion = useMemo(() => {
        const currentField = normalizeLoose(String(sessionData?.competenciaPrio?.field || ''));
        if (!currentField || !currentSessionId) return null;
        const words = (value: string) => new Set(normalizeLoose(value).split(/\s+/).filter((word) => word.length > 3));
        const currentWords = words(currentField);
        if (!currentWords.size) return null;

        let best: any = null;
        let bestScore = 0;
        allSavedSessionsList.forEach((candidate: any) => {
            if (!candidate || candidate.id === currentSessionId || String(candidate.year) !== String(year)) return;
            if (String(candidate.areaId) !== String(currentAreaId) || String(candidate.unitNumber) !== String(unitNumber)) return;
            const resources = createSessionLearningResourceDefaults(candidate.learningResources);
            const hasReusableResource = Object.values(resources).some((resource) => !!resource.imageUrl);
            if (!hasReusableResource) return;
            const candidateWords = words(String(candidate.thematicField || ''));
            const intersection = [...currentWords].filter((word) => candidateWords.has(word)).length;
            const union = new Set([...currentWords, ...candidateWords]).size || 1;
            const score = intersection / union;
            if (score >= 0.45 && score > bestScore) {
                bestScore = score;
                best = {
                    sessionId: candidate.id,
                    label: `${candidate.title || 'Sesión'} · ${candidate.grade || ''} ${candidate.section || ''}`.trim(),
                    resources
                };
            }
        });
        return best;
    }, [allSavedSessionsList, currentAreaId, currentSessionId, sessionData?.competenciaPrio?.field, unitNumber, year]);

    const {
        isGeneratingResources,
        generatingResourceKey,
        resourceGenerationErrors,
        updateLearningResources,
        copyResourcePrompts,
        handleGenerateResource,
        handleGenerateAllResources,
        handleUploadResource
    } = useSessionLearningResourceActions({
        currentSessionId,
        selArea,
        selGrade,
        selSection,
        unitNumber,
        bimesterLabel,
        sessionNumber,
        maxSessionsInUnit,
        aiDynamicHoursLabel,
        sessionData,
        generalData,
        setSessionData,
        setShowAuthScreen,
        setAiUsageProgress,
        setToast
    });

    const {
        gradingSections,
        gradingStudents,
        assessmentTemplateModel,
        canonicalInstrumentRows,
        rubricRowMode,
        rubricAutoRowsByMode,
        filteredStudents,
        gradingCriteriaRows,
        checklistLevelMapping,
        gradingGuideLevels,
        gradingCanonicalLevels,
        normalizeGradingLevelToCode,
        gradingCodeToStoredLevel,
        gradingSessionGroups
    } = useSessionAssessmentModel({
        students: students || [],
        grade: selGrade,
        section: selSection,
        activeSection: activeGradingSection,
        assessmentModel: sessionAssessmentModel,
        sessionData
    });

    const {
        getGradingKey,
        updateGradingRecord,
        serializeGradingRecords,
        handleSaveGrading
    } = useSessionGradingPersistence({
        currentSessionId,
        currentUnitId,
        gradingCriteriaRows,
        gradingStudents,
        gradingSessionGroups,
        gradingRecords,
        sessionData,
        setGradingRecords,
        setGradingSaving,
        setToast
    });

    useEffect(() => {
        if (!gradingSections.length) {
            setActiveGradingSection('');
            return;
        }
        setActiveGradingSection(prev => (
            prev && gradingSections.includes(prev)
                ? prev
                : gradingSections[0]
        ));
    }, [gradingSections]);

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

    const renderSessionRegisterPanel = () => {
        return (
            <SessionRegisterPanel
                currentSessionId={currentSessionId}
                bimesterLabel={bimesterLabel}
                filteredStudents={filteredStudents}
                generalData={generalData}
                gradingCanonicalLevels={gradingCanonicalLevels}
                gradingCriteriaRows={gradingCriteriaRows}
                gradingLoading={gradingLoading}
                gradingRecords={gradingRecords}
                gradingSectionTabs={(
                    <GradingSectionTabs
                        sections={gradingSections}
                        activeSection={activeGradingSection}
                        students={gradingStudents}
                        onChange={setActiveGradingSection}
                    />
                )}
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
                            usage={t.usage}
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
                    initialKey={generalData?.gemini_api_key || ''}
                    initialModel={generalData?.gemini_model || ''}
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

            <SessionPlanningHeader
                themeColor={themeColor}
                setThemeColor={setThemeColor}
                year={year}
                bimesterLabel={bimesterLabel}
                headerFilled={headerFilled}
                isGeneratingIA={isGeneratingIA}
                aiUsageProgress={aiUsageProgress}
                handleGenerateAI={handleGenerateAI}
                setShowAuthScreen={setShowAuthScreen}
                handleSave={handleSave}
                setSessionData={setSessionData}
                handleOpenManager={handleOpenManager}
                handleOpenTemplateMode={handleOpenTemplateMode}
                dynamicHoursLabel={dynamicHoursLabel}
                uniqueAreas={uniqueAreas}
                selArea={selArea}
                setSelArea={setSelArea}
                availableGrades={availableGrades}
                selGrade={selGrade}
                setSelGrade={setSelGrade}
                availableSections={availableSections}
                selSection={selSection}
                setSelSection={setSelSection}
                unitNumber={unitNumber}
                setUnitNumber={setUnitNumber}
                maxSessionsInUnit={maxSessionsInUnit}
                sessionNumber={sessionNumber}
                setSessionNumber={setSessionNumber}
                dateOptions={dateOptions}
                sessionDate={sessionDate}
                isDatePickerOpen={isDatePickerOpen}
                setIsDatePickerOpen={setIsDatePickerOpen}
                triggerDateChange={triggerDateChange}
                sessionMode={sessionMode}
                setSessionMode={setSessionMode}
            />

            {headerFilled ? (
                sessionMode === 'calificacion' ? (
                    renderCalificacionView()
                ) : (
                <>
                    <SessionCoreDetailsPanel
                        themeColor={themeColor}
                        sessionData={sessionData}
                        handleInputChange={handleInputChange}
                    />

                    <SessionCompetenciesPanel
                        themeColor={themeColor}
                        sessionData={sessionData}
                        visibleTransRows={visibleTransRows}
                        handleInputChange={handleInputChange}
                        getTransversalSurfaceStyle={getTransversalSurfaceStyle}
                        getTransversalTextColor={getTransversalTextColor}
                        getTransversalSurfaceColor={getTransversalSurfaceColor}
                    />

                    <SessionSequencePanel
                        themeColor={themeColor}
                        sessionData={sessionData}
                        tiempoValues={tiempoValues}
                        handleInputChange={handleInputChange}
                        debouncedSync={debouncedSync}
                        handleSaveAsTemplate={handleSaveAsTemplate}
                        handleExportJson={handleExportJson}
                        handleImportJson={handleImportJson}
                        handleRestoreTemplate={handleRestoreTemplate}
                    />

                    <SessionSupportingMaterialsPanel
                        themeColor={themeColor}
                        sessionData={sessionData}
                        handleInputChange={handleInputChange}
                        handleFillExtensionDefaults={handleFillExtensionDefaults}
                        handleFillResourceDefaults={handleFillResourceDefaults}
                        handleFillBibliographyDefaults={handleFillBibliographyDefaults}
                    />

                    <SessionInstrumentSection
                        themeColor={themeColor}
                        sessionData={sessionData}
                        canonicalInstrumentRows={canonicalInstrumentRows}
                        assessmentTemplateModel={assessmentTemplateModel}
                        checklistLevelMapping={checklistLevelMapping}
                        gradingCriteriaRows={gradingCriteriaRows}
                        gradingGuideLevels={gradingGuideLevels}
                        rubricRowMode={rubricRowMode}
                        rubricAutoRowsByMode={rubricAutoRowsByMode}
                        handleInputChange={handleInputChange}
                        getTransversalSurfaceStyle={getTransversalSurfaceStyle}
                        getTransversalSurfaceColor={getTransversalSurfaceColor}
                        getTransversalTextColor={getTransversalTextColor}
                    />

                    <div className="bg-white rounded-[2.5rem] shadow-xl border overflow-hidden relative z-10" style={{ borderColor: themeColor }}>
                        <div className="text-white p-4 text-center font-black uppercase text-xs tracking-widest flex items-center justify-center gap-3" style={{ backgroundColor: themeColor }}>
                            <span className="text-xl">🖼️</span> XI. RECURSOS VISUALES DE LA SESIÓN
                        </div>
                        <SessionLearningResources
                            value={createSessionLearningResourceDefaults(sessionData?.learningResources)}
                            generating={isGeneratingResources || generatingResourceKey !== null}
                            generatingKey={generatingResourceKey}
                            generationErrors={resourceGenerationErrors}
                            suggestion={resourceSuggestion}
                            onChange={updateLearningResources}
                            onGenerateAll={() => { void handleGenerateAllResources(); }}
                            onGenerateOne={(key) => { void handleGenerateResource(key); }}
                            onCopyAllPrompts={() => { void copyResourcePrompts(['instructive', 'annex1', 'annex2']); }}
                            onCopyPrompt={(key) => { void copyResourcePrompts([key]); }}
                            onUpload={(key, file) => { void handleUploadResource(key, file); }}
                            onUseSuggestion={() => {
                                if (!resourceSuggestion) return;
                                const reused = prepareReusedSessionResources(
                                    resourceSuggestion.resources,
                                    resourceSuggestion.sessionId
                                );
                                updateLearningResources(reused);
                                setToast({ msg: '♻️ Recursos reutilizados. No se consumieron tokens de IA.', type: 'success' });
                            }}
                        />
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

