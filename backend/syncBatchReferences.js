// Format 2 already carries portable IDs. Recovery catalogs stay complete; an
// individual event only needs references used by its own keys and rows.
function createReferenceScan(catalog, operations) {
  const values = new Set();
  const tokens = new Set();
  const uncertain = new Set();
  function* visit(value, depth = 0) {
    yield;
    if (depth > 30) { ['students', 'instruments', 'evidences'].forEach(key => uncertain.add(key)); return; }
    if (Array.isArray(value)) { for (const item of value) yield* visit(item, depth + 1); return; }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) { yield* visit(key, depth + 1); yield* visit(item, depth + 1); } return;
    }
    if (value == null) return;
    const text = String(value); values.add(text);
    for (const match of text.matchAll(/@(student|instrument):[a-zA-Z0-9_-]+/g)) tokens.add(match[0]);
    if (text.startsWith('@version-group:')) values.add(text.slice('@version-group:'.length));
    if (/^[\s]*[\[{]/.test(text)) {
      try { yield* visit(JSON.parse(text), depth + 1); return; }
      catch { /* Opaque payloads use the conservative fallback below. */ }
    }
    if (text.includes('@evidence') && !text.startsWith('@evidence:')
      && !text.startsWith('@evidence-path:') && !text.startsWith('@version-group:')) uncertain.add('evidences');
  };
  const result = () => Object.fromEntries(Object.entries(catalog || {}).map(([kind, references]) => {
    if (!['students', 'instruments', 'evidences'].includes(kind) || uncertain.has(kind)
      || !references || Array.isArray(references) || typeof references !== 'object') return [kind, references];
    return [kind, Object.fromEntries(Object.entries(references).filter(([key, reference]) =>
      !reference?.token || (kind !== 'evidences' && !/^@(student|instrument):[a-zA-Z0-9_-]+$/.test(reference.token))
      || values.has(key) || values.has(reference.token) || tokens.has(reference.token)))];
  }));
  return { visits: visit(operations), result };
}

export function compactBatchReferences(catalog, operations) {
  const scan = createReferenceScan(catalog, operations);
  for (const _ of scan.visits) { /* Synchronous API for small standalone callers. */ }
  return scan.result();
}

export async function compactBatchReferencesAsync(catalog, operations) {
  const scan = createReferenceScan(catalog, operations);
  let deadline = performance.now() + 8, count = 0;
  for (const _ of scan.visits) {
    if (++count % 64 === 0 && performance.now() >= deadline) {
      await new Promise(resolve => setImmediate(resolve)); deadline = performance.now() + 8;
    }
  }
  return scan.result();
}
