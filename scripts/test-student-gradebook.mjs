import assert from 'node:assert/strict';
import { buildStudentGradebook, resolveStudentGradingMode } from '../backend/studentGradebook.js';
import { createRegisterAggregation, buildUnitRegisterAggregation } from '../backend/shared/registerAggregation.generated.js';
import { isAutomaticPracticeGrade } from '../backend/shared/teacherGradeSource.js';

const student = { id: 'student-a', name: 'Estudiante', grade: '3ro', section: 'A', estado: 'A' };
const sessions = [1,1,1,2,3,8].map((unit,index) => ({ id: `s${index}`, areaId: 'EPT', areaName: 'Educación para el Trabajo', year: '2026', grade: '3ro', section: 'A', unitNumber: String(unit), sessionNumber: String(index+1), bimesterLabel: unit <= 2 ? 'I' : unit <= 4 ? 'II' : 'IV', title: `Sesión ${index+1}`, sessionData: {
  competenciaPrio: { comp: 'Emprendimiento', cap: 'Crea propuestas', des: '<p>Diseña una propuesta</p>' },
  competenciasTrans: [{ comp: 'Autonomía', cap: 'Define metas', des: '<p>Organiza sus metas</p>' }],
  sessionAssessmentModel: { rows: [{ id: 'primary-1', source: 'primary', competencyName: 'Emprendimiento', capacityName: 'Crea propuestas', criterionText: 'Diseña una propuesta' }, { id: 'trans-1', source: 'transversal', competencyName: 'Autonomía', capacityName: 'Define metas', criterionText: 'Organiza sus metas' }] }
} }));
const records = ['c','c','c','ad'].flatMap((level,index) => [
  { student_id: student.id, session_id: `s${index}`, criteria_id: 'primary-1', level, grading_mode: 'literal_traditional' },
  { student_id: student.id, session_id: `s${index}`, criteria_id: 'trans-1', level: 'ad', grading_mode: 'literal_traditional' }
]);
const feedbackForSession = (session, own) => {
  assert.ok(own.every(row => row.student_id === student.id && row.session_id === session.id));
  const primary = own.find(row => row.criteria_id === 'primary-1');
  return { literalGrade: primary?.level || '', numericScore: primary?.numeric_score ?? null, competencyName: 'Emprendimiento', criteria: primary ? [{ level: primary.level, numericScore: primary.numeric_score ?? null }] : [], transversalCompetencies: [] };
};
const calculate = (mode, inputRecords = records) => buildStudentGradebook({ student, sessions, records: inputRecords, modeForArea: () => mode, feedbackForSession });
const normal = calculate('literal_traditional');
const oldPractice={student_id:student.id,session_id:'s4',criteria_id:'primary-1',level:'AD',numeric_score:18,grading_mode:'literal_traditional',observation:'[Actividad HTML:old] Practice: 18/20'};
assert.equal(isAutomaticPracticeGrade(oldPractice),true);
assert.equal(isAutomaticPracticeGrade({...oldPractice,numeric_score:19}),false,'Retain a teacher numeric correction even if its old note remains');
assert.equal(isAutomaticPracticeGrade({...oldPractice,level:'B'}),false,'Retain a teacher literal correction');
assert.deepEqual(calculate('literal_traditional',[...records,oldPractice]),normal,'An old practice result must not become a portal session grade');
const teacherMotor=createRegisterAggregation('literal_traditional');
const teacherBundle={students:[student],sessions,records};
assert.deepEqual(teacherMotor.buildBimesterRegisterAggregation({...teacherBundle,records:[...records,oldPractice]}),teacherMotor.buildBimesterRegisterAggregation(teacherBundle),'Teacher consolidation must also exclude old automatic practices');
const first = normal.areas[0].bimesters[0];
assert.deepEqual(first.unitNumbers, [1,2]);
assert.equal(first.units[0].code, 'c');
assert.equal(first.units[1].code, 'ad');
assert.equal(first.code, 'a', 'Bimestre weights the two units equally, despite having 3 versus 1 sessions');
assert.equal(first.competencies.find(item => item.source === 'transversal').code, 'ad');
assert.equal(normal.areas[0].bimesters[1].units[1].sessionCount, 0);
assert.equal(normal.areas[0].bimesters[1].units[1].code, 'ne', 'Missing unit must remain pending');
assert.equal(normal.areas[0].bimesters[1].inProgress, true);
assert.equal(normal.areas[0].bimesters[3].units[1].number, 8);
const injected = [...records, { ...records[0], student_id: 'other-student', level: 'ad' }, { ...records[0], grading_mode: 'hybrid_vigesimal', level: 'ad', numeric_score: 20 }];
assert.deepEqual(calculate('literal_traditional', injected), normal, 'Other students and grading modes never contaminate the result');
const numericRecords = records.map((row,index) => ({ ...row, grading_mode: 'hybrid_vigesimal', numeric_score: row.criteria_id === 'trans-1' ? 20 : index < 6 ? 0 : 20 }));
const numeric = calculate('hybrid_vigesimal', numericRecords);
assert.equal(numeric.areas[0].bimesters[0].units[0].numericScore, 0, 'A genuine zero remains a valid grade');
assert.equal(numeric.areas[0].bimesters[0].numericScore, 10);
assert.equal(numeric.areas[0].bimesters[0].code, 'c');
assert.equal(numeric.areas[0].bimesters[1].numericScore, null, 'An ungraded period is never presented as zero');
const predominance = createRegisterAggregation('criterial_predominance');
const tieRecords = records.map((row,index) => ({ ...row, level: index === 0 ? 'b' : 'a' }));
const bundle = { students: [student], sessions: [sessions[0]], records: tieRecords };
assert.deepEqual(createRegisterAggregation('literal_traditional').buildUnitRegisterAggregation(bundle), buildUnitRegisterAggregation(bundle), 'Teacher default behavior remains unchanged');
assert.equal(predominance.buildUnitRegisterAggregation(bundle).students[0].overallCode, 'b');
assert.equal(calculate('literal_traditional').areas[0].bimesters[0].code, first.code, 'Isolated modes do not leak between calculations');
console.log('OK: teacher calculation parity, equal unit weighting, pending versus zero, separate competencies, modes and student privacy.');

