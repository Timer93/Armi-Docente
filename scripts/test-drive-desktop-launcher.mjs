import assert from 'node:assert/strict';
import { createDriveDesktopLauncher } from '../backend/driveDesktopLauncher.js';

let time = 100_000;
let running = false;
let launches = 0;
let probes = 0;
const launcher = createDriveDesktopLauncher({
  now: () => time,
  probe: async () => { probes++; return running; },
  launch: async () => { launches++; },
});
const automatic = { executablePath: 'fake-drive.exe', automatic: true };
await Promise.all(Array.from({ length: 20 }, () => launcher.observe(automatic)));
assert.equal(launches, 1, 'Concurrent status consumers must share one launch.');
assert.equal(probes, 1);
time += 120_000;
await launcher.observe(automatic);
assert.equal(launches, 1, 'A failed/closed Drive must not be retried automatically.');
await launcher.observe({ ...automatic, manual: true });
assert.equal(launches, 2, 'An explicit manual retry is allowed.');

running = true;
const alreadyOpen = createDriveDesktopLauncher({ now: () => time, probe: async () => running, launch: async () => { launches++; } });
await alreadyOpen.observe(automatic);
running = false;
time += 120_000;
await alreadyOpen.observe(automatic);
assert.equal(launches, 2, 'Respect the user closing an already-running Drive.');

const unknown = createDriveDesktopLauncher({ probe: async () => { throw new Error('tasklist timeout'); }, launch: async () => { launches++; } });
assert.equal((await unknown.observe(automatic)).processRunning, null);
await unknown.observe({ ...automatic, manual: true });
assert.equal(launches, 2, 'A failed query is not evidence that Drive is closed.');

let failures = 0;
const failing = createDriveDesktopLauncher({ probe: async () => false, launch: async () => { failures++; throw new Error('spawn failed'); } });
assert.equal((await failing.observe(automatic)).error, 'spawn failed');
await failing.observe(automatic);
assert.equal(failures, 1);
console.log('OK: one automatic launch, concurrent queries, manual retry, user closure and errors. No real Drive process launched.');
