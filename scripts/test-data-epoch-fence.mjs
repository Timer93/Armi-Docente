import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createDataEpochFence } from '../backend/dataEpochFence.js';

const db=new Database(':memory:');
try {
  const middleware=createDataEpochFence(db);
  const call=(method,path,epoch)=>{
    const result={status:200,next:false,headers:{}};
    const response={setHeader:(key,value)=>{result.headers[key]=value;},status:code=>{result.status=code;return response;},json:body=>{result.body=body;return response;}};
    middleware({method,path,headers:epoch?{'x-armi-data-epoch':epoch}:{}},response,()=>{result.next=true;});return result;
  };
  assert.equal(call('POST','/evaluacion/registros').next,true);
  db.exec("CREATE TABLE armi_sync_migration_log(migration_id TEXT PRIMARY KEY,applied_at TEXT); INSERT INTO armi_sync_migration_log VALUES('v4','2026-10-19')");
  assert.equal(call('POST','/evaluacion/registros','legacy').status,409);
  assert.equal(call('POST','/evaluacion/conclusiones','legacy').status,409);
  assert.equal(call('POST','/sync/frontend-state','legacy').status,409);
  assert.equal(call('PUT','/sesiones/1','legacy').status,409);
  assert.equal(call('POST','/evaluacion/registros','v4').next,true);
  assert.equal(call('GET','/evaluacion/registros','legacy').headers['X-ARMI-Data-Epoch'],'v4');
  assert.equal(call('POST','/student-portal/evidencias','legacy').next,true);
  console.log('OK: stale queued teacher saves fenced after migration; refreshed teacher and student portal continue.');
} finally {db.close();}
