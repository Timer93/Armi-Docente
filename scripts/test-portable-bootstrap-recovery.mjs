import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createPortableBootstrapJobs } from '../backend/portableBootstrapJobs.js';
import readiness from '../electron/backend-readiness.cjs';

const source = ts.transpileModule(fs.readFileSync('utils/portableBootstrap.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { runPortableBootstrap } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
let release, calls = 0;
const jobs = createPortableBootstrapJobs(async state => {
  calls++;
  await new Promise(resolve => { release = resolve; });
  return { success: true, data: { frontendState: { keys: state } } };
});
const receipt = jobs.start({ armi_schedule: 'saved' }, 'request1');
assert.equal(receipt.status, 'queued');
assert.equal(calls, 0, 'Receipt must return before recovery touches disk.');
await tick();
assert.equal(jobs.start({ armi_schedule: 'saved' }, 'request1').id, receipt.id);
assert.equal(jobs.start({ armi_schedule: 'saved' }, 'request2').id, receipt.id);
assert.equal(calls, 1, 'Connection retries must not run two recoveries.');
release(); await tick();
assert.deepEqual(jobs.get(receipt.id).result.data.frontendState.keys, { armi_schedule: 'saved' });
assert.equal(jobs.start({}, 'request1').status, 'completed', 'A lost final response still returns the completed receipt.');
const failure = createPortableBootstrapJobs(async () => { throw new Error('Drive no disponible'); });
failure.start({}, 'failure'); await tick();
assert.equal(failure.get('failure').result.success, false);

let time = 0, starts = 0, polls = 0;
const done = { success: true, data: { frontendState: { keys: { armi_schedule: 'restored' } } } };
const result = await runPortableBootstrap({
  now: () => time, pause: async ms => { time += ms; }, timeoutMs: 20_000,
  start: async () => {
    starts++;
    if (starts === 1) throw new TypeError('Service still starting');
    return { success: true, data: { job: { id: 'one', status: 'running' } } };
  },
  poll: async id => {
    assert.equal(id, 'one'); polls++;
    if (polls <= 2) throw new DOMException('Slow disk', 'AbortError');
    return { success: true, data: { job: { id, status: 'completed', result: done } } };
  },
});
assert.deepEqual(result, done);
assert.equal(starts, 2, 'Polling timeouts must not submit bootstrap again.');

let restarted = false;
const resumed = await runPortableBootstrap({
  start: async () => ({ success: true, data: { job: { id: 'restarted', status: 'running' } } }),
  poll: async id => {
    if (!restarted) { restarted = true; return { success: false, code: 'BOOTSTRAP_JOB_NOT_FOUND' }; }
    return { success: true, data: { job: { id, status: 'completed', result: done } } };
  }, pause: async () => {},
});
assert.deepEqual(resumed, done, 'A restarted backend must resume startup.');
const controller = new AbortController(); controller.abort();
await assert.rejects(runPortableBootstrap({ signal: controller.signal, start: async () => { throw new Error('Must not start'); }, poll: async () => ({ success: false }) }), { name: 'AbortError' });
time = 0;
const timedOut = await runPortableBootstrap({
  now: () => time, pause: async ms => { time += ms; }, timeoutMs: 2000,
  start: async () => { throw new TypeError('Offline'); }, poll: async () => ({ success: false }),
});
assert.equal(timedOut.success, false);
assert.match(timedOut.message, /sin borrar datos/);

let healthCalls = 0;
assert.equal(await readiness.waitForServer('http://local/health', 200, {
  requestTimeoutMs: 15, pollMs: 1,
  fetchImpl: async (_url, { signal }) => {
    healthCalls++;
    if (healthCalls > 1) return { ok: true };
    return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Timed out')), { once: true }));
  },
}), true, 'A stalled health probe must time out and allow a later healthy response.');
console.log('OK: deferred startup, duplicate requests, lost responses, slow polls, restart, cancellation and bounded health probes.');
