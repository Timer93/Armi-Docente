// Conserva los clientes existentes. El transporte web rechaza las operaciones
// que todavía no tienen un servidor compatible, sin enviarlas al localhost.
export * from 'armi-desktop-api-original';
import { INITIAL_GENERAL_DATA, INITIAL_MODULE_STATUS } from '../../constants';
import { getWebIdentity } from './runtime.js';
import { readAcademic } from './academic-client';

export async function getDatosGenerales() {
  const identity = getWebIdentity();
  const fallback = { ...INITIAL_GENERAL_DATA, teacher: identity?.user.displayName || '', institution: identity?.user.institutionName || '' };
  if (!identity) return fallback;
  try { return { ...fallback, ...(await readAcademic('general'))[0]?.value }; } catch { return fallback; }
}
export async function getModuleStatus() { return Object.fromEntries(Object.keys(INITIAL_MODULE_STATUS).map(key => [key, true])); }
export async function getEstudiantes() { try { return (await readAcademic('students')).map(row => row.value).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')); } catch { return []; } }
export async function bootstrapPortableState() {
  let rows: Awaited<ReturnType<typeof readAcademic>> = [];
  try { rows = await readAcademic('frontend'); } catch {}
  return { success: true, data: { frontendState: { keys: Object.fromEntries(rows.map(row => [row.id, JSON.stringify(row.value)])) }, recoveryPending: false } };
}
const academicMap = async (dataset: string) => Object.fromEntries((await readAcademic(dataset)).map(row => [row.id, row.value]));
export const getProgramacionesAnuales = () => academicMap('annual').catch(() => ({}));
export const getAllUnidadesDidacticas = () => academicMap('units').catch(() => ({}));
export const getAllSesiones = () => academicMap('sessions').catch(() => ({}));
export const getSessionIndex = getAllSesiones;
export async function getUnidadDidactica(year: string, areaId: string, grade: string, section: string, unitNumber: string) { return (await getAllUnidadesDidacticas())[`${year}-${areaId}-${grade}-${section}-U${unitNumber}`] || null; }
export async function getSesion(year: string, areaId: string, grade: string, section: string, unitNumber: string, sessionNumber: string) { return (await getAllSesiones())[`${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`] || null; }
export async function saveCloudFrontendState() { return { success: false, message: 'La sincronización todavía no está habilitada en la web.' }; }
export async function getDepartamentos() { const data = await getDatosGenerales(); return data.department ? [data.department] : []; }
export async function getProvincias() { const data = await getDatosGenerales(); return data.province ? [data.province] : []; }
export async function getDistritos() { const data = await getDatosGenerales(); return data.district ? [data.district] : []; }
export async function getColegios() { const data = await getDatosGenerales(); return data.institution ? [{ nombre_ie: data.institution, cod_mod: 'copia', ugel: data.ugel || '' }] : []; }
export async function saveImageAssetFile() { return { success: false, message: 'La carga de imágenes todavía no está habilitada en la web.' }; }
