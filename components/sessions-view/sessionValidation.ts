import { detectInstrumentTypeFromText, isMeaningfulRichText, normalizeLoose } from './shared';

export interface MissingSessionField {
    key: string;
    label: string;
}

interface SessionValidationContext {
    sessionDate: string;
    dateOptions: Array<{ value?: string }>;
}

export const getMissingRequiredSessionFields = (
    data: any,
    { sessionDate, dateOptions }: SessionValidationContext
) => {
    const missing: MissingSessionField[] = [];
    const requireText = (key: string, label: string, value: any, rich = false) => {
        const filled = rich
            ? isMeaningfulRichText(String(value || ''))
            : normalizeLoose(String(value || '')).length > 0;
        if (!filled) missing.push({ key, label });
    };

    const visibleDates = dateOptions.map((option) => String(option?.value || '').trim()).filter(Boolean);
    requireText('date', 'Fecha de la sesión', sessionDate || visibleDates.join(' '));
    requireText('title', 'Título de sesión', data?.title);
    requireText('purpose', 'Propósito de sesión', data?.purpose, true);
    requireText('situation', 'Situación problemática', data?.situation, true);
    requireText('competenciaPrio.comp', 'Competencia priorizada', data?.competenciaPrio?.comp);
    requireText('competenciaPrio.cap', 'Capacidad priorizada', data?.competenciaPrio?.cap);
    requireText('competenciaPrio.des', 'Criterios', data?.competenciaPrio?.des, true);
    requireText('competenciaPrio.field', 'Campos temáticos', data?.competenciaPrio?.field);
    requireText('competenciaPrio.evidence', 'Evidencia de aprendizaje', data?.competenciaPrio?.evidence, true);
    requireText('competenciaPrio.inst', 'Instrumento', data?.competenciaPrio?.inst);
    requireText('enfoqueTrans.enfoque', 'Enfoque transversal', data?.enfoqueTrans?.enfoque);
    requireText('enfoqueTrans.valor', 'Valor del enfoque', data?.enfoqueTrans?.valor);
    requireText('enfoqueTrans.acciones', 'Acciones observables', data?.enfoqueTrans?.acciones, true);
    requireText('enfoqueTrans.demuestra', 'Demuestra', data?.enfoqueTrans?.demuestra, true);

    [
        ['secuencia.inicio.saberes', 'Saberes previos', data?.secuencia?.inicio?.saberes, true],
        ['secuencia.inicio.saberes_recursos', 'Recursos de saberes previos', data?.secuencia?.inicio?.saberes_recursos, true],
        ['secuencia.inicio.conflicto', 'Conflicto cognitivo', data?.secuencia?.inicio?.conflicto, true],
        ['secuencia.inicio.conflicto_recursos', 'Recursos de conflicto cognitivo', data?.secuencia?.inicio?.conflicto_recursos, true],
        ['secuencia.proceso.construccion', 'Construcción del aprendizaje', data?.secuencia?.proceso?.construccion, true],
        ['secuencia.proceso.construccion_recursos', 'Recursos de construcción', data?.secuencia?.proceso?.construccion_recursos, true],
        ['secuencia.proceso.aplicacion', 'Aplicación de lo aprendido', data?.secuencia?.proceso?.aplicacion, true],
        ['secuencia.proceso.aplicacion_recursos', 'Recursos de aplicación', data?.secuencia?.proceso?.aplicacion_recursos, true],
        ['secuencia.proceso.metacognicion', 'Metacognición', data?.secuencia?.proceso?.metacognicion, true],
        ['secuencia.proceso.metacognicion_recursos', 'Recursos de metacognición', data?.secuencia?.proceso?.metacognicion_recursos, true],
        ['secuencia.salida.evaluacion', 'Evaluación de salida', data?.secuencia?.salida?.evaluacion, true],
        ['secuencia.salida.evaluacion_recursos', 'Recursos de evaluación', data?.secuencia?.salida?.evaluacion_recursos, true],
        ['extension', 'Actividades de extensión', data?.extension, false],
        ['recursos.rec', 'Recursos', data?.recursos?.rec, false],
        ['recursos.med', 'Medios', data?.recursos?.med, false],
        ['recursos.mat', 'Materiales', data?.recursos?.mat, false],
        ['recursos.soft', 'Apps o software', data?.recursos?.soft, false],
        ['recursos.esp', 'Espacios de aprendizaje', data?.recursos?.esp, false],
        ['bibliografia.bib', 'Bibliografía', data?.bibliografia?.bib, false],
        ['bibliografia.link', 'Linkografía', data?.bibliografia?.link, false]
    ].forEach(([key, label, value, rich]) => requireText(String(key), String(label), value, Boolean(rich)));

    const instrumentRows = Array.isArray(data?.instrumento) ? data.instrumento : [];
    if (!instrumentRows.length) missing.push({ key: 'instrumento', label: 'Filas del instrumento de evaluación' });
    instrumentRows.forEach((row: any, index: number) => {
        requireText('instrumento', `Criterio ${index + 1} del instrumento`, row?.criterio);
        if (String(data?.instrumentoTemplate?.type || detectInstrumentTypeFromText(data?.competenciaPrio?.inst) || '') === 'rubrica') {
            requireText('instrumento', `Nivel C del criterio ${index + 1}`, row?.c);
            requireText('instrumento', `Nivel B del criterio ${index + 1}`, row?.b);
            requireText('instrumento', `Nivel A del criterio ${index + 1}`, row?.a);
            requireText('instrumento', `Nivel AD del criterio ${index + 1}`, row?.ad);
        }
    });

    // Los tres recursos visuales son opcionales y no participan en esta validación.
    return missing;
};
