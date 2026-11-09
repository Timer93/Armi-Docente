import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-chat-local-'));
const port = 34_000 + (process.pid % 1000);
const child = spawn(process.execPath, ['backend/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, ARMI_DATA_ROOT: root, ARMI_BACKEND_PORT: String(port), ARMI_STUDENT_PORTAL_PORT: String(port + 1) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('El backend de prueba no inicio a tiempo.');
};

try {
  await waitForServer();
  const db = new Database(path.join(root, 'database', 'armi.db'));
  const groupId = Number(db.prepare("INSERT INTO student_chat_groups (name,year,grade,section) VALUES ('Grupo prueba','2026','5to','A')").run().lastInsertRowid);
  const folder = path.join(root, 'uploads', 'student-chat-local', String(groupId));
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, 'documento-prueba.pdf');
  fs.writeFileSync(filePath, Buffer.from('archivo-local-chat'));
  const messageId = Number(db.prepare(`INSERT INTO student_chat_messages
    (group_id,sender_type,sender_id,sender_name,message_text,file_path,file_name,file_type,file_size)
    VALUES (?,'student','1','Estudiante prueba','archivo','student-chat-local/${groupId}/documento-prueba.pdf','documento-prueba.pdf','application/pdf',?)`)
    .run(groupId, fs.statSync(filePath).size).lastInsertRowid);

  const messagesResponse = await fetch(`http://127.0.0.1:${port}/api/student-chat/teacher/groups/${groupId}/messages`);
  const messages = await messagesResponse.json();
  assert.equal(messages.success, true);
  assert.equal(messages.data[0].file_url, `/api/student-chat/teacher/messages/${messageId}/file`);

  const fileResponse = await fetch(`http://127.0.0.1:${port}${messages.data[0].file_url}`);
  assert.equal(fileResponse.status, 200);
  assert.equal(await fileResponse.text(), 'archivo-local-chat');

  const publicResponse = await fetch(`http://127.0.0.1:${port}/uploads/student-chat-local/${groupId}/documento-prueba.pdf`);
  assert.equal(publicResponse.status, 404, 'Los adjuntos del chat no deben quedar publicados por /uploads.');

  const linkResponse = await fetch(`http://127.0.0.1:${port}/api/student-chat/teacher/groups/${groupId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolioUrl: 'https://docs.google.com/document/d/prueba' }),
  });
  assert.equal(linkResponse.status, 200);

  const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/student-chat/teacher/messages/${messageId}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.equal(fs.existsSync(filePath), false, 'Eliminar el mensaje tambien debe retirar su adjunto local.');
  db.close();
  console.log('OK: chat local protegido, enlace, descarga y eliminacion verificados.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  fs.rmSync(root, { recursive: true, force: true });
}
