import { splitSessionSections, parseSessionLocalDate } from './shared/sectionSessionDates.js';
const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
export function templateScheduleWindows(row, dates, section, entries, config) {
  if (!config || !/^\d\d:\d\d$/.test(config.startTime || '') || !(Number(config.classDuration) > 0)) return [];
  const [h, m] = config.startTime.split(':').map(Number);
  const weekdays = ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'];
  const result = [];
  for (const value of dates) {
    const date = parseSessionLocalDate(value); if (!date) continue;
    const hours = [...new Set(entries.filter(e => norm(e.grade) === norm(row.grade) && String(e.areaId) === String(row.area_id)
      && splitSessionSections(e.section).includes(norm(section)) && norm(e.day) === weekdays[date.getDay()])
      .map(e => Number(e.hourIndex)).filter(n => Number.isInteger(n) && n > 0))].sort((a,b)=>a-b);
    const groups = [];
    for (const hour of hours) { const last = groups.at(-1); if (last && last.at(-1)+1 === hour) last.push(hour); else groups.push([hour]); }
    for (const group of groups) {
      const minutes = index => h*60+m+(index-1)*Number(config.classDuration)+(config.breaks || []).filter(b=>Number(b.afterHour)<index).reduce((n,b)=>n+Number(b.duration || 0),0);
      const start = new Date(date); start.setMinutes(minutes(group[0]));
      const end = new Date(date); end.setMinutes(minutes(group.at(-1))+Number(config.classDuration));
      result.push({ openAt: start.toISOString(), closeAt: end.toISOString(), section });
    }
  }
  return result.sort((a,b)=>a.openAt.localeCompare(b.openAt));
}

export function templateScheduleState(windows, now=Date.now()) {
  const sorted=(windows || []).filter(w=>Number.isFinite(Date.parse(w.openAt)) && Date.parse(w.closeAt)>Date.parse(w.openAt)).sort((a,b)=>Date.parse(a.openAt)-Date.parse(b.openAt));
  const current=sorted.find(w=>Date.parse(w.openAt)<=now && Date.parse(w.closeAt)>now);
  const next=sorted.find(w=>Date.parse(w.openAt)>now),period=current || next || sorted.at(-1);
  return {status:current?'open':next?'upcoming':period?'closed':'unconfigured',...(period?{openAt:period.openAt,closeAt:period.closeAt}:{})};
}
