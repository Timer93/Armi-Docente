
import { GeneralData, ModuleStatus, EvaluationLevel } from './types';

export const INITIAL_GENERAL_DATA: GeneralData = {
  year: new Date().getFullYear().toString(),
  
  department: '',
  region: '',
  province: '',
  ugel: '',
  district: '',
  institution: '',
  /* Initialized lugar to empty string */
  lugar: '',
  school_shift: '',
  level: '',
  motto: '',
  year_name: '',
  management_weeks_u1: '0',
  
  insignia: '',
  logo: '',

  director: '',
  subdirector: '',
  pedagogical_coordinator: '',
  toe_coordinator: '',
  teacher: '',

  context_description: '',
  gemini_api_key: '',
  openai_api_key: '',
  ai_provider: 'gemini',
  ai_pedagogical_route: '',
  ai_institutional_problems: '',
  ai_unit_pedagogical_focus: '',

  // Initialize dates as empty strings
  b1_start: '', b1_end: '',
  b2_start: '', b2_end: '',
  b3_start: '', b3_end: '',
  b4_start: '', b4_end: '',
  vac_start: '', vac_end: '',

  u1_start: '', u1_end: '',
  u2_start: '', u2_end: '',
  u3_start: '', u3_end: '',
  u4_start: '', u4_end: '',
  u5_start: '', u5_end: '',
  u6_start: '', u6_end: '',
  u7_start: '', u7_end: '',
  u8_start: '', u8_end: '',
  u_vac_start: '', u_vac_end: '',
};

export const INITIAL_MODULE_STATUS: ModuleStatus = {
  datos_generales: false,
  calendario: false,
  areas_grados: false,
  estudiantes: false,
  horario: false,
  programacion_anual: false,
  unidades_didacticas: false,
  sesiones: false,
  evaluacion: false,
};

export const API_BASE_URL = '/api';

export const LEVEL_COLORS: Record<EvaluationLevel, string> = {
  [EvaluationLevel.AD]: '#00b0f0', // Celeste
  [EvaluationLevel.A]: '#00b050',  // Verde
  [EvaluationLevel.B]: '#f97316',  // Naranja
  [EvaluationLevel.C]: '#ef4444',  // Rojo
  [EvaluationLevel.NE]: '#000000'  // Negro
};

// Fallback data for Preview Mode (when backend is unreachable)
export const DEPARTAMENTOS_PERU_MOCK = [
    "AMAZONAS", "ÃNCASH", "APURÃMAC", "AREQUIPA", "AYACUCHO", "CAJAMARCA", "CALLAO", "CUSCO",
    "HUANCAVELICA", "HUÃNUCO", "ICA", "JUNÃN", "LA LIBERTAD", "LAMBAYEQUE", "LIMA", "LORETO",
    "MADRE DE DIOS", "MOQUEGUA", "PASCO", "PIURA", "PUNO", "SAN MARTÃN", "TACNA", "TUMBES", "UCAYALI"
];

// Added for evaluation components
export const INITIAL_HEADER_INFO = {
  grel: '',
  ugel: '',
  iiee: '',
  distrito: '',
  nivel: 'SECUNDARIA',
  grado: '',
  seccion: '',
  area: 'EDUCACIÃ“N PARA EL TRABAJO',
  docente: '',
  anio: new Date().getFullYear().toString()
};

// Added for evaluation components
export const MOCK_STUDENTS = [
    { id: '1', name: 'JUAN PEREZ', grade: '4to', section: 'A', competencyValue: EvaluationLevel.A, description: '' },
    { id: '2', name: 'MARIA GARCIA', grade: '4to', section: 'A', competencyValue: EvaluationLevel.B, description: '' }
];
