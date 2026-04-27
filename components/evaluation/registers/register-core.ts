import type { Student } from '../../../types';
import { buildSessionAssessmentModel, normalizeLoose } from '../../sessions-view/shared';
import type {
  AggregatedCompetencySummary,
  AggregatedRegisterResult,
  AggregatedStudentRegister,
  EvaluationRecordRow,
  RegisterCapacityResult,
  RegisterCompetencyResult,
  RegisterLevelCode,
  RegisterSourceBundle,
  SessionDetailEntry,
  SessionRegisterSnapshot,
  SessionStudentSnapshot,
  UnitRegisterSnapshot
} from './register-types';

const SESSION_LEVEL_ORDER: Array<Exclude<RegisterLevelCode, 'ne'>> = ['c', 'b', 'a', 'ad'];
const UNIT_SCORE_MAP: Record<Exclude<RegisterLevelCode, 'ne'>, number> = { c: 1, b: 2, a: 3, ad: 4 };
const OVERALL_SCORE_MAP: Record<Exclude<RegisterLevelCode, 'ne'>, number> = { c: 0, b: 1, a: 2, ad: 3 };

const getStudentInactiveCode = (student: Student | undefined): RegisterLevelCode | null => {
  const normalizedEstado = normalizeLoose(String(student?.estado || ''));
  if (
    normalizedEstado === 'r' || normalizedEstado.includes('retir') ||
    normalizedEstado === 't' || normalizedEstado.includes('traslad') ||
    normalizedEstado === 'na' || normalizedEstado.includes('no asiste')
  ) {
    return 'ne';
  }
  return null;
};

export const inferBimesterLabelFromUnitNumber = (unitNumber: string | number) => {
  const parsed = Number(unitNumber || 0);
  if (parsed <= 2) return 'I';
  if (parsed <= 4) return 'II';
  if (parsed <= 6) return 'III';
  return 'IV';
};

export const normalizeRegisterLevelCode = (rawLevel: any): RegisterLevelCode | '' => {
  const normalized = normalizeLoose(String(rawLevel || ''));
  if (!normalized) return '';
  if (normalized === 'ad' || normalized === 'destacado') return 'ad';
  if (normalized === 'a' || normalized === 'logrado') return 'a';
  if (normalized === 'b' || normalized.includes('proceso')) return 'b';
  if (normalized === 'c' || normalized === 'inicio') return 'c';
  if (normalized === 'ne' || normalized.includes('evaluado') || normalized.includes('asiste')) return 'ne';
  return '';
};

const getSessionMedianLevel = (codes: Array<RegisterLevelCode | ''>): RegisterLevelCode | '' => {
  const validCodes = codes.filter((code): code is Exclude<RegisterLevelCode, 'ne'> => SESSION_LEVEL_ORDER.includes(code as Exclude<RegisterLevelCode, 'ne'>));
  if (!validCodes.length) return '';

  const numericScores = validCodes
    .map((code) => SESSION_LEVEL_ORDER.indexOf(code))
    .sort((left, right) => left - right);

  const middleIndex = Math.floor(numericScores.length / 2);
  const median = numericScores.length % 2 === 0
    ? (numericScores[middleIndex - 1] + numericScores[middleIndex]) / 2
    : numericScores[middleIndex];

  if (median >= 2.5) return 'ad';
  if (median > 1.5) return 'a';
  if (median >= 0.5) return 'b';
  return 'c';
};

const getAverageLevel = (
  codes: Array<RegisterLevelCode | ''>,
  scoreMap: Record<Exclude<RegisterLevelCode, 'ne'>, number>
): RegisterLevelCode => {
  const validCodes = codes.filter((code): code is Exclude<RegisterLevelCode, 'ne'> => SESSION_LEVEL_ORDER.includes(code as Exclude<RegisterLevelCode, 'ne'>));
  if (!validCodes.length) return 'ne';

  const average = validCodes.reduce((sum, code) => sum + scoreMap[code], 0) / validCodes.length;
  if (scoreMap === OVERALL_SCORE_MAP) {
    const rounded = Math.round(average);
    if (rounded >= 3) return 'ad';
    if (rounded === 2) return 'a';
    if (rounded === 1) return 'b';
    return 'c';
  }

  if (average >= 3.5) return 'ad';
  if (average >= 2.5) return 'a';
  if (average >= 1.5) return 'b';
  return 'c';
};

const getRecordMap = (records: EvaluationRecordRow[]) => {
  const map = new Map<string, EvaluationRecordRow>();
  records.forEach((record) => {
    map.set(`${String(record.student_id)}::${String(record.session_id)}::${String(record.criteria_id)}`, record);
  });
  return map;
};

