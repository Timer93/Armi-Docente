import DOMPurify from 'dompurify';
import { createApiClient } from '../public/api-client.js';
import { getWebIdentity } from './runtime.js';
import { fieldsFor } from '../src/edit-fields.js';

const client = createApiClient({ onUnauthorized: () => window.location.reload() });
export const academicApi = (path: string, method = 'GET', body?: unknown) => client.request(path, method, body);
type Row = { id: string; value: any; revision: number };
const cache = new Map<string, Promise<Array<Row>>>();
const loadedRows = new Map<string, Row[]>();
const snapshots = new Map<string, string | null>();
const queues = new Map<string, Promise<any>>();
let activeWrites = 0;
let writeError: Error | null = null;
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
    const rows: Row[] = [];
    let cursor = '';
    let snapshot = '';
    let revision: number | undefined;
    do {
      const result = await academicApi('/api/academic/records?' + new URLSearchParams({ dataset, cursor, ...(snapshot ? { snapshot } : {}), ...(revision !== undefined ? { revision: String(revision) } : {}) }));
      if (getWebIdentity()?.user.id !== identity.user.id) throw new Error('La cuenta cambió. Recarga la página.');
      if (snapshot && result.snapshotId !== snapshot) throw new Error('La copia cambió. Recarga la página.');
      snapshot = result.snapshotId || '';
      revision = result.revision;
      snapshots.set(key, result.snapshotId);
      rows.push(...result.records.map((row: any) => ({ id: row.id, value: displayValue(row.value), revision: row.revision || 0 })));
      if (rows.length > 10000) throw new Error('La copia excede el límite de esta vista.');
      cursor = result.nextCursor || '';
    } while (cursor);
    loadedRows.set(key,rows);
    return rows;
  })();
  cache.set(key, pending);
  void pending.catch(() => { cache.delete(key); });
  return pending;
}

export function saveAcademic(dataset: string, id: string, value: any, action = 'save') {
  const owner = getWebIdentity()?.user.id;
  const key = `${owner}:${dataset}`;
  const queueKey = `${key}:${id}`;
  // Capture only the changed fields now; later saves must not overwrite a
  // concurrent local save with the rest of an older form object.
  const baseline = readAcademic(dataset);
  const changesPromise = baseline.then(rows => {
    const row = rows.find(row => row.id === id);
    return Object.fromEntries(fieldsFor(dataset).filter(field => value[field] !== undefined && value[field] !== row?.value[field]).map(field => [field,value[field]]));
  });
  const pending = (queues.get(queueKey) || Promise.resolve()).then(async () => {
    if (writeError) throw writeError;
    if (getWebIdentity()?.user.id !== owner) throw new Error('La cuenta cambió. Recarga la página.');
    const rows = await readAcademic(dataset);
    const row = rows.find(row => row.id === id);
    const changes = action === 'delete' ? {} : await changesPromise;
    if (action === 'save' && row && !Object.keys(changes).length) return row;
    activeWrites++;
    window.dispatchEvent(new CustomEvent('armi-web-save', {detail:{state:'saving'}}));
    try {
      const saved = await academicApi('/api/academic/edit','PUT',{dataset,id,changes,action,expectedRevision:row?.revision || 0,snapshotId:snapshots.get(key) || null,operationId:crypto.randomUUID()});
      // Merge acknowledgements synchronously. Saves of different students may
      // finish together; neither may replace the other's cached result.
      const updated = (loadedRows.get(key) || rows).filter(row => row.id !== id);
      if (!saved.deleted) updated.push({...saved,value:displayValue(saved.value)});
      loadedRows.set(key,updated);
      cache.set(key,Promise.resolve(updated));
      return saved;
    } catch (error) { writeError = error as Error; throw error; }
    finally {
      activeWrites--;
      window.dispatchEvent(new CustomEvent('armi-web-save', {detail: writeError ? {state:'error',message:writeError.message} : {state:activeWrites ? 'saving':'saved'}}));
    }
  });
  queues.set(queueKey,pending);
  void pending.catch(error => {
    writeError ||= error;
    window.dispatchEvent(new CustomEvent('armi-web-save',{detail:{state:'error',message:error.message}}));
  });
  // Failed saves stay rejected for this record until reload; stale forms cannot
  // quietly retry over changes in another tab.
  return pending;
}
