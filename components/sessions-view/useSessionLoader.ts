import { useEffect } from 'react';
import { getCompetencias, getSesion, getUnidadDidactica } from '../../services/apiService';
import {
    ENFOQUE_DETAILS,
    TRANSVERSAL_NAMES,
    buildAssessmentModelFromData,
    buildSessionAssessmentModel,
    cloneInitialSessionData,
    colorTokenToCss,
    detectInstrumentTypeFromText,
    detectTransversalByCapacity,
    ensureAssessmentModel,
    ensureSessionAssessmentModel,
    escapeHtml,
    getFlexValue,
    getTemplateFillableCellIds,
    instrumentTypeLabelMap,
    isBlackColorToken,
    itemsToHtml,
    normalizeLoose,
    superNormalize
} from './shared';
import { buildDefaultAreaTemplateSessionData, ensureSessionExtraBlocks } from './sessionAiSupport';

interface UseSessionLoaderParams {
    selArea: string;
    selGrade: string;
    selSection: string;
    unitNumber: string;
    sessionNumber: string;
    year: string;
    assignments: any[];
    allSavedPrograms: Record<string, any>;
    bimesterLabel: string;
    sessionLoadRequestRef: { current: number };
    lastSelectionKeyRef: { current: string };
    setSessionData: (value: any) => void;
    setDateOptions: (value: any) => void;
    setSessionDate: (value: any) => void;
    setCompetenciasBase: (value: any) => void;
    setMaxSessionsInUnit: (value: any) => void;
    setToast: (value: any) => void;
    loadTemplateRowsByInstrument: (instrumentLabel: string) => Promise<any>;
    hydrateMissingInstrumentTemplate: (sessionData: any) => Promise<any>;
}

