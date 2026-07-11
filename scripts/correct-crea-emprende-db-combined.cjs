const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(process.env.APPDATA, 'ARMI Docente', 'database', 'armi.db');
const reportPath = path.join(process.cwd(), 'temp', 'crea-emprende-db-report-combined.json');

const db = new Database(dbPath, { timeout: 20000 });
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 20000');

const AREA_ID = '1774917929135';
const COMPETENCY = 'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.';
const DEFAULT_INSTRUMENT = 'Rúbrica';

const configs = [
  { key: '2do-A y B', grade: '2do', section: 'A y B', u4Count: 8, profile: '2do' },
  { key: '3ro-U', grade: '3ro', section: 'U', u4Count: 10, profile: '3ro' },
  { key: '4to-U', grade: '4to', section: 'U', u4Count: 10, profile: '4to' },
  { key: '5to-A y B', grade: '5to', section: 'A y B', u4Count: 10, profile: '5to' },
];

const profileMeta = {
  '2do': {
    label: 'segundo grado',
    tone: 'con apoyo del docente y productos guiados',
    autonomy: 'Organiza sus tareas con apoyo de una guía simple y cumple acuerdos básicos del equipo.',
    evidenceTone: 'ficha guiada y producto concreto del equipo',
  },
  '3ro': {
    label: 'tercer grado',
    tone: 'con análisis intermedio y mayor autonomía',
    autonomy: 'Organiza acciones y monitorea avances para cumplir metas de la sesión con mayor autonomía.',
    evidenceTone: 'matriz de trabajo y sustento breve del equipo',
  },
  '4to': {
    label: 'cuarto grado',
    tone: 'con mayor profundidad en validación, análisis y mejora',
    autonomy: 'Gestiona tiempos, responsables y evidencias para optimizar el proyecto con criterio técnico.',
    evidenceTone: 'matriz analítica, sustento y decisiones de mejora',
  },
  '5to': {
    label: 'quinto grado',
    tone: 'con exigencia de viabilidad, sustento y preparación para concurso',
    autonomy: 'Ajusta estrategias, prioriza riesgos y sustenta decisiones con mirada de viabilidad y concurso.',
    evidenceTone: 'documento técnico y sustentación del equipo',
  },
};

const dates = {
  '2do-A y B': {
    3: ['2026-05-25', '2026-05-28', '2026-06-01', '2026-06-04', '2026-06-08', '2026-06-11', '2026-06-15', '2026-06-18', '2026-06-22', '2026-06-25'],
    4: ['2026-06-29', '2026-07-02', '2026-07-06', '2026-07-09', '2026-07-13', '2026-07-16', '2026-07-20', '2026-07-23'],
  },
  '3ro-U': {
    3: ['2026-05-26', '2026-05-29', '2026-06-02', '2026-06-05', '2026-06-09', '2026-06-12', '2026-06-16', '2026-06-19', '2026-06-23', '2026-06-26'],
    4: ['2026-06-30', '2026-07-03', '2026-07-07', '2026-07-10', '2026-07-14', '2026-07-17', '2026-07-21', '2026-07-24', '2026-07-28', '2026-07-31'],
  },
  '4to-U': {
    3: ['2026-05-27', '2026-05-29', '2026-06-03', '2026-06-05', '2026-06-10', '2026-06-12', '2026-06-17', '2026-06-19', '2026-06-24', '2026-06-26'],
    4: ['2026-07-01', '2026-07-03', '2026-07-08', '2026-07-10', '2026-07-15', '2026-07-17', '2026-07-22', '2026-07-24', '2026-07-29', '2026-07-31'],
  },
  '5to-A y B': {
    3: ['2026-05-25', '2026-05-27', '2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10', '2026-06-15', '2026-06-17', '2026-06-22', '2026-06-24'],
    4: ['2026-06-29', '2026-07-01', '2026-07-06', '2026-07-08', '2026-07-13', '2026-07-15', '2026-07-20', '2026-07-22', '2026-07-27', '2026-07-29'],
  },
};

