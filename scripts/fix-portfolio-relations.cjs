const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = String.raw`C:\Users\arnol\AppData\Roaming\ARMI Docente\database\armi.db`;
const REPORT_PATH = path.join(__dirname, '..', 'temp', 'crea-emprende-portfolio-fix-report.json');
const AREA_ID = '1774917929135';

const relationMap = {
  '3': {
    '5': '2.3.1 Lean Canvas completo',
    '6': '2.3.1 Lean Canvas completo',
    '7': '2.3.2 Hipótesis falsables por bloque',
    '8': '2.3.3 Plan de validación de hipótesis',
    '9': '2.3.4 Diagrama de Gantt de validación',
    '10': '1.10 Análisis morfológico, 1.16 Análisis estético y 2.4.3 Ampliación de ingresos y crecimiento del negocio',
  },
  '4_10': {
    '1': '2.2.5 Evaluar / 1.14 Análisis del cambio a través del tiempo',
    '2': '2.4.1 Estrategias de captación de clientes',
    '3': '2.4.1 Estrategias de captación de clientes',
    '4': '2.4.2 Estrategias de retención de clientes',
    '5': '2.4.3 Ampliación de ingresos y crecimiento del negocio',
    '6': '1.17 Análisis económico',
    '7': '1.15 Análisis de impacto',
    '8': 'Revisión integral de I Introducción, 1.1 al 1.17 y II Desarrollo de las etapas del proyecto',
    '9': '2.5.1 Análisis grupal del trabajo, 2.5.2 Rueda de retroalimentación y 2.5.3 Desafíos enfrentados y soluciones aplicadas',
    '10': 'Cierre general del portafolio y presentación para Crea y Emprende',
  },
  '4_8': {
    '1': '2.2.5 Evaluar / 1.14 Análisis del cambio a través del tiempo',
    '2': '2.4.1 Estrategias de captación de clientes',
    '3': '2.4.1 Estrategias de captación de clientes y 2.4.2 Estrategias de retención de clientes',
    '4': '2.4.3 Ampliación de ingresos y crecimiento del negocio',
    '5': '1.17 Análisis económico y 1.15 Análisis de impacto',
    '6': 'Revisión integral de I Introducción, 1.1 al 1.17 y II Desarrollo de las etapas del proyecto',
    '7': '2.5.1 Análisis grupal del trabajo, 2.5.2 Rueda de retroalimentación, 2.5.3 Desafíos enfrentados y soluciones aplicadas y 2.5.4 Lecciones aprendidas y mejoras futuras',
    '8': 'Cierre general del portafolio y presentación para Crea y Emprende',
  },
};

function getRelation(unitNumber, sessionNumber, totalSessions) {
  if (unitNumber === '3') return relationMap['3'][sessionNumber];
  if (unitNumber === '4' && totalSessions === 8) return relationMap['4_8'][sessionNumber];
  if (unitNumber === '4' && totalSessions === 10) return relationMap['4_10'][sessionNumber];
  return null;
}

function setRelationText(baseText, relation) {
  const base = String(baseText || '')
    .replace(/\s*Relación con portafolio(?: Crea y Emprende)?:[\s\S]*$/iu, '')
    .replace(/\.{2,}$/g, '.')
    .replace(/[.\s]+$/g, '');
  return `${base}. Relación con portafolio Crea y Emprende: ${relation}.`;
}

function replaceRelationInString(value, relation) {
  if (typeof value !== 'string') return value;
  if (!/Relación con portafolio(?: Crea y Emprende)?:/iu.test(value)) return value;
  const [prefix] = value.split(/Relación con portafolio(?: Crea y Emprende)?:/iu);
  return `${prefix}Relación con portafolio Crea y Emprende: ${relation}.`;
}

function deepReplaceRelation(node, relation) {
  if (typeof node === 'string') return replaceRelationInString(node, relation);
  if (Array.isArray(node)) return node.map((item) => deepReplaceRelation(item, relation));
  if (!node || typeof node !== 'object') return node;

  for (const key of Object.keys(node)) {
    node[key] = deepReplaceRelation(node[key], relation);
  }
  return node;
}

const db = new Database(DB_PATH);
const sessionRows = db.prepare(`
  SELECT id_sesion, grade, section, unit_number, session_number, cantidad_de_sesiones,
         titulo_de_la_sesion, campo_tematico, session_data
  FROM sesiones
  WHERE area_id = ?
    AND (
      (unit_number = '3' AND CAST(session_number AS INTEGER) BETWEEN 5 AND 10) OR
      (unit_number = '4')
    )
  ORDER BY CASE grade WHEN '2do' THEN 2 WHEN '3ro' THEN 3 WHEN '4to' THEN 4 WHEN '5to' THEN 5 ELSE 99 END,
           section,
           CAST(unit_number AS INTEGER),
           CAST(session_number AS INTEGER)
`).all(AREA_ID);

const updateSession = db.prepare(`
  UPDATE sesiones
  SET campo_tematico = ?, session_data = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id_sesion = ?
`);

