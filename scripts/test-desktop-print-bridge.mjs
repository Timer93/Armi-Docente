import assert from 'node:assert/strict';
import { installDesktopPrint } from '../utils/desktopPrint.ts';
const elements = [];
const element = () => ({ children: [], appendChild(child) { this.children.push(child); elements.push(child); }, setAttribute() {}, remove() { this.removed = true; } });
globalThis.document = { title: 'Mi registro', head: element(), body: element(), createElement: element };
const nativePrint = () => {};
globalThis.window = { print: nativePrint };
installDesktopPrint(); assert.equal(window.print, nativePrint, 'Web printing remains native.');
let calls = 0, resolve, listener, detached = false;
const errors = [];
window.alert = message => errors.push(message);
window.armiApp = {
  previewPrint: options => { calls++; assert.equal(options.title, document.title); return new Promise(done => { resolve = done; }); },
  onPrintRequest: callback => { listener = callback; return () => { detached = true; }; }
};
const dispose = installDesktopPrint();
window.print(); window.print(); listener();
assert.equal(calls, 1, 'Repeated clicks and Ctrl+P share one pending preview.');
const overlay = document.body.children.at(-1); assert.equal(overlay.className, 'armi-print-preparing');
resolve({ success: true }); await new Promise(done => setImmediate(done));
assert.equal(overlay.removed, true); assert.equal(errors.length, 0);
listener(); assert.equal(calls, 2);
resolve({ success: false, message: 'Error de prueba' }); await new Promise(done => setImmediate(done));
assert.deepEqual(errors, ['Error de prueba']); assert.equal(document.body.children.at(-1).removed, true);
dispose(); assert.equal(window.print, nativePrint); assert.equal(detached, true);
console.log('OK: global desktop print bridge, keyboard request, busy guard, errors, cleanup and unchanged web printing.');
