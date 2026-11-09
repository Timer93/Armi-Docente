import { resolveSessionCriterionRows } from './shared/sessionCriterionIdentity.js';

const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const list = value => { try { const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
const stamp = value => {
  const text = String(value || '').trim().replace(' ', 'T');
  return Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`) || 0;
};

// Presence never depends on grades. Review timestamps belong only to the
// evidence's criterion/competency: grading an HTML activity in another column
// must not hide a student's uploaded documents.
export const createSessionEvidenceScopeResolver = (sessionData = {}) => {
  const aliases = new Map();
  const rows = resolveSessionCriterionRows(sessionData, sessionData.sessionAssessmentModel?.rows || []);
  for (const row of rows) {
    const scope = `${row.source || ''}::${key(row.competencyName || row.competencia || row.comp)}`;
    for (const id of row.recordIds || [row.id]) aliases.set(String(id), scope);
  }
  return id => {
    const text = String(id || '');
    const summary = text.match(/^summary::(primary|transversal)::(.+)$/);
    return summary ? `${summary[1]}::${key(summary[2])}` : aliases.get(text) || `criterion::${text}`;
  };
};

export const buildSessionEvidenceReview = ({ evidences, records, sessionData = {} }) => {
  const scopeFor = createSessionEvidenceScopeResolver(sessionData);
  const reviews = new Map();
  for (const record of records) {
    if (!String(record.level || '').trim() && !String(record.observation || '').trim()) continue;
    const id = `${record.student_id}|${scopeFor(record.criteria_id)}`;
    if (stamp(record.updated_at) > stamp(reviews.get(id))) reviews.set(id, record.updated_at);
  }
  const students = new Map();
  for (const evidence of evidences) {
    if (Number(evidence.is_latest ?? 1) !== 1) continue;
    const ids = new Set([evidence.student_id, ...list(evidence.student_ids)].filter(id => id !== null && id !== undefined && String(id).trim()).map(String));
    for (const studentId of ids) {
      const current = students.get(studentId) || { studentId, evidenceCount: 0, pendingCount: 0, latestSubmissionAt: '', reviewedAt: '', pending: false };
      current.evidenceCount++;
      const submittedAt = evidence.submitted_at || evidence.updated_at || '';
      if (stamp(submittedAt) >= stamp(current.latestSubmissionAt)) current.latestSubmissionAt = submittedAt;
      const reviewedAt = reviews.get(`${studentId}|${scopeFor(evidence.criteria_id)}`) || '';
      if (stamp(reviewedAt) > stamp(current.reviewedAt)) current.reviewedAt = reviewedAt;
      if (['student_portal', 'evidence_template'].includes(evidence.source) && (!stamp(reviewedAt) || stamp(submittedAt) > stamp(reviewedAt))) current.pendingCount++;
      current.pending = current.pendingCount > 0;
      students.set(studentId, current);
    }
  }
  return [...students.values()];
};
