let identity = null;
export const getWebIdentity = () => identity;
export const setWebIdentity = value => { identity = value; };

export function createMemoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
}

// Solo el bundle web instala este límite. No se importa desde el escritorio.
export function installWebRuntime(win) {
  const nativeFetch = win.fetch.bind(win);
  const local = createMemoryStorage();
  const temporary = createMemoryStorage();
  Object.defineProperty(win, 'localStorage', { configurable: true, get: () => local });
  Object.defineProperty(win, 'sessionStorage', { configurable: true, get: () => temporary });
  const allowed = new Set(['GET /api/auth/session', 'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/health', 'GET /api/admin/usage']);
  allowed.add('GET /api/academic/status');
  allowed.add('GET /api/academic/records');
  allowed.add('POST /api/academic/imports');
  const blocked = () => Response.json({ success: false, message: 'Esta función todavía no está habilitada en la web.' }, { status: 404 });
  win.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, win.location.href);
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    if (url.origin !== win.location.origin) return Promise.resolve(blocked());
    if (url.pathname.startsWith('/api/')) {
      if (!allowed.has(`${method} ${url.pathname}`) && !(method === 'POST' && /^\/api\/academic\/imports\/[a-f0-9]{64}\/(chunks|commit)$/.test(url.pathname))) return Promise.resolve(blocked());
    } else if (method !== 'GET' && method !== 'HEAD') return Promise.resolve(blocked());
    return nativeFetch(input, options);
  };
  return () => { local.clear(); temporary.clear(); setWebIdentity(null); };
}
