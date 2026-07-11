export type AiProvider = 'gemini' | 'openai';

export type AiModelOption = {
  id: string;
  label: string;
};

export type AiImageCapability = {
  available: boolean;
  models: AiModelOption[];
  source: 'live' | 'fallback' | 'unknown';
};

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

const GEMINI_FALLBACK_MODELS: AiModelOption[] = [
  { id: DEFAULT_GEMINI_MODEL, label: 'Gemini 3.5 Flash' },
];

const OPENAI_FALLBACK_MODELS: AiModelOption[] = [
  { id: DEFAULT_OPENAI_MODEL, label: 'GPT-4.1 Mini' },
];

const toTitleLabel = (value: string) =>
  value
    .replace(/^models\//, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const uniqueById = (items: AiModelOption[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const isGeminiTextModel = (id: string, generationMethods: string[]) => {
  const lowerId = id.toLowerCase();
  const supportsText = generationMethods.some((method) => String(method).toLowerCase() === 'generatecontent');
  if (!supportsText) return false;
  if (lowerId.includes('preview')) return false;
  if (lowerId.includes('deprecated')) return false;
  if (lowerId.includes('image')) return false;
  if (lowerId.includes('tts')) return false;
  if (lowerId.includes('embedding')) return false;
  if (lowerId.includes('aqa')) return false;
  if (lowerId.includes('vision')) return false;
  return true;
};

const isGeminiImageModel = (id: string, generationMethods: string[]) => {
  const lowerId = id.toLowerCase();
  const supportsTextGeneration = generationMethods.some((method) => String(method).toLowerCase() === 'generatecontent');
  if (!supportsTextGeneration) return false;
  if (lowerId.includes('deprecated')) return false;
  return (
    lowerId.includes('image') ||
    lowerId.includes('imagen') ||
    lowerId.includes('banana')
  );
};

const isOpenAITextModel = (id: string) => {
  const lowerId = id.toLowerCase();
  const allowedPrefix = /^(gpt|o[134]|chatgpt)/.test(lowerId);
  if (!allowedPrefix) return false;
  if (lowerId.includes('audio')) return false;
  if (lowerId.includes('realtime')) return false;
  if (lowerId.includes('transcribe')) return false;
  if (lowerId.includes('tts')) return false;
  if (lowerId.includes('image')) return false;
  if (lowerId.includes('embedding')) return false;
  if (lowerId.includes('moderation')) return false;
  if (lowerId.includes('whisper')) return false;
  if (lowerId.includes('search')) return false;
  return true;
};

const isOpenAIImageModel = (id: string) => {
  const lowerId = id.toLowerCase();
  return lowerId.includes('image');
};

export const getFallbackModelOptions = (provider: AiProvider): AiModelOption[] =>
  provider === 'gemini' ? GEMINI_FALLBACK_MODELS : OPENAI_FALLBACK_MODELS;

export const getDefaultModelForProvider = (provider: AiProvider) =>
  provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL;

export const fetchGeminiTextModels = async (apiKey: string): Promise<AiModelOption[]> => {
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) return GEMINI_FALLBACK_MODELS;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error?.message || 'No se pudo consultar modelos de Gemini.');
  }

  const models = Array.isArray(payload?.models) ? payload.models : [];
  const filtered = models
    .map((item: any) => {
      const rawName = String(item?.name || '').trim();
      const id = rawName.replace(/^models\//, '');
      const displayName = String(item?.displayName || '').trim();
      const generationMethods = Array.isArray(item?.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
      return { id, label: displayName || toTitleLabel(id), generationMethods };
    })
    .filter((item) => isGeminiTextModel(item.id, item.generationMethods))
    .map(({ id, label }) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return uniqueById([ ...filtered, ...GEMINI_FALLBACK_MODELS ]);
};

export const fetchGeminiImageCapability = async (apiKey: string): Promise<AiImageCapability> => {
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) {
    return { available: false, models: [], source: 'unknown' };
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error?.message || 'No se pudo consultar acceso a imágenes en Gemini.');
  }

  const models = Array.isArray(payload?.models) ? payload.models : [];
  const filtered = models
    .map((item: any) => {
      const rawName = String(item?.name || '').trim();
      const id = rawName.replace(/^models\//, '');
      const displayName = String(item?.displayName || '').trim();
      const generationMethods = Array.isArray(item?.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
      return { id, label: displayName || toTitleLabel(id), generationMethods };
    })
    .filter((item) => isGeminiImageModel(item.id, item.generationMethods))
    .map(({ id, label }) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    available: filtered.length > 0,
    models: uniqueById(filtered),
    source: 'live',
  };
};

export const fetchOpenAITextModels = async (apiKey: string): Promise<AiModelOption[]> => {
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) return OPENAI_FALLBACK_MODELS;

  const res = await fetch('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${trimmedKey}`,
    },
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error?.message || 'No se pudo consultar modelos de OpenAI.');
  }

  const models = Array.isArray(payload?.data) ? payload.data : [];
  const filtered = models
    .map((item: any) => {
      const id = String(item?.id || '').trim();
      return { id, label: id.toUpperCase() };
    })
    .filter((item) => isOpenAITextModel(item.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .reverse();

  return uniqueById([ ...filtered, ...OPENAI_FALLBACK_MODELS ]);
};

export const fetchOpenAIImageCapability = async (apiKey: string): Promise<AiImageCapability> => {
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) {
    return { available: false, models: [], source: 'unknown' };
  }

  const res = await fetch('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${trimmedKey}`,
    },
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error?.message || 'No se pudo consultar acceso a imágenes en OpenAI.');
  }

  const models = Array.isArray(payload?.data) ? payload.data : [];
  const filtered = models
    .map((item: any) => {
      const id = String(item?.id || '').trim();
      return { id, label: id.toUpperCase() };
    })
    .filter((item) => isOpenAIImageModel(item.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    available: filtered.length > 0,
    models: uniqueById(filtered),
    source: 'live',
  };
};
