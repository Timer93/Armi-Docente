import crypto from 'node:crypto';

export const ACCESS_CONTROL_KEY = 'armi_access_control_v1';
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const list = (value, max, label) => {
  if (!Array.isArray(value) || value.length > max) fail(`${label}: lista no válida o demasiado extensa.`);
  return value;
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) fail(`${label}: escribe entre 1 y 100 caracteres.`);
  return value.trim();
};
const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('Identificador no válido.');
  return value;
};
export function normalizeBlockedDomain(input) {
  if (typeof input !== 'string' || input.length > 2048) fail('Dominio no válido.');
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); }
  catch { fail(`Dominio no válido: ${input}`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) fail('Usa dominios o direcciones web sin credenciales ni puertos.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (host.length > 253 || !host.includes('.') || !host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) fail(`Dominio no válido: ${input}`);
  return host;
}
export function validateAccessControl(value) {
  if (!value || value.version !== 1) fail('Formato de control de acceso no válido.');
  const unique = (rows, label) => {
    if (new Set(rows.map(row => row.id)).size !== rows.length) fail(`${label}: hay identificadores repetidos.`);
    return rows;
  };
  const groups = unique(list(value.groups, 100, 'Grupos').map(row => ({ id: id(row?.id), name: text(row?.name, 'Nombre del grupo') })), 'Grupos');
  const groupIds = new Set(groups.map(row => row.id));
  const devices = unique(list(value.devices, 500, 'Equipos').map(row => {
    const groupId = row?.groupId || null;
    if (groupId && !groupIds.has(groupId)) fail('El grupo de un equipo ya no existe.');
    const permissions = row?.permissions;
    if (permissions != null && (typeof permissions !== 'object' || ['navigation','folders','files'].some(key => permissions[key] != null && typeof permissions[key] !== 'boolean'))) fail('Permisos del equipo no válidos.');
    return { id: id(row?.id), name: text(row?.name, 'Nombre del equipo'), groupId,
      permissions: { navigation: permissions?.navigation !== false, folders: permissions?.folders !== false, files: permissions?.files !== false } };
  }), 'Equipos');
  const deviceIds = new Set(devices.map(row => row.id));
  const rules = unique(list(value.rules, 300, 'Reglas').map(row => {
    if (!['all', 'group', 'devices'].includes(row?.scope) || typeof row.enabled !== 'boolean') fail('Alcance o estado de regla no válido.');
    const domains = [...new Set(list(row.domains, 1000, 'Dominios').map(normalizeBlockedDomain))];
    if (!domains.length) fail('Añade al menos un dominio a la regla.');
    const targets = row.scope === 'devices' ? [...new Set(list(row.deviceIds, 500, 'Equipos seleccionados').map(id))] : [];
    if (row.scope === 'devices' && (!targets.length || targets.some(target => !deviceIds.has(target)))) fail('Selecciona equipos registrados.');
    if (row.scope === 'group' && !groupIds.has(row.groupId)) fail('Selecciona un grupo existente.');
    return { id: id(row.id), name: text(row.name, 'Nombre de la regla'), enabled: row.enabled, domains,
      scope: row.scope, groupId: row.scope === 'group' ? row.groupId : null, deviceIds: targets };
  }), 'Reglas');
  if (rules.reduce((total, rule) => total + rule.domains.length, 0) > 10000) fail('La configuración admite hasta 10.000 dominios entre todas las reglas.');
  return { version: 1, groups, devices, rules };
}
export function createAccessControlStore(db) {
  const read = () => {
    const row = db.prepare('SELECT value,updated_at FROM armi_frontend_state WHERE key=?').get(ACCESS_CONTROL_KEY);
    if (!row) return { config: { version: 1, groups: [], devices: [], rules: [] }, revision: 'empty', updatedAt: null };
    return { config: validateAccessControl(JSON.parse(row.value)), updatedAt: row.updated_at,
      revision: crypto.createHash('sha256').update(row.value + row.updated_at).digest('hex') };
  };
  const save = (value, revision) => db.transaction(() => {
    const current = read();
    if (revision !== current.revision) throw Object.assign(new Error('La configuración cambió en otra ventana o PC. Recarga antes de guardar.'), { status: 409 });
    const config = validateAccessControl(value);
    if (JSON.stringify(config) === JSON.stringify(current.config)) return current;
    db.prepare('INSERT INTO armi_frontend_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
      .run(ACCESS_CONTROL_KEY, JSON.stringify(config), new Date().toISOString());
    return read();
  }).immediate();
  return { read, save };
}
