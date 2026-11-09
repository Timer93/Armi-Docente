import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { createInteractiveAttemptStore } from '../backend/interactiveAttemptStore.js';

// A small DOM double tests the actual controller's messages and state machine;
// it does not claim to render CSS or replace visual browser verification.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.contentWindow = tag === 'iframe' ? { postMessage() {} } : undefined; }
  set innerHTML(value) {
    this.markup = value; this.children = [];
    for (const match of value.matchAll(/<([a-z]+)\b([^>]*)>/g)) {
      const node = new Element(match[1]);
      for (const attr of match[2].matchAll(/\b(class|id|data-[\w-]+|disabled)(?:="([^"]*)")?/g)) {
        node.attrs[attr[1]] = attr[2] || ''; if (attr[1] === 'class') node.className = attr[2]; if (attr[1] === 'id') node.id = attr[2]; if (attr[1] === 'disabled') node.disabled = true;
      }
      this.appendChild(node);
    }
  }
  get innerHTML() { return this.markup || ''; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  setAttribute(key, value) { this.attrs[key] = value; }
  querySelector(selector) {
    const matches = (node) => selector.startsWith('.') ? String(node.className || '').split(' ').includes(selector.slice(1))
      : selector.startsWith('[') ? selector.slice(1, -1) in node.attrs : selector.startsWith('#') ? node.id === selector.slice(1) : node.tag === selector;
    for (const child of this.children) { if (matches(child)) return child; const nested = child.querySelector(selector); if (nested) return nested; }
    return null;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); }
  focus() { this.focused = true; }
}
const db = new Database(':memory:');
let clock = 1000000, touches = 0, deliveries = 0, failDelivery = false;
const store = createInteractiveAttemptStore(db, { now: () => clock });
const key = { sessionId: 's', activityId: 'a', mode: 'individual', scopeKey: '1' };
const events = {}, intervals = new Map(), timeouts = new Map(); let timerId = 0;
const body = new Element('body');
const document = { body, createElement: (tag) => new Element(tag), getElementById: (id) => body.querySelector(`#${id}`), addEventListener: (name, fn) => { events[name] = fn; } };
const window = { addEventListener: (name, fn) => { events[name] = fn; } };
const navigator = { userAgent: 'Mozilla Windows', platform: 'Win32', maxTouchPoints: 0 };
const api = async (url, options) => {
  if (!options) return { title: 'Practice', mode: 'individual', recoverySupported: true, attempt: store.publicState(store.get(key)) };
  const payload = JSON.parse(options.body);
  if (url.endsWith('/result')) {
    if (failDelivery) { failDelivery = false; throw new Error('Temporary network failure'); }
    store.complete(key, payload.attemptToken); deliveries += 1; return { score: payload.score, message: 'Recorded' };
  }
  if (payload.action === 'start') return { attempt: store.start(key), html: '<html>practice</html>' };
  if (payload.action === 'continue') { if (store.get(key).status === 'paused') store.grant(key); return { attempt: store.resume(key), html: '<html>same practice</html>' }; }
  if (payload.action === 'progress') return { attempt: store.save(key, payload.attemptToken, payload.checkpoint) };
  if (payload.action === 'abandon') return { attempt: store.abandon(key, payload.attemptToken) };
  const row = store.get(key); return { attempt: store.publicState(row, row?.status === 'paused') };
};
const context = vm.createContext({ window, document, navigator, screen: { width: 1920, height: 1080 }, performance: { now: () => clock },
  Date, console, alert: (message) => { throw new Error(message); },
  setTimeout: (fn) => { const id = ++timerId; timeouts.set(id, fn); return id; }, clearTimeout: (id) => timeouts.delete(id),
  setInterval: (fn) => { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval: (id) => intervals.delete(id), fetch: async () => ({ ok: true }) });
vm.runInContext(fs.readFileSync('backend/public/student-practice.js', 'utf8'), context);
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const ticks = async () => { for (const fn of [...intervals.values()]) fn(); await settle(); };
const open = () => window.armiPracticePortal.open('armi-activity:s:a', { api, touch: () => { touches += 1; }, token: () => 'portal-token' });
const frame = () => body.querySelector('iframe');
const message = async (payload, source = frame().contentWindow) => { await events.message({ source, data: { version: 1, ...payload } }); await settle(); };
const checkpoint = { state: { question: 3, answers: ['A', 'C'], order: [3, 1, 2] }, score: 8, maxScore: 20 };
try {
  await open(); assert.equal(store.get(key), undefined, 'Opening instructions does not consume an attempt');
  await body.querySelector('.practice-primary').onclick();
  assert.ok(frame()); const deadline = store.get(key).deadline_ms;
  const touchesBefore = touches;
  await message({ type: 'armi:activity-interaction' }); assert.equal(touches, touchesBefore + 1, 'Iframe interaction resets portal idle time');
  await message({ type: 'armi:activity-interaction' }, {}); assert.equal(touches, touchesBefore + 1, 'Foreign messages cannot reset idle');
  assert.equal(store.get(key).deadline_ms, deadline, 'Interaction does not reset practice time');
  await message({ type: 'armi:activity-progress', checkpoint });
  for (const fn of timeouts.values()) fn(); timeouts.clear(); await settle();
  assert.deepEqual(JSON.parse(store.get(key).checkpoint_json), checkpoint);
  let prevented = false; events.beforeunload({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  window.armiPracticePortal.close(); const warning = body.querySelector('.practice-exit-warning');
  assert.ok(warning); assert.equal(warning.querySelector('[data-stay]').focused, true); assert.equal(warning.querySelector('[data-leave]').disabled, true);
  warning.querySelector('[data-stay]').onclick(); assert.equal(store.get(key).status, 'running', 'Canceling exit does not close the attempt');
  clock = deadline; await ticks(); assert.equal(frame(), null); assert.equal(store.get(key).status, 'paused');
  await body.querySelector('.practice-primary').onclick(); assert.equal(store.get(key).stage, 2); assert.ok(frame());
  assert.deepEqual(JSON.parse(store.get(key).checkpoint_json), checkpoint);
  failDelivery = true;
  await message({ type: 'armi:activity-result', completed: true, score: 18, maxScore: 20 });
  const retry = body.querySelector('.practice-delivery-retry'); assert.ok(retry, 'Network errors allow retrying delivery, never solving again');
  await retry.onclick(); assert.equal(store.get(key).status, 'completed'); assert.equal(deliveries, 1); assert.equal(frame(), null);
  body.querySelector('.practice-primary').onclick();
  store.reset(key); await open(); await body.querySelector('.practice-primary').onclick();
  window.armiPracticePortal.close();
  for (let i = 0; i < 3; i++) await ticks();
  const leave = body.querySelector('[data-leave]'); assert.equal(leave.disabled, false); await leave.onclick();
  assert.equal(store.get(key).status, 'abandoned'); assert.equal(frame(), null);
  body.querySelector('.practice-primary').onclick(); store.reset(key);
  navigator.userAgentData = { mobile: false, platform: 'Android' }; await open();
  assert.match(body.querySelector('[data-practice-content]').innerHTML, /requiere una computadora/);
  assert.equal(store.get(key), undefined, 'Mobile rejection does not consume an attempt');
  console.log('OK: actual portal controller forwards iframe activity, protects clock, rejects foreign messages, confirms exit safely, resumes saved state and retries delivery without replay.');
} finally { db.close(); }