const u3Themes = {
  5: {
    title: 'Construimos el Lean Canvas inicial identificando el problema, los clientes, la propuesta de valor y la solución',
    portfolio: '2.3.1',
    capacity: 'Crea propuestas de valor',
    field: 'Lean Canvas I: problema, segmento de clientes, propuesta de valor y solución del proyecto.',
    criteria: [
      'Identifica con claridad el problema central y el segmento de clientes del proyecto.',
      'Formula una propuesta de valor coherente con la necesidad detectada.',
      'Relaciona la solución con el problema priorizado y el público objetivo.',
      'Presenta el Lean Canvas I de forma ordenada y sustentada.'
    ],
    evidence: (p) => `Lean Canvas I completado ${p.evidenceTone}, con explicación de problema, cliente, propuesta de valor y solución.`,
    purpose: (p) => `Que los estudiantes de ${p.label} formalicen la primera parte del Lean Canvas ${p.tone}, definiendo con claridad el problema, el segmento de clientes, la propuesta de valor y la solución de su proyecto para fortalecer el portafolio de Crea y Emprende.`,
  },
  6: {
    title: 'Completamos el Lean Canvas organizando canales, ingresos, costos, métricas clave y ventaja especial',
    portfolio: '2.3.1',
    capacity: 'Crea propuestas de valor',
    field: 'Lean Canvas II: canales, ingresos, costos, métricas clave y ventaja especial del proyecto.',
    criteria: [
      'Selecciona canales adecuados para llegar al segmento de clientes.',
      'Relaciona ingresos y costos con la propuesta de valor del proyecto.',
      'Define métricas clave y una ventaja especial coherente con la solución.',
      'Integra los bloques del Lean Canvas II con lógica comercial básica.'
    ],
    evidence: (p) => `Lean Canvas II completado ${p.evidenceTone}, con justificación de canales, ingresos, costos, métricas y ventaja especial.`,
    purpose: (p) => `Que los estudiantes de ${p.label} completen la segunda parte del Lean Canvas ${p.tone}, definiendo canales, ingresos, costos, métricas clave y ventaja especial del proyecto para fortalecer el portafolio de Crea y Emprende.`,
  },
  7: {
    title: 'Formulamos hipótesis falsables del modelo de negocio usando los bloques del Lean Canvas',
    portfolio: '2.3.2',
    capacity: 'Crea propuestas de valor',
    field: 'Hipótesis falsables de problema, cliente, solución, canales, ingresos, costos, métricas y ventaja especial.',
    criteria: [
      'Formula hipótesis verificables a partir de los bloques del Lean Canvas.',
      'Diferencia hipótesis de problema, cliente, solución, ingresos y costos.',
      'Redacta hipótesis comprobables con usuarios o datos reales.',
      'Prioriza las hipótesis críticas del proyecto.'
    ],
    evidence: (p) => `Matriz de hipótesis falsables ${p.evidenceTone}, priorizadas por nivel de riesgo e impacto.`,
    purpose: (p) => `Que los estudiantes de ${p.label} formulen hipótesis falsables por bloque del Lean Canvas ${p.tone}, priorizando las que necesitan comprobar antes de seguir cerrando el portafolio del proyecto.`,
  },
  8: {
    title: 'Diseñamos el plan de validación de hipótesis considerando usuarios, técnicas, responsables y evidencias',
    portfolio: '2.3.3',
    capacity: 'Evalúa los resultados del proyecto de emprendimiento',
    field: 'Plan de validación de hipótesis: técnicas, responsables, usuarios, recursos, fechas y evidencias.',
    criteria: [
      'Selecciona técnicas adecuadas para validar las hipótesis priorizadas.',
      'Organiza responsables, usuarios, recursos y fechas de trabajo.',
      'Respeta el orden de validación: problema y cliente, solución y luego viabilidad.',
      'Propone evidencias verificables de la validación.'
    ],
    evidence: (p) => `Plan de validación ${p.evidenceTone}, con hipótesis, técnica, muestra, responsables, fechas y evidencia esperada.`,
    purpose: (p) => `Que los estudiantes de ${p.label} diseñen un plan de validación de hipótesis ${p.tone}, organizando técnicas, responsables, recursos y evidencias para comprobar el modelo de negocio del proyecto.`,
  },
  9: {
    title: 'Elaboramos el diagrama de Gantt de validación organizando actividades, fechas y responsables',
    portfolio: '2.3.4',
    capacity: 'Trabaja cooperativamente para lograr objetivos y metas',
    field: 'Diagrama de Gantt de validación: actividades, tiempos, responsables, recursos e hitos.',
    criteria: [
      'Organiza las actividades en una secuencia temporal lógica.',
      'Asigna fechas, responsables y recursos de manera realista.',
      'Relaciona cada actividad con la hipótesis que se validará.',
      'Presenta el cronograma de forma clara y utilizable por el equipo.'
    ],
    evidence: (p) => `Diagrama de Gantt de validación ${p.evidenceTone}, con tareas, fechas, responsables e hitos.`,
    purpose: (p) => `Que los estudiantes de ${p.label} organicen el cronograma de validación en un diagrama de Gantt ${p.tone}, distribuyendo actividades, responsables y tiempos para ejecutar el plan de validación.`,
  },
  10: {
    title: 'Diseñamos la identidad visual del emprendimiento aplicando criterios de marca, logotipo, colores y tipografía',
    portfolio: '1.10, 1.16 y 2.4.3',
    capacity: 'Aplica habilidades técnicas',
    field: 'Identidad visual del proyecto: marca, logo, logotipo, isotipo o imagotipo, colores, tipografía y justificación estética.',
    criteria: [
      'Diseña o mejora el nombre visual del emprendimiento con coherencia.',
      'Diferencia logo, logotipo, isotipo, imagotipo o isologo según corresponda.',
      'Selecciona colores y tipografías coherentes con el público objetivo.',
      'Justifica la identidad visual en relación con la propuesta de valor.'
    ],
    evidence: (p) => `Propuesta de identidad visual ${p.evidenceTone}, con marca, logo o variante gráfica, paleta, tipografía y justificación estética.`,
    purpose: (p) => `Que los estudiantes de ${p.label} diseñen o mejoren la identidad visual de su emprendimiento ${p.tone}, justificando nombre visual, recursos gráficos y decisiones estéticas para fortalecer el portafolio del proyecto.`,
  },
};

