import express from 'express';
import crypto from 'node:crypto';
import { createEvidenceTemplateStore, templateFail as fail } from '../evidenceTemplateStore.js';
import { validateEvidenceTemplate,ensureTemplateHeader,templateFields } from '../evidenceTemplateContract.js';
import {bindEvidenceTemplateImages} from '../evidenceTemplateImages.js';
import {paintTemplateDrawing} from '../evidenceTemplateDrawing.js';
import {templatePedagogyContext} from '../evidenceTemplatePedagogy.js';
import { templateScheduleWindows } from '../evidenceTemplateSchedule.js';
import { getPortalRequestedEvidences } from '../shared/portalRequestedEvidences.js';
import { splitSessionSections } from '../shared/sectionSessionDates.js';
import { createSessionEvidenceScopeResolver } from '../sessionEvidenceReview.js';

const norm=v=>String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const parse=v=>JSON.parse(v || '{}');
const safeJSON=v=>JSON.stringify(v).replace(/</g,'\\u003c');
export function createEvidenceTemplateRoutes({db,requireStudentAuth,requireTeacher,sessionForStudent,studentsForSession,schedule,saveEvidenceDataUrl,persistEvidencePortableMetadata,removeEvidenceFileWithOriginals,readImages=async()=>({images:[]})}) {
  const router=express.Router(), store=createEvidenceTemplateStore(db), finalizing=new Map();
  let imageCache,imageLoading,imageCacheAt=0;
  const imageLibrary=async()=>{if(imageCache && Date.now()-imageCacheAt<60000)return imageCache;if(imageLoading)return imageLoading;imageLoading=Promise.resolve(readImages()).then(v=>{imageCache=v;imageCacheAt=Date.now();return v;}).finally(()=>{imageLoading=null;});return imageLoading;};
  const wrap=fn=>async(req,res)=>{try {res.setHeader('Cache-Control','no-store');const data=await fn(req,res);if(!res.headersSent)res.json({success:true,data});}catch(e){res.status(e.statusCode || 500).json({success:false,message:e.message});}};
  const session=id=>{const row=db.prepare('SELECT * FROM sesiones WHERE id_sesion=?').get(String(id));if(!row)fail('Guarda la sesión antes de configurar sus plantillas.',404);return {row,data:parse(row.session_data)};};
  const template=id=>db.prepare('SELECT * FROM evidence_templates WHERE id=?').get(String(id)) || fail('Plantilla no encontrada.',404);
  const stateValue=key=>{try{return parse(db.prepare('SELECT value FROM armi_frontend_state WHERE key=?').get(key)?.value);}catch{return null;}};
  const windows=(row,data,section)=>schedule.windows?schedule.windows(row,data,section):templateScheduleWindows(row,schedule.dates(row,data,section),section,stateValue('armi_schedule_entries') || [],stateValue('armi_schedule_config'));
  const availability=(t,section)=>{
    const {row,data}=session(t.session_id), overrides=parse(t.close_overrides), override=overrides[section];
    const list=override?[override]:windows(row,data,section), now=Date.now();
    const current=list.find(w=>Date.parse(w.openAt)<=now && Date.parse(w.closeAt)>now);
    return {editable:!!t.enabled && !!current,windows:list,reason:!t.enabled?'Plantilla sin publicar':!list.length?'El docente debe definir el horario de trabajo':current?'En horario de clase':'Fuera del horario de trabajo'};
  };
  const student=req=>db.prepare('SELECT * FROM db_estudiantes WHERE id=?').get(String(req.studentPortal.studentId)) || fail('Estudiante no encontrado.',401);
  const actor=s=>({id:String(s.id),name:String(s.estudiantes)});
  const scope=(t,s,row)=>{
    if(t.mode==='group' && !String(s.grupo || '').trim()) fail('Pide al docente que te asigne un grupo antes de abrir esta plantilla.');
    const section=splitSessionSections(s.secc)[0];
    const key=t.mode==='group'?`group:${section}:${norm(s.grupo)}`:`student:${s.id}`;
    const members=t.mode==='group'?studentsForSession(row).filter(m=>norm(m.secc)===norm(s.secc) && norm(m.grupo)===norm(s.grupo)):[s];
    const projectIdentity=String(s.grupo || '').trim()?`group:${section}:${norm(s.grupo)}`:`student:${s.id}`;
    const projectKey=JSON.stringify([row.year,row.area_id,row.grade,section,projectIdentity]);
    return {section,key,members:members.map(actor),context:{projectKey,team:String(s.grupo || (t.mode==='group'?'Grupo':'Individual'))}};
  };
  const access=(req)=>{
    const s=student(req), doc=store.get(req.params.id);if(!doc)fail('Trabajo no encontrado.',404);
    const row=sessionForStudent(doc.session_id,s);if(!row)fail('No tienes acceso a esta sesión.',403);
    const t=template(doc.template_id), target=scope(t,s,row);
    if(doc.scope_key!==target.key || !parse(doc.participants_json).some(m=>m.id===String(s.id)))fail('No perteneces a este trabajo.',403);
    const clientId=String(req.body?.clientId || req.query.clientId || '');
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(clientId))fail('Identificador de ventana no válido.',400);
    return {doc,t,s,actor:actor(s),clientId,availability:availability(t,doc.section)};
  };
  const archive=async(id)=>{
    if(finalizing.has(id))return finalizing.get(id);
    const pending=(async()=>{
      const doc=store.get(id);if(doc.status==='submitted')return;
      const participants=parse(doc.participants_json), confirmations=parse(doc.confirmations_json);
      if(!participants.every(m=>confirmations[m.id]?.revision===doc.revision))return;
      const snapshot=parse(doc.template_json), {row}=session(doc.session_id), fields=parse(doc.fields_json);
      const metadata=store.state(doc,doc.sequence).metadata;
      const script=`<script>const data=${safeJSON(fields)},metadata=${safeJSON(metadata)};const paint=${paintTemplateDrawing.toString()};document.querySelectorAll('[data-armi-field]').forEach(el=>{const v=data[el.dataset.armiField]?.value;if(el.tagName==='CANVAS')paint(el,v);else if(el.type==='checkbox')el.checked=!!v;else if(v!==undefined)el.value=v;el.disabled=true});document.querySelectorAll('[data-armi-meta]').forEach(el=>el.textContent=metadata[el.dataset.armiMeta] || '');<\/script>`;
      const html=snapshot.html.replace(/<\/body>/i,`${script}</body>`);
      const savedFiles=[];
      try {
        for(const member of participants)savedFiles.push(await saveEvidenceDataUrl({dataUrl:`data:text/html;base64,${Buffer.from(html).toString('base64')}`,fileName:`plantilla-${id.slice(0,8)}-${member.id}-v${doc.revision}.html`,year:row.year,areaId:row.area_id,grade:row.grade,section:doc.section,unitNumber:row.unit_number,sessionNumber:row.session_number}));
        const records=db.transaction(()=>{
          const fresh=store.get(id), confirmed=parse(fresh.confirmations_json);
          if(fresh.status==='submitted' || fresh.revision!==doc.revision || !participants.every(m=>confirmed[m.id]?.revision===doc.revision))fail('El trabajo cambió durante la entrega. Vuelvan a confirmar.');
          const result=[];
          for(const member of participants){
            const saved=savedFiles[participants.indexOf(member)];
            const group=`template:${id}:${member.id}`;
            const version=Number(db.prepare('SELECT MAX(version_number) n FROM evaluacion_evidencias WHERE version_group_id=?').get(group)?.n || 0)+1;
            db.prepare('UPDATE evaluacion_evidencias SET is_latest=0 WHERE version_group_id=?').run(group);
            const insert=db.prepare(`INSERT INTO evaluacion_evidencias (student_id,session_id,criteria_id,file_path,file_type,observation,year,area_id,grade,section,bimester,unit_number,session_number,student_ids,student_names,file_name,file_size,relative_path,source,version_group_id,version_number,is_latest,submitted_at,requested_evidence)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,?)`).run(member.id,doc.session_id,snapshot.requested.criteriaId,saved.absolutePath,'text/html',`Plantilla de evidencia · versión ${doc.revision} · Integrantes: ${participants.map(m=>m.name).join(', ')}`,row.year,String(row.area_id),row.grade,doc.section,String(Math.ceil(Number(row.unit_number)/2)),String(row.unit_number),String(row.session_number),JSON.stringify([member.id]),JSON.stringify([member.name]),saved.fileName,saved.size,saved.relativePath,'evidence_template',group,version,JSON.stringify(snapshot.requested));
            result.push(db.prepare('SELECT * FROM evaluacion_evidencias WHERE id=?').get(insert.lastInsertRowid));
          }
          db.prepare("UPDATE evidence_documents SET status='submitted',submitted_at=?,sequence=sequence+1 WHERE id=?").run(new Date().toISOString(),id);
          return result;
        })();
        records.forEach(persistEvidencePortableMetadata);
      }catch(e){savedFiles.forEach(saved=>removeEvidenceFileWithOriginals(saved.absolutePath));throw e;}
    })().finally(()=>finalizing.delete(id));finalizing.set(id,pending);return pending;
  };
  router.get('/evidence-templates/:sessionId/catalog',requireTeacher,wrap(async req=>{
    const {row,data}=session(req.params.sessionId);
    const templates=db.prepare('SELECT * FROM evidence_templates WHERE session_id=?').all(row.id_sesion).map(t=>({...t,fields:parse(t.fields_json),requested:parse(t.requested_json),overrides:parse(t.close_overrides)}));
    return {evidences:getPortalRequestedEvidences(data),pedagogy:templatePedagogyContext(data),templates,imageNames:(await imageLibrary()).images.map(i=>i.name),schedules:splitSessionSections(row.section).map(section=>({section,windows:windows(row,data,section)}))};
  }));
  router.post('/evidence-templates/:sessionId',requireTeacher,wrap(async req=>{
    const {row,data}=session(req.params.sessionId), body=req.body;
    const requested=getPortalRequestedEvidences(data).find(e=>e.id===body.evidenceId);if(!requested)fail('La evidencia cambió. Guarda la sesión y actualiza las plantillas.',400);
    const existing=db.prepare('SELECT * FROM evidence_templates WHERE session_id=? AND evidence_id=?').get(row.id_sesion,requested.id);
    const checked=validateEvidenceTemplate(body.html);if(!checked.valid)fail(checked.errors.join(' '),400);
    let html;
    if(existing && existing.html===body.html && !body.enabled && body.activation!=='session_schedule')html=body.html;
    else try{html=bindEvidenceTemplateImages(ensureTemplateHeader(body.html,requested.color),(await imageLibrary()).images);}catch(error){fail(error.message,400);}
    const normalized=validateEvidenceTemplate(html);if(!normalized.valid)fail(normalized.errors.join(' '),400);
    const mode=body.mode==='group'?'group':'individual';
    if(existing && existing.mode!==mode && db.prepare('SELECT 1 FROM evidence_documents WHERE template_id=? LIMIT 1').get(existing.id))fail('La modalidad no puede cambiar porque ya hay trabajos iniciados.');
    const overrides=body.overrides || {}, sections=splitSessionSections(row.section);
    for(const [section,w] of Object.entries(overrides))if(!sections.includes(section) || !w || !Number.isFinite(Date.parse(w.openAt)) || !(Date.parse(w.closeAt)>Date.parse(w.openAt)))fail('Revisa el inicio y cierre de cada sección.',400);
    const missingSections=sections.length?sections.filter(s=>!overrides[s] && !windows(row,data,s).length):['sección de la sesión'];
    const automatic=body.activation==='session_schedule',enabled=automatic?!missingSections.length:!!body.enabled;
    if(enabled && missingSections.length)fail('Falta fecha u horario en alguna sección. Revisa la fecha de sesión y tu horario semanal, o define una excepción.',400);
    const id=existing?.id || crypto.randomUUID();
    db.prepare(`INSERT INTO evidence_templates VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET html=excluded.html,fields_json=excluded.fields_json,mode=excluded.mode,enabled=excluded.enabled,version=excluded.version,close_overrides=excluded.close_overrides,requested_json=excluded.requested_json,updated_at=excluded.updated_at`)
      .run(id,row.id_sesion,requested.id,JSON.stringify(requested),html,JSON.stringify(templateFields(html)),mode,enabled?1:0,(existing?.version || 0)+1,JSON.stringify(overrides),new Date().toISOString());
    return {id,enabled,missingSections,message:automatic?(enabled?'Plantilla activada. Se podrá completar en la fecha y horario de clase de cada sección.':`HTML guardado como borrador. Falta fecha u horario para: ${missingSections.join(', ')}. Revisa la sesión y tu horario semanal; el plazo excepcional es opcional.`):'Configuración guardada. Los trabajos iniciados conservan su plantilla original.'};
  }));
  router.get('/student-portal/evidence-templates/:sessionId/:templateId',requireStudentAuth,wrap(req=>{
    const s=student(req), row=sessionForStudent(req.params.sessionId,s);if(!row)fail('Sesión no disponible.',403);
    const t=template(req.params.templateId);if(t.session_id!==row.id_sesion)fail('Plantilla no disponible.',404);
    const target=scope(t,s,row), available=availability(t,target.section);
    let doc=db.prepare('SELECT * FROM evidence_documents WHERE template_id=? AND scope_key=?').get(t.id,target.key);
    if(!doc){if(!available.editable)fail(available.reason);doc=store.ensure(t,target.key,target.section,target.members,target.context);}
    if(!parse(doc.participants_json).some(m=>m.id===String(s.id)))fail('No perteneces al grupo que inició este trabajo. Consulta al docente.',403);
    return {...store.state(doc),template:parse(doc.template_json),actor:actor(s),availability:available};
  }));
  router.get('/student-portal/evidence-documents/:id',requireStudentAuth,wrap(req=>{const a=access(req);store.heartbeat(a.doc.id,a.actor,a.clientId);return {...store.state(a.doc,req.query.cursor),availability:a.availability};}));
  router.post('/student-portal/evidence-documents/:id/action',requireStudentAuth,wrap(async req=>{
    const a=access(req), b=req.body;
    if(b.action==='lock')return store.acquire(a.doc.id,b.fieldId,a.actor,a.clientId,a.availability.editable);
    if(b.action==='save')return store.save(a.doc.id,b.fieldId,a.actor,a.clientId,b.value,b.fieldRevision,!!b.release,a.availability.editable);
    if(b.action==='release'){store.release(a.doc.id,b.fieldId,a.actor,a.clientId);return store.state(store.get(a.doc.id));}
    if(b.action==='confirm'){const result=store.confirm(a.doc.id,a.actor,b.revision,a.availability.editable);if(result.ready)await archive(a.doc.id);return store.state(store.get(a.doc.id));}
    fail('Acción no válida.',400);
  }));
  router.get('/evidence-templates/:sessionId/documents',requireTeacher,wrap(req=>{
    const {data}=session(req.params.sessionId), resolve=createSessionEvidenceScopeResolver(data), target=req.query.criteriaId?resolve(String(req.query.criteriaId)):null;
    return db.prepare('SELECT * FROM evidence_documents WHERE session_id=? ORDER BY updated_at DESC').all(req.params.sessionId)
      .filter(d=>(!req.query.studentId || parse(d.participants_json).some(m=>m.id===String(req.query.studentId))) && (!target || resolve(parse(d.template_json).requested.criteriaId)===target))
      .map(d=>({id:d.id,status:d.status,revision:d.revision,participants:parse(d.participants_json),requested:parse(d.template_json).requested,updatedAt:d.updated_at}));
  }));
  router.get('/evidence-documents/:id',requireTeacher,wrap(req=>{
    const doc=store.get(req.params.id);if(!doc)fail('Trabajo no encontrado.',404);
    return {...store.state(doc,req.query.cursor),...(req.query.cursor===undefined?{template:parse(doc.template_json)}:{}),availability:availability(template(doc.template_id),doc.section)};
  }));
  const historyAccess=req=>{if(req.studentPortal)return access(req).doc;return store.get(req.params.id) || fail('Trabajo no encontrado.',404);};
  for(const [prefix,auth] of [['/evidence-documents',requireTeacher],['/student-portal/evidence-documents',requireStudentAuth]]){
    router.get(`${prefix}/:id/history`,auth,wrap(req=>{const doc=historyAccess(req);const before=Number(req.query.before || Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)fail('Página no válida.',400);const fieldId=String(req.query.fieldId || ''),limit=parse(doc.template_json).fields.find(f=>f.id===fieldId)?.tag==='canvas'?20:100;return db.prepare('SELECT rowid AS cursor,* FROM evidence_document_history WHERE document_id=? AND field_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(doc.id,fieldId,before,limit);}));
  }
  router.post('/evidence-documents/:id/action',requireTeacher,wrap(async req=>{
    const id=req.params.id,b=req.body;
    if(b.action==='comment')store.comment(id,b);
    else if(b.action==='resolve'){const doc=store.get(id);if(!doc)fail('Trabajo no encontrado.',404);db.transaction(()=>{db.prepare('UPDATE evidence_document_comments SET resolved=? WHERE id=? AND document_id=?').run(b.resolved?1:0,b.commentId,id);db.prepare('UPDATE evidence_documents SET sequence=sequence+1 WHERE id=?').run(id);})();}
    else if(b.action==='restore')store.restore(id,b.historyId);
    else if(b.action==='reopen')store.reopen(id);
    else if(b.action==='exception'){const result=store.exception(id,String(b.memberId),b.reason);if(result.ready)await archive(id);}
    else fail('Acción no válida.',400);
    return store.state(store.get(id));
  }));
  return router;
}