const getSessionRows = (session: SessionDetailEntry) => {
  const model = session?.sessionData?.sessionAssessmentModel || buildSessionAssessmentModel(session?.sessionData || {}, {
    areaId: session.areaId,
    grade: session.grade,
    section: session.section,
    unitNumber: session.unitNumber,
    sessionNumber: session.sessionNumber,
    bimester: session.bimesterLabel
  });

  return Array.isArray(model?.rows) ? model.rows : [];
};

const getSessionRecordLevelCode = (
  recordMap: Map<string, EvaluationRecordRow>,
  studentId: string | number,
  session: SessionDetailEntry,
  row: any,
  rowIndex: number
): RegisterLevelCode | '' => {
  const keysToTry = [
    String(row?.id || '').trim(),
    String(rowIndex + 1),
    String((Array.isArray(session?.sessionData?.instrumento) ? session.sessionData.instrumento[rowIndex]?.id : '') || '').trim()
  ].filter(Boolean);

  for (const criteriaId of keysToTry) {
    const stored = recordMap.get(`${String(studentId)}::${session.id}::${criteriaId}`);
    const code = normalizeRegisterLevelCode(stored?.level);
    if (code) return code;
  }

  return '';
};

export const buildSessionRegisterSnapshots = ({ sessions, students, records }: RegisterSourceBundle): SessionRegisterSnapshot[] => {
  const recordMap = getRecordMap(records);

  return sessions.map((session) => {
    const rows = getSessionRows(session);

    const competencyBuckets = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; rowIds: string[] }>();
    const capacityBuckets = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; capacityName: string; rowIds: string[] }>();

    rows.forEach((row: any, rowIndex: number) => {
      const source = String(row?.source || 'primary') === 'transversal' ? 'transversal' : 'primary';
      const competencyName = String(row?.competencyName || '').trim();
      const capacityName = String(row?.capacityName || '').trim();
      const rowId = String(row?.id || '').trim();
      if (!competencyName || !rowId) return;

      const competencyKey = `${source}::${normalizeLoose(competencyName)}`;
      const capacityKey = `${competencyKey}::${normalizeLoose(capacityName)}`;

      if (!competencyBuckets.has(competencyKey)) {
        competencyBuckets.set(competencyKey, { source, competencyName, rowIds: [] });
      }
      competencyBuckets.get(competencyKey)?.rowIds.push(rowId);

      if (capacityName) {
        if (!capacityBuckets.has(capacityKey)) {
          capacityBuckets.set(capacityKey, { source, competencyName, capacityName, rowIds: [] });
        }
        capacityBuckets.get(capacityKey)?.rowIds.push(rowId);
      }
    });

    const studentSnapshots: SessionStudentSnapshot[] = students.map((student) => {
      const inactiveCode = getStudentInactiveCode(student);

      const competencies: RegisterCompetencyResult[] = Array.from(competencyBuckets.entries()).map(([key, bucket]) => {
        const code = inactiveCode || getSessionMedianLevel(
          bucket.rowIds.map((rowId) => {
            const rowIndex = rows.findIndex((currentRow: any) => String(currentRow?.id || '').trim() === rowId);
            return rowIndex >= 0
              ? getSessionRecordLevelCode(recordMap, student.id, session, rows[rowIndex], rowIndex)
              : '';
          })
        ) || 'ne';

        return {
          key,
          source: bucket.source,
          competencyName: bucket.competencyName,
          code
        };
      });

      const capacities: RegisterCapacityResult[] = Array.from(capacityBuckets.entries()).map(([key, bucket]) => {
        const code = inactiveCode || getSessionMedianLevel(
          bucket.rowIds.map((rowId) => {
            const rowIndex = rows.findIndex((currentRow: any) => String(currentRow?.id || '').trim() === rowId);
            return rowIndex >= 0
              ? getSessionRecordLevelCode(recordMap, student.id, session, rows[rowIndex], rowIndex)
              : '';
          })
        ) || 'ne';

        return {
          key,
          source: bucket.source,
          competencyName: bucket.competencyName,
          capacityName: bucket.capacityName,
          code
        };
      });

      return {
        studentId: String(student.id),
        competencies,
        capacities
      };
    });

    return {
      sessionId: session.id,
      unitNumber: session.unitNumber,
      sessionNumber: session.sessionNumber,
      bimesterLabel: session.bimesterLabel,
      title: String(session.title || session.sessionData?.title || `Sesion ${session.sessionNumber}`),
      students: studentSnapshots
    };
  });
};

