import React from 'react';
import { CustomDatePicker, InternalToast, AuthOverlay } from './overlays';
import type { SessionAssessmentModel, SessionAssessmentCriterionRow, SessionAssessmentLevelCode, SessionAssessmentRowType } from '../../types';

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

const TRANSVERSAL_NAMES = [
    "Se desenvuelve en los entornos virtuales generados por las TIC",
    "Gestiona su aprendizaje de manera autónoma"
];

const TRANSVERSAL_CAPACITY_MAP: Record<string, string[]> = {
    [TRANSVERSAL_NAMES[0]]: [
        "Personaliza entornos virtuales",
        "Gestiona información del entorno virtual",
        "Interactúa en entornos virtuales",
        "Crea objetos virtuales en diversos formatos"
    ],
    [TRANSVERSAL_NAMES[1]]: [
        "Define metas de aprendizaje",
        "Organiza acciones estratégicas para alcanzar sus metas de aprendizaje",
        "Monitorea y ajusta su desempeño durante el proceso de aprendizaje"
    ]
};

// Al inicio del archivo o en un util
const multiline = (strings: TemplateStringsArray, ...values: any[]) => 
  String.raw({ raw: strings }, ...values).trim();

        const DEFAULT_SEQUENCE_TEMPLATE = {
            saberes: '<p><span style="color: black/20;">El docente ingresa al aula saludando cordialmente a los estudiantes y posteriormente toma asistencia. Luego pide a los estudiantes que recuerden los contenidos que aprendieron en la sesión anterior, así como los elementos que fueron necesarios para realizarla.</span><br><span style="color: green;">A) [Pregunta saberes 1]</span><br><span style="color: green;">B) [Pregunta saberes 2]</span><br><span style="color: black/20;">El docente les muestra el recurso contenido en el <strong>Anexo N° 1</strong>, que hace referencia al campo temático de la presente sesión.</span></p>',
            saberes_recursos: '<ul><li>Proyector</li><li>Expresión Oral</li><li>Pizarra</li><li>Plumones</li></ul>',
            conflicto: '<p><span style="color: black/20;">Mediante la técnica de </span><span style="color: green;">lluvia de ideas</span><span style="color: black/20;"> el docente interactúa con los estudiantes realizando preguntas para generar interés en el aprendizaje:</span><br><span style="color: green;">A) [Pregunta conflicto 1]</span><br><span style="color: green;">B) [Pregunta conflicto 2]</span><br><span style="color: black/20;">Luego el docente presenta el <strong>título</strong> de la sesión de aprendizaje, explica el <strong>propósito</strong> e indica cuál será el <strong>producto</strong> a desarrollar.</span></p>',
            conflicto_recursos: '<ul><li>Expresión oral</li><li>Expresión corporal</li><li>Plumones</li></ul>',
            construccion: multiline`
            <p>
                <span style="color: black/20;">El docente presenta la situación problemática, resaltando que </span>
                <span style="color: green;">[<em>resaltar la importancia de lo que se aprende</em>].</span>
                <span style="color: black/20;">Luego proyecta el <strong>Instructivo N° 1</strong>.</span>
                <br>
                <br><strong>PRIMERO:</strong></br>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                <br><strong>SEGUNDO:</strong></br>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                <br><strong>TERCERO:</strong></br>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
                    <p><span style="color: green;">  - [Introducir texto aquí.]</spam></p>
            </p>`,
            construccion_recursos: '<ul><li>PC/Laptops</li><li>Plumones</li><li>Pizarra</li><li>Proyector</li></ul>',
            aplicacion: multiline`
                        <p><span style="color: rgba(0,0,0,0.73);">Posteriormente el docente reparte el <strong>Anexo N° 2</strong> a cada estudiante para que puedan demostrar los aprendizajes adquiridos, realizando el producto propuesto para la sesión en su <span style="color: green;"><em>[cuaderno/laptop/PC/celular]</em></span>, según las indicaciones proporcionadas.</span></p>
                        <p><span style="color: rgba(0,0,0,0.73);">El docente apoya y orienta en todo momento de acuerdo a las diversas dificultades que se presenten durante el desarrollo del tema, realimentando y reflexionando sobre el proceso de enseñanza-aprendizaje del tema tratado.</span></p>
                        <br>
                        <p><span style="color: rgba(0,0,0,0.6);">Luego el docente indica que guarden su trabajo en el dispositivo que hayan usado en clase, usando la siguiente ruta:</span></p>
                        <p><span style="color: rgba(0,0,0,0.6);"><strong><em>• //SERVIDOR/2.- EVIDENCIAS/[GRADO_SECCION]</em></strong></span></p>
                        <p><span style="color: rgba(0,0,0,0.6);">El nombre del archivo debe tener la siguiente estructura:</span></p>
                        <p><span style="color: rgba(0,0,0,0.6);"><strong><em>• [BIMESTRE] - Unidad N° [UNIDAD] - Sesión N° [SESION] - APELLIDOS Nombres</em></strong></span></p>
                        <br>
                        <p><span style="color: rgba(0,0,0,0.6);">El docente evaluará la sesión durante todo el proceso de aprendizaje a través de una 
                            <strong>[INSTRUMENTO]</strong>. Una vez terminado su producto el docente solicita a 2 estudiantes voluntarios (o seleccionados/as), para que expongan sus trabajos.</span></p>`,
            aplicacion_recursos: '<ul><li>Observación</li></ul>',
            metacognicion: '<p><span style="color: black/20;">El docente finaliza la  sesión aplicando la metacognición y mediante las respuestas a las interrogantes planteadas como por ejemplo: </span></p><p><span style="color: black/20;">• ¿Qué dificultades tuvieron al elaborar su producto para ésta sesión?</span></p><p><span style="color: black/20;">• ¿Qué aprendizajes obtuvieron?</span></p>',
            metacognicion_recursos: '<ul><li>Cuadernos</li><li>Expresión Oral</li><li>Expresión Corporal</li></ul>',
            evaluacion: multiline`
                        <p>
                            <span style="color: rgba(0, 0, 0, 0.73);">El docente evalúa todo el proceso de aprendizaje a través de una 
                                    <strong>[INSTRUMENTO]</strong>,
                                     verifica si los estudiantes han logrado el propósito de la sesión, y realiza un reforzamiento en caso de ser necesario.
                            </span>
                        </p>`,
            evaluacion_recursos: '<ul><li>Expresión Oral</li></ul>',
        };

const INITIAL_SESSION_DATA = {
    title: '', purpose: '', situation: '',
    dateChangeMotive: '',
    competenciaPrio: { comp: '', cap: '', des: '', field: '', evidence: '', inst: '' },
    competenciasTrans: [
        { comp: TRANSVERSAL_NAMES[0], cap: '', des: '', field: '', evidence: '', inst: '' },
        { comp: TRANSVERSAL_NAMES[1], cap: '', des: '', field: '', evidence: '', inst: '' }
    ],
    enfoqueTrans: { enfoque: '', valor: '', acciones: '', demuestra: '' },
    secuencia: {
        inicio: { 
            saberes: '', saberes_recursos: DEFAULT_SEQUENCE_TEMPLATE.saberes_recursos,
            conflicto: '', conflicto_recursos: DEFAULT_SEQUENCE_TEMPLATE.conflicto_recursos,
            tiempo: "5'" 
        },
        proceso: { 
            construccion: '', construccion_recursos: DEFAULT_SEQUENCE_TEMPLATE.construccion_recursos,
            aplicacion: '', aplicacion_recursos: DEFAULT_SEQUENCE_TEMPLATE.aplicacion_recursos,
            metacognicion: '', metacognicion_recursos: DEFAULT_SEQUENCE_TEMPLATE.metacognicion_recursos,
            tiempo: "15'" 
        },
        salida: { 
            evaluacion: '', evaluacion_recursos: DEFAULT_SEQUENCE_TEMPLATE.evaluacion_recursos,
            tiempo: "5'" 
        }
    },
    extension: '',
    recursos: { rec: '', med: '', mat: '', soft: '', esp: '' },
    bibliografia: { bib: '', link: '' },
    instrumento: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, criterio: '', c: '', b: '', a: '', ad: '' }))
};

type SessionInstrumentType = 'rubrica' | 'lista_cotejo' | 'escala_valoracion' | 'guia_observacion';

const detectInstrumentTypeFromText = (value: string): SessionInstrumentType | null => {
    const norm = normalizeLoose(value);
    if (!norm) return null;
    if (norm.includes('rubrica')) return 'rubrica';
    if (norm.includes('lista de cotejo') || norm.includes('cotejo')) return 'lista_cotejo';
    if (norm.includes('escala de valoracion') || norm.includes('valoracion')) return 'escala_valoracion';
    if (norm.includes('guia de observacion') || norm.includes('observacion')) return 'guia_observacion';
    return null;
};

const hasFilledInstrumentRows = (rows: any) =>
    Array.isArray(rows) && rows.some((row: any) =>
        normalizeLoose([
            row?.criterio,
            row?.c,
            row?.b,
            row?.a,
            row?.ad
        ].join(' ')).length > 0
    );

const getLayoutTexts = (structure: any): Record<string, string> =>
    structure?.layout?.texts && typeof structure.layout.texts === 'object' ? structure.layout.texts : {};

