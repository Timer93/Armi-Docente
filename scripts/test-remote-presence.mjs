import assert from 'assert/strict';
import db from '../backend/db.js';

const student = db.prepare(`
  SELECT id, dni FROM db_estudiantes
  WHERE (password_hash IS NULL OR TRIM(password_hash) = '')
    AND LOWER(TRIM(COALESCE(estado, 'A'))) NOT IN ('r', 't', 'retirado', 'trasladado')
    AND TRIM(COALESCE(dni, '')) <> ''
  LIMIT 1
`).get();

if (!student) {
  console.log('Presencia remota: OMITIDA (no existe estudiante con acceso inicial de prueba)');
  process.exit(0);
}

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
};

let token = '';
try {
  const login = await request('http://127.0.0.1:3001/api/student-portal/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dni: String(student.dni), password: String(student.dni) }),
  });
  assert.equal(login.response.status, 200);
  token = login.body.data.token;

  const ping = await request('http://127.0.0.1:3001/api/student-portal/ping', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentActivity: 'Prueba automatizada', uploadStatus: 'IDLE' }),
  });
  assert.equal(ping.response.status, 200);

  const presence = await request('http://127.0.0.1:3000/api/remote-access/students');
  assert.equal(presence.response.status, 200);
  assert.equal(presence.body.data.students.some((entry) => String(entry.userId) === String(student.id) && entry.online), true);

  const blocked = await request('http://127.0.0.1:3001/api/remote-access/students');
  assert.equal(blocked.response.status, 404);

  const logout = await request('http://127.0.0.1:3001/api/student-portal/logout', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(logout.response.status, 200);
  token = '';

  const after = await request('http://127.0.0.1:3000/api/remote-access/students');
  assert.equal(after.body.data.students.some((entry) => String(entry.userId) === String(student.id) && entry.online), false);
  console.log('Presencia, heartbeat, logout y aislamiento del puerto 3001: OK');
} finally {
  if (token) {
    await fetch('http://127.0.0.1:3001/api/student-portal/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
}
