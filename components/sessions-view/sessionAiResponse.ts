import {
    AI_ACTIVITY_RESOURCE_PAIRS,
    AI_RICH_TEXT_PATHS,
    buildAssessmentModelFromData,
    buildSessionAssessmentModel,
    buildSessionResourceDefaults,
    ensureAssessmentModel,
    ensureSessionAssessmentModel,
    getPathByString,
    hasPendingTemplateHints,
    isMeaningfulRichText,
    normalizeLoose,
    replaceBracketTokens,
    setPathByString,
    syncResourcesFromActivity
} from './shared';
import {
    ensureSessionExtraBlocks,
    mergeUniqueMultilineText,
    normalizeConstructionStepHtml,
    normalizeNonBreakingSpaceEntities
} from './sessionAiSupport';

interface ApplySessionAiResponseParams {
    aiData: any;
    sessionData: any;
    targetInstrumentRows: any[];
    areaId: string;
    selGrade: string;
    selSection: string;
    unitNumber: string;
    sessionNumber: string;
    bimesterLabel: string;
    currentProgram: any;
}

export const applySessionAiResponse = ({
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
}: ApplySessionAiResponseParams) => {
const placeholderMapRaw = aiData?.placeholderMap && typeof aiData.placeholderMap === 'object' ? aiData.placeholderMap : {};
const placeholderMap: Record<string, string> = {};
Object.keys(placeholderMapRaw).forEach((k) => {
    const key = String(k || '').trim();
    const val = String(placeholderMapRaw[k] || '').trim();
    if (key && val) placeholderMap[key] = val;
});

const fillHtmlField = (current: string, generated: string) => {
    const curr = String(current || '');
    const gen = normalizeNonBreakingSpaceEntities(generated);
    const replacedCurrent = replaceBracketTokens(curr, placeholderMap);
    const replacedGenerated = replaceBracketTokens(gen, placeholderMap);
    if (hasPendingTemplateHints(replacedCurrent) || !isMeaningfulRichText(replacedCurrent)) {
        return normalizeNonBreakingSpaceEntities(replacedGenerated || replacedCurrent);
    }
    return normalizeNonBreakingSpaceEntities(replacedCurrent);
};

const nextData = JSON.parse(JSON.stringify(sessionData));
const nextTitle = replaceBracketTokens(String(aiData?.title || nextData.title || ''), placeholderMap);
const nextPurpose = replaceBracketTokens(String(aiData?.purpose || nextData.purpose || ''), placeholderMap);
const nextSituation = replaceBracketTokens(String(aiData?.situation || nextData.situation || ''), placeholderMap);
const nextExtension = replaceBracketTokens(String(aiData?.extension || nextData.extension || ''), placeholderMap);
if (nextTitle.trim()) nextData.title = nextTitle;
if (nextPurpose.trim()) nextData.purpose = nextPurpose;
if (nextSituation.trim()) {
    nextData.situation = nextSituation;
    nextData.situationSource = 'ai';
}
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
nextData.secuencia.proceso.construccion = normalizeConstructionStepHtml(
    fillHtmlField(nextData.secuencia.proceso.construccion, aiSec?.proceso?.construccion)
);
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
    aiInstrumentRows.length
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

    return ensureSessionExtraBlocks(ensureSessionAssessmentModel(ensureAssessmentModel(nextData, 'ai'), {
        areaId,
        grade: selGrade,
        section: selSection,
        unitNumber,
        sessionNumber,
        bimester: bimesterLabel
    }));
};