const u4Themes = {
  10: {
    1: ['Mejoramos el producto o prototipo incorporando los resultados de la validación con usuarios', '2.4.1', 'Aplica habilidades técnicas'],
    2: ['Elaboramos estrategias de captación de clientes aplicando la técnica AIDA', '2.4.2', 'Crea propuestas de valor'],
    3: ['Creamos materiales de difusión del emprendimiento usando video, redes sociales y WhatsApp', '2.4.3', 'Aplica habilidades técnicas'],
    4: ['Diseñamos estrategias de retención de clientes fortaleciendo la experiencia del usuario', '2.4.4', 'Evalúa los resultados del proyecto de emprendimiento'],
    5: ['Proponemos acciones de crecimiento del negocio mediante nuevos productos, canales o aliados', '2.4.5', 'Crea propuestas de valor'],
    6: ['Analizamos la viabilidad económica del emprendimiento calculando costos, ingresos e inversión', '2.4.6', 'Evalúa los resultados del proyecto de emprendimiento'],
    7: ['Evaluamos el impacto social, ambiental y económico del emprendimiento en la comunidad', '2.4.7', 'Evalúa los resultados del proyecto de emprendimiento'],
    8: ['Revisamos integralmente el portafolio organizando evidencias y apartados del proyecto', 'Cierre de portafolio', 'Trabaja cooperativamente para lograr objetivos y metas'],
    9: ['Reflexionamos sobre el trabajo en equipo identificando logros, dificultades y soluciones', 'Cierre', 'Evalúa los resultados del proyecto de emprendimiento'],
    10: ['Presentamos el producto y portafolio final sustentando la propuesta para Crea y Emprende', 'Presentación final', 'Trabaja cooperativamente para lograr objetivos y metas'],
  },
  8: {
    1: ['Mejoramos el producto o prototipo incorporando los resultados de la validación con usuarios', '2.4.1', 'Aplica habilidades técnicas'],
    2: ['Elaboramos estrategias de captación de clientes aplicando la técnica AIDA', '2.4.2', 'Crea propuestas de valor'],
    3: ['Creamos materiales de difusión y retención usando video, redes sociales, WhatsApp y mensajes personalizados', '2.4.3 y 2.4.4', 'Aplica habilidades técnicas'],
    4: ['Proponemos acciones de crecimiento del negocio mediante nuevos productos, canales o aliados', '2.4.5', 'Crea propuestas de valor'],
    5: ['Analizamos la viabilidad e impacto del emprendimiento calculando costos, ingresos y beneficios para la comunidad', '2.4.6 y 2.4.7', 'Evalúa los resultados del proyecto de emprendimiento'],
    6: ['Revisamos integralmente el portafolio organizando evidencias y apartados del proyecto', 'Cierre de portafolio', 'Trabaja cooperativamente para lograr objetivos y metas'],
    7: ['Reflexionamos sobre el trabajo en equipo identificando logros, dificultades, soluciones y mejoras', 'Cierre', 'Evalúa los resultados del proyecto de emprendimiento'],
    8: ['Presentamos el producto y portafolio final sustentando la propuesta para Crea y Emprende', 'Presentación final', 'Trabaja cooperativamente para lograr objetivos y metas'],
  },
};

const stripHtml = (text) => String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (text) => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (text) => `<p>${esc(text)}</p>`;
const bullets = (items) => items.map((item) => `<p>• ${esc(item)}</p>`).join('');
const list = (items) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
const clone = (v) => JSON.parse(JSON.stringify(v));

const getRows = (sql, params = []) => db.prepare(sql).all(...params);
const getRow = (sql, params = []) => db.prepare(sql).get(...params);

const sessions = getRows(`SELECT * FROM sesiones WHERE year='2026' AND area_id=?`, [AREA_ID]);
const units = getRows(`SELECT * FROM unidades_didacticas WHERE year='2026' AND area_id=?`, [AREA_ID]);

