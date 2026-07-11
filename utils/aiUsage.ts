import type { AiProvider } from './aiModels';

type AiUsageEntry = {
  date: string;
  total: number;
  tokens: number;
  byProvider: Record<string, number>;
  byFeature: Record<string, number>;
};

export type AiUsageProgress = {
  current: number;
  limit: number;
  percent: number;
  label: string;
  note: string;
  tokens: number;
  tokenLabel: string;
};

const STORAGE_KEY = 'armi_ai_usage_daily_v1';
const SOFT_DAILY_LIMIT = 100;

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const readUsage = (): AiUsageEntry => {
  if (typeof window === 'undefined') {
    return { date: getTodayKey(), total: 0, tokens: 0, byProvider: {}, byFeature: {} };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const today = getTodayKey();
    if (!parsed || parsed.date !== today) {
      return { date: today, total: 0, tokens: 0, byProvider: {}, byFeature: {} };
    }
    return {
      date: today,
      total: Number(parsed.total || 0),
      tokens: Number(parsed.tokens || 0),
      byProvider: typeof parsed.byProvider === 'object' && parsed.byProvider ? parsed.byProvider : {},
      byFeature: typeof parsed.byFeature === 'object' && parsed.byFeature ? parsed.byFeature : {},
    };
  } catch {
    return { date: getTodayKey(), total: 0, tokens: 0, byProvider: {}, byFeature: {} };
  }
};

const writeUsage = (entry: AiUsageEntry) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
};

export const registerAiUsage = (provider: AiProvider, feature: string, tokensUsed = 0) => {
  const next = readUsage();
  next.total += 1;
  next.tokens += Math.max(0, Math.round(Number(tokensUsed) || 0));
  next.byProvider[provider] = Number(next.byProvider[provider] || 0) + 1;
  next.byFeature[feature] = Number(next.byFeature[feature] || 0) + 1;
  writeUsage(next);
  return next;
};

export const getAiUsageProgress = (): AiUsageProgress => {
  const usage = readUsage();
  const current = usage.total;
  const percent = Math.min(100, Math.round((current / SOFT_DAILY_LIMIT) * 100));
  return {
    current,
    limit: SOFT_DAILY_LIMIT,
    percent,
    label: `${current}/${SOFT_DAILY_LIMIT}`,
    note: 'Medidor local del día. No es la cuota oficial del proveedor.',
    tokens: usage.tokens,
    tokenLabel: `${usage.tokens.toLocaleString('es-CO')} tokens usados hoy`,
  };
};