const getLayoutCell = (texts: Record<string, string>, r: number, c: number) => String(texts[`${r}:${c}`] || '').trim();

const layoutCellId = (r: number, c: number) => `${r}:${c}`;

const getTemplateCellStyle = (style: any): React.CSSProperties => {
    const borderColor = String(style?.borderColor || '#cbd5e1');
    const borderStyle = String(style?.borderStyle || 'solid');
    const baseBorderWidth = Number(style?.borderWidth ?? 1);
    const topW = style?.borderTop === false ? 0 : Number(style?.borderTopWidth ?? baseBorderWidth);
    const rightW = style?.borderRight === false ? 0 : Number(style?.borderRightWidth ?? baseBorderWidth);
    const bottomW = style?.borderBottom === false ? 0 : Number(style?.borderBottomWidth ?? baseBorderWidth);
    const leftW = style?.borderLeft === false ? 0 : Number(style?.borderLeftWidth ?? baseBorderWidth);

    return {
        ...(style?.color ? { color: style.color } : {}),
        ...(style?.bg ? { backgroundColor: style.bg } : {}),
        ...(style?.bold ? { fontWeight: 700 } : {}),
        ...(style?.italic ? { fontStyle: 'italic' } : {}),
        ...(style?.underline ? { textDecoration: 'underline' } : {}),
        ...(style?.align ? { textAlign: style.align } : {}),
        ...((style?.vAlign || style?.valign) ? { verticalAlign: style.vAlign || style.valign } : {}),
        ...(style?.fontSize ? { fontSize: `${Number(style.fontSize) || 10}px` } : {}),
        borderTop: `${Math.max(0, topW)}px ${borderStyle} ${borderColor}`,
        borderRight: `${Math.max(0, rightW)}px ${borderStyle} ${borderColor}`,
        borderBottom: `${Math.max(0, bottomW)}px ${borderStyle} ${borderColor}`,
        borderLeft: `${Math.max(0, leftW)}px ${borderStyle} ${borderColor}`
    };
};

const getTemplateOrientationStyle = (orientation: string): React.CSSProperties =>
    String(orientation || '').toLowerCase() === 'vertical'
        ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)' }
        : {};

const getTemplateOrientationBoxStyle = (orientation: string, text: string): React.CSSProperties => ({
    ...getTemplateOrientationStyle(orientation),
    ...(String(text || '').length > 80 ? { whiteSpace: 'normal' } : {})
});

const getGuideHierarchyFromTemplate = (structure: any, assessmentModel?: any) => {
    const modelRowsHierarchy = buildCompetencyHierarchyFromAssessmentRows(assessmentModel?.rows);
    if (modelRowsHierarchy.length > 0) {
        return modelRowsHierarchy.map((competency: any, compIdx: number) => ({
            name: competency.name,
            source: competency.source,
            capacities: competency.capacities.map((capacity: any, capIdx: number) => ({
                id: capacity?.id || `cap-${compIdx + 1}-${capIdx + 1}`,
                name: capacity.name,
                source: capacity.source,
                criteria: (Array.isArray(capacity?.criteria) ? capacity.criteria : []).map((criterion: any, critIdx: number) => ({
                    id: criterion?.id || `crit-${compIdx + 1}-${capIdx + 1}-${critIdx + 1}`,
                    name: criterion?.name || `Criterio ${critIdx + 1}`,
                    source: criterion?.source || capacity.source
                }))
            }))
        }));
    }

    const templateCompetenciesRaw = Array.isArray(structure?.competencies)
        ? structure.competencies
        : [];
    const legacyAspects = Array.isArray(structure?.aspects) ? structure.aspects : [];
    const modelCompetencia = String(assessmentModel?.competencia || '').trim();
    const modelCapacidades = (Array.isArray(assessmentModel?.capacidades) ? assessmentModel.capacidades : [])
        .map((cap: any) => String(cap || '').trim())
        .filter(Boolean);
    const modelCriterios = (Array.isArray(assessmentModel?.criterios) ? assessmentModel.criterios : [])
        .map((crit: any) => String(crit?.text || crit?.name || crit?.criterio || '').trim())
        .filter(Boolean);

    const normalizeCriterionText = (criterion: any, fallback: string) =>
        String(criterion?.name || criterion?.text || criterion?.criterio || fallback).trim();

    const normalizeCapacityName = (capacity: any, fallback: string) =>
        String(capacity?.name || capacity?.title || capacity?.capacidad || fallback).trim();

    const normalizeCompetencyName = (competency: any, fallback: string) =>
        String(competency?.name || competency?.title || competency?.competencia || fallback).trim();

    if (modelCompetencia || modelCapacidades.length > 0 || modelCriterios.length > 0) {
        const templateCompetency = templateCompetenciesRaw[0] || {};
        const templateCapacitiesRaw = Array.isArray(templateCompetency?.capacities) ? templateCompetency.capacities : [];
        const capacityNames = modelCapacidades.length > 0
            ? modelCapacidades
            : templateCapacitiesRaw.map((cap: any, idx: number) => normalizeCapacityName(cap, `CAPACIDAD ${idx + 1}`)).filter(Boolean);
        const fallbackCapCount = Math.max(1, Number(structure?.capacitiesPerCompetency || templateCapacitiesRaw.length || legacyAspects.length || 1));
        const normalizedCapacityNames = capacityNames.length > 0
            ? capacityNames
            : Array.from({ length: fallbackCapCount }, (_, idx) => `CAPACIDAD ${idx + 1}`);
        const criteriaBuckets = splitCriteriaAcrossCapacities(modelCriterios, normalizedCapacityNames.length);
        return [{
            name: modelCompetencia || normalizeCompetencyName(templateCompetency, 'COMPETENCIA 1'),
            capacities: normalizedCapacityNames.map((capName, idx) => ({
                name: capName,
                criteria: criteriaBuckets[idx].length > 0
                    ? criteriaBuckets[idx]
                    : (((templateCapacitiesRaw[idx]?.criteria || []) as any[])
                        .map((crit: any, critIdx: number) => normalizeCriterionText(crit, `Criterio ${critIdx + 1}`))
                        .filter(Boolean))
            }))
        }];
    }

    if (templateCompetenciesRaw.length > 0) {
        return templateCompetenciesRaw.map((competency: any, compIdx: number) => ({
            name: normalizeCompetencyName(competency, `COMPETENCIA ${compIdx + 1}`),
            capacities: (Array.isArray(competency?.capacities) ? competency.capacities : []).map((capacity: any, capIdx: number) => ({
                id: capacity?.id || `cap-${compIdx + 1}-${capIdx + 1}`,
                name: normalizeCapacityName(capacity, `CAPACIDAD ${capIdx + 1}`),
                criteria: (Array.isArray(capacity?.criteria) ? capacity.criteria : [])
                    .map((criterion: any, critIdx: number) => ({
                        id: criterion?.id || `crit-${compIdx + 1}-${capIdx + 1}-${critIdx + 1}`,
                        name: normalizeCriterionText(criterion, `Criterio ${critIdx + 1}`)
                    }))
                    .filter((criterion: any) => String(criterion?.name || '').trim().length > 0)
            }))
        }));
    }

    return [{
        name: 'COMPETENCIA 1',
        capacities: (legacyAspects.length > 0 ? legacyAspects : Array.from({ length: 4 }, () => ({ name: '' }))).map((aspect: any, idx: number) => ({
            id: aspect?.id || `cap-1-${idx + 1}`,
            name: normalizeCapacityName(aspect, `CAPACIDAD ${idx + 1}`),
            criteria: [{ id: `crit-1-${idx + 1}-1`, name: `Criterio ${idx + 1}` }]
        }))
    }];
};

const getGuideCapacityCountFromTemplate = (structure: any) =>
    getGuideHierarchyFromTemplate(structure).reduce((acc: number, competency: any) => acc + ((competency?.capacities || []).length), 0);

const getGuideColumnWidthsFromTemplate = (structure: any) => {
    const capacitiesCount = Math.max(
        1,
        Number(getGuideCapacityCountFromTemplate(structure) || structure?.capacitiesCount || structure?.aspectsCount || (Array.isArray(structure?.aspects) ? structure.aspects.length : 0) || 4)
    );
    const numPct = 4;
    const logroPct = 6;
    const namePct = Math.max(28, 58 - (capacitiesCount * 5));
    const levelBudgetPct = 100 - numPct - logroPct - namePct;
    const totalLevelUnits = Math.max(capacitiesCount * (3 + 1.35), 1);
    const unitWidth = levelBudgetPct / totalLevelUnits;

    return {
        num: `${numPct}%`,
        name: `${namePct}%`,
        level: `${unitWidth}%`,
        levelWide: `${unitWidth * 1.35}%`,
        logro: `${logroPct}%`
    };
};

const TEMPLATE_GUIDE_LEVELS = ['C', 'B', 'A', 'AD'] as const;

type ChecklistTemplateRow = {
    kind: 'comp' | 'cap' | 'crit';
    comp: string;
    cap: string;
    text: string;
    source?: 'primary' | 'transversal';
};

type ScaleTemplateRow = {
    kind: 'comp' | 'cap' | 'crit';
    comp: string;
    cap: string;
    text: string;
};