export const useSessionLoader = ({
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
}: UseSessionLoaderParams) => {
    useEffect(() => {
        if (selArea && selGrade && selSection && unitNumber && sessionNumber) {
            const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
            const requestId = ++sessionLoadRequestRef.current;
            const isStaleRequest = () => sessionLoadRequestRef.current !== requestId;
            const selectionKey = `${year}-${selArea}-${selGrade}-${selSection}-U${unitNumber}-S${sessionNumber}`;
            const unitRequest = getUnidadDidactica(year, areaId, selGrade, selSection, unitNumber);
    
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
    
                const unit = await unitRequest;
                if (isStaleRequest()) return;
                if (unit) {
                    const unitSessions = Array.isArray(unit.sesiones) ? unit.sesiones : [];
                    const sessionCount = Math.max(unitSessions.length, 1);
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

                    const buildEvidenceItemsFromCriteria = (criteria: any[], evidenceMap: Record<string, string> | undefined) =>
                        criteria.flatMap((criterion: any) => {
                            const sourceCriteriaId = String(criterion?.sourceCriteriaId || '');
                            const match = sourceCriteriaId.match(/-(\d+)$/);
                            const matrixIndex = match ? Number(match[1]) : Number.NaN;
                            const rawEvidence = Number.isFinite(matrixIndex)
                                ? String(evidenceMap?.[matrixIndex] || '').trim()
                                : '';
                            if (!rawEvidence) return [];
                            return rawEvidence
                                .split(/\r?\n/)
                                .map((text: string) => String(text || '').trim())
                                .filter(Boolean)
                                .map((text: string, evidenceIndex: number) => ({
                                    text,
                                    color: String(criterion?.color || 'text-black'),
                                    sourceCriteriaId,
                                    sourceEvidenceId: `${sourceCriteriaId}-${evidenceIndex}`,
                                    capacidad: String(criterion?.capacidad || '')
                                }));
                        });
                    const currentAreaEvidenceItems = buildEvidenceItemsFromCriteria(prioCriteriaItems, unit.evidencias);
                    const currentTransEvidenceItems = buildEvidenceItemsFromCriteria(transCriteriaItems, unit.evidenciasTrans);
                    const effectiveAreaEvidenceItems = currentAreaEvidenceItems.length ? currentAreaEvidenceItems : prioEvidenceItems;
                    const effectiveTransEvidenceItems = currentTransEvidenceItems.length ? currentTransEvidenceItems : transEvidenceItems;
    
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
                        evidence: itemsToHtml(effectiveAreaEvidenceItems, unitSession?.evi || ''),
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
                    }).filter((row) => activeTransversalSet.has(normalizeLoose(row.comp)));
    
                    if (transCriteriaItems.length || effectiveTransEvidenceItems.length) {
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
                        effectiveTransEvidenceItems.forEach((item: any, i: number) => {
                            const color = colorTokenToCss(String(item?.color || ''));
                            const idx = transColorToIndex[color.toLowerCase()] ?? (i % TRANSVERSAL_NAMES.length);
                            groupedEvidence[idx].push(item);
                        });
    
                        transEvals.forEach((row) => {
                            const idx = TRANSVERSAL_NAMES.findIndex((name) => normalizeLoose(name) === normalizeLoose(row.comp));
                            if (idx < 0) return;
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
                        situation: (() => {
                            const unitSituation = String(unit?.situation || '').trim();
                            const currentSituation = String(prev?.situation || '').trim();
                            const source = String(prev?.situationSource || '').trim();
                            const explicitlyAuthored = source === 'ai' || source === 'manual';
                            const hasCompletedPurpose = Boolean(String(prev?.purpose || '').trim());
                            const shouldStartEmpty = !explicitlyAuthored && (
                                options?.source === 'unit-prefill'
                                || !hasCompletedPurpose
                                || (Boolean(unitSituation) && currentSituation === unitSituation)
                            );
                            return shouldStartEmpty ? '' : prev.situation;
                        })(),
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
                    setMaxSessionsInUnit(Math.max(Number.parseInt(sessionNumber, 10) || 1, 1));
                }
            };
    
            const loadSessionDateFromUnit = async () => {
                const unit = await unitRequest;
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

            const loadPlannedSessionCount = async () => {
                const unit = await unitRequest;
                if (isStaleRequest()) return;
                if (!unit) {
                    setMaxSessionsInUnit(Math.max(Number.parseInt(sessionNumber, 10) || 1, 1));
                    return;
                }
                const unitSessions = Array.isArray(unit.sesiones) ? unit.sesiones : [];
                const explicitCount = Number(
                    unit.sessionCount
                    ?? unit.cantidadSesiones
                    ?? unit.cantidad_sesiones
                    ?? 0
                );
                const highestPlannedNumber = unitSessions.reduce((highest: number, plannedSession: any, index: number) => {
                    const plannedNumber = Number(plannedSession?.sessionNumber ?? plannedSession?.id ?? index + 1);
                    return Number.isFinite(plannedNumber) ? Math.max(highest, plannedNumber) : highest;
                }, 0);
                setMaxSessionsInUnit(Math.max(
                    Number.isFinite(explicitCount) ? explicitCount : 0,
                    unitSessions.length,
                    highestPlannedNumber,
                    1
                ));
            };
    
            const checkSavedSession = async () => {
                await loadPlannedSessionCount();
                if (isStaleRequest()) return;
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
                    const savedDateOptions = Array.isArray(saved?.sessionDateOptions)
                        ? saved.sessionDateOptions
                            .map((option: any) => ({ value: String(option?.value || ''), label: String(option?.label || '') }))
                            .filter((option: any) => option.value)
                        : [];
                    if (savedDateOptions.length > 0) {
                        setDateOptions(savedDateOptions);
                        setSessionDate(String(saved?.selectedSessionDate || ''));
                    } else if (saved.date) {
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
            setMaxSessionsInUnit(Math.max(Number.parseInt(sessionNumber, 10) || 1, 1));
        }
    }, [selArea, selGrade, selSection, unitNumber, sessionNumber, year, assignments, allSavedPrograms]);
};
