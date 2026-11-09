import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildSync} from 'esbuild';
import {parseHTML} from 'linkedom';
import {createRegisterAggregation} from '../backend/shared/registerAggregation.generated.js';

const bundle=buildSync({entryPoints:['components/evaluation/registers/CompetencySummary.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const compiled={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {CompetencySummary,summarizeCompetencyLevels:count}=compiled.exports;
const mixed=count([{code:'b'},{code:'a'},{code:'ad'},{code:'c'},{code:'ne'},{code:'a',pending:true}]);
assert.equal(mixed.approved,3);assert.equal(mixed.failed,1);assert.equal(mixed.missing,2);assert.equal(mixed.pending,1);assert.equal(mixed.ne,1);assert.equal(mixed.evaluated,4);
assert.equal(count([]).approved,0);assert.equal(count([{code:''},{code:'ne'}]).failed,0);

// Preserve the real motor's final letter, including opt-in rounding at 10.5.
const rows=[{id:'primary-1',source:'primary',competencyName:'EPT',capacityName:'Crea propuestas',criterionText:'Primero'},
  {id:'primary-2',source:'primary',competencyName:'EPT',capacityName:'Crea propuestas',criterionText:'Segundo'},
  {id:'transversal-1-1',source:'transversal',competencyName:'Autonomía',capacityName:'Define metas',criterionText:'Tercero'}];
const session={id:'u5s1',year:'2026',areaId:'EPT',grade:'5to',section:'A',unitNumber:'5',sessionNumber:'1',bimesterLabel:'III',sessionData:{numericAverageRounding:'nearest_integer',sessionAssessmentModel:{rows}}};
const records=[['primary-1',10],['primary-2',11],['transversal-1-1',5]].map(([criteria_id,numeric_score])=>({student_id:'s',session_id:session.id,criteria_id,numeric_score,level:'C',grading_mode:'hybrid_vigesimal'}));
const calculator=createRegisterAggregation('hybrid_vigesimal');
for(const method of ['buildUnitRegisterAggregation','buildBimesterRegisterAggregation']){
  const student=calculator[method]({students:[{id:'s',name:'Student',estado:'A'}],sessions:[session],records}).students[0];
  const ept=student.competencies.find(row=>row.source==='primary'),transversal=student.competencies.find(row=>row.source==='transversal');
  assert.equal(ept.numericScore,10.5);assert.equal(ept.code,'b');assert.equal(count([ept]).approved,1);
  assert.equal(count([transversal]).approved,0);assert.equal(count([transversal]).failed,1,'Each competency has its own total');
}

const codes=values=>values.split(' ').map(code=>({code}));
const previewRows=[
  {key:'ept',name:'GESTIONA PROYECTOS DE EMPRENDIMIENTO ECONÓMICO Y SOCIAL.',counts:count(codes('b c c c b b c a a c a a c b c b'))},
  {key:'tic',name:'SE DESENVUELVE EN LOS ENTORNOS VIRTUALES GENERADOS POR LAS TIC',counts:count(codes('b c c b c c c b b c b b c b c b'))},
  {key:'autonomy',name:'GESTIONA SU APRENDIZAJE DE MANERA AUTÓNOMA',counts:count(codes('b b c c b c c b b c b a c b c b'))},
];
for(const row of previewRows) {
  row.colorClass = row.key === 'ept' ? 'bg-sky-900 text-white' : 'bg-emerald-700 text-white';
  assert.equal(row.counts.approved+row.counts.failed+row.counts.missing,16);
}
const markup=renderToStaticMarkup(React.createElement(CompetencySummary,{rows:previewRows}));
const {document}=parseHTML(markup);
const renderedRows=[...document.querySelectorAll('tbody tr')];assert.equal(renderedRows.length,3);
assert.deepEqual(renderedRows.map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent)),[['9','7','0'],['8','8','0'],['9','7','0']]);
assert.match(renderedRows[0].querySelector('td span').getAttribute('title'),/B: 5.*A: 4.*AD: 0/);
assert.equal(renderedRows[0].querySelector('th').textContent,previewRows[0].name);
assert.ok(renderedRows[0].querySelector('th span').classList.contains('truncate'));
assert.equal(renderedRows[0].querySelector('th').getAttribute('title'),previewRows[0].name);
assert.ok(renderedRows[0].querySelector('th').classList.contains('bg-sky-900'));
assert.ok(renderedRows[1].querySelector('th').classList.contains('bg-emerald-700'));
assert.equal(document.querySelectorAll('th[scope="col"]').length,4);
assert.ok(!markup.includes('Matriculados:'));assert.ok(!markup.includes('En proceso:'));
const pendingMarkup=renderToStaticMarkup(React.createElement(CompetencySummary,{rows:[{key:'missing',name:'Otra competencia',counts:mixed}]}));
assert.match(pendingMarkup,/Pendientes: 1/);assert.match(pendingMarkup,/NE o sin registro: 1/);
fs.mkdirSync('artifacts/competency-summary-preview',{recursive:true});
fs.writeFileSync('artifacts/competency-summary-preview/summary-markup.html',markup);
console.log('OK: B/A/AD approved, C failed, pending/NE separated, per-competency totals, real rounded levels in units/bimesters and compact accessible rendering.');