const buildCompetencyHierarchyFromAssessmentRows = (rows: any[]) => {
    const orderedRows = (Array.isArray(rows) ? rows : [])
        .filter((row: any) => !!normalizeLoose(row?.criterionText || row?.capacityName || row?.competencyName))
        .slice()
        .sort((a: any, b: any) => Number(a?.order || 0) - Number(b?.order || 0));

    const competencies: any[] = [];
    orderedRows.forEach((row: any, idx: number) => {
        const source = String(row?.source || 'primary').trim() || 'primary';
        const competencyName = String(row?.competencyName || `Competencia ${idx + 1}`).trim() || `Competencia ${idx + 1}`;
        const capacityName = String(row?.capacityName || `Capacidad ${idx + 1}`).trim() || `Capacidad ${idx + 1}`;
        const criterionText = String(row?.criterionText || '').trim();
        const competencyKey = `${source}::${normalizeLoose(competencyName)}`;
        let competency = competencies.find((item) => item.key === competencyKey);
        if (!competency) {
            competency = { key: competencyKey, name: competencyName, source, capacities: [] as any[] };
            competencies.push(competency);
        }
        const capacityKey = `${source}::${normalizeLoose(capacityName)}`;
        let capacity = competency.capacities.find((item: any) => item.key === capacityKey);
        if (!capacity) {
            capacity = { key: capacityKey, name: capacityName, source, criteria: [] as any[] };
            competency.capacities.push(capacity);
        }
        if (criterionText) {
            capacity.criteria.push({
                id: String(row?.id || `${idx + 1}`),
                name: criterionText,
                source
            });
        }
    });

    return competencies;
};

const splitCriteriaAcrossCapacities = (criteria: string[], capacityCount: number) => {
    const safeCapacityCount = Math.max(1, capacityCount || 1);
    const buckets = Array.from({ length: safeCapacityCount }, () => [] as string[]);
    if (criteria.length === 0) return buckets;
    let offset = 0;
    for (let idx = 0; idx < safeCapacityCount; idx += 1) {
        const remainingCriteria = criteria.length - offset;
        const remainingCaps = safeCapacityCount - idx;
        const take = Math.max(1, Math.ceil(remainingCriteria / Math.max(remainingCaps, 1)));
        buckets[idx] = criteria.slice(offset, offset + take);
        offset += take;
    }
    return buckets;
};

const normalizeChecklistStructureForTemplate = (structure: any, assessmentModel?: any) => {
    const modelRowsHierarchy = buildCompetencyHierarchyFromAssessmentRows(assessmentModel?.rows);
    if (modelRowsHierarchy.length > 0) {
        return modelRowsHierarchy.map((competency: any) => ({
            name: competency.name,
            source: competency.source,
            capacities: competency.capacities.map((capacity: any) => ({
                name: capacity.name,
                source: capacity.source,
                criteria: (Array.isArray(capacity.criteria) ? capacity.criteria : []).map((criterion: any) => criterion.name).filter(Boolean)
            }))
        }));
    }

    const templateCompetenciesRaw = Array.isArray(structure?.competencies)
        ? structure.competencies
        : [];
    const legacyItems = Array.isArray(structure?.items) ? structure.items : [];
    const modelCompetencia = String(assessmentModel?.competencia || '').trim();
    const modelCapacidades = (Array.isArray(assessmentModel?.capacidades) ? assessmentModel.capacidades : [])
        .map((cap: any) => String(cap || '').trim())
        .filter(Boolean);
    const modelCriterios = (Array.isArray(assessmentModel?.criterios) ? assessmentModel.criterios : [])
        .map((crit: any) => String(crit?.text || crit?.name || crit?.criterio || '').trim())
        .filter(Boolean);

    const normalizeCriterionText = (criterion: any, fallback: string) =>
        String(criterion?.name || criterion?.text || criterion?.criterio || fallback).trim();

    const normalizeCapacityName = (capacity: any, fallback: string) =>
        String(capacity?.name || capacity?.title || capacity?.capacidad || fallback).trim();

    const normalizeCompetencyName = (competency: any, fallback: string) =>
        String(competency?.name || competency?.title || competency?.competencia || fallback).trim();

    if (modelCompetencia || modelCapacidades.length > 0 || modelCriterios.length > 0) {
        const templateCompetency = templateCompetenciesRaw[0] || {};
        const templateCapacitiesRaw = Array.isArray(templateCompetency?.capacities) ? templateCompetency.capacities : [];
        const capacityNames = modelCapacidades.length > 0
            ? modelCapacidades
            : templateCapacitiesRaw.map((cap: any, idx: number) => normalizeCapacityName(cap, `CAPACIDAD ${idx + 1}`)).filter(Boolean);
        const fallbackCapCount = Math.max(1, Number(structure?.capacitiesPerCompetency || templateCapacitiesRaw.length || 1));
        const normalizedCapacityNames = capacityNames.length > 0
            ? capacityNames
            : Array.from({ length: fallbackCapCount }, (_, idx) => `CAPACIDAD ${idx + 1}`);
        const criteriaBuckets = splitCriteriaAcrossCapacities(modelCriterios, normalizedCapacityNames.length);
        return [
            {
                name: modelCompetencia || normalizeCompetencyName(templateCompetency, 'COMPETENCIA 1'),
                capacities: normalizedCapacityNames.map((capName, idx) => ({
                    name: capName,
                    criteria: criteriaBuckets[idx].length > 0
                        ? criteriaBuckets[idx]
                        : (((templateCapacitiesRaw[idx]?.criteria || []) as any[])
                            .map((crit: any, critIdx: number) => normalizeCriterionText(crit, `Criterio ${critIdx + 1}`))
                            .filter(Boolean))
                }))
            }
        ];
    }

    if (templateCompetenciesRaw.length > 0) {
        return templateCompetenciesRaw.map((competency: any, compIdx: number) => ({
            name: normalizeCompetencyName(competency, `COMPETENCIA ${compIdx + 1}`),
            capacities: (Array.isArray(competency?.capacities) ? competency.capacities : []).map((capacity: any, capIdx: number) => ({
                name: normalizeCapacityName(capacity, `CAPACIDAD ${capIdx + 1}`),
                criteria: (Array.isArray(capacity?.criteria) ? capacity.criteria : [])
                    .map((criterion: any, critIdx: number) => normalizeCriterionText(criterion, `Criterio ${critIdx + 1}`))
                    .filter(Boolean)
            }))
        }));
    }

    const legacyCriteria = legacyItems
        .map((item: any, idx: number) => ({
            text: String(item?.name || item?.text || item?.criterio || `Criterio ${idx + 1}`).trim(),
            competencia: String(item?.competencia || item?.competency || '').trim(),
            capacidad: String(item?.capacidad || item?.capacity || item?.cap || '').trim()
        }))
        .filter((item: any) => item.text.length > 0);

    if (legacyCriteria.length === 0) {
        return [{
            name: 'COMPETENCIA 1',
            capacities: [{
                name: 'CAPACIDAD 1',
                criteria: Array.from({ length: 4 }, () => '')
            }]
        }];
    }

    const competenciaName = legacyCriteria[0]?.competencia || 'COMPETENCIA 1';
    const capacityNames = Array.from(new Set(legacyCriteria.map((item: any) => item.capacidad).filter(Boolean)));
    const normalizedCapacityNames = capacityNames.length > 0 ? capacityNames : ['CAPACIDAD 1'];
    const buckets = splitCriteriaAcrossCapacities(legacyCriteria.map((item: any) => item.text), normalizedCapacityNames.length);
    return [{
        name: competenciaName,
        capacities: normalizedCapacityNames.map((name, idx) => ({
            name,
            criteria: buckets[idx]
        }))
    }];
};

const buildChecklistVisualRowsForTemplate = (structure: any, assessmentModel?: any): ChecklistTemplateRow[] => {
    const competencies = normalizeChecklistStructureForTemplate(structure, assessmentModel);
    const out: ChecklistTemplateRow[] = [];

    competencies.forEach((competency: any, compIdx: number) => {
        const compLabel = String(competency?.name || `COMPETENCIA ${compIdx + 1}`).trim();
        const compSource = String(competency?.source || '').trim() === 'transversal' ? 'transversal' : 'primary';
        out.push({ kind: 'comp', comp: String(compIdx + 1), cap: '', text: compLabel, source: compSource });

        const capacities = Array.isArray(competency?.capacities) ? competency.capacities : [];
        capacities.forEach((capacity: any, capIdx: number) => {
            const capLabel = String(capacity?.name || `CAPACIDAD ${capIdx + 1}`).trim();
            const criteria = (Array.isArray(capacity?.criteria) ? capacity.criteria : [])
                .map((criterion: any, critIdx: number) => String(criterion || `Criterio ${critIdx + 1}`).trim());
            const capSource = String(capacity?.source || competency?.source || '').trim() === 'transversal' ? 'transversal' : 'primary';

            out.push({ kind: 'cap', comp: String(compIdx + 1), cap: String(capIdx + 1), text: capLabel, source: capSource });
            if (criteria.length === 0) {
                out.push({ kind: 'crit', comp: String(compIdx + 1), cap: String(capIdx + 1), text: '', source: capSource });
                return;
            }
            criteria.forEach((criterion) => {
                out.push({ kind: 'crit', comp: String(compIdx + 1), cap: String(capIdx + 1), text: criterion, source: capSource });
            });
        });
    });

    return out.length > 0 ? out : Array.from({ length: 4 }, () => ({ kind: 'crit', comp: '', cap: '', text: '', source: 'primary' as const }));
};

