export function normalizeServerUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Escribe la dirección de ARMI, por ejemplo http://192.168.1.10:3001.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('La dirección de ARMI debe usar HTTP o HTTPS y no incluir contraseñas.');
  const host = url.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host === '[::1]' || /^127\./.test(host) || /^10\./.test(host)
    || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (url.protocol === 'http:' && !privateHost) throw new Error('Para una dirección de Internet utiliza HTTPS. HTTP se admite solo en la red local.');
  return url.origin;
}
export function permissionPattern(value) {
  const url = new URL(normalizeServerUrl(value));
  return `${url.protocol}//${url.hostname}/*`;
}
export function compilePolicy(policy, serverUrl) {
  if (policy?.protocol !== 1 || typeof policy.deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(policy.revision || '')
    || !Array.isArray(policy.domains) || policy.domains.length > 10000) throw new Error('La política recibida no es compatible con esta extensión.');
  const domains = policy.domains;
  if (new Set(domains).size !== domains.length || domains.some(domain => typeof domain !== 'string' || domain.length > 253 || !domain.includes('.')
    || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) throw new Error('La política contiene un dominio no válido. Se conservó el bloqueo anterior.');
  return [
    { id: 1, priority: 100, action: { type: 'allow' }, condition: { requestDomains: [new URL(serverUrl).hostname], resourceTypes: ['main_frame', 'sub_frame'] } },
    ...domains.map((domain, index) => ({ id: index + 1000, priority: 10, action: { type: 'block' }, condition: { requestDomains: [domain], resourceTypes: ['main_frame', 'sub_frame'] } })),
  ];
}
export function sameRules(actual, expected) {
  if (actual.some(rule => Object.keys(rule.action).some(key => key !== 'type')
    || Object.keys(rule.condition).some(key => !['requestDomains', 'resourceTypes'].includes(key)))) return false;
  const simple = list => list.map(rule => ({ id: rule.id, priority: rule.priority || 1, action: rule.action.type,
    domains: [...(rule.condition.requestDomains || [])].sort(), types: [...(rule.condition.resourceTypes || [])].sort() })).sort((a,b) => a.id-b.id);
  return JSON.stringify(simple(actual)) === JSON.stringify(simple(expected));
}
export function blockedTabUrl(value, domains, serverUrl) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase(), teacher = new URL(serverUrl).hostname;
  if (host === teacher || host.endsWith(`.${teacher}`)) return false;
  const blocked = new Set(domains);
  let candidate = host;
  while (candidate) {
    if (blocked.has(candidate)) return true;
    const dot = candidate.indexOf('.'); if (dot < 0) break; candidate = candidate.slice(dot + 1);
  }
  return false;
}
