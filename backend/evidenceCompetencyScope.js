import { createSessionEvidenceScopeResolver } from './sessionEvidenceReview.js';
import { readRequestedEvidence } from './shared/portalRequestedEvidences.js';

export const filterEvidenceByCompetency = (evidences, criteriaId, sessionData = {}) => {
  if (!criteriaId) return evidences;
  const scopeFor = createSessionEvidenceScopeResolver(sessionData);
  const target = scopeFor(criteriaId);
  return evidences.filter(evidence => {
    const requested = readRequestedEvidence(evidence.requested_evidence);
    const assigned = requested && ['primary', 'transversal'].includes(requested.source) && requested.competency
      ? `summary::${requested.source}::${requested.competency}`
      : evidence.criteria_id;
    return scopeFor(assigned) === target;
  });
};
