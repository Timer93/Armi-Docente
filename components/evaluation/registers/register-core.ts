import type { Student } from '../../../types';
import { buildSessionAssessmentModel, extractCapacidades, normalizeLoose, TRANSVERSAL_CAPACITY_MAP } from '../../sessions-view/shared';
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
const OVERALL_SCORE_MAP: Record<Exclude<RegisterLevelCode, 'ne'>, number> = { c: 0, b: 1, a: 2, ad: 3 };

const isPredominanceMode = () => (globalThis as any)?.window?.__armiActiveGradingMode === 'criterial_predominance';
const isHybridMode = () => (globalThis as any)?.window?.__armiActiveGradingMode === 'hybrid_vigesimal';

type ScoredResult = {
  code: RegisterLevelCode;
  numericScore: number | null;
  pending: boolean;
};
const normalizeNumericScore = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 20 ? score : null;
};
export const numericScoreToRegisterLevel = (score: number): Exclude<RegisterLevelCode, 'ne'> => {
  if (score >= 18) return 'ad';
  if (score >= 14) return 'a';
  if (score >= 11) return 'b';
  return 'c';
};

const aggregateResults = (
  values: Array<{ code?: RegisterLevelCode | ''; numericScore?: number | null; pending?: boolean }>,
  inactiveCode: RegisterLevelCode | null = null,
  literalStrategy: 'session' | 'average' = 'average'
): ScoredResult => {
  if (inactiveCode) return { code: inactiveCode, numericScore: null, pending: false };

  if (isHybridMode()) {
    const scores = values.map((value) => normalizeNumericScore(value.numericScore));
    if (!values.length || values.some((value, index) => value.pending || scores[index] === null)) {
      return { code: 'ne', numericScore: null, pending: true };
    }
    const numericScore = scores.reduce<number>((sum, score) => sum + (score as number), 0) / scores.length;
    return { code: numericScoreToRegisterLevel(numericScore), numericScore, pending: false };
  }

  const codes = values.map((value) => value.code || '');
  const code = literalStrategy === 'session'
    ? (getSessionMedianLevel(codes) || 'ne')
    : getAverageLevelFromZeroBasedScale(codes);
  return { code, numericScore: null, pending: false };
};

const getPredominantLevel = (codes: Array<RegisterLevelCode | ''>): RegisterLevelCode | '' => {
  const validCodes = codes.filter((code): code is Exclude<RegisterLevelCode, 'ne'> => SESSION_LEVEL_ORDER.includes(code as Exclude<RegisterLevelCode, 'ne'>));
  if (!validCodes.length) return '';
  const counts = validCodes.reduce<Record<string, number>>((result, code) => {
    result[code] = (result[code] || 0) + 1;
    return result;
  }, {});
  // Ante empate se conserva el nivel menor; evita una promociÃ³n automÃ¡tica
  // cuando la evidencia no muestra una predominancia real.
  return SESSION_LEVEL_ORDER.reduce<{ code: Exclude<RegisterLevelCode, 'ne'>; count: number }>((best, code) => (
    (counts[code] || 0) > best.count ? { code, count: counts[code] || 0 } : best
  ), { code: 'c', count: -1 }).code;
};

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
  if (isPredominanceMode()) return getPredominantLevel(codes);
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

const getAverageLevelFromZeroBasedScale = (codes: Array<RegisterLevelCode | ''>): RegisterLevelCode => {
  if (isPredominanceMode()) return getPredominantLevel(codes) || 'ne';
  const validCodes = codes.filter((code): code is Exclude<RegisterLevelCode, 'ne'> => SESSION_LEVEL_ORDER.includes(code as Exclude<RegisterLevelCode, 'ne'>));
  if (!validCodes.length) return 'ne';

  const average = validCodes.reduce((sum, code) => sum + OVERALL_SCORE_MAP[code], 0) / validCodes.length;
  if (average >= 2.5) return 'ad';
  if (average >= 1.5) return 'a';
  if (average >= 0.5) return 'b';
  return 'c';
};

