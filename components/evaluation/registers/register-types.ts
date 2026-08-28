import type { Student } from '../../../types';

export type RegisterLevelCode = 'c' | 'b' | 'a' | 'ad' | 'ne';

export interface EvaluationRecordRow {
  student_id: string;
  session_id: string;
  unit_id?: string;
  instrument_id?: string | number | null;
  criteria_id: string;
  level?: string;
  grading_mode?: 'literal_traditional' | 'criterial_predominance' | 'hybrid_vigesimal';
  numeric_score?: number | null;
  observation?: string;
}

export interface SessionSummaryEntry {
  id: string;
  year: string;
  areaId: string;
  grade: string;
  section: string;
  unitNumber: string;
  sessionNumber: string;
  title?: string;
}

export interface SessionDetailEntry extends SessionSummaryEntry {
  bimesterLabel: string;
  sessionData: any;
}

export interface RegisterCompetencyResult {
  key: string;
  source: 'primary' | 'transversal';
  competencyName: string;
  code: RegisterLevelCode;
  numericScore?: number | null;
  pending?: boolean;
}

export interface RegisterCapacityResult {
  key: string;
  source: 'primary' | 'transversal';
  competencyName: string;
  capacityName: string;
  code: RegisterLevelCode;
  numericScore?: number | null;
  pending?: boolean;
}

export interface SessionStudentSnapshot {
  studentId: string;
  competencies: RegisterCompetencyResult[];
  capacities: RegisterCapacityResult[];
}

export interface SessionRegisterSnapshot {
  sessionId: string;
  unitNumber: string;
  sessionNumber: string;
  bimesterLabel: string;
  title: string;
  students: SessionStudentSnapshot[];
}

export interface UnitRegisterSnapshot {
  unitNumber: string;
  bimesterLabel: string;
  students: SessionStudentSnapshot[];
}

export interface AggregatedStudentRegister {
  studentId: string;
  studentName: string;
  estado?: string;
  overallCode: RegisterLevelCode;
  overallNumericScore?: number | null;
  pending?: boolean;
  competencies: RegisterCompetencyResult[];
  capacities: RegisterCapacityResult[];
}

export interface AggregatedCompetencySummary {
  key: string;
  source: 'primary' | 'transversal';
  competencyName: string;
  counts: Record<RegisterLevelCode, number>;
}

export interface AggregatedRegisterResult {
  students: AggregatedStudentRegister[];
  competencies: AggregatedCompetencySummary[];
  sessions: SessionRegisterSnapshot[];
  unitSnapshots: UnitRegisterSnapshot[];
  units: string[];
}

export interface RegisterSourceBundle {
  students: Student[];
  records: EvaluationRecordRow[];
  sessions: SessionDetailEntry[];
}
