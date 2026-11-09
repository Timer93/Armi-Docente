import type { AggregatedRegisterResult, SessionSummaryEntry } from '../components/evaluation/registers/register-types';
import type { TeachingAssignment } from '../types';

export const OPEN_SESSION_REGISTER_EVENT = 'armi:open-session-register';

export type SessionRegisterTarget = SessionSummaryEntry & {
  sessionId: string;
  areaName: string;
  studentId: string;
  studentName: string;
  studentSection: string;
  competencyName: string;
  capacityName?: string;
  pending?: boolean;
};

export type SessionRegisterSource = SessionRegisterTarget & { code: string; numericScore?: number | null };

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function getGradeSessionSources(
  aggregation: AggregatedRegisterResult | null,
  headers: SessionSummaryEntry[],
  context: { studentId: string; studentName: string; studentSection: string; areaName: string; key: string; competencyName: string; capacityName?: string; pendingOnly?: boolean },
): SessionRegisterSource[] {
  const headersById = new Map(headers.map(header => [String(header.id), header]));
  return (aggregation?.sessions || []).flatMap(session => {
    const student = session.students.find(row => String(row.studentId) === String(context.studentId));
    const results = context.capacityName ? student?.capacities : student?.competencies;
    const result = results?.find(row => row.key === context.key) || results?.find(row =>
      normalized(row.competencyName) === normalized(context.competencyName) &&
      (!context.capacityName || ('capacityName' in row && normalized(String(row.capacityName)) === normalized(context.capacityName)))
    );
    const header = headersById.get(String(session.sessionId));
    if (!header || !result) return [];
    if (context.pendingOnly ? !result.pending : (!result.code || result.code === 'ne')) return [];
    return [{
      id: String(header.id), sessionId: String(session.sessionId),
      year: String(header.year), areaId: String(header.areaId), areaName: context.areaName,
      grade: String(header.grade), section: String(header.section),
      unitNumber: String(header.unitNumber), sessionNumber: String(header.sessionNumber),
      title: header.title || session.title,
      studentId: String(context.studentId), studentName: context.studentName, studentSection: context.studentSection,
      competencyName: context.competencyName, capacityName: context.capacityName,
      code: result.code, numericScore: result.numericScore, pending: !!result.pending,
    }];
  }).sort((a, b) => Number(a.unitNumber) - Number(b.unitNumber) || Number(a.sessionNumber) - Number(b.sessionNumber));
}

export function isSessionRegisterTarget(value: unknown): value is SessionRegisterTarget {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['sessionId', 'year', 'areaId', 'areaName', 'grade', 'section', 'unitNumber', 'sessionNumber', 'studentId'].every(key => typeof row[key] === 'string' && !!row[key]);
}

export function openSessionRegister(target: SessionRegisterTarget) {
  window.dispatchEvent(new CustomEvent(OPEN_SESSION_REGISTER_EVENT, { detail: target }));
}

// Expose a historical session's scope in the selectors without saving a new
// teaching assignment or replacing the user's configured assignments.
export function withSessionRegisterScope(assignments: TeachingAssignment[], target?: SessionRegisterTarget | null): TeachingAssignment[] {
  if (!target || assignments.some(row => String(row.areaId) === target.areaId && row.grade === target.grade && row.section === target.section)) return assignments;
  return [...assignments, { id: `register-source-${target.sessionId}`, areaId: target.areaId, areaName: target.areaName, grade: target.grade, section: target.section, studentCharacterization: '' }];
}