const buildCompetenciesFromCapacities = (
  capacities: RegisterCapacityResult[],
  inactiveCode: RegisterLevelCode | null
): RegisterCompetencyResult[] => {
  const competencyBuckets = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; values: RegisterCapacityResult[] }>();

  capacities.forEach((capacity) => {
    if (!competencyBuckets.has(capacity.key.split('::').slice(0, 2).join('::'))) {
      competencyBuckets.set(capacity.key.split('::').slice(0, 2).join('::'), {
        source: capacity.source,
        competencyName: capacity.competencyName,
        values: []
      });
    }
    competencyBuckets.get(capacity.key.split('::').slice(0, 2).join('::'))!.values.push(capacity);
  });

  return Array.from(competencyBuckets.entries()).map(([key, bucket]) => {
    const result = aggregateResults(bucket.values, inactiveCode, 'average');
    return {
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      ...result
    };
  });
};

const getRecordMap = (records: EvaluationRecordRow[]) => {
  const map = new Map<string, EvaluationRecordRow>();
  records.forEach((record) => {
    map.set(`${String(record.student_id)}::${String(record.session_id)}::${String(record.criteria_id)}`, record);
  });
  return map;
};

const sanitizeSessionAssessmentRows = (rows: any[], sessionData: any) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const primaryExpectedCapacities = extractCapacidades(String(sessionData?.competenciaPrio?.cap || ''));
  const transversalDefinitions = new Map<string, string[]>(
    (Array.isArray(sessionData?.competenciasTrans) ? sessionData.competenciasTrans : []).map((item: any) => {
      const competencyName = String(item?.comp || '').trim();
      const rowCapacityText = String(item?.cap || '').trim();
      const officialCapacities = TRANSVERSAL_CAPACITY_MAP[competencyName] || [];
      const explicitCapacities = extractCapacidades(rowCapacityText);
      const matchedOfficialCapacities = officialCapacities.filter((capacity) =>
        normalizeLoose(rowCapacityText).includes(normalizeLoose(capacity))
      );
      const resolvedCapacities = matchedOfficialCapacities.length > explicitCapacities.length
        ? matchedOfficialCapacities
        : explicitCapacities;
      return [competencyName, resolvedCapacities];
    })
  );
  const groupedRows = new Map<string, number[]>();

  sourceRows.forEach((row: any, index: number) => {
    const source = String(row?.source || 'primary') === 'transversal' ? 'transversal' : 'primary';
    const competencyName = String(row?.competencyName || '').trim();
    const capacityName = String(row?.capacityName || '').trim();
    const expectedCapacities = source === 'transversal'
      ? (transversalDefinitions.get(competencyName) || TRANSVERSAL_CAPACITY_MAP[competencyName] || [])
      : primaryExpectedCapacities;
    const groupKey = `${source}::${normalizeLoose(competencyName)}::${normalizeLoose(capacityName)}`;
    if (!capacityName || expectedCapacities.length <= 1) return;
    if (!groupedRows.has(groupKey)) groupedRows.set(groupKey, []);
    groupedRows.get(groupKey)!.push(index);
  });

  return sourceRows.map((row: any) => {
    const source = String(row?.source || 'primary') === 'transversal' ? 'transversal' : 'primary';
    const competencyName = String(row?.competencyName || '').trim();
    const capacityName = String(row?.capacityName || '').trim();
    const expectedCapacities = source === 'transversal'
      ? (transversalDefinitions.get(competencyName) || TRANSVERSAL_CAPACITY_MAP[competencyName] || [])
      : primaryExpectedCapacities;
    if (!capacityName || expectedCapacities.length === 0) return row;

    const extracted = extractCapacidades(capacityName);
    const expectedMatches = expectedCapacities.filter((item) =>
      extracted.some((candidate) => normalizeLoose(candidate) === normalizeLoose(item))
      || normalizeLoose(capacityName).includes(normalizeLoose(item))
    );

    const groupKey = `${source}::${normalizeLoose(competencyName)}::${normalizeLoose(capacityName)}`;
    const groupedIndexes = groupedRows.get(groupKey) || [];
    const currentIndex = groupedIndexes.indexOf(sourceRows.indexOf(row));
    const looksCombined = /[.;â€¢Â·]\s+/.test(capacityName) || extractCapacidades(capacityName).length > 1;
    const sequentialExpected = groupedIndexes.length > 1 && groupedIndexes.length <= expectedCapacities.length
      && looksCombined
      ? expectedCapacities
      : [];
    const resolvedList = expectedMatches.length > 1 ? expectedMatches : sequentialExpected;

    if (resolvedList.length <= 1 || currentIndex < 0) return row;

    return {
      ...row,
      capacityName: resolvedList[Math.min(currentIndex, resolvedList.length - 1)] || row.capacityName
    };
  });
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

  return sanitizeSessionAssessmentRows(Array.isArray(model?.rows) ? model.rows : [], session?.sessionData || {});
};

