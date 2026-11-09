import assert from 'node:assert/strict';
import { validateGeneratedUnitSessionTitles } from '../backend/shared/unitSessionTitles.js';

const complete = { sesiones: [{ title: ' Empatizamos con los usuarios ', con: 'Entrevistas' }, { title: 'Definimos el problema' }] };
assert.deepEqual(validateGeneratedUnitSessionTitles(complete, 2), [
  { title: 'Empatizamos con los usuarios', con: 'Entrevistas' },
  { title: 'Definimos el problema' },
]);
assert.equal(complete.sesiones[0].title, ' Empatizamos con los usuarios ');
for (const response of [null, { sesiones: [] }, { sesiones: [{ con: 'Entrevistas' }, { title: ' ' }] }, { sesiones: [{ title: 'Un título' }] }]) {
  assert.throws(() => validateGeneratedUnitSessionTitles(response, 2), /no completó los títulos/);
}
assert.throws(() => validateGeneratedUnitSessionTitles({ sesiones: [...complete.sesiones, { title: 'Extra' }] }, 2), /no completó/);
console.log('OK: las respuestas incompletas no se aceptan como títulos generados.');
