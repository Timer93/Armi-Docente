import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDevDataRoot } from './dev-data-root.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-dev-root-'));
try {
  assert.equal(resolveDevDataRoot(root, {}), root);
  const installed = path.join(root, 'installed');
  fs.mkdirSync(path.join(installed, 'database'), { recursive: true });
  fs.writeFileSync(path.join(installed, 'database', 'armi.db'), 'fixture');
  fs.writeFileSync(path.join(root, 'armi-dev.local'), JSON.stringify({ dataRoot: installed }));
  assert.equal(resolveDevDataRoot(root, {}), installed);
  fs.writeFileSync(path.join(root, 'armi-dev.local'), '{}');
  assert.equal(resolveDevDataRoot(root, { ARMI_DATA_ROOT: installed }), installed);
  assert.throws(() => resolveDevDataRoot(root, {}), /debe indicar dataRoot/);
  assert.throws(() => resolveDevDataRoot(root, { ARMI_DATA_ROOT: 'missing' }), /No se iniciará una base vacía/);
  assert.equal(fs.existsSync(path.join(root, 'missing')), false);
  console.log('OK: project default, installed data selection, env precedence and invalid-path protection.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
