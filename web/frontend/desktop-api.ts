// Conserva los clientes existentes. El transporte web rechaza las operaciones
// que todavía no tienen un servidor compatible, sin enviarlas al localhost.
export * from 'armi-desktop-api-original';
export {getInstrumentos,saveInstrumento,deleteInstrumento} from './instruments-client';
import { INITIAL_GENERAL_DATA, INITIAL_MODULE_STATUS } from '../../constants';
import { getWebIdentity } from './runtime.js';
import { readAcademic, saveAcademic, invalidateAcademic } from './academic-client';
import { planningId } from '../src/edit-fields.js';
import { mergeUnitSessionPlanning } from '../../backend/shared/unitSessionPlanning.js';
import { curriculumRows } from './curriculum';
import {persistConfiguration,configurationState} from './configuration-client';
import {aiGeneralFields} from './ai-client';

async function planningSave(dataset: string, value: any) {
  try {
    const id = planningId(dataset,value);
    const saved = await saveAcademic(dataset,id,{...value,id});
    if (dataset === 'units') invalidateAcademic('sessions');
    return {success:true,data:saved.value};
  } catch (error) { return {success:false,message:(error as Error).message}; }
}
async function planningDelete(dataset: string, id: string) {
  try { await saveAcademic(dataset,id,{},'delete'); if (dataset === 'units') invalidateAcademic('sessions'); return {success:true}; }
  catch (error) { return {success:false,message:(error as Error).message}; }
}
export const saveProgramacionAnual = (data: any) => planningSave('annual',{...data,year:data.year || String(data.id).slice(0,4)});
export const saveUnidadDidactica = (data: any) => planningSave('units',data);
export const saveSesion = (data: any) => planningSave('sessions',{...data.sessionData,year:data.year,areaId:data.areaId,grade:data.grade,section:data.section,unitNumber:data.unitNumber,sessionNumber:data.sessionNumber,date:data.date || data.sessionData?.date || ''});
export const deleteProgramacionAnual = (id: string) => planningDelete('annual',id);
export const deleteUnidadDidactica = (id: string) => planningDelete('units',id);
export const deleteSesion = (id: string) => planningDelete('sessions',id);
export const getCompetencias = (grade = '', area = '') => curriculumRows('competencias',grade,area);
export const getEstandares = (grade = '', area = '') => curriculumRows('estandares',grade,area);
export const getAreas = () => curriculumRows('areas');

export async function saveDatosGenerales(data: any) {
  try { const saved = await saveAcademic('general','general',data); return {success:true,data:saved.value}; }
  catch (error) { return {success:false,message:(error as Error).message}; }
}
export async function saveEstudiante(data: any) {
  const id = String(data.id).startsWith('new-') ? `web-${crypto.randomUUID()}` : String(data.id);
  try { const saved = await saveAcademic('students',id,data); return {success:true,data:saved.value}; }
  catch (error) { return {success:false,message:(error as Error).message}; }
}
export async function deleteEstudiante(id: string | number) {
  try { await saveAcademic('students',String(id),{},'delete'); return {success:true}; }
  catch (error) { return {success:false,message:(error as Error).message}; }
}
// The original screen uses this only as a completion hint after a confirmed
// student save. Permissions remain exclusively on the server.
export async function updateModuleStatus(moduleName: string) {
  if(['areas_grados','calendario','horario'].includes(moduleName))return saveCloudFrontendState(configurationState());
  return ['estudiantes','programacion_anual'].includes(moduleName)?{success:true}:{success:false,message:'Este módulo todavía está en consulta.'};
}

export async function getDatosGenerales() {
  const identity = getWebIdentity();
  const fallback = { ...INITIAL_GENERAL_DATA, teacher: identity?.user.displayName || '', institution: identity?.user.institutionName || '' };
  if (!identity) return fallback;
  try { return { ...fallback, ...(await readAcademic('general'))[0]?.value,...await aiGeneralFields() }; } catch { return fallback; }
}
export async function getModuleStatus() { return Object.fromEntries(Object.keys(INITIAL_MODULE_STATUS).map(key => [key, true])); }
export async function getEstudiantes() { try { return (await readAcademic('students')).map(row => row.value).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')); } catch { return []; } }
export async function bootstrapPortableState() {
  let rows: Awaited<ReturnType<typeof readAcademic>> = [];
  try { rows = await readAcademic('frontend'); } catch(error) {return {success:false,message:(error as Error).message};}
  return { success: true, data: { frontendState: { keys: Object.fromEntries(rows.map(row => [row.id, JSON.stringify(row.value)])) }, recoveryPending: false } };
}
const academicMap = async (dataset: string) => Object.fromEntries((await readAcademic(dataset)).map(row => [row.id, row.value]));
export const getProgramacionesAnuales = () => academicMap('annual').catch(() => ({}));
export const getAllUnidadesDidacticas = () => academicMap('units').catch(() => ({}));
export const getAllSesiones = () => academicMap('sessions').catch(() => ({}));
export const getSessionIndex = getAllSesiones;
export async function getUnidadDidactica(year: string, areaId: string, grade: string, section: string, unitNumber: string) { return (await getAllUnidadesDidacticas())[`${year}-${areaId}-${grade}-${section}-U${unitNumber}`] || null; }
export async function getSesion(year: string, areaId: string, grade: string, section: string, unitNumber: string, sessionNumber: string) {
  const saved = (await getAllSesiones())[`${year}-${areaId}-${grade}-${section}-U${unitNumber}-S${sessionNumber}`];
  if (!saved) return null;
  const unit = await getUnidadDidactica(year,areaId,grade,section,unitNumber);
  // Reuse the desktop's pure merge rule. Unit wording is adopted on reopening
  // a lesson, without rewriting its authored activities or grading records.
  return unit ? mergeUnitSessionPlanning(saved,unit,sessionNumber) : saved;
}
export async function saveCloudFrontendState(state: Record<string,string>,keys?: string[]) {
  try {await persistConfiguration(state,keys);return {success:true};}
  catch(error) {return {success:false,message:(error as Error).message};}
}
export async function getDepartamentos() { const data = await getDatosGenerales(); return data.department ? [data.department] : []; }
export async function getProvincias() { const data = await getDatosGenerales(); return data.province ? [data.province] : []; }
export async function getDistritos() { const data = await getDatosGenerales(); return data.district ? [data.district] : []; }
export async function getColegios() { const data = await getDatosGenerales(); return data.institution ? [{ nombre_ie: data.institution, cod_mod: 'copia', ugel: data.ugel || '' }] : []; }
export async function saveImageAssetFile() { return { success: false, message: 'La carga de imágenes todavía no está habilitada en la web.' }; }
