import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {getPortalRequestedEvidences} from './shared/portalRequestedEvidences.js';
import {templatePedagogyContext} from './evidenceTemplatePedagogy.js';
const parse=(s,f={})=>{try{return JSON.parse(s);}catch{return f;}};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function atomic(file,content){
 try{if(await fs.readFile(file,'utf8')===content)return false;}catch(error){if(error.code!=='ENOENT')throw error;}
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,content,{flag:'wx'});await fs.rename(tmp,file);return true;
}
// A separate read model. No snapshots, document answers, passwords or leases.
export async function publishWebTemplates({db,mirrorPath,syncUserKey}){
 const hasTemplates=Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_templates'").get());
 const root=path.resolve(mirrorPath),folder=path.join(root,'ARMI Web Sync','templates');
 await fs.mkdir(folder,{recursive:true});
 if(await fs.realpath(folder)!==folder)throw Error('La carpeta de plantillas no puede ser un enlace.');
 const templates=hasTemplates?db.prepare("SELECT id,session_id,evidence_id,requested_json,html,mode,enabled,version,updated_at FROM evidence_templates WHERE trim(html)<>'' ORDER BY session_id,id").all():[];
 const groups=new Map();for(const t of templates){if(!groups.has(t.session_id))groups.set(t.session_id,[]);groups.get(t.session_id).push(t);}
 const lessons=new Map(db.prepare('SELECT id_sesion,session_data FROM sesiones').all().map(row=>[row.id_sesion,parse(row.session_data)]));
 for(const [id,data]of lessons)if(Array.isArray(data.interactiveActivities)&&data.interactiveActivities.some(a=>a?.html)&&!groups.has(id))groups.set(id,[]);
 const entries=[];
 for(const [id,items]of groups){
  const data=lessons.get(id);if(!data)continue;
  const evidences=getPortalRequestedEvidences(data),activities=(Array.isArray(data.interactiveActivities)?data.interactiveActivities:[]).filter(a=>a&&typeof a.html==='string').map(a=>({id:a.id,title:a.title||'Actividad',html:a.html,mode:a.mode||a.scopeType||'individual',enabled:Boolean(a.enabled)}));
  const catalog={sessionId:id,evidences,activities,pedagogy:templatePedagogyContext(data),templates:items.map(t=>({id:t.id,evidence_id:t.evidence_id,requested:parse(t.requested_json),html:t.html,mode:t.mode,enabled:Boolean(t.enabled),version:t.version,updatedAt:t.updated_at}))};
  const content=JSON.stringify({format:'armi-session-templates',version:1,syncUserKey,...catalog});
  if(Buffer.byteLength(content)>2_000_000)continue;
  const digest=hash(content),name=digest+'.json';
  await atomic(path.join(folder,name),content);entries.push({sessionId:id,file:name,sha256:digest});
 }
 await atomic(path.join(folder,'index.json'),JSON.stringify({format:'armi-template-index',version:1,syncUserKey,entries}));
 return {sessions:entries.length};
}
