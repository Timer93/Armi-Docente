import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildPracticeBridge } from '../backend/interactivePracticeRuntime.js';

let elapsed = 0, timer;
const messages = [], nodes = [], listeners = {};
const parent = { postMessage: (message) => messages.push(message) };
const window = { parent, addEventListener: (name, fn) => { listeners[`window:${name}`] = fn; } };
const document = { body: { appendChild: (node) => nodes.push(node) }, createElement: () => ({ style: {}, setAttribute() {} }),
  addEventListener: (name, fn) => { listeners[name] = fn; } };
const checkpoint = { state: { question: 3, answers: ['A', 'B'], order: [3, 1, 2], score: 8 }, score: 8, maxScore: 20 };
const script = buildPracticeBridge({ deadline: 301000, serverNow: 1000, checkpoint });
const context = vm.createContext({ window, document, performance: { now: () => elapsed },
  setInterval: (fn) => { timer = fn; }, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {} });
vm.runInContext(script.slice(8, -9), context);
let state = { question: 1, answers: [], order: [1, 2, 3], score: 0 };
window.ARMI_PRACTICE.register({ getState: () => state, restoreState: (value) => { state = value; },
  getResult: () => ({ score: state.score, maxScore: 20, answersSummary: 'Partial progress' }) });
assert.deepEqual(JSON.parse(JSON.stringify(state)), checkpoint.state);
assert.ok(messages.some((message) => message.type === 'armi:activity-ready'));
assert.equal(messages.find((message) => message.type === 'armi:activity-progress').checkpoint.state.question, 3);
state.question = 4; state.score = 12;
listeners.input();
assert.ok(messages.some((message) => message.type === 'armi:activity-interaction'));
assert.equal(messages.filter((message) => message.type === 'armi:activity-progress').at(-1).checkpoint.state.question, 4);
listeners['window:message']({ source: {}, data: { type: 'armi:activity-lock' } });
assert.equal(nodes.length, 0, 'Only the parent window can issue a lock');
elapsed = 300000; timer();
assert.equal(nodes.length, 1);
const before = messages.length;
listeners.input(); window.ARMI_PRACTICE.checkpoint();
assert.equal(messages.length, before, 'Expired activity no longer emits answers/progress or interaction');
const maliciousText = buildPracticeBridge({ checkpoint: { state: { answer: '</script><script>injected()</script>' } } });
assert.equal((maliciousText.match(/<\/script>/g) || []).length, 1, 'Saved answers cannot escape the injected script');
assert.equal(JSON.parse(maliciousText.match(/\)\((.*)\);<\/script>$/)[1]).checkpoint.state.answer, '</script><script>injected()</script>', 'Escaping preserves the actual saved answer');
console.log('OK: runtime restores exact question/order, forwards interaction, saves changes, ignores foreign locks, freezes at deadline and escapes stored text.');
