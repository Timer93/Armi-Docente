import {
    createSessionLearningResourceDefaults,
    type SessionLearningResourcesData,
    type SessionResourceKey
} from './SessionLearningResources';

export const readSessionResourceImageFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
    });

export const applyManualSessionResourceUpload = (
    resources: Partial<SessionLearningResourcesData> | null | undefined,
    key: SessionResourceKey,
    storedImage: {
        imageUrl: string;
        wordImageUrl?: string;
        imageStorage?: SessionLearningResourcesData[SessionResourceKey]['imageStorage'];
    },
    currentSessionId: string | undefined,
    generatedAt = new Date().toISOString()
): SessionLearningResourcesData => {
    const next = createSessionLearningResourceDefaults(resources);
    const preservedManualVideoUrl =
        key === 'annex1' && next[key].kind === 'youtube'
            ? String(next[key].metadata?.url || '').trim()
            : '';

    next[key] = {
        ...next[key],
        imageUrl: storedImage.imageUrl,
        wordImageUrl: storedImage.wordImageUrl || '',
        imageStorage: storedImage.imageStorage,
        aiContent: undefined,
        metadata: preservedManualVideoUrl
            ? { url: preservedManualVideoUrl }
            : undefined,
        generation: {
            mode: 'manual',
            provider: 'manual',
            model: '',
            promptVersion: '',
            generatedAt
        },
        sourceSessionId: currentSessionId
    };

    return next;
};

export const prepareReusedSessionResources = (
    resources: Partial<SessionLearningResourcesData> | null | undefined,
    sourceSessionId: string
): SessionLearningResourcesData => {
    const reused = createSessionLearningResourceDefaults(resources);

    (Object.keys(reused) as SessionResourceKey[]).forEach(key => {
        reused[key] = {
            ...reused[key],
            sourceSessionId
        };
    });

    return reused;
};
