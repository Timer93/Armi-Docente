import { GoogleGenAI } from '@google/genai';

const GEMINI_TEXT_MODELS = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
] as const;

const isRetryableGeminiError = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('high demand') ||
    message.includes('try again later')
  );
};

type GeminiContentRequest = {
  contents: any;
  config?: Record<string, any>;
};

const getModelCandidates = (preferredModel?: string) => {
  const trimmed = String(preferredModel || '').trim();
  return trimmed
    ? [trimmed, ...GEMINI_TEXT_MODELS.filter((model) => model !== trimmed)]
    : [...GEMINI_TEXT_MODELS];
};

export const createGeminiClient = (apiKey: string) => new GoogleGenAI({ apiKey });

export const generateGeminiContent = async (
  ai: GoogleGenAI,
  request: GeminiContentRequest,
  preferredModel?: string,
) => {
  let lastError: unknown = null;
  const modelCandidates = getModelCandidates(preferredModel);
  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    try {
      return await ai.models.generateContent({ model, ...request });
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || i === modelCandidates.length - 1) {
        throw error;
      }
    }
  }
  throw lastError;
};

export const generateGeminiContentStream = async (
  ai: GoogleGenAI,
  request: GeminiContentRequest,
  preferredModel?: string,
) => {
  let lastError: unknown = null;
  const modelCandidates = getModelCandidates(preferredModel);
  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    try {
      return await ai.models.generateContentStream({ model, ...request });
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || i === modelCandidates.length - 1) {
        throw error;
      }
    }
  }
  throw lastError;
};

export const getGeminiPreferredModel = () => GEMINI_TEXT_MODELS[0];
