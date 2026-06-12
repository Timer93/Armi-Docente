const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(process.env.APPDATA, 'ARMI Docente', 'database', 'armi.db');
const reportPath = path.join(process.cwd(), 'temp', 'crea-emprende-db-report.json');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const AREA_ID = '1774917929135';
const AREA_NAME = 'Educación para el Trabajo';
const COMPETENCY = 'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.';
const DEFAULT_INSTRUMENT = 'Rúbrica';

const sectionConfigs = [
  { key: '2do-A', grade: '2do', section: 'A', sourceSection: 'A y B', u4Count: 8, rigor: '2do' },
  { key: '2do-B', grade: '2do', section: 'B', sourceSection: 'A y B', u4Count: 8, rigor: '2do' },
  { key: '3ro-U', grade: '3ro', section: 'U', sourceSection: 'U', u4Count: 10, rigor: '3ro' },
  { key: '4to-U', grade: '4to', section: 'U', sourceSection: 'U', u4Count: 10, rigor: '4to' },
  { key: '5to-A', grade: '5to', section: 'A', sourceSection: 'A y B', u4Count: 9, rigor: '5to' },
  { key: '5to-B', grade: '5to', section: 'B', sourceSection: 'A y B', u4Count: 10, rigor: '5to' },
];

const unitDateMap = {
  '2do-A': {
    3: ['2026-05-25', '2026-05-28', '2026-06-01', '2026-06-04', '2026-06-08', '2026-06-11', '2026-06-15', '2026-06-18', '2026-06-22', '2026-06-25'],
    4: ['2026-06-29', '2026-07-02', '2026-07-06', '2026-07-09', '2026-07-13', '2026-07-16', '2026-07-20', '2026-07-23'],
  },
  '2do-B': {
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
  '5to-A': {
    3: ['2026-05-25', '2026-05-29', '2026-06-01', '2026-06-05', '2026-06-08', '2026-06-12', '2026-06-15', '2026-06-19', '2026-06-22', '2026-06-26'],
    4: ['2026-06-29', '2026-07-03', '2026-07-06', '2026-07-10', '2026-07-13', '2026-07-17', '2026-07-20', '2026-07-24', '2026-07-27'],
  },
  '5to-B': {
    3: ['2026-05-26', '2026-05-27', '2026-06-02', '2026-06-03', '2026-06-09', '2026-06-10', '2026-06-16', '2026-06-17', '2026-06-23', '2026-06-24'],
    4: ['2026-06-30', '2026-07-01', '2026-07-07', '2026-07-08', '2026-07-14', '2026-07-15', '2026-07-21', '2026-07-22', '2026-07-28', '2026-07-29'],
  },
};

const unitSessionPlans = {
  3: [
    { n: 1, keepExisting: true },
    { n: 2, keepExisting: true },
    { n: 3, keepExisting: true },
    { n: 4, keepExisting: true },
    { n: 5, theme: 'u3s5' },
    { n: 6, theme: 'u3s6' },
    { n: 7, theme: 'u3s7' },
    { n: 8, theme: 'u3s8' },
    { n: 9, theme: 'u3s9' },
    { n: 10, theme: 'u3s10' },
  ],
  4: {
    8: ['u4s1', 'u4s2', 'u4s3_2do', 'u4s4_2do', 'u4s5_2do', 'u4s6', 'u4s7_2do', 'u4s8_2do'],
    9: ['u4s1', 'u4s2', 'u4s3', 'u4s4', 'u4s5', 'u4s6_5toA', 'u4s7_5toA', 'u4s8_5toA', 'u4s9_5toA'],
    10: ['u4s1', 'u4s2', 'u4s3', 'u4s4', 'u4s5', 'u4s6', 'u4s7', 'u4s8', 'u4s9', 'u4s10'],
  },
};

const gradeProfiles = {
  '2do': {
    label: 'segundo grado',
    purposeTone: 'con apoyo del docente y organizadores guiados',
    evidenceTone: 'ficha guiada y producto concreto del equipo',
    autonomy: 'Organiza sus tareas con apoyo de una guía simple y cumple acuerdos básicos del equipo.',
    portfolioClose: 'aportando avances claros y comprensibles al portafolio del concurso.',
  },
  '3ro': {
    label: 'tercer grado',
    purposeTone: 'con análisis intermedio y decisiones sustentadas',
    evidenceTone: 'matriz de trabajo y sustento breve del equipo',
    autonomy: 'Organiza acciones y monitorea avances para cumplir metas de la sesión con mayor autonomía.',
    portfolioClose: 'fortaleciendo el portafolio del concurso con evidencias verificables.',
  },
  '4to': {
    label: 'cuarto grado',
    purposeTone: 'con mayor profundidad en validación, análisis y mejora',
    evidenceTone: 'matriz analítica, sustento y decisiones de mejora',
    autonomy: 'Gestiona tiempos, responsables y evidencias para optimizar el proyecto con criterio técnico.',
    portfolioClose: 'con decisiones sustentadas para la presentación al concurso.',
  },
  '5to': {
    label: 'quinto grado',
    purposeTone: 'con exigencia de viabilidad, sustento y proyección para concurso',
    evidenceTone: 'documento técnico y sustentación del equipo',
    autonomy: 'Ajusta estrategias, prioriza riesgos y sustenta decisiones con mirada de viabilidad y concurso.',
    portfolioClose: 'dejando el portafolio listo para su participación en Crea y Emprende.',
  },
};

const normalize = (value) => String(value || '').trim();

const htmlEscape = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const pHtml = (text) => `<p>${htmlEscape(text)}</p>`;
const bulletHtml = (items) => items.map((item) => `<p>• ${htmlEscape(item)}</p>`).join('');
const bulletText = (items) => items.map((item) => `• ${item}`).join('\n');
const listHtml = (items) => `<ul>${items.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul>`;

const clone = (value) => JSON.parse(JSON.stringify(value));

const getRows = (sql, params = []) => db.prepare(sql).all(...params);
const getRow = (sql, params = []) => db.prepare(sql).get(...params);

const sessionRows = getRows(
  `SELECT * FROM sesiones WHERE year='2026' AND area_id=?`,
  [AREA_ID]
);

const unitRows = getRows(
  `SELECT * FROM unidades_didacticas WHERE year='2026' AND area_id=?`,
  [AREA_ID]
);

const sessionByKey = new Map();
for (const row of sessionRows) {
  sessionByKey.set(`${row.grade}|${row.section}|${row.unit_number}|${row.session_number}`, row);
}

const unitByKey = new Map();
for (const row of unitRows) {
  unitByKey.set(`${row.grade}|${row.section}|${row.unit_number}`, row);
}

const genericBaseSessionRow =
  sessionByKey.get('3ro|U|3|5') ||
  sessionRows[0];
const genericBaseSessionData = JSON.parse(genericBaseSessionRow.session_data || '{}');

function getSourceSession(config, unitNumber, sessionNumber) {
  const direct = sessionByKey.get(`${config.grade}|${config.sourceSection}|${unitNumber}|${sessionNumber}`);
  if (direct) return direct;
  if (config.sourceSection !== config.section) {
    const exact = sessionByKey.get(`${config.grade}|${config.section}|${unitNumber}|${sessionNumber}`);
    if (exact) return exact;
  }
  return genericBaseSessionRow;
}

function getSourceUnit(config, unitNumber) {
  const direct = unitByKey.get(`${config.grade}|${config.sourceSection}|${unitNumber}`);
  if (direct) return direct;
  if (config.sourceSection !== config.section) {
    const exact = unitByKey.get(`${config.grade}|${config.section}|${unitNumber}`);
    if (exact) return exact;
  }
  return unitRows[0];
}

function makeThemeCatalog() {
  return {
    u3s5: {
      title: 'Lean Canvas I: problema, segmento de clientes, propuesta de valor y solución',
      portfolio: '2.3.1',
      capacity: 'Crea propuestas de valor',
      field: 'Lean Canvas I: problema, segmento de clientes, propuesta de valor, solución y relación inicial entre necesidad detectada y propuesta.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} formalicen la primera parte del Lean Canvas ${profile.purposeTone}, definiendo con claridad el problema, el segmento de clientes, la propuesta de valor y la solución de su proyecto ${profile.portfolioClose}`,
      evidence: (profile) => `Lean Canvas I completado ${profile.evidenceTone}, con explicación de problema, cliente, propuesta de valor y solución.`,
      criteria: [
        'Identifica con claridad el problema central y el segmento de clientes del proyecto.',
        'Formula una propuesta de valor coherente con la necesidad detectada.',
        'Relaciona la solución con el problema priorizado y el público objetivo.',
        'Presenta el Lean Canvas I de forma ordenada y sustentada.'
      ],
      startQs: ['¿Qué problema del usuario estamos priorizando realmente?', '¿Nuestra propuesta de valor responde a una necesidad específica o aún es muy general?'],
      steps: ['Revisan la información recogida en empatía, definición y testeo previo.', 'Completan los bloques problema, segmento de clientes, propuesta de valor y solución.', 'Sustentan sus decisiones con ejemplos del contexto y retroalimentación del equipo.'],
      apply: 'El equipo elabora una versión visible del Lean Canvas I y explica cómo cada bloque aporta al portafolio del concurso.',
      closeQs: ['¿Qué bloque fue más difícil de definir y por qué?', '¿Qué debemos mejorar antes de completar el resto del Lean Canvas?'],
      transCriterion: 'Organiza la información del Lean Canvas en un archivo o plantilla digital de manera clara y recuperable.',
      teamworkCriterion: 'Dialoga con su equipo para consensuar el problema priorizado y la propuesta de valor.'
    },
    u3s6: {
      title: 'Lean Canvas II: canales, ingresos, costos, métricas clave y ventaja especial',
      portfolio: '2.3.1',
      capacity: 'Crea propuestas de valor',
      field: 'Lean Canvas II: canales, ingresos, costos, métricas clave, ventaja especial y articulación comercial del proyecto.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} completen la segunda parte del Lean Canvas ${profile.purposeTone}, definiendo canales, fuentes de ingreso, costos, métricas clave y ventaja especial del proyecto ${profile.portfolioClose}`,
      evidence: (profile) => `Lean Canvas II completado ${profile.evidenceTone}, con justificación de canales, ingresos, costos, métricas y ventaja especial.`,
      criteria: [
        'Selecciona canales adecuados para llegar al segmento de clientes.',
        'Relaciona ingresos y costos con la propuesta de valor del proyecto.',
        'Define métricas clave y una ventaja especial coherente con la solución.',
        'Integra los bloques del Lean Canvas II con lógica comercial básica.'
      ],
      startQs: ['¿Por qué ese canal sería el más adecuado para contactar a nuestros clientes?', '¿Qué diferencia real tiene nuestra propuesta frente a otras opciones del entorno?'],
      steps: ['Retoman la primera parte del Lean Canvas para asegurar coherencia.', 'Completan los bloques de canales, ingresos, costos, métricas clave y ventaja especial.', 'Contrastan si los bloques financieros y comerciales son viables para su grado y contexto.'],
      apply: 'Organizan el Lean Canvas completo en una plantilla lista para incorporarse al portafolio de Crea y Emprende.',
      closeQs: ['¿Qué bloque comercial requiere más validación?', '¿Qué dato todavía debemos comprobar con usuarios o posibles clientes?'],
      transCriterion: 'Gestiona una plantilla digital del Lean Canvas integrando texto, tablas y observaciones.',
      teamworkCriterion: 'Asigna responsabilidades para sustentar cada bloque del modelo de negocio.'
    },
    u3s7: {
      title: 'Hipótesis falsables por bloque del Lean Canvas',
      portfolio: '2.3.2',
      capacity: 'Crea propuestas de valor',
      field: 'Hipótesis falsables de problema, cliente, solución, canales, ingresos, costos, métricas y ventaja especial.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} formulen hipótesis falsables por bloque del Lean Canvas ${profile.purposeTone}, priorizando aquellas que necesitan comprobar antes de avanzar con el portafolio ${profile.portfolioClose}`,
      evidence: (profile) => `Matriz de hipótesis falsables ${profile.evidenceTone}, priorizadas por nivel de riesgo e impacto.`,
      criteria: [
        'Formula hipótesis verificables a partir de los bloques del Lean Canvas.',
        'Diferencia hipótesis de problema, cliente, solución, ingresos y costos.',
        'Redacta hipótesis comprobables con usuarios o datos reales.',
        'Prioriza las hipótesis críticas del proyecto.'
      ],
      startQs: ['¿Qué estamos dando por cierto sin haberlo comprobado todavía?', '¿Qué afirmación del Lean Canvas podría hacer fallar el proyecto si no se valida?'],
      steps: ['Identifican supuestos clave de cada bloque del Lean Canvas.', 'Transforman los supuestos en hipótesis falsables con estructura clara.', 'Priorizan las hipótesis según riesgo, urgencia y posibilidad de validación.'],
      apply: 'El equipo construye una matriz de hipótesis y decide cuáles validará primero para fortalecer el portafolio.',
      closeQs: ['¿Cuál es la hipótesis más crítica del proyecto?', '¿Qué evidencia nos permitirá decir que una hipótesis fue confirmada o descartada?'],
      transCriterion: 'Registra las hipótesis en una matriz digital clara y ordenada.',
      teamworkCriterion: 'Argumenta con su equipo por qué una hipótesis es más crítica que otra.'
    },
    u3s8: {
      title: 'Plan de validación de hipótesis',
      portfolio: '2.3.3',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Plan de validación: técnicas, responsables, usuarios, recursos, evidencias y secuencia de validación de hipótesis.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} diseñen un plan de validación de hipótesis ${profile.purposeTone}, organizando técnicas, responsables, recursos y evidencias para comprobar el modelo de negocio ${profile.portfolioClose}`,
      evidence: (profile) => `Plan de validación ${profile.evidenceTone}, con hipótesis, técnica, muestra, responsables, fechas y evidencia esperada.`,
      criteria: [
        'Selecciona técnicas adecuadas para validar las hipótesis priorizadas.',
        'Organiza responsables, usuarios, recursos y fechas de trabajo.',
        'Respeta el orden de validación: problema y cliente, solución y luego viabilidad.',
        'Propone evidencias verificables de la validación.'
      ],
      startQs: ['¿Qué técnica conviene usar para cada hipótesis?', '¿Cómo evitaremos validar todo al mismo tiempo sin orden ni criterios?'],
      steps: ['Relacionan cada hipótesis priorizada con una técnica de validación.', 'Definen muestra, responsables, recursos y evidencia esperada.', 'Revisan si la secuencia permite validar primero lo más crítico.'],
      apply: 'Elaboran un plan de validación listo para ser anexado al portafolio y ejecutado por el equipo.',
      closeQs: ['¿Qué parte del plan necesita mayor precisión?', '¿Qué riesgo puede aparecer al aplicar este plan y cómo lo prevenimos?'],
      transCriterion: 'Organiza la planificación en tablas o formatos digitales comprensibles para el equipo.',
      teamworkCriterion: 'Distribuye responsabilidades y acuerdos para ejecutar la validación.'
    },
    u3s9: {
      title: 'Diagrama de Gantt de validación',
      portfolio: '2.3.4',
      capacity: 'Trabaja cooperativamente para lograr objetivos y metas',
      field: 'Diagrama de Gantt de validación: actividades, tiempos, responsables, recursos e hitos del proceso de validación.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} organicen el cronograma de validación en un diagrama de Gantt ${profile.purposeTone}, distribuyendo actividades, responsables y tiempos para ejecutar el plan de validación ${profile.portfolioClose}`,
      evidence: (profile) => `Diagrama de Gantt de validación ${profile.evidenceTone}, con tareas, fechas, responsables e hitos.`,
      criteria: [
        'Organiza las actividades en una secuencia temporal lógica.',
        'Asigna fechas, responsables y recursos de manera realista.',
        'Relaciona cada actividad con la hipótesis que se validará.',
        'Presenta el cronograma de forma clara y utilizable por el equipo.'
      ],
      startQs: ['¿Qué tarea debe realizarse primero para no retrasar la validación?', '¿Cómo sabemos si el cronograma es realista para nuestro equipo?'],
      steps: ['Revisan el plan de validación y determinan tareas clave.', 'Construyen el Gantt con actividades, tiempos, responsables y evidencias.', 'Ajustan el cronograma para que sea realista y medible.'],
      apply: 'Cada equipo presenta su Gantt y lo deja listo para integrar al portafolio del concurso.',
      closeQs: ['¿Qué actividad representa el mayor riesgo de retraso?', '¿Qué acuerdo de equipo garantiza que el cronograma sí se cumpla?'],
      transCriterion: 'Representa el cronograma en una herramienta digital o plantilla organizada.',
      teamworkCriterion: 'Coordina con el equipo el reparto de tiempos, funciones y compromisos.'
    },
    u3s10: {
      title: 'Identidad visual del proyecto: marca, logo, logotipo, isotipo/imagotipo, colores, tipografía y justificación estética',
      portfolio: '1.10, 1.16 y 2.4.3',
      capacity: 'Aplica habilidades técnicas',
      field: 'Identidad visual: marca, logo, logotipo, isotipo, imagotipo, colores, tipografía, estilo gráfico y justificación estética del proyecto.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} diseñen o mejoren la identidad visual de su emprendimiento ${profile.purposeTone}, justificando nombre visual, recursos gráficos y decisiones estéticas para fortalecer el portafolio ${profile.portfolioClose}`,
      evidence: (profile) => `Propuesta de identidad visual ${profile.evidenceTone}, con marca, logo o variante gráfica, paleta, tipografía y justificación estética.`,
      criteria: [
        'Diseña o mejora el nombre visual del emprendimiento con coherencia.',
        'Diferencia logo, logotipo, isotipo, imagotipo o isologo según corresponda.',
        'Selecciona colores y tipografías coherentes con el público objetivo.',
        'Justifica la identidad visual en relación con la propuesta de valor.'
      ],
      startQs: ['¿Nuestra imagen comunica realmente lo que ofrece el proyecto?', '¿Cómo influye el público objetivo en la elección de colores y tipografías?'],
      steps: ['Analizan referentes visuales y diferencian tipos de marca gráfica.', 'Diseñan o mejoran logo, logotipo o imagotipo con paleta y tipografía.', 'Redactan la justificación estética vinculada al proyecto y al cliente.'],
      apply: 'Presentan una ficha de identidad visual lista para incorporarse al portafolio y a materiales promocionales.',
      closeQs: ['¿Qué decisión visual fue la más importante y por qué?', '¿Qué mejorarían de la identidad visual antes de la presentación final?'],
      transCriterion: 'Usa herramientas digitales para producir un recurso gráfico claro y bien organizado.',
      teamworkCriterion: 'Escucha y negocia propuestas visuales hasta llegar a una decisión común del equipo.'
    },
    u4s1: {
      title: 'Revisión y mejora del producto/prototipo según validación',
      portfolio: '2.4.1',
      capacity: 'Aplica habilidades técnicas',
      field: 'Mejora del producto o prototipo a partir de resultados de validación, observaciones de usuarios y ajustes funcionales.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} revisen y mejoren su producto o prototipo ${profile.purposeTone}, aplicando ajustes sustentados en la validación previa para dejarlo más listo para concurso ${profile.portfolioClose}`,
      evidence: (profile) => `Versión mejorada del producto o prototipo ${profile.evidenceTone}, con registro de cambios realizados según validación.`,
      criteria: [
        'Identifica mejoras necesarias a partir de la validación previa.',
        'Aplica ajustes funcionales o visuales coherentes con la retroalimentación recibida.',
        'Justifica los cambios realizados en el producto o prototipo.',
        'Presenta una versión mejorada con registro de decisiones.'
      ],
      startQs: ['¿Qué observación de los usuarios exige un cambio inmediato?', '¿Qué mejora genera mayor valor para el cliente?'],
      steps: ['Revisan la retroalimentación obtenida en la validación.', 'Priorizan ajustes de forma, función, presentación o uso.', 'Implementan mejoras y documentan qué cambió y por qué.'],
      apply: 'El equipo actualiza su producto o prototipo y registra la mejora para incorporarla al portafolio.',
      closeQs: ['¿Qué mejora generó el mayor impacto?', '¿Qué aspecto del producto todavía requiere prueba adicional?'],
      transCriterion: 'Documenta el antes y después del prototipo en formato digital o fotográfico.',
      teamworkCriterion: 'Coordina tareas de mejora y valida acuerdos con el equipo.'
    },
    u4s2: {
      title: 'Estrategias de captación de clientes con técnica AIDA',
      portfolio: '2.4.2',
      capacity: 'Crea propuestas de valor',
      field: 'Captación de clientes con técnica AIDA: atención, interés, deseo y acción en mensajes promocionales.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} diseñen estrategias de captación de clientes utilizando la técnica AIDA ${profile.purposeTone}, alineando mensaje, segmento y canal de difusión ${profile.portfolioClose}`,
      evidence: (profile) => `Pieza o guion de captación con técnica AIDA ${profile.evidenceTone}, orientado al segmento de clientes.`,
      criteria: [
        'Aplica la técnica AIDA en un mensaje promocional coherente.',
        'Relaciona la estrategia de captación con el segmento de clientes.',
        'Selecciona canales adecuados para difundir el mensaje.',
        'Sustenta cómo la propuesta busca atraer al cliente.'
      ],
      startQs: ['¿Qué debe captar primero la atención del cliente?', '¿Cómo pasamos del interés a una acción concreta de compra o contacto?'],
      steps: ['Analizan la lógica de Atención, Interés, Deseo y Acción.', 'Redactan mensajes y eligen un canal apropiado para su cliente.', 'Revisan si el contenido realmente persuade y conduce a una acción.'],
      apply: 'El equipo elabora una pieza promocional o guion AIDA para integrarlo al portafolio y a su campaña.',
      closeQs: ['¿Qué parte del mensaje fue más persuasiva?', '¿Qué acción concreta esperamos del cliente?'],
      transCriterion: 'Produce un recurso digital breve con estructura persuasiva y ordenada.',
      teamworkCriterion: 'Contrasta ideas del equipo para elegir el mensaje más convincente.'
    },
    u4s3: {
      title: 'Video promocional, redes sociales y difusión por WhatsApp',
      portfolio: '2.4.3',
      capacity: 'Aplica habilidades técnicas',
      field: 'Promoción digital: video breve, redes sociales, difusión por WhatsApp y consistencia con la identidad visual del proyecto.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} diseñen recursos de promoción digital ${profile.purposeTone}, integrando video breve, redes sociales y difusión por WhatsApp con identidad visual coherente ${profile.portfolioClose}`,
      evidence: (profile) => `Storyboard, guion o pieza de video promocional ${profile.evidenceTone}, con propuesta de publicación en redes y WhatsApp.`,
      criteria: [
        'Diseña un recurso promocional coherente con la identidad visual del proyecto.',
        'Adapta el mensaje a video, redes sociales o WhatsApp según el canal.',
        'Organiza la información comercial con claridad y pertinencia.',
        'Presenta una propuesta lista para difundirse o prototiparse.'
      ],
      startQs: ['¿Qué mensaje debe mantenerse igual en todos los canales?', '¿Qué cambia cuando difundimos por video, red social o WhatsApp?'],
      steps: ['Definen el mensaje central y el formato del recurso promocional.', 'Organizan guion, storyboard o pieza visual para redes y WhatsApp.', 'Revisan coherencia entre identidad visual, llamada a la acción y cliente objetivo.'],
      apply: 'El equipo entrega su propuesta de difusión digital para adjuntarla al portafolio y preparar la presentación final.',
      closeQs: ['¿Qué canal comunica mejor la propuesta del proyecto?', '¿Qué ajuste haríamos para mejorar la claridad del mensaje?'],
      transCriterion: 'Crea un archivo digital organizado para video, publicación o mensaje de difusión.',
      teamworkCriterion: 'Coordina producción, redacción y revisión del material promocional.'
    },
    u4s3_2do: {
      title: 'Video promocional, redes sociales, WhatsApp y retención de clientes',
      portfolio: '2.4.3 y 2.4.4',
      capacity: 'Aplica habilidades técnicas',
      field: 'Promoción digital y primeras acciones de retención: video, redes sociales, WhatsApp, seguimiento y trato al cliente.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} articulen difusión digital y acciones simples de retención ${profile.purposeTone}, usando video, redes, WhatsApp y mensajes de seguimiento al cliente ${profile.portfolioClose}`,
      evidence: (profile) => `Propuesta de difusión y retención ${profile.evidenceTone}, con pieza digital y mensaje de seguimiento al cliente.`,
      criteria: [
        'Diseña un recurso de difusión claro para video, red o WhatsApp.',
        'Propone una acción sencilla de seguimiento o retención del cliente.',
        'Relaciona la difusión con el público objetivo del proyecto.',
        'Presenta una propuesta organizada y viable para el equipo.'
      ],
      startQs: ['¿Cómo seguimos comunicándonos con el cliente después del primer contacto?', '¿Qué mensaje breve puede motivar a volver o recomendar el producto?'],
      steps: ['Definen una pieza de difusión y un mensaje de seguimiento.', 'Diferencian acciones de promoción y retención para el cliente.', 'Integran ambos componentes en una propuesta breve y ordenada.'],
      apply: 'El equipo presenta una propuesta combinada de difusión y retención para el portafolio.',
      closeQs: ['¿Qué parte de la propuesta ayudará a mantener clientes?', '¿Qué canal es más cercano para nuestro público?'],
      transCriterion: 'Organiza materiales digitales simples para difusión y seguimiento.',
      teamworkCriterion: 'Aporta ideas y acuerdos para una comunicación responsable con el cliente.'
    },
    u4s4: {
      title: 'Estrategias de retención de clientes',
      portfolio: '2.4.4',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Retención de clientes: seguimiento, beneficios, experiencia del usuario, mensajes personalizados e indicadores de fidelización.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} propongan estrategias de retención de clientes ${profile.purposeTone}, relacionando experiencia del usuario, seguimiento y fidelización ${profile.portfolioClose}`,
      evidence: (profile) => `Plan breve de retención ${profile.evidenceTone}, con acciones, mensajes y un indicador simple de fidelización.`,
      criteria: [
        'Propone acciones concretas para mantener clientes.',
        'Diseña mensajes, beneficios o seguimiento acordes al usuario.',
        'Relaciona la retención con la experiencia del cliente.',
        'Plantea un indicador simple para medir fidelización.'
      ],
      startQs: ['¿Por qué un cliente volvería a elegir nuestro proyecto?', '¿Qué experiencia queremos que recuerde después de usar nuestro producto o servicio?'],
      steps: ['Analizan comportamientos de clientes y posibles acciones de seguimiento.', 'Diseñan mensajes, beneficios o mecanismos simples de fidelización.', 'Eligen un indicador básico para comprobar si la estrategia funciona.'],
      apply: 'El equipo integra una estrategia de retención al portafolio con foco en experiencia del usuario.',
      closeQs: ['¿Qué acción de retención es la más viable para nuestro contexto?', '¿Cómo sabremos si la estrategia funcionó?'],
      transCriterion: 'Registra la propuesta en una ficha digital clara y fácil de compartir.',
      teamworkCriterion: 'Escucha retroalimentación del equipo para mejorar la experiencia del cliente.'
    },
    u4s4_2do: {
      title: 'Ampliación de ingresos y crecimiento del negocio',
      portfolio: '2.4.5',
      capacity: 'Crea propuestas de valor',
      field: 'Crecimiento del negocio: nuevas formas de ingreso, mejoras de oferta y expansión simple del emprendimiento.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} planteen formas sencillas de ampliar ingresos y hacer crecer el negocio ${profile.purposeTone}, sin perder coherencia con la propuesta de valor ${profile.portfolioClose}`,
      evidence: (profile) => `Ficha de crecimiento e ingresos ${profile.evidenceTone}, con al menos dos opciones de mejora o ampliación.`,
      criteria: [
        'Propone alternativas viables para ampliar ingresos.',
        'Relaciona el crecimiento con la propuesta de valor y el cliente.',
        'Justifica qué mejora conviene implementar primero.',
        'Presenta sus ideas con orden y claridad.'
      ],
      startQs: ['¿Cómo podríamos vender más sin perder la esencia del proyecto?', '¿Qué mejora o servicio adicional podría interesar a nuestros clientes?'],
      steps: ['Analizan formas de ampliar ingresos o mejorar la oferta.', 'Comparan alternativas y eligen las más viables para su contexto.', 'Organizan la propuesta de crecimiento con ejemplos concretos.'],
      apply: 'El equipo incorpora una propuesta simple de crecimiento al portafolio del proyecto.',
      closeQs: ['¿Qué opción de crecimiento es la más realista?', '¿Qué necesitaríamos para ponerla en práctica?'],
      transCriterion: 'Organiza ideas de crecimiento en un esquema visual o digital.',
      teamworkCriterion: 'Participa en la toma de decisiones sobre prioridades de mejora.'
    },
    u4s5: {
      title: 'Ampliación de ingresos y crecimiento del negocio',
      portfolio: '2.4.5',
      capacity: 'Crea propuestas de valor',
      field: 'Escalamiento del negocio: ampliación de ingresos, nuevas líneas, alianzas, mejoras de oferta y crecimiento sostenible.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} diseñen alternativas de crecimiento ${profile.purposeTone}, evaluando cómo ampliar ingresos y sostener el negocio con mayor proyección ${profile.portfolioClose}`,
      evidence: (profile) => `Propuesta de crecimiento ${profile.evidenceTone}, con alternativas de ingreso, mejora o expansión del negocio.`,
      criteria: [
        'Propone acciones viables para ampliar ingresos o escalar el negocio.',
        'Relaciona la estrategia de crecimiento con el cliente y la propuesta de valor.',
        'Justifica riesgos y oportunidades de la alternativa elegida.',
        'Presenta una propuesta coherente y sostenible.'
      ],
      startQs: ['¿Qué opción de crecimiento agrega valor sin desordenar el proyecto?', '¿Qué riesgos debemos prever antes de ampliar ingresos?'],
      steps: ['Analizan opciones de crecimiento, diversificación o ampliación.', 'Evalúan oportunidades, riesgos y recursos necesarios.', 'Priorizan la alternativa más conveniente para el proyecto.'],
      apply: 'El equipo incorpora su estrategia de crecimiento al portafolio como proyección del negocio.',
      closeQs: ['¿Qué crecimiento es sostenible para nuestra realidad?', '¿Qué indicador mostraría que la estrategia funcionó?'],
      transCriterion: 'Usa esquemas o tablas digitales para comparar opciones de crecimiento.',
      teamworkCriterion: 'Negocia prioridades y justifica la alternativa elegida frente al equipo.'
    },
    u4s5_2do: {
      title: 'Análisis económico e impacto del proyecto',
      portfolio: '2.4.6 y 2.4.7',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Análisis económico e impacto: costos básicos, ingresos, beneficio simple e impacto social, ambiental y económico.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} realicen un análisis económico e impacto del proyecto ${profile.purposeTone}, identificando costos, ingresos y beneficios para la comunidad ${profile.portfolioClose}`,
      evidence: (profile) => `Ficha de análisis económico e impacto ${profile.evidenceTone}, con costos básicos, ingresos estimados e impacto del proyecto.`,
      criteria: [
        'Reconoce costos e ingresos básicos del proyecto.',
        'Explica el beneficio económico y el aporte del proyecto al entorno.',
        'Relaciona el impacto social o ambiental con la propuesta de valor.',
        'Presenta la información de manera clara y comprensible.'
      ],
      startQs: ['¿Qué ganamos y qué invertimos en nuestro proyecto?', '¿Qué efecto positivo puede generar en la comunidad o el ambiente?'],
      steps: ['Registran costos e ingresos básicos del proyecto.', 'Identifican beneficios y posibles impactos en el entorno.', 'Organizan la información económica y de impacto en una ficha simple.'],
      apply: 'El equipo incorpora su análisis económico e impacto al portafolio del concurso.',
      closeQs: ['¿Qué dato económico necesitamos revisar mejor?', '¿Qué impacto positivo podemos mostrar con más claridad?'],
      transCriterion: 'Ordena datos básicos en tablas simples o formatos digitales guiados.',
      teamworkCriterion: 'Se apoya en su equipo para comprender y explicar los datos del proyecto.'
    },
    u4s6: {
      title: 'Análisis económico: costos, ingresos, inversión y punto de equilibrio',
      portfolio: '2.4.6',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Análisis económico: costos, ingresos, inversión, margen y punto de equilibrio del proyecto.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} elaboren el análisis económico del proyecto ${profile.purposeTone}, relacionando costos, ingresos, inversión y punto de equilibrio para sustentar su viabilidad ${profile.portfolioClose}`,
      evidence: (profile) => `Cuadro de análisis económico ${profile.evidenceTone}, con costos, ingresos, inversión y punto de equilibrio.`,
      criteria: [
        'Organiza costos, ingresos e inversión de manera coherente.',
        'Explica la relación entre costos, ingresos y punto de equilibrio.',
        'Sustenta la viabilidad económica con datos básicos o proyectados.',
        'Presenta el análisis con claridad y orden.'
      ],
      startQs: ['¿En qué momento el proyecto deja de perder y empieza a sostenerse?', '¿Qué costo tiene mayor impacto en nuestra viabilidad?'],
      steps: ['Recopilan datos de costos, ingresos e inversión.', 'Construyen un cuadro económico con interpretación del punto de equilibrio.', 'Revisan si la proyección es coherente con el modelo de negocio.'],
      apply: 'El equipo integra su análisis económico al portafolio con una explicación breve de viabilidad.',
      closeQs: ['¿Qué dato económico necesita validarse mejor?', '¿Qué decisión tomaríamos para mejorar la sostenibilidad financiera?'],
      transCriterion: 'Usa tablas u hojas de cálculo para organizar datos económicos del proyecto.',
      teamworkCriterion: 'Coordina la revisión de datos y sustenta decisiones con el equipo.'
    },
    u4s6_5toA: {
      title: 'Análisis económico e impacto del proyecto',
      portfolio: '2.4.6 y 2.4.7',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Análisis económico e impacto integrado: costos, ingresos, inversión, sostenibilidad y efectos sociales, ambientales y económicos.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} integren el análisis económico e impacto del proyecto ${profile.purposeTone}, sustentando viabilidad, sostenibilidad y aporte al entorno ${profile.portfolioClose}`,
      evidence: (profile) => `Informe integrado de análisis económico e impacto ${profile.evidenceTone}, con datos, interpretación y conclusiones.`,
      criteria: [
        'Relaciona costos, ingresos e inversión con la viabilidad del proyecto.',
        'Analiza el impacto social, ambiental y económico de la propuesta.',
        'Sustenta conclusiones con información organizada y pertinente.',
        'Presenta un informe breve con coherencia y claridad.'
      ],
      startQs: ['¿Qué tan viable es el proyecto y qué valor aporta al entorno?', '¿Cómo demostramos que nuestro emprendimiento no solo vende, sino que también genera impacto?'],
      steps: ['Sintetizan información económica del proyecto.', 'Relacionan la viabilidad con impacto social, ambiental y económico.', 'Redactan conclusiones breves para el portafolio.'],
      apply: 'El equipo deja listo un informe integrado para la sección económica e impacto del portafolio.',
      closeQs: ['¿Qué argumento fortalece más la sustentación del proyecto?', '¿Qué dato falta para que la conclusión sea más sólida?'],
      transCriterion: 'Integra datos y conclusiones en un documento digital técnico y ordenado.',
      teamworkCriterion: 'Sostiene decisiones del equipo con argumentos y evidencias.'
    },
    u4s7: {
      title: 'Análisis de impacto: social, ambiental y económico',
      portfolio: '2.4.7',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Análisis de impacto social, ambiental y económico del emprendimiento y su sostenibilidad.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} analicen el impacto social, ambiental y económico del proyecto ${profile.purposeTone}, demostrando cómo la propuesta genera valor en su entorno ${profile.portfolioClose}`,
      evidence: (profile) => `Matriz de impacto ${profile.evidenceTone}, con indicadores y conclusiones sobre el proyecto.`,
      criteria: [
        'Identifica efectos sociales, ambientales y económicos del proyecto.',
        'Relaciona los impactos con la propuesta de valor y el contexto.',
        'Propone indicadores simples o criterios para valorar el impacto.',
        'Presenta conclusiones coherentes sobre sostenibilidad.'
      ],
      startQs: ['¿Qué cambia en la comunidad si nuestro proyecto funciona?', '¿Cómo evitamos que el proyecto genere efectos negativos no previstos?'],
      steps: ['Definen dimensiones de impacto y revisan evidencias del proyecto.', 'Construyen indicadores o criterios para valorar resultados.', 'Redactan conclusiones de sostenibilidad y mejora.'],
      apply: 'Integran la matriz de impacto al portafolio y la preparan para la sustentación final.',
      closeQs: ['¿Qué impacto destaca más en nuestro proyecto?', '¿Qué ajuste futuro mejoraría el triple impacto?'],
      transCriterion: 'Organiza indicadores y conclusiones en una matriz digital clara.',
      teamworkCriterion: 'Contrasta perspectivas del equipo para construir una conclusión compartida.'
    },
    u4s7_2do: {
      title: 'Evaluación final: rueda de retroalimentación, desafíos, soluciones y mejoras',
      portfolio: 'Cierre',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Evaluación final del proyecto: logros, dificultades, retroalimentación, desafíos, soluciones y mejoras.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} evalúen de manera final su proyecto ${profile.purposeTone}, reconociendo logros, desafíos y mejoras antes de la presentación al concurso ${profile.portfolioClose}`,
      evidence: (profile) => `Rueda de retroalimentación y ficha de mejoras ${profile.evidenceTone}, con acuerdos finales del equipo.`,
      criteria: [
        'Analiza logros, dificultades y soluciones del proyecto.',
        'Participa en una rueda de retroalimentación con respeto y claridad.',
        'Registra lecciones aprendidas y mejoras finales.',
        'Presenta acuerdos del equipo para la presentación final.'
      ],
      startQs: ['¿Qué fue lo mejor logrado por el equipo?', '¿Qué desafío todavía debemos resolver antes de presentar?'],
      steps: ['Desarrollan una rueda de retroalimentación entre equipos o dentro del equipo.', 'Registran logros, desafíos, soluciones y mejoras finales.', 'Priorizan acuerdos concretos para la presentación.'],
      apply: 'El equipo organiza una ficha de evaluación final con mejoras antes del cierre del portafolio.',
      closeQs: ['¿Qué mejora es imprescindible antes de presentar?', '¿Qué aprendizaje no debemos olvidar del proceso?'],
      transCriterion: 'Registra la retroalimentación de forma ordenada en una ficha o documento digital.',
      teamworkCriterion: 'Escucha, dialoga y acuerda mejoras con respeto dentro del equipo.'
    },
    u4s8: {
      title: 'Revisión integral del portafolio',
      portfolio: 'Cierre de portafolio',
      capacity: 'Trabaja cooperativamente para lograr objetivos y metas',
      field: 'Revisión integral del portafolio: coherencia, orden, evidencias, anexos y calidad de presentación.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} revisen integralmente su portafolio ${profile.purposeTone}, verificando coherencia, evidencias y calidad de presentación antes del cierre ${profile.portfolioClose}`,
      evidence: (profile) => `Portafolio revisado ${profile.evidenceTone}, con lista de verificación y ajustes finales.`,
      criteria: [
        'Verifica que el portafolio contenga las secciones y evidencias necesarias.',
        'Corrige incoherencias entre texto, anexos y producto.',
        'Organiza el documento con orden, limpieza y claridad.',
        'Coordina con el equipo la revisión final del material.'
      ],
      startQs: ['¿Qué parte del portafolio aún está débil o incompleta?', '¿Qué evidencia necesitamos ordenar mejor para la presentación?'],
      steps: ['Usan una lista de cotejo para revisar cada parte del portafolio.', 'Corrigen incoherencias entre Lean Canvas, validación, identidad visual y anexos.', 'Dejan la versión revisada lista para la presentación.'],
      apply: 'El equipo consolida el portafolio con todos sus anexos y evidencias organizadas.',
      closeQs: ['¿Qué ajuste mejoró más la calidad del portafolio?', '¿Qué evidencia final necesitamos destacar al presentar?'],
      transCriterion: 'Gestiona archivos, anexos y evidencias digitales con estructura clara.',
      teamworkCriterion: 'Distribuye y cumple tareas de revisión final del portafolio.'
    },
    u4s7_5toA: {
      title: 'Revisión integral del portafolio',
      portfolio: 'Cierre de portafolio',
      capacity: 'Trabaja cooperativamente para lograr objetivos y metas',
      field: 'Revisión integral del portafolio: coherencia, evidencias, anexos, calidad de presentación y consistencia para concurso.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} revisen integralmente su portafolio ${profile.purposeTone}, asegurando coherencia técnica, evidencias completas y calidad de presentación antes de la evaluación final ${profile.portfolioClose}`,
      evidence: (profile) => `Portafolio revisado integralmente ${profile.evidenceTone}, con lista de verificación, correcciones y acuerdos de cierre.`,
      criteria: [
        'Verifica que el portafolio contenga secciones, anexos y evidencias necesarias.',
        'Corrige incoherencias entre texto, anexos, producto y validación.',
        'Organiza el documento con calidad de presentación y sustento técnico.',
        'Coordina la revisión final del material con responsabilidad.'
      ],
      startQs: ['¿Qué parte del portafolio necesita mayor consistencia antes de la evaluación final?', '¿Qué evidencia o anexo todavía no convence del todo?'],
      steps: ['Aplican una lista de verificación rigurosa al portafolio completo.', 'Corrigen relación entre Lean Canvas, hipótesis, validación, análisis económico e impacto.', 'Ajustan anexos, evidencias y presentación final del documento.'],
      apply: 'El equipo deja una versión integral revisada del portafolio, lista para pasar a evaluación final y presentación.',
      closeQs: ['¿Qué corrección fortaleció más la calidad del portafolio?', '¿Qué parte del documento quedó más lista para un jurado externo?'],
      transCriterion: 'Gestiona anexos, archivos y evidencias digitales con estructura técnica y fácil consulta.',
      teamworkCriterion: 'Coordina la revisión final del portafolio distribuyendo tareas con responsabilidad.'
    },
    u4s8_2do: {
      title: 'Presentación final: producto/prototipo y portafolio listo para Crea y Emprende',
      portfolio: 'Presentación final',
      capacity: 'Trabaja cooperativamente para lograr objetivos y metas',
      field: 'Presentación final del proyecto: producto o prototipo, portafolio organizado y comunicación del emprendimiento.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} presenten su producto o prototipo y su portafolio final ${profile.purposeTone}, demostrando que su proyecto está listo para Crea y Emprende ${profile.portfolioClose}`,
      evidence: (profile) => `Presentación final del producto y portafolio ${profile.evidenceTone}, con sustentación breve del equipo.`,
      criteria: [
        'Presenta el producto o prototipo con claridad.',
        'Explica las partes principales del portafolio del proyecto.',
        'Participa de manera organizada en la sustentación del equipo.',
        'Demuestra que el proyecto quedó listo para el concurso.'
      ],
      startQs: ['¿Qué parte del proyecto debemos mostrar primero para captar atención?', '¿Cómo explicamos el portafolio de manera sencilla y ordenada?'],
      steps: ['Organizan el orden de exposición del producto y del portafolio.', 'Ensayan una presentación breve con apoyo del docente y del equipo.', 'Presentan y reciben retroalimentación final.'],
      apply: 'El equipo deja cerrada la presentación final con producto, prototipo y portafolio listos para el concurso.',
      closeQs: ['¿Qué hicimos bien al presentar?', '¿Qué mejoraríamos si volviéramos a exponer?'],
      transCriterion: 'Ordena materiales y recursos digitales para apoyar la presentación.',
      teamworkCriterion: 'Asume con responsabilidad su rol dentro de la exposición final.'
    },
    u4s8_5toA: {
      title: 'Evaluación final: rueda de retroalimentación, desafíos, soluciones y mejoras',
      portfolio: 'Cierre',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Evaluación final del proyecto: retroalimentación crítica, desafíos, soluciones, mejoras y proyección de concurso.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} desarrollen una evaluación final integral ${profile.purposeTone}, identificando mejoras finales antes de la presentación del concurso ${profile.portfolioClose}`,
      evidence: (profile) => `Acta de evaluación final ${profile.evidenceTone}, con retroalimentación, desafíos, soluciones y mejoras.`,
      criteria: [
        'Analiza con profundidad logros, dificultades y decisiones del proyecto.',
        'Participa en la rueda de retroalimentación con argumentos y apertura a mejora.',
        'Formula mejoras finales realistas para el concurso.',
        'Organiza acuerdos de cierre del equipo.'
      ],
      startQs: ['¿Qué reto sigue siendo el más sensible antes del concurso?', '¿Qué retroalimentación debemos tomar en serio para mejorar la presentación?'],
      steps: ['Realizan una rueda de retroalimentación crítica.', 'Registran desafíos, soluciones, aprendizajes y ajustes finales.', 'Priorizan acuerdos de mejora para el cierre del proyecto.'],
      apply: 'El equipo deja lista su acta de evaluación final como antesala de la presentación definitiva.',
      closeQs: ['¿Qué mejora final sí cambia la calidad del proyecto?', '¿Qué aprendizaje demuestra mayor madurez del equipo?'],
      transCriterion: 'Sintetiza la retroalimentación en un documento técnico breve.',
      teamworkCriterion: 'Conduce acuerdos y compromisos de mejora con responsabilidad.'
    },
    u4s9: {
      title: 'Evaluación final: rueda de retroalimentación, desafíos y soluciones',
      portfolio: 'Cierre',
      capacity: 'Evalúa los resultados del proyecto de emprendimiento',
      field: 'Evaluación final del proyecto: logros, retroalimentación, desafíos, soluciones y aprendizajes del proceso.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} realicen la evaluación final del proyecto ${profile.purposeTone}, valorando logros, desafíos y soluciones antes de la presentación final ${profile.portfolioClose}`,
      evidence: (profile) => `Registro de evaluación final ${profile.evidenceTone}, con retroalimentación, desafíos y soluciones acordadas.`,
      criteria: [
        'Analiza logros, dificultades y soluciones del proyecto.',
        'Participa en una rueda de retroalimentación con argumentos claros.',
        'Registra aprendizajes y mejoras futuras.',
        'Sustenta por qué el proyecto está listo o qué falta ajustar.'
      ],
      startQs: ['¿Qué evidencia demuestra mejor el aprendizaje logrado?', '¿Qué desafío todavía puede afectar nuestra presentación final?'],
      steps: ['Conducen una rueda de retroalimentación y autoevaluación.', 'Registran aprendizajes, desafíos y soluciones de cierre.', 'Definen mejoras finales de forma puntual.'],
      apply: 'El equipo deja documentada su evaluación final como parte del portafolio y la preparación para sustentar.',
      closeQs: ['¿Qué aprendizaje fue más valioso?', '¿Qué mejora final no podemos postergar?'],
      transCriterion: 'Organiza conclusiones y acuerdos de manera clara en un archivo de cierre.',
      teamworkCriterion: 'Escucha, argumenta y acuerda soluciones con responsabilidad.'
    },
    u4s9_5toA: {
      title: 'Presentación final: producto/prototipo y portafolio listo para Crea y Emprende',
      portfolio: 'Presentación final',
      capacity: 'Trabaja cooperativamente para lograr objetivos y metas',
      field: 'Presentación final del proyecto para concurso: producto o prototipo, portafolio consolidado y sustentación del equipo.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} realicen la presentación final del producto o prototipo y del portafolio ${profile.purposeTone}, demostrando preparación real para participar en Crea y Emprende ${profile.portfolioClose}`,
      evidence: (profile) => `Presentación final del proyecto ${profile.evidenceTone}, con sustentación del portafolio y del producto.`,
      criteria: [
        'Expone el producto o prototipo con claridad y dominio.',
        'Sustenta las secciones clave del portafolio con coherencia.',
        'Coordina una presentación ordenada y convincente como equipo.',
        'Demuestra preparación para la participación en el concurso.'
      ],
      startQs: ['¿Qué argumento sintetiza mejor el valor de nuestro proyecto?', '¿Qué evidencia del portafolio debemos mostrar para convencer al jurado?'],
      steps: ['Ordenan la exposición final del producto, del portafolio y de los anexos clave.', 'Ensayan una sustentación breve con foco en claridad y persuasión.', 'Presentan la versión final y reciben observaciones de cierre.'],
      apply: 'El equipo culmina la presentación final con producto y portafolio listos para el concurso.',
      closeQs: ['¿Qué aspecto de la sustentación resultó más sólido?', '¿Qué reforzaríamos antes de un jurado externo?'],
      transCriterion: 'Integra recursos digitales y anexos de apoyo para una exposición profesional.',
      teamworkCriterion: 'Coordina la sustentación final distribuyendo roles de manera efectiva.'
    },
    u4s10: {
      title: 'Presentación final: producto/prototipo y portafolio listo para Crea y Emprende',
      portfolio: 'Presentación final',
      capacity: 'Trabaja cooperativamente para lograr objetivos y metas',
      field: 'Presentación final del proyecto: demostración del producto o prototipo, portafolio completo y sustentación para concurso.',
      purpose: (profile) => `Que los estudiantes de ${profile.label} presenten de manera final su producto o prototipo y su portafolio completo ${profile.purposeTone}, evidenciando que su propuesta está lista para participar en Crea y Emprende ${profile.portfolioClose}`,
      evidence: (profile) => `Presentación final integral ${profile.evidenceTone}, con producto, portafolio y sustentación del equipo.`,
      criteria: [
        'Presenta el producto o prototipo con dominio y claridad.',
        'Sustenta el portafolio completo con coherencia y evidencias.',
        'Organiza la exposición final de forma articulada y convincente.',
        'Demuestra preparación real para el concurso.'
      ],
      startQs: ['¿Qué evidencia muestra mejor el recorrido completo del proyecto?', '¿Cómo distribuimos la sustentación para que sea clara y convincente?'],
      steps: ['Preparan producto, portafolio, anexos y roles de exposición.', 'Ensayan la sustentación integrando validación, identidad visual, análisis económico e impacto.', 'Presentan la versión final como simulación de concurso.'],
      apply: 'El equipo culmina la unidad con producto y portafolio listos para Crea y Emprende.',
      closeQs: ['¿Qué parte de la presentación nos representó mejor como equipo?', '¿Qué aprendizaje se evidencia en el portafolio final?'],
      transCriterion: 'Integra recursos, anexos y soportes digitales con criterio de presentación.',
      teamworkCriterion: 'Asume con responsabilidad su rol y fortalece la cohesión de la exposición final.'
    }
  };
}

