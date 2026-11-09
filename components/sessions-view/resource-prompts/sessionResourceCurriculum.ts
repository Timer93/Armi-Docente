import type { SessionResourceAiContext } from './buildResourcePlanPrompt';

export type SessionResourceCurricularRow = {
    source: 'primary' | 'transversal';
    competency: string;
    capacity: string;
    criteria: string[];
    evidences: string[];
};

// Preserve list/paragraph boundaries before the regular cleaner flattens HTML.
// A comma or a parenthetical example is part of an item, not another evidence.
export const readSessionResourceItems = (value: unknown, clean: (value: unknown) => string): string[] => {
    const parts = (Array.isArray(value) ? value : [value]).flatMap((item) => String(item || '')
        .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, '\n')
        .replace(/<(?:p|div|li|h[1-6])\b[^>]*>/gi, '\n')
        .split(/\r?\n|[•●▪]/));
    return parts.map((part) => clean(part).replace(/^(?:[-–—*]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
};

export const buildSessionResourceCurricularRows = (data: any, clean: (value: unknown) => string): SessionResourceCurricularRow[] => {
    const primary = data?.competenciaPrio || {};
    const transversals = Array.isArray(data?.competenciasTrans) ? data.competenciasTrans : [];
    return [{ row: primary, source: 'primary' as const }, ...transversals.map((row: any) => ({ row, source: 'transversal' as const }))]
        .map(({ row, source }) => ({ source, competency: clean(row?.comp), capacity: clean(row?.cap), criteria: readSessionResourceItems(row?.des, clean), evidences: readSessionResourceItems(row?.evidence, clean) }))
        .filter((row) => row.criteria.length || row.evidences.length);
};

export const getSessionResourceCurriculum = (context: Pick<SessionResourceAiContext, 'competency' | 'capacity' | 'criterion' | 'evidence' | 'curricularRows'>) => {
    const rows = context.curricularRows?.length ? context.curricularRows : [{ source: 'primary' as const, competency: context.competency, capacity: context.capacity, criteria: readSessionResourceItems(context.criterion, String), evidences: readSessionResourceItems(context.evidence, String) }];
    return {
        rows,
        criteria: rows.flatMap((row) => row.criteria.map((text) => ({ text, source: row.source, competency: row.competency }))),
        evidences: rows.flatMap((row) => row.evidences.map((text) => ({ text, source: row.source, competency: row.competency })))
    };
};

export const buildAnnex2CurricularContract = (context: Parameters<typeof getSessionResourceCurriculum>[0]) => {
    const { criteria, evidences } = getSessionResourceCurriculum(context);
    return `FUENTE CURRICULAR OBLIGATORIA DEL ANEXO 2 (PREVALECE SOBRE EL CONTEXTO, METADATOS Y CONTENIDO GENERADO)
CRITERIOS REALES: ${criteria.length}
${criteria.map((item, index) => `Criterio ${index + 1} [${item.source === 'primary' ? 'Área' : 'Transversal'}]: ${item.text}`).join('\n') || 'No hay criterios registrados: no inventes criterios.'}

EVIDENCIAS REALES: ${evidences.length}
${evidences.map((item, index) => `Evidencia ${index + 1} [${item.source === 'primary' ? 'Área' : 'Transversal'}]: ${item.text}`).join('\n') || 'No hay evidencias registradas: no inventes entregables.'}

REGLAS DE FIDELIDAD Y PRODUCCIÓN
- Copia LITERALMENTE los ${criteria.length} criterios en «Criterios de evaluación de la sesión». No los resumas, reformules, dividas ni añadas otros. La autoevaluación no crea criterios nuevos.
- Crea exactamente ${evidences.length} espacios de producción numerados «Evidencia 1» a «Evidencia ${evidences.length}», cada uno con su nombre literal, consigna breve y zona de trabajo propia. Incluye todas las evidencias del área y transversales, sin sustituirlas ni fusionarlas.
- Un ejemplo entre paréntesis o alternativas con «o» pertenecen a una misma evidencia; no los conviertas en entregables adicionales. Un registro de datos auxiliar puede formar parte de un espacio existente, pero no reemplazar una evidencia ni convertirse en otra.
- Para cada evidencia digital, ofrece un espacio útil para diseñarla: guion/storyboard, secuencia de pantallas, algoritmo/pseudocódigo o código fuente, según lo que pida SU texto. No basta mencionar el producto en una lista o dibujar una computadora.
- Deja vacías las respuestas, datos, soluciones y código que debe producir el estudiante. Las consignas y encabezados sí deben estar completos.
- Dedica la mayor parte del lienzo a esos ${evidences.length} espacios. Reduce decoración, herramientas, situación y autoevaluación antes de omitir una evidencia o reducir su espacio a una casilla simbólica.
- La lista de entregables debe corresponder uno a uno con estas ${evidences.length} evidencias, sin agregar productos inferidos del tema.
- Antes de generar, verifica: ${criteria.length}/${criteria.length} criterios literales y ${evidences.length}/${evidences.length} evidencias con un espacio propio. Corrige cualquier omisión. Si faltan datos curriculares, señálalo sin inventarlos.`;
};
