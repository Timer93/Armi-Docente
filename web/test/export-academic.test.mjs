import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAcademicPackage, portableValue } from '../scripts/export-academic.mjs';

test('desktop export selects academic records without writing the source or copying credentials', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE datos_generales(id INTEGER, teacher TEXT, year TEXT, gemini_api_key TEXT, insignia TEXT, path_word_default TEXT);
      INSERT INTO datos_generales VALUES(1,'Docente','2026','private-key','data:image/png;base64,private','C:\\private');
      CREATE TABLE db_estudiantes(id INTEGER, estudiantes TEXT, password_hash TEXT); INSERT INTO db_estudiantes VALUES(1,'Alumno','private-password');
      CREATE TABLE programacion_recursos(id_programa TEXT); CREATE TABLE programacion_anual(id_programa TEXT);
      CREATE TABLE unidades_didacticas(id_unidad TEXT); CREATE TABLE sesiones(id_sesion TEXT,session_data TEXT);
      CREATE TABLE armi_frontend_state(key TEXT, value TEXT);
      INSERT INTO armi_frontend_state VALUES('armi_areas','[{"id":"a","name":"Área"}]'),('armi_auth_session_v1','{"password":"private"}');`);
    const before = db.prepare('SELECT total_changes() AS total').get().total;
    const copy = createAcademicPackage(db, 'docenteA');
    assert.equal(db.prepare('SELECT total_changes() AS total').get().total, before);
    assert.equal(copy.counts.general, 1); assert.equal(copy.counts.students, 1); assert.equal(copy.counts.frontend, 1);
    assert.equal(copy.ownerUsername, 'docenteA'); assert.match(copy.fingerprint, /^[a-f0-9]{64}$/);
    assert(!/private-key|private-password|armi_auth_session|data:image|C:\\\\private/.test(JSON.stringify(copy)));
    assert.equal(copy.rows.find(row => row.dataset === 'students').value.name, 'Alumno');
    assert.equal(db.prepare('SELECT password_hash FROM db_estudiantes').get().password_hash, 'private-password');
    assert.equal(createAcademicPackage(db, 'docenteA').fingerprint, copy.fingerprint);
  } finally { db.close(); }
});

test('portable export removes embedded assets and private nested fields while preserving planning text', () => {
  const rubric = portableValue({assessment:{levelDescriptors:{c:'Inicial',b:'Proceso',a:'Logrado',ad:'Destacado'}},faceDescriptor:[1,2,3],invalid:{levelDescriptors:{token:'private'}}});
  assert.equal(rubric.assessment.levelDescriptors.ad,'Destacado');
  assert.equal(rubric.faceDescriptor,undefined);
  assert.equal(rubric.invalid.levelDescriptors,undefined);
  const clean = portableValue({ learning: '<p>Texto</p><img src="data:image/png;base64,private">', source: 'C:\\Users\\docente\\private', config: { apiKey: 'private', accessToken: 'private', name: 'Visible' }, nested: '{"password":"private","text":"Texto"}' });
  assert.equal(clean.learning, '<p>Texto</p>'); assert.equal(clean.source, '');
  assert.deepEqual(clean.config, { name: 'Visible' }); assert.deepEqual(clean.nested, { text: 'Texto' });
});
