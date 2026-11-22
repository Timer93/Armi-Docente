// Conserva los clientes existentes. El transporte web rechaza las operaciones
// que todavía no tienen un servidor compatible, sin enviarlas al localhost.
export * from 'armi-desktop-api-original';
import { INITIAL_GENERAL_DATA, INITIAL_MODULE_STATUS } from '../../constants';
import { getWebIdentity } from './runtime.js';

export async function getDatosGenerales() {
  const identity = getWebIdentity();
  return { ...INITIAL_GENERAL_DATA, teacher: identity?.user.displayName || '', institution: identity?.user.institutionName || '' };
}
export async function getModuleStatus() { return Object.fromEntries(Object.keys(INITIAL_MODULE_STATUS).map(key => [key, true])); }
export async function getEstudiantes() { return []; }
export async function bootstrapPortableState() { return { success: true, data: { frontendState: { keys: {} }, recoveryPending: false } }; }
export async function saveCloudFrontendState() { return { success: false, message: 'La sincronización todavía no está habilitada en la web.' }; }
export async function getDepartamentos() { throw new Error('El catálogo institucional todavía no está conectado en la web.'); }
export async function saveImageAssetFile() { return { success: false, message: 'La carga de imágenes todavía no está habilitada en la web.' }; }
