import { useCallback, useRef, useState } from 'react';
import { saveImageAssetFile, verifyYouTubeResource } from '../../services/apiService';
import { createGeminiClient, generateGeminiContent } from '../../utils/gemini';
import { getAiUsageProgress, registerAiUsage } from '../../utils/aiUsage';
import { classifyAiIssue } from '../../utils/aiErrors';
import {
    createSessionLearningResourceDefaults,
    type SessionLearningResource,
    type SessionLearningResourcesData,
    type SessionResourceAIContent,
    type SessionResourceMetadata,
    type SessionResourceKey
} from './SessionLearningResources';
import { buildSessionResourcePlanPrompt, type SessionResourceAiContext } from './resource-prompts/buildResourcePlanPrompt';
import { buildSessionResourceImagePrompt } from './resource-prompts/buildResourceImagePrompt';
import { buildCopyableSessionResourcePrompt } from './resource-prompts/buildCopyableResourcePrompt';
import { cleanSessionResourceText as cleanResourceText } from './resource-prompts/cleanResourceText';
import {
    generateSessionResourceImage,
    normalizeSessionResourcePlan,
    runSessionResourceGenerationBatch,
    resolveSessionYouTubeResource
} from './resourceGeneration';
import { applyManualSessionResourceUpload, readSessionResourceImageFile } from './resourceMutations';
import {
    RESOURCE_CAPABILITY_TIMEOUT_MS,
    RESOURCE_IMAGE_TIMEOUT_MS,
    RESOURCE_PLAN_TIMEOUT_MS,
    parseAiJsonObject,
    withResourceTimeout
} from './sessionAiSupport';

interface UseSessionLearningResourceActionsParams {
    currentSessionId: string | null;
    selArea: string;
    selGrade: string;
    selSection: string;
    unitNumber: string;
    bimesterLabel: string;
    sessionNumber: string;
    maxSessionsInUnit: number;
    aiDynamicHoursLabel: string;
    sessionData: any;
    generalData: any;
    setSessionData: (value: any) => void;
    setShowAuthScreen: (value: boolean) => void;
    setAiUsageProgress: (value: any) => void;
    setToast: (value: any) => void;
}

