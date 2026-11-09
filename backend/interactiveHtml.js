import { buildPracticeBridge } from './interactivePracticeRuntime.js';
const MAX_INTERACTIVE_HTML_BYTES = 8 * 1024 * 1024;

export const validateStoredInteractiveActivity = (activity) => {
  if (!activity || typeof activity !== 'object' || Array.isArray(activity)) return false;
  const html = String(activity.html || '').trim();
  if (!activity.id || !activity.enabled || !activity.criterionId || !html) return false;
  if (!['individual', 'group'].includes(String(activity.mode || 'individual'))) return false;
  if (Buffer.byteLength(html, 'utf8') > MAX_INTERACTIVE_HTML_BYTES) return false;
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) return false;
  if (!/<header[\s>]/i.test(html) || !/<main[\s>]/i.test(html) || !/<footer[\s>]/i.test(html)) return false;
  const compatibilityMeta = (html.match(/<meta\b[^>]*>/gi) || []).find((tag) =>
    /\bname\s*=\s*["']armi-activity-version["']/i.test(tag)
  );
  if (!compatibilityMeta || !/\bcontent\s*=\s*["']1["']/i.test(compatibilityMeta)) return false;
  if (!/armi:activity-result/i.test(html) || !/postMessage\s*\(/i.test(html)) return false;
  if (/<(?:iframe|frame|object|embed|base)\b/i.test(html)) return false;
  if (/<form\b[^>]*\baction\s*=/i.test(html)) return false;
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(?/i.test(html)) return false;
  if (/\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(html)) return false;
  if (/<script\b[^>]+src\s*=/i.test(html) || /<link\b[^>]+href\s*=/i.test(html)) return false;
  return true;
};

export const sandboxInteractiveHtml = (html, attempt = {}) => {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">`;
  const bridge = `<script>window.ARMI_ACTIVITY={version:1};</script>${buildPracticeBridge(attempt)}`;
  return /<head[\s>]/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${policy}${bridge}`)
    : `<!doctype html><html><head>${policy}${bridge}</head><body>${html}</body></html>`;
};

export const normalizeInteractiveResult = (payload) => {
  if (!payload || payload.type !== 'armi:activity-result' || Number(payload.version) !== 1 || payload.completed !== true) return null;
  const score = Number(payload.score);
  const maxScore = Number(payload.maxScore);
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 || score < 0 || score > maxScore) return null;
  return {
    score: Math.round(Math.max(0, Math.min(20, (score / maxScore) * 20)) * 100) / 100,
    answersSummary: String(payload.answersSummary || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
  };
};

export const levelFromScore = (score) => {
  if (score >= 18) return 'AD';
  if (score >= 14) return 'A';
  if (score >= 11) return 'B';
  return 'C';
};
