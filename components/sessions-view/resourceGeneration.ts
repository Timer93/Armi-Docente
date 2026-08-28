import type {
    SessionResourceAIContent,
    SessionResourceMetadata,
    SessionResourceKey,
    SessionLearningResourcesData
} from './SessionLearningResources';
import { createSessionLearningResourceDefaults } from './SessionLearningResources';
import type { SessionResourceAiContext } from './resource-prompts/buildResourcePlanPrompt';
import { classifyAiIssue } from '../../utils/aiErrors';
import { fetchGeminiImageCapability } from '../../utils/aiModels';

const ALLOWED_VISUAL_FORMATS = new Set([
    'concept',
    'steps',
    'example',
    'diagram',
    'table',
    'checklist',
    'questions',
    'workspace',
    'reminder'
]);

export type NormalizedSessionResourcePlan = {
    content: SessionResourceAIContent;
    metadata: SessionResourceMetadata;
};

export const normalizeSessionResourcePlan = (
    raw: any,
    sessionContext: SessionResourceAiContext
): NormalizedSessionResourcePlan => {
    const sections = (Array.isArray(raw?.sections) ? raw.sections : [])
        .map((section: any) => ({
            label: String(section?.label || section?.title || '').trim(),
            body: String(section?.body || section?.text || '').trim(),
            visualFormat: ALLOWED_VISUAL_FORMATS.has(
                String(section?.visualFormat || '')
            )
                ? section.visualFormat
                : 'concept'
        }))
        .filter((section: any) => section.label && section.body)
        .slice(0, 7);

    const heading = String(raw?.heading || raw?.title || '').trim();
    if (!heading || sections.length < 3) {
        throw new Error(
            'La IA no devolvió una estructura pedagógica completa para el recurso.'
        );
    }

    const metadataRaw =
        raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
    const sessionInfoRaw =
        raw?.sessionInfo && typeof raw.sessionInfo === 'object'
            ? raw.sessionInfo
            : {};
    const visualBriefRaw =
        raw?.visualBrief && typeof raw.visualBrief === 'object'
            ? raw.visualBrief
            : {};
    const sessionTotal = Math.max(1, Number(sessionContext.sessionTotal || 1));

    return {
        content: {
            eyebrow: String(raw?.eyebrow || 'RECURSO DE APRENDIZAJE').trim(),
            heading,
            summary: String(raw?.summary || '').trim(),
            sessionInfo: {
                sessionLabel: `Sesión ${sessionContext.session || 1}/${sessionTotal}`,
                sessionTitle: String(
                    sessionContext.title || sessionInfoRaw.sessionTitle || ''
                ).trim(),
                purpose: String(
                    sessionContext.purpose || sessionInfoRaw.purpose || ''
                ).trim(),
                competency: String(
                    sessionContext.competency || sessionInfoRaw.competency || ''
                ).trim(),
                capacities: String(
                    sessionContext.capacity || sessionInfoRaw.capacities || ''
                ).trim(),
                criterion: String(
                    sessionContext.criterion || sessionInfoRaw.criterion || ''
                ).trim(),
                evidence: String(
                    sessionContext.evidence || sessionInfoRaw.evidence || ''
                ).trim()
            },
            visualBrief: {
                layoutIdea: String(visualBriefRaw.layoutIdea || '').trim(),
                illustrationIdea: String(
                    visualBriefRaw.illustrationIdea || ''
                ).trim(),
                paletteIdea: String(visualBriefRaw.paletteIdea || '').trim()
            },
            sections
        },
        metadata: {
            searchQuery: String(metadataRaw.searchQuery || '').trim(),
            duration: String(metadataRaw.duration || '').trim(),
            tools: Array.isArray(metadataRaw.tools)
                ? metadataRaw.tools
                    .map((item: any) => String(item || '').trim())
                    .filter(Boolean)
                    .slice(0, 5)
                : [],
            deliverable: String(metadataRaw.deliverable || '').trim()
        }
    };
};

type ResolveYouTubeDependencies = {
    generateContent: (ai: any, request: any, model: string) => Promise<any>;
    parseJson: (rawText: string) => any;
    verifyResource: (url: string) => Promise<any>;
    withTimeout: <T>(
        promise: Promise<T>,
        timeoutMs: number,
        stage: string
    ) => Promise<T>;
    timeoutMs: number;
};