export const useSessionLearningResourceActions = ({
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
}: UseSessionLearningResourceActionsParams) => {
    const [isGeneratingResources, setIsGeneratingResources] = useState(false);
    const [generatingResourceKey, setGeneratingResourceKey] = useState<SessionResourceKey | null>(null);
    const [resourceGenerationErrors, setResourceGenerationErrors] = useState<Partial<Record<SessionResourceKey, string>>>({});
    const resourceGenerationErrorsRef = useRef<Partial<Record<SessionResourceKey, string>>>({});
    const imageQuotaCooldownUntilRef = useRef(0);
    const imageQuotaCooldownReasonRef = useRef('');

    const updateLearningResources = useCallback((next: SessionLearningResourcesData) => {
        setSessionData((prev: any) => ({ ...prev, learningResources: next }));
    }, []);
    
    const persistSessionResourceImage = useCallback(async (key: SessionResourceKey, imageData: string) => {
        if (!currentSessionId) throw new Error('Selecciona una sesión válida.');
        const result = await saveImageAssetFile({
            imageData,
            kind: 'session_resource',
            userKey: `${currentSessionId}-${key}`
        });
        if (!result.success || !result.data?.fileUrl) throw new Error(result.message || 'No se pudo guardar la imagen.');
        const version = Date.now();
        return {
            imageUrl: `${result.data.fileUrl}?v=${version}`,
            wordImageUrl: result.data.wordFileUrl
                ? `${result.data.wordFileUrl}?v=${version}`
                : '',
            imageStorage: result.data.storage
        };
    }, [currentSessionId]);
    
       const buildResourceAiContext = useCallback((): SessionResourceAiContext => ({
    area: selArea,
    grade: selGrade,
    section: selSection,
    unit: unitNumber,
    bimester: bimesterLabel,
    session: sessionNumber,
    sessionTotal: maxSessionsInUnit,
    duration: aiDynamicHoursLabel,
    
    title: cleanResourceText(sessionData?.title),
    purpose: cleanResourceText(sessionData?.purpose),
    situation: cleanResourceText(sessionData?.situation),
    
    competency: cleanResourceText(sessionData?.competenciaPrio?.comp),
    capacity: cleanResourceText(sessionData?.competenciaPrio?.cap),
    thematicField: cleanResourceText(sessionData?.competenciaPrio?.field),
    criterion: cleanResourceText(sessionData?.competenciaPrio?.des),
    evidence: cleanResourceText(sessionData?.competenciaPrio?.evidence),
    instrument: cleanResourceText(sessionData?.competenciaPrio?.inst),
    
    learningSequence: {
        priorKnowledge: cleanResourceText(
            sessionData?.secuencia?.inicio?.saberes
        ),
        cognitiveConflict: cleanResourceText(
            sessionData?.secuencia?.inicio?.conflicto
        ),
        construction: cleanResourceText(
            sessionData?.secuencia?.proceso?.construccion
        ),
        application: cleanResourceText(
            sessionData?.secuencia?.proceso?.aplicacion
        ),
        metacognition: cleanResourceText(
            sessionData?.secuencia?.proceso?.metacognicion
        ),
        assessment: cleanResourceText(
            sessionData?.secuencia?.salida?.evaluacion
        )
    }
    }), [
    selArea,
    selGrade,
    selSection,
    unitNumber,
    bimesterLabel,
    sessionNumber,
    maxSessionsInUnit,
    aiDynamicHoursLabel,
    sessionData
    ]);
    
    
    
    
    
    
    
    
    const buildResourcePlanPrompt = useCallback((
    key: SessionResourceKey,
    resource: SessionLearningResource
    ) => buildSessionResourcePlanPrompt(
    buildResourceAiContext(),
    key,
    resource
    ), [buildResourceAiContext]);
    
    
    
    
    
    
    
    
    const normalizeResourcePlan = useCallback((
        raw: any
    ) => normalizeSessionResourcePlan(
        raw,
        buildResourceAiContext()
    ), [buildResourceAiContext]);
    
    const resolveYouTubeResource = useCallback((
        ai: any,
        preferredModel: string,
        plan: {
            content: SessionResourceAIContent;
            metadata: SessionResourceMetadata;
        }
    ) => resolveSessionYouTubeResource(
        ai,
        preferredModel,
        plan,
        selGrade,
        {
            generateContent: generateGeminiContent,
            parseJson: parseAiJsonObject,
            verifyResource: verifyYouTubeResource,
            withTimeout: withResourceTimeout,
            timeoutMs: RESOURCE_PLAN_TIMEOUT_MS
        }
    ), [selGrade]);
    
    const buildResourceImagePrompt = useCallback((
    key: SessionResourceKey,
    resource: SessionLearningResource,
    content: SessionResourceAIContent
    ) => buildSessionResourceImagePrompt(key, resource, content), []);
    const buildCopyableResourcePrompt = useCallback((
    key: SessionResourceKey
    ) => {
    const resource = createSessionLearningResourceDefaults(
        sessionData?.learningResources
    )[key];
    
    return buildCopyableSessionResourcePrompt(
        key,
        resource,
        buildResourceAiContext()
    );
    }, [
    buildResourceAiContext,
    sessionData?.learningResources
    ]);
    const copyResourcePrompts = useCallback(async (
    keys: SessionResourceKey[]
    ) => {
    /*
     * Nunca unimos varios prompts en uno.
     *
     * Un generador de imágenes debe recibir cada recurso
     * en una interacción independiente.
     */
    if (keys.length !== 1) {
        setToast({
            msg: '⚠️ Para evitar que la IA mezcle INSTRUCTIVO, ANEXO 1 y ANEXO 2, los prompts ya no se copian juntos. Usa el botón de copiar de cada recurso y envíalos en tres interacciones independientes.',
            type: 'warning'
        });
        return;
    }
    
    const key = keys[0];
    const text = buildCopyableResourcePrompt(key);
    
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
    
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
    
            document.body.appendChild(textarea);
    
            textarea.select();
            document.execCommand('copy');
    
            textarea.remove();
        }
    
        const resourceName =
            key === 'instructive'
                ? 'INSTRUCTIVO'
                : key === 'annex1'
                    ? 'ANEXO 1'
                    : 'ANEXO 2';
    
        setToast({
            msg: `📋 Prompt de ${resourceName} copiado. Envíalo como una interacción independiente.`,
            type: 'success'
        });
    
    } catch {
        setToast({
            msg: '❌ No se pudo copiar el prompt al portapapeles.',
            type: 'error'
        });
    }
    
    }, [
    buildCopyableResourcePrompt,
    setToast
    ]);
    
    
    
    const handleGenerateResource = useCallback(async (
    key: SessionResourceKey,
    options?: { silent?: boolean }
    ) => {
    const silent = !!options?.silent;
    
    const resources = createSessionLearningResourceDefaults(
        sessionData?.learningResources
    );
    
    const resource = resources[key];
    
    resourceGenerationErrorsRef.current[key] = undefined;
    
    setResourceGenerationErrors(current => ({
        ...current,
        [key]: undefined
    }));
    
    if (resource.pinned) {
        if (!silent) {
            setToast({
                msg: '📌 El recurso está anclado. Desanclalo para regenerarlo.',
                type: 'warning'
            });
        }
    
        return 'skipped' as const;
    }
    
    const apiKey = String(
        generalData?.gemini_api_key ||
        process.env.API_KEY ||
        ''
    ).trim();
    
    if (!apiKey || apiKey.length < 10) {
        setShowAuthScreen(true);
        return false;
    }
    
    const preferredGeminiModel =
        String(generalData?.gemini_model || '').trim();
    
    const attemptedImageModels: string[] = [];
    
    let generationStage = 'contenido pedagógico';
    
    setGeneratingResourceKey(key);
    
    try {
        const ai = createGeminiClient(apiKey);
    
        /*
         * PASO 1
         * Crear el contenido pedagógico EXCLUSIVO del recurso actual.
         */
        const planningResponse: any =
            await withResourceTimeout(
                generateGeminiContent(
                    ai,
                    {
                        contents: [{
                            parts: [{
                                text: buildResourcePlanPrompt(
                                    key,
                                    resource
                                )
                            }]
                        }],
                        config: {
                            responseMimeType: 'application/json',
                            temperature: 0.35
                        }
                    },
                    preferredGeminiModel
                ),
                RESOURCE_PLAN_TIMEOUT_MS,
                'contenido pedagógico'
            );
    
        const plan = normalizeResourcePlan(
            parseAiJsonObject(
                String(planningResponse?.text || '')
            )
        );
    
        const planningModel =
            String(
                planningResponse?.modelVersion ||
                preferredGeminiModel ||
                'Gemini'
            );
    
        /*
         * Metadatos inicialmente producidos por la planificación.
         */
        let metadata: SessionResourceMetadata = {
            ...plan.metadata
        };
    
        /*
         * El contenido que finalmente recibirá
         * el generador de imágenes.
         */
        let imageContent: SessionResourceAIContent = {
            ...plan.content,
            sections: [...(plan.content.sections || [])]
        };
    
        /*
         * PASO 2
         * ANEXO 1 YOUTUBE:
         *
         * Primero encontramos y verificamos el video.
         *
         * MUY IMPORTANTE:
         * La miniatura NO será la imagen final del recurso.
         * Los datos verificados se incorporan al contenido
         * y después se genera la ficha ANEXO 1.
         */
        if (key === 'annex1' && resource.kind === 'youtube') {
            generationStage =
                'búsqueda y verificación del video';
    
            const youtube =
                await resolveYouTubeResource(
                    ai,
                    preferredGeminiModel,
                    plan
                );
    
            metadata = {
                ...metadata,
                ...youtube
            };
    
            const videoInformation = [
                youtube.externalTitle
                    ? `Título real del video: ${youtube.externalTitle}`
                    : '',
                youtube.authorName
                    ? `Canal o autor: ${youtube.authorName}`
                    : '',
                youtube.url
                    ? `Enlace directo verificado: ${youtube.url}`
                    : '',
                youtube.pedagogicalReason
                    ? `Pertinencia pedagógica: ${youtube.pedagogicalReason}`
                    : ''
            ]
                .filter(Boolean)
                .join('\n');
    
            imageContent = {
                ...imageContent,
    
                eyebrow: 'ANEXO 1 · VIDEO DE YOUTUBE',
    
                summary: [
                    imageContent.summary,
                    videoInformation
                ]
                    .filter(Boolean)
                    .join('\n'),
    
                sections: [
                    {
                        label: 'VIDEO SELECCIONADO',
                        body: videoInformation,
                        visualFormat: 'concept'
                    },
    
                    ...(imageContent.sections || [])
                ].slice(0, 7)
            };
        }
    
        /*
         * PASOS 3 Y 4
         * Seleccionar un modelo compatible, generar y persistir la imagen.
         */
        const {
            imageUrl,
            wordImageUrl,
            imageStorage,
            imageModel,
            imageUsage
        } = await generateSessionResourceImage({
            ai,
            apiKey,
            key,
            resource,
            content: imageContent,
            cooldownUntil: imageQuotaCooldownUntilRef.current,
            cooldownReason: imageQuotaCooldownReasonRef.current,
            capabilityTimeoutMs: RESOURCE_CAPABILITY_TIMEOUT_MS,
            imageTimeoutMs: RESOURCE_IMAGE_TIMEOUT_MS,
            buildImagePrompt: () => buildResourceImagePrompt(
                key,
                resource,
                imageContent
            ),
            persistImage: imageData => persistSessionResourceImage(
                key,
                imageData
            ),
            withTimeout: withResourceTimeout,
            onStageChange: stage => {
                generationStage = stage;
            },
            onModelAttempt: model => {
                attemptedImageModels.push(model);
            },
            onQuotaCooldown: (until, reason) => {
                imageQuotaCooldownUntilRef.current = until;
                imageQuotaCooldownReasonRef.current = reason;
            }
        });
    
        /*
         * PASO 5
         * Guardar recurso terminado.
         */
        const generation = {
            mode: 'ai_image' as const,
            provider: 'gemini' as const,
            model: planningModel,
    
            ...(imageModel
                ? { imageModel }
                : {}),
    
            promptVersion:
                'session-resource-v4-independent',
    
            generatedAt:
                new Date().toISOString()
        };
    
        setSessionData((prev: any) => {
            const next =
                createSessionLearningResourceDefaults(
                    prev?.learningResources
                );
    
            next[key] = {
                ...next[key],
    
                imageUrl,
                wordImageUrl,
                imageStorage,
    
                /*
                 * Guardamos exactamente el contenido
                 * utilizado para la imagen.
                 */
                aiContent: imageContent,
    
                metadata,
    
                generation,
    
                sourceSessionId:
                    currentSessionId
            };
    
            return {
                ...prev,
                learningResources: next
            };
        });
    
        registerAiUsage(
            'gemini',
            `session_resource_plan_${key}`,
            Number(
                planningResponse
                    ?.usageMetadata
                    ?.totalTokenCount || 0
            )
        );
    
        if (imageUsage) {
            registerAiUsage(
                'gemini',
                `session_resource_image_${key}`,
                imageUsage
            );
        }
    
        setAiUsageProgress(
            getAiUsageProgress()
        );
    
        if (!silent) {
            const resourceLabel =
                key === 'instructive'
                    ? 'INSTRUCTIVO'
                    : key === 'annex1'
                        ? 'ANEXO 1'
                        : 'ANEXO 2';
    
            const youtubeDetail =
                key === 'annex1' &&
                resource.kind === 'youtube'
                    ? ' Video verificado y ficha visual generada.'
                    : '';
    
            setToast({
                msg:
                    `✅ ${resourceLabel}: imagen generada con ${imageModel}.${youtubeDetail}`,
                type: 'success'
            });
        }
    
        return 'ai_image' as const;
    
    } catch (error: any) {
        const rawError =
            String(
                error?.message ||
                error ||
                ''
            );
    
        const timedOut =
            /TIMEOUT_RECURSO/i.test(rawError);
    
        const issue =
            classifyAiIssue(error);
    
        const modelLabel =
            attemptedImageModels.length
                ? attemptedImageModels.join(', ')
                : /(imagen|imágenes)/i.test(
                    generationStage
                )
                    ? 'ninguno; la solicitud se detuvo antes de invocar el modelo de imagen'
                    : preferredGeminiModel ||
                      'modelo de texto configurado';
    
        const conciseRaw =
            rawError
                .replace(/\s+/g, ' ')
                .slice(0, 280);
    
        const diagnostic =
            `Etapa: ${generationStage}. ` +
            `Modelo(s): ${modelLabel}. ` +
            `Motivo: ${
                timedOut
                    ? 'Tiempo máximo excedido.'
                    : issue.userMessage
            }${
                conciseRaw &&
                issue.userMessage !== conciseRaw
                    ? ` Detalle: ${conciseRaw}`
                    : ''
            }`;
    
        resourceGenerationErrorsRef.current[key] =
            diagnostic;
    
        setResourceGenerationErrors(current => ({
            ...current,
            [key]: diagnostic
        }));
    
        if (!silent) {
            setToast({
                msg:
                    timedOut
                        ? `⏱️ ${resource.title} no se modificó. ${diagnostic}`
                        : `❌ ${resource.title} no se modificó. ${diagnostic}`,
    
                type:
                    timedOut
                        ? 'warning'
                        : 'error'
            });
        }
    
        return timedOut
            ? 'timeout' as const
            : false;
    
    } finally {
        setGeneratingResourceKey(null);
    }
    
    }, [
    buildResourceImagePrompt,
    buildResourcePlanPrompt,
    currentSessionId,
    generalData?.gemini_api_key,
    generalData?.gemini_model,
    normalizeResourcePlan,
    persistSessionResourceImage,
    resolveYouTubeResource,
    sessionData,
    setToast
    ]);
    
    
    
    
    const handleGenerateAllResources = useCallback(async () => {
        if (isGeneratingResources || generatingResourceKey !== null) {
            setToast({
                msg: '⚠️ Ya hay una generación de recursos en proceso.',
                type: 'warning'
            });
            return;
        }
    
        setIsGeneratingResources(true);
    
        try {
            const summary = await runSessionResourceGenerationBatch({
                resources: sessionData?.learningResources,
                generate: key => handleGenerateResource(
                    key,
                    { silent: true }
                ),
                getError: key => resourceGenerationErrorsRef.current[key]
            });
    
            setToast({
                msg: summary.message,
                type: summary.type
            });
        } finally {
            setIsGeneratingResources(false);
        }
    }, [
        generatingResourceKey,
        handleGenerateResource,
        isGeneratingResources,
        sessionData?.learningResources,
        setToast
    ]);
    
    const handleUploadResource = useCallback(async (key: SessionResourceKey, file: File) => {
        if (!file.type.startsWith('image/')) {
            setToast({ msg: 'Selecciona un archivo de imagen válido.', type: 'warning' });
            return;
        }
        try {
            const imageData = await readSessionResourceImageFile(file);
            const storedImage = await persistSessionResourceImage(key, imageData);
            setSessionData((prev: any) => {
                const learningResources = applyManualSessionResourceUpload(
                    prev?.learningResources,
                    key,
                    storedImage,
                    currentSessionId
                );
                return { ...prev, learningResources };
            });
            setToast({ msg: '✅ Recurso cargado y guardado.', type: 'success' });
        } catch (error: any) {
            setToast({ msg: `❌ ${error?.message || 'No se pudo cargar la imagen.'}`, type: 'error' });
        }
    }, [currentSessionId, persistSessionResourceImage, setToast]);

    return {
        isGeneratingResources,
        generatingResourceKey,
        resourceGenerationErrors,
        updateLearningResources,
        copyResourcePrompts,
        handleGenerateResource,
        handleGenerateAllResources,
        handleUploadResource
    };
};