const sessionMap = new Map();
for (const row of sessions) sessionMap.set(`${row.grade}|${row.section}|${row.unit_number}|${row.session_number}`, row);
const unitMap = new Map();
for (const row of units) unitMap.set(`${row.grade}|${row.section}|${row.unit_number}`, row);

const genericSessionRow = sessionMap.get('3ro|U|3|5') || sessions[0];
const genericSessionData = JSON.parse(genericSessionRow.session_data || '{}');

function buildDescriptors(topic) {
  return {
    c: `Reconoce el tema de ${topic} de manera inicial, pero aún requiere apoyo para organizar sus ideas y evidencias.`,
    b: `Desarrolla ${topic} con avances parciales y cierta coherencia, aunque todavía necesita precisar mejor algunos elementos.`,
    a: `Desarrolla ${topic} con claridad, coherencia y relación directa con el proyecto y el portafolio.`,
    ad: `Desarrolla ${topic} con alto nivel de precisión, sustento y criterio de mejora, mostrando preparación para Crea y Emprende.`,
  };
}

function buildTheme(unitCount, sessionNumber, profile) {
  if (unitCount === 3) return u3Themes[sessionNumber];
  const base = u4Themes[profile.u4Count][sessionNumber];
  if (!base) return null;
  const [title, portfolio, capacity] = base;
  return {
    title,
    portfolio,
    capacity,
    field: `${title}. Relación con portafolio Crea y Emprende: ${portfolio}.`,
    criteria: [
      `Desarrolla de manera coherente el avance central de la sesión: ${title}.`,
      'Relaciona el trabajo realizado con el proyecto de emprendimiento y el portafolio.',
      'Sustenta decisiones, evidencias o mejoras de acuerdo con el propósito de la sesión.',
      'Presenta un producto o evidencia ordenada y pertinente.'
    ],
    evidence: (pmeta) => `${title} desarrollado como ${pmeta.evidenceTone}, con relación explícita al portafolio y al proyecto.`,
    purpose: (pmeta) => `Que los estudiantes de ${pmeta.label} desarrollen la sesión ${title.toLowerCase()} ${pmeta.tone}, fortaleciendo el producto, el portafolio y la preparación del proyecto para Crea y Emprende.`,
  };
}

