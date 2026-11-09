import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync('backend/public/student-portal.html', 'utf8');
const code = html.slice(html.indexOf('    const uploadMemory='), html.indexOf('    const uploadFiles='));
const memory = new Map();
const localStorage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, { style: {}, classList: { remove() {} }, textContent: '' }); return elements.get(id); };
const state = { token: 'session', student: { id: 'student' }, selected: { id: 'lesson' } };
const uploaded = { uploadId: 'upload', status: 'UPLOADING', missingChunks: [0], chunkSize: 3, totalSize: 3, confirmedBytes: 0 };
let puts = 0, completions = 0, inits = 0, polling = 0, offline = false;
const json = (data, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
const fetch = async (url, options) => {
  if (url.endsWith('/init')) { inits++; return json(uploaded); }
  if (url.includes('/chunks/')) {
    puts++;
    if (puts === 1) return new Response('<html>Cloudflare connection error</html>', { status: 502 });
    return json({ ...uploaded, missingChunks: [], confirmedBytes: 3 });
  }
  if (url.endsWith('/complete')) {
    completions++; assert.equal(JSON.parse(options.body).background, true);
    return json({ ...uploaded, status: 'VERIFYING', missingChunks: [], confirmedBytes: 3 }, 202);
  }
  throw new Error(`Unexpected request ${url}`);
};
const api = async () => {
  polling++;
  if (offline) throw new Error('Temporary network failure');
  return { ...uploaded, status: 'COMPLETED', completedEvidenceId: 7, missingChunks: [], confirmedBytes: 3 };
};
const timers = (callback, ms) => { if (ms < 90000) queueMicrotask(callback); return 1; };
const upload = new Function('localStorage', 'state', 'uploadFingerprint', 'api', 'fetch', '$', 'formatSize', 'message', 'window', 'performLogout', 'setTimeout', 'clearTimeout', `${code};return uploadResumableFile;`)(
  localStorage, state, () => 'file', api, fetch, $, String, () => {}, {}, async () => {}, timers, () => {},
);
const file = new Blob(['abc'], { type: 'video/mp4' }); file.name = 'test.mp4';
await upload(file, 0);
assert.deepEqual({ puts, completions, inits, polling }, { puts: 2, completions: 1, inits: 1, polling: 1 });
assert.deepEqual(JSON.parse(localStorage.getItem('armiPendingUploads')), {}, 'Forget an upload only after durable completion');

localStorage.setItem('armiPendingUploads', JSON.stringify({ file: 'upload' }));
offline = true;
await assert.rejects(upload(file, 0), /network/);
assert.equal(JSON.parse(localStorage.getItem('armiPendingUploads')).file, 'upload', 'An interrupted status request must preserve the resume receipt');
assert.equal(inits, 1, 'A failed status request must not create another upload');
offline = false;
await upload(file, 0);
assert.equal(completions, 1, 'A previously completed video must not be submitted again');
assert.deepEqual(JSON.parse(localStorage.getItem('armiPendingUploads')), {});
console.log('OK: HTML gateway response, chunk retry, background polling, preserved resume receipt, and no duplicate completion.');
