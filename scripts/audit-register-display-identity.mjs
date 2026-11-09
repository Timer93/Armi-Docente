import Database from 'better-sqlite3';import fs from 'node:fs';
import {createRegisterAggregation as oldMotor} from '../artifacts/pending-audit/register-before.js';
import {createRegisterAggregation as newMotor} from '../backend/shared/registerAggregation.generated.js';
const db=new Database(process.env.APPDATA+'/ARMI Docente/database/armi.db',{readonly:true});
const sessions=db.prepare("SELECT * FROM sesiones WHERE year='2026'").all().map(r=>({id:r.id_sesion,year:r.year,areaId:r.area_id,grade:r.grade,section:r.section,unitNumber:r.unit_number,sessionNumber:r.session_number,sessionData:JSON.parse(r.session_data),bimesterLabel:['I','II','III','IV'][Math.floor((Number(r.unit_number)-1)/2)]}));
const students=db.prepare('SELECT * FROM db_estudiantes').all().map(r=>({id:String(r.id),name:r.estudiantes,grade:r.grado,section:r.secc,estado:r.estado}));const records=db.prepare("SELECT * FROM evaluacion_registros WHERE grading_mode='hybrid_vigesimal'").all();
const changes=[],summary=[];
for(const grade of [...new Set(students.map(s=>s.grade))])for(const section of [...new Set(students.filter(s=>s.grade===grade).map(s=>s.section))])for(const bimester of ['I','II','III','IV']){
const bundle={sessions:sessions.filter(s=>s.grade===grade&&s.section.split(/,| y | Y |\//).map(s=>s.trim()).includes(section)&&s.bimesterLabel===bimester),students:students.filter(s=>s.grade===grade&&s.section===section),records};if(!bundle.sessions.length)continue;
const before=oldMotor('hybrid_vigesimal').buildBimesterRegisterAggregation(bundle),after=newMotor('hybrid_vigesimal').buildBimesterRegisterAggregation(bundle);let diffs=0;
for(const student of after.students){const prev=before.students.find(s=>s.studentId===student.studentId);for(const c of student.capacities){const old=prev?.capacities.find(r=>r.key===c.key);if(old?.numericScore!==c.numericScore||!!old?.pending!==!!c.pending){changes.push({grade,section,bimester,student:student.studentName,capacity:c.capacityName,before:old?.numericScore,wasPending:old?.pending,after:c.numericScore,pending:c.pending});diffs++;}}}
summary.push({grade,section,bimester,changedCapacities:diffs,pendingCompetencies:after.students.flatMap(s=>s.competencies).filter(c=>c.pending).length});}
fs.writeFileSync('artifacts/pending-audit/impact.json',JSON.stringify({summary,changes},null,2));console.log(JSON.stringify({summary:summary.filter(r=>r.changedCapacities),changes:changes.slice(0,4)},null,2));db.close();