function buildSessionData(base, config, unitNumber, sessionNumber, date, preserve) {
  const next = clone(base || genericSessionData);
  next.date = date;
  if (preserve) return next;

  const pmeta = profileMeta[config.profile];
  const theme = buildTheme(unitNumber, sessionNumber, config);
  const levels = buildDescriptors(theme.title.toLowerCase());

  next.title = theme.title;
  next.purpose = theme.purpose(pmeta);
  next.situation = `Los estudiantes de ${pmeta.label} continúan organizando y cerrando el portafolio del Concurso Nacional Crea y Emprende. En esta sesión necesitan avanzar el componente ${theme.title.toLowerCase()} para mantener coherencia entre el producto o prototipo, las evidencias y la presentación final del proyecto.`;
  next.dateChangeMotive = '';
  next.competenciaPrio = {
    comp: COMPETENCY,
    cap: theme.capacity,
    des: bullets(theme.criteria),
    field: theme.field,
    evidence: p(theme.evidence(pmeta)),
    inst: DEFAULT_INSTRUMENT,
  };
  next.competenciasTrans = [
    {
      comp: 'Se desenvuelve en los entornos virtuales generados por las TIC',
      cap: 'Gestiona información del entorno virtual',
      des: p('Organiza la información y evidencias digitales de la sesión de manera clara y recuperable.'),
      field: '',
      evidence: p(`Archivo o evidencia digital ordenada de la sesión ${sessionNumber}.`),
      inst: DEFAULT_INSTRUMENT,
      rowColor: '#007c59',
    },
    {
      comp: 'Gestiona su aprendizaje de manera autónoma',
      cap: 'Organiza acciones estratégicas para alcanzar sus metas de aprendizaje.',
      des: p(pmeta.autonomy),
      field: '',
      evidence: p(`Registro de acuerdos, autoevaluación o mejora del equipo en la sesión ${sessionNumber}.`),
      inst: DEFAULT_INSTRUMENT,
      rowColor: '#00b28c',
    },
  ];
  next.secuencia = {
    inicio: {
      saberes: bullets([
        'El docente recupera los avances previos del proyecto y del portafolio.',
        `Se conecta la sesión con el componente central: ${theme.title}.`,
        'Los estudiantes comentan qué evidencias previas servirán para avanzar esta parte del portafolio.'
      ]),
      saberes_recursos: list(['Pizarra', 'Plumones', 'Portafolio en proceso', 'Anexos de sesiones anteriores']),
      conflicto: p(`Se plantea el reto de la sesión: ${theme.title}. El equipo deberá demostrar que este avance fortalece la preparación del proyecto para Crea y Emprende.`),
      conflicto_recursos: list(['Expresión oral', 'Trabajo colaborativo']),
      tiempo: "10'",
    },
    proceso: {
      construccion: bullets([
        `Analizan qué exige el portafolio en relación con ${theme.title.toLowerCase()}.`,
        'Organizan la información, evidencias y decisiones del equipo para producir el avance correspondiente.',
        'Reciben retroalimentación del docente y ajustan su trabajo para mejorar coherencia y claridad.'
      ]),
      construccion_recursos: list(['PC o laptop', 'Plantillas de trabajo', 'Portafolio del equipo', 'Cuaderno de campo']),
      aplicacion: bullets([
        'El equipo desarrolla el producto o evidencia de la sesión y la incorpora al portafolio.',
        `Se verifica la coherencia entre título, propósito, evidencia e instrumento en la sesión ${sessionNumber}.`
      ]),
      aplicacion_recursos: list(['Anexo de trabajo', 'Instrumento de evaluación', 'Observación del docente']),
      metacognicion: bullets([
        '¿Qué aprendimos al desarrollar esta parte del proyecto?',
        '¿Qué ajuste todavía debemos realizar para que el portafolio quede más sólido?'
      ]),
      metacognicion_recursos: list(['Cuaderno', 'Expresión oral']),
      tiempo: "65'",
    },
    salida: {
      evaluacion: p(`El docente evalúa el desarrollo de la sesión mediante ${DEFAULT_INSTRUMENT.toLowerCase()}, verifica los criterios priorizados y orienta ajustes finales para fortalecer el portafolio del proyecto.`),
      evaluacion_recursos: list([DEFAULT_INSTRUMENT, 'Retroalimentación oral']),
      tiempo: "15'",
    },
  };
  next.extension = `Relación con el portafolio Crea y Emprende: ${theme.portfolio}.`;
  next.instrumentoTemplate = next.instrumentoTemplate || genericSessionData.instrumentoTemplate || {};
  next.assessmentModel = {
    competencia: COMPETENCY,
    capacidades: [theme.capacity],
    criterios: [{ id: '1', text: `• ${theme.criteria[0]}`, capacidad: theme.capacity, rowType: 'criterion' }],
    source: 'system',
  };
  next.sessionAssessmentModel = {
    version: 1,
    instrument: {
      type: 'rubrica',
      name: next.instrumentoTemplate?.name || 'Rubrica Analitica - General',
      templateId: next.instrumentoTemplate?.id || null,
    },
    scope: {
      areaId: AREA_ID,
      grade: config.grade,
      section: config.section,
      unitNumber: String(unitNumber),
      sessionNumber: String(sessionNumber),
      bimester: unitNumber === 3 ? 'II' : 'III',
    },
    competency: { name: COMPETENCY },
    rows: [
      {
        id: 'primary-1',
        source: 'primary',
        competencyName: COMPETENCY,
        capacityName: theme.capacity,
        criterionText: theme.criteria[0],
        rowType: 'criterion',
        levelDescriptors: levels,
        performanceText: p(theme.criteria[0]),
        evidenceText: p(theme.evidence(pmeta)),
        fieldText: theme.field,
        instrumentLabel: DEFAULT_INSTRUMENT,
        order: 1,
      },
      {
        id: 'transversal-1',
        source: 'transversal',
        competencyName: 'Se desenvuelve en los entornos virtuales generados por las TIC',
        capacityName: 'Gestiona información del entorno virtual',
        criterionText: 'Organiza la información y evidencias digitales de la sesión de manera clara y recuperable.',
        rowType: 'criterion',
        performanceText: p('Organiza la información y evidencias digitales de la sesión de manera clara y recuperable.'),
        evidenceText: p(`Archivo o evidencia digital ordenada de la sesión ${sessionNumber}.`),
        fieldText: '',
        instrumentLabel: DEFAULT_INSTRUMENT,
        rowColor: '#007c59',
        order: 2,
      },
      {
        id: 'transversal-2',
        source: 'transversal',
        competencyName: 'Gestiona su aprendizaje de manera autónoma',
        capacityName: 'Organiza acciones estratégicas para alcanzar sus metas de aprendizaje.',
        criterionText: pmeta.autonomy,
        rowType: 'criterion',
        performanceText: p(pmeta.autonomy),
        evidenceText: p(`Registro de acuerdos, autoevaluación o mejora del equipo en la sesión ${sessionNumber}.`),
        fieldText: '',
        instrumentLabel: DEFAULT_INSTRUMENT,
        rowColor: '#00b28c',
        order: 3,
      },
    ],
  };
  next.instrumento = [
    {
      id: 'primary-1',
      competencia: COMPETENCY,
      capacidad: theme.capacity,
      criterio: theme.criteria[0],
      ...levels,
      source: 'primary',
      rowColor: '',
    },
    {
      id: 'transversal-1',
      competencia: 'Se desenvuelve en los entornos virtuales generados por las TIC',
      capacidad: 'Gestiona información del entorno virtual',
      criterio: 'Organiza la información y evidencias digitales de la sesión de manera clara y recuperable.',
      ...buildDescriptors('la organización digital de evidencias'),
      source: 'transversal',
      rowColor: '#007c59',
    },
    {
      id: 'transversal-2',
      competencia: 'Gestiona su aprendizaje de manera autónoma',
      capacidad: 'Organiza acciones estratégicas para alcanzar sus metas de aprendizaje.',
      criterio: pmeta.autonomy,
      ...buildDescriptors('la organización autónoma de acciones y evidencias'),
      source: 'transversal',
      rowColor: '#00b28c',
    }
  ];

  return next;
}

