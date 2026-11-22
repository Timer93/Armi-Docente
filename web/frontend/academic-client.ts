import DOMPurify from 'dompurify';
import { createApiClient } from '../public/api-client.js';
import { getWebIdentity } from './runtime.js';

const client = createApiClient({ onUnauthorized: () => window.location.reload() });
export const academicApi = (path: string, method = 'GET', body?: unknown) => client.request(path, method, body);
const cache = new Map<string, Promise<Array<{ id: string; value: any }>>>();
function displayValue(value: any): any {
  if (typeof value === 'string' && /<[a-z][\s\S]*>/i.test(value)) return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'span', 'div', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'blockquote'],
    ALLOWED_ATTR: ['colspan', 'rowspan'], ALLOW_DATA_ATTR: false,
  });
  if (Array.isArray(value)) return value.map(displayValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, displayValue(child)]));
  return value;
}
export function readAcademic(dataset: string) {
  const identity = getWebIdentity();
  if (!identity) return Promise.resolve([]);
  const key = `${identity.user.id}:${dataset}`;
  if (cache.has(key)) return cache.get(key)!;
  const pending = (async () => {
    const rows: Array<{ id: string; value: any }> = [];
    let cursor = '';
    let snapshot = '';
    do {
      const result = await academicApi('/api/academic/records?' + new URLSearchParams({ dataset, cursor, ...(snapshot ? { snapshot } : {}) }));
      if (getWebIdentity()?.user.id !== identity.user.id) throw new Error('La cuenta cambió. Recarga la página.');
      if (snapshot && result.snapshotId !== snapshot) throw new Error('La copia cambió. Recarga la página.');
      snapshot = result.snapshotId || '';
      rows.push(...result.records.map((row: any) => ({ id: row.id, value: displayValue(row.value) })));
      if (rows.length > 10000) throw new Error('La copia excede el límite de esta vista.');
      cursor = result.nextCursor || '';
    } while (cursor);
    return rows;
  })();
  cache.set(key, pending);
  void pending.catch(() => { cache.delete(key); });
  return pending;
}
