// Preserve the original body and external native-file descriptors; append only the replacement module.
import * as asar from '@electron/asar';
import { Pickle } from '../node_modules/@electron/asar/lib/pickle.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';
const original = process.argv[2] || 'C:/Program Files/ARMI Docente/resources/app.asar';
const destination = path.resolve(process.argv[3] || 'recovery-candidates/sync-repair-2026-10-26/update/app.asar');
assert.notEqual(path.resolve(original), destination);
const target = 'backend/incrementalMirrorSync.js';
const replacement = fs.readFileSync(target);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const raw = asar.getRawHeader(original);
const header = JSON.parse(raw.headerString);
const bodyStart = 8 + raw.headerSize;
const bodyBytes = fs.statSync(original).size - bodyStart;
const entry = header.files.backend.files['incrementalMirrorSync.js'];
assert.ok(entry && !entry.unpacked && !entry.link);
entry.offset = String(bodyBytes);
entry.size = replacement.length;
const blockSize = entry.integrity?.blockSize || 4194304;
const blocks = [];
for (let offset = 0; offset < replacement.length; offset += blockSize) blocks.push(hash(replacement.subarray(offset, offset + blockSize)));
entry.integrity = { algorithm: 'SHA256', hash: hash(replacement), blockSize, blocks };
const headerPickle = Pickle.createEmpty(); headerPickle.writeString(JSON.stringify(header));
const headerBuffer = headerPickle.toBuffer();
const sizePickle = Pickle.createEmpty(); sizePickle.writeUInt32(headerBuffer.length);
fs.mkdirSync(path.dirname(destination), { recursive: true });
const originalHeader = Buffer.alloc(bodyStart);
const originalHandle = fs.openSync(original, 'r');
try { assert.equal(fs.readSync(originalHandle, originalHeader, 0, bodyStart, 0), bodyStart); }
finally { fs.closeSync(originalHandle); }
fs.writeFileSync(path.join(path.dirname(destination), 'rollback-header.gz'), gzipSync(originalHeader));
fs.writeFileSync(destination, Buffer.concat([sizePickle.toBuffer(), headerBuffer]));
await pipeline(fs.createReadStream(original, { start: bodyStart }), fs.createWriteStream(destination, { flags: 'a' }));
fs.appendFileSync(destination, replacement);
const names = asar.listPackage(original);
assert.deepEqual(asar.listPackage(destination), names);
let verified = 0, externalFiles = 0;
for (const rawName of names) {
 const name = rawName.replace(/^[/\\]/, '');
 const before = asar.statFile(original, name, false), after = asar.statFile(destination, name, false);
 if (before.files) continue;
 if (name.replaceAll('\\', '/') === target) assert.equal(hash(asar.extractFile(destination, name)), hash(replacement));
 else {
  assert.deepEqual(after, before, name);
  if (before.unpacked) externalFiles++;
  else if (!before.link) assert.equal(hash(asar.extractFile(destination, name)), hash(asar.extractFile(original, name)), name);
 }
 verified++;
}
const receipt = { createdAt: new Date().toISOString(), changedFile: target, verifiedFiles: verified,
 originalHeaderBytes: bodyStart, originalArchiveBytes: fs.statSync(original).size,
 unchangedExternalFileDescriptors: externalFiles,
 originalSha256: hash(fs.readFileSync(original)), patchedSha256: hash(fs.readFileSync(destination)), moduleSha256: hash(replacement) };
fs.writeFileSync(path.join(path.dirname(destination), 'manifest.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