function sessionSummary(config, sessionNumber, date, sessionData) {
  return {
    id: sessionNumber,
    date,
    title: sessionData.title,
    cap: '',
    des: stripHtml(sessionData.competenciaPrio?.des || ''),
    con: sessionData.competenciaPrio?.field || '',
    evi: stripHtml(sessionData.competenciaPrio?.evidence || ''),
    eval: sessionData.competenciaPrio?.inst || DEFAULT_INSTRUMENT,
    competencia: COMPETENCY,
    transversales: (sessionData.competenciasTrans || []).map((x) => x.comp),
    capacidades: [sessionData.competenciaPrio?.cap].concat((sessionData.competenciasTrans || []).map((x) => x.cap)).filter(Boolean),
    criteriaItems: (Array.isArray(sessionData.instrumento) ? sessionData.instrumento : []).slice(0, 3).map((row) => ({
      text: `• ${row.criterio}`,
      color: row.rowColor ? `text-[${row.rowColor}]` : 'text-black',
    })),
    evidenceItems: [{ text: `• ${stripHtml(sessionData.competenciaPrio?.evidence || '')}`, color: 'text-black' }],
    fechasPorSeccion: [`${config.grade} ${config.section} (${date})`],
    selectedCriteriaTexts: (Array.isArray(sessionData.instrumento) ? sessionData.instrumento : []).slice(0, 1).map((row) => row.criterio),
    selectedEvidenceIds: [`session-${sessionNumber}-0`],
  };
}

function sessionRecord(config, unitNumber, sessionNumber, date, sessionData) {
  const rows = Array.isArray(sessionData.instrumento) ? sessionData.instrumento : [];
  return {
    id_sesion: `2026-${AREA_ID}-${config.grade}-${config.section}-U${unitNumber}-S${sessionNumber}`,
    year: '2026',
    area_id: AREA_ID,
    grade: config.grade,
    section: config.section,
    unit_number: String(unitNumber),
    session_number: String(sessionNumber),
    titulo_de_la_sesion: sessionData.title,
    proposito_de_sesion: sessionData.purpose,
    campo_tematico: sessionData.competenciaPrio?.field || '',
    producto_de_sesion: stripHtml(sessionData.competenciaPrio?.evidence || ''),
    instrumento_de_evaluacion: sessionData.competenciaPrio?.inst || DEFAULT_INSTRUMENT,
    criterio1: rows[0]?.criterio || '',
    criterio2: rows[1]?.criterio || '',
    criterio3: rows[2]?.criterio || '',
    criterio4: rows[3]?.criterio || '',
    saberes_previos: sessionData.secuencia?.inicio?.saberes || '',
    conflicto_cognitivo: sessionData.secuencia?.inicio?.conflicto || '',
    cosntruccion_del_conocimiento: sessionData.secuencia?.proceso?.construccion || '',
    apliacion_de_lo_aprendido: sessionData.secuencia?.proceso?.aplicacion || '',
    reflexion_de_lo_aprendido: sessionData.secuencia?.proceso?.metacognicion || '',
    evaluacion: sessionData.secuencia?.salida?.evaluacion || '',
    fecha_sesion: date,
    session_data: JSON.stringify(sessionData),
  };
}

