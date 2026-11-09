import crypto from 'node:crypto';
import {ensureTemplateHeader,templateFields} from './evidenceTemplateContract.js';
import {validTemplateDrawing} from './evidenceTemplateDrawing.js';
export const templateFail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
const json = value => JSON.stringify(value);
const parse = value => JSON.parse(value || '{}');
export function createEvidenceTemplateStore(db, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS evidence_templates (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, evidence_id TEXT NOT NULL, requested_json TEXT NOT NULL,
    html TEXT NOT NULL, fields_json TEXT NOT NULL, mode TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, close_overrides TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
    UNIQUE(session_id,evidence_id));
    CREATE TABLE IF NOT EXISTS evidence_documents (
    id TEXT PRIMARY KEY, template_id TEXT NOT NULL, session_id TEXT NOT NULL, scope_key TEXT NOT NULL,
    section TEXT NOT NULL, participants_json TEXT NOT NULL, template_json TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0, sequence INTEGER NOT NULL DEFAULT 0,
    confirmations_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', submitted_at TEXT,
    updated_at TEXT NOT NULL, UNIQUE(template_id,scope_key));
    CREATE TABLE IF NOT EXISTS evidence_document_history (
    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, field_id TEXT NOT NULL, student_id TEXT NOT NULL,
    author TEXT NOT NULL, kind TEXT NOT NULL, before_value TEXT NOT NULL, after_value TEXT NOT NULL,
    revision INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS evidence_history_document ON evidence_document_history(document_id,created_at);
    CREATE INDEX IF NOT EXISTS evidence_history_field ON evidence_document_history(document_id,field_id);
    CREATE TABLE IF NOT EXISTS evidence_document_comments (
    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, field_id TEXT NOT NULL, quote TEXT NOT NULL,
    field_revision INTEGER NOT NULL, message TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    start_offset INTEGER NOT NULL DEFAULT -1, end_offset INTEGER NOT NULL DEFAULT -1);
    CREATE INDEX IF NOT EXISTS evidence_comments_document ON evidence_document_comments(document_id);`);
  const docColumns=db.prepare('PRAGMA table_info(evidence_documents)').all().map(c=>c.name);
  if(!docColumns.includes('context_json'))db.exec("ALTER TABLE evidence_documents ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}'");
  db.exec('CREATE TABLE IF NOT EXISTS evidence_project_names (scope_key TEXT PRIMARY KEY, project_name TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const commentColumns=db.prepare('PRAGMA table_info(evidence_document_comments)').all().map(c=>c.name);
  for(const name of ['start_offset','end_offset'])if(!commentColumns.includes(name))db.exec(`ALTER TABLE evidence_document_comments ADD COLUMN ${name} INTEGER NOT NULL DEFAULT -1`);
  const locks = new Map(); // Presence is ephemeral: never replicate or restore editing leases.
  const get = id => db.prepare('SELECT * FROM evidence_documents WHERE id=?').get(String(id));
  const requireDoc = id => get(id) || templateFail('No se encontró el trabajo.',404);
  const stamp = () => new Date(now()).toISOString();
  const workDate=()=>{const d=new Date(now());return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const activeLocks = id => {
    const output = {};
    for (const [key, lock] of locks) { if (lock.expiresAt <= now()) locks.delete(key); else if (lock.documentId === id) output[lock.fieldId] = lock; }
    return output;
  };
  const requireEditable = (doc, editable) => { if (!editable) templateFail('La edición está cerrada por horario. Tus avances se conservan.'); if(doc.status === 'submitted') templateFail('Este trabajo ya fue entregado. Solicita su reapertura al docente.'); };
  const fieldDefinition = (doc, fieldId) => parse(doc.template_json).fields.find(f=>f.id===fieldId) || templateFail('Campo no válido.',400);
  const hasWork=doc=>Object.entries(parse(doc.fields_json)).some(([id,field])=>{
    if(['project_name','observations'].includes(id))return false;
    if(fieldDefinition(doc,id).tag==='canvas'){try{return JSON.parse(field.value || '{}').strokes?.length>0;}catch{return false;}}
    return field.value!==false && !!String(field.value ?? '').trim();
  });
  const ownerLock = (doc, fieldId, actor, clientId) => {
    const lock = activeLocks(doc.id)[fieldId];
    if (!lock || lock.studentId !== actor.id || lock.clientId !== clientId) templateFail('El campo ya no está reservado para esta ventana. Tu texto pendiente se conserva para recuperarlo.');
    return lock;
  };
  const history = (doc, fieldId, actor, kind, before, after, revision) => db.prepare('INSERT INTO evidence_document_history VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(),doc.id,fieldId,actor.id,actor.name,kind,json(before),json(after),revision,stamp());
  return {
    db, get, activeLocks,
    ensure(template, scopeKey, section, participants, context={}) {
      let doc = db.prepare('SELECT * FROM evidence_documents WHERE template_id=? AND scope_key=?').get(template.id,scopeKey);
      if (!doc) {
        const requested=parse(template.requested_json),html=ensureTemplateHeader(template.html,requested.color);
        const snapshot = { html, fields: templateFields(html), version: template.version, requested, mode: template.mode };
        const id = crypto.randomUUID();
        const projectName=context.projectKey?db.prepare('SELECT project_name FROM evidence_project_names WHERE scope_key=?').get(context.projectKey)?.project_name || '':'';
        const fields=projectName?{project_name:{value:projectName,revision:0,author:'Proyecto recordado',studentId:'system',updatedAt:stamp()}}:{};
        db.prepare('INSERT INTO evidence_documents (id,template_id,session_id,scope_key,section,participants_json,template_json,fields_json,context_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id,template.id,template.session_id,scopeKey,section,json(participants),json(snapshot),json(fields),json({...context,date:workDate()}),stamp());
        doc = get(id);
      }
      return doc;
    },
    state(doc, cursor) {
      const base = { id:doc.id, revision:doc.revision, sequence:doc.sequence, status:doc.status, submittedAt:doc.submitted_at,
        confirmations:parse(doc.confirmations_json), participants:parse(doc.participants_json), locks:activeLocks(doc.id), serverNow:now(),metadata:{team:parse(doc.context_json).team || 'Individual',date:parse(doc.context_json).date || String(doc.updated_at).slice(0,10),version:`1.${doc.revision}`} };
      if (String(cursor) === String(doc.sequence)) return base;
      return { ...base, fields:parse(doc.fields_json), comments:db.prepare('SELECT * FROM evidence_document_comments WHERE document_id=? ORDER BY created_at').all(doc.id) };
    },
    acquire(id, fieldId, actor, clientId, editable) {
      const doc = requireDoc(id); requireEditable(doc,editable); fieldDefinition(doc,fieldId);
      const current = activeLocks(id)[fieldId];
      if(current && (current.studentId !== actor.id || current.clientId !== clientId)) templateFail(`${current.name} está editando este campo.`);
      if(!current && Object.keys(parse(doc.confirmations_json)).length)db.prepare("UPDATE evidence_documents SET confirmations_json='{}',sequence=sequence+1 WHERE id=?").run(id);
      locks.set(`${id}:${fieldId}`, { documentId:id,fieldId,studentId:actor.id,name:actor.name,clientId,expiresAt:now()+30000 });
      return this.state(get(id));
    },
    heartbeat(id, actor, clientId) {
      for(const lock of Object.values(activeLocks(id))) if(lock.studentId === actor.id && lock.clientId === clientId) lock.expiresAt=now()+30000;
    },
    save(id, fieldId, actor, clientId, value, expectedRevision, release, editable) {
      return db.transaction(()=>{
        const doc=requireDoc(id); requireEditable(doc,editable); const definition=fieldDefinition(doc,fieldId);
        ownerLock(doc,fieldId,actor,clientId);
        if(typeof value !== 'string' && typeof value !== 'boolean') templateFail('Valor no válido.',400);
        if(definition.type === 'checkbox' ? typeof value !== 'boolean' : typeof value !== 'string') templateFail('Tipo de campo no válido.',400);
        if(definition.tag==='canvas'){if(String(value).length>90000 || !validTemplateDrawing(value))templateFail('El dibujo es inválido o supera 200 trazos / 2500 puntos.',400);}
        else if(String(value).length>12000) templateFail('El campo supera 12 000 caracteres.',400);
        if(fieldId==='project_name' && String(value).length>180)templateFail('El nombre del proyecto supera 180 caracteres.',400);
        const fields=parse(doc.fields_json), old=fields[fieldId];
        if(Number(expectedRevision)!==Number(old?.revision || 0)) templateFail('El campo tiene una versión más reciente. Revisa el historial antes de reemplazarlo.');
        const changed=old?.value !== value;
        const revision=doc.revision+(changed?1:0);
        if(changed) fields[fieldId]={value,revision,author:actor.name,studentId:actor.id,authors:[...new Set([...(old?.authors || []),old?.author,actor.name].filter(Boolean))],updatedAt:stamp()};
        if(json(fields).length>300000) templateFail('El documento supera el tamaño permitido.',400);
        if(changed || release) history(doc,fieldId,actor,release?'save':'draft',old?.value ?? '',value,revision);
        if(changed) {
          const context={...parse(doc.context_json),date:workDate()};
          db.prepare("UPDATE evidence_documents SET fields_json=?,revision=?,sequence=sequence+1,confirmations_json='{}',context_json=?,updated_at=? WHERE id=?").run(json(fields),revision,json(context),stamp(),id);
          if(fieldId==='project_name' && context.projectKey)db.prepare('INSERT INTO evidence_project_names VALUES (?,?,?) ON CONFLICT(scope_key) DO UPDATE SET project_name=excluded.project_name,updated_at=excluded.updated_at').run(context.projectKey,String(value).trim(),stamp());
        }
        if(release) locks.delete(`${id}:${fieldId}`);
        return this.state(get(id));
      })();
    },
    release(id,fieldId,actor,clientId) { const lock=activeLocks(id)[fieldId]; if(lock?.studentId===actor.id && lock.clientId===clientId) locks.delete(`${id}:${fieldId}`); },
    confirm(id, actor, expectedRevision, editable) {
      return db.transaction(()=>{
        const doc=requireDoc(id); requireEditable(doc,editable);
        if(doc.revision!==Number(expectedRevision)) templateFail('El trabajo cambió. Revisa la versión actual antes de confirmar.');
        if(Object.keys(activeLocks(id)).length) templateFail('Primero deben guardar y liberar los campos que están editando.');
        const members=parse(doc.participants_json); if(!members.some(m=>m.id===actor.id)) templateFail('No perteneces a este trabajo.',403);
        if(!hasWork(doc)) templateFail('El trabajo todavía está vacío. Completa el producto además de su encabezado.');
        if(!db.prepare("SELECT 1 FROM evidence_document_history WHERE document_id=? AND student_id=? AND kind='save' LIMIT 1").get(id,actor.id)) templateFail('Guarda y libera al menos un campo para registrar tu participación antes de confirmar.');
        const confirmations=parse(doc.confirmations_json); confirmations[actor.id]={revision:doc.revision,at:stamp()};
        db.prepare('UPDATE evidence_documents SET confirmations_json=?,sequence=sequence+1,updated_at=? WHERE id=?').run(json(confirmations),stamp(),id);
        return { doc:get(id), ready:members.every(m=>confirmations[m.id]?.revision===doc.revision) };
      })();
    },
    comment(id, body) {
      const doc=requireDoc(id); fieldDefinition(doc,body.fieldId);
      const field=parse(doc.fields_json)[body.fieldId];
      const message=String(body.message || '').trim().slice(0,3000), quote=String(body.quote || '').slice(0,1000);
      const text=String(field?.value ?? ''), start=Number.isInteger(body.startOffset)?body.startOffset:quote?text.indexOf(quote):-1, end=quote?start+quote.length:-1;
      if(!message) templateFail('Escribe el comentario.',400);
      if(Number(body.fieldRevision)!==Number(field?.revision || 0) || (quote && (start<0 || text.slice(start,end)!==quote))) templateFail('El texto cambió. Selecciona el fragmento actual para comentar.');
      db.transaction(()=>{
        db.prepare('INSERT INTO evidence_document_comments (id,document_id,field_id,quote,field_revision,message,resolved,created_at,start_offset,end_offset) VALUES (?,?,?,?,?,?,0,?,?,?)').run(crypto.randomUUID(),id,body.fieldId,quote,field?.revision || 0,message,stamp(),start,end);
        db.prepare('UPDATE evidence_documents SET sequence=sequence+1 WHERE id=?').run(id);
      })();
    },
    restore(id, historyId) {
      return db.transaction(()=>{
        const doc=requireDoc(id); if(doc.status==='submitted') templateFail('Reabre el trabajo antes de restaurarlo.');
        const entry=db.prepare('SELECT * FROM evidence_document_history WHERE id=? AND document_id=?').get(historyId,id);
        if(!entry) templateFail('Versión no encontrada.',404);
        fieldDefinition(doc,entry.field_id);
        if(activeLocks(id)[entry.field_id]) templateFail('El campo está en edición. Espera a que lo liberen.');
        const fields=parse(doc.fields_json), old=fields[entry.field_id], value=JSON.parse(entry.after_value), revision=doc.revision+1;
        fields[entry.field_id]={value,revision,author:'Docente',studentId:'teacher',authors:[...new Set([...(old?.authors || []),old?.author,'Docente'].filter(Boolean))],updatedAt:stamp()};
        history(doc,entry.field_id,{id:'teacher',name:'Docente'},'restore',old?.value ?? '',value,revision);
        db.prepare("UPDATE evidence_documents SET fields_json=?,revision=?,sequence=sequence+1,confirmations_json='{}',updated_at=? WHERE id=?").run(json(fields),revision,stamp(),id);
        const context=parse(doc.context_json);
        if(entry.field_id==='project_name' && context.projectKey)db.prepare('INSERT INTO evidence_project_names VALUES (?,?,?) ON CONFLICT(scope_key) DO UPDATE SET project_name=excluded.project_name,updated_at=excluded.updated_at').run(context.projectKey,String(value).trim(),stamp());
      })();
    },
    reopen(id) {
      requireDoc(id);
      db.transaction(()=>{
        db.prepare("UPDATE evidence_documents SET status='draft',confirmations_json='{}',sequence=sequence+1,updated_at=? WHERE id=?").run(stamp(),id);
        history(requireDoc(id),'',{id:'teacher',name:'Docente'},'reopen','','',requireDoc(id).revision);
      })();
    },
    exception(id, memberId, reason) {
      return db.transaction(()=>{
        const doc=requireDoc(id), members=parse(doc.participants_json);
        if(doc.status==='submitted')templateFail('El trabajo ya está entregado.');
        if(!members.some(m=>m.id===memberId))templateFail('Integrante no encontrado.',400);
        const explanation=String(reason || '').trim().slice(0,500);if(!explanation)templateFail('Indica el motivo de la excepción.',400);
        if(Object.keys(activeLocks(id)).length)templateFail('Espera a que guarden y liberen los campos en edición.');
        if(!hasWork(doc))templateFail('No se puede entregar un trabajo vacío.');
        const confirmations=parse(doc.confirmations_json);confirmations[memberId]={revision:doc.revision,at:stamp(),by:'teacher',reason:explanation};
        history(doc,'',{id:'teacher',name:'Docente'},'exception','',`${memberId}: ${explanation}`,doc.revision);
        db.prepare('UPDATE evidence_documents SET confirmations_json=?,sequence=sequence+1 WHERE id=?').run(json(confirmations),id);
        return {doc:get(id),ready:members.every(m=>confirmations[m.id]?.revision===doc.revision)};
      })();
    },
  };
}
