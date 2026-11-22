import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {publicCurriculum} from '../scripts/export-public-curriculum.mjs';
test('public curriculum exports only explicit shared columns and never custom teacher precisions or account data',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE db_areas(id,area,proposito,enfoque,owner_email);
      CREATE TABLE db_competencias(id,area,competencias,capacidades,grado,desempenos_dcbn,desempenos_precisados);
      CREATE TABLE db_estandares(id,area,competencias,grado,desempenos_dcbn,estandar,api_key);
      CREATE TABLE accounts(username,password);
      INSERT INTO db_areas VALUES(1,'EPT','Propósito','Enfoque','private@example.test');
      INSERT INTO db_competencias VALUES(1,'EPT','Competencia','Capacidad','1ro','Desempeño público','private teacher content');
      INSERT INTO db_estandares VALUES(1,'EPT','Competencia','1ro','Desempeño público','Estándar','private api key');
      INSERT INTO accounts VALUES('private user','private password');`);
    const before=db.prepare('SELECT total_changes() AS n').get().n;
    const data=publicCurriculum(db);
    assert.equal(data.competencias[0].competencias,'Competencia');
    assert.equal(data.areas.length,1);assert.equal(data.estandares.length,1);
    assert.ok(!JSON.stringify(data).includes('private'));
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
  } finally {db.close();}
});
