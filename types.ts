
export interface GeneralData {
  id?: number;
  year: string;
  
  // Datos de la InstituciÃ³n
  department: string;
  region: string;
  province: string;
  ugel: string;
  district: string;
  institution: string;
  /* Added lugar property to GeneralData */
  lugar?: string;
  school_shift: 'JEC' | 'JER' | '';
  level: 'Primaria' | 'Secundaria' | '';
  motto?: string;
  year_name?: string;
  management_weeks_u1?: string;
  
  // Imagenes (Base64)
  insignia?: string;
  logo?: string;

  // Responsables
  director: string;
  subdirector?: string;
  pedagogical_coordinator?: string;
  toe_coordinator?: string;
  teacher: string;

  // Contexto
  context_description?: string;

  // AI Configuration
  /* Added gemini_api_key to GeneralData to fix property missing error */
  gemini_api_key?: string;
  openai_api_key?: string;
  ai_provider?: 'gemini' | 'openai';
  ai_pedagogical_route?: string;
  ai_institutional_problems?: string;
  ai_unit_pedagogical_focus?: string;

  // Word Configuration
  /* Added path_word_default to fix missing property error */
  path_word_default?: string;

  // CalendarizaciÃ³n - Bimestres
  b1_start?: string; b1_end?: string;
  b2_start?: string; b2_end?: string;
  b3_start?: string; b3_end?: string;
  b4_start?: string; b4_end?: string;
  vac_start?: string; vac_end?: string;

  // CalendarizaciÃ³n - Unidades
  u1_start?: string; u2_start?: string;
  u3_start?: string; u4_start?: string;
  u5_start?: string; u6_start?: string;
  u7_start?: string; u8_start?: string;
  u_vac_start?: string; u_vac_end?: string;
  u1_end?: string; u2_end?: string;
  u3_end?: string; u4_end?: string;
  u5_end?: string; u6_end?: string;
  u7_end?: string; u8_end?: string;

  // Calendarización - Fechas institucionales
  ie_anniversary_date?: string;
  achievement_day_1_date?: string;
  community_anniversary_date?: string;
  achievement_day_2_date?: string;
  province_anniversary_date?: string;
  other_important_date?: string;
}

export interface MetaData {
    anio: string;
    area: string;
    grado: string;
    seccion: string;
    competencia: string;
    tipo: 'LINEA_BASE' | 'META' | 'DIAGNOSTICO';
    cant_destacado: number;
    cant_esperado: number;
    cant_proceso: number;
    cant_inicio: number;
    cant_no_evaluado: number;
}

export interface CurricularArea {
  id: string;
  name: string;
}

export interface TeachingAssignment {
  id: string;
  areaId: string;
  areaName: string;
  grade: string;
  section: string;
  studentCharacterization: string;
}

// Added EvaluationLevel enum for evaluation components
export enum EvaluationLevel {
  AD = 'AD',
  A = 'A',
  B = 'B',
  C = 'C',
  NE = 'NE'
}

// Added HeaderInfo interface for evaluation headers
export interface HeaderInfo {
  grel: string;
  ugel: string;
  iiee: string;
  distrito: string;
  nivel: string;
  grado: string;
  seccion: string;
  area: string;
  docente: string;
  anio: string;
}

export interface Student {
  id: string | number;
  nivel: string; // Nuevo
  name: string; // Mapeado a 'estudiantes'
  grade: string; // Mapeado a 'grado'
  section: string; // Mapeado a 'secc'
  fechaNacimiento?: string;
  dni?: string;
  email?: string; // Mapeado a 'gmail'
  microsoft?: string; // Mapeado a 'outlook'
  group?: string; // Mapeado a 'grupo'
  estado?: string;
  sexo?: string; // Nuevo
  edad?: string | number; // Nuevo
  evaluations?: Record<string, { level: EvaluationLevel, description: string }>;
  competencyValue?: EvaluationLevel;
  description?: string;
}

export interface AttendanceRecord {
  id?: string | number;
  attendanceDate: string;
  grade: string;
  section: string;
  studentId: string | number;
  studentName: string;
  dni?: string;
  status: 'P' | 'T' | 'F' | 'J';
  markedAt?: string;
  source?: string;
  notes?: string;
}

