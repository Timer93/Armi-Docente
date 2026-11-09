import assert from 'node:assert/strict';
import { createContinuousSyncQueue } from '../backend/continuousSyncQueue.js';

let time = 0;
let id = 0;
const timers = new Map();
let runs = 0;
let release;
const queue = createContinuousSyncQueue(async () => {
  runs++;
  if (runs === 1) await new Promise((resolve) => { release = resolve; });
}, {
  now: () => time,
  setTimer: (fn, delay) => { const key = ++id; timers.set(key, { fn, at: time + delay }); return key; },
  clearTimer: (key) => timers.delete(key),
});
queue.request(1500);
for (time = 100; time <= 1400; time += 100) queue.request(1500);
assert.equal(timers.size, 1);
assert.equal([...timers.values()][0].at, 1500, 'Continuous edits must not postpone the first copy.');
const first = [...timers.values()][0]; timers.clear(); time = 1500;
const work = first.fn();
time = 1600; queue.request(750);
assert.equal(timers.size, 0, 'No concurrent copy while the first is running.');
time = 2500; release(); await work;
assert.equal(timers.size, 1, 'Edits during the copy must get a second pass.');
const second = [...timers.values()][0]; timers.clear(); await second.fn();
assert.equal(runs, 2);
queue.request(1000); queue.stop();
assert.equal(timers.size, 0);
console.log('OK: bounded copy deadline, coalesced requests and follow-up after concurrent edits.');