const themes = makeThemeCatalog();

function buildTransversalRows(theme, profile, config, unitNumber, sessionNumber) {
  return [
    {
      id: 'transversal-1',
      source: 'transversal',
      competencyName: 'Se desenvuelve en los entornos virtuales generados por las TIC',
      capacityName: 'Gestiona información del entorno virtual',
      criterionText: theme.transCriterion,
      rowType: 'criterion',
      performanceText: pHtml(theme.transCriterion),
      evidenceText: pHtml(`Archivo o evidencia digital organizado de la sesión ${sessionNumber}.`),
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
      criterionText: profile.autonomy,
      rowType: 'criterion',
      performanceText: pHtml(profile.autonomy),
      evidenceText: pHtml(`Registro de acuerdos, autoevaluación o mejora del equipo para la sesión ${sessionNumber}.`),
      fieldText: '',
      instrumentLabel: DEFAULT_INSTRUMENT,
      rowColor: '#00b28c',
      order: 3,
    },
  ];
}

function levelDescriptors(base) {
  return {
    c: `Reconoce el tema de ${base} de manera inicial, pero aún requiere apoyo constante para organizar sus ideas y evidencias.`,
    b: `Desarrolla ${base} con avances parciales y cierta coherencia, aunque todavía necesita precisar o sustentar mejor algunos elementos.`,
    a: `Desarrolla ${base} con claridad, coherencia y relación directa con el portafolio y el proyecto emprendedor.`,
    ad: `Desarrolla ${base} con alto nivel de precisión, sustento y criterio de mejora, mostrando preparación para Crea y Emprende.`,
  };
}