export const resolveSessionYouTubeResource = async (
    ai: any,
    preferredModel: string,
    plan: NormalizedSessionResourcePlan,
    grade: string,
    dependencies: ResolveYouTubeDependencies
): Promise<SessionResourceMetadata> => {
    const searchQuery =
        plan.metadata.searchQuery ||
        `${plan.content.heading} ${grade} educación`;

    const response = await dependencies.withTimeout(
        dependencies.generateContent(
            ai,
            {
                contents: [{
                    parts: [{
                        text: `Busca un solo video educativo REAL y público de YouTube apropiado para esta sesión y esta consulta: "${searchQuery}". Verifica que sea pertinente. Devuelve únicamente JSON válido: {"url":"https://www.youtube.com/watch?v=...","title":"título real","reason":"justificación pedagógica breve"}. No inventes identificadores ni URL.`
                    }]
                }],
                config: {
                    tools: [{ googleSearch: {} }],
                    temperature: 0.1
                }
            },
            preferredModel
        ),
        dependencies.timeoutMs,
        'búsqueda de video'
    );

    const raw = dependencies.parseJson(String(response?.text || ''));
    const url = String(raw?.url || '').trim();
    const match = url.match(
        /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
    );

    if (!match) {
        throw new Error(
            'La búsqueda con IA no devolvió un enlace verificable de YouTube.'
        );
    }

    const verified = await dependencies.verifyResource(url);
    if (!verified.success || !verified.data) {
        throw new Error(
            verified.message ||
            'YouTube no confirmó que el video esté disponible públicamente.'
        );
    }

    return {
        platform: verified.data.platform,
        url: verified.data.url,
        videoId: verified.data.videoId,
        thumbnailUrl: verified.data.thumbnailUrl,
        externalTitle:
            verified.data.title ||
            String(raw?.title || plan.content.heading).trim(),
        authorName: verified.data.authorName,
        pedagogicalReason: String(raw?.reason || '').trim(),
        searchQuery
    };
};

type GenerateSessionResourceImageOptions = {
    ai: any;
    apiKey: string;
    key: 'instructive' | 'annex1' | 'annex2';
    resource: {
        aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
    };
    content: SessionResourceAIContent;
    cooldownUntil: number;
    cooldownReason: string;
    capabilityTimeoutMs: number;
    imageTimeoutMs: number;
    buildImagePrompt: () => string;
    persistImage: (imageData: string) => Promise<string>;
    withTimeout: <T>(
        promise: Promise<T>,
        timeoutMs: number,
        stage: string
    ) => Promise<T>;
    onStageChange: (stage: string) => void;
    onModelAttempt: (model: string) => void;
    onQuotaCooldown: (until: number, reason: string) => void;
};

export type GeneratedSessionResourceImage = {
    imageUrl: string;
    imageModel: string;
    imageUsage: number;
};

