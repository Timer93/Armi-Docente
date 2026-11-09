const normalize = (value: string) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const sections = (value: string) => normalize(value).split(/,|\s+y\s+/).map(part => part.trim()).filter(Boolean);

export const matchesMergeSection = (current: string, selected: string) => !selected || sections(current).some(part => sections(selected).includes(part));
export const matchesMergeNumbers = (current: string | number | undefined, selected: string[]) => !selected.length || selected.includes(String(current ?? ''));
export const toggleVisibleSessionIds = (selected: string[], visible: string[]) => {
  const allSelected = visible.length > 0 && visible.every(id => selected.includes(id));
  return allSelected ? selected.filter(id => !visible.includes(id)) : [...new Set([...selected, ...visible])];
};

export const WORD_MARKER_GROUPS = [
  { id: 'general', label: 'Datos generales' },
  { id: 'competencies', label: 'Competencias y capacidades' },
  { id: 'development', label: 'Desarrollo de la sesión' },
  { id: 'assessment', label: 'Evaluación' },
  { id: 'resources', label: 'Recursos y anexos' },
  { id: 'other', label: 'Otros' }
] as const;

export const markerGroup = (marker: string) => {
  const name = normalize(marker).replace(/^[#/%]+/, '');
  if (/^(saberes|conflicto|construccion|aplicacion|metacognicion)|^evaluacion_(estrategias|recursos|tiempo)$|proposito|situation|situacion|extension|secuencia|inicio|proceso|cierre|salida/.test(name)) return 'development';
  if (/anexo|instructivo|recurso|material|medios|software|espacios|bibliografia|linkografia/.test(name)) return 'resources';
  if (/evaluacion|instrumento|criterio|evidencia|rubrica|lista_cotejo|calific|nivel_logro/.test(name)) return 'assessment';
  if (/competencia|capacidad|desempeno|estandar|enfoque|valor|acciones|demuestra|ejes?_/.test(name)) return 'competencies';
  if (/^(ie|institution|institucion|ugel|lugar|district|distrito|province|provincia|lema|motto|bimestre|unidad|sesion|sesiones|nombre_del_ano|titulo|insignia|logo|area|grado|seccion|ciclo|estudiantes|fecha|duracion|docente|coord|sub_director|director|generation_date)(_|$)/.test(name)) return 'general';
  return 'other';
};

export const groupWordMarkers = (template: string[], suggested: string[], search = '') => {
  const seen = new Set<string>();
  const query = normalize(search).replace(/[^a-z0-9]/g, '');
  const markers = [...template, ...suggested].map(value => value.trim()).filter(value => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => a.localeCompare(b, 'es'));
  return WORD_MARKER_GROUPS.map(group => ({ ...group, markers: markers.filter(marker => markerGroup(marker) === group.id && (!query || normalize(marker).replace(/[^a-z0-9]/g, '').includes(query))) }));
};
