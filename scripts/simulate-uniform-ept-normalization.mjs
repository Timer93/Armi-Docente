import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
import {createRegisterAggregation} from '../backend/shared/registerAggregation.generated.js';
import {resolveSessionCriterionRows} from '../backend/shared/sessionCriterionIdentity.js';
import {hybridGradeIssue} from '../backend/shared/hybridGradeIntegrity.js';

export const UNIFORM_RULES=Object.freeze({5:5,10:10,11:11,12:13,13:13,14:16,15:16,16:16});
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const isEpt=row=>row.source==='primary'&&normalize(row.competencyName).includes('gestiona proyectos de emprendimiento');
const sections=value=>String(value||'').toUpperCase().split(/,| Y |\/|-/).map(value=>value.trim()).filter(Boolean);
const overlap=(left,right)=>sections(left).some(value=>sections(right).includes(value));
const validCode=code=>['c','b','a','ad'].includes(code);
const rank=code=>['c','b','a','ad'].indexOf(code);
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=20;

export function normalizeAuxiliaryScore(value) {
  return numeric(value)&&Object.hasOwn(UNIFORM_RULES,value)?UNIFORM_RULES[value]:value;
}

export function countTransitions(rows) {
  const evaluated=rows.filter(row=>validCode(row.before.code)&&validCode(row.after.code));
  const counts={total:rows.length,evaluated:evaluated.length,unchanged:evaluated.filter(row=>row.before.code===row.after.code).length,
    cToB:0,bToA:0,aToAd:0,decreased:0,otherIncreases:0,neUnchanged:0,otherNeChanges:0};
  for(const row of rows){
    const pair=`${row.before.code}->${row.after.code}`;
    if(pair==='c->b')counts.cToB++;
    else if(pair==='b->a')counts.bToA++;
    else if(pair==='a->ad')counts.aToAd++;
    else if(validCode(row.before.code)&&validCode(row.after.code)){
      if(rank(row.after.code)<rank(row.before.code))counts.decreased++;
      else if(rank(row.after.code)>rank(row.before.code))counts.otherIncreases++;
    }else if(pair==='ne->ne')counts.neUnchanged++;
    else counts.otherNeChanges++;
  }
  assert.equal(counts.evaluated,counts.unchanged+counts.cToB+counts.bToA+counts.aToAd+counts.decreased+counts.otherIncreases);
  assert.equal(counts.total,counts.evaluated+counts.neUnchanged+counts.otherNeChanges);
  return counts;
}

