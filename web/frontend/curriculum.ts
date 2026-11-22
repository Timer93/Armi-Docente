let catalog: Promise<Record<string,any[]>> | undefined;
const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
export async function curriculumRows(kind: string, grade = '', area = '') {
  if (!catalog) {
    catalog = fetch('/curriculum.json').then(async response => {
      if (!response.ok) throw new Error('No se pudo cargar el catálogo curricular. Recarga la página.');
      const data = await response.json();
      if (data.format !== 'armi-public-curriculum' || !Array.isArray(data.competencias) || !Array.isArray(data.estandares) || !Array.isArray(data.areas)) throw new Error('Catálogo curricular no válido.');
      return data;
    });
    void catalog.catch(() => {catalog = undefined;});
  }
  const rows = (await catalog)[kind] || [];
  return rows.filter(row => (!grade || normalize(row.grado).includes(normalize(grade))) && (!area || normalize(row.area).includes(normalize(area)) || normalize(row.competencias).includes(normalize(area))));
}