const unitRows = db.prepare(`
  SELECT id_unidad, grade, section, unit_number, sesiones
  FROM unidades_didacticas
  WHERE area_id = ?
    AND unit_number IN ('3', '4')
`).all(AREA_ID);

const updateUnit = db.prepare(`
  UPDATE unidades_didacticas
  SET sesiones = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id_unidad = ?
`);

const byUnitKey = new Map();
for (const row of sessionRows) {
  const key = `${row.grade}|||${row.section}|||${row.unit_number}`;
  if (!byUnitKey.has(key)) byUnitKey.set(key, []);
  byUnitKey.get(key).push(row);
}

const changed = [];
const tx = db.transaction(() => {
  for (const row of sessionRows) {
    const totalSessions = Number(row.cantidad_de_sesiones) || byUnitKey.get(`${row.grade}|||${row.section}|||${row.unit_number}`).length;
    const relation = getRelation(row.unit_number, row.session_number, totalSessions);
    if (!relation) continue;

    const sessionData = row.session_data ? JSON.parse(row.session_data) : {};
    const newField = setRelationText(row.campo_tematico, relation);

    sessionData.competenciaPrio = sessionData.competenciaPrio || {};
    sessionData.competenciaPrio.field = setRelationText(sessionData.competenciaPrio.field || row.campo_tematico || row.titulo_de_la_sesion, relation);
    sessionData.extension = `Relación con el portafolio Crea y Emprende: ${relation}.`;

    if (sessionData.assessmentModel && Array.isArray(sessionData.assessmentModel.criterios)) {
      sessionData.assessmentModel = deepReplaceRelation(sessionData.assessmentModel, relation);
    }
    if (sessionData.sessionAssessmentModel) {
      sessionData.sessionAssessmentModel = deepReplaceRelation(sessionData.sessionAssessmentModel, relation);
      if (Array.isArray(sessionData.sessionAssessmentModel.rows)) {
        sessionData.sessionAssessmentModel.rows = sessionData.sessionAssessmentModel.rows.map((item) => {
          if (item && typeof item === 'object' && typeof item.fieldText === 'string' && item.fieldText.trim()) {
            item.fieldText = setRelationText(item.fieldText, relation);
          }
          return item;
        });
      }
    }
    if (Array.isArray(sessionData.instrumento)) {
      sessionData.instrumento = deepReplaceRelation(sessionData.instrumento, relation);
    }
    if (sessionData.secuencia) {
      sessionData.secuencia = deepReplaceRelation(sessionData.secuencia, relation);
    }

    updateSession.run(newField, JSON.stringify(sessionData), row.id_sesion);
    changed.push({
      grade: row.grade,
      section: row.section,
      unit: `U${row.unit_number}`,
      session: `S${row.session_number}`,
      title: row.titulo_de_la_sesion,
      relation,
    });
  }

  for (const unit of unitRows) {
    if (!unit.sesiones) continue;
    const items = JSON.parse(unit.sesiones);
    const totalSessions = items.length;
    let touched = false;

    for (const item of items) {
      const relation = getRelation(unit.unit_number, String(item.id), totalSessions);
      if (!relation) continue;
      item.con = setRelationText(item.con || item.title || '', relation);
      touched = true;
    }

    if (touched) {
      updateUnit.run(JSON.stringify(items), unit.id_unidad);
    }
  }
});

tx();

const verifyRows = db.prepare(`
  SELECT grade, section, unit_number, session_number, titulo_de_la_sesion, campo_tematico
  FROM sesiones
  WHERE area_id = ?
    AND (
      (unit_number = '3' AND CAST(session_number AS INTEGER) BETWEEN 5 AND 10) OR
      (unit_number = '4')
    )
  ORDER BY CASE grade WHEN '2do' THEN 2 WHEN '3ro' THEN 3 WHEN '4to' THEN 4 WHEN '5to' THEN 5 ELSE 99 END,
           section,
           CAST(unit_number AS INTEGER),
           CAST(session_number AS INTEGER)
`).all(AREA_ID);

const forbiddenCheck = db.prepare(`
  SELECT COUNT(*) AS total
  FROM sesiones
  WHERE area_id = ?
    AND (
      (unit_number = '3' AND CAST(session_number AS INTEGER) BETWEEN 5 AND 10) OR
      (unit_number = '4')
    )
    AND (
      campo_tematico LIKE '%Sin referencia explícita%' OR
      campo_tematico LIKE '%2.4.4%' OR
      campo_tematico LIKE '%2.4.5%' OR
      campo_tematico LIKE '%2.4.6%' OR
      campo_tematico LIKE '%2.4.7%' OR
      session_data LIKE '%Sin referencia explícita%' OR
      session_data LIKE '%2.4.4%' OR
      session_data LIKE '%2.4.5%' OR
      session_data LIKE '%2.4.6%' OR
      session_data LIKE '%2.4.7%'
    )
`).get(AREA_ID);

const report = {
  updated: changed,
  forbiddenRemaining: forbiddenCheck.total,
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ok: true,
  updated: changed.length,
  forbiddenRemaining: forbiddenCheck.total,
  reportPath: REPORT_PATH,
}, null, 2));
