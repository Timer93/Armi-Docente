import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const uuidSource = fs.readFileSync('utils/randomUuid.ts', 'utf8');
const loadUuid = crypto => {
  const context = { exports: {}, crypto };
  vm.runInNewContext(compile(uuidSource), context);
  return context.exports.createRandomUuid;
};
const native = { randomUUID() { assert.equal(this, native); return 'native-uuid'; } };
assert.equal(loadUuid(native)(), 'native-uuid');
// Simulate an HTTP LAN: crypto exists, but randomUUID is absent.
const createRandomUuid = loadUuid({ getRandomValues: bytes => webcrypto.getRandomValues(bytes) });
const ids = new Set(Array.from({ length: 1000 }, createRandomUuid));
assert.equal(ids.size, 1000);
for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const bootstrapModule = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync('utils/portableBootstrap.ts', 'utf8')), bootstrapModule);
const api = fs.readFileSync('services/apiService.ts', 'utf8');
const bootstrapSource = api.slice(api.indexOf('let portableBootstrapReceipt:'), api.indexOf('export const getCloudSyncStatus'));
const requests = [];
const context = {
  exports: {}, createRandomUuid, runPortableBootstrap: bootstrapModule.exports.runPortableBootstrap,
  BACKEND_URL: '/api', AbortController, setTimeout, clearTimeout,
  readJsonResponse: response => response.json(),
  fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    return { json: async () => requests.length === 1
      ? { success: false, message: 'Reintento de conexión' }
      : { success: true, data: { job: { id: body.requestId, status: 'completed', result: { success: true } } } } };
  },
};
vm.runInNewContext(compile(bootstrapSource), context);
const state = { armi_schedule: 'datos guardados' };
assert.equal((await context.exports.bootstrapPortableState(state)).success, false);
assert.equal((await context.exports.bootstrapPortableState(state)).success, true);
assert.equal(requests[0].body.requestId, requests[1].body.requestId, 'Retries must keep the same receipt.');
assert.equal(requests[1].body.state.armi_schedule, state.armi_schedule);
assert.equal(requests[1].url, '/api/sync/bootstrap');
assert.equal((await context.exports.bootstrapPortableState(state)).success, true);
assert.notEqual(requests[2].body.requestId, requests[1].body.requestId, 'A completed receipt must be released.');
for (const file of ['services/apiService.ts', 'components/evaluation/TeacherMessages.tsx', 'components/evaluation/StudentForumMonitor.tsx']) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /crypto\.randomUUID\s*\(/, file);
}
console.log('OK: native UUID, HTTP LAN fallback, UUID v4 format, bootstrap retry receipts and browser call sites.');