// There is no write/apply mode. Only independent JS objects hold normalized values.
// HTML, observations, evidence and transversal scores never select a normalization.
export function simulateUniformEpt(db,{year='2026',units=[5,6]}={}) {
  const calculator=createRegisterAggregation('hybrid_vigesimal');
  const ruleVerification=Object.entries(UNIFORM_RULES).map(([before,after])=>{
    const original=Number(before),from=calculator.numericScoreToRegisterLevel(original),to=calculator.numericScoreToRegisterLevel(after);
    assert.equal(from,to,'An individual literal level would change');
    return {original,normalized:after,originalLevel:from,normalizedLevel:to};
  });
  const sessions=db.prepare('SELECT id_sesion,year,area_id,grade,section,unit_number,session_number,session_data FROM sesiones WHERE year=?').all(year)
    .filter(session=>units.includes(Number(session.unit_number))).map(session=>{
      const data=JSON.parse(session.session_data||'{}');
      const rows=resolveSessionCriterionRows(data,data.sessionAssessmentModel?.rows||[]);
      return {id:session.id_sesion,year:session.year,areaId:session.area_id,grade:session.grade,section:session.section,
        unitNumber:session.unit_number,sessionNumber:session.session_number,bimesterLabel:'III',sessionData:data,resolvedRows:rows};
    }).filter(session=>session.resolvedRows.some(isEpt));
  const sessionMap=new Map(sessions.map(session=>[session.id,session]));
  // No observation fields are read for this calculation.
  const originalRecords=db.prepare('SELECT id,student_id,session_id,criteria_id,grading_mode,numeric_score,level FROM evaluacion_registros ORDER BY id').all();
  const originalJson=JSON.stringify(originalRecords);
  const sourceSessionsJson=JSON.stringify(sessions);
  const students=db.prepare('SELECT id,estudiantes,grado,secc,estado FROM db_estudiantes ORDER BY grado,secc,estudiantes').all();
  const names=new Map(students.map(student=>[String(student.id),student.estudiantes]));
  const deleted=new Map(db.prepare('SELECT student_id,student_name FROM student_deletion_tombstones').all().map(row=>[String(row.student_id),row.student_name]));
  const numericEpt=[],recordChanges=[],recordIssues=[],unresolvedEpt=[];
  const frequencies=new Map();
  const simulatedRecords=originalRecords.map(record=>{
    if(record.grading_mode!=='hybrid_vigesimal'||!sessionMap.has(record.session_id))return record;
    const session=sessionMap.get(record.session_id);
    const owners=session.resolvedRows.filter(row=>row.recordIds.includes(String(record.criteria_id)));
    if(owners.length!==1){
      if(String(record.criteria_id).startsWith('primary')&&numeric(record.numeric_score))unresolvedEpt.push(record);
      return record;
    }
    const descriptor=owners[0];
    if(!isEpt(descriptor)||!numeric(record.numeric_score))return record;
    const after=normalizeAuxiliaryScore(record.numeric_score);
    assert.equal(calculator.numericScoreToRegisterLevel(record.numeric_score),calculator.numericScoreToRegisterLevel(after));
    const info={recordId:record.id,studentId:String(record.student_id),studentName:names.get(String(record.student_id))||deleted.get(String(record.student_id))||String(record.student_id),
      grade:session.grade,unit:session.unitNumber,session:session.sessionNumber,sessionId:session.id,criteriaId:record.criteria_id,
      capacity:descriptor.capacityName,originalScore:record.numeric_score,normalizedScore:after,
      originalNumericLevel:calculator.numericScoreToRegisterLevel(record.numeric_score),normalizedNumericLevel:calculator.numericScoreToRegisterLevel(after),storedLevel:record.level};
    numericEpt.push(info);
    const key=`${record.numeric_score}->${after}`;frequencies.set(key,(frequencies.get(key)||0)+1);
    if(hybridGradeIssue(record))recordIssues.push({...info,issue:hybridGradeIssue(record)});
    if(after===record.numeric_score)return record;
    recordChanges.push(info);
    return {...record,numeric_score:after};
  });
  const baseline=originalRecords.filter(record=>record.grading_mode==='hybrid_vigesimal');
  const normalized=simulatedRecords.filter(record=>record.grading_mode==='hybrid_vigesimal');
  const changeIds=new Set(recordChanges.map(record=>record.recordId));
  simulatedRecords.forEach((record,index)=>{
    if(changeIds.has(record.id))assert.deepEqual(record,{...originalRecords[index],numeric_score:normalizeAuxiliaryScore(originalRecords[index].numeric_score)});
    else assert.deepEqual(record,originalRecords[index]);
  });
  const cohorts=new Map(),unmatchedStudents=[];
  for(const student of students){
    const areas=[...new Set(sessions.filter(session=>session.grade===student.grado&&overlap(session.section,student.secc)).map(session=>session.areaId))];
    if(!areas.length){unmatchedStudents.push({studentId:String(student.id),studentName:student.estudiantes,grade:student.grado,section:student.secc,state:student.estado});continue;}
    for(const area of areas){
      const key=`${area}::${student.grado}::${student.secc}`;
      if(!cohorts.has(key))cohorts.set(key,{area,grade:student.grado,section:student.secc,people:[]});
      cohorts.get(key).people.push({id:String(student.id),name:student.estudiantes,grade:student.grado,section:student.secc,estado:student.estado});
    }
  }
  const comparisons=[],capacityComparisons=[],transversalChecks=[];
  const pair=(before,after)=>({before:{score:before.numericScore??null,code:before.code,pending:!!before.pending},
    after:{score:after.numericScore??null,code:after.code,pending:!!after.pending},numericChanged:before.numericScore!==after.numericScore,levelChanged:before.code!==after.code});
  for(const cohort of cohorts.values()){
    const allSessions=sessions.filter(session=>String(session.areaId)===String(cohort.area)&&session.grade===cohort.grade&&overlap(session.section,cohort.section));
    for(const period of [...units.map(number=>`U${number}`),'III']){
      const scope=period==='III'?allSessions:allSessions.filter(session=>Number(session.unitNumber)===Number(period.slice(1)));
      const method=period==='III'?'buildBimesterRegisterAggregation':'buildUnitRegisterAggregation';
      const bundle={students:cohort.people,sessions:scope};
      const before=calculator[method]({...bundle,records:baseline});
      const after=calculator[method]({...bundle,records:normalized});
      for(const person of cohort.people){
        const left=before.students.find(row=>row.studentId===person.id),right=after.students.find(row=>row.studentId===person.id);
        const identity={studentId:person.id,studentName:person.name,grade:person.grade,section:person.section,state:person.estado,areaId:cohort.area,period};
        for(const competency of left.competencies){
          const next=right.competencies.find(item=>item.key===competency.key);assert.ok(next);
          if(isEpt(competency)){
            const comparison={...identity,competency:competency.competencyName,...pair(competency,next)};
            assert.equal(comparison.before.pending,comparison.after.pending,'Normalization must not create a completed grade');
            if(numeric(comparison.before.score))assert.ok(comparison.after.score>=comparison.before.score,'An average decreased');
            comparisons.push(comparison);
          }else{assert.deepEqual(next,competency,'A non-EPT competency changed');transversalChecks.push({...identity,competency:competency.competencyName,unchanged:true});}
        }
        for(const capacity of left.capacities){
          const next=right.capacities.find(item=>item.key===capacity.key);assert.ok(next);
          if(isEpt(capacity))capacityComparisons.push({...identity,capacity:capacity.capacityName,...pair(capacity,next)});
          else assert.deepEqual(next,capacity,'A transversal capacity changed');
        }
      }
    }
  }
  assert.equal(JSON.stringify(originalRecords),originalJson,'Original grade objects were mutated');
  assert.equal(JSON.stringify(sessions),sourceSessionsJson,'Original session objects were mutated');
  const periodCounts=Object.fromEntries([...units.map(number=>`U${number}`),'III'].map(period=>[period,countTransitions(comparisons.filter(row=>row.period===period))]));
  const affectedIds=new Set(recordChanges.map(row=>row.studentId));
  const numericAffectedIds=new Set(comparisons.filter(row=>row.period==='III'&&row.numericChanged).map(row=>row.studentId));
  const levelAffectedIds=new Set(comparisons.filter(row=>row.period==='III'&&row.levelChanged).map(row=>row.studentId));
  return {createdAt:new Date().toISOString(),applied:false,scope:{year,units,bimester:'III',mode:'hybrid_vigesimal',target:'EPT'},rules:UNIFORM_RULES,
    ruleVerification,summary:{sessions:sessions.length,scopedHybridRecords:baseline.filter(row=>sessionMap.has(row.session_id)).length,
      numericEptGrades:numericEpt.length,normalizedGrades:recordChanges.length,unchangedEptGrades:numericEpt.length-recordChanges.length,
      studentsWithNormalizedGrades:affectedIds.size,studentsWithNumericCompetencyChange:numericAffectedIds.size,
      studentsWithBimesterLevelChange:levelAffectedIds.size,studentsInComparison:new Set(comparisons.map(row=>row.studentId)).size,
      studentsWithPendingBimester:comparisons.filter(row=>row.period==='III'&&row.before.pending).length,
      studentsWithNonPendingNe:comparisons.filter(row=>row.period==='III'&&row.before.code==='ne'&&!row.before.pending).length,
      studentsWithoutSessions:unmatchedStudents.length,individualLiteralChanges:0,nonEptCompetencyChanges:0},
    frequencies:[...frequencies].map(([mapping,count])=>({mapping,count})),periodCounts,
    comparisons,capacityComparisons,transversalChecks,recordChanges,recordIssues,unresolvedEpt,unmatchedStudents,
    pendingComparisons:comparisons.filter(row=>row.period==='III'&&row.before.pending),
    levelChanges:comparisons.filter(row=>row.levelChanged),
    rounding:sessions.map(session=>({sessionId:session.id,rule:session.sessionData.numericAverageRounding||'Sin redondeo especial'}))};
}

