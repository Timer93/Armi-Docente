// Individual criteria use the entered score. Rounding belongs to averages only.
export const hybridLevelForScore = score => score >= 18 ? 'ad' : score >= 14 ? 'a' : score >= 11 ? 'b' : 'c';

export function normalizeHybridLevel(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['c', 'b', 'a', 'ad'].includes(text)) return text;
  if (text.includes('destacad')) return 'ad';
  if (text.includes('lograd')) return 'a';
  if (text.includes('proceso')) return 'b';
  if (text.includes('inicio')) return 'c';
  return '';
}

export function hybridGradeIssue(record, fallbackMode = '') {
  if ((record.grading_mode || record.gradingMode || fallbackMode) !== 'hybrid_vigesimal') return '';
  const raw = record.numeric_score;
  const missing = raw === null || raw === undefined || String(raw).trim() === '';
  const hasLevel = String(record.level || '').trim() !== '';
  if (!hasLevel && missing) return ''; // Clearing a criterion or saving an observation.
  if (missing) return 'Falta la nota numérica del criterio.';
  const score = Number(raw);
  if (!Number.isFinite(score) || score < 0 || score > 20) return 'La nota debe estar entre 0 y 20.';
  const level = normalizeHybridLevel(record.level);
  if (!level || level !== hybridLevelForScore(score)) {
    return `La letra ${String(record.level || '(vacía)')} no corresponde a la nota ${score}. Revise la calificación del criterio.`;
  }
  return '';
}

export function scopedHybridGradeIssues(records, sessionIds, studentIds) {
  const sessions = new Set(sessionIds.map(String));
  const students = new Set(studentIds.map(String));
  return records.filter(record => sessions.has(String(record.session_id))
    && students.has(String(record.student_id)) && hybridGradeIssue(record));
}
