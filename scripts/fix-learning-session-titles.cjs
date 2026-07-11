const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(process.env.APPDATA, 'ARMI Docente', 'database', 'armi.db');
const reportPath = path.join(process.cwd(), 'temp', 'crea-emprende-title-fix-report.json');
const AREA_ID = '1774917929135';

const db = new Database(dbPath, { timeout: 20000 });
db.pragma('busy_timeout = 20000');

const configs = [
  { grade: '2do', section: 'A y B', u4Count: 8, profile: 'segundo grado' },
  { grade: '3ro', section: 'U', u4Count: 10, profile: 'tercer grado' },
  { grade: '4to', section: 'U', u4Count: 10, profile: 'cuarto grado' },
  { grade: '5to', section: 'A y B', u4Count: 10, profile: 'quinto grado' },
];

const titleMaps = {
  3: {
    5: 'Construimos el Lean Canvas inicial identificando el problema, los clientes, la propuesta de valor y la solución',
    6: 'Completamos el Lean Canvas organizando canales, ingresos, costos, métricas clave y ventaja especial',
    7: 'Formulamos hipótesis falsables del modelo de negocio usando los bloques del Lean Canvas',
    8: 'Diseñamos el plan de validación de hipótesis considerando usuarios, técnicas, responsables y evidencias',
    9: 'Elaboramos el diagrama de Gantt de validación organizando actividades, fechas y responsables',
    10: 'Diseñamos la identidad visual del emprendimiento aplicando criterios de marca, logotipo, colores y tipografía',
  },
  4: {
    10: {
      1: 'Mejoramos el producto o prototipo incorporando los resultados de la validación con usuarios',
      2: 'Elaboramos estrategias de captación de clientes aplicando la técnica AIDA',
      3: 'Creamos materiales de difusión del emprendimiento usando video, redes sociales y WhatsApp',
      4: 'Diseñamos estrategias de retención de clientes fortaleciendo la experiencia del usuario',
      5: 'Proponemos acciones de crecimiento del negocio mediante nuevos productos, canales o aliados',
      6: 'Analizamos la viabilidad económica del emprendimiento calculando costos, ingresos e inversión',
      7: 'Evaluamos el impacto social, ambiental y económico del emprendimiento en la comunidad',
      8: 'Revisamos integralmente el portafolio organizando evidencias y apartados del proyecto',
      9: 'Reflexionamos sobre el trabajo en equipo identificando logros, dificultades y soluciones',
      10: 'Presentamos el producto y portafolio final sustentando la propuesta para Crea y Emprende',
    },
    8: {
      1: 'Mejoramos el producto o prototipo incorporando los resultados de la validación con usuarios',
      2: 'Elaboramos estrategias de captación de clientes aplicando la técnica AIDA',
      3: 'Creamos materiales de difusión y retención usando video, redes sociales, WhatsApp y mensajes personalizados',
      4: 'Proponemos acciones de crecimiento del negocio mediante nuevos productos, canales o aliados',
      5: 'Analizamos la viabilidad e impacto del emprendimiento calculando costos, ingresos y beneficios para la comunidad',
      6: 'Revisamos integralmente el portafolio organizando evidencias y apartados del proyecto',
      7: 'Reflexionamos sobre el trabajo en equipo identificando logros, dificultades, soluciones y mejoras',
      8: 'Presentamos el producto y portafolio final sustentando la propuesta para Crea y Emprende',
    }
  }
};

