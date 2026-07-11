export type AiIssueKind =
  | 'auth'
  | 'quota_minute'
  | 'quota_daily'
  | 'quota_general'
  | 'saturation'
  | 'model_access'
  | 'malformed_json'
  | 'empty_response'
  | 'unknown';

export const classifyAiIssue = (error: unknown): { kind: AiIssueKind; raw: string; userMessage: string } => {
  const raw = String((error as any)?.message || error || '').trim();
  const msg = raw.toLowerCase();

  if (msg.includes('401') || msg.includes('403') || msg.includes('api key') || msg.includes('unauthorized') || msg.includes('permission')) {
    return { kind: 'auth', raw, userMessage: 'Revisa tu API key o los permisos de tu cuenta.' };
  }
  if (msg.includes('json malformado') || msg.includes('json inválido') || msg.includes('json invalido')) {
    return { kind: 'malformed_json', raw, userMessage: 'La IA respondió con un formato roto. Intenta otra vez.' };
  }
  if (msg.includes('empty_response') || msg.includes('no devolvió un json utilizable') || msg.includes('no devolvio un json utilizable')) {
    return { kind: 'empty_response', raw, userMessage: 'La IA respondió vacía o incompleta. Intenta otra vez.' };
  }
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429')) {
    if (msg.includes('per minute') || msg.includes('rpm') || msg.includes('minute')) {
      return { kind: 'quota_minute', raw, userMessage: 'Llegaste al límite por minuto. Espera un momento e intenta otra vez.' };
    }
    if (msg.includes('per day') || msg.includes('rpd') || msg.includes('daily') || msg.includes('day')) {
      return { kind: 'quota_daily', raw, userMessage: 'Llegaste al límite diario de tu plan gratuito o proyecto.' };
    }
    return { kind: 'quota_general', raw, userMessage: 'Llegaste a un límite de uso del proveedor. Intenta más tarde.' };
  }
  if (msg.includes('quota') || msg.includes('resource exhausted') || msg.includes('exceeded your current quota')) {
    if (msg.includes('day') || msg.includes('daily')) {
      return { kind: 'quota_daily', raw, userMessage: 'Llegaste al límite diario de tu plan gratuito o proyecto.' };
    }
    return { kind: 'quota_general', raw, userMessage: 'Tu cuenta o proyecto alcanzó un límite de uso.' };
  }
  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('try again later')) {
    return { kind: 'saturation', raw, userMessage: 'El modelo está saturado o temporalmente no disponible.' };
  }
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('not supported') || msg.includes('not allowed') || msg.includes('access'))) {
    return { kind: 'model_access', raw, userMessage: 'Tu cuenta no tiene acceso a ese modelo o ya no está disponible.' };
  }

  return { kind: 'unknown', raw, userMessage: raw || 'Ocurrió un error inesperado con la IA.' };
};