function unitTexts(config, unitNumber) {
  const pmeta = profileMeta[config.profile];
  if (unitNumber === 3) {
    return {
      title: 'Formalizamos el modelo de negocio y la validación del proyecto para fortalecer el portafolio de Crea y Emprende.',
      purpose: `Que los estudiantes de ${pmeta.label} consoliden el modelo de negocio de su emprendimiento, formulen hipótesis, organicen su validación y fortalezcan la identidad visual del proyecto para dejar avances formales del portafolio de Crea y Emprende.`,
      product: 'Portafolio intermedio con Lean Canvas completo, matriz de hipótesis, plan y cronograma de validación, e identidad visual del proyecto.',
      situation: 'Los equipos ya han explorado necesidades, prototipado y recibido retroalimentación inicial. Ahora necesitan formalizar sus hallazgos y organizar evidencias para que su proyecto avance con coherencia hacia el Concurso Nacional Crea y Emprende.',
    };
  }
  return {
    title: 'Cerramos el proyecto emprendedor y dejamos listo el portafolio final para Crea y Emprende.',
    purpose: `Que los estudiantes de ${pmeta.label} culminen su proyecto de emprendimiento revisando producto o prototipo, estrategias comerciales, análisis económico e impacto, evaluación final y presentación del portafolio para participar en Crea y Emprende.`,
    product: 'Producto o prototipo mejorado, portafolio completo, estrategias de difusión y cierre, análisis económico e impacto, y presentación final del proyecto.',
    situation: 'Los equipos se encuentran en la etapa final de preparación para Crea y Emprende. Necesitan integrar las evidencias generadas durante el proceso, cerrar vacíos del portafolio y preparar una presentación convincente del proyecto.',
  };
}

const insertSessionStmt = db.prepare(`
  INSERT INTO sesiones (
    id_sesion, year, area_id, grade, section, unit_number, session_number,
    titulo_de_la_sesion, proposito_de_sesion, campo_tematico, producto_de_sesion,
    instrumento_de_evaluacion, criterio1, criterio2, criterio3, criterio4,
    saberes_previos, conflicto_cognitivo, cosntruccion_del_conocimiento, apliacion_de_lo_aprendido,
    reflexion_de_lo_aprendido, evaluacion, fecha_sesion, session_data
  ) VALUES (
    @id_sesion, @year, @area_id, @grade, @section, @unit_number, @session_number,
    @titulo_de_la_sesion, @proposito_de_sesion, @campo_tematico, @producto_de_sesion,
    @instrumento_de_evaluacion, @criterio1, @criterio2, @criterio3, @criterio4,
    @saberes_previos, @conflicto_cognitivo, @cosntruccion_del_conocimiento, @apliacion_de_lo_aprendido,
    @reflexion_de_lo_aprendido, @evaluacion, @fecha_sesion, @session_data
  )
`);

const updateSessionStmt = db.prepare(`
  UPDATE sesiones SET
    titulo_de_la_sesion=@titulo_de_la_sesion,
    proposito_de_sesion=@proposito_de_sesion,
    campo_tematico=@campo_tematico,
    producto_de_sesion=@producto_de_sesion,
    instrumento_de_evaluacion=@instrumento_de_evaluacion,
    criterio1=@criterio1,
    criterio2=@criterio2,
    criterio3=@criterio3,
    criterio4=@criterio4,
    saberes_previos=@saberes_previos,
    conflicto_cognitivo=@conflicto_cognitivo,
    cosntruccion_del_conocimiento=@cosntruccion_del_conocimiento,
    apliacion_de_lo_aprendido=@apliacion_de_lo_aprendido,
    reflexion_de_lo_aprendido=@reflexion_de_lo_aprendido,
    evaluacion=@evaluacion,
    fecha_sesion=@fecha_sesion,
    session_data=@session_data,
    updated_at=CURRENT_TIMESTAMP
  WHERE id_sesion=@id_sesion
`);

const insertUnitStmt = db.prepare(`
  INSERT INTO unidades_didacticas (
    id_unidad, year, area_id, grade, section, unit_number,
    title, purpose, product, situation, criterios, evidencias, instrumentos,
    criterios_trans, evidencias_trans, instrumentos_trans, sesiones, recursos, bibliografia, evaluacion
  ) VALUES (
    @id_unidad, @year, @area_id, @grade, @section, @unit_number,
    @title, @purpose, @product, @situation, @criterios, @evidencias, @instrumentos,
    @criterios_trans, @evidencias_trans, @instrumentos_trans, @sesiones, @recursos, @bibliografia, @evaluacion
  )
`);

const updateUnitStmt = db.prepare(`
  UPDATE unidades_didacticas SET
    title=@title,
    purpose=@purpose,
    product=@product,
    situation=@situation,
    criterios=@criterios,
    evidencias=@evidencias,
    instrumentos=@instrumentos,
    criterios_trans=@criterios_trans,
    evidencias_trans=@evidencias_trans,
    instrumentos_trans=@instrumentos_trans,
    sesiones=@sesiones,
    recursos=@recursos,
    bibliografia=@bibliografia,
    evaluacion=@evaluacion,
    updated_at=CURRENT_TIMESTAMP
  WHERE id_unidad=@id_unidad
`);

const modifiedSessions = [];
const createdSessions = [];
const modifiedUnits = [];
const finalRows = [];

