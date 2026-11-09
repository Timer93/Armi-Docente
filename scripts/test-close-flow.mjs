import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import handshake from '../electron/close-handshake.cjs';

// Exercise the actual component handlers with an isolated hook/IPC harness.
// No desktop application, user database or Drive connection is used.
const apiNames = ['discardPendingCloudSync', 'getCloudSyncStatus', 'getLocalCloudSyncStatus', 'getResourceDeliveryStatus', 'markPendingCloudSync', 'pullCloudSync', 'pushCloudSync', 'saveCloudFrontendState', 'saveCloudSyncConfig'];
const bundled = await build({
  entryPoints: ['components/SyncLifecycleManager.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
  tsconfigRaw: { compilerOptions: { jsx: 'react' } },
  plugins: [{ name: 'close-harness', setup(builder) {
    builder.onResolve({ filter: /^(react|.*AuthContext|.*apiService|.*cloudSyncState)$/ }, args => ({ path: args.path, namespace: 'harness' }));
    builder.onLoad({ filter: /.*/, namespace: 'harness' }, args => {
      if (args.path === 'react') return { contents: `const h=globalThis.h;
        export const useState=initial=>{const i=h.cursor++;if(!(i in h.slots))h.slots[i]=initial;return[h.slots[i],v=>h.slots[i]=typeof v==='function'?v(h.slots[i]):v];};
        export const useRef=initial=>{const i=h.cursor++;return h.slots[i]||(h.slots[i]={current:initial});};
        export const useMemo=fn=>fn(); export const useEffect=fn=>h.effects.push(fn);
        export default {Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}})};` };
      if (args.path.endsWith('AuthContext')) return { contents: 'export const useAuth=()=>({session:null});' };
      if (args.path.endsWith('apiService')) return { contents: apiNames.map(name => `export const ${name}=(...args)=>globalThis.h.api.${name}(...args);`).join('\n') };
      return { contents: `export const CLOUD_SYNC_EVENT='sync'; export const collectArmiLocalState=()=>({draft:'saved'}); export const applyArmiLocalState=()=>{}; export const emitCloudSyncUpdated=()=>{};` };
    });
  } }], logLevel: 'silent',
});
const timers = new Map(); let nextTimer = 0;
const h = { slots: [], cursor: 0, effects: [], api: {} };
const context = { h, module: { exports: {} }, console, setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id), navigator: { onLine: true } };
let listener, latestTask, closes = 0, pushes = 0;
const guard = handshake.createCloseHandshake({ sendRequest: () => { guard.acknowledge(); latestTask = listener(); }, closeWithoutRenderer: () => { closes++; }, onUnresponsive: () => { throw new Error('Unexpected missing renderer'); } });
context.window = { armiApp: {
  onBeforeQuitAttempt: callback => { listener = callback; guard.setReady(true); return () => guard.setReady(false); },
  continueQuit: async () => { closes++; }, cancelQuit: async () => guard.cancel(),
  requestQuit: async () => { guard.cancel(); guard.request(); },
} };
vm.runInNewContext(bundled.outputFiles[0].text, context);
const render = () => { h.cursor = 0; h.effects = []; return context.module.exports.SyncLifecycleManager(); };
const text = node => !node ? '' : typeof node === 'string' ? node : (node.props?.children || (Array.isArray(node) ? node : [])).map(text).join('');
const buttons = (node, result = []) => {
  if (node?.type === 'button') result.push(node);
  for (const child of node?.props?.children || (Array.isArray(node) ? node : [])) buttons(child, result);
  return result;
};
const button = label => { const found = buttons(render()).find(node => text(node) === label); assert.ok(found, `Missing ${label}`); return found; };
const ok = async () => ({ success: true });
const cloudStatus = { config: { mode: 'drive_mirror', autoSyncOnClose: true }, hasUnsyncedChanges: true };
Object.assign(h.api, Object.fromEntries(apiNames.map(name => [name, ok])), {
  getLocalCloudSyncStatus: async () => ({ success: true, data: cloudStatus }),
  pushCloudSync: async () => { pushes++; return { success: false, conflict: true, message: 'Conflicto protegido' }; },
});
render();
const setupClose = h.effects.find(fn => fn.toString().includes('onBeforeQuitAttempt'));
assert.ok(setupClose);
const cleanup = setupClose();
guard.request(); await latestTask;
assert.equal(closes, 0);
assert.match(text(render()), /Conflicto protegido/);
await button('Seguir trabajando').props.onClick();
guard.request(); await latestTask;
assert.equal(pushes, 2, 'X starts another safe attempt after Seguir trabajando');
await button('Reintentar cierre').props.onClick(); await latestTask;
assert.equal(pushes, 3, 'Retry works directly from a conflict dialog');