const modeScope = { areaId: 'EPT', grade: '5to', section: 'A', defaultMode: 'hybrid_vigesimal', sectionsOverlap: (a,b) => a === b };
assert.equal(resolveStudentGradingMode({ ...modeScope, modes: [] }), 'hybrid_vigesimal', 'Use the teacher mode when no scoped override exists');
assert.equal(resolveStudentGradingMode({ ...modeScope, modes: [{area_id:'EPT',grade:'2do',section:'A',grading_mode:'criterial_predominance'}] }), 'hybrid_vigesimal');
assert.equal(resolveStudentGradingMode({ ...modeScope, modes: [{area_id:'EPT',grade:'5to',section:'A',grading_mode:'literal_traditional'}] }), 'hybrid_vigesimal','A historical scoped setting must not override the teacher active mode');
assert.equal(resolveStudentGradingMode({ ...modeScope, defaultMode:undefined, modes: [{area_id:'EPT',grade:'5to',section:'A',grading_mode:'literal_traditional'}] }), 'literal_traditional','Scoped settings remain a fallback when no teacher active mode exists');
for(const grade of ['2do','3ro','4to','5to']) for(const section of ['A','B','U']) {
 assert.equal(resolveStudentGradingMode({...modeScope,grade,section,modes:[{area_id:'EPT',grade,section,grading_mode:'criterial_predominance'}]}),'hybrid_vigesimal');
}
const currentSessions = Array.from({length:13},(_,i) => ({...sessions[0], id:`current-${i}`,unitNumber:i<6?'5':'6',sessionNumber:String(i<6?i+1:i-5),bimesterLabel:'III'}));
const currentRecords = [13,13,14,0,13,14,13].map((score,i) => ({student_id:student.id,session_id:`current-${i}`,criteria_id:'primary-1',level:'b',numeric_score:score,grading_mode:'hybrid_vigesimal'}));
currentRecords.push(...[11,12].map(i=>({student_id:student.id,session_id:`current-${i}`,criteria_id:'primary-1',level:'ad',numeric_score:20,grading_mode:'literal_traditional'})));
const current = buildStudentGradebook({student,sessions:currentSessions,records:currentRecords,modeForArea:()=>resolveStudentGradingMode({...modeScope,modes:[]}),feedbackForSession}).areas[0].bimesters[2];
assert.equal(current.units.reduce((sum,unit)=>sum+unit.gradedSessions,0),7);
assert.equal(current.units[0].code,'b');
assert.ok(Math.abs(current.units[0].numericScore - 67/6)<0.00001);
assert.equal(current.units[1].sessions[5].code,'ne','Legacy literal grades must not appear in the current numeric mode');
assert.equal(current.units[1].sessions[6].code,'ne');
assert.equal(current.code,'ne','An incomplete numeric bimester stays pending');
console.log('OK: current teacher mode retrieves seven numeric sessions and excludes obsolete literal grades.');
