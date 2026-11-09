import { validateStoredInteractiveActivity } from './interactiveHtml.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

// Append only the imported activity. Never replace the saved lesson with an
// editor snapshot; retries of the same import are idempotent.
export const importSessionActivity = (db, payload) => {
  const { year, areaId, grade, section, unitNumber, sessionNumber, activity, sessionData } = payload || {};
  if (![year, areaId, grade, section, unitNumber, sessionNumber].every(value => typeof value === 'string' && value.trim())) fail('Selecciona una sesión válida antes de importar.');
  if (!validateStoredInteractiveActivity(activity) || typeof activity.id !== 'string' || activity.id.length > 180) fail('El HTML no cumple los requisitos de ARMI.');
  const incoming = {
    id: activity.id, html: activity.html, title: String(activity.title || 'Actividad HTML').slice(0, 180),
    fileName: String(activity.fileName || 'actividad.html').slice(0, 180), criterionId: String(activity.criterionId),
    criterionText: String(activity.criterionText || ''), mode: activity.mode || 'individual', enabled: true,
    importedAt: String(activity.importedAt || new Date().toISOString()).slice(0, 40),
    validation: { valid: true, errors: [], warnings: Array.isArray(activity.validation?.warnings) ? activity.validation.warnings.slice(0, 20).map(value => String(value).slice(0, 500)) : [] }
  };
  const id = `${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`;
  return db.transaction(() => {
    const existing = db.prepare('SELECT id, session_data FROM sesiones WHERE id_sesion = ? LIMIT 1').get(id);
    const data = existing ? JSON.parse(existing.session_data) : { ...(sessionData || {}) };
    const activities = Array.isArray(data.interactiveActivities) ? data.interactiveActivities : [];
    const duplicate = activities.find(item => item.id === incoming.id);
    if (duplicate) {
      if (duplicate.html !== incoming.html || duplicate.criterionId !== incoming.criterionId || (duplicate.mode || 'individual') !== incoming.mode) fail('La actividad ya tiene otra versión guardada. Vuelve a importarla.', 409);
      if (existing) return { sessionId: id, activity: duplicate };
    }
    if (!duplicate && activities.length >= 5) fail('La sesión ya tiene 5 actividades HTML. Guarda la eliminación de alguna antes de importar otra.', 409);
    const model = data.sessionAssessmentModel || {};
    const rows = Array.isArray(model.rows) ? model.rows : [];
    if (!rows.some(row => row.id === incoming.criterionId && row.source !== 'transversal')) {
      const draftModel = sessionData?.sessionAssessmentModel;
      const criterion = (Array.isArray(draftModel?.rows) ? draftModel.rows : []).find(row => row.id === incoming.criterionId && row.source !== 'transversal');
      if (!criterion) fail('No se encontró el criterio de evaluación de esta actividad.');
      if (rows.some(row => row.id === incoming.criterionId)) fail('El criterio de evaluación tiene una identidad incompatible.', 409);
      data.sessionAssessmentModel = { ...(existing ? model : draftModel), rows: [...rows, criterion] };
    }
    data.interactiveActivities = duplicate ? activities : [...activities, incoming];
    if (existing) db.prepare('UPDATE sesiones SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(data), existing.id);
    else db.prepare('INSERT INTO sesiones (id_sesion,year,area_id,grade,section,unit_number,session_number,session_data) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, year, areaId, grade, section, unitNumber, sessionNumber, JSON.stringify(data));
    return { sessionId: id, activity: incoming };
  })();
};
