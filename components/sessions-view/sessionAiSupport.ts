import { createSessionLearningResourceDefaults } from './SessionLearningResources';
import {
    AI_RICH_TEXT_PATHS,
    DEFAULT_SEQUENCE_TEMPLATE,
    cloneInitialSessionData,
    escapeHtml,
    getPathByString,
    normalizeLoose,
    setPathByString
} from './shared';

export const RESOURCE_PLAN_TIMEOUT_MS = 35_000;
export const RESOURCE_IMAGE_TIMEOUT_MS = 70_000;
export const RESOURCE_CAPABILITY_TIMEOUT_MS = 15_000;

export const withResourceTimeout = <T,>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`TIMEOUT_RECURSO:${stage}`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    }) as Promise<T>;
};

export const DEFAULT_EXTENSION_ACTIVITIES = [
    'Socialización oral de aprendizajes clave del proyecto entre equipos.',
    'Análisis colectivo de un caso breve de emprendimiento exitoso y otro no sostenible.',
    'Rueda de retroalimentación rápida sobre mejoras posibles del producto.'
].map((item) => `- ${item}`).join('\n');

export const mergeUniqueMultilineText = (...values: any[]) => {
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

export const normalizeNonBreakingSpaceEntities = (value: any) => {
    let normalized = String(value || '');
    for (let pass = 0; pass < 4; pass += 1) {
        const next = normalized
            .replace(/&(?:amp;)*(?:nbsp|#160|#x0*a0);/gi, ' ')
            .replace(/\u00a0/g, ' ');
        if (next === normalized) break;
        normalized = next;
    }
    return normalized;
};

export const ensureSessionExtraBlocks = (data: any) => {
    const base = cloneInitialSessionData();
    const normalizedData = {
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
        },
        learningResources: createSessionLearningResourceDefaults(data?.learningResources)
    };

    AI_RICH_TEXT_PATHS.forEach((path) => {
        const currentValue = getPathByString(normalizedData, path);
        if (typeof currentValue === 'string') {
            setPathByString(normalizedData, path, normalizeNonBreakingSpaceEntities(currentValue));
        }
    });
    (Array.isArray(normalizedData.competenciasTrans) ? normalizedData.competenciasTrans : []).forEach((row: any) => {
        if (typeof row?.des === 'string') row.des = normalizeNonBreakingSpaceEntities(row.des);
        if (typeof row?.evidence === 'string') row.evidence = normalizeNonBreakingSpaceEntities(row.evidence);
    });

    return normalizedData;
};

export const buildDefaultAreaTemplateSessionData = () => {
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
    humanMessage?: string;
    rawText: string;
    cleanedText?: string;
}) => {
    const diagnosticEntry = {
        timestamp: new Date().toISOString(),
        stage: payload.stage,
        errorMessage: payload.errorMessage,
        humanMessage: payload.humanMessage || '',
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
        humanMessage: 'La respuesta vino vacía, cortada o con texto extra fuera del JSON.',
        rawText,
        cleanedText: cleaned
    });

    throw new Error('La IA no devolvió un JSON utilizable.');
};

export const parseAiJsonObject = (rawText: string) => {
    const jsonBlock = extractFirstBalancedJsonBlock(rawText);
    try {
        return JSON.parse(jsonBlock);
    } catch (error: any) {
        const repairMalformedJson = (input: string) => {
            const source = String(input || '').replace(/,\s*([}\]])/g, '$1');
            let out = '';
            let inString = false;
            let escaped = false;

            for (let i = 0; i < source.length; i += 1) {
                const ch = source[i];

                if (!inString) {
                    if (ch === '"') {
                        inString = true;
                    }
                    out += ch;
                    escaped = false;
                    continue;
                }

                if (escaped) {
                    out += ch;
                    escaped = false;
                    continue;
                }

                if (ch === '\\') {
                    out += ch;
                    escaped = true;
                    continue;
                }

                if (ch === '\n') {
                    out += '\\n';
                    continue;
                }

                if (ch === '\r') {
                    continue;
                }

                if (ch === '\t') {
                    out += '\\t';
                    continue;
                }

                if (ch === '"') {
                    const rest = source.slice(i + 1);
                    const nextVisible = rest.match(/\S/)?.[0] || '';
                    const looksLikeClosing = nextVisible === '' || nextVisible === ',' || nextVisible === '}' || nextVisible === ']' || nextVisible === ':';
                    if (looksLikeClosing) {
                        inString = false;
                        out += ch;
                    } else {
                        out += '\\"';
                    }
                    continue;
                }

                out += ch;
            }

            return out;
        };

        try {
            return JSON.parse(repairMalformedJson(jsonBlock));
        } catch {
            const rawMessage = String(error?.message || 'JSON inválido');
            recordSessionAiDiagnostic({
                stage: 'parse',
                errorMessage: rawMessage,
                humanMessage: rawMessage.toLowerCase().includes('expected')
                    ? 'El modelo devolvió un JSON casi válido, pero con comillas, llaves o separadores rotos.'
                    : 'El modelo devolvió un JSON con formato inválido.',
                rawText,
                cleanedText: jsonBlock
            });
            throw new Error(`La IA devolvió JSON malformado. ${rawMessage}`);
        }
    }
};

const normalizeConstructionStageTitle = (value: string) => {
    const normalized = normalizeLoose(String(value || ''));
    if (normalized.startsWith('primero')) return 'PRIMERO';
    if (normalized.startsWith('segundo')) return 'SEGUNDO';
    if (normalized.startsWith('tercero')) return 'TERCERO';
    return '';
};

export const normalizeConstructionStepHtml = (rawValue: string) => {
    const raw = normalizeNonBreakingSpaceEntities(rawValue).trim();
    if (!raw) return raw;

    const plainText = raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<\/li>/gi, '')
        .replace(/<\/ul>/gi, '\n')
        .replace(/<\/ol>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\r/g, '')
        .replace(/\u00a0/g, ' ')
        .trim();

    const sectionRegex = /(PRIMERO|SEGUNDO|TERCERO)\s*:\s*([\s\S]*?)(?=(?:PRIMERO|SEGUNDO|TERCERO)\s*:|$)/gi;
    const sections = Array.from(plainText.matchAll(sectionRegex)).map((match) => {
        const title = normalizeConstructionStageTitle(match[1] || '');
        const body = String(match[2] || '').trim();
        const bulletLines = body
            .split(/\n+/)
            .map(line => line.replace(/^[\s\-•*·]+/, '').trim())
            .filter(Boolean);

        return { title, bulletLines };
    }).filter(section => section.title);

    if (sections.length < 3) {
        return raw;
    }

    const introText = plainText
        .split(/PRIMERO\s*:/i)[0]
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join(' ');

    const htmlParts: string[] = [];
    if (introText) {
        htmlParts.push(`<p>${escapeHtml(introText)}</p>`);
    }

    sections.forEach(section => {
        htmlParts.push(`<p><strong>${section.title}:</strong></p>`);
        if (section.bulletLines.length > 0) {
            htmlParts.push(`<ul>${section.bulletLines.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
        } else {
            htmlParts.push('<ul><li></li></ul>');
        }
    });

    return htmlParts.join('');
};
