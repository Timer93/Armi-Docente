import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import Database from 'better-sqlite3';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import {reviewNormalization} from './review-bimester-normalization.mjs';
import {createRegisterAggregation} from '../backend/shared/registerAggregation.generated.js';
import {hybridGradeIssue} from '../backend/shared/hybridGradeIntegrity.js';

const participantIds=value=>{try{return JSON.parse(value||'[]').map(String);}catch{return [];}};
const sections=value=>String(value||'').toUpperCase().split(/,| Y |\/|-/).map(value=>value.trim()).filter(Boolean);
const overlaps=(left,right)=>sections(left).some(value=>sections(right).includes(value));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

// Read literals with a parser. Never execute code from a student's/teacher's HTML.
function literal(node) {
  if(ts.isStringLiteral(node)||ts.isNumericLiteral(node))return ts.isNumericLiteral(node)?Number(node.text):node.text;
  if(node.kind===ts.SyntaxKind.TrueKeyword)return true;
  if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
  if(ts.isArrayLiteralExpression(node))return node.elements.map(literal);
  if(ts.isObjectLiteralExpression(node))return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(property=>[property.name.text,literal(property.initializer)]));
  return null;
}
export function inspectActivity(activity) {
  const {document}=parseHTML(activity.html||'');
  const scripts=[...document.querySelectorAll('script')].map(script=>script.textContent);
  const banks=[];
  for(const script of scripts){
    const source=ts.createSourceFile('activity.js',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const visit=node=>{
      if(ts.isVariableDeclaration(node)&&node.initializer&&ts.isArrayLiteralExpression(node.initializer)){
        const value=literal(node.initializer);
        if(value?.some(item=>item&&typeof item==='object'&&(item.pregunta||item.prompt||item.title||item.titulo)))banks.push({name:node.name.getText(source),items:value});
      }
      ts.forEachChild(node,visit);
    };
    visit(source);
  }
  return {id:activity.id,title:activity.title,criterionId:activity.criterionId,criterionText:activity.criterionText,
    mode:activity.mode,htmlSha256:hash(activity.html||''),banks};
}

export function verifyCooperationAnswers(htmlEvidence) {
  const checkpoint=htmlEvidence.checkpoint;
  const bank=htmlEvidence.activity.banks.find(bank=>bank.name==='banco')?.items||[];
  const answers=checkpoint?.state?.respuestas||{};
  return bank.filter(question=>question.id).map(question=>({id:question.id,area:question.area,question:question.pregunta,
    chosen:answers[question.id]?.elegida??null,correctIndex:question.correcta,
    verifiedCorrect:answers[question.id]?.correcta===true&&answers[question.id]?.elegida===question.correcta,
    correctAnswer:question.opciones?.[question.correcta]||''}));
}

export function buildProposal(db,assessments) {
  const base=reviewNormalization(db);
  const sessions=db.prepare('SELECT * FROM sesiones').all().map(session=>({...session,data:JSON.parse(session.session_data||'{}')}));
  const sessionMap=new Map(sessions.map(session=>[session.id_sesion,session]));
  const allRecords=db.prepare('SELECT * FROM evaluacion_registros ORDER BY id').all();
  const results=db.prepare('SELECT * FROM interactive_activity_results').all();
  const attempts=db.prepare('SELECT * FROM interactive_activity_attempts').all();
  const inspected=new Map();
  const candidates=base.reviews.map(candidate=>{
    const activities=sessionMap.get(candidate.sessionId).data.interactiveActivities||[];
    const ownResults=results.filter(result=>result.session_id===candidate.sessionId&&(result.scope_type==='group'
      ?participantIds(result.student_ids).includes(candidate.studentId)
      :String(result.student_id||result.scope_key)===candidate.studentId));
    const html=ownResults.map(result=>{
      const activity=activities.find(activity=>activity.id===result.activity_id);
      if(activity&&!inspected.has(activity.id))inspected.set(activity.id,inspectActivity(activity));
      const attempt=attempts.find(attempt=>attempt.session_id===result.session_id&&attempt.activity_id===result.activity_id&&attempt.scope_type===result.scope_type&&attempt.scope_key===result.scope_key);
      let checkpoint=null;try{checkpoint=JSON.parse(attempt?.checkpoint_json||'null');}catch{}
      const current=!!result.completed_at&&(!result.reset_at||result.completed_at>result.reset_at);
      return {resultId:result.id,activity:activity?inspected.get(activity.id):null,activityId:result.activity_id,
        criterionMatches:activity?.criterionId===candidate.criteriaId,score:result.score,summary:result.answers_summary,
        completedAt:result.completed_at,resetAt:result.reset_at,current,
        status:attempt?.status||'resultado histórico sin checkpoint',checkpoint,
        assessment:assessments.activities[result.activity_id]||null};
    });
    const known=assessments.cases[String(candidate.recordId)];
    // Human decisions belong to this frozen review. No high-score rule generates changes.
    if(html.length&&!known)throw new Error(`Falta dictamen individual para el registro ${candidate.recordId}.`);
    const newScore=known?.newScore??candidate.score;
    assert.ok(newScore===candidate.score||candidate.options.includes(newScore),'Proposal outside the authorized normalization rules');
    if(newScore!==candidate.score){
      assert.ok(html.some(result=>result.current&&result.criterionMatches&&result.activity&&result.assessment),'No aligned current HTML result');
      assert.equal(hybridGradeIssue({grading_mode:'hybrid_vigesimal',level:candidate.level,numeric_score:newScore}),'');
    }
    return {...candidate,newScore,decision:newScore===candidate.score?'conservar':'proponer ajuste',
      reason:known?.reason||'Conservar: no hay un resultado HTML individual registrado para esta sesión. La rúbrica general, el historial y las transversales disponibles no justifican por sí solos el incremento.',
      recommendationType:known?.recommendationType||'Conservar',
      strength:known?.strength||'',limitation:known?.limitation||'',availableActivityIds:activities.filter(activity=>activity.criterionId===candidate.criteriaId).map(activity=>activity.id),html};
  });
  const proposed=candidates.filter(candidate=>candidate.newScore!==candidate.score);
  // Verify the concrete facts supporting the reviewed recommendations.
  const jordan=proposed.find(candidate=>candidate.recordId===180668);
  if(jordan){
    const evidence=jordan.html.find(result=>result.resultId===152);
    assert.equal(evidence?.status,'completed');assert.equal(evidence?.score,20);
    const answers=verifyCooperationAnswers(evidence);
    assert.equal(answers.length,10);assert.ok(answers.every(answer=>answer.verifiedCorrect));
    assert.ok(jordan.history.some(row=>row.unit==='5'&&row.session==='3'&&row.score===13));
    assert.ok(jordan.transversal.some(row=>row.score===14));assert.equal(jordan.comments.length,0);
    jordan.verifiedDecisions=answers;
  }
  const evelin=proposed.find(candidate=>candidate.recordId===180775);
  if(evelin){
    const evidence=evelin.html.find(result=>result.resultId===37);
    assert.equal(evidence?.score,16);assert.ok(evidence.current&&evidence.criterionMatches);
    assert.ok(evelin.history.some(row=>row.unit==='6'&&row.session==='2'&&row.score===13.5));
    assert.ok(evelin.transversal.some(row=>row.score===12));
  }
  const changes=new Map(proposed.map(candidate=>[candidate.recordId,candidate.newScore]));
  const modified=allRecords.map(record=>changes.has(record.id)?{...record,numeric_score:changes.get(record.id)}:record);
  assert.equal(modified.filter((record,index)=>JSON.stringify(record)!==JSON.stringify(allRecords[index])).length,proposed.length);
  const baselineRecords=allRecords.filter(record=>record.grading_mode==='hybrid_vigesimal');
  const proposedRecords=modified.filter(record=>record.grading_mode==='hybrid_vigesimal');
  const calculator=createRegisterAggregation('hybrid_vigesimal');
  const dbStudents=new Map(db.prepare('SELECT * FROM db_estudiantes').all().map(student=>[String(student.id),student]));
  const impacts=[];
  // Use ARMI's actual capacity/competency weighting and rounding, never a simple
  // invented mean of all session scores; only clone the two proposed values.
  for(const studentId of new Set(candidates.map(candidate=>candidate.studentId))){
    const student=dbStudents.get(studentId);
    const first=candidates.find(candidate=>candidate.studentId===studentId),area=sessionMap.get(first.sessionId).area_id;
    const scoped=sessions.filter(session=>String(session.year)==='2026'&&String(session.area_id)===String(area)
      &&session.grade===student.grado&&overlaps(session.section,student.secc)&&[5,6].includes(Number(session.unit_number)))
      .map(session=>({id:session.id_sesion,year:session.year,areaId:session.area_id,grade:session.grade,section:session.section,unitNumber:session.unit_number,sessionNumber:session.session_number,bimesterLabel:'III',sessionData:session.data}));
    const person={id:studentId,name:student.estudiantes,estado:student.estado};
    for(const period of ['U5','U6','III']){
      const scope=period==='III'?scoped:scoped.filter(session=>Number(session.unitNumber)===Number(period.slice(1)));
      const method=period==='III'?'buildBimesterRegisterAggregation':'buildUnitRegisterAggregation';
      const before=calculator[method]({students:[person],sessions:scope,records:baselineRecords}).students[0];
      const after=calculator[method]({students:[person],sessions:scope,records:proposedRecords}).students[0];
      for(const competency of before.competencies){
        const next=after.competencies.find(item=>item.key===competency.key);
        assert.ok(next);
        if(competency.source==='transversal'||!proposed.some(row=>row.studentId===studentId)||period==='U5')assert.deepEqual(next,competency);
        impacts.push({studentId,studentName:student.estudiantes,grade:student.grado,section:student.secc,period,
          competency:competency.competencyName,source:competency.source,before:{score:competency.numericScore,code:competency.code,pending:competency.pending},
          after:{score:next.numericScore,code:next.code,pending:next.pending},
          numericChanged:competency.numericScore!==next.numericScore,levelChanged:competency.code!==next.code});
      }
    }
  }
  return {createdAt:new Date().toISOString(),scope:{year:'2026',bimester:'III',units:[5,6],mode:'hybrid_vigesimal'},
    applied:false,summary:{candidates:candidates.length,withHtmlResult:candidates.filter(row=>row.html.length).length,
      withoutHtmlResult:candidates.filter(row=>!row.html.length).length,proposed:proposed.length,kept:candidates.length-proposed.length,
      bimonthlyCompetencyLevelChanges:impacts.filter(row=>row.period==='III'&&row.levelChanged).length},
    note:'Propuesta de juicio pedagógico, sin fórmula de conversión HTML→EPT. Si la nota manual ya incluyó estas prácticas, no se deben contar otra vez: conservar la nota original. El registro no permite determinar si ya fueron consideradas.',
    candidates,activities:[...inspected.values()].map(activity=>({...activity,...assessments.activities[activity.id]})),impacts};
}

const fmt=value=>value===null?'Pendiente':Number(value).toLocaleString('es-PE',{minimumFractionDigits:4,maximumFractionDigits:4});
const escape=value=>String(value??'').replace(/\|/g,'/').replace(/[\r\n]+/g,' ');
export function writeProposal(report,out) {
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'propuesta-completa.json'),JSON.stringify(report,null,2));
  const proposed=report.candidates.filter(row=>row.newScore!==row.score);
  const lines=['# Propuesta revisada con prácticas HTML — III bimestre 2026','',
    '**No aplicada: ninguna nota fue modificada.**','',
    `${report.summary.candidates} candidatas: ${report.summary.withHtmlResult} con resultado HTML y ${report.summary.withoutHtmlResult} sin resultado HTML individual registrado para esa sesión. Se proponen ${proposed.length} ajustes y se conservan ${report.summary.kept} notas.`,
    '', 'Las dos propuestas tienen distinto respaldo: Jordan tiene respuestas individuales verificables; Evelin es una alternativa condicionada a valoración docente porque solo existe el puntaje agregado. Si se exige el mismo grado de detalle que en Jordan, corresponde conservar el 12 de Evelin.',
    '',report.note,'','## Cambios propuestos','',
    '| Estudiante | Grado / sección | Sesión | EPT actual → propuesto | Práctica HTML |',
    '| --- | --- | --- | --- | --- |',
    ...proposed.map(row=>`| ${row.studentName} | ${row.grade} ${row.section} | U${row.unit} S${row.session} | ${row.score} → ${row.newScore} | ${row.html.map(result=>result.score+'/20').join('; ')} |`)];
  for(const row of proposed)lines.push('',`**${row.studentName} — ${row.recommendationType}:** ${row.reason}`,'',`Límite del sustento: ${row.limitation}`);
  lines.push('','## Efecto previsto en la competencia EPT','',
    'Calculado con el mismo motor de ARMI: consolidación por capacidades y competencias, sin mezclar modos ni redondear los números intermedios. El redondeo configurado elige la letra y conserva el promedio real. Los valores siguientes se muestran con cuatro decimales para hacer visible el efecto; son resultados de simulación, no nuevas notas guardadas.','',
    '| Estudiante | Periodo | Promedio actual | Promedio propuesto | Letra actual → propuesta |',
    '| --- | --- | --- | --- | --- |',
    ...report.impacts.filter(row=>row.numericChanged).map(row=>`| ${row.studentName} | ${row.period} | ${fmt(row.before.score)} | ${fmt(row.after.score)} | ${row.before.code.toUpperCase()} → ${row.after.code.toUpperCase()} |`),
    '',`Cambios de letra en competencias del bimestre: **${report.summary.bimonthlyCompetencyLevelChanges}**. La unidad 5 y las competencias transversales conservan sus valores.`,
    '', '## Correspondencia real de las actividades con el criterio','',
    '| Práctica | Valor como evidencia | Qué permite comprobar | Qué no acredita |',
    '| --- | --- | --- | --- |',
    ...report.activities.map(row=>`| ${[row.title,row.classification,row.demonstrates,row.doesNotDemonstrate].map(escape).join(' | ')} |`),
    '', '## Casos con HTML que se conservan','',
    '| Estudiante | Sesión | EPT | HTML | Motivo |','| --- | --- | --- | --- | --- |',
    ...report.candidates.filter(row=>row.html.length&&row.score===row.newScore).map(row=>`| ${[row.studentName,`U${row.unit} S${row.session}`,row.score,row.html.map(result=>`${result.score}/20 (${result.status})`).join('; '),row.reason].map(escape).join(' | ')} |`),
    '', 'Las 85 candidatas sin resultado HTML permanecen sin cambios. El detalle de las 103 candidatas, con historial, transversales y observaciones, está en revision-individual.txt. Las notas 10, 11, 13, 15, 16 y las demás calificaciones no se proponen modificar.');
  fs.writeFileSync(path.join(out,'resumen-propuesta.md'),lines.join('\n'));
  const details=['PROPUESTA DE NORMALIZACIÓN CON PRÁCTICAS HTML — SIN APLICAR','',report.note,''];
  for(const row of report.candidates){
    details.push(`${row.recordId} — ${row.studentName} — ${row.grade} ${row.section} — U${row.unit} S${row.session}`,
      `EPT: ${row.score} -> ${row.newScore}. Decisión: ${row.decision}. Respaldo: ${row.recommendationType}.`,`Capacidad: ${row.capacity}`,`Criterio: ${row.criterion}`,
      `Motivo: ${row.reason}`,`Transversales: ${row.transversal.map(item=>`${item.capacity}: ${item.score}`).join('; ')||'Sin notas utilizables'}`,
      `Historial anterior, misma capacidad: ${row.history.map(item=>`U${item.unit} S${item.session}: ${item.score}`).join('; ')||'Sin registros utilizables'}`,
      `Observaciones docentes: ${row.comments.map(item=>`[${item.type} ${item.id}] ${escape(item.text)}`).join(' / ')||'Sin observaciones registradas'}`,
      `HTML: ${row.html.map(item=>`[resultado ${item.resultId}, actividad ${item.activityId}] ${item.score}/20, ${item.status}; ${item.summary}; correspondencia: ${item.assessment?.classification||'sin actividad disponible para verificar'}`).join(' / ')||'Sin resultado individual para esta sesión; esto no implica que el estudiante no haya participado.'}`);
    if(row.limitation)details.push(`Límite: ${row.limitation}`);
    details.push('');
  }
  fs.writeFileSync(path.join(out,'revision-individual.txt'),'\ufeff'+details.join('\r\n'));
  fs.writeFileSync(path.join(out,'impacto-competencias.txt'),'\ufeff'+['SIMULACIÓN DE COMPETENCIAS — NO APLICADA','',...report.impacts.map(row=>`${row.studentName} | ${row.grade} ${row.section} | ${row.period} | ${row.competency} | ${fmt(row.before.score)} ${row.before.code.toUpperCase()} -> ${fmt(row.after.score)} ${row.after.code.toUpperCase()}`)].join('\r\n'));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{db:{type:'string'},out:{type:'string'},assessments:{type:'string'}}});
  if(!values.db||!values.out)throw new Error('Use --db snapshot.db --out carpeta [--assessments dictamen.json]. Solo lectura.');
  const assessments=JSON.parse(fs.readFileSync(values.assessments||new URL('./normalization-html-assessments.json',import.meta.url),'utf8'));
  const db=new Database(values.db,{readonly:true,fileMustExist:true});
  try{const report=buildProposal(db,assessments);writeProposal(report,values.out);console.log(JSON.stringify(report.summary,null,2));}finally{db.close();}
}
