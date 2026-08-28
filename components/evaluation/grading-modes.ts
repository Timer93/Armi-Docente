export const GRADING_MODES = ['literal_traditional', 'criterial_predominance', 'hybrid_vigesimal'] as const;

export type GradingMode = typeof GRADING_MODES[number];
export type AchievementLevel = 'c' | 'b' | 'a' | 'ad';

export const DEFAULT_GRADING_MODE: GradingMode = 'literal_traditional';

export const GRADING_MODE_LABELS: Record<GradingMode, string> = {
  literal_traditional: 'Literal tradicional',
  criterial_predominance: 'Criterial por evidencias',
  hybrid_vigesimal: 'Híbrido vigesimal–literal'
};

export const NUMERIC_LEVEL_RANGES: Record<AchievementLevel, { min: number; max: number }> = {
  c: { min: 0, max: 10.999999 },
  b: { min: 11, max: 13.999999 },
  a: { min: 14, max: 17.999999 },
  ad: { min: 18, max: 20 }
};

export const normalizeNumericScore = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20) return null;
  return parsed;
};

export const numericScoreToLevel = (value: unknown): AchievementLevel | null => {
  const score = normalizeNumericScore(value);
  if (score === null) return null;
  if (score >= 18) return 'ad';
  if (score >= 14) return 'a';
  if (score >= 11) return 'b';
  return 'c';
};

export const isScoreAllowedForLevel = (value: unknown, level: AchievementLevel): boolean => {
  const score = normalizeNumericScore(value);
  if (score === null) return false;
  const range = NUMERIC_LEVEL_RANGES[level];
  return score >= range.min && score <= range.max;
};

export const averageNumericScores = (values: unknown[]): number | null => {
  const scores = values.map(normalizeNumericScore).filter((score): score is number => score !== null);
  if (!scores.length) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

export const formatNumericScore = (value: unknown, decimals = 1): string => {
  const score = normalizeNumericScore(value);
  return score === null ? '' : score.toFixed(decimals).replace('.', ',');
};