const normalizeScaleStructureForTemplate = (structure: any, assessmentModel?: any) => {
    const modelRowsHierarchy = buildCompetencyHierarchyFromAssessmentRows(assessmentModel?.rows);
    if (modelRowsHierarchy.length > 0) {
        return modelRowsHierarchy.map((competency: any) => ({
            name: competency.name,
            source: competency.source,
            capacities: competency.capacities.map((capacity: any) => ({
                name: capacity.name,
                source: capacity.source,
                criteria: (Array.isArray(capacity.criteria) ? capacity.criteria : []).map((criterion: any) => criterion.name).filter(Boolean)
            }))
        }));
    }

    const templateCompetenciesRaw = Array.isArray(structure?.competencies)
        ? structure.competencies
        : [];
    const legacyCriteria = Array.isArray(structure?.criteria) ? structure.criteria : [];
    const modelCompetencia = String(assessmentModel?.competencia || '').trim();
    const modelCapacidades = (Array.isArray(assessmentModel?.capacidades) ? assessmentModel.capacidades : [])
        .map((cap: any) => String(cap || '').trim())
        .filter(Boolean);
    const modelCriterios = (Array.isArray(assessmentModel?.criterios) ? assessmentModel.criterios : [])
        .map((crit: any) => String(crit?.text || crit?.name || crit?.criterio || '').trim())
        .filter(Boolean);

    const normalizeCriterionText = (criterion: any, fallback: string) =>
        String(criterion?.name || criterion?.text || criterion?.criterio || fallback).trim();

    const normalizeCapacityName = (capacity: any, fallback: string) =>
        String(capacity?.name || capacity?.title || capacity?.capacidad || fallback).trim();

    const normalizeCompetencyName = (competency: any, fallback: string) =>
        String(competency?.name || competency?.title || competency?.competencia || fallback).trim();

    if (modelCompetencia || modelCapacidades.length > 0 || modelCriterios.length > 0) {
        const templateCompetency = templateCompetenciesRaw[0] || {};
        const templateCapacitiesRaw = Array.isArray(templateCompetency?.capacities) ? templateCompetency.capacities : [];
        const capacityNames = modelCapacidades.length > 0
            ? modelCapacidades
            : templateCapacitiesRaw.map((cap: any, idx: number) => normalizeCapacityName(cap, `CAPACIDAD ${idx + 1}`)).filter(Boolean);
        const fallbackCapCount = Math.max(
            1,
            Number(
                structure?.scale?.capacitiesPerCompetency
                || structure?.capacitiesPerCompetency
                || templateCapacitiesRaw.length
                || 1
            )
        );
        const normalizedCapacityNames = capacityNames.length > 0
            ? capacityNames
            : Array.from({ length: fallbackCapCount }, (_, idx) => `CAPACIDAD ${idx + 1}`);
        const criteriaBuckets = splitCriteriaAcrossCapacities(modelCriterios, normalizedCapacityNames.length);

        return [{
            name: modelCompetencia || normalizeCompetencyName(templateCompetency, 'COMPETENCIA 1'),
            capacities: normalizedCapacityNames.map((capName, idx) => ({
                name: capName,
                criteria: criteriaBuckets[idx].length > 0
                    ? criteriaBuckets[idx]
                    : (((templateCapacitiesRaw[idx]?.criteria || []) as any[])
                        .map((crit: any, critIdx: number) => normalizeCriterionText(crit, `Criterio ${critIdx + 1}`))
                        .filter(Boolean))
            }))
        }];
    }

    if (templateCompetenciesRaw.length > 0) {
        return templateCompetenciesRaw.map((competency: any, compIdx: number) => ({
            name: normalizeCompetencyName(competency, `COMPETENCIA ${compIdx + 1}`),
            capacities: (Array.isArray(competency?.capacities) ? competency.capacities : []).map((capacity: any, capIdx: number) => ({
                name: normalizeCapacityName(capacity, `CAPACIDAD ${capIdx + 1}`),
                criteria: (Array.isArray(capacity?.criteria) ? capacity.criteria : [])
                    .map((criterion: any, critIdx: number) => normalizeCriterionText(criterion, `Criterio ${critIdx + 1}`))
                    .filter(Boolean)
            }))
        }));
    }

    const legacyCriteriaTexts = legacyCriteria
        .map((criterion: any, idx: number) => normalizeCriterionText(criterion, `Criterio ${idx + 1}`))
        .filter(Boolean);
    const fallbackCapCount = Math.max(
        1,
        Number(structure?.scale?.capacitiesPerCompetency || structure?.capacitiesPerCompetency || 1)
    );
    const fallbackCapNames = Array.from({ length: fallbackCapCount }, (_, idx) => `CAPACIDAD ${idx + 1}`);
    const criteriaBuckets = splitCriteriaAcrossCapacities(legacyCriteriaTexts, fallbackCapNames.length);

    return [{
        name: 'COMPETENCIA 1',
        capacities: fallbackCapNames.map((capName, idx) => ({
            name: capName,
            criteria: criteriaBuckets[idx].length > 0 ? criteriaBuckets[idx] : [`Criterio ${idx + 1}`]
        }))
    }];
};

const buildScaleVisualRowsForTemplate = (structure: any, assessmentModel?: any): ScaleTemplateRow[] => {
    const competencies = normalizeScaleStructureForTemplate(structure, assessmentModel);
    const out: ScaleTemplateRow[] = [];

    competencies.forEach((competency: any, compIdx: number) => {
        const compLabel = String(competency?.name || `COMPETENCIA ${compIdx + 1}`).trim();
        out.push({ kind: 'comp', comp: String(compIdx + 1), cap: '', text: compLabel });

        const capacities = Array.isArray(competency?.capacities) ? competency.capacities : [];
        capacities.forEach((capacity: any, capIdx: number) => {
            const capLabel = String(capacity?.name || `CAPACIDAD ${capIdx + 1}`).trim();
            const criteria = (Array.isArray(capacity?.criteria) ? capacity.criteria : [])
                .map((criterion: any, critIdx: number) => String(criterion || `Criterio ${critIdx + 1}`).trim())
                .filter(Boolean);

            out.push({ kind: 'cap', comp: String(compIdx + 1), cap: String(capIdx + 1), text: capLabel });
            if (criteria.length === 0) {
                out.push({ kind: 'crit', comp: String(compIdx + 1), cap: String(capIdx + 1), text: '' });
                return;
            }
            criteria.forEach((criterion) => {
                out.push({ kind: 'crit', comp: String(compIdx + 1), cap: String(capIdx + 1), text: criterion });
            });
        });
    });

    return out.length > 0 ? out : Array.from({ length: 4 }, () => ({ kind: 'crit', comp: '', cap: '', text: '' }));
};

const buildScaleBodyRowsForTemplate = (criteria: any[]) => {
    const safeCriteria = (Array.isArray(criteria) ? criteria : [])
        .map((item: any) => ({
            text: String(item?.name || item?.text || item?.criterio || '').trim(),
            cap: String(item?.capacidad || item?.capacity || item?.cap || '').trim()
        }))
        .filter(item => item.text.length > 0);

    if (safeCriteria.length === 0) {
        return Array.from({ length: 4 }, () => ({ kind: 'crit' as const, cap: '', text: '' }));
    }

    const out: Array<{ kind: 'cap' | 'crit'; cap: string; text: string }> = [];
    let currentCap = '';
    let capIndex = 0;

    safeCriteria.forEach((item) => {
        if (item.cap && normalizeLoose(item.cap) !== normalizeLoose(currentCap)) {
            currentCap = item.cap;
            capIndex += 1;
            out.push({ kind: 'cap', cap: String(capIndex), text: item.cap });
        }
        out.push({ kind: 'crit', cap: String(capIndex || ''), text: item.text });
    });

    return out;
};

const getScaleLabelsForTemplate = (structure: any) => {
    const labels = Array.isArray(structure?.scale?.labels) ? structure.scale.labels : [];
    return labels.map((x: any) => String(x || '').trim()).filter(Boolean);
};

const getScaleFallbackTextForTemplate = (structure: any, r: number, c: number) => {
    const labels = getScaleLabelsForTemplate(structure);
    const bodyRows = buildScaleVisualRowsForTemplate(structure);

    if (r === 0) {
        if (c === 0) return 'N°';
        if (c === 1) return 'CRITERIOS';
        if (c === 2) return 'NIVELES DE LOGRO';
        return '';
    }

    if (r === 1) {
        if (c === 0 || c === 1) return '';
        return labels[c - 2] || '';
    }

    const row = bodyRows[r - 2];
    if (!row) return '';
    if (row.kind === 'comp' && c === 0) return row.text;
    if (row.kind === 'cap' && c === 0) return row.text;
    if (row.kind === 'cap') {
        return '';
    }

    const critIndex = bodyRows
        .slice(0, r - 2)
        .filter(x => x.kind === 'crit' && x.comp === row.comp && x.cap === row.cap).length + 1;
    if (c === 0) return String(critIndex);
    if (c === 1) return row.text;
    return '';
};