function upsertSession(rec) {
  if (getRow(`SELECT id_sesion FROM sesiones WHERE id_sesion=?`, [rec.id_sesion])) {
    updateSessionStmt.run(rec);
    modifiedSessions.push(rec.id_sesion);
  } else {
    insertSessionStmt.run(rec);
    createdSessions.push(rec.id_sesion);
  }
}

function upsertUnit(rec) {
  if (getRow(`SELECT id_unidad FROM unidades_didacticas WHERE id_unidad=?`, [rec.id_unidad])) {
    updateUnitStmt.run(rec);
  } else {
    insertUnitStmt.run(rec);
  }
  modifiedUnits.push(rec.id_unidad);
}

db.transaction(() => {
  for (const config of configs) {
    for (const unitNumber of [3, 4]) {
      const summaries = [];
      const unitInfo = unitTexts(config, unitNumber);
      const sourceUnit = unitMap.get(`${config.grade}|${config.section}|3`) || units[0];
      const maxSessions = unitNumber === 3 ? 10 : config.u4Count;

      for (let sessionNumber = 1; sessionNumber <= maxSessions; sessionNumber += 1) {
        const date = dates[config.key][unitNumber][sessionNumber - 1] || '';
        const existing = sessionMap.get(`${config.grade}|${config.section}|${unitNumber}|${sessionNumber}`);
        const source = existing || sessionMap.get(`${config.grade}|${config.section}|3|${Math.min(sessionNumber, 6)}`) || genericSessionRow;
        const baseData = JSON.parse(source.session_data || '{}');
        const preserve = unitNumber === 3 && sessionNumber <= 4;
        const sessionData = buildSessionData(baseData, config, unitNumber, sessionNumber, date, preserve);
        const rec = sessionRecord(config, unitNumber, sessionNumber, date, sessionData);
        upsertSession(rec);
        summaries.push(sessionSummary(config, sessionNumber, date, sessionData));
        finalRows.push({
          grado: config.grade,
          seccion: config.section,
          unidad: unitNumber,
          sesion: sessionNumber,
          titulo: sessionData.title,
          campo_tematico: sessionData.competenciaPrio?.field || '',
          evidencia: stripHtml(sessionData.competenciaPrio?.evidence || ''),
          relacion_portafolio: preserve ? 'Conservar avance previo' : (buildTheme(unitNumber, sessionNumber, config)?.portfolio || ''),
        });
      }

      const unitRec = {
        id_unidad: `2026-${AREA_ID}-${config.grade}-${config.section}-U${unitNumber}`,
        year: '2026',
        area_id: AREA_ID,
        grade: config.grade,
        section: config.section,
        unit_number: String(unitNumber),
        title: unitInfo.title,
        purpose: unitInfo.purpose,
        product: unitInfo.product,
        situation: unitInfo.situation,
        criterios: sourceUnit?.criterios || '{}',
        evidencias: sourceUnit?.evidencias || '{}',
        instrumentos: sourceUnit?.instrumentos || '{}',
        criterios_trans: sourceUnit?.criterios_trans || '{}',
        evidencias_trans: sourceUnit?.evidencias_trans || '{}',
        instrumentos_trans: sourceUnit?.instrumentos_trans || '{}',
        sesiones: JSON.stringify(summaries),
        recursos: sourceUnit?.recursos || '{}',
        bibliografia: sourceUnit?.bibliografia || '{}',
        evaluacion: sourceUnit?.evaluacion || '',
      };
      upsertUnit(unitRec);
    }
  }
})();

const mixedSplitCheck = getRows(`
  SELECT grade, group_concat(DISTINCT section) AS sections
  FROM sesiones
  WHERE area_id=?
  GROUP BY grade
  ORDER BY grade
`, [AREA_ID]);

const countVerification = getRows(`
  SELECT area_id, grade, section, unit_number, COUNT(*) AS total_sesiones
  FROM sesiones
  WHERE area_id=?
    AND unit_number IN ('3','4')
  GROUP BY area_id, grade, section, unit_number
  ORDER BY grade, section, unit_number
`, [AREA_ID]);

const areaGradeSectionValues = getRows(`
  SELECT DISTINCT area_id, grade, section
  FROM sesiones
  WHERE area_id=?
  ORDER BY grade, section
`, [AREA_ID]);

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  restoredFromBackup: true,
  backupPath: path.join(process.env.APPDATA, 'ARMI Docente', 'database', 'armi_backup_antes_correccion.db'),
  databasePath: dbPath,
  noSplitApplied: true,
  noCombinedDeleted: true,
  realAreaGradeSectionValues: areaGradeSectionValues,
  countVerification,
  mixedSplitCheck,
  modifiedSessions,
  createdSessions,
  modifiedUnits,
  finalRows,
}, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: true,
  reportPath,
  modifiedSessions: modifiedSessions.length,
  createdSessions: createdSessions.length,
  modifiedUnits: modifiedUnits.length,
}, null, 2));
