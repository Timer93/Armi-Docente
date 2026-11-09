import { buildUnitSessionPlanning, mergeUnitSessionPlanning } from './shared/unitSessionPlanning.js';
import { reconcileSessionCapacities } from './shared/sessionCapacityReconciliation.js';

const parse = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
export const decodePlanningUnit = (row) => row ? {
  ...row, criterios: parse(row.criterios, {}), evidencias: parse(row.evidencias, {}), instrumentos: parse(row.instrumentos, {}),
  criteriosTrans: parse(row.criterios_trans, {}), evidenciasTrans: parse(row.evidencias_trans, {}), instrumentosTrans: parse(row.instrumentos_trans, {}), sesiones: parse(row.sesiones, []),
} : null;
const sections = (value) => String(value || '').toUpperCase().split(/[\s,/_-]+/).filter((value) => value && value !== 'Y');
const covers = (unitSection, lessonSection) => { const available = sections(unitSection), requested = sections(lessonSection); return requested.length && requested.every((section) => available.includes(section)); };
export const findPlanningUnit = (db, lesson) => {
  const rows = db.prepare('SELECT * FROM unidades_didacticas WHERE year=? AND area_id=? AND grade=? AND unit_number=? ORDER BY updated_at DESC').all(String(lesson.year), String(lesson.area_id ?? lesson.areaId), String(lesson.grade), String(lesson.unit_number ?? lesson.unitNumber));
  return decodePlanningUnit(rows.find((row) => row.section === lesson.section) || rows.find((row) => covers(row.section, lesson.section)));
};

export const reconcileUnitPlanningForLesson = (db, lesson, data) => {
  const unit = findPlanningUnit(db, lesson);
  return reconcileSessionCapacities(unit ? mergeUnitSessionPlanning(data, unit, lesson.session_number ?? lesson.sessionNumber) : data);
};

export const prepareLessonPlanningSave = (db, lesson, data) => {
  const unit = findPlanningUnit(db, lesson);
  if (!unit) return reconcileSessionCapacities(data);
  const current = buildUnitSessionPlanning(unit, lesson.session_number ?? lesson.sessionNumber);
  if (!current) return reconcileSessionCapacities(data);
  // An explicit lesson edit may differ from its unit. Record the unit baseline
  // so reopening preserves that edit; a later unit change replaces only fields
  // actually changed in the unit, including submissions from an older tab.
  return reconcileSessionCapacities(data.unitPlanningSnapshot ? mergeUnitSessionPlanning(data, unit, lesson.session_number ?? lesson.sessionNumber) : { ...data, unitPlanningSnapshot: current });
};

export const syncSavedLessonsFromUnit = (db, unit, previousUnit) => {
  let updated = 0;
  const rows = db.prepare('SELECT * FROM sesiones WHERE year=? AND area_id=? AND grade=? AND unit_number=?').all(String(unit.year), String(unit.areaId ?? unit.area_id), String(unit.grade), String(unit.unitNumber ?? unit.unit_number));
  for (const row of rows) {
    if (!covers(unit.section, row.section)) continue;
    const selected = findPlanningUnit(db, row);
    if (selected?.id_unidad !== unit.id_unidad) continue;
    if (!buildUnitSessionPlanning(selected, row.session_number)) continue;
    const saved = parse(row.session_data, null); if (!saved) continue;
    const merged = reconcileSessionCapacities(mergeUnitSessionPlanning(saved, selected, row.session_number, previousUnit));
    if (JSON.stringify(saved) === JSON.stringify(merged)) continue;
    db.prepare('UPDATE sesiones SET session_data=?,updated_at=CURRENT_TIMESTAMP WHERE id_sesion=?').run(JSON.stringify(merged), row.id_sesion);
    updated += 1;
  }
  return updated;
};
