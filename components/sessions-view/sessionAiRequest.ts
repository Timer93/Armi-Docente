import {
    AI_RICH_TEXT_PATHS,
    buildSessionAssessmentModel,
    detectInstrumentTypeFromText,
    extractBracketTokens,
    getPathByString,
    isMeaningfulRichText,
    normalizeLoose,
    stripHtml
} from './shared';

interface SessionAiRequestParams {
    aiTiempoValues: string[];
    assignments: any[];
    bimesterLabel: string;
    currentProgram: any;
    generalData: any;
    selArea: string;
    selGrade: string;
    selSection: string;
    sessionData: any;
    sessionDate: string;
    sessionNumber: string;
    unitNumber: string;
    year: number | string;
}

export const buildSessionAiRequest = ({
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
}: SessionAiRequestParams) => {
    const areaId = assignments.find(a => a.areaName === selArea)?.areaId || selArea;
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
    const compactHtml = (value: any) => {
        const raw = String(value || '').trim();
        if (!raw) return '';

        const cleaned = raw
            .replace(/&nbsp;|&#160;|&amp;nbsp;/gi, ' ')
            .replace(/<span[^>]*>/gi, '')
            .replace(/<\/span>/gi, '')
            .replace(/\sstyle=(['"])[^'"]*\1/gi, '')
            .replace(/\sclass=(['"])[^'"]*\1/gi, '')
            .replace(/\sdata-[a-z0-9_-]+=(['"])[^'"]*\1/gi, '')
            .replace(/<p>\s*<\/p>/gi, '')
            .replace(/<p><br\s*\/?><\/p>/gi, '')
            .replace(/<br\s*\/?>/gi, '<br>')
            .replace(/>\s+</g, '><')
            .replace(/\s+/g, ' ')
            .trim();

        return cleaned;
    };
    const compactHtmlMap = (input: Record<string, any>) =>
        Object.fromEntries(
            Object.entries(input || {}).map(([key, value]) => [
                key,
                typeof value === 'string' ? compactHtml(value) : String(value || '').trim()
            ])
        );
    const compactSequenceForAi = {
        inicio: {
            saberes: compactHtml(sessionData?.secuencia?.inicio?.saberes),
            conflicto: compactHtml(sessionData?.secuencia?.inicio?.conflicto)
        },
        proceso: {
            construccion: compactHtml(sessionData?.secuencia?.proceso?.construccion),
            aplicacion: compactHtml(sessionData?.secuencia?.proceso?.aplicacion),
            metacognicion: compactHtml(sessionData?.secuencia?.proceso?.metacognicion)
        },
        salida: {
            evaluacion: compactHtml(sessionData?.secuencia?.salida?.evaluacion)
        }
    };
    const hasAnyDescriptorText = (row: any) =>
        !!normalizeLoose([
            row?.c,
            row?.b,
            row?.a,
            row?.ad
        ].join(' '));
    const instrumentRowsTarget = targetInstrumentRows.map((row: any, idx: number) => ({
        index: idx,
        source: String(row?.source || 'primary').trim(),
        competencia: String(row?.competencia || '').trim(),
        capacidad: String(row?.capacidad || '').trim(),
        criterio: String(row?.criterio || '').trim()
    }));

    const placeholderSet = new Set<string>();
    const placeholderCandidatePaths = [
        'title',
        'purpose',
        'situation',
        'extension',
        'competenciaPrio.field',
        'competenciaPrio.des',
        'competenciaPrio.evidence',
        ...AI_RICH_TEXT_PATHS
    ];
    placeholderCandidatePaths.forEach(path => {
        const rawValue = String(getPathByString(sessionData, path) || '');
        const detectionValue = path.includes('des') || path.includes('evidence') || AI_RICH_TEXT_PATHS.includes(path)
            ? stripHtml(rawValue)
            : rawValue;
        extractBracketTokens(detectionValue).forEach(t => placeholderSet.add(t));
    });
    const activeCompetenciasTrans = (Array.isArray(sessionData?.competenciasTrans) ? sessionData.competenciasTrans : [])
        .filter((ct: any) => {
            const hasCap = normalizeLoose(String(ct?.cap || '')).length > 0;
            const hasDes = isMeaningfulRichText(String(ct?.des || ''));
            const hasEvidence = isMeaningfulRichText(String(ct?.evidence || ''));
            const hasInst = normalizeLoose(String(ct?.inst || '')).length > 0;
            return hasCap || hasDes || hasEvidence || hasInst;
        })
        .map((ct: any) => ({
            cap: String(ct?.cap || '').trim(),
            inst: String(ct?.inst || '').trim(),
            des: compactHtml(ct?.des),
            evidence: compactHtml(ct?.evidence),
            rowColor: String(ct?.rowColor || '').trim()
        }));
    activeCompetenciasTrans.forEach((ct: any) => {
        extractBracketTokens(stripHtml(String(ct?.des || ''))).forEach(t => placeholderSet.add(t));
        extractBracketTokens(stripHtml(String(ct?.evidence || ''))).forEach(t => placeholderSet.add(t));
    });

    const aiPedagogicalRoute = String((generalData as any)?.ai_pedagogical_route || '').trim();
    const institutionalProblems = String((generalData as any)?.ai_institutional_problems || '').trim();
    const rawUnitPedagogicalFocus = String((generalData as any)?.ai_unit_pedagogical_focus || '').trim();
    const didacticUnits = Array.isArray(currentProgram?.didacticUnits)
        ? currentProgram.didacticUnits
        : (currentProgram?.didacticUnits && typeof currentProgram.didacticUnits === 'object'
            ? Object.values(currentProgram.didacticUnits)
            : []);
    const currentUnitIndex = Math.max(0, Number(unitNumber || '1') - 1);
    const summarizeUnitFocus = (unit: any) => {
        const title = String(unit?.title || '').trim();
        const situation = String(unit?.situation || '').trim();
        if (title && situation) return `${title}. ${situation}`;
        return title || situation;
    };
    const currentUnitGuide = (() => {
        const raw = currentProgram?.didacticUnits;
        if (Array.isArray(raw)) return raw[Number(unitNumber) - 1] || {};
        if (raw && typeof raw === 'object') return raw[String(Number(unitNumber) - 1)] || raw[String(unitNumber)] || {};
        return {};
    })();
    const previousUnitGuide = didacticUnits[currentUnitIndex - 1] || null;
    const nextUnitGuide = didacticUnits[currentUnitIndex + 1] || null;
    const scopedUnitProgression = {
        previousUnitFocus: summarizeUnitFocus(previousUnitGuide),
        currentUnitFocus: summarizeUnitFocus(currentUnitGuide) || rawUnitPedagogicalFocus,
        nextUnitFocus: summarizeUnitFocus(nextUnitGuide)
    };
    const suggestedTiming = aiTiempoValues
        .map(value => String(value || '').trim())
        .filter(Boolean);
    const normalizedAreaRows = targetInstrumentRows.map((row: any, idx: number) => ({
        index: idx,
        competencia: row.competencia,
        capacidad: row.capacidad,
        criterio: row.criterio,
        ...(hasAnyDescriptorText(row)
            ? {
                descriptoresActuales: {
                    c: row.c,
                    b: row.b,
                    a: row.a,
                    ad: row.ad
                }
            }
            : {})
    }));

    const contextForAI = {
        header: {
            year,
            areaId,
            areaName: selArea,
            grade: selGrade,
            section: selSection,
            unitNumber,
            sessionNumber,
            date: sessionDate || ''
        },
        annualGuide: {
            areaPurpose: String(currentProgram?.areaPurpose || '').trim(),
            areaEnfoque: String(currentProgram?.areaEnfoque || '').trim(),
            currentUnitGuide: {
                title: String(currentUnitGuide?.title || '').trim(),
                situation: String(currentUnitGuide?.situation || '').trim()
            },
            pedagogicalConfig: {
                aiPedagogicalRoute,
                institutionalProblems,
                unitProgression: scopedUnitProgression
            }
        },
        currentSession: {
            title: sessionData?.title || '',
            purpose: sessionData?.purpose || '',
            situation: sessionData?.situation || '',
            extension: sessionData?.extension || '',
            suggestedTiming,
            competenciaPrio: {
                comp: String(sessionData?.competenciaPrio?.comp || '').trim(),
                cap: String(sessionData?.competenciaPrio?.cap || '').trim(),
                field: String(sessionData?.competenciaPrio?.field || '').trim(),
                inst: String(sessionData?.competenciaPrio?.inst || '').trim(),
                des: compactHtml(sessionData?.competenciaPrio?.des),
                evidence: compactHtml(sessionData?.competenciaPrio?.evidence)
            },
            competenciasTrans: activeCompetenciasTrans,
            enfoqueTrans: compactHtmlMap(sessionData?.enfoqueTrans || {}),
            secuencia: compactSequenceForAi
        },
        instrument: {
            templateType: currentTemplateType,
            templateName: currentInstrumentName,
            targetRows: normalizedAreaRows
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
3) Para campos HTML devuelve contenido en formato HTML simple (<p>, <ul>, <li>, <strong>, <em>, <span style='color: green;'>).
3.1) Si usas atributos HTML dentro de strings JSON, usa comillas simples en el HTML para no romper el JSON.
4) Respeta el instrumento actual del contexto: "${currentInstrumentName}" (tipo: "${currentTemplateType}").
5) Devuelve "instrumentRows" con exactamente la misma cantidad de elementos que "FILAS DEL INSTRUMENTO A COMPLETAR", conservando todos sus índices.
6) Cada fila de "instrumentRows" debe incluir: index, criterio, c, b, a, ad.
7) En TODOS los instrumentos, aunque visualmente no se muestren, c/b/a/ad deben ser descriptores pedagógicos reales de nivel de logro para ese criterio.
8) No devuelvas etiquetas sueltas como "Deficiente", "Regular", "Bueno", "Muy bueno" dentro de c/b/a/ad; devuelve descripciones de desempeño observables.
9) Si el instrumento es rúbrica, los descriptores pueden ser más extensos. Si es lista, escala o guía, los descriptores pueden ser breves pero específicos.
10) Redacta pensando en estudiantes de ${selGrade}, área ${selArea}.
11) Debes completar TODOS los índices listados en "FILAS DEL INSTRUMENTO A COMPLETAR", incluyendo criterios del área y competencias transversales.
12) No omitas ninguna fila aunque sea la 5, 6 o posterior.
13) Usa el mismo criterio base de cada índice y devuelve descriptores para todos los niveles de logro.
13.1) En "competenciasTrans", el campo "des" contiene CRITERIOS DE EVALUACIÓN y el campo "evidence" contiene EVIDENCIAS DE APRENDIZAJE. Nunca intercambies esos campos.
13.2) Para toda fila transversal de "instrumentRows", copia como "criterio" exclusivamente el criterio de evaluación correspondiente de "competenciasTrans.des". Está prohibido usar "competenciasTrans.evidence" como criterio de la rúbrica.
14) Los cuatro niveles deben ser coherentes entre sí y describir la misma habilidad con distinta calidad de logro.
15) Toma el nivel A como referencia central del criterio esperado; luego adapta C, B y AD manteniendo la misma acción observable, variando principalmente precisión, coherencia, autonomía, profundidad o sustento.
16) Evita que cada nivel parezca un criterio distinto; deben sentirse como una progresión del mismo desempeño.
17) En "secuencia.proceso.construccion" devuelve exactamente tres bloques con los encabezados "PRIMERO:", "SEGUNDO:" y "TERCERO:" en ese orden.
18) En cada bloque de "secuencia.proceso.construccion" redacta exactamente 3 viñetas concretas, orientadas a acciones del docente y estudiantes.
19) Para "secuencia.proceso.construccion" usa HTML simple con esta estructura: <p>introducción breve</p><p><strong>PRIMERO:</strong></p><ul><li>...</li><li>...</li><li>...</li></ul><p><strong>SEGUNDO:</strong></p><ul>...</ul><p><strong>TERCERO:</strong></p><ul>...</ul>.
20) La redacción de "secuencia.proceso.construccion" NO debe parecer una lista de ideas sueltas. Debe leerse como una secuencia didáctica conectada del momento de desarrollo de la sesión.
21) En "PRIMERO" redacta acciones iniciales de orientación, explicación, modelado o análisis guiado que realiza el docente con participación de los estudiantes.
22) En "SEGUNDO" redacta acciones de trabajo, organización, resolución, aplicación parcial o construcción colaborativa que realizan principalmente los estudiantes con acompañamiento del docente.
23) En "TERCERO" redacta acciones de consolidación, sustento, revisión, ajuste, socialización parcial o preparación del producto/evidencia antes de pasar al siguiente momento de la sesión.
24) Cada viñeta de "secuencia.proceso.construccion" debe mantener relación explícita con la viñeta anterior y con el propósito, producto, evidencia e instrumento de la sesión actual.
25) Evita frases genéricas, decorativas o repetidas como "se promueve el diálogo", "se reflexiona", "se socializa" si no indicas sobre qué contenido concreto de la sesión.
26) Usa verbos de acción pedagógica observables y contextualizados: explica, analiza, organiza, completa, sustenta, revisa, contrasta, formula, registra, valida, ajusta, prepara.
27) Si la unidad está enmarcada en proyecto, concurso, portafolio o Crea y Emprende, las acciones de "secuencia.proceso.construccion" deben mencionar explícitamente avances reales del producto, portafolio, matriz, ficha, propuesta o evidencia correspondiente.
28) Toma como referencia este estilo de redacción para "secuencia.proceso.construccion": pasos conectados, concretos, específicos del tema y centrados en lo que hace el docente y lo que hacen los equipos o estudiantes durante el desarrollo.
29) Redacta "situation" como una situación problemática específica de ESTA sesión. Usa como contexto la situación de la unidad incluida en "annualGuide.currentUnitGuide.situation", pero no la copies literalmente: delimita el problema, reto, aprendizaje y evidencia que corresponden al título, propósito y número de la sesión actual.
30) Usa espacios normales. No escribas entidades HTML de espacio como &nbsp;, &amp;nbsp;, &#160; o &#xA0;.

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
`.trim();
    return { areaId, currentSessionAssessmentModel, currentTemplateType, currentInstrumentName, targetInstrumentRows, prompt };
};