const buildAggregatedCompetencySummaries = (students: AggregatedStudentRegister[]): AggregatedCompetencySummary[] => {
  const summaryMap = new Map<string, AggregatedCompetencySummary>();

  students.forEach((student) => {
    student.competencies.forEach((competency) => {
      if (!summaryMap.has(competency.key)) {
        summaryMap.set(competency.key, {
          key: competency.key,
          source: competency.source,
          competencyName: competency.competencyName,
          counts: { c: 0, b: 0, a: 0, ad: 0, ne: 0 }
        });
      }
      summaryMap.get(competency.key)!.counts[competency.code] += 1;
    });
  });

  return Array.from(summaryMap.values()).sort((left, right) => {
    if (left.source !== right.source) return left.source === 'primary' ? -1 : 1;
    return left.competencyName.localeCompare(right.competencyName, 'es');
  });
};

const buildUnitSnapshotsFromSessionSnapshots = (
  sessionSnapshots: SessionRegisterSnapshot[],
  students: Student[]
): UnitRegisterSnapshot[] => {
  const snapshotsByUnit = new Map<string, SessionRegisterSnapshot[]>();
  sessionSnapshots.forEach((snapshot) => {
    const unitKey = String(snapshot.unitNumber);
    if (!snapshotsByUnit.has(unitKey)) snapshotsByUnit.set(unitKey, []);
    snapshotsByUnit.get(unitKey)!.push(snapshot);
  });

  return Array.from(snapshotsByUnit.entries())
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([unitNumber, unitSessions]) => {
      const studentSnapshots: SessionStudentSnapshot[] = students.map((student) => {
        const sessionRows = unitSessions
          .map((snapshot) => snapshot.students.find((entry) => entry.studentId === String(student.id)))
          .filter(Boolean) as SessionStudentSnapshot[];

        const competencyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; codes: RegisterLevelCode[] }>();
        const capacityMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; capacityName: string; codes: RegisterLevelCode[] }>();

        sessionRows.forEach((row) => {
          row.competencies.forEach((competency) => {
            if (!competencyMap.has(competency.key)) {
              competencyMap.set(competency.key, {
                source: competency.source,
                competencyName: competency.competencyName,
                codes: []
              });
            }
            competencyMap.get(competency.key)!.codes.push(competency.code);
          });

          row.capacities.forEach((capacity) => {
            if (!capacityMap.has(capacity.key)) {
              capacityMap.set(capacity.key, {
                source: capacity.source,
                competencyName: capacity.competencyName,
                capacityName: capacity.capacityName,
                codes: []
              });
            }
            capacityMap.get(capacity.key)!.codes.push(capacity.code);
          });
        });

        return {
          studentId: String(student.id),
          competencies: Array.from(competencyMap.entries()).map(([key, item]) => ({
            key,
            source: item.source,
            competencyName: item.competencyName,
            code: getAverageLevel(item.codes, UNIT_SCORE_MAP)
          })),
          capacities: Array.from(capacityMap.entries()).map(([key, item]) => ({
            key,
            source: item.source,
            competencyName: item.competencyName,
            capacityName: item.capacityName,
            code: getAverageLevel(item.codes, UNIT_SCORE_MAP)
          }))
        };
      });

      return {
        unitNumber,
        bimesterLabel: unitSessions[0]?.bimesterLabel || inferBimesterLabelFromUnitNumber(unitNumber),
        students: studentSnapshots
      };
    });
};

export const buildUnitRegisterAggregation = ({ sessions, students, records }: RegisterSourceBundle): AggregatedRegisterResult => {
  const sessionSnapshots = buildSessionRegisterSnapshots({ sessions, students, records });
  const unitSnapshots = buildUnitSnapshotsFromSessionSnapshots(sessionSnapshots, students);

  const aggregatedStudents: AggregatedStudentRegister[] = students.map((student) => {
    const inactiveCode = getStudentInactiveCode(student);
    const sessionRows = sessionSnapshots.map((snapshot) => snapshot.students.find((entry) => entry.studentId === String(student.id))).filter(Boolean) as SessionStudentSnapshot[];

    const competencyKeyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; codes: RegisterLevelCode[] }>();
    const capacityKeyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; capacityName: string; codes: RegisterLevelCode[] }>();

    sessionRows.forEach((sessionRow) => {
      sessionRow.competencies.forEach((competency) => {
        if (!competencyKeyMap.has(competency.key)) {
          competencyKeyMap.set(competency.key, {
            source: competency.source,
            competencyName: competency.competencyName,
            codes: []
          });
        }
        competencyKeyMap.get(competency.key)!.codes.push(competency.code);
      });

      sessionRow.capacities.forEach((capacity) => {
        if (!capacityKeyMap.has(capacity.key)) {
          capacityKeyMap.set(capacity.key, {
            source: capacity.source,
            competencyName: capacity.competencyName,
            capacityName: capacity.capacityName,
            codes: []
          });
        }
        capacityKeyMap.get(capacity.key)!.codes.push(capacity.code);
      });
    });

    const competencies = Array.from(competencyKeyMap.entries()).map(([key, bucket]) => ({
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      code: inactiveCode || getAverageLevel(bucket.codes, UNIT_SCORE_MAP)
    }));

    const capacities = Array.from(capacityKeyMap.entries()).map(([key, bucket]) => ({
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      capacityName: bucket.capacityName,
      code: inactiveCode || getAverageLevel(bucket.codes, UNIT_SCORE_MAP)
    }));

    const primaryCompetencyCodes = competencies
      .filter((item) => item.source === 'primary')
      .map((item) => item.code);
    const overallCode = inactiveCode || getAverageLevel(primaryCompetencyCodes, OVERALL_SCORE_MAP);

    return {
      studentId: String(student.id),
      studentName: String(student.name || '').trim(),
      estado: student.estado,
      overallCode,
      competencies: competencies.sort((left, right) => left.competencyName.localeCompare(right.competencyName, 'es')),
      capacities: capacities.sort((left, right) => left.capacityName.localeCompare(right.capacityName, 'es'))
    };
  });

  return {
    students: aggregatedStudents,
    competencies: buildAggregatedCompetencySummaries(aggregatedStudents),
    sessions: sessionSnapshots,
    unitSnapshots,
    units: Array.from(new Set(sessions.map((session) => String(session.unitNumber)))).sort((left, right) => Number(left) - Number(right))
  };
};