function buildSessionData(baseData, config, unitNumber, sessionNumber, date, themeKey, keepExistingRow) {
  const profile = gradeProfiles[config.grade];
  const theme = themes[themeKey];
  const next = clone(baseData || genericBaseSessionData);

  if (!theme) {
    if (keepExistingRow) {
      next.date = date;
      return next;
    }
    throw new Error(`No theme configured for ${themeKey}`);
  }

  const primaryDescriptors = levelDescriptors(theme.title.toLowerCase());
  const primaryCriterion = theme.criteria[0];
  const teamworkCriterion = theme.teamworkCriterion;

  next.title = theme.title;
  next.purpose = theme.purpose(profile);
  next.situation = `Los estudiantes de ${profile.label} se encuentran organizando y cerrando el portafolio del Concurso Nacional Crea y Emprende. Para participar con mayores posibilidades de éxito, necesitan fortalecer la coherencia entre su producto o prototipo, el modelo de negocio, la validación, la identidad visual y la sustentación final del proyecto. En esta sesión, avanzarán una parte clave del portafolio vinculada a ${theme.title.toLowerCase()}.`;
  next.dateChangeMotive = '';
  next.date = date;
  next.competenciaPrio = {
    comp: COMPETENCY,
    cap: theme.capacity,
    des: bulletHtml(theme.criteria),
    field: `${theme.field} Relación con portafolio Crea y Emprende: ${theme.portfolio}.`,
    evidence: pHtml(theme.evidence(profile)),
    inst: DEFAULT_INSTRUMENT,
  };
  next.competenciasTrans = [
    {
      comp: 'Se desenvuelve en los entornos virtuales generados por las TIC',
      cap: 'Gestiona información del entorno virtual',
      des: pHtml(theme.transCriterion),
      field: '',
      evidence: pHtml(`Archivo o evidencia digital organizado de la sesión ${sessionNumber}.`),
      inst: DEFAULT_INSTRUMENT,
      rowColor: '#007c59',
    },
    {
      comp: 'Gestiona su aprendizaje de manera autónoma',
      cap: 'Organiza acciones estratégicas para alcanzar sus metas de aprendizaje.',
      des: pHtml(profile.autonomy),
      field: '',
      evidence: pHtml(`Registro de acuerdos, autoevaluación o mejora del equipo para la sesión ${sessionNumber}.`),
      inst: DEFAULT_INSTRUMENT,
      rowColor: '#00b28c',
    },
  ];
  next.enfoqueTrans = next.enfoqueTrans || {
    enfoque: 'Enfoque búsqueda de la Excelencia',
    valor: 'Superación personal y responsabilidad',
    acciones: 'Disposición para mejorar el producto, el portafolio y el trabajo colaborativo a partir de la retroalimentación.',
    demuestra: 'Docentes y estudiantes revisan, ajustan y fortalecen sus evidencias antes de la presentación final.',
  };
  next.secuencia = {
    inicio: {
      saberes: bulletHtml([
        'El docente saluda, recoge saberes previos y conecta la sesión con el avance del portafolio de Crea y Emprende.',
        theme.startQs[0],
        theme.startQs[1],
      ]),
      saberes_recursos: listHtml(['Pizarra', 'Plumones', 'Portafolio en proceso', 'Anexos de sesiones anteriores']),
      conflicto: pHtml(`Se plantea el reto de la sesión: ${theme.title}. El equipo deberá demostrar que este avance mejora la calidad y coherencia del proyecto antes de la presentación final.`),
      conflicto_recursos: listHtml(['Expresión oral', 'Trabajo colaborativo']),
      tiempo: "10'",
    },
    proceso: {
      construccion: bulletHtml(theme.steps),
      construccion_recursos: listHtml(['PC o laptop', 'Plantillas de trabajo', 'Portafolio del equipo', 'Cuaderno de campo']),
      aplicacion: bulletHtml([
        theme.apply,
        `El docente acompaña el trabajo del equipo, brinda retroalimentación y verifica la relación con el portafolio (${theme.portfolio}).`,
      ]),
      aplicacion_recursos: listHtml(['Anexo de trabajo', 'Instrumento de evaluación', 'Observación del docente']),
      metacognicion: bulletHtml(theme.closeQs),
      metacognicion_recursos: listHtml(['Cuaderno', 'Expresión oral']),
      tiempo: "65'",
    },
    salida: {
      evaluacion: pHtml(`El docente evalúa el desarrollo de la sesión mediante ${DEFAULT_INSTRUMENT.toLowerCase()}, verifica los criterios priorizados y orienta ajustes finales para fortalecer el portafolio del proyecto.`),
      evaluacion_recursos: listHtml([DEFAULT_INSTRUMENT, 'Retroalimentación oral']),
      tiempo: "15'",
    },
  };
  next.extension = `Relación con el portafolio Crea y Emprende: ${theme.portfolio}.`;
  next.recursos = next.recursos || {
    materiales: '> Pizarra.\n> Plumones.\n> PC o laptop.\n> Acceso a archivos del portafolio.',
    medios: '✓ Plantillas digitales.\n✓ Portafolio del proyecto.',
    actividades: '❖ Trabajo en equipo.\n❖ Revisión y ajuste de evidencias.',
    espacios: '> Aula.\n> Centro de cómputo.',
  };
  next.bibliografia = next.bibliografia || {
    libros: '📚 Ministerio de Educación. Currículo Nacional de la Educación Básica.',
    links: '🌐 Materiales de apoyo de Crea y Emprende.',
  };

  const instrumentTemplate = clone(next.instrumentoTemplate || genericBaseSessionData.instrumentoTemplate || {});
  if (instrumentTemplate && !instrumentTemplate.name) instrumentTemplate.name = 'Rubrica Analitica - General';
  next.instrumentoTemplate = instrumentTemplate;

  const transRows = buildTransversalRows(theme, profile, config, unitNumber, sessionNumber);
  const primaryRow = {
    id: 'primary-1',
    source: 'primary',
    competencyName: COMPETENCY,
    capacityName: theme.capacity,
    criterionText: primaryCriterion,
    rowType: 'criterion',
    levelDescriptors: primaryDescriptors,
    performanceText: pHtml(primaryCriterion),
    evidenceText: pHtml(theme.evidence(profile)),
    fieldText: `${theme.field} Relación con portafolio: ${theme.portfolio}.`,
    instrumentLabel: DEFAULT_INSTRUMENT,
    order: 1,
  };

  next.assessmentModel = {
    competencia: COMPETENCY,
    capacidades: [theme.capacity],
    criterios: [
      { id: '1', text: `• ${primaryCriterion}`, capacidad: theme.capacity, rowType: 'criterion' },
    ],
    source: 'system',
  };
  next.sessionAssessmentModel = {
    version: 1,
    instrument: {
      type: 'rubrica',
      name: instrumentTemplate?.name || 'Rubrica Analitica - General',
      templateId: instrumentTemplate?.id || null,
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
    rows: [primaryRow, ...transRows],
  };

  next.instrumento = [
    {
      id: 'primary-1',
      competencia: COMPETENCY,
      capacidad: theme.capacity,
      criterio: primaryCriterion,
      ...primaryDescriptors,
      source: 'primary',
      rowColor: '',
    },
    {
      id: 'transversal-1',
      competencia: 'Se desenvuelve en los entornos virtuales generados por las TIC',
      capacidad: 'Gestiona información del entorno virtual',
      criterio: theme.transCriterion,
      ...levelDescriptors('la organización digital de las evidencias de la sesión'),
      source: 'transversal',
      rowColor: '#007c59',
    },
    {
      id: 'transversal-2',
      competencia: 'Gestiona su aprendizaje de manera autónoma',
      capacidad: 'Organiza acciones estratégicas para alcanzar sus metas de aprendizaje.',
      criterio: profile.autonomy,
      ...levelDescriptors('la organización autónoma de acciones y evidencias'),
      source: 'transversal',
      rowColor: '#00b28c',
    },
    {
      id: 'primary-2',
      competencia: COMPETENCY,
      capacidad: 'Trabaja cooperativamente para lograr objetivos y metas',
      criterio: teamworkCriterion,
      ...levelDescriptors('la coordinación del trabajo cooperativo del equipo'),
      source: 'primary',
      rowColor: '',
    },
  ];

  return next;
}

function buildUnitSessionSummary(sessionData, config, sessionNumber, date) {
  return {
    id: sessionNumber,
    date,
    title: sessionData.title,
    cap: '',
    des: bulletText((sessionData.competenciaPrio?.des || '').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.replace(/&nbsp;/g, ' ').replace(/•/g, '').trim()).filter(Boolean).slice(0, 4)),
    con: sessionData.competenciaPrio?.field || '',
    evi: (sessionData.competenciaPrio?.evidence || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    eval: sessionData.competenciaPrio?.inst || DEFAULT_INSTRUMENT,
    competencia: COMPETENCY,
    transversales: (sessionData.competenciasTrans || []).map((item) => item.comp),
    capacidades: [sessionData.competenciaPrio?.cap].concat((sessionData.competenciasTrans || []).map((item) => item.cap)).filter(Boolean),
    criteriaItems: (Array.isArray(sessionData.instrumento) ? sessionData.instrumento : []).slice(0, 4).map((row) => ({
      text: `• ${row.criterio}`,
      color: row.rowColor ? `text-[${row.rowColor}]` : 'text-black',
    })),
    evidenceItems: [
      {
        text: `• ${(sessionData.competenciaPrio?.evidence || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`,
        color: 'text-black',
      }
    ],
    fechasPorSeccion: [`${config.grade} ${config.section} (${date})`],
    selectedCriteriaTexts: (Array.isArray(sessionData.instrumento) ? sessionData.instrumento : []).slice(0, 1).map((row) => row.criterio),
    selectedEvidenceIds: [`session-${sessionNumber}-0`],
  };
}

function buildUnitTexts(config, unitNumber) {
  const profile = gradeProfiles[config.grade];
  if (unitNumber === 3) {
    return {
      title: `Formalizamos el modelo de negocio y la validación del proyecto para fortalecer el portafolio de Crea y Emprende.`,
      purpose: `Que los estudiantes de ${profile.label} consoliden el modelo de negocio de su emprendimiento, formulen hipótesis, organicen su validación y fortalezcan la identidad visual del proyecto para dejar avances formales del portafolio de Crea y Emprende.`,
      product: `Portafolio intermedio con Lean Canvas completo, matriz de hipótesis, plan y cronograma de validación, e identidad visual del proyecto.`,
      situation: `Los equipos ya han explorado necesidades, prototipado y recibido retroalimentación inicial. Ahora necesitan formalizar sus hallazgos y organizar evidencias para que su proyecto avance con coherencia hacia el Concurso Nacional Crea y Emprende.`,
    };
  }
  return {
    title: `Cerramos el proyecto emprendedor y dejamos listo el portafolio final para Crea y Emprende.`,
    purpose: `Que los estudiantes de ${profile.label} culminen su proyecto de emprendimiento revisando producto o prototipo, estrategias comerciales, análisis económico e impacto, evaluación final y presentación del portafolio para participar en Crea y Emprende.`,
    product: `Producto o prototipo mejorado, portafolio completo, estrategias de difusión y cierre, análisis económico e impacto, y presentación final del proyecto.`,
    situation: `Los equipos se encuentran en la etapa final de preparación para Crea y Emprende. Necesitan integrar las evidencias generadas durante el proceso, cerrar vacíos del portafolio y preparar una presentación convincente del proyecto.`,
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
    year=@year,
    area_id=@area_id,
    grade=@grade,
    section=@section,
    unit_number=@unit_number,
    session_number=@session_number,
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
    year=@year,
    area_id=@area_id,
    grade=@grade,
    section=@section,
    unit_number=@unit_number,
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

function sessionRecordFromData(config, unitNumber, sessionNumber, date, sessionData) {
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
    producto_de_sesion: (sessionData.competenciaPrio?.evidence || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
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

function unitRecordFromData(config, unitNumber, sourceUnit, unitTexts, summaries) {
  return {
    id_unidad: `2026-${AREA_ID}-${config.grade}-${config.section}-U${unitNumber}`,
    year: '2026',
    area_id: AREA_ID,
    grade: config.grade,
    section: config.section,
    unit_number: String(unitNumber),
    title: unitTexts.title,
    purpose: unitTexts.purpose,
    product: unitTexts.product,
    situation: unitTexts.situation,
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
}

const modifiedSessions = [];
const createdSessions = [];
const modifiedUnits = [];
const deletedCombinedIds = [];
const finalRows = [];

function upsertSession(record) {
  const existing = getRow(`SELECT id_sesion FROM sesiones WHERE id_sesion=?`, [record.id_sesion]);
  if (existing) {
    updateSessionStmt.run(record);
    modifiedSessions.push(record.id_sesion);
  } else {
    insertSessionStmt.run(record);
    createdSessions.push(record.id_sesion);
  }
}

function upsertUnit(record) {
  const existing = getRow(`SELECT id_unidad FROM unidades_didacticas WHERE id_unidad=?`, [record.id_unidad]);
  if (existing) {
    updateUnitStmt.run(record);
  } else {
    insertUnitStmt.run(record);
  }
  modifiedUnits.push(record.id_unidad);
}

const transaction = db.transaction(() => {
  for (const sectionConfig of sectionConfigs) {
    for (const unitNumber of [3, 4]) {
      const dates = unitDateMap[sectionConfig.key][unitNumber];
      const sourceUnit = getSourceUnit(sectionConfig, unitNumber === 4 ? 3 : unitNumber);
      const unitTexts = buildUnitTexts(sectionConfig, unitNumber);
      const summaries = [];
      const sessionPlans = unitNumber === 3
        ? unitSessionPlans[3]
        : unitSessionPlans[4][sectionConfig.u4Count].map((theme, idx) => ({ n: idx + 1, theme }));

      for (const plan of sessionPlans) {
        const sessionNumber = plan.n;
        const date = dates[sessionNumber - 1];
        const sourceRow = getSourceSession(sectionConfig, unitNumber === 4 ? 3 : unitNumber, Math.min(sessionNumber, 6));
        const sourceData = JSON.parse(sourceRow?.session_data || JSON.stringify(genericBaseSessionData));
        const sessionData = plan.keepExisting
          ? buildSessionData(sourceData, sectionConfig, unitNumber, sessionNumber, date, null, true)
          : buildSessionData(sourceData, sectionConfig, unitNumber, sessionNumber, date, plan.theme, false);

        const sessionRecord = sessionRecordFromData(sectionConfig, unitNumber, sessionNumber, date, sessionData);
        upsertSession(sessionRecord);

        const summary = buildUnitSessionSummary(sessionData, sectionConfig, sessionNumber, date);
        summaries.push(summary);
        finalRows.push({
          grado: sectionConfig.grade,
          seccion: sectionConfig.section,
          unidad: unitNumber,
          sesion: sessionNumber,
          titulo: sessionData.title,
          campo_tematico: sessionData.competenciaPrio?.field || '',
          evidencia: (sessionData.competenciaPrio?.evidence || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          relacion_portafolio: themes[plan.theme]?.portfolio || 'Se mantiene avance previo',
        });
      }

      const unitRecord = unitRecordFromData(sectionConfig, unitNumber, sourceUnit, unitTexts, summaries);
      upsertUnit(unitRecord);
    }
  }

  const combinedDeletes = [
    { grade: '2do', section: 'A y B', unit: '3' },
    { grade: '5to', section: 'A y B', unit: '3' },
  ];

  for (const target of combinedDeletes) {
    const ids = getRows(
      `SELECT id_sesion FROM sesiones WHERE year='2026' AND area_id=? AND grade=? AND section=? AND unit_number=?`,
      [AREA_ID, target.grade, target.section, target.unit]
    );
    db.prepare(`DELETE FROM sesiones WHERE year='2026' AND area_id=? AND grade=? AND section=? AND unit_number=?`)
      .run(AREA_ID, target.grade, target.section, target.unit);
    db.prepare(`DELETE FROM unidades_didacticas WHERE year='2026' AND area_id=? AND grade=? AND section=? AND unit_number=?`)
      .run(AREA_ID, target.grade, target.section, target.unit);
    ids.forEach((item) => deletedCombinedIds.push(item.id_sesion));
  }
});

transaction();

const countVerification = getRows(`
  SELECT grade AS grado, section AS seccion, unit_number AS unidad, COUNT(*) AS total_sesiones
  FROM sesiones
  WHERE year='2026'
    AND area_id=?
    AND grade IN ('2do','3ro','4to','5to')
    AND section IN ('A','B','U')
    AND unit_number IN ('3','4')
  GROUP BY grade, section, unit_number
  ORDER BY grade, section, unit_number
`, [AREA_ID]);

const topicChecks = [
  'Lean Canvas I',
  'Lean Canvas II',
  'Hipótesis falsables',
  'Plan de validación',
  'Diagrama de Gantt de validación',
  'Identidad visual',
  'técnica AIDA',
  'retención',
  'Análisis económico',
  'Análisis de impacto',
  'Evaluación final',
  'Presentación final'
].map((label) => {
  let pattern = label;
  if (label === 'técnica AIDA') pattern = 'AIDA';
  const total = getRow(`
    SELECT COUNT(*) AS total
    FROM sesiones
    WHERE year='2026'
      AND area_id=?
      AND unit_number IN ('3','4')
      AND json_extract(session_data, '$.title') LIKE ?
  `, [AREA_ID, `%${pattern}%`]).total;
  return { tema: label, total };
});

const detectedTables = getRows(`
  SELECT name
  FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).map((row) => row.name);

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  database: dbPath,
  backup: path.join(process.env.APPDATA, 'ARMI Docente', 'database', 'armi_backup_antes_correccion.db'),
  detectedTables,
  modifiedSessions,
  createdSessions,
  modifiedUnits,
  deletedCombinedIds,
  countVerification,
  topicChecks,
  finalRows,
  notes: [
    'La base original del proyecto en la carpeta de trabajo no contenía las tablas reales; se trabajó sobre la base activa instalada en AppData.',
    'Las secciones combinadas "2do A y B" y "5to A y B" solo se separaron en U3 y U4 para cumplir la planificación solicitada.',
    'No se encontraron tablas independientes llamadas actividades, instrumentos, criterios o propósitos para sesiones; esos datos están principalmente en session_data y, en menor medida, en columnas espejo de la tabla sesiones.'
  ]
}, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: true,
  reportPath,
  modifiedSessions: modifiedSessions.length,
  createdSessions: createdSessions.length,
  modifiedUnits: modifiedUnits.length,
  deletedCombinedIds: deletedCombinedIds.length,
}, null, 2));