const mapTemplateToSessionRowsByType = (instrument: any, type: SessionInstrumentType) => {
    const structure = instrument?.structure || {};
    const texts = getLayoutTexts(structure);

    if (type === 'rubrica') {
        const criteria = Array.isArray(structure?.criteria) ? structure.criteria : [];
        const rows = Math.max(criteria.length, Number(structure?.layout?.rows || 0) - 1, 4);
        return Array.from({ length: rows }, (_, idx) => {
            const row = idx + 1;
            return {
                id: row,
                criterio: String(criteria[idx]?.name || texts[`${row}:1`] || ''),
                c: String(texts[`${row}:2`] || ''),
                b: String(texts[`${row}:3`] || ''),
                a: String(texts[`${row}:4`] || ''),
                ad: String(texts[`${row}:5`] || '')
            };
        });
    }

    if (type === 'lista_cotejo') {
        const checklistRows = buildChecklistVisualRowsForTemplate(structure);
        const criteriaRows = checklistRows.filter((row) => row.kind === 'crit');
        const rows = Math.max(criteriaRows.length, Number(structure?.layout?.rows || 0) - 1, 4);
        return Array.from({ length: rows }, (_, idx) => ({
            id: idx + 1,
            criterio: String(criteriaRows[idx]?.text || getLayoutCell(texts, idx + 1, 1) || ''),
            c: String(getLayoutCell(texts, 0, 2) || 'No'),
            b: '',
            a: String(getLayoutCell(texts, 0, 1) || 'Sí'),
            ad: ''
        }));
    }

    if (type === 'escala_valoracion') {
        const criteria = Array.isArray(structure?.criteria) ? structure.criteria : [];
        const labels = getScaleLabelsForTemplate(structure);
        const rows = Math.max(criteria.length, Number(structure?.layout?.rows || 0) - 1, 4);
        return Array.from({ length: rows }, (_, idx) => ({
            id: idx + 1,
            criterio: String(criteria[idx]?.name || getLayoutCell(texts, idx + 1, 1) || ''),
            c: labels[0] || '',
            b: labels[1] || '',
            a: labels[2] || '',
            ad: labels[3] || ''
        }));
    }

    const competencies = getGuideHierarchyFromTemplate(structure);
    const rows = competencies.flatMap((competency: any, compIdx: number) =>
        (Array.isArray(competency?.capacities) ? competency.capacities : []).flatMap((capacity: any, capIdx: number) => {
            const criteria = (Array.isArray(capacity?.criteria) ? capacity.criteria : []).length > 0
                ? capacity.criteria
                : [{ id: `crit-${compIdx + 1}-${capIdx + 1}-1`, name: `Criterio ${capIdx + 1}` }];
            return criteria.map((criterion: any, critIdx: number) => ({
                id: String(criterion?.id || `crit-${compIdx + 1}-${capIdx + 1}-${critIdx + 1}`),
                competencia: String(competency?.name || `COMPETENCIA ${compIdx + 1}`).trim(),
                capacidad: String(capacity?.name || `CAPACIDAD ${capIdx + 1}`).trim(),
                criterio: String(criterion?.name || `Criterio ${critIdx + 1}`).trim(),
                c: 'C',
                b: 'B',
                a: 'A',
                ad: 'AD'
            }));
        })
    );
    return rows.length > 0 ? rows : [{
        id: 'crit-1-1-1',
        competencia: 'COMPETENCIA 1',
        capacidad: 'CAPACIDAD 1',
        criterio: 'Criterio 1',
        c: 'C',
        b: 'B',
        a: 'A',
        ad: 'AD'
    }];
};

const getTemplateFillableCellIds = (template: any) => {
    const structure = template?.structure || {};
    const rows = Math.max(0, Number(structure?.layout?.rows || 0));
    const cols = Math.max(0, Number(structure?.layout?.cols || 0));
    const fillable = new Set<string>();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (r > 0 && c > 0) fillable.add(layoutCellId(r, c));
        }
    }
    return fillable;
};

const buildTemplateTextOverridesFromRows = (template: any, rows: any[]) => {
    const type = detectInstrumentTypeFromText(template?.name || '') || detectInstrumentTypeFromText(template?.type || '') || 'rubrica';
    const overrides: Record<string, string> = {};
    const safeRows = Array.isArray(rows) ? rows : [];
    const structure = template?.structure || {};
    const layoutRows = Math.max(0, Number(structure?.layout?.rows || 0));
    const layoutTexts = getLayoutTexts(structure);

    const checklistSlots = (() => {
        if (type !== 'lista_cotejo') return [];
        const rowsFromLayout = Array.from({ length: Math.max(layoutRows - 1, 0) }, (_, idx) => idx + 1);
        const filtered = rowsFromLayout.filter((r) => {
            const c1 = normalizeLoose(getLayoutCell(layoutTexts, r, 1));
            return !!c1 && !c1.startsWith('capacidad ');
        });
        return filtered.length ? filtered : rowsFromLayout;
    })();

    const getTargetRow = (idx: number) => {
        if (type === 'escala_valoracion' || type === 'guia_observacion') return idx + 2;
        if (type === 'lista_cotejo') {
            if (idx < checklistSlots.length) return checklistSlots[idx];
            const tailBase = checklistSlots.length ? checklistSlots[checklistSlots.length - 1] : 0;
            return tailBase + (idx - checklistSlots.length) + 1;
        }
        return idx + 1;
    };

    safeRows.forEach((row: any, idx: number) => {
        const r = getTargetRow(idx);
        overrides[layoutCellId(r, 1)] = String(row?.criterio || '');
        if (type === 'lista_cotejo') {
            overrides[layoutCellId(r, 2)] = String(row?.a || '');
            overrides[layoutCellId(r, 3)] = String(row?.c || '');
            overrides[layoutCellId(r, 4)] = String(row?.ad || '');
        } else {
            overrides[layoutCellId(r, 2)] = String(row?.c || '');
            overrides[layoutCellId(r, 3)] = String(row?.b || '');
            overrides[layoutCellId(r, 4)] = String(row?.a || '');
            overrides[layoutCellId(r, 5)] = String(row?.ad || '');
        }
    });

    return overrides;
};

const getTemplateFallbackText = (template: any, r: number, c: number) => {
    const texts = getLayoutTexts(template?.structure || {});
    return String(texts[layoutCellId(r, c)] || '');
};

const normalizeFilterValue = (value: any) => normalizeLoose(String(value || ''));

const cloneInitialSessionData = () => JSON.parse(JSON.stringify(INITIAL_SESSION_DATA));

const extractCapacidades = (value: string) =>
    String(value || '')
        .split(/[\n;,]|(?:\s+-\s+)|(?:\s+[•·]\s+)|(?:\r?\n\s*\d+[.)]\s*)/)
        .map(v => String(v || '').trim())
        .filter(Boolean);

const isGenericCurricularLabel = (value: string, prefix: 'competencia' | 'capacidad') => {
    const norm = normalizeLoose(String(value || ''));
    if (!norm) return true;
    return norm === prefix || new RegExp(`^${prefix}\\s+\\d+$`).test(norm);
};

const buildCriteriosFromInstrumentRows = (rows: any) =>
    (Array.isArray(rows) ? rows : [])
        .map((row: any, idx: number) => ({
            id: String(idx + 1),
            text: String(row?.criterio || '').trim(),
            capacidad: String(row?.capacidad || row?.cap || '').trim(),
            rowType: String(row?.rowType || 'criterion').trim()
        }))
        .filter((item: any) => item.text.length > 0);

const SESSION_LEVEL_KEYS: SessionAssessmentLevelCode[] = ['c', 'b', 'a', 'ad'];

const extractLevelDescriptorsFromInstrumentRow = (row: any) => {
    const descriptors = SESSION_LEVEL_KEYS.reduce((acc, levelKey) => {
        const value = String(row?.[levelKey] || '').trim();
        if (value) acc[levelKey] = value;
        return acc;
    }, {} as Partial<Record<SessionAssessmentLevelCode, string>>);
    return Object.keys(descriptors).length > 0 ? descriptors : undefined;
};

const splitCriteriaAcrossCapacityNames = (criteria: any[], capacities: string[]) => {
    const safeCapacities = capacities.length > 0 ? capacities : [''];
    const buckets = Array.from({ length: safeCapacities.length }, () => [] as any[]);
    if (criteria.length === 0) return buckets;
    let offset = 0;
    for (let idx = 0; idx < safeCapacities.length; idx += 1) {
        const remainingCriteria = criteria.length - offset;
        const remainingCaps = safeCapacities.length - idx;
        const take = Math.max(1, Math.ceil(remainingCriteria / Math.max(remainingCaps, 1)));
        buckets[idx] = criteria.slice(offset, offset + take);
        offset += take;
    }
    return buckets;
};

