import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compiled = ts.transpileModule(fs.readFileSync('utils/closeAttempt.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createCloseAttempt } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const timers = new Map(); let timerId = 0;
const makeAttempt = () => createCloseAttempt({
  setTimer: callback => { timers.set(++timerId, callback); return timerId; },
  clearTimer: id => timers.delete(id),
});
let resolveLate, closed = 0;
const attempt = makeAttempt();
const pending = attempt.wait(new Promise(resolve => { resolveLate = resolve; })).then(() => { closed++; });
const expired = assert.rejects(pending, /tardando demasiado/);
[...timers.values()][0]();
await expired;
resolveLate({ success: true });
await Promise.resolve();
assert.equal(closed, 0, 'A late successful upload must not close a window after timeout');
assert.equal(timers.size, 0);
const cancelled = makeAttempt();
const cancelledResult = assert.rejects(cancelled.wait(new Promise(() => {})), /canceló/);
cancelled.cancel();
await cancelledResult;
assert.equal(timers.size, 0);
const retry = makeAttempt();
await retry.wait(Promise.resolve({ success: true })).then(() => { closed++; });
retry.dispose();
assert.equal(closed, 1, 'A fresh retry can finish normally');
assert.equal(timers.size, 0);
console.log('OK: timeout, cancellation, late replies ignored, timers cleared and successful retry.');
