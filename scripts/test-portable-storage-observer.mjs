import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
class FakeStorage {
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
  clear() { Object.keys(this).forEach(key => delete this[key]); }
}
globalThis.Storage = FakeStorage;
globalThis.window = new EventTarget();
window.localStorage = new FakeStorage();
const code = ts.transpileModule(fs.readFileSync('utils/observePortableStorage.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { observePortableStorage } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const original = Storage.prototype.setItem;
const batches = [];
let release;
const stop = observePortableStorage(async keys => {
  batches.push(keys);
  if (batches.length === 1) return new Promise(resolve => { release = resolve; });
  return true;
});
try {
  window.localStorage.setItem('armi_schedule_entries', '[1]');
  window.localStorage.setItem('armi_schedule_entries', '[2]');
  new Storage().setItem('armi_other_storage', 'ignored');
  window.localStorage.setItem('unrelated', 'ignored');
  await wait(650);
  assert.deepEqual(batches, [['armi_schedule_entries']]);
  window.localStorage.setItem('armi_assignments', '[3]');
  release(false);
  await wait(1150);
  assert.equal(batches.length, 2);
  assert.deepEqual(new Set(batches[1]), new Set(['armi_schedule_entries', 'armi_assignments']));
  window.localStorage.removeItem('armi_schedule_entries');
  await wait(650);
  assert.deepEqual(batches[2], ['armi_schedule_entries']);
  window.localStorage.clear();
  await wait(650);
  assert.deepEqual(batches[3], ['armi_assignments']);
} finally { stop(); }
assert.equal(Storage.prototype.setItem, original);
const seeded = [];
const stopSeeded = observePortableStorage(async keys => { seeded.push(keys); return seeded.length > 1; }, ['armi_edited_during_bootstrap']);
try {
  await wait(650);
  assert.deepEqual(seeded[0], ['armi_edited_during_bootstrap']);
  await wait(1100);
  assert.deepEqual(seeded[1], ['armi_edited_during_bootstrap'], 'Edits made before observation starts also retry failed saves');
} finally { stopSeeded(); }
console.log('OK: local edits coalesce, failed saves retry, in-flight edits survive, deletions propagate and storage methods restore.');