const scoreImageModel = (id: string) => {
    const normalized = id.toLowerCase().replace(/^models\//, '');

    if (normalized === 'gemini-3.1-flash-image') return 0;
    if (normalized === 'gemini-3.1-flash-lite-image') return 1;
    if (normalized === 'gemini-2.5-flash-image') return 2;
    if (normalized === 'gemini-3-pro-image') return 3;
    if (normalized.includes('preview')) return 6;
    return normalized.includes('image') ? 4 : 5;
};

export const generateSessionResourceImage = async (
    options: GenerateSessionResourceImageOptions
): Promise<GeneratedSessionResourceImage> => {
    options.onStageChange('verificación de cuota de imágenes');

    const cooldownRemaining = options.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
        throw new Error(
            `La generación de imágenes está en pausa durante ${Math.ceil(
                cooldownRemaining / 1000
            )} segundos. Motivo informado en este mismo lote: ${
                options.cooldownReason ||
                'Gemini rechazó la solicitud por cuota.'
            }`
        );
    }

    const capabilityStage = 'consulta de modelos de imagen';
    options.onStageChange(capabilityStage);

    const capability = await options.withTimeout(
        fetchGeminiImageCapability(options.apiKey),
        options.capabilityTimeoutMs,
        capabilityStage
    );

    const candidates = [...capability.models]
        .sort((left, right) => scoreImageModel(left.id) - scoreImageModel(right.id))
        .slice(0, 2);

    if (!candidates.length) {
        throw new Error(
            'La clave configurada no reporta ningún modelo de generación de imágenes compatible.'
        );
    }

    const failures: string[] = [];

    for (const candidate of candidates) {
        options.onModelAttempt(candidate.id);
        const generationStage = `generación de imagen con ${candidate.id}`;
        options.onStageChange(generationStage);

        try {
            const response: any = await options.withTimeout(
                options.ai.models.generateContent({
                    model: candidate.id,
                    contents: [{
                        parts: [{ text: options.buildImagePrompt() }]
                    }],
                    config: {
                        responseModalities: ['TEXT', 'IMAGE'],
                        imageConfig: {
                            aspectRatio: options.resource.aspectRatio
                        }
                    }
                } as any),
                options.imageTimeoutMs,
                generationStage
            );

            const parts = response?.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find(
                (part: any) => part?.inlineData?.data
            );

            if (!imagePart) {
                throw new Error(
                    'El modelo respondió, pero no incluyó ninguna imagen.'
                );
            }

            const imageData = `data:${
                imagePart.inlineData.mimeType || 'image/png'
            };base64,${imagePart.inlineData.data}`;

            options.onStageChange('guardado de la imagen');
            const imageUrl = await options.persistImage(imageData);

            return {
                imageUrl,
                imageModel: candidate.id,
                imageUsage: Number(
                    response?.usageMetadata?.totalTokenCount || 0
                )
            };
        } catch (imageError: any) {
            const issue = classifyAiIssue(imageError);
            const providerDetail = issue.raw.replace(/\s+/g, ' ').slice(0, 220);

            failures.push(
                `${candidate.id}: ${issue.userMessage}${
                    providerDetail && providerDetail !== issue.userMessage
                        ? ` [${providerDetail}]`
                        : ''
                }`
            );

            if (
                issue.kind === 'billing_required' ||
                issue.kind === 'quota_general' ||
                issue.kind === 'quota_daily' ||
                issue.kind === 'quota_minute'
            ) {
                options.onQuotaCooldown(Date.now() + 60_000, issue.userMessage);
            }

            if (/TIMEOUT_RECURSO/i.test(issue.raw)) break;
        }
    }

    throw new Error(
        `Ningún modelo devolvió una imagen. ${failures.join(' | ')}`
    );
};

export type SessionResourceGenerationResult =
    | 'ai_image'
    | 'skipped'
    | 'timeout'
    | false;

export type SessionResourceBatchSummary = {
    imageAiCount: number;
    failedCount: number;
    timeoutCount: number;
    skippedCount: number;
    message: string;
    type: 'success' | 'warning';
};

type RunSessionResourceBatchOptions = {
    resources?: Partial<SessionLearningResourcesData>;
    generate: (
        key: SessionResourceKey
    ) => Promise<SessionResourceGenerationResult>;
    getError: (key: SessionResourceKey) => string | undefined;
};

export const runSessionResourceGenerationBatch = async (
    options: RunSessionResourceBatchOptions
): Promise<SessionResourceBatchSummary> => {
    const orderedKeys: SessionResourceKey[] = [
        'instructive',
        'annex1',
        'annex2'
    ];
    const resources = createSessionLearningResourceDefaults(options.resources);

    let imageAiCount = 0;
    let failedCount = 0;
    let timeoutCount = 0;
    let skippedCount = 0;

    for (const key of orderedKeys) {
        if (resources[key].pinned && resources[key].imageUrl) {
            skippedCount += 1;
            continue;
        }

        const result = await options.generate(key);
        if (result === 'ai_image') imageAiCount += 1;
        else if (result === 'skipped') skippedCount += 1;
        else if (result === 'timeout') timeoutCount += 1;
        else failedCount += 1;
    }

    if (failedCount > 0 || timeoutCount > 0) {
        const issues = [
            timeoutCount
                ? `${timeoutCount} excedieron el tiempo máximo`
                : '',
            failedCount ? `${failedCount} fallaron` : ''
        ].filter(Boolean).join(' y ');

        const errorDetails = orderedKeys
            .map(key => {
                const error = options.getError(key);
                return error ? `${resources[key].title}: ${error}` : '';
            })
            .filter(Boolean)
            .join(' | ')
            .slice(0, 900);

        return {
            imageAiCount,
            failedCount,
            timeoutCount,
            skippedCount,
            message:
                `⚠️ Se generaron ${imageAiCount} imagen(es); ` +
                `${issues}. ${errorDetails} ` +
                'Los recursos fallidos conservaron su contenido anterior.',
            type: 'warning'
        };
    }

    return {
        imageAiCount,
        failedCount,
        timeoutCount,
        skippedCount,
        message:
            '✅ Recursos generados independientemente: ' +
            `${imageAiCount} imagen(es)` +
            (skippedCount
                ? `; ${skippedCount} recurso(s) anclado(s) se conservaron`
                : '') +
            '.',
        type: 'success'
    };
};
