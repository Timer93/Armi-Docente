const DEFAULT_TARGETS = ['https://www.googleapis.com/generate_204', 'https://www.google.com/generate_204', 'https://www.cloudflare.com/'];
const OFFLINE_CODES = new Set(['ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN']);

export const createInternetConnectivityMonitor = ({ requester = fetch, now = Date.now, onChange = () => {}, targets = DEFAULT_TARGETS, timeoutMs = 1500 } = {}) => {
  let online = null;
  let checkedAt = null;
  let pending = null;
  const snapshot = () => ({ online, checkedAt: checkedAt === null ? null : new Date(checkedAt).toISOString(), checking: pending !== null });
  const check = ({ force = false, wait = true } = {}) => {
    const freshFor = online === true ? 3000 : 1500;
    if (!force && checkedAt !== null && now() - checkedAt < freshFor) return Promise.resolve(snapshot());
    if (!pending) {
      pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const failures = [];
        let result = null;
        try {
          await Promise.any(targets.map(async url => {
            try {
              const response = await requester(url, { method: 'HEAD', cache: 'no-store', redirect: 'manual', signal: controller.signal });
              // An authenticated HTTPS response proves reachability even if
              // that particular service returns 403/404 rather than 204.
              if (response.status >= 200 && response.status < 500) return;
              throw new Error('Connectivity probe inconclusive');
            } catch (error) { failures.push(error); throw error; }
          }));
          result = true;
        } catch {
          if (failures.length === targets.length && failures.every(error => OFFLINE_CODES.has(error?.cause?.code || error?.code))) result = false;
        } finally { clearTimeout(timer); controller.abort(); }
        const previous = online;
        online = result;
        checkedAt = now();
        if (previous !== online) onChange({ online, previous });
      })().finally(() => { pending = null; });
    }
    return wait ? pending.then(snapshot) : Promise.resolve(snapshot());
  };
  return { check, snapshot };
};
