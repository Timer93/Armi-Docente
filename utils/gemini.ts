import { GoogleGenAI } from '@google/genai';

const GEMINI_TEXT_MODELS = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
] as const;

const isFallbackEligibleGeminiError = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('resource exhausted') ||
    message.includes('quota exceeded') ||
    message.includes('exceeded your current quota') ||
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

export type GeminiFallbackOptions = {
  candidateModels?: string[];
  unavailableModels?: Set<string>;
  onModelSelected?: (model: string, usedFallback: boolean) => void;
};

const getModelCandidates = (
  preferredModel?: string,
  extraCandidates: string[] = [],
  unavailableModels: Set<string> = new Set(),
) => {
  const trimmed = String(preferredModel || '').trim();
  return Array.from(new Set([
    ...(trimmed ? [trimmed] : []),
    ...extraCandidates.map((model) => String(model || '').trim()).filter(Boolean),
    ...GEMINI_TEXT_MODELS,
  ])).filter((model) => !unavailableModels.has(model));
};

const noGeminiModelsAvailableError = () =>
  new Error('429 RESOURCE_EXHAUSTED: Todos los modelos alternativos de Gemini alcanzaron su cuota o no están disponibles.');

export const createGeminiClient = (apiKey: string) => new GoogleGenAI({ apiKey });

export const generateGeminiContent = async (
  ai: GoogleGenAI,
  request: GeminiContentRequest,
  preferredModel?: string,
  fallbackOptions: GeminiFallbackOptions = {},
) => {
  let lastError: unknown = null;
  const modelCandidates = getModelCandidates(preferredModel, fallbackOptions.candidateModels, fallbackOptions.unavailableModels);
  if (modelCandidates.length === 0) throw noGeminiModelsAvailableError();
  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    try {
      const response = await ai.models.generateContent({ model, ...request });
      fallbackOptions.onModelSelected?.(model, i > 0);
      return response;
    } catch (error) {
      lastError = error;
      const fallbackEligible = isFallbackEligibleGeminiError(error);
      if (fallbackEligible) fallbackOptions.unavailableModels?.add(model);
      if (!fallbackEligible || i === modelCandidates.length - 1) {
        throw error;
      }
    }
  }
  throw lastError;
};

export const generateGeminiContentStream = (
  ai: GoogleGenAI,
  request: GeminiContentRequest,
  preferredModel?: string,
  fallbackOptions: GeminiFallbackOptions = {},
) => (async function* () {
  let lastError: unknown = null;
  const modelCandidates = getModelCandidates(preferredModel, fallbackOptions.candidateModels, fallbackOptions.unavailableModels);
  if (modelCandidates.length === 0) throw noGeminiModelsAvailableError();
  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    let emittedContent = false;
    try {
      const stream = await ai.models.generateContentStream({ model, ...request });
      for await (const chunk of stream) {
        emittedContent = true;
        yield chunk;
      }
      fallbackOptions.onModelSelected?.(model, i > 0);
      return;
    } catch (error) {
      lastError = error;
      const fallbackEligible = isFallbackEligibleGeminiError(error);
      if (fallbackEligible) fallbackOptions.unavailableModels?.add(model);
      // Reiniciar despuÃ©s de emitir texto mezclarÃ­a dos respuestas JSON distintas.
      if (emittedContent || !fallbackEligible || i === modelCandidates.length - 1) {
        throw error;
      }
    }
  }
  throw lastError;
})();

export const getGeminiPreferredModel = () => GEMINI_TEXT_MODELS[0];
