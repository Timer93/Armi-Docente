import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {portalSlug,validPortal,registryNumber} from '../src/portal-registry.js';

function sheetFixture(names) {
 const rows=[Array.from({length:28},(_,i)=>'field'+i),...names.map(name=>[name,'private-password',...Array(26).fill('preserve')])];
 const stats={reads:0,writes:0,releases:0};
 const sheet={getDataRange:()=>({getValues(){stats.reads++;return structuredClone(rows);}}),getLastColumn:()=>rows[0].length,getMaxColumns:()=>rows[0].length,insertColumnsAfter(at,n){for(const row of rows)while(row.length<at+n)row.push('');},getRange(r,c){return {setValue(value){stats.writes++;rows[r-1][c-1]=value;},setValues(values){stats.writes++;values.forEach((v,i)=>{rows[r+i-1][c-1]=v[0];});}};}};
 const context=vm.createContext({LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){stats.releases++;}})},SpreadsheetApp:{flush(){}}});
 vm.runInContext(fs.readFileSync(new URL('../scripts/apps-script-portal.gs',import.meta.url),'utf8'),context);
 return {rows,stats,sheet,identity(name){const index=rows.findIndex(r=>r[0]===name);return context.armiPortalTeacherIdentity_(sheet,index+1,structuredClone(rows),name);}};
}

test('Sheets teacher 45 receives d45; sorting and new rows preserve existing IDs without touching credentials',()=>{
 const f=sheetFixture(Array.from({length:50},(_,n)=>'teacher'+(n+1))),original=f.rows.map(r=>r.slice(0,28));
 const result=f.identity('teacher45');assert.equal(result.teacherRegistryNumber,45);assert.match(result.studentPortalUrl,/d45-profe-teacher45$/);
 assert.deepEqual(f.rows.map(r=>r.slice(0,28)),original);assert.equal(f.stats.releases,1);
 f.rows.splice(1,0,...f.rows.splice(45,1));
 const before={...f.stats};assert.equal(f.identity('teacher45').teacherRegistryNumber,45);assert.deepEqual(f.stats,before,'Assigned users reuse the authentication snapshot with no extra Sheets I/O');
 f.rows.splice(1,0,['newteacher','keep-password',...Array(26).fill('keep'),'']);
 assert.equal(f.identity('newteacher').teacherRegistryNumber,51);assert.equal(f.identity('teacher45').teacherRegistryNumber,45);
 assert.equal(new Set(f.rows.slice(1).map(r=>r[28])).size,51);
});

test('Apps Script duplicate IDs, ambiguous usernames and misplaced metadata never rewrite existing fields',()=>{
 for(const scenario of ['duplicate-id','duplicate-user','reserved-column']){
  const f=sheetFixture(['first','second']);f.identity('first');
  if(scenario==='duplicate-id')f.rows[2][28]=1;
  if(scenario==='duplicate-user')f.rows[2][0]='first';
  if(scenario==='reserved-column'){f.rows[0][28]='custom';f.rows[0][1]='ARMI_DOCENTE_ID';}
  const original=structuredClone(f.rows),before={...f.stats},result=f.identity('first');
  assert.equal(result.ready,false,scenario);assert.deepEqual(f.rows,original);assert.deepEqual(f.stats,before);
 }
 const f=sheetFixture(['first','first']);const before=structuredClone(f.rows);assert.equal(f.identity('first').ready,false);assert.deepEqual(f.rows,before);assert.equal(f.stats.releases,1,'Lock released even when identity is ambiguous');
});

test('Public aliases normalize names, retain numeric identity, and reject malformed identifiers',()=>{
 assert.equal(portalSlug(45,'  Árnold Docente  '),'d45-profe-arnold-docente');
 assert.notEqual(portalSlug(45,'arnold'),portalSlug(46,'arnold'));
 for(const value of ['d45-profe-arnold','a'.repeat(32),portalSlug(999999999,'a'.repeat(160))])assert.equal(validPortal(value),true);
 for(const value of ['d0-profe-a','d45-profe-a/../b','d45-profe-a?dni=1','d45-profe--a','https://other.test'])assert.equal(validPortal(value),false);
 for(const value of [0,-1,1.2,'01','1e2',1000000000])assert.equal(registryNumber(value),null);
});
