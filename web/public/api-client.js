export function createApiClient({ fetcher = fetch, timeoutMs = 20_000, onUnauthorized = () => {} } = {}) {
  const pendingReads = new Map();
  let generation = 0;
  const execute = async (path, method, body) => {
    const startedIn = generation;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(path, {
        method, credentials: 'same-origin', signal: controller.signal,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (startedIn !== generation) throw new Error('La sesión cambió. Intenta nuevamente.');
      if (!response.ok || !result.success) {
        if (response.status === 401) onUnauthorized();
        throw new Error(result.message || 'No se pudo completar la operación.');
      }
      return result.data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('La conexión tardó demasiado. Intenta nuevamente.');
      if (error instanceof TypeError) throw new Error('No pudimos conectar. Revisa tu conexión e intenta nuevamente.');
      throw error;
    } finally { clearTimeout(timeout); }
  };
  return {
    request(path, method = 'GET', body) {
      if (method !== 'GET') return execute(path, method, body);
      if (pendingReads.has(path)) return pendingReads.get(path);
      const promise = execute(path, method, body);
      pendingReads.set(path, promise);
      const clear = () => { if (pendingReads.get(path) === promise) pendingReads.delete(path); };
      void promise.then(clear, clear);
      return promise;
    },
    reset() { generation++; pendingReads.clear(); },
  };
}