const buildAssessmentModelFromData = (data: any, source: 'unit' | 'sql' | 'ai' | 'system' = 'system') => {
    const existing = data?.assessmentModel && typeof data.assessmentModel === 'object' ? data.assessmentModel : {};
    const directCompetencia = String(data?.competenciaPrio?.comp || '').trim();
    const existingCompetencia = String(existing?.competencia || '').trim();
    const competencia = directCompetencia && isGenericCurricularLabel(existingCompetencia, 'competencia')
        ? directCompetencia
        : String(existingCompetencia || directCompetencia || '');
    const directCapacidades = extractCapacidades(String(data?.competenciaPrio?.cap || ''));
    const existingCapacidades = Array.isArray(existing?.capacidades) && existing.capacidades.length > 0
        ? existing.capacidades.map((cap: any) => String(cap || '').trim()).filter(Boolean)
        : [];
    const existingCapacidadesAreGeneric = existingCapacidades.length > 0 && existingCapacidades.every((cap) => isGenericCurricularLabel(cap, 'capacidad'));
    const capacidades = directCapacidades.length > 0 && (
        existingCapacidades.length === 0
        || existingCapacidadesAreGeneric
        || directCapacidades.length > existingCapacidades.length
    )
        ? directCapacidades
        : existingCapacidades;

    const existingCriteria = Array.isArray(existing?.criterios) && existing.criterios.length > 0
        ? existing.criterios.map((item: any, idx: number) => ({
            id: String(item?.id || idx + 1),
            text: String(item?.text || item?.name || item?.criterio || '').trim(),
            capacidad: String(item?.capacidad || item?.capacity || '').trim(),
            rowType: String(item?.rowType || item?.targetType || 'criterion').trim()
        })).filter((item: any) => item.text.length > 0)
        : [];
    const instrumentCriteria = buildCriteriosFromInstrumentRows(data?.instrumento);
    const shortExistingCriteriaCount = existingCriteria.filter((item: any) => item.text.length > 0 && item.text.length <= 14).length;
    const existingLooksFragmented = existingCriteria.length > 0 && shortExistingCriteriaCount >= Math.ceil(existingCriteria.length / 2);
    const existingLooksInflated = instrumentCriteria.length > 0 && existingCriteria.length > instrumentCriteria.length + 2;
    const criterios = existingCriteria.length > 0 && !(existingLooksFragmented && instrumentCriteria.length > 0) && !existingLooksInflated
        ? existingCriteria
        : instrumentCriteria;

    return {
        competencia,
        capacidades,
        criterios,
        source
    };
};

const buildSessionAssessmentRowsFromData = (data: any): SessionAssessmentCriterionRow[] => {
    const baseAssessmentModel = buildAssessmentModelFromData(data, 'system');
    const primaryCompetency = String(baseAssessmentModel?.competencia || data?.competenciaPrio?.comp || '').trim();
    const primaryCapacityText = String(data?.competenciaPrio?.cap || '').trim();
    const primaryCapacities = Array.isArray(baseAssessmentModel?.capacidades) && baseAssessmentModel.capacidades.length > 0
        ? baseAssessmentModel.capacidades
        : extractCapacidades(primaryCapacityText);
    const rawPrimaryCriteria = Array.isArray(baseAssessmentModel?.criterios) ? baseAssessmentModel.criterios : [];
    const buckets = splitCriteriaAcrossCapacityNames(
        rawPrimaryCriteria.filter((item: any) => String(item?.text || '').trim().length > 0),
        primaryCapacities
    );
    const primaryCriteria = rawPrimaryCriteria.map((criterion: any, idx: number) => {
        const explicitCapacity = String(criterion?.capacidad || '').trim();
        if (explicitCapacity) return { ...criterion, capacidad: explicitCapacity };
        let capacityName = primaryCapacities[0] || primaryCapacityText || '';
        if (primaryCapacities.length > 1) {
            const bucketIndex = buckets.findIndex((items) => items.includes(criterion));
            if (bucketIndex >= 0) capacityName = primaryCapacities[bucketIndex] || capacityName;
        }
        return { ...criterion, capacidad: capacityName };
    });
    const instrumentRows = Array.isArray(data?.instrumento) ? data.instrumento : [];
    const instrumentRowByKey = new Map(
        instrumentRows.map((row: any, idx: number) => {
            const key = `${normalizeLoose(String(row?.criterio || ''))}::${normalizeLoose(String(row?.capacidad || row?.cap || ''))}`;
            return [key || `idx-${idx}`, row];
        })
    );

    const primaryRows = primaryCriteria
        .map((criterion: any, idx: number) => {
            const capacityName = String(criterion?.capacidad || primaryCapacities[0] || primaryCapacityText || '').trim();
            const criterionText = String(criterion?.text || '').trim();
            const instrumentRow = instrumentRowByKey.get(`${normalizeLoose(criterionText)}::${normalizeLoose(capacityName)}`) || instrumentRows[idx] || {};
            return {
                id: `primary-${idx + 1}`,
                source: 'primary' as const,
                competencyName: primaryCompetency,
                capacityName,
                criterionText,
                rowType: String(criterion?.rowType || 'criterion').trim() as SessionAssessmentRowType,
                levelDescriptors: extractLevelDescriptorsFromInstrumentRow(instrumentRow),
                performanceText: String(data?.competenciaPrio?.des || '').trim(),
                evidenceText: String(data?.competenciaPrio?.evidence || '').trim(),
                fieldText: String(data?.competenciaPrio?.field || '').trim(),
                instrumentLabel: String(data?.competenciaPrio?.inst || '').trim(),
                order: idx + 1
            };
        })
        .filter((row) => !!normalizeLoose(row.criterionText || row.capacityName || row.competencyName));

    const transversalRows = (Array.isArray(data?.competenciasTrans) ? data.competenciasTrans : [])
        .flatMap((item: any, transIdx: number) => {
            const competencyName = String(item?.comp || '').trim();
            const capacityText = String(item?.cap || '').trim();
            const capacities = extractCapacidades(capacityText);
            const criteriaFromEvidence = extractRichTextItems(String(item?.evidence || ''));
            const criteria = criteriaFromEvidence.length > 0
                ? criteriaFromEvidence
                : extractRichTextItems(String(item?.des || ''));

            if (!competencyName && capacities.length === 0 && criteria.length === 0) return [];

            return criteria.map((criterionText, criterionIdx) => ({
                id: `transversal-${transIdx + 1}-${criterionIdx + 1}`,
                source: 'transversal' as const,
                competencyName,
                capacityName: capacities[criterionIdx] || capacities[0] || capacityText || '',
                criterionText,
                rowType: 'criterion' as const,
                levelDescriptors: undefined,
                performanceText: String(item?.des || '').trim(),
                evidenceText: String(item?.evidence || '').trim(),
                fieldText: String(item?.field || '').trim(),
                instrumentLabel: String(item?.inst || '').trim(),
                order: primaryRows.length + transIdx + criterionIdx + 1
            }));
        })
        .filter((row) => !!normalizeLoose(row.criterionText || row.capacityName || row.competencyName));

    return [...primaryRows, ...transversalRows].map((row, idx) => ({ ...row, order: idx + 1 }));
};

const buildSessionAssessmentModel = (data: any, meta: any = {}): SessionAssessmentModel => ({
    version: 1,
    sessionId: String(meta?.sessionId || data?.id || data?.id_sesion || '').trim() || undefined,
    instrument: {
        type: String(data?.instrumentoTemplate?.type || detectInstrumentTypeFromText(String(data?.competenciaPrio?.inst || '')) || '').trim(),
        name: String(data?.instrumentoTemplate?.name || data?.competenciaPrio?.inst || '').trim(),
        templateId: data?.instrumentoTemplate?.id
    },
    scope: {
        areaId: String(meta?.areaId || data?.areaId || data?.area_id || '').trim() || undefined,
        grade: String(meta?.grade || data?.grade || '').trim() || undefined,
        section: String(meta?.section || data?.section || '').trim() || undefined,
        unitNumber: String(meta?.unitNumber || data?.unitNumber || data?.unit_number || '').trim() || undefined,
        sessionNumber: String(meta?.sessionNumber || data?.sessionNumber || data?.session_number || '').trim() || undefined,
        bimester: String(meta?.bimester || '').trim() || undefined
    },
    competency: {
        id: String(meta?.competencyId || '').trim() || undefined,
        name: String(data?.competenciaPrio?.comp || '').trim()
    },
    rows: buildSessionAssessmentRowsFromData(data)
});

const ensureSessionAssessmentModel = (data: any, meta: any = {}) => {
    const base = data && typeof data === 'object' ? data : {};
    return {
        ...base,
        sessionAssessmentModel: buildSessionAssessmentModel(base, meta)
    };
};

