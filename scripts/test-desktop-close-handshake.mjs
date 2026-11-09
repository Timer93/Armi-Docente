import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import close from '../electron/close-handshake.cjs';

let localCloses = 0, syncRequests = 0, fallbacks = 0;
const timers = new Map(); let nextTimer = 0;
const guard = close.createCloseHandshake({
  closeWithoutRenderer: () => { localCloses++; },
  sendRequest: () => { syncRequests++; },
  onUnresponsive: () => { fallbacks++; },
  setTimer: fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimer: id => timers.delete(id),
});
guard.request(); guard.request();
assert.equal(localCloses, 1, 'Startup/error screen must close without a missing sync listener.');
assert.equal(syncRequests, 0);
assert.equal(timers.size, 0);
guard.cancel(); guard.setReady(true); guard.request(); guard.request();
assert.equal(syncRequests, 1, 'Repeated X clicks must not duplicate a protected close.');
guard.acknowledge();
assert.equal(timers.size, 0, 'A responsive sync dialog keeps control of protected closure.');
assert.equal(localCloses, 1);

// After a conflict the renderer has acknowledged the request, but has not
// approved exit. A later title-bar X must not be swallowed by pending=true.
guard.request();
assert.equal(syncRequests, 2, 'X reaches the renderer again after a handled conflict.');
guard.request();
assert.equal(syncRequests, 2, 'Clicks awaiting acknowledgement are still deduplicated.');
guard.acknowledge();
guard.cancel(); // Seguir trabajando
guard.request();
assert.equal(syncRequests, 3, 'Seguir trabajando releases the next safe-close attempt.');
guard.acknowledge();
guard.cancel(); guard.request();
const watchdog = [...timers.values()][0]; watchdog();
assert.equal(fallbacks, 1, 'A missing acknowledgement must offer a native exit.');
guard.cancel(); guard.setReady(false); guard.request();
assert.equal(localCloses, 2, 'After reload/crash a stale listener must not block closure.');
guard.setReady(true); guard.cancel(); guard.request(); guard.acknowledge();
guard.setReady(false); guard.request();
assert.equal(localCloses, 3, 'A crash during an acknowledged attempt releases the pending latch.');
guard.dispose(); assert.equal(timers.size, 0);

const ipc = new EventEmitter(); const sent = [];
ipc.send = (...args) => sent.push(args);
const exposed = {};
vm.runInNewContext(fs.readFileSync('electron/preload.cjs', 'utf8'), {
  require: name => {
    assert.equal(name, 'electron');
    return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } } };
  },
});
let received = 0;
const unsubscribe = exposed.armiApp.onBeforeQuitAttempt(() => { received++; });
assert.deepEqual(sent.at(-1), ['app:close-handler-ready', true]);
ipc.emit('app:before-close');
assert.equal(received, 1);
assert.deepEqual(sent.at(-1), ['app:close-request-received']);
unsubscribe();
assert.deepEqual(sent.at(-1), ['app:close-handler-ready', false]);
assert.equal(ipc.listenerCount('app:before-close'), 0);
console.log('OK: startup closure, normal protected closure, duplicate clicks, unresponsive UI and preload registration/acknowledgement.');
