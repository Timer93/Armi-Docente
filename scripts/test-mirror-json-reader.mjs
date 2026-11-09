import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMirrorJson, readMirrorJsonResult } from '../backend/mirrorJsonReader.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-json-reader-'));
const originalRead = fs.promises.readFile;
const releases = [];
try {
  const valid = path.join(root, 'valid.json');
  fs.writeFileSync(valid, '{"resources":[]}');
  assert.deepEqual(await readMirrorJsonResult(valid), { status: 'ready', value: { resources: [] } });
  assert.deepEqual(await readMirrorJsonResult(path.join(root, 'missing.json')), { status: 'missing' });
  fs.writeFileSync(valid, 'invalid');
  assert.deepEqual(await readMirrorJsonResult(valid), { status: 'invalid' });
  assert.equal(await readMirrorJson(valid, 'fallback'), 'fallback');
  fs.promises.readFile = async file => {
    if (String(file).endsWith('denied.json')) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    return new Promise(resolve => releases.push(() => resolve('{"resources":[]}')));
  };
  assert.deepEqual(await readMirrorJsonResult(path.join(root, 'denied.json')), { status: 'unavailable' });
  const stalled = [path.join(root, 'slow1.json'), path.join(root, 'slow2.json')];
  for (const file of stalled) assert.deepEqual(await readMirrorJsonResult(file), { status: 'pending' });
  assert.deepEqual(await readMirrorJsonResult(stalled[0]), { status: 'pending' });
  assert.deepEqual(await readMirrorJsonResult(path.join(root, 'third.json')), { status: 'pending' });
  assert.equal(releases.length, 2, 'Retries and saturation must not create extra native reads.');
  releases.forEach(release => release());
  await new Promise(resolve => setImmediate(resolve));
  for (const file of stalled) assert.equal((await readMirrorJsonResult(file)).status, 'ready');
  console.log('OK: missing, invalid, inaccessible, pending, bounded reads and recovery remain distinct.');
} finally {
  fs.promises.readFile = originalRead;
  releases.forEach(release => release());
  fs.rmSync(root, { recursive: true, force: true });
}
