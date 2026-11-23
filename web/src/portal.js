import {AuthError} from './apps-script-auth.js';
import {serviceLimit} from './ai.js';
import {matchesPortal,portalRegistryInfo,resolvePortal,validPortal} from './portal-registry.js';
const fail=(message,status=400)=>{throw new AuthError(message,status);};
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').trim();
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export async function portalReady(db){return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='student_portals'").first());}
async function record(db,teacherId,dataset,id){
 const table=dataset==='students'?'academic_edits':'planning_edits';
 const ready=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
 if(ready){const edit=await db.prepare(`SELECT payload_json,deleted FROM ${table} WHERE teacher_id=? AND dataset=? AND record_id=?`).bind(teacherId,dataset,id).first();if(edit)return edit.deleted?null:JSON.parse(edit.payload_json);}
 const base=await db.prepare('SELECT r.payload_json FROM academic_records r JOIN academic_heads h ON h.teacher_id=r.teacher_id AND h.active_import_id=r.import_id WHERE r.teacher_id=? AND r.dataset=? AND r.record_id=?').bind(teacherId,dataset,id).first();
 return base?JSON.parse(base.payload_json):null;
}
const active=student=>student&&['a','activo','active'].includes(norm(student.estado||'A'));
const belongs=(student,lesson)=>norm(student.grade)===norm(lesson.grade)&&String(lesson.section||'').split(/\s+y\s+|[,;/]/i).some(section=>norm(section)===norm(student.section));
const publicLesson=(id,lesson)=>({id,title:plain(lesson.title).slice(0,300),date:String(lesson.date||''),purpose:plain(lesson.purpose).slice(0,12000),situation:plain(lesson.situation).slice(0,12000),instructions:plain(lesson.secuencia?.proceso?.aplicacion||lesson.instructions||'').slice(0,16000)});
function cookie(request,env,value,seconds){const local=env.ARMI_ENV==='local'&&new URL(request.url).protocol==='http:';return `${local?'armi_student_local':'__Host-armi_student'}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${local?'':'; Secure'}`;}
async function studentSession(request,env,{digest,now,measurement}) {
 const name=env.ARMI_ENV==='local'&&new URL(request.url).protocol==='http:'?'armi_student_local':'__Host-armi_student';
 const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
 if(!/^[a-f0-9]{64}$/.test(token))fail('Inicia sesión en el portal de tu docente.',401);
 const session=await env.DB.prepare(`SELECT s.*,p.public_id,p.is_open,p.access_epoch,p.membership_until,a.revision,a.enabled FROM student_web_sessions s
 JOIN student_portals p ON p.teacher_id=s.teacher_id JOIN student_access a ON a.teacher_id=s.teacher_id AND a.student_id=s.student_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token),now).first();
 if(!session||!session.is_open||!session.enabled||session.portal_epoch!==session.access_epoch||session.access_revision!==session.revision||(session.membership_until&&session.membership_until<=now))fail('El acceso está cerrado o tu sesión venció. Solicita acceso a tu docente.',401);
 if(!await matchesPortal(env.DB,session.teacher_id,session.public_id,new URL(request.url).searchParams.get('portal')))fail('Inicia sesión en el enlace de tu docente.',401);
 const student=await record(env.DB,session.teacher_id,'students',session.student_id);if(!active(student))fail('Tu acceso ya no está habilitado.',401);
 if(measurement)measurement.teacherId=session.teacher_id;
 return {...session,student};
}
export async function teacherPortal(request,env,teacher,{readJson,digest,randomToken,now}) {
 const db=env.DB,url=new URL(request.url);if(!await portalReady(db)){if(request.method==='GET')return {ready:false};fail('Falta activar 0007_ai_student_portal.sql en D1.',503);}
 const portal=await db.prepare('SELECT * FROM student_portals WHERE teacher_id=?').bind(teacher.id).first();
 if(url.pathname==='/api/portal'&&request.method==='GET') {
  const registry=await portalRegistryInfo(db,teacher),identifier=portal&&(registry.slug||portal.public_id);
  return {ready:true,open:Boolean(portal?.is_open),revision:portal?.revision||0,url:identifier?`${url.origin}/estudiantes/${identifier}`:null,registryNumber:registry.number,registryMessage:registry.message,namedUrlReady:Boolean(registry.slug),published:(await db.prepare('SELECT session_id FROM student_publications WHERE teacher_id=? AND published=1').bind(teacher.id).all()).results.map(row=>row.session_id)};
 }
 if(url.pathname==='/api/portal'&&request.method==='PUT') {
  const body=await readJson(request);if(Object.keys(body).some(k=>!['open','revision'].includes(k))||typeof body.open!=='boolean'||!Number.isSafeInteger(body.revision)||body.revision<0)fail('Estado del portal no válido.');
  const membership=JSON.parse(teacher.membership_json);const until=typeof membership.expiresAt==='number'?membership.expiresAt:membership.expiresAt?Date.parse(membership.expiresAt):null;
  const result=await db.prepare(`INSERT INTO student_portals(teacher_id,public_id,is_open,revision,access_epoch,membership_until,updated_at) SELECT ?,?,?,1,1,?,? WHERE ?=0
   ON CONFLICT(teacher_id) DO UPDATE SET is_open=excluded.is_open,revision=student_portals.revision+1,access_epoch=student_portals.access_epoch+1,membership_until=excluded.membership_until,updated_at=excluded.updated_at WHERE student_portals.revision=?`)
   .bind(teacher.id,portal?.public_id||randomToken().slice(0,32),Number(body.open),Number.isFinite(until)?until:null,now,body.revision,body.revision).run();
  // Nonzero revisions need an UPDATE (the guarded INSERT intentionally creates only revision zero).
  if(!result.meta.changes&&body.revision>0){const updated=await db.prepare('UPDATE student_portals SET is_open=?,revision=revision+1,access_epoch=access_epoch+1,membership_until=?,updated_at=? WHERE teacher_id=? AND revision=?').bind(Number(body.open),Number.isFinite(until)?until:null,now,teacher.id,body.revision).run();if(!updated.meta.changes)fail('El portal cambió en otra pestaña. Recarga su estado.',409);}
  else if(!result.meta.changes)fail('El portal cambió en otra pestaña. Recarga su estado.',409);
  return {open:body.open};
 }
 if(url.pathname==='/api/portal/access'&&['POST','DELETE'].includes(request.method)){
  if(!portal)fail('Crea primero el enlace abriendo el portal.');
  const body=await readJson(request);if(Object.keys(body).some(k=>!['studentId','enabled'].includes(k))||typeof body.studentId!=='string'||body.studentId.length>250||(body.enabled!==undefined&&body.enabled!==true))fail('Estudiante no válido.');
  const student=await record(db,teacher.id,'students',body.studentId);if(!student)fail('Estudiante no encontrado.',404);
  if(request.method==='DELETE'){
   await db.prepare('INSERT INTO student_access(teacher_id,student_id,code_hash,enabled) VALUES(?,?,?,0) ON CONFLICT(teacher_id,student_id) DO UPDATE SET enabled=0,revision=student_access.revision+1').bind(teacher.id,body.studentId,await digest(randomToken())).run();return {revoked:true};
  }
  if(!active(student))fail('Selecciona un estudiante activo de tu cuenta.');
  await serviceLimit(db,`issue:${teacher.id}:${Math.floor(now/60_000)}`,30,now+120_000);
  const code=randomToken().slice(0,24);
  await db.prepare('INSERT INTO student_access(teacher_id,student_id,code_hash) VALUES(?,?,?) ON CONFLICT(teacher_id,student_id) DO UPDATE SET code_hash=excluded.code_hash,revision=student_access.revision+1,enabled=1').bind(teacher.id,body.studentId,await digest(code)).run();
  if(body.enabled===true)return {enabled:true};
  return {code};
 }
 if(url.pathname==='/api/portal/publications'&&request.method==='PUT'){
  if(!portal)fail('Crea primero el enlace abriendo el portal.');
  const body=await readJson(request);if(Object.keys(body).some(k=>!['sessionId','published'].includes(k))||typeof body.sessionId!=='string'||body.sessionId.length>250||typeof body.published!=='boolean')fail('Publicación no válida.');
  if(!await record(db,teacher.id,'sessions',body.sessionId))fail('Sesión no encontrada.',404);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM student_publications WHERE teacher_id=? AND published=1').bind(teacher.id).first();if(body.published&&count.n>=200)fail('El portal admite hasta 200 sesiones publicadas a la vez.',429);
  await db.prepare('INSERT INTO student_publications(teacher_id,session_id,published) VALUES(?,?,?) ON CONFLICT(teacher_id,session_id) DO UPDATE SET published=excluded.published').bind(teacher.id,body.sessionId,Number(body.published)).run();return {published:body.published};
 }
 if(url.pathname==='/api/portal/inbox'&&request.method==='GET')return {submissions:(await db.prepare('SELECT id,student_id,session_id,text,created_at FROM student_text_submissions WHERE teacher_id=? ORDER BY created_at DESC,id DESC LIMIT 30').bind(teacher.id).all()).results};
 fail('Operación del portal no disponible.',404);
}
export async function studentPortal(request,env,helpers) {
 const {readJson,digest,randomToken,now}=helpers,db=env.DB,url=new URL(request.url);
 if(!await portalReady(db))fail('El portal todavía no está disponible.',503);
 if(url.pathname==='/api/student/login'&&request.method==='POST') {
  const body=await readJson(request),byDni=body.dni!==undefined;
  if(Object.keys(body).some(k=>!['portal','code','dni'].includes(k))||!validPortal(body.portal)||(byDni?(body.code!==undefined||typeof body.dni!=='string'||!/^\d{8}$/.test(body.dni.trim())):typeof body.code!=='string'||body.code.length>80))fail('Revisa el enlace y tu DNI de ocho dígitos.');
  const ip=await digest(request.headers.get('cf-connecting-ip')||'local');await serviceLimit(db,`student:${body.portal}:${ip}:${Math.floor(now/60_000)}`,byDni?120:10,now+120_000);
  if(byDni)await serviceLimit(db,`student-dni:${await digest(body.portal+':'+body.dni.trim())}:${ip}:${Math.floor(now/60_000)}`,8,now+120_000);
  const portal=await resolvePortal(db,body.portal);
  if(portal&&helpers.measurement)helpers.measurement.teacherId=portal.teacher_id;
  if(!portal?.is_open||(portal.membership_until&&portal.membership_until<=now))fail('El acceso está cerrado o el estudiante no está registrado con este docente.',401);
  let access,student;
  if(byDni) {
   const dni=body.dni.trim();
   const edited=Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE name='academic_edits'").first());
   const editQuery=edited?`SELECT e.record_id,e.payload_json FROM academic_edits e WHERE e.teacher_id=? AND e.dataset='students' AND e.deleted=0 AND trim(CAST(json_extract(e.payload_json,'$.dni') AS TEXT))=? AND lower(trim(COALESCE(json_extract(e.payload_json,'$.estado'),'A'))) IN ('a','activo','active') UNION ALL `:'';
   const rows=(await db.prepare(`${editQuery}SELECT b.record_id,b.payload_json FROM academic_records b JOIN academic_heads h ON h.teacher_id=b.teacher_id AND h.active_import_id=b.import_id WHERE b.teacher_id=? AND b.dataset='students' AND trim(CAST(json_extract(b.payload_json,'$.dni') AS TEXT))=? AND lower(trim(COALESCE(json_extract(b.payload_json,'$.estado'),'A'))) IN ('a','activo','active') ${edited?"AND NOT EXISTS(SELECT 1 FROM academic_edits e WHERE e.teacher_id=b.teacher_id AND e.dataset='students' AND e.record_id=b.record_id)":''} LIMIT 2`).bind(...(edited?[portal.teacher_id,dni]:[]),portal.teacher_id,dni).all()).results;
   if(rows.length!==1)fail('El acceso está cerrado o el estudiante no está registrado con este docente.',401);
   student=JSON.parse(rows[0].payload_json);
   await db.prepare('INSERT INTO student_access(teacher_id,student_id,code_hash) VALUES(?,?,?) ON CONFLICT(teacher_id,student_id) DO NOTHING').bind(portal.teacher_id,rows[0].record_id,await digest(randomToken())).run();
   access=await db.prepare('SELECT * FROM student_access WHERE teacher_id=? AND student_id=?').bind(portal.teacher_id,rows[0].record_id).first();
  }else{
   const code=body.code.replace(/[\s-]/g,'').toLowerCase();
   access=await db.prepare('SELECT * FROM student_access WHERE teacher_id=? AND code_hash=? AND enabled=1').bind(portal.teacher_id,await digest(code)).first();
   student=access?await record(db,portal.teacher_id,'students',access.student_id):null;
  }
  if(!access?.enabled||!active(student))fail('El acceso está cerrado o el estudiante no está registrado con este docente.',401);
  const token=randomToken(),expires=Math.min(now+2*60*60_000,portal.membership_until||Infinity);
  const stored=await db.prepare('INSERT INTO student_web_sessions(token_hash,teacher_id,student_id,portal_epoch,access_revision,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM student_portals p JOIN student_access a ON a.teacher_id=p.teacher_id WHERE p.teacher_id=? AND p.is_open=1 AND p.access_epoch=? AND (p.membership_until IS NULL OR p.membership_until>?) AND a.student_id=? AND a.enabled=1 AND a.revision=?)').bind(await digest(token),portal.teacher_id,access.student_id,portal.access_epoch,access.revision,expires,portal.teacher_id,portal.access_epoch,now,access.student_id,access.revision).run();
  if(!stored.meta.changes)fail('El acceso se cerró. Solicita acceso a tu docente.',401);
  return Response.json({success:true,data:{authenticated:true}},{headers:{'set-cookie':cookie(request,env,token,Math.floor((expires-now)/1000))}});
 }
 const session=await studentSession(request,env,helpers);
 if(url.pathname==='/api/student/logout'&&request.method==='POST'){await db.prepare('DELETE FROM student_web_sessions WHERE token_hash=?').bind(session.token_hash).run();return Response.json({success:true,data:{}},{headers:{'set-cookie':cookie(request,env,'',0)}});}
 if(url.pathname==='/api/student/data'&&request.method==='GET') {
  const cursor=url.searchParams.get('cursor')||'';if(cursor.length>250||/[\x00-\x1f]/.test(cursor))fail('Página no válida.');
  const edits=Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE name='planning_edits'").first());
  const payload=edits?'COALESCE(e.payload_json,b.payload_json)':'b.payload_json';
  const publications=(await db.prepare(`SELECT p.session_id,${payload} AS payload_json FROM student_publications p
   JOIN academic_heads h ON h.teacher_id=p.teacher_id LEFT JOIN academic_records b ON b.teacher_id=p.teacher_id AND b.import_id=h.active_import_id AND b.dataset='sessions' AND b.record_id=p.session_id
   ${edits?"LEFT JOIN planning_edits e ON e.teacher_id=p.teacher_id AND e.dataset='sessions' AND e.record_id=p.session_id":''}
   WHERE p.teacher_id=? AND p.published=1 AND p.session_id>? ${edits?'AND COALESCE(e.deleted,0)=0':''}
   AND lower(trim(json_extract(${payload},'$.grade')))=?
   AND instr(','||replace(replace(replace(replace(lower(trim(json_extract(${payload},'$.section'))),' y ',','),';',','),'/',','),' ','')||',',','||?||',')>0
   ORDER BY p.session_id LIMIT 21`).bind(session.teacher_id,cursor,norm(session.student.grade),norm(session.student.section).replace(/ /g,'')).all()).results;
  const page=publications.slice(0,20),lessons=[];for(const row of page){const lesson=JSON.parse(row.payload_json);if(belongs(session.student,lesson))lessons.push(publicLesson(row.session_id,lesson));}
  const submissions=(await db.prepare('SELECT session_id,text,created_at FROM student_text_submissions WHERE teacher_id=? AND student_id=? ORDER BY created_at DESC LIMIT 10').bind(session.teacher_id,session.student_id).all()).results;
  return Response.json({success:true,data:{student:{name:session.student.name,grade:session.student.grade,section:session.student.section},lessons,submissions,nextCursor:publications.length>20?page.at(-1).session_id:null}});
 }
 if(url.pathname==='/api/student/submit'&&request.method==='POST') {
  const body=await readJson(request,40000);if(Object.keys(body).some(k=>!['sessionId','text'].includes(k))||typeof body.sessionId!=='string'||body.sessionId.length>250||typeof body.text!=='string'||!body.text.trim()||body.text.length>8000)fail('Escribe una entrega de hasta 8000 caracteres.');
  const lesson=await record(db,session.teacher_id,'sessions',body.sessionId);const published=await db.prepare('SELECT published FROM student_publications WHERE teacher_id=? AND session_id=?').bind(session.teacher_id,body.sessionId).first();
  if(!lesson||!belongs(session.student,lesson)||!published?.published)fail('Esta sesión no está disponible para tu grupo.',403);
  await serviceLimit(db,`submit:${session.teacher_id}:${session.student_id}:${Math.floor(now/3600_000)}`,10,now+7200_000);
  const edits=Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE name='academic_edits'").first());
  // Check the gate again in the INSERT; closing/revocation during a request
  // must prevent the final write as well as the initial read.
  const result=await db.prepare(`INSERT INTO student_text_submissions(id,teacher_id,student_id,session_id,text,created_at)
   SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM student_portals p JOIN student_access a ON a.teacher_id=p.teacher_id WHERE p.teacher_id=? AND p.is_open=1 AND p.access_epoch=? AND (p.membership_until IS NULL OR p.membership_until>?) AND a.student_id=? AND a.enabled=1 AND a.revision=?)
   AND EXISTS(SELECT 1 FROM student_publications WHERE teacher_id=? AND session_id=? AND published=1)
   ${edits?"AND NOT EXISTS(SELECT 1 FROM academic_edits s WHERE s.teacher_id=? AND s.dataset='students' AND s.record_id=? AND (s.deleted=1 OR upper(COALESCE(json_extract(s.payload_json,'$.estado'),'A')) NOT IN ('A','ACTIVO','ACTIVE') OR json_extract(s.payload_json,'$.grade')<>? OR json_extract(s.payload_json,'$.section')<>?))":''}`)
   .bind(randomToken(),session.teacher_id,session.student_id,body.sessionId,body.text.trim(),now,session.teacher_id,session.portal_epoch,now,session.student_id,session.access_revision,session.teacher_id,body.sessionId,...(edits?[session.teacher_id,session.student_id,String(session.student.grade),String(session.student.section)]:[])).run();
  if(!result.meta.changes)fail('El docente cerró el acceso o retiró esta sesión.',403);
  return Response.json({success:true,data:{submitted:true}});
 }
 fail('Operación no disponible.',404);
}