let finishUpload;
h.api.pushCloudSync = () => { pushes++; return new Promise(resolve => { finishUpload = resolve; }); };
await button('Reintentar cierre').props.onClick();
for (let i = 0; i < 12 && !finishUpload; i++) await Promise.resolve();
assert.ok(finishUpload);
const activePushes = pushes;
guard.request(); await latestTask;
assert.equal(pushes, activePushes, 'Repeated X does not start simultaneous uploads');
const deadline = [...timers.values()][0]; assert.ok(deadline); deadline();
// latestTask was the ignored duplicate; drain the original timed-out handler.
for (let i = 0; i < 12; i++) await Promise.resolve();
assert.match(text(render()), /tardando demasiado/);
assert.equal(button('Salir solo local').props.disabled, false);
await button('Seguir trabajando').props.onClick();
finishUpload({ success: true });
for (let i = 0; i < 12; i++) await Promise.resolve();
assert.equal(closes, 0, 'Late success cannot close after the user resumes work');

h.api.saveCloudFrontendState = async () => ({ success: false, message: 'No se pudo guardar' });
guard.request(); await latestTask;
assert.equal(button('Salir solo local').props.disabled, true);
await button('Salir solo local').props.onClick();
assert.equal(closes, 0, 'Never claim local save if it failed');
h.api.saveCloudFrontendState = ok;
h.api.getLocalCloudSyncStatus = async () => ({ success: false, message: 'Estado no disponible' });
await button('Reintentar cierre').props.onClick(); await latestTask;
assert.match(text(render()), /Estado no disponible/);
assert.equal(closes, 0, 'Unknown sync status must not approve exit automatically');
h.api.getLocalCloudSyncStatus = async () => ({ success: true, data: { config: { mode: 'local' } } });
await button('Reintentar cierre').props.onClick(); await latestTask;
assert.equal(closes, 1, 'A healthy local retry finishes normally');
h.api.getLocalCloudSyncStatus = async () => ({ success: true, data: cloudStatus });
let checkpointRequests = 0;
h.api.markPendingCloudSync = async payload => {
  assert.equal(payload.reason, 'close-attempt');
  assert.equal(payload.deferRemote, true);
  checkpointRequests++;
  return { success: true, data: { closePrepared: true, localSaved: true, cloudDeliveryPending: true } };
};
const pushesBeforeLocalClose = pushes;
guard.cancel(); guard.request(); await latestTask;
assert.equal(closes, 2, 'Mirror closure finishes after a confirmed local checkpoint');
assert.equal(checkpointRequests, 1);
assert.equal(pushes, pushesBeforeLocalClose, 'Closing must not start or wait for a full upload');
assert.match(text(render()), /volver a abrir ARMI/);
h.api.markPendingCloudSync = async () => ({ success: false, message: 'No se pudo confirmar el guardado' });
guard.cancel(); guard.request(); await latestTask;
assert.equal(closes, 2, 'A failed checkpoint must not authorize automatic exit');
assert.match(text(render()), /No se pudo confirmar/);
cleanup(); guard.dispose();
assert.equal(timers.size, 0);
console.log('OK: real close handlers: conflict, resume, X, retry, timeout, duplicate clicks, late upload, local save failure and safe exit.');
