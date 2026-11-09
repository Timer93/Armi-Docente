import { resolveSessionCriterionRows } from './sessionCriterionIdentity.js';
import { normalizeHybridLevel } from './hybridGradeIntegrity.js';

export const cleanConclusionText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').normalize('NFC').replace(/\s+/g, ' ').trim();
const key = value => cleanConclusionText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const rank = code => ['c', 'b', 'a', 'ad'].indexOf(code);

export function composeDescriptiveConclusion({ logros, dificultades, sugerencias }) {
  const parts = [logros, dificultades, sugerencias].map(value => cleanConclusionText(value).replace(/^(?:logros?|dificultades?|sugerencias?)\s*:\s*/i, ''));
  if (parts.some(part => part.length < 8)) return '';
  const text = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1) + (/[.!?]$/.test(part) ? '' : '.')).join(' ');
  return text.length <= 250 ? text : '';
}

// Criterion descriptions are supporting curricular references, never new
// observations about a student's attendance, effort or personal situation.
export function buildConclusionEvidence({ studentId, competencyName, source, sessions, records }) {
  const recordMap = new Map(records.map(record => [`${record.session_id}::${record.student_id}::${record.criteria_id}`, record]));
  return sessions.flatMap(session => {
    const data = session.sessionData || {};
    return resolveSessionCriterionRows(data, data.sessionAssessmentModel?.rows || []).flatMap(row => {
      if (String(row.source || 'primary') !== source || key(row.competencyName) !== key(competencyName)) return [];
      const record = (row.recordIds || []).map(id => recordMap.get(`${session.id}::${studentId}::${id}`)).find(Boolean);
      if (!record) return [];
      const code = normalizeHybridLevel(record.level);
      if (rank(code) < 0) return [];
      return [{ sessionId: session.id, unitNumber: session.unitNumber, sessionNumber: session.sessionNumber,
        criteriaId: record.criteria_id, capacityName: cleanConclusionText(row.capacityName), criterion: cleanConclusionText(row.criterionText),
        code, numericScore: record.numeric_score, description: cleanConclusionText(row.levelDescriptors?.[code]), observation: cleanConclusionText(record.observation) }];
    });
  });
}

const profiles = {
  needs: ['el análisis de necesidades de usuarios', 'realizar entrevistas y ordenar hallazgos en un mapa de empatía'],
  proposal: ['el diseño de propuestas de valor', 'contrastar un prototipo con opiniones de usuarios'],
  production: ['la organización del proceso productivo', 'representar las etapas y verificar materiales con una lista de cotejo'],
  technical: ['la aplicación de técnicas de producción', 'ensayar la técnica y comprobar la seguridad y calidad del producto'],
  teamwork: ['la coordinación del trabajo en equipo', 'acordar roles, plazos y revisar el cumplimiento de los acuerdos'],
  evaluation: ['la evaluación de resultados del proyecto', 'comparar costos, beneficios y opiniones de usuarios'],
  satisfaction: ['la evaluación de la satisfacción del usuario', 'aplicar una ficha y contrastar sus resultados con la meta del proyecto'],
  environment: ['la configuración de su entorno virtual', 'revisar permisos y organizar su espacio digital con una lista de cotejo'],
  data: ['la organización de información digital', 'aplicar filtros y verificar fuentes antes de elaborar un informe'],
  information: ['la selección de información confiable', 'contrastar fuentes y ordenar hallazgos en una tabla'],
  collaboration: ['la colaboración en entornos virtuales', 'acordar normas y compartir aportes en un espacio colaborativo'],
  creation: ['la elaboración de productos digitales', 'crear un recurso digital y revisarlo con criterios de calidad'],
  goals: ['la formulación de metas de aprendizaje', 'formular una meta medible y comprobarla con sus avances'],
  planning: ['la organización de sus estrategias', 'planificar tareas y tiempos, y revisar su cumplimiento'],
  monitoring: ['el seguimiento de sus avances', 'comparar avances con la meta y registrar ajustes en su plan'],
};

