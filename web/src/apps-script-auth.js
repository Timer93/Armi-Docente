export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export function configuredAuthUrl(env) {
  try {
    const url = new URL(env.ARMI_AUTH_APPS_SCRIPT_URL);
    return url.protocol === 'https:' && url.hostname === 'script.google.com'
      && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash
      && !url.pathname.includes('REEMPLAZAR') ? url.href : '';
  } catch { return ''; }
}

const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const isFalse = value => value === false || value === 0 || ['false', '0', 'no'].includes(String(value).toLowerCase());

export async function authenticateWithAppsScript(env, credentials, requester = fetch, now = Date.now()) {
  const endpoint = configuredAuthUrl(env);
  if (!endpoint) throw new AuthError('El acceso web todavía no está configurado.', 503);
  const username = text(credentials.username, 160);
  const password = typeof credentials.password === 'string' ? credentials.password : '';
  if (!username || !password || password.length > 512) throw new AuthError('Ingresa tu usuario y contraseña.', 400);

  let raw;
  try {
    const response = await requester(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      // El navegador no representa una PC nueva. Login_ ya admite placa vacía.
      body: JSON.stringify({ action: 'Login', Usuario: username, 'Contraseña': password,
        username, password, Placa: '', placa: '', devicePlate: '', InfoUsuario: '' }),
    });
    if (!response.ok) throw new Error('upstream');
    raw = await response.json();
  } catch {
    throw new AuthError('El servicio de acceso no respondió. Intenta nuevamente en unos momentos.', 503);
  }

  if (raw?.success !== true || !raw.data || typeof raw.data !== 'object') {
    throw new AuthError('No se pudo iniciar sesión. Revisa tus credenciales y el estado de tu membresía.');
  }
  const data = raw.data;
  const status = text(data.subscriptionStatus || data.subscription_status || data.estado, 50).toLowerCase();
  const allowed = ['active', 'activo', 'habilitad@', 'habilitado', 'habilitada', 'enabled', 'ok'];
  if (!allowed.includes(status) || isFalse(data.subscriptionActive ?? data.subscription_active ?? data.active)) {
    throw new AuthError('Tu membresía no está habilitada. Contacta al soporte de ARMI.', 403);
  }
  const expiry = text(data.subscriptionEndsAt || data.subscription_ends_at || data.expiresAt || data.expires_at, 80);
  const expiresAt = expiry ? Date.parse(expiry) : null;
  if (expiry && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    throw new AuthError('Tu membresía ha vencido o requiere revisión.', 403);
  }
  // Solo campos permitidos: nunca devolver el payload remoto completo al cliente.
  const canonicalUsername = text(data.username || data.usuario, 160);
  if (!canonicalUsername) throw new AuthError('El proveedor no devolvió una identidad válida.', 503);
  return {
    username: canonicalUsername,
    displayName: text(data.displayName || data.nameuser || data.nombre) || canonicalUsername,
    institutionName: text(data.institutionName || data.institucion),
    membership: {
      status,
      plan: text(data.subscriptionPlan || data.subscription_plan || data.plan, 80),
      expiresAt,
    },
  };
}
