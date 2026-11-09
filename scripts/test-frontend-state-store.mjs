import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createFrontendStateStore } from '../backend/frontendStateStore.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-frontend-state-'));
const db = new Database(':memory:');
try {
  const file = path.join(root, 'frontend.json');
  fs.writeFileSync(file, JSON.stringify({ keys: { armi_schedule_entries: '[1]', armi_auth_session_v1: 'private' } }));
  const store = createFrontendStateStore(db, file);
  assert.equal(store.snapshot().keys.armi_auth_session_v1, undefined);
  store.observe({ armi_schedule_entries: '[]' });
  assert.equal(store.snapshot().keys.armi_schedule_entries, '[1]');
  store.observe({ armi_schedule_entries: '[2]' }, ['armi_schedule_entries']);
  assert.equal(store.snapshot().keys.armi_schedule_entries, '[2]');
  db.prepare('UPDATE armi_frontend_state SET value=? WHERE key=?').run('[3]', 'armi_schedule_entries');
  store.snapshot(); store.observe({ armi_schedule_entries: '[2]' });
  assert.equal(store.snapshot().keys.armi_schedule_entries, '[3]', 'An unchanged stale browser snapshot must not revert remote data');
  store.observe({}, ['armi_schedule_entries']);
  assert.equal(store.snapshot().keys.armi_schedule_entries, undefined);
  assert.ok(fs.existsSync(`${file}.before-portable.json`));
  console.log('OK: settings migration, private-key exclusion, empty-browser protection, remote edits and explicit deletion.');
} finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