const buildSessionInstrumentRows = (template: any, sessionAssessmentModel: SessionAssessmentModel | null | undefined, currentRows: any[] = []) => {
    const templateType = String(template?.type || '').trim().toLowerCase();
    const sourceRows = (Array.isArray(sessionAssessmentModel?.rows) ? sessionAssessmentModel.rows : [])
        .filter((row) => !!normalizeLoose(row?.criterionText || row?.capacityName || row?.competencyName));

    const fallbackCurrent = (Array.isArray(currentRows) ? currentRows : []).map((row: any, idx: number) => ({
        id: String(row?.id || idx + 1),
        competencia: String(row?.competencia || row?.comp || '').trim(),
        capacidad: String(row?.capacidad || row?.cap || '').trim(),
        criterio: String(row?.criterio || '').trim(),
        c: String(row?.c || '').trim(),
        b: String(row?.b || '').trim(),
        a: String(row?.a || '').trim(),
        ad: String(row?.ad || '').trim()
    }));

    if (sourceRows.length === 0) return fallbackCurrent;

    const byCriterion = new Map(
        fallbackCurrent.map((row: any) => [`${normalizeLoose(row.criterio)}::${normalizeLoose(row.capacidad)}::${normalizeLoose(row.competencia)}`, row])
    );

    const seenKeys = new Set<string>();
    const preferRowLabel = (currentValue: any, canonicalValue: any, prefix: 'competencia' | 'capacidad') => {
        const currentText = String(currentValue || '').trim();
        const canonicalText = String(canonicalValue || '').trim();
        if (!canonicalText) return currentText;
        if (!currentText) return canonicalText;
        if (isGenericCurricularLabel(currentText, prefix) && !isGenericCurricularLabel(canonicalText, prefix)) return canonicalText;
        return currentText;
    };

    return sourceRows.reduce((acc: any[], row, idx) => {
        const key = `${normalizeLoose(row.criterionText)}::${normalizeLoose(row.capacityName)}::${normalizeLoose(row.competencyName)}::${normalizeLoose(row.source || '')}`;
        if (!normalizeLoose(row.criterionText) || seenKeys.has(key)) return acc;
        seenKeys.add(key);
        const current = byCriterion.get(`${normalizeLoose(row.criterionText)}::${normalizeLoose(row.capacityName)}::${normalizeLoose(row.competencyName)}`) || fallbackCurrent[idx] || {};
        const rowLevelDescriptors = SESSION_LEVEL_KEYS.reduce((acc, levelKey) => {
            const value = String(current?.[levelKey] || row?.levelDescriptors?.[levelKey] || '').trim();
            if (value) acc[levelKey] = value;
            return acc;
        }, {} as Partial<Record<SessionAssessmentLevelCode, string>>);
        acc.push({
            id: String(current?.id || row?.id || acc.length + 1),
            competencia: preferRowLabel(current?.competencia, row?.competencyName, 'competencia'),
            capacidad: preferRowLabel(current?.capacidad, row?.capacityName, 'capacidad'),
            criterio: String(row?.criterionText || current?.criterio || '').trim(),
            rowType: String(current?.rowType || row?.rowType || 'criterion').trim(),
            c: String(rowLevelDescriptors.c || '').trim(),
            b: String(rowLevelDescriptors.b || '').trim(),
            a: String(rowLevelDescriptors.a || '').trim(),
            ad: String(rowLevelDescriptors.ad || '').trim(),
            source: String(row?.source || '').trim() || 'primary',
            instrumentType: templateType
        });
        return acc;
    }, []);
};

const ensureAssessmentModel = (data: any, source: 'unit' | 'sql' | 'ai' | 'system' = 'system') => {
    const base = data && typeof data === 'object' ? data : {};
    const model = base?.assessmentModel;
    if (model && typeof model === 'object') return base;
    return { ...base, assessmentModel: buildAssessmentModelFromData(base, source) };
};

const QUILL_COLORS = [
    "#000000", "#e60000", "#ff9900", "#ffff00", "#008a00", "#0066cc", "#9933ff",
    "#ffffff", "#facccc", "#ffebcc", "#ffffcc", "#cce8cc", "#cce0f5", "#ebd6ff",
    "#bbbbbb", "#f06666", "#ffc266", "#ffff66", "#66b966", "#66a3e0", "#c285ff",
    "#888888", "#a10000", "#b26b00", "#b2b200", "#006100", "#0047b2", "#6b24b2",
    "#444444", "#5c0000", "#663d00", "#666600", "#003700", "#002966", "#3d1466",
    "#005c5c", "#00a2ff", "#15803d", "#d35400", "#6b21a8", "#007c59", "#00b28c"
];

const QUILL_MODULES = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{ 'color': QUILL_COLORS }],
  ],
};

const AI_ACTIVITY_RESOURCE_PAIRS = [
    ['secuencia.inicio.saberes', 'secuencia.inicio.saberes_recursos'],
    ['secuencia.inicio.conflicto', 'secuencia.inicio.conflicto_recursos'],
    ['secuencia.proceso.construccion', 'secuencia.proceso.construccion_recursos'],
    ['secuencia.proceso.aplicacion', 'secuencia.proceso.aplicacion_recursos'],
    ['secuencia.proceso.metacognicion', 'secuencia.proceso.metacognicion_recursos'],
    ['secuencia.salida.evaluacion', 'secuencia.salida.evaluacion_recursos']
] as const;

const AI_RICH_TEXT_PATHS = [
    'competenciaPrio.des',
    'competenciaPrio.evidence',
    'secuencia.inicio.saberes',
    'secuencia.inicio.conflicto',
    'secuencia.proceso.construccion',
    'secuencia.proceso.aplicacion',
    'secuencia.proceso.metacognicion',
    'secuencia.salida.evaluacion'
];

const instrumentTypeLabelMap: Record<SessionInstrumentType, string> = {
    rubrica: 'Rúbrica',
    lista_cotejo: 'Lista de Cotejo',
    escala_valoracion: 'Escala de Valoración',
    guia_observacion: 'Guía de Observación'
};

const MINUTE_DISTRIBUTIONS: Record<number, number[]> = {
    45: [3, 2, 12, 22, 3, 3],
    90: [5, 5, 30, 40, 5, 5]
};

const getPathByString = (obj: any, path: string) =>
    String(path || '')
        .split('.')
        .reduce((acc: any, key: string) => acc?.[key], obj);

const setPathByString = (obj: any, path: string, value: any) => {
    const keys = String(path || '').split('.');
    let ptr = obj;
    for (let i = 0; i < keys.length - 1; i++) ptr = ptr[keys[i]];
    ptr[keys[keys.length - 1]] = value;
};

const extractBracketTokens = (value: string) => {
    const out = new Set<string>();
    const re = /\[([^\[\]]{2,120})\]/g;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(String(value || ''))) !== null) {
        const token = String(m[1] || '').trim();
        if (token) out.add(token);
    }
    return Array.from(out);
};

const replaceBracketTokens = (value: string, replacements: Record<string, string>) =>
    String(value || '').replace(/\[([^\[\]]{2,120})\]/g, (_full, rawToken) => {
        const token = String(rawToken || '').trim();
        const direct = replacements[token];
        if (direct && String(direct).trim()) return String(direct).trim();
        const normalizedKey = Object.keys(replacements).find(k => normalizeLoose(k) === normalizeLoose(token));
        return normalizedKey ? String(replacements[normalizedKey]).trim() : `[${token}]`;
    });

const hasPendingTemplateHints = (value: string) => {
    const norm = normalizeLoose(stripHtml(String(value || '')));
    if (!norm) return true;
    return norm.includes('introducir texto aqui')
        || norm.includes('pregunta saberes')
        || norm.includes('pregunta conflicto')
        || norm.includes('resaltar la importancia')
        || norm.includes('instrumento');
};

const superNormalize = (str: string) => {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9 áéíóúñ]/gi, "")
    .trim();
};

const stripHtml = (value: string) => String(value || '').replace(/<[^>]*>/g, ' ');

const decodeBasicHtmlEntities = (value: string) =>
    String(value || '')
        .replace(/&nbsp;|&#160;|&amp;nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");

const extractRichTextItems = (value: string) => {
    const plain = decodeBasicHtmlEntities(
        String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<li[^>]*>/gi, '\n• ')
            .replace(/<[^>]*>/g, ' ')
    );

    return plain
        .split(/\r?\n|•|\u2022|;+/)
        .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
};