const getSessionRecord = (
  recordMap: Map<string, EvaluationRecordRow>,
  studentId: string | number,
  session: SessionDetailEntry,
  row: any,
  rowIndex: number
): EvaluationRecordRow | undefined => {
  const keysToTry = [
    String(row?.id || '').trim(),
    String(rowIndex + 1),
    String((Array.isArray(session?.sessionData?.instrumento) ? session.sessionData.instrumento[rowIndex]?.id : '') || '').trim()
  ].filter(Boolean);

  for (const criteriaId of keysToTry) {
    const stored = recordMap.get(`${String(studentId)}::${session.id}::${criteriaId}`);
    if (stored) return stored;
  }

  return undefined;
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

      const getBucketResult = (rowIds: string[]) => aggregateResults(
        rowIds.map((rowId) => {
          const rowIndex = rows.findIndex((currentRow: any) => String(currentRow?.id || '').trim() === rowId);
          const record = rowIndex >= 0
            ? getSessionRecord(recordMap, student.id, session, rows[rowIndex], rowIndex)
            : undefined;
          return {
            code: normalizeRegisterLevelCode(record?.level),
            numericScore: normalizeNumericScore(record?.numeric_score),
            pending: !record
          };
        }),
        inactiveCode,
        'session'
      );

      const capacities: RegisterCapacityResult[] = Array.from(capacityBuckets.entries()).map(([key, bucket]) => {
        const result = getBucketResult(bucket.rowIds);

        return {
          key,
          source: bucket.source,
          competencyName: bucket.competencyName,
          capacityName: bucket.capacityName,
          ...result
        };
      });
      const competencies = buildCompetenciesFromCapacities(capacities, inactiveCode);

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

        const capacityMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; capacityName: string; values: RegisterCapacityResult[] }>();

        sessionRows.forEach((row) => {
          row.capacities.forEach((capacity) => {
            if (!capacityMap.has(capacity.key)) {
              capacityMap.set(capacity.key, {
                source: capacity.source,
                competencyName: capacity.competencyName,
                capacityName: capacity.capacityName,
                values: []
              });
            }
            capacityMap.get(capacity.key)!.values.push(capacity);
          });
        });

        const inactiveCode = getStudentInactiveCode(student);
        const capacities: RegisterCapacityResult[] = Array.from(capacityMap.entries()).map(([key, item]) => ({
          key,
          source: item.source,
          competencyName: item.competencyName,
          capacityName: item.capacityName,
          ...aggregateResults(item.values, inactiveCode, 'average')
        }));

        return {
          studentId: String(student.id),
          capacities,
          competencies: buildCompetenciesFromCapacities(capacities, inactiveCode)
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

    const capacityKeyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; capacityName: string; values: RegisterCapacityResult[] }>();

    sessionRows.forEach((sessionRow) => {
      sessionRow.capacities.forEach((capacity) => {
        if (!capacityKeyMap.has(capacity.key)) {
          capacityKeyMap.set(capacity.key, {
            source: capacity.source,
            competencyName: capacity.competencyName,
            capacityName: capacity.capacityName,
            values: []
          });
        }
        capacityKeyMap.get(capacity.key)!.values.push(capacity);
      });
    });

    const capacities = Array.from(capacityKeyMap.entries()).map(([key, bucket]) => ({
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      capacityName: bucket.capacityName,
      ...aggregateResults(bucket.values, inactiveCode, 'average')
    }));

    const competencies = buildCompetenciesFromCapacities(capacities, inactiveCode);

    const overallResult = aggregateResults(
      competencies.filter((item) => item.source === 'primary'),
      inactiveCode,
      'average'
    );

    return {
      studentId: String(student.id),
      studentName: String(student.name || '').trim(),
      estado: student.estado,
      overallCode: overallResult.code,
      overallNumericScore: overallResult.numericScore,
      pending: overallResult.pending,
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
  const sessionSnapshots = buildSessionRegisterSnapshots({ sessions, students, records });
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

    // El bimestre consolida primero cada unidad y reciÃ©n despuÃ©s combina las
    // unidades con el mismo peso. AsÃ­ una unidad con mÃ¡s sesiones no domina a
    // otra por tener mÃ¡s registros.
    const capacityKeyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; capacityName: string; values: RegisterCapacityResult[] }>();
    const competencyKeyMap = new Map<string, { source: 'primary' | 'transversal'; competencyName: string; values: RegisterCompetencyResult[] }>();

    unitAggregations.forEach((unitAggregation) => {
      const unitStudent = unitAggregation.students.find((entry) => entry.studentId === String(student.id));
      if (!unitStudent) return;

      unitStudent.capacities.forEach((capacity) => {
        if (!capacityKeyMap.has(capacity.key)) {
          capacityKeyMap.set(capacity.key, {
            source: capacity.source,
            competencyName: capacity.competencyName,
            capacityName: capacity.capacityName,
            values: []
          });
        }
        capacityKeyMap.get(capacity.key)!.values.push(capacity);
      });

      unitStudent.competencies.forEach((competency) => {
        if (!competencyKeyMap.has(competency.key)) {
          competencyKeyMap.set(competency.key, {
            source: competency.source,
            competencyName: competency.competencyName,
            values: []
          });
        }
        competencyKeyMap.get(competency.key)!.values.push(competency);
      });
    });

    const capacities = Array.from(capacityKeyMap.entries()).map(([key, bucket]) => ({
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      capacityName: bucket.capacityName,
      ...aggregateResults(bucket.values, inactiveCode, 'average')
    }));

    const competencies = Array.from(competencyKeyMap.entries()).map(([key, bucket]) => ({
      key,
      source: bucket.source,
      competencyName: bucket.competencyName,
      ...aggregateResults(bucket.values, inactiveCode, 'average')
    }));

    const overallResult = aggregateResults(
      competencies.filter((item) => item.source === 'primary'),
      inactiveCode,
      'average'
    );

    return {
      studentId: String(student.id),
      studentName: String(student.name || '').trim(),
      estado: student.estado,
      overallCode: overallResult.code,
      overallNumericScore: overallResult.numericScore,
      pending: overallResult.pending,
      competencies: competencies.sort((left, right) => left.competencyName.localeCompare(right.competencyName, 'es')),
      capacities: capacities.sort((left, right) => left.capacityName.localeCompare(right.capacityName, 'es'))
    };
  });

  const unitSnapshots = buildUnitSnapshotsFromSessionSnapshots(sessionSnapshots, students);

  return {
    students: aggregatedStudents,
    competencies: buildAggregatedCompetencySummaries(aggregatedStudents),
    sessions: sessionSnapshots,
    unitSnapshots,
    units: Array.from(sessionsByUnit.keys()).sort((left, right) => Number(left) - Number(right))
  };
};
