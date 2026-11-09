import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { prepareInstallerDatabase } from './prepare-installer-database.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-installer-seed-'));
const sourcePath = path.join(root, 'source.db');
const destination = path.join(root, 'package', 'armi.db');
const source = new Database(sourcePath);
try {
  source.pragma('journal_mode = WAL');
  source.pragma('wal_autocheckpoint = 0');
  source.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT)');
  source.prepare('INSERT INTO evidence(value) VALUES (?)').run('committed in WAL');
  const original = fs.readFileSync(sourcePath);
  const originalWal = fs.readFileSync(`${sourcePath}-wal`);
  await prepareInstallerDatabase(sourcePath, destination);
  const snapshot = new Database(destination, { readonly: true });
  assert.equal(snapshot.prepare('SELECT value FROM evidence').get().value, 'committed in WAL');
  assert.equal(snapshot.pragma('integrity_check', { simple: true }), 'ok');
  snapshot.close();
  assert.deepEqual(fs.readFileSync(sourcePath), original);
  assert.deepEqual(fs.readFileSync(`${sourcePath}-wal`), originalWal);
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['armi.db']);
  source.prepare('INSERT INTO evidence(value) VALUES (?)').run('next build');
  await prepareInstallerDatabase(sourcePath, destination);
  const next = new Database(destination, { readonly: true });
  assert.equal(next.prepare('SELECT count(*) AS n FROM evidence').get().n, 2);
  next.close();
  source.exec(`
    CREATE TABLE datos_generales (id INTEGER PRIMARY KEY, teacher TEXT);
    CREATE TABLE db_estudiantes (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE armi_frontend_state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE padron_colegios (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO datos_generales VALUES (1, 'Private teacher');
    INSERT INTO db_estudiantes VALUES (1, 'Private student');
    INSERT INTO armi_frontend_state VALUES ('armi_assignments', '[1]');
    INSERT INTO padron_colegios VALUES (1, 'Public catalog');
  `);
  await prepareInstallerDatabase(sourcePath, destination);
  const clean = new Database(destination, { readonly: true });
  for (const table of ['datos_generales', 'db_estudiantes', 'armi_frontend_state', 'evidence']) {
    assert.equal(clean.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal(clean.prepare('SELECT name FROM padron_colegios').get().name, 'Public catalog');
  assert.equal(source.prepare('SELECT teacher FROM datos_generales').get().teacher, 'Private teacher');
  assert.equal(source.prepare('SELECT count(*) AS n FROM evidence').get().n, 2);
  assert.equal(clean.pragma('integrity_check', { simple: true }), 'ok');
  clean.close();
  assert.equal(fs.readFileSync(destination).includes(Buffer.from('Private teacher')), false, 'VACUUM removes deleted personal data');
  console.log('OK: WAL snapshot preserves originals; ARMI installer keeps catalogs and schema, with no user records or deleted private data.');
} finally {
  source.close();
  fs.rmSync(root, { recursive: true, force: true });
}
