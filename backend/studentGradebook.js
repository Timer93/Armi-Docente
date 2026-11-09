import { createRegisterAggregation } from './shared/registerAggregation.generated.js';
import { teacherGradeRecords } from './shared/teacherGradeSource.js';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const modesAllowed = new Set(['literal_traditional', 'criterial_predominance', 'hybrid_vigesimal']);
export const resolveStudentGradingMode = ({ modes, areaId, grade, section, defaultMode, sectionsOverlap }) => {
  // The teacher's register/runtime uses this active mode for every scope.
  // Scoped rows are historical settings, not overrides of that current choice.
  // Choosing an old scoped mode here can hide every current grade in a class.
  if (modesAllowed.has(defaultMode)) return defaultMode;
  const configured = modes.filter(row => String(row.area_id) === String(areaId)
    && (!row.grade || normalize(row.grade) === normalize(grade))
    && (!row.section || sectionsOverlap(row.section, section)))
    .sort((a, b) => Number(!!b.grade) - Number(!!a.grade) || Number(b.section === section) - Number(a.section === section) || Number(!!b.section) - Number(!!a.section))[0]?.grading_mode;
  return modesAllowed.has(configured) ? configured : 'literal_traditional';
};
const hasGrade = result => !!result && ['c', 'b', 'a', 'ad'].includes(String(result.code || '').toLowerCase());
const resultFor = student => ({
  code: student?.overallCode || 'ne', numericScore: student?.overallNumericScore ?? null,
  pending: !!student?.pending,
  competencies: (student?.competencies || []).map(item => ({ source: item.source, name: item.competencyName, code: item.code, numericScore: item.numericScore ?? null, pending: !!item.pending })),
});

export const buildStudentGradebook = ({ student, sessions, records, modeForArea, feedbackForSession }) => {
  const areas = [...new Set(sessions.map(row => row.areaId))].map(areaId => {
    const areaSessions = sessions.filter(row => row.areaId === areaId);
    const mode = modeForArea(areaId);
    const calculator = createRegisterAggregation(mode);
    const ids = new Set(areaSessions.map(row => row.id));
    const ownRecords = teacherGradeRecords(records).filter(row => String(row.student_id) === String(student.id) && ids.has(String(row.session_id)) && (row.grading_mode || 'literal_traditional') === mode);
    const bundle = rows => ({ students: [student], sessions: rows, records: ownRecords });
    const bimesters = ['I', 'II', 'III', 'IV'].map((label, index) => {
      const numbers = [index * 2 + 1, index * 2 + 2];
      const scoped = areaSessions.filter(row => numbers.includes(Number(row.unitNumber)));
      const units = numbers.map(number => {
        const unitSessions = scoped.filter(row => Number(row.unitNumber) === number);
        const aggregation = calculator.buildUnitRegisterAggregation(bundle(unitSessions));
        const unitResult = resultFor(aggregation.students[0]);
        const items = unitSessions.map(row => {
          const feedback = feedbackForSession(row, ownRecords.filter(record => String(record.session_id) === row.id));
          const levelForScore = score => calculator.numericScoreToRegisterLevel(row.sessionData?.numericAverageRounding === 'nearest_integer' ? Math.round(score) : score);
          const literal = mode === 'hybrid_vigesimal' && typeof feedback.numericScore === 'number' && Number.isFinite(feedback.numericScore)
            ? levelForScore(feedback.numericScore) : normalize(feedback.literalGrade);
          const expected = (row.sessionData?.sessionAssessmentModel?.rows || []).filter(item => item.source !== 'transversal').length;
          const evaluated = (feedback.criteria || []).filter(item => ['c', 'b', 'a', 'ad'].includes(calculator.normalizeRegisterLevelCode(item.level)) || (typeof item.numericScore === 'number' && Number.isFinite(item.numericScore))).length;
          return {
            id: row.id, number: row.sessionNumber, title: row.title, date: row.date || '',
            code: ['c', 'b', 'a', 'ad'].includes(literal) ? literal : 'ne', numericScore: feedback.numericScore ?? null,
            pending: expected > evaluated,
            observation: feedback.observation || '', conclusions: feedback.conclusions || [],
            competencies: [{ source: 'primary', name: feedback.competencyName, code: literal || 'ne', numericScore: feedback.numericScore ?? null }, ...(feedback.transversalCompetencies || []).map(item => ({ source: 'transversal', name: item.name, code: mode === 'hybrid_vigesimal' && typeof item.numericScore === 'number' && Number.isFinite(item.numericScore) ? levelForScore(item.numericScore) : normalize(item.literalGrade) || 'ne', numericScore: item.numericScore ?? null, observation: item.observation || '' }))],
          };
        });
        const gradedSessions = items.filter(hasGrade).length;
        return { number, title: unitSessions[0]?.unitTitle || '', ...unitResult, gradedSessions, sessionCount: items.length, inProgress: !items.length || gradedSessions < items.length || items.some(item => item.pending) || unitResult.pending, sessions: items };
      });
      const aggregation = calculator.buildBimesterRegisterAggregation(bundle(scoped));
      const result = resultFor(aggregation.students[0]);
      return { label, ...result, unitNumbers: numbers, inProgress: units.some(unit => unit.inProgress) || result.pending, units };
    });
    return { id: areaId, name: areaSessions[0]?.areaName || areaId, gradingMode: mode, bimesters };
  });
  return { areas };
};
