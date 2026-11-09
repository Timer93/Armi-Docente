const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
export const splitSessionSections = value => normalize(value).replace(/\bY\b/g, ' ').split(/[\s,\/-]+/).filter(Boolean);

export function parseSessionLocalDate(value, endOfDay = false) {
  let text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) text = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}
const dateKey = value => {
  const date = parseSessionLocalDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
};
const values = source => [...new Set((Array.isArray(source) ? source : [source]).map(dateKey).filter(Boolean))];

// Unit planning records explicitly identify each section. The display's sorted
// date list has no positional relationship with the alphabetical section list.
export function resolveSectionSessionDates(row, data, section, { plannedSession = null, scheduleEntries = [] } = {}) {
  const options = Array.isArray(data?.sessionDateOptions) ? data.sessionDateOptions : [];
  const dates = values(options.length ? options.map(item => item?.value) : data?.selectedSessionDate || data?.date);
  const sections = splitSessionSections(section);
  if (sections.length !== 1 || splitSessionSections(row?.section).length <= 1) return dates;
  const target = sections[0];
  const tagged = options.filter(item => splitSessionSections(item?.section || item?.sections).includes(target));
  if (tagged.length) return values(tagged.map(item => item.value));
  for (const source of [data, plannedSession]) {
    const mapped = values(source?.sessionDatesBySection?.[target] || []);
    const descriptions = Array.isArray(source?.fechasPorSeccion) ? source.fechasPorSeccion : [];
    for (const entry of descriptions) {
      const match = String(entry).match(/(?:^|\s)([A-Za-z0-9]+)\s*\(([^)]+)\)\s*$/);
      if (match && normalize(match[1]) === target) mapped.push(...values(match[2].split(/\s+---\s+/)));
    }
    const generalDateOnly = !options.length && !String(data?.dateChangeMotive || '').trim();
    const compatible = [...new Set(mapped)].filter(date => generalDateOnly || !dates.length || dates.includes(date));
    if (compatible.length) return compatible;
  }
  const weekdays = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
  const days = new Set(scheduleEntries.filter(entry => normalize(entry.grade) === normalize(row?.grade)
    && String(entry.areaId) === String(row?.area_id)
    && splitSessionSections(entry.section).includes(target)).map(entry => normalize(entry.day)));
  const matching = dates.filter(date => days.has(weekdays[parseSessionLocalDate(date).getDay()]));
  // Ambiguous historical records keep their visible dates; never guess using
  // alphabetical position. New saves retain the explicit per-section mapping.
  return matching.length ? matching : dates;
}

export function automaticSectionWindow(dates) {
  const openAt = parseSessionLocalDate(dates?.[0]);
  if (!openAt) return null;
  openAt.setHours(0, 0, 0, 0);
  const onTimeCloseAt = new Date(openAt);
  onTimeCloseAt.setDate(onTimeCloseAt.getDate() + 1); onTimeCloseAt.setHours(23, 59, 59, 999);
  const closeAt = new Date(onTimeCloseAt); closeAt.setDate(closeAt.getDate() + 3);
  return { openAt, onTimeCloseAt, closeAt };
}

export const sectionWindowKey = (sessionId, section) => {
  const sections = splitSessionSections(section);
  return sections.length === 1 ? `${sessionId}::section:${sections[0]}` : sessionId;
};

export function effectiveSectionWindow(automatic, explicit) {
  if (!automatic) return null;
  const close = parseSessionLocalDate(explicit?.close_at, true);
  // The exceptional control only extends/closes reception. Older versions
  // persisted the general/A date as open_from; it must not override B's date.
  const open = Number(explicit?.exceptional) === 1 ? null : parseSessionLocalDate(explicit?.open_from);
  return { ...automatic, openAt: open || automatic.openAt, closeAt: close && close > automatic.closeAt ? close : automatic.closeAt };
}