const directPurpose = (profile, title) =>
  `Que los estudiantes de ${profile} desarrollen la sesión "${title}" fortaleciendo la coherencia entre el producto o prototipo, las evidencias del equipo y el portafolio de Crea y Emprende.`;

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function p(text) {
  const safe = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${safe}</p>`;
}

function replaceDeep(value, from, to) {
  if (typeof value === 'string') {
    return value.split(from).join(to);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceDeep(item, from, to));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = replaceDeep(v, from, to);
    }
    return out;
  }
  return value;
}

function getTargetTitle(config, unitNumber, sessionNumber) {
  if (unitNumber === 3) return titleMaps[3][sessionNumber] || null;
  return titleMaps[4][config.u4Count]?.[sessionNumber] || null;
}

const rows = db.prepare(`
  SELECT *
  FROM sesiones
  WHERE area_id = ?
    AND unit_number IN ('3','4')
  ORDER BY grade, section, CAST(unit_number AS INTEGER), CAST(session_number AS INTEGER)
`).all(AREA_ID);

const rowByKey = new Map(rows.map((row) => [`${row.grade}|${row.section}|${row.unit_number}|${row.session_number}`, row]));

const updateSession = db.prepare(`
  UPDATE sesiones SET
    titulo_de_la_sesion = ?,
    proposito_de_sesion = ?,
    campo_tematico = ?,
    producto_de_sesion = ?,
    session_data = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id_sesion = ?
`);

const updateUnit = db.prepare(`
  UPDATE unidades_didacticas SET
    sesiones = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id_unidad = ?
`);

const changed = [];

db.transaction(() => {
  for (const config of configs) {
    const unitSummaries = db.prepare(`
      SELECT id_unidad, unit_number, sesiones
      FROM unidades_didacticas
      WHERE area_id = ? AND grade = ? AND section = ? AND unit_number IN ('3','4')
      ORDER BY CAST(unit_number AS INTEGER)
    `).all(AREA_ID, config.grade, config.section);

    for (const row of rows.filter((r) => r.grade === config.grade && r.section === config.section)) {
      const unitNumber = Number(row.unit_number);
      const sessionNumber = Number(row.session_number);
      if (unitNumber === 3 && sessionNumber < 5) continue;

      const newTitle = getTargetTitle(config, unitNumber, sessionNumber);
      if (!newTitle) continue;

      const sessionData = JSON.parse(row.session_data || '{}');
      const oldTitle = String(sessionData.title || row.titulo_de_la_sesion || '').trim();
      let nextData = replaceDeep(sessionData, oldTitle, newTitle);
      nextData.title = newTitle;
      nextData.titulo = newTitle;
      nextData.purpose = directPurpose(config.profile, newTitle);
      nextData.proposito = directPurpose(config.profile, newTitle);

      if (nextData.competenciaPrio && typeof nextData.competenciaPrio === 'object') {
        const currentField = String(nextData.competenciaPrio.field || '');
        if (currentField.startsWith(oldTitle)) {
          nextData.competenciaPrio.field = currentField.replace(oldTitle, newTitle);
        }
        const currentEvidence = stripHtml(nextData.competenciaPrio.evidence || '');
        if (currentEvidence.startsWith(oldTitle)) {
          nextData.competenciaPrio.evidence = p(currentEvidence.replace(oldTitle, newTitle));
        }
      }

      if (Array.isArray(nextData.instrumento)) {
        nextData.instrumento = nextData.instrumento.map((item) => replaceDeep(item, oldTitle, newTitle));
      }

      if (nextData.sessionAssessmentModel && Array.isArray(nextData.sessionAssessmentModel.rows)) {
        nextData.sessionAssessmentModel = replaceDeep(nextData.sessionAssessmentModel, oldTitle, newTitle);
      }

      const field = String(nextData.competenciaPrio?.field || row.campo_tematico || '');
      const evidence = stripHtml(nextData.competenciaPrio?.evidence || row.producto_de_sesion || '');
      const purpose = String(nextData.purpose || row.proposito_de_sesion || '');

      updateSession.run(
        newTitle,
        purpose,
        field,
        evidence,
        JSON.stringify(nextData),
        row.id_sesion
      );

      changed.push({
        id_sesion: row.id_sesion,
        grade: row.grade,
        section: row.section,
        unit_number: row.unit_number,
        session_number: row.session_number,
        title: newTitle,
        campo_tematico: field,
        evidencia: evidence,
      });
    }

    for (const unit of unitSummaries) {
      const parsed = JSON.parse(unit.sesiones || '[]');
      const next = parsed.map((item) => {
        const unitNumber = Number(unit.unit_number);
        const sessionNumber = Number(item.id || 0);
        if (unitNumber === 3 && sessionNumber < 5) return item;
        const newTitle = getTargetTitle(config, unitNumber, sessionNumber);
        if (!newTitle) return item;
        const oldTitle = String(item.title || '');
        const out = replaceDeep(item, oldTitle, newTitle);
        out.title = newTitle;
        return out;
      });
      updateUnit.run(JSON.stringify(next), unit.id_unidad);
    }
  }
})();

const verification = db.prepare(`
  SELECT grade, section, unit_number, session_number,
         titulo_de_la_sesion,
         json_extract(session_data,'$.title') AS json_title,
         proposito_de_sesion,
         json_extract(session_data,'$.purpose') AS json_purpose
  FROM sesiones
  WHERE area_id = ?
    AND unit_number IN ('3','4')
    AND CAST(session_number AS INTEGER) >= 5
  ORDER BY grade, section, CAST(unit_number AS INTEGER), CAST(session_number AS INTEGER)
`).all(AREA_ID);

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({ changed, verification }, null, 2), 'utf8');

console.log(JSON.stringify({
  ok: true,
  changed: changed.length,
  reportPath
}, null, 2));
