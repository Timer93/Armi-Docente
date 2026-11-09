import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { createStudentForumRoutes } from '../backend/routes/studentForum.routes.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-forum-periods-'));
const db = new Database(':memory:');
db.exec(`CREATE TABLE db_estudiantes(id TEXT,estado TEXT,estudiantes TEXT,grado TEXT,secc TEXT);
  INSERT INTO db_estudiantes VALUES('a','A','Estudiante A','5to','A'),('b','A','Estudiante B','3ro','B');
  CREATE TABLE datos_generales(id INTEGER,year TEXT,teacher TEXT);
  INSERT INTO datos_generales VALUES(1,'2026','Docente');
  CREATE TABLE sesiones(id_sesion TEXT,unit_number TEXT,session_data TEXT);
  INSERT INTO sesiones VALUES('session5','5','{}');`);
const requireStudentAuth = (req, res, next) => {
  const actor = req.headers['x-student'];
  if (!['a', 'b'].includes(actor)) return res.status(401).json({ success: false });
  req.studentPortal = { studentId: actor }; next();
};
const requireTeacher = (req, res, next) => req.headers['x-teacher'] === 'yes' ? next() : res.status(403).json({ success: false });
const app = express(); app.use(express.json());
const options = { db, requireStudentAuth, requireTeacher, uploads: path.join(root, 'uploads'), temporary: path.join(root, 'temp'), sessionsForStudent: () => [{ id_sesion: 'session5' }], deliveryWindow: () => ({ available: false, isClosed: true }) };
app.use('/api', createStudentForumRoutes(options));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/`;
const student = 'student-portal/forum', teacher = 'student-forum/teacher';
const call = async (url, { actor = 'a', staff = false, method = 'GET', data, form, status = 200 } = {}) => {
  const response = await fetch(base + url, { method, headers: { 'x-student': actor, ...(staff ? { 'x-teacher': 'yes' } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: form || (data ? JSON.stringify(data) : undefined) });
  const result = await response.json(); assert.equal(response.status, status, result.message); return result.data;
};
const form = (unit, count = 0, sessionId = '') => {
  const result = new FormData(); result.set('title', 'Proyecto de prueba'); result.set('body', 'Contenido del proyecto'); result.set('category', 'proyecto');
  if (unit !== undefined) result.set('unitNumber', unit);
  if (sessionId) result.set('sessionId', sessionId);
  for (let i = 0; i < count; i++) result.append('files', new Blob([`Archivo ${i}`]), `archivo${i}.txt`);
  return result;
};
const create = async (unit, count = 0, sessionId = '') => (await call(`${student}/posts`, { method: 'POST', form: form(unit, count, sessionId) })).id;
const scope = (type, value, closed) => call(`${teacher}/scopes`, { staff: true, method: 'PATCH', data: { year: '2026', type, value, closed } });
const remove = (postId, attachmentIds, extra = {}) => call(`${extra.staff ? teacher : student}/posts/${postId}/attachments/remove`, { method: 'POST', data: { attachmentIds, requestId: extra.requestId || crypto.randomUUID() }, ...extra });
try {
  const general = await create(''), unit3 = await create('3'), unit4 = await create('4');
  const linked = await create(undefined, 0, 'session5');
  assert.equal((await call(`${student}/posts/${linked}`)).post.unitNumber, '5');
  assert.equal((await call(`${student}/posts/${linked}`)).post.bimester, 'III');
  await call(`${student}/posts`, { method: 'POST', form: form('2', 0, 'session5'), status: 400 });
  assert.deepEqual((await call(`${student}/posts?unit=general`)).posts.map(post => post.id), [general]);
  assert.deepEqual(new Set((await call(`${student}/posts?bimester=II`)).posts.map(post => post.id)), new Set([unit3, unit4]));
  assert.equal((await call(`${teacher}/posts?unit=3`, { staff: true })).posts[0].id, unit3);
  await call(`${teacher}/posts/${general}`, { staff: true, method: 'PATCH', data: { unitNumber: '8' } });
  assert.equal((await call(`${student}/posts?bimester=IV`)).posts[0].id, general);
  await call(`${teacher}/posts/${linked}`, { staff: true, method: 'PATCH', data: { unitNumber: '8' }, status: 400 });
  await scope('unit', '3', true);
  await call(`${student}/posts`, { method: 'POST', form: form('3'), status: 403 });
  assert.equal((await call(`${student}/posts/${unit3}`)).post.canComment, false);
  await call(`${student}/posts/${unit3}/comments`, { method: 'POST', data: { body: 'Una respuesta' }, status: 403 });
  await call(`${teacher}/scopes`, { method: 'PATCH', data: { year: '2026', type: 'unit', value: '3', closed: false }, status: 403 });
  await scope('bimester', 'II', true); await scope('unit', '3', false);
  assert.equal((await call(`${student}/posts/${unit3}`)).post.canComment, false, 'Bimester closure takes precedence');
  await scope('bimester', 'II', false);
  await call(`${student}/posts/${unit3}/comments`, { method: 'POST', data: { body: 'Una respuesta' } });
  await scope('all', '', true);
  assert.equal((await call(`${student}/posts/${unit4}`)).post.canComment, false);
  await scope('all', '', false);
  assert.equal((await call(`${student}/posts/${linked}`)).post.canComment, false, 'The linked session deadline still applies');
  await call(`${teacher}/posts/${linked}`, { staff: true, method: 'PATCH', data: { action: 'reopen' } });
  await call(`${student}/posts/${linked}/comments`, { method: 'POST', data: { body: 'Plazo reabierto por el docente' } });
  await call(`${teacher}/posts/${linked}`, { staff: true, method: 'PATCH', data: { locked: true } });
  assert.equal((await call(`${student}/posts/${linked}`)).post.canComment, false);

  const withFiles = await create('1', 3);
  // Restored publications may contain extra attachments; limits apply to operations, not file count.
  for (let i = 0; i < 5; i++) {
    const fileId = crypto.randomUUID(), now = new Date().toISOString();
    fs.writeFileSync(path.join(root, 'uploads/user-assets/forum', `${fileId}.txt`), 'Restored file');
    db.prepare('INSERT INTO student_forum_attachments(id,post_id,stored_name,file_name,file_type,file_size,created_at) VALUES(?,?,?,?,?,?,?)').run(fileId, withFiles, `${fileId}.txt`, `restaurado${i}.txt`, 'text/plain', 13, now);
  }
  const files = (await call(`${student}/posts/${withFiles}`)).post.attachments;
  await remove(withFiles, [files[0].id], { actor: 'b', status: 403 });
  await remove(withFiles, [files[0].id, 'foreign-file'], { status: 404 });
  assert.equal((await call(`${student}/posts/${withFiles}`)).post.attachments.length, 8);
  const operationId = crypto.randomUUID();
  const first = await remove(withFiles, [files[0].id, files[1].id], { requestId: operationId });
  assert.equal(first.remaining, 2, 'Removing two files spends one operation');
  await remove(withFiles, [files[0].id, files[1].id], { requestId: operationId });
  assert.equal((await call(`${student}/posts/${withFiles}`)).post.attachmentRemovalRemaining, 2, 'Network retries do not spend another operation');
  assert.equal((await fetch(base.replace(/api\/$/, '') + files[0].url, { headers: { 'x-student': 'a' } })).status, 404);
  await remove(withFiles, [files[2].id]); await remove(withFiles, [files[3].id]);
  assert.equal((await call(`${student}/posts/${withFiles}`)).post.attachmentRemovalRemaining, 0);
  await remove(withFiles, [files[4].id], { status: 403 });
  for (const file of files.slice(4)) await remove(withFiles, [file.id], { staff: true });
  assert.equal((await call(`${student}/posts/${withFiles}`)).post.attachments.length, 0, 'Teacher can remove files beyond three operations');
  assert.equal((await call(`${student}/posts/${withFiles}`)).post.deleted, undefined, 'Removing files preserves the publication');
  const withoutBody = await create('2', 1);
  db.prepare("UPDATE student_forum_posts SET body='' WHERE id=?").run(withoutBody);
  const lastFile = (await call(`${student}/posts/${withoutBody}`)).post.attachments[0];
  await remove(withoutBody, [lastFile.id], { status: 400 });
  assert.equal((await call(`${student}/posts/${withoutBody}`)).post.attachmentRemovalRemaining, 3);
  console.log('OK: unidad/bimestre, filtros, clasificación, cierres y reapertura con plazo vencido, eliminación múltiple, permisos, reintentos y límite de tres operaciones.');
} finally {
  await new Promise(resolve => server.close(resolve)); db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