const normalizeLoose = (value: string) =>
    String(value || '')
        .replace(/&nbsp;|&#160;|&amp;nbsp;/gi, ' ')
        .replace(/&[a-z0-9#]+;/gi, ' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AUTOCOMPLETE_LAST_WORD_MIN_LEN = 5;

const escapeHtml = (value: string) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const COLOR_TOKEN_MAP: Record<string, string> = {
    'text-black': '#000000',
    'black': '#000000',
    'text-white': '#ffffff',
    'white': '#ffffff',
    'text-slate-800': '#1e293b',
    'text-slate-700': '#334155',
    'text-slate-600': '#475569',
    'text-slate-500': '#64748b',
    'text-emerald-700': '#047857',
    'text-emerald-600': '#059669',
    'text-green-700': '#15803d',
    'text-green-600': '#16a34a',
    'text-teal-700': '#0f766e',
    'text-teal-600': '#0d9488',
    'text-cyan-700': '#0e7490',
    'text-sky-700': '#0369a1',
    'text-blue-700': '#1d4ed8',
    'text-indigo-700': '#4338ca',
    'text-violet-700': '#6d28d9',
    'text-purple-700': '#7e22ce',
    'text-fuchsia-700': '#a21caf',
    'text-rose-700': '#be123c',
    'text-orange-700': '#c2410c',
    'text-amber-700': '#b45309',
    'text-yellow-700': '#a16207'
};

const colorTokenToCss = (token: string) => {
    const raw = String(token || '').trim().toLowerCase();
    if (!raw) return '#000000';
    if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/i.test(raw)) return raw;
    const bracketHex = raw.match(/text-\[#([0-9a-f]{3,8})\]/i);
    if (bracketHex?.[1]) return `#${bracketHex[1]}`;
    const arbitraryRgb = raw.match(/text-\[(rgba?\([^)]+\))\]/i);
    if (arbitraryRgb?.[1]) return arbitraryRgb[1];
    if (COLOR_TOKEN_MAP[raw]) return COLOR_TOKEN_MAP[raw];
    return '#000000';
};

const hexToRgba = (hex: string, alpha: number) => {
    const clean = String(hex || '').replace('#', '').trim();
    const normalized = clean.length === 3
        ? clean.split('').map(ch => ch + ch).join('')
        : clean;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const isBlackColorToken = (token: string) => {
    const css = colorTokenToCss(token);
    return css.toLowerCase() === '#000000';
};

const itemsToHtml = (items: Array<{ text?: string; color?: string }>, fallback: string) => {
    if (!Array.isArray(items) || items.length === 0) {
        return String(fallback || '')
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => `<p>${escapeHtml(line)}</p>`)
            .join('') || '<p></p>';
    }
    const lines = items
        .map(item => {
            const text = String(item?.text || '').trim();
            if (!text) return '';
            const color = colorTokenToCss(String(item?.color || 'text-black'));
            return `<p><span style="color: ${color};">${escapeHtml(text)}</span></p>`;
        })
        .filter(Boolean)
        .join('');
    return lines || '<p></p>';
};

const detectTransversalByCapacity = (capacity: string) => {
    const capNorm = normalizeLoose(capacity);
    if (!capNorm) return '';
    const found = TRANSVERSAL_NAMES.find(name =>
        (TRANSVERSAL_CAPACITY_MAP[name] || []).some(ref => normalizeLoose(ref) === capNorm)
    );
    return found || '';
};

const isMeaningfulRichText = (value: string) => normalizeLoose(stripHtml(String(value || ''))).length > 0;

const TIME_DISTRIBUTIONS: Record<number, number[]> = {
    90: [5, 5, 30, 40, 5, 5],
    45: [3, 2, 12, 22, 3, 3]
};

const syncResourcesFromActivity = (activityContent: string, currentResourceHtml: string, customInstrumentRaw: string) => {
    const mentionsFound = new Map<string, string>();
    const pushMention = (label: string) => {
        const key = normalizeLoose(label);
        if (!key) return;
        if (!mentionsFound.has(key)) mentionsFound.set(key, label);
    };

    const activityTextNorm = normalizeLoose(stripHtml(String(activityContent || '')));

    const matchPhraseOrPrefix = (source: string, normalizedPhrase: string) => {
        if (!normalizedPhrase) return false;
        if (source.includes(normalizedPhrase)) return true;
        const targetWords = normalizedPhrase.split(' ').filter(Boolean);
        const sourceWords = source.split(' ').filter(Boolean);
        if (targetWords.length === 0 || sourceWords.length === 0) return false;
        if (targetWords.length === 1) {
            return sourceWords.some(sw =>
                sw.length >= AUTOCOMPLETE_LAST_WORD_MIN_LEN && targetWords[0].startsWith(sw)
            );
        }

        const lastTarget = targetWords[targetWords.length - 1];
        const fixedTarget = targetWords.slice(0, -1);

        for (let i = 0; i <= sourceWords.length - targetWords.length; i++) {
            let fixedOk = true;
            for (let j = 0; j < fixedTarget.length; j++) {
                if (sourceWords[i + j] !== fixedTarget[j]) {
                    fixedOk = false;
                    break;
                }
            }
            if (!fixedOk) continue;

            const typedLast = sourceWords[i + fixedTarget.length] || '';
            if (typedLast.length < AUTOCOMPLETE_LAST_WORD_MIN_LEN) continue;
            if (lastTarget.startsWith(typedLast)) return true;
        }

        return false;
    };

    const collectNumberedMentions = (source: string, regex: RegExp, labelPrefix: string) => {
        const matches = source.matchAll(regex);
        for (const match of matches) {
            const num = match?.[1];
            if (!num) continue;
            pushMention(`${labelPrefix} ${num}`);
        }
    };

    // Detecta en cuanto se escribe el número (1-9), sin requerir espacio posterior.
    collectNumberedMentions(activityTextNorm, /\banexo\s*(?:n|nro|numero)?\s*([1-9])(?:\b|$)/g, 'Anexo N°');
    collectNumberedMentions(activityTextNorm, /\binstructivo\s*(?:n|nro|numero)?\s*([1-9])(?:\b|$)/g, 'Instructivo N°');

    const instrumentMatchers: Array<{ patterns: string[]; label: string }> = [
        { patterns: ['rubrica', 'rubricas'], label: 'Rúbrica' },
        { patterns: ['lista de cotejo', 'listas de cotejo'], label: 'Listas de Cotejo' },
        { patterns: ['ficha informativa', 'fichas informativas'], label: 'Ficha Informativa' },
        { patterns: ['escala de estimacion', 'escalas de estimacion'], label: 'Escala de Estimación' },
        { patterns: ['guia de observacion', 'guias de observacion'], label: 'Guía de Observación' },
        { patterns: ['cuaderno de los alumno', 'cuadernos de los alumno', 'cuaderno de los alumnos', 'cuadernos de los alumnos'], label: 'Cuaderno de los alumno' },
        { patterns: ['nota de campo', 'notas de campo'], label: 'Notas de campo' },
        { patterns: ['examen', 'examenes'], label: 'Examen' },
        { patterns: ['cuestionario', 'cuestionarios'], label: 'Cuestionario' },
        { patterns: ['portafolio de evidencia', 'portafolio de evidencias', 'portafolios de evidencia', 'portafolios de evidencias'], label: 'Portafolio de Evidencias' },
        { patterns: ['mapa conceptual', 'mapas conceptuales'], label: 'Mapa Conceptual' },
        { patterns: ['mapa mental', 'mapas mentales'], label: 'Mapa Mental' },
        { patterns: ['ensayo', 'ensayos'], label: 'Ensayo' },
        { patterns: ['proyecto', 'proyectos'], label: 'Proyecto' },
        { patterns: ['registro anecdotico', 'registros anecdoticos'], label: 'Registro Anecdótico' },
        { patterns: ['diario de clase', 'diarios de clase'], label: 'Diario de Clase' },
        { patterns: ['debate', 'debates'], label: 'Debate' },
        { patterns: ['exposicion oral', 'exposiciones orales'], label: 'Exposición Oral' },
        { patterns: ['ficha de autoevaluacion', 'fichas de autoevaluacion'], label: 'Ficha de Autoevaluación' },
        { patterns: ['ficha de coevaluacion', 'fichas de coevaluacion'], label: 'Ficha de Coevaluación' },
        { patterns: ['prueba de desempeno', 'pruebas de desempeno'], label: 'Prueba de Desempeño' },
        { patterns: ['prueba de ejecucion', 'pruebas de ejecucion'], label: 'Prueba de Ejecución' }
    ];

    instrumentMatchers.forEach(({ patterns, label }) => {
        if (patterns.some(p => matchPhraseOrPrefix(activityTextNorm, p))) {
            pushMention(label);
        }
    });

    const customInstrument = String(customInstrumentRaw || '').trim();
    const customInstrumentNorm = normalizeLoose(customInstrument);
    if (customInstrumentNorm.length > 2 && matchPhraseOrPrefix(activityTextNorm, customInstrumentNorm)) {
        pushMention(customInstrument);
    }

    let normalizedResourcesHtml = String(currentResourceHtml || '').trim();
    if (!normalizedResourcesHtml) normalizedResourcesHtml = '<ul></ul>';
    if (!/<ul[\s>]/i.test(normalizedResourcesHtml)) normalizedResourcesHtml = `<ul><li>${normalizedResourcesHtml}</li></ul>`;

    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    const originalItems: Array<{ raw: string; textNorm: string }> = [];
    let match: RegExpExecArray | null = null;
    while ((match = liRegex.exec(normalizedResourcesHtml)) !== null) {
        const raw = match[0];
        const textNorm = normalizeLoose(stripHtml(match[1] || ''));
        originalItems.push({ raw, textNorm });
    }

    const detectedKeys = new Set(mentionsFound.keys());
    const instrumentKeys = new Set(instrumentMatchers.map(item => normalizeLoose(item.label)));
    const isManagedMention = (key: string) => {
        if (!key) return false;
        if (/^anexo n \d+$/.test(key)) return true;
        if (/^instructivo n \d+$/.test(key)) return true;
        if (instrumentKeys.has(key)) return true;
        if (customInstrumentNorm && key === customInstrumentNorm) return true;
        return false;
    };

    const keptItems: string[] = [];
    const presentDetected = new Set<string>();
    originalItems.forEach(item => {
        if (detectedKeys.has(item.textNorm)) {
            keptItems.push(item.raw);
            presentDetected.add(item.textNorm);
            return;
        }
        if (isManagedMention(item.textNorm)) {
            return;
        }
        keptItems.push(item.raw);
    });

    mentionsFound.forEach((mention, key) => {
        if (!presentDetected.has(key)) {
            keptItems.push(`<li><strong>${mention}</strong></li>`);
        }
    });

    const updatedResources = `<ul>${keptItems.join('')}</ul>`;
    const changed = normalizeLoose(stripHtml(updatedResources)) !== normalizeLoose(stripHtml(normalizedResourcesHtml));
    return { updatedResources, changed };
};
const getFlexValue = (obj: any, searchKey: string) => {
    if (!obj) return '';
    const normSearch = superNormalize(searchKey);
    const actualKey = Object.keys(obj).find(k => superNormalize(k) === normSearch);
    return actualKey ? obj[actualKey] : '';
};

const autoResizeTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.overflowY = 'hidden';
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
};

export {
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
    buildSessionAssessmentRowsFromData,
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
};