export interface FaceProfile {
  id: string | number;
  studentId: string | number;
  studentName: string;
  grade: string;
  section: string;
  imageData?: string;
  descriptor?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Added SummaryStat interface for evaluation charts
export interface SummaryStat {
  level: EvaluationLevel;
  count: number;
  percentage: number;
  color: string;
}

export interface ScheduleBreak {
  id: string;
  afterHour: number;   // DespuÃ©s de quÃ© hora pedagÃ³gica ocurre (ej: 3)
  duration: number;    // Minutos
  label: string;       // "RECREO", "ALMUERZO"
  shortCode: string;   // "R1", "R2", "ALM"
}

export interface ScheduleConfig {
  startTime: string; // "08:00"
  classDuration: number; // 45
  totalHours: number; // 7
  breaks: ScheduleBreak[]; // Lista dinÃ¡mica de recreos
  customActivities: string[]; // Lista de tipos de actividades ("AtenciÃ³n Padres", etc)
}

export interface ScheduleEntry {
  id: string;
  day: 'LUNES' | 'MARTES' | 'MIÃ‰RCOLES' | 'JUEVES' | 'VIERNES';
  hourIndex: number; // 1-based index of the pedagogical hour
  areaId: string; // Puede ser ID de Ã¡rea o string genÃ©rico para actividades
  areaName: string;
  grade: string;
  section: string;
  color?: string; // For visual grouping
  isCustom?: boolean; // True si es una actividad extracurricular
}

// Annual Programming Types
export interface AnnualProgramData {
  id: string; // Composite key: year-areaId-grade-section
  areaId: string;
  grade: string;
  section: string;
  
  // Didactic Units (Editable text)
  // Key = unit index "0" to "7"
  didacticUnits: Record<string, { situation: string, title: string }>;

  // Matrix Checks: Key = "type-id-unitIndex" (e.g., "comp-1-0" for Competency 1, Unit 1)
  matrixChecks: Record<string, boolean>;
  
  // Resources Checks
  resourcesChecks: Record<string, boolean>;
}

export interface ModuleStatus {
  datos_generales: boolean;
  calendario: boolean; 
  areas_grados: boolean; 
  estudiantes: boolean;
  horario: boolean;
  programacion_anual: boolean; // New Module
  unidades_didacticas: boolean;
  sesiones: boolean;
  evaluacion: boolean;
}

export type ModuleKey = keyof ModuleStatus;

export interface AuthSupportContacts {
  whatsapp?: string;
  telegram?: string;
  email?: string;
  website?: string;
}

export interface AuthSyncProfile {
  userKey: string;
  userLabel: string;
  driveFolderName?: string;
  driveFolderUrl?: string;
}

export interface AuthSubscriptionProfile {
  active: boolean;
  status: string;
  plan?: string;
  expiresAt?: string | null;
  reason?: string;
}

export interface AuthModulePermissions {
  modules: Partial<Record<ModuleKey, boolean>>;
  role?: string;
  features?: string[];
}

export interface AuthUserProfile {
  id: string;
  username: string;
  displayName: string;
  dni?: string;
  email?: string;
  avatarUrl?: string;
  institutionName?: string;
  support: AuthSupportContacts;
  subscription: AuthSubscriptionProfile;
  permissions: AuthModulePermissions;
  sync: AuthSyncProfile;
  extra?: Record<string, any>;
}

export interface AuthSession {
  authenticatedAt: string;
  remember: boolean;
  provider: string;
  user: AuthUserProfile;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export type SessionAssessmentSource = 'primary' | 'transversal';

export interface SessionAssessmentInstrumentRef {
  type: string;
  name: string;
  templateId?: string | number;
}

export interface SessionAssessmentScope {
  areaId?: string;
  grade?: string;
  section?: string;
  unitNumber?: string;
  sessionNumber?: string;
  bimester?: string;
}

export interface SessionAssessmentCompetencyRef {
  id?: string;
  name: string;
}

export type SessionAssessmentLevelCode = 'c' | 'b' | 'a' | 'ad';
export type SessionAssessmentRowType = 'criterion' | 'capacity';

export interface SessionAssessmentCriterionRow {
  id: string;
  source: SessionAssessmentSource;
  competencyName: string;
  capacityName: string;
  criterionText: string;
  rowType?: SessionAssessmentRowType;
  levelDescriptors?: Partial<Record<SessionAssessmentLevelCode, string>>;
  performanceText?: string;
  evidenceText?: string;
  fieldText?: string;
  instrumentLabel?: string;
  order: number;
}

export interface SessionAssessmentModel {
  version: 1;
  sessionId?: string;
  instrument: SessionAssessmentInstrumentRef;
  scope: SessionAssessmentScope;
  competency: SessionAssessmentCompetencyRef;
  rows: SessionAssessmentCriterionRow[];
}
