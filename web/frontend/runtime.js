let identity = null;
export const getWebIdentity = () => identity;
export const setWebIdentity = value => { identity = value; };

export function createMemoryStorage(changed = () => {}) {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { key=String(key);value=String(value);if(values.get(key)===value)return;values.set(key,value);changed(key); },
    removeItem(key) {key=String(key);if(values.delete(key))changed(key);},
    clear() {const keys=[...values.keys()];values.clear();keys.forEach(changed);},
  };
}

// Solo el bundle web instala este límite. No se importa desde el escritorio.
export function installWebRuntime(win) {
  const nativeFetch = win.fetch.bind(win);
  const local = createMemoryStorage(key => win.dispatchEvent?.(new CustomEvent('armi-web-storage-changed',{detail:{key}})));
  const temporary = createMemoryStorage();
  Object.defineProperty(win, 'localStorage', { configurable: true, get: () => local });
  Object.defineProperty(win, 'sessionStorage', { configurable: true, get: () => temporary });
  const allowed = new Set(['GET /api/auth/session', 'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/health', 'GET /api/admin/usage']);
  allowed.add('GET /api/academic/status');
  allowed.add('GET /api/academic/records');
  allowed.add('PUT /api/academic/edit');
  allowed.add('PUT /api/academic/settings');
  for(const method of ['GET','PUT','DELETE'])allowed.add(method+' /api/instruments');
  for(const path of ['/api/evaluation/grades','/api/evaluation/conclusions'])for(const method of ['GET','PUT'])allowed.add(method+' '+path);
  for(const route of ['GET /api/ai/profile','GET /api/ai/models','PUT /api/ai/credentials','DELETE /api/ai/credentials','PUT /api/ai/preferences','POST /api/ai/generate'])allowed.add(route);
  for(const route of ['GET /api/portal','PUT /api/portal','POST /api/portal/access','DELETE /api/portal/access','PUT /api/portal/publications','GET /api/portal/inbox'])allowed.add(route);
  for(const route of ['GET /api/drive/profile','POST /api/drive/connect','PUT /api/drive/folder','POST /api/drive/selection','DELETE /api/drive/connection','GET /api/drive/files','GET /api/drive/content'])allowed.add(route);
  for(const route of ['POST /api/drive/upload/prepare','POST /api/drive/upload','GET /api/drive/upload/status'])allowed.add(route);
  for(const route of ['GET /api/drive/sync/status','POST /api/drive/sync'])allowed.add(route);
  allowed.add('GET /api/drive/templates');
  allowed.add('GET /api/drive/sync/receipt');
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
