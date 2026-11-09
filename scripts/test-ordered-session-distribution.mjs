import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

const source = fs.readFileSync('utils/orderedSessionDistribution.ts', 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { distributeOrderedCriteriaByBlocks } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

const catalog = ['A', 'B', 'C', 'D'].map((cap, index) => ({
  id: String(index + 1), compId: 'EPT', cap,
}));
const suggested = [[1], [1], [2], [2], [3], [4], [4], [4]];
const result = distributeOrderedCriteriaByBlocks(8, catalog, suggested);
assert.deepEqual(result.map((items) => items[0].cap), ['A', 'A', 'B', 'B', 'C', 'D', 'D', 'D']);
assert.ok(result.every((items) => items.length > 0), 'Ninguna sesión debe quedar vacía.');

const unorderedSuggestion = [[1], [4], [2], [1], [3], [4], [2], [4]];
const ordered = distributeOrderedCriteriaByBlocks(8, catalog, unorderedSuggestion)
  .map((items) => items[0].cap);
assert.deepEqual([...new Set(ordered)], ['A', 'B', 'C', 'D']);
assert.ok(ordered.every((cap, index) => index === 0 || catalog.findIndex((item) => item.cap === cap)
  >= catalog.findIndex((item) => item.cap === ordered[index - 1])), 'La secuencia no debe retroceder.');

const detailedCatalog = [
  { id: 'A1', compId: 'EPT', cap: 'A' },
  { id: 'A2', compId: 'EPT', cap: 'A' },
  { id: 'B1', compId: 'EPT', cap: 'B' },
];
const detailed = distributeOrderedCriteriaByBlocks(2, detailedCatalog, [[1], [3]]);
assert.deepEqual(new Set(detailed.flat().map((item) => item.id)), new Set(['A1', 'A2', 'B1']));

const multiAreaCatalog = [
  { id: 'C1-A', compId: 'COMP-1', cap: 'Explora' },
  { id: 'C1-B', compId: 'COMP-1', cap: 'Aplica' },
  { id: 'C2-A', compId: 'COMP-2', cap: 'Analiza' },
  { id: 'C2-B', compId: 'COMP-2', cap: 'Comunica' },
];
for (let sessionCount = 3; sessionCount <= 20; sessionCount += 1) {
  const suggestions = Array.from({ length: sessionCount }, (_, index) => [
    1 + ((index * 3) % multiAreaCatalog.length),
  ]);
  const sessions = distributeOrderedCriteriaByBlocks(sessionCount, multiAreaCatalog, suggestions);
  assert.equal(sessions.length, sessionCount);
  assert.ok(sessions.every((items) => items.length > 0), `${sessionCount}: ninguna sesión debe quedar vacía.`);
  const order = sessions.map((items) => multiAreaCatalog.findIndex((candidate) => candidate.id === items[0].id));
  assert.ok(order.every((value, index) => index === 0 || value >= order[index - 1]), `${sessionCount}: no debe retroceder.`);
  if (sessionCount >= multiAreaCatalog.length) {
    assert.deepEqual(
      new Set(sessions.flat().map((item) => item.id)),
      new Set(multiAreaCatalog.map((item) => item.id)),
      `${sessionCount}: debe abarcar todo el catálogo.`
    );
  }
}
console.log('OK: distribución consciente validada para cualquier área y de 3 a 20 sesiones, sin vacíos ni retrocesos.');
