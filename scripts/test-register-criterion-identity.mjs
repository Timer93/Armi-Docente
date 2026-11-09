import assert from 'node:assert/strict';
import {resolveSessionCriterionRows} from '../backend/shared/sessionCriterionIdentity.js';
import {createRegisterAggregation} from '../backend/shared/registerAggregation.generated.js';

const row=(id,comp='Autonomía',cap='Define metas.',criterion='Establece metas precisas')=>({id,source:'transversal',competencyName:comp,capacityName:cap,criterionText:criterion});
const instrument=(id,comp='Autonomía',cap='Define metas.',criterion='Establece metas precisas')=>({id,source:'transversal',competencia:comp,capacidad:cap,criterio:criterion});
const modelRow=row('transversal-2-1');
const data={sessionAssessmentModel:{rows:[modelRow]},instrumento:[instrument('transversal-2-1','TIC'),instrument('transversal-2-2')]};
const original=structuredClone(data);
const resolved=resolveSessionCriterionRows(data,data.sessionAssessmentModel.rows);
assert.equal(resolved[0].id,'transversal-2-2');
assert.ok(!resolved[0].recordIds.includes('transversal-2-1'),'Do not read the old grade belonging to another competency');
assert.deepEqual(data,original,'Resolving references must not mutate stored planning or grades');
assert.deepEqual(resolveSessionCriterionRows(data,resolved),resolved,'Resolution is idempotent');
const students=Array.from({length:14},(_,i)=>({id:String(i+1),name:`Estudiante ${i+1}`,grade:'2do',section:'A',estado:'A'}));
const session={id:'s1',year:'2026',areaId:'EPT',grade:'2do',section:'A',unitNumber:'5',sessionNumber:'1',bimesterLabel:'III',sessionData:data};
const records=students.map(student=>({student_id:student.id,session_id:'s1',criteria_id:'transversal-2-2',level:'Proceso',numeric_score:11,grading_mode:'hybrid_vigesimal'}));
records.push({student_id:'1',session_id:'s1',criteria_id:'transversal-2-1',level:'Inicio',numeric_score:5,grading_mode:'hybrid_vigesimal'});
const recordsOriginal=structuredClone(records);
const calculator=createRegisterAggregation('hybrid_vigesimal');
const unit=calculator.buildUnitRegisterAggregation({students,sessions:[session],records});
assert.equal(unit.students.filter(item=>item.capacities[0].numericScore===11).length,14,'All fourteen current grades must appear');
assert.equal(unit.students[0].capacities[0].numericScore,11,'The current criterion takes precedence over the unrelated old 5');
assert.deepEqual(records,recordsOriginal,'Do not copy, delete or overwrite grades');
const pending=calculator.buildUnitRegisterAggregation({students,sessions:[session],records:records.filter(record=>record.criteria_id!=='transversal-2-2')});
assert.equal(pending.students[0].capacities[0].numericScore,null,'A genuinely absent current grade stays pending');
assert.equal(pending.students[0].capacities[0].pending,true);
const unit6={...session,id:'s2',unitNumber:'6',sessionData:data};
const nextRecords=students.map(student=>({...records[0],student_id:student.id,session_id:'s2',numeric_score:13}));
const bimester=calculator.buildBimesterRegisterAggregation({students,sessions:[session,unit6],records:[...records,...nextRecords]});
assert.equal(bimester.students[0].capacities[0].numericScore,12,'Bimester uses the same resolved references in both units');

// Fourth-grade case: one current ID is also the obsolete ID of a different row.
const swapRows=[row('transversal-1-1'),row('transversal-2-1','TIC','Gestiona información.','Organiza sus archivos')];
const swapData={sessionAssessmentModel:{rows:swapRows},instrumento:[instrument('transversal-2-1'),instrument('transversal-2-2','TIC','Gestiona información.','Organiza sus archivos')]};
const swap=resolveSessionCriterionRows(swapData,swapRows);
assert.deepEqual(swap.map(item=>item.id),['transversal-2-1','transversal-2-2']);
assert.ok(swap[0].recordIds.includes('transversal-2-1'));
assert.ok(!swap[1].recordIds.includes('transversal-2-1'),'Never reuse a current ID for another competency');
const ambiguous=resolveSessionCriterionRows({instrumento:[instrument('a'),instrument('b')]},[row('old')]);
assert.deepEqual(ambiguous[0].recordIds,[],'An ambiguous match must not guess a grade');
const reordered=resolveSessionCriterionRows({instrumento:[instrument('1','TIC'),instrument('new')]},[row('old')]);
assert.ok(!reordered[0].recordIds.includes('1'),'A table position cannot borrow another competency grade');
assert.ok(resolveSessionCriterionRows({},[row('legacy')])[0].recordIds.includes('1'),'Unlabelled legacy numeric criteria remain readable');
const reworded=resolveSessionCriterionRows({instrumento:[instrument('stable','Autonomía','Define metas.','Producto de la evaluación')]},[row('stable')]);
assert.ok(reworded[0].recordIds.includes('stable'),'Keep explicit stable IDs when legacy instrument wording differs');
const tic=row('tic-1','TIC','Personaliza entornos.','Configura su perfil');
const autonomy=row('autonomy-1');
const positionalSession={...session,sessionData:{sessionAssessmentModel:{rows:[tic,autonomy]},instrumento:[
  instrument('tic-1','TIC','Personaliza entornos.','Captura de su perfil'),
  instrument('tic-2','TIC','Personaliza entornos.','Registro del grupo'),
  instrument('autonomy-1')
]}};
const positional=calculator.buildUnitRegisterAggregation({students:[students[0]],sessions:[positionalSession],records:[
  {...records[0],criteria_id:'tic-1',numeric_score:10},
  {...records[0],criteria_id:'tic-2',numeric_score:12}
]});
assert.equal(positional.students[0].capacities.find(item=>item.competencyName==='Autonomía').numericScore,null,'Do not display the second TIC grade as Autonomy just because it occupies the same table position');
assert.equal(positional.students[0].capacities.find(item=>item.competencyName==='TIC').numericScore,10);
const zero=calculator.buildUnitRegisterAggregation({students:[students[0]],sessions:[session],records:[{...records[0],numeric_score:0}]});
assert.equal(zero.students[0].capacities[0].numericScore,0,'A saved zero remains zero');
console.log('OK: current criterion identity across sessions, units and bimesters; fourteen grades, cross-competency ID collisions, pending, ambiguity and zero preservation.');