function profileFor(capacity, evidence) {
  const name = key(capacity.capacityName), comp = key(capacity.competencyName);
  const reference = key(`${evidence?.criterion || ''} ${evidence?.description || ''}`);
  if (capacity.source === 'primary' && comp.includes('emprendimiento')) {
    if (name.includes('crea propuestas')) return /prototip|disena|propuesta de valor/.test(reference) ? 'proposal' : 'needs';
    if (name.includes('habilidades tecnicas')) return /diagrama|flujo|etapas|proceso productivo/.test(reference) ? 'production' : 'technical';
    if (name.includes('cooperativa')) return 'teamwork';
    if (name.includes('evalua')) return /satisfaccion|encuesta/.test(reference) ? 'satisfaction' : 'evaluation';
  }
  if (comp.includes('entornos virtuales')) {
    if (name.includes('personaliza')) return 'environment';
    if (name.includes('gestiona informacion')) return /base de datos|filtro|hoja de calculo/.test(reference) ? 'data' : 'information';
    if (name.includes('interactua')) return 'collaboration';
    if (name.includes('crea objetos')) return 'creation';
  }
  if (comp.includes('aprendizaje') && comp.includes('autonom')) {
    if (name.includes('define metas')) return 'goals';
    if (name.includes('organiza')) return 'planning';
    if (name.includes('monitorea')) return 'monitoring';
  }
  return '';
}

export function draftGroundedConclusion({ student, competency, evidence = [] }) {
  const state = key(student.estado);
  if (state === 'r' || state.includes('retir')) return { text: 'Estudiante retirado.', kind: 'inactive' };
  if (state === 't' || state.includes('traslad')) return { text: 'Estudiante trasladado.', kind: 'inactive' };
  if (state === 'na' || state.includes('no asiste')) return { text: 'Estudiante no evaluado.', kind: 'inactive' };
  if (competency.pending) return { text: 'Conclusión pendiente: faltan calificaciones para completar la evaluación del bimestre.', kind: 'pending' };
  if (rank(competency.code) < 0) return { text: 'Sin calificaciones suficientes para elaborar una conclusión descriptiva.', kind: 'missing' };
  const capacities = student.capacities.filter(capacity => capacity.source === competency.source && key(capacity.competencyName) === key(competency.competencyName) && !capacity.pending && rank(capacity.code) >= 0);
  const referenceFor = (capacity, strongest) => evidence.filter(row => key(row.capacityName) === key(capacity.capacityName)).sort((a, b) => {
    const difference = rank(a.code) - rank(b.code) || (Number(a.numericScore) || 0) - (Number(b.numericScore) || 0);
    return strongest ? -difference : difference;
  })[0];
  const supported = capacities.map(capacity => ({ ...capacity, profile: profileFor(capacity, referenceFor(capacity, false)) })).filter(capacity => capacity.profile);
  if (!supported.length) return { text: '', kind: 'review', reason: 'No hay capacidades identificadas con suficiente contexto curricular.' };
  const ordered = supported.slice().sort((a, b) => rank(b.code) - rank(a.code) || (b.numericScore ?? 0) - (a.numericScore ?? 0));
  const best = ordered[0];
  const weakest = ordered.slice().reverse();
  const weak = weakest.find(capacity => capacity.key !== best.key) || weakest[0];
  const strongestProfile = profileFor(best, referenceFor(best, true)) || best.profile;
  const [achievementTopic] = profiles[strongestProfile];
  const [difficultyTopic, practice] = profiles[weak.profile];
  const achievementLead = { c: 'Se inicia en', b: 'Avanza en', a: 'Demuestra logros en', ad: 'Destaca en' }[best.code];
  const difficultyLead = { c: 'Necesita reforzar', b: 'Debe afianzar', a: 'Puede profundizar', ad: 'Puede ampliar' }[weak.code];
  const parts = { logros: `${achievementLead} ${achievementTopic}`, dificultades: `${difficultyLead} ${difficultyTopic}`, sugerencias: `Se sugiere ${practice}` };
  const text = composeDescriptiveConclusion(parts);
  return text ? { text, kind: 'pedagogical', parts, strongestCapacity: best.key, weakestCapacity: weak.key,
    references: [referenceFor(best, true), referenceFor(weak, false)].filter(Boolean) } : { text: '', kind: 'review', reason: 'La síntesis necesita revisión para conservar las tres partes dentro de 250 caracteres.' };
}