const fmt=value=>value===null?'—':Number(value).toLocaleString('es-PE',{minimumFractionDigits:4,maximumFractionDigits:4});
const safe=value=>String(value??'').replace(/\|/g,'/').replace(/[\r\n]+/g,' ');
const heading='| Estudiante | Grado | Sección | Unidad | Promedio original | Nivel original | Promedio normalizado | Nivel propuesto |';
const divider='| --- | --- | --- | --- | --- | --- | --- | --- |';
const tableRow=row=>`| ${[row.studentName,row.grade,row.section,row.period==='III'?'III bimestre':row.period,fmt(row.before.score),row.before.code.toUpperCase(),fmt(row.after.score),row.after.code.toUpperCase()].map(safe).join(' | ')} |`;

export function writeUniformSimulation(report,out) {
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'simulacion-completa.json'),JSON.stringify(report,null,2));
  const s=report.summary,counts=report.periodCounts.III;
  const lines=['# Simulación matemática uniforme — EPT — III bimestre de 2026','',
    '**SIMULACIÓN: no aplicada. No se modificó ninguna calificación original, sesión, evidencia ni resultado definitivo.**','',
    'Se usa la misma equivalencia para todas las notas híbridas numéricas de criterios EPT de las unidades 5 y 6, sin consultar prácticas HTML, observaciones o desempeño transversal para decidir ajustes. Las demás notas y todos los registros transversales se conservan.','',
    '## Alcance y cantidades','',
    `- Sesiones: ${s.sessions}; registros híbridos del alcance: ${s.scopedHybridRecords} (incluyen transversales y filas sin nota).`,
    `- Calificaciones numéricas EPT analizadas: **${s.numericEptGrades}**.`,
    `- Calificaciones con valor auxiliar distinto: **${s.normalizedGrades}**; sin cambio: ${s.unchangedEptGrades}.`,
    `- Estudiantes con alguna nota auxiliar normalizada: **${s.studentsWithNormalizedGrades}**.`,
    `- Estudiantes con promedio EPT del bimestre distinto: **${s.studentsWithNumericCompetencyChange}**.`,
    `- Estudiantes con letra EPT del bimestre distinta: **${s.studentsWithBimesterLevelChange}**.`,
    `- Estudiantes con sesiones del alcance: ${s.studentsInComparison}; sin sesiones de U5/U6 en su grado/sección: ${s.studentsWithoutSessions}.`,
    `- Consolidados pendientes: ${s.studentsWithPendingBimester}. NE sin condición pendiente (retirados/trasladados según el motor): ${s.studentsWithNonPendingNe}.`,
    '', '## Equivalencias verificadas con los rangos reales de ARMI','',
    '| Original | Auxiliar | Literal original | Literal auxiliar |','| --- | --- | --- | --- |',
    ...report.ruleVerification.map(row=>`| ${row.original} | ${row.normalized} | ${row.originalLevel.toUpperCase()} | ${row.normalizedLevel.toUpperCase()} |`),
    '',`Cambios de literal individual por la equivalencia: **${s.individualLiteralChanges}**. Las notas no listadas se mantienen, incluidos los decimales.`,
    '', '## Transiciones de la competencia EPT','',
    'Cada fila cuenta estudiantes/competencias de un periodo. Como EPT tiene una competencia del área, el conteo del III bimestre equivale al de estudiantes; no se suman U5, U6 y III entre sí. NE se informa por separado y no se cuenta como C/B/A/AD.','',
    '| Periodo | Mantienen C/B/A/AD | C → B | B → A | A → AD | Disminuyen | Otras subidas | NE → NE |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(report.periodCounts).map(([period,c])=>`| ${period} | ${c.unchanged} | ${c.cToB} | ${c.bToA} | ${c.aToAd} | ${c.decreased} | ${c.otherIncreases} | ${c.neUnchanged} |`),
    '',`III bimestre: ${counts.evaluated} con nivel C/B/A/AD y ${counts.neUnchanged} que permanecen NE. ${report.pendingComparisons.length} estudiantes tienen consolidación pendiente según el motor.`,
    '', '## Casos cuyo nivel del bimestre cambia','',heading,divider,
    ...report.levelChanges.filter(row=>row.period==='III').map(tableRow),
    '', '## Interpretación y revisión docente','',
    '- Todo cambio listado es efecto de la equivalencia matemática y la consolidación existente. No significa que se haya demostrado un nuevo aprendizaje.',
    '- Revisar y autorizar la regla de normalización y sus cruces de nivel antes de cualquier aplicación definitiva. No se hicieron excepciones individuales.',
    '- El motor conserva sus ponderaciones por capacidad, competencia y unidad; no se sustituyó por una media simple de todas las sesiones.',
    '- Se respeta la configuración de redondeo de cada sesión. Cuando corresponde redondear, el entero se usa para elegir la letra; el promedio numérico real se conserva.',
    '- Las competencias y capacidades transversales se comprobaron idénticas entre ambos escenarios. No se mezclaron registros de otros modos.',
    '- NE y pendientes conservan esa condición: no se inventan notas para completar evaluaciones.',
    '', '## Incidencias preexistentes, sin corregir','',
    ...(report.recordIssues.length?report.recordIssues.map(row=>`- ${row.studentName}, ${row.grade}, U${row.unit} S${row.session}, ${row.criteriaId}: ${row.issue} Original ${row.originalScore}, auxiliar ${row.normalizedScore}.`):['Sin incompatibilidades individuales detectadas.']),
    ...(report.unresolvedEpt.length?[`- ${report.unresolvedEpt.length} registros con ID EPT no vinculado inequívocamente al criterio actual: conservados y pendientes de revisión técnica.`]:[]),
    '', 'Los estudiantes retirados/trasladados se mantienen con el tratamiento NE del motor. Los estudiantes sin sesiones de este bimestre en su grado/sección no reciben promedios inventados.','',
    'Archivos complementarios: comparativa-por-estudiante.md (tabla completa), capacidades.md (detalle por capacidad), revision-docente.txt y simulacion-completa.json.'];
  fs.writeFileSync(path.join(out,'informe.md'),lines.join('\n'));
  const ordered=[...report.comparisons].sort((a,b)=>[a.grade,a.section,a.studentName].join(' ').localeCompare([b.grade,b.section,b.studentName].join(' '),'es',{numeric:true})||['U5','U6','III'].indexOf(a.period)-['U5','U6','III'].indexOf(b.period));
  fs.writeFileSync(path.join(out,'comparativa-por-estudiante.md'),['# Comparativa por estudiante — competencia EPT','',
    'Simulación independiente; no aplicada. Promedios mostrados con cuatro decimales, calculados con precisión completa. La letra es la calculada por ARMI. NE no equivale a cero. Cada estudiante tiene filas U5, U6 y III bimestre.','',heading,divider,...ordered.map(tableRow)].join('\n'));
  fs.writeFileSync(path.join(out,'capacidades.md'),['# Comparativa de capacidades EPT — simulación sin aplicar','',
    '| Estudiante | Grado / sección | Periodo | Capacidad | Promedio original | Nivel original | Promedio auxiliar | Nivel propuesto |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.capacityComparisons.map(row=>`| ${[row.studentName,`${row.grade} ${row.section}`,row.period,row.capacity,fmt(row.before.score),row.before.code.toUpperCase(),fmt(row.after.score),row.after.code.toUpperCase()].map(safe).join(' | ')} |`)].join('\n'));
  const review=['REVISIÓN DOCENTE — SIMULACIÓN UNIFORME, SIN APLICAR','',
    'Los cambios siguientes derivan únicamente de la normalización numérica. No constituyen una revaloración de evidencias ni una nueva nota guardada.','',
    'CAMBIOS DE NIVEL POR COMPETENCIA (UNIDADES Y BIMESTRE)',
    ...report.levelChanges.map(row=>`${row.studentName} | ${row.grade} ${row.section} | ${row.period} | ${fmt(row.before.score)} ${row.before.code.toUpperCase()} -> ${fmt(row.after.score)} ${row.after.code.toUpperCase()}`),
    '', 'INCIDENCIAS INDIVIDUALES PREEXISTENTES',...report.recordIssues.map(row=>`${row.studentName} | ${row.grade} | U${row.unit} S${row.session} | ${row.criteriaId} | ${row.issue}`),
    '', 'CONSOLIDACIONES PENDIENTES',...report.pendingComparisons.map(row=>`${row.studentName} | ${row.grade} ${row.section} | NE; sigue pendiente en ambos escenarios.`),
    '', 'SIN SESIONES U5/U6 DEL GRADO/SECCIÓN',...report.unmatchedStudents.map(row=>`${row.studentName} | ${row.grade} ${row.section} | Sin consolidación simulada por falta de sesiones del alcance.`)];
  fs.writeFileSync(path.join(out,'revision-docente.txt'),'\ufeff'+review.join('\r\n'));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{db:{type:'string'},out:{type:'string'}}});
  if(!values.db||!values.out)throw new Error('Use --db snapshot.db --out carpeta. Solo simulación; no existe --apply.');
  const db=new Database(values.db,{readonly:true,fileMustExist:true});
  try{const report=simulateUniformEpt(db);writeUniformSimulation(report,values.out);console.log(JSON.stringify({summary:report.summary,periodCounts:report.periodCounts,frequencies:report.frequencies,issues:report.recordIssues.length},null,2));}finally{db.close();}
}