export const buildBimesterRegisterAggregation = ({ sessions, students, records }: RegisterSourceBundle): AggregatedRegisterResult => {
  const sessionsByUnit = new Map<string, SessionDetailEntry[]>();
  sessions.forEach((session) => {
    const unitKey = String(session.unitNumber);
    if (!sessionsByUnit.has(unitKey)) sessionsByUnit.set(unitKey, []);
    sessionsByUnit.get(unitKey)!.push(session);
  });

  const unitAggregations = Array.from(sessionsByUnit.values()).map((unitSessions) =>
    buildUnitRegisterAggregation({ sessions: unitSessions, students, records })
  );

  const aggregatedStudents: AggregatedStudentRegister[] = students.map((student) => {
    const inactiveCode = getStudentInactiveCode(student);

    const competencyKeyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; codes: RegisterLevelCode[] }>();
    const capacityKeyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; capacityName: string; codes: RegisterLevelCode[] }>();

    unitAggregations.forEach((unitAggregation) => {
      const unitStudent = unitAggregation.students.find((entry) => entry.studentId === String(student.id));
      if (!unitStudent) return;

      unitStudent.competencies.forEach((competency) => {
        if (!competencyKeyMap.has(competency.key)) {
          competencyKeyMap.set(competency.key, {
            source: competency.source,
            competencyName: competency.competencyName,
            codes: []
          });
        }
        competencyKeyMap.get(competency.key)!.codes.push(competency.code);
      });

      unitStudent.capacities.forEach((capacity) => {
        if (!capacityKeyMap.has(capacity.key)) {
          capacityKeyMap.set(capacity.key, {
            source: capacity.source,
            competencyName: capacity.competencyName,
            capacityName: capacity.capacityName,
            codes: []
          });
        }
        capacityKeyMap.get(capacity.key)!.codes.push(capacity.code);
      });
    });

    const competencies = Array.from(competencyKeyMap.entries()).map(([key, bucket]) => ({
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      code: inactiveCode || getAverageLevel(bucket.codes, UNIT_SCORE_MAP)
    }));

    const capacities = Array.from(capacityKeyMap.entries()).map(([key, bucket]) => ({
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      capacityName: bucket.capacityName,
      code: inactiveCode || getAverageLevel(bucket.codes, UNIT_SCORE_MAP)
    }));

    const primaryCompetencyCodes = competencies
      .filter((item) => item.source === 'primary')
      .map((item) => item.code);
    const overallCode = inactiveCode || getAverageLevel(primaryCompetencyCodes, OVERALL_SCORE_MAP);

    return {
      studentId: String(student.id),
      studentName: String(student.name || '').trim(),
      estado: student.estado,
      overallCode,
      competencies: competencies.sort((left, right) => left.competencyName.localeCompare(right.competencyName, 'es')),
      capacities: capacities.sort((left, right) => left.capacityName.localeCompare(right.capacityName, 'es'))
    };
  });

  const sessionSnapshots = unitAggregations.flatMap((aggregation) => aggregation.sessions);
  const unitSnapshots = buildUnitSnapshotsFromSessionSnapshots(sessionSnapshots, students);

  return {
    students: aggregatedStudents,
    competencies: buildAggregatedCompetencySummaries(aggregatedStudents),
    sessions: sessionSnapshots,
    unitSnapshots,
    units: Array.from(sessionsByUnit.keys()).sort((left, right) => Number(left) - Number(right))
  };
};
