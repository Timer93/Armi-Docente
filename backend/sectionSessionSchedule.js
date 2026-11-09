import { resolveSectionSessionDates, sectionWindowKey } from './shared/sectionSessionDates.js';
import {templateScheduleWindows} from './evidenceTemplateSchedule.js';

export function createSectionSessionSchedule(db) {
  let scheduleRaw, schedule = [], unitRaw, planned = [];
  const unitQuery = db.prepare('SELECT sesiones FROM unidades_didacticas WHERE year=? AND area_id=? AND grade=? AND section=? AND unit_number=?');
  const scheduleQuery = db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_schedule_entries'");
  const configQuery = db.prepare("SELECT value FROM armi_frontend_state WHERE key='armi_schedule_config'");
  let configRaw,config=null;
  const windowQuery = db.prepare('SELECT * FROM evaluacion_ventanas_entrega WHERE session_id=?');
  const parse = raw => { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  return {
    dates(row, data, section) {
      const unit = unitQuery.get(String(row.year || ''), String(row.area_id || ''), String(row.grade || ''), String(row.section || ''), String(row.unit_number || ''))?.sesiones;
      if (unit !== unitRaw) { unitRaw = unit; planned = parse(unit); }
      const raw = scheduleQuery.get()?.value;
      if (raw !== scheduleRaw) { scheduleRaw = raw; schedule = parse(raw); }
      const number = Number(row.session_number);
      const session = planned.find((item, index) => Number(item.sessionNumber ?? item.id ?? index + 1) === number);
      return resolveSectionSessionDates(row, data, section, { plannedSession: session, scheduleEntries: schedule });
    },
    explicit(sessionId, section) {
      const key = sectionWindowKey(sessionId, section);
      return (key !== sessionId && windowQuery.get(key)) || windowQuery.get(sessionId) || null;
    },
    windows(row,data,section) {
      const dates=this.dates(row,data,section),raw=configQuery.get()?.value;
      if(raw!==configRaw){configRaw=raw;try{config=JSON.parse(raw || 'null');}catch{config=null;}}
      return templateScheduleWindows(row,dates,section,schedule,config);
    },
  };
}
