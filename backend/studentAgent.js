import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createAccessControlStore } from './accessControl.js';
import { effectiveAccessPolicy } from './accessExtension.js';
import {createStudentIdentity} from './studentDiscovery.js';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message, code = 'agent-error') => { throw Object.assign(new Error(message), {status,code}); };
const permissions = device => ({navigation:device.permissions?.navigation!==false,folders:device.permissions?.folders!==false,files:device.permissions?.files!==false});
export function validateAgentPath(value) {
  if (typeof value !== 'string' || !value || value.length > 180) fail(400,'Escribe una ruta relativa de hasta 180 caracteres dentro de la carpeta autorizada.');
  const parts=value.replaceAll('\\','/').split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f<>:"|?*]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail(400,'La ruta contiene un nombre no permitido en Windows.');
  return parts.join('/');
}
export function studentDeliveryPath(folder,name){
  const directory=folder===''?'':validateAgentPath(folder);
  const filename=validateAgentPath(name);
  if(filename.includes('/'))fail(400,'Elige un nombre de archivo sin carpetas.');
  return validateAgentPath(directory?directory+'/'+filename:filename);
}
export function createStudentAgentService({db,runtimeFolder,localDatabase,now=Date.now}) {
  fs.mkdirSync(path.join(runtimeFolder,'student-agent-files'),{recursive:true});
  const fileRoot=path.join(runtimeFolder,'student-agent-files');
  const local=localDatabase||new Database(path.join(runtimeFolder,'student-agent.sqlite'));
  local.pragma('journal_mode=WAL');
  local.exec(`CREATE TABLE IF NOT EXISTS credentials(device_id TEXT PRIMARY KEY,installation_id TEXT UNIQUE,enrollment TEXT,token_hash TEXT UNIQUE,paired_at INTEGER,last_seen_at INTEGER,revision TEXT,navigation_state TEXT,blocked_count INTEGER,root_path TEXT,capabilities TEXT,version TEXT,last_error TEXT);
    CREATE TABLE IF NOT EXISTS codes(hash TEXT PRIMARY KEY,device_id TEXT,group_id TEXT,expires_at INTEGER,max_uses INTEGER,uses INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS joins(code_hash TEXT,installation_id TEXT,device_id TEXT,PRIMARY KEY(code_hash,installation_id));
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,name TEXT,size INTEGER,sha256 TEXT,created_at INTEGER);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,batch_id TEXT,device_id TEXT,enrollment TEXT,type TEXT,relative_path TEXT,file_id TEXT,state TEXT,created_at INTEGER,finished_at INTEGER,message TEXT);`);
  for(const [name,type]of [['destination',"TEXT DEFAULT 'classroom'"],['new_relative_path','TEXT'],['session_sid','TEXT']])if(!local.prepare('PRAGMA table_info(jobs)').all().some(c=>c.name===name))local.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  local.exec(`CREATE TABLE IF NOT EXISTS auto_requests(id TEXT PRIMARY KEY,installation_id TEXT UNIQUE,secret_hash TEXT,machine_name TEXT,created_at INTEGER,last_seen_at INTEGER,state TEXT,code TEXT);
    CREATE TABLE IF NOT EXISTS user_sessions(device_id TEXT,sid TEXT,enrollment TEXT,token_hash TEXT UNIQUE,username TEXT,last_seen_at INTEGER,PRIMARY KEY(device_id,sid));
    CREATE INDEX IF NOT EXISTS jobs_poll ON jobs(device_id,enrollment,state,created_at);`);
  if(!local.prepare('PRAGMA table_info(credentials)').all().some(c=>c.name==='machine_name'))local.exec('ALTER TABLE credentials ADD COLUMN machine_name TEXT');
  local.exec('CREATE TABLE IF NOT EXISTS device_lifecycle(device_id TEXT PRIMARY KEY,installation_id TEXT,machine_name TEXT,state TEXT,changed_at INTEGER)');
  local.exec(`CREATE TABLE IF NOT EXISTS folder_catalog(device_id TEXT,sid TEXT,username TEXT,destination TEXT,relative_path TEXT COLLATE NOCASE,updated_at INTEGER,PRIMARY KEY(device_id,sid,destination,relative_path));
    CREATE TABLE IF NOT EXISTS agent_metadata(key TEXT PRIMARY KEY,value TEXT);`);
  const rememberFolder=job=>{
    const destination=job.destination||'classroom',sid=destination==='classroom'?'':job.session_sid||'';
    const username=sid?local.prepare('SELECT username FROM user_sessions WHERE device_id=? AND sid=?').get(job.device_id,sid)?.username||'Usuario anterior':'';
    const put=relative=>{if(relative)local.prepare('INSERT INTO folder_catalog VALUES(?,?,?,?,?,?) ON CONFLICT(device_id,sid,destination,relative_path) DO UPDATE SET username=excluded.username,relative_path=excluded.relative_path,updated_at=excluded.updated_at').run(job.device_id,sid,username,destination,relative,job.finished_at||now());};
    if(job.type==='rename-folder'){
      const old=job.relative_path.toLowerCase();
      for(const row of local.prepare('SELECT * FROM folder_catalog WHERE device_id=? AND sid=? AND destination=?').all(job.device_id,sid,destination))if(row.relative_path.toLowerCase()===old||row.relative_path.toLowerCase().startsWith(old+'/')){
        local.prepare('DELETE FROM folder_catalog WHERE device_id=? AND sid=? AND destination=? AND relative_path=?').run(row.device_id,sid,destination,row.relative_path);put(job.new_relative_path+row.relative_path.slice(job.relative_path.length));
      }
      put(job.new_relative_path);
    }else if(job.type==='create-folder')put(job.relative_path);
    else if(job.type==='receive-file'){const parts=job.relative_path.split('/');parts.pop();put(parts.join('/'));}
  };
  if(!local.prepare("SELECT 1 FROM agent_metadata WHERE key='folder-catalog-v1'").get())local.transaction(()=>{
    for(const job of local.prepare("SELECT * FROM jobs WHERE state='success' ORDER BY finished_at,created_at,id").all())rememberFolder(job);
    local.prepare("INSERT INTO agent_metadata VALUES('folder-catalog-v1','1')").run();
  }).immediate();
  const folders=()=>local.prepare('SELECT device_id AS deviceId,sid,username,destination,relative_path AS relativePath,updated_at AS updatedAt FROM folder_catalog ORDER BY relative_path COLLATE NOCASE').all();
  const identity=createStudentIdentity(runtimeFolder);
  if(!local.prepare('PRAGMA table_info(auto_requests)').all().some(c=>c.name==='verification_code'))local.exec('ALTER TABLE auto_requests ADD COLUMN verification_code TEXT');
  if(!local.prepare('PRAGMA table_info(auto_requests)').all().some(c=>c.name==='pairing_protocol'))local.exec('ALTER TABLE auto_requests ADD COLUMN pairing_protocol INTEGER DEFAULT 3');
  const publicIdentity=identity.describe('0'.repeat(32),3001);
  const serverId=JSON.parse(publicIdentity.payload).serverId;
  const verificationFor=body=>sha([serverId,publicIdentity.modulus,body.installationId,body.secret].join('\n')).slice(0,8).toUpperCase();
  const store=createAccessControlStore(db);
  const device=id=>{const value=store.read().config.devices.find(row=>row.id===id);if(!value)fail(401,'El equipo ya no está autorizado.','agent-unauthorized');return value;};
  const policyFor=id=>{const config=store.read().config,d=config.devices.find(row=>row.id===id);if(!d)fail(401,'El equipo ya no está autorizado.','agent-unauthorized');const p=permissions(d),domains=p.navigation?effectiveAccessPolicy(config,id).domains:[];
    return {protocol:1,deviceId:id,deviceName:d.name,domains,permissions:p,pollSeconds:10,revision:sha(JSON.stringify({id,domains,permissions:p}))};};
  const authorize=token=>{if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))fail(401,'Vinculación no válida.','agent-unauthorized');const c=local.prepare('SELECT * FROM credentials WHERE token_hash=?').get(sha(token));if(!c)fail(401,'Vinculación retirada.','agent-unauthorized');device(c.device_id);return c;};
  const jobAuth=token=>{try{return {...authorize(token),kind:'service'};}catch(e){if(e.status!==401)throw e;}
    if(typeof token!=='string'||!/^[\w-]{43}$/.test(token))fail(401,'Sesión no válida.');
    const session=local.prepare('SELECT s.sid,c.* FROM user_sessions s JOIN credentials c ON c.device_id=s.device_id AND c.enrollment=s.enrollment WHERE s.token_hash=? AND s.last_seen_at>?').get(sha(token),now()-3600000);
    if(!session)fail(401,'La sesión ya no está vinculada.');device(session.device_id);return {...session,kind:'user'};};
  const session=(token,body)=>{const c=authorize(token);if(!/^S-1-5-\d+(?:-\d+){1,14}$/.test(body?.sid||'')||typeof body?.username!=='string')fail(400,'Sesión de Windows no válida.');
    const raw=crypto.randomBytes(32).toString('base64url');local.prepare('INSERT INTO user_sessions VALUES(?,?,?,?,?,?) ON CONFLICT(device_id,sid) DO UPDATE SET enrollment=excluded.enrollment,token_hash=excluded.token_hash,username=excluded.username,last_seen_at=excluded.last_seen_at').run(c.device_id,body.sid,c.enrollment,sha(raw),body.username.slice(0,100),now());
    return {token:raw,enrollment:c.enrollment,policy:policyFor(c.device_id)};};
  const sessionHeartbeat=token=>{const c=jobAuth(token);if(c.kind!=='user')fail(403,'Se requiere una sesión de estudiante.');local.prepare('UPDATE user_sessions SET last_seen_at=? WHERE device_id=? AND sid=?').run(now(),c.device_id,c.sid);return {policy:policyFor(c.device_id)};};
  const autoRequest=body=>{
    if(!/^[-\w]{16,80}$/.test(body?.installationId||'')||!/^[\w-]{43}$/.test(body?.secret||''))fail(400,'Solicitud de instalación no válida.');
    if(body.pairingProtocol===4&&!/^[a-f0-9]{32}$/.test(body.nonce||''))fail(400,'Consulta de aprobación no válida.');
    local.prepare('DELETE FROM auto_requests WHERE last_seen_at<?').run(now()-86400000);
    const old=local.prepare('SELECT * FROM auto_requests WHERE installation_id=?').get(body.installationId);
    if(old&&old.secret_hash!==sha(body.secret))fail(403,'Esta instalación tiene otra solicitud.');
    if(!old){if(local.prepare('SELECT count(*) AS n FROM auto_requests').get().n>=1000)fail(429,'Demasiadas solicitudes pendientes.');local.prepare("INSERT INTO auto_requests(id,installation_id,secret_hash,machine_name,created_at,last_seen_at,state,code,verification_code) VALUES(?,?,?,?,?,?,'pending',NULL,?)").run(crypto.randomUUID(),body.installationId,sha(body.secret),String(body.machineName||'PC estudiante').slice(0,100),now(),now(),verificationFor(body));}
    else local.prepare('UPDATE auto_requests SET last_seen_at=? WHERE id=?').run(now(),old.id);
    let row=local.prepare('SELECT * FROM auto_requests WHERE installation_id=?').get(body.installationId);
    local.prepare('UPDATE auto_requests SET pairing_protocol=? WHERE id=?').run(body.pairingProtocol===4?4:3,row.id);
    if(row.state==='approved'&&!local.prepare('SELECT 1 FROM codes WHERE hash=? AND expires_at>?').get(sha(String(row.code).replaceAll('-','')),now())){local.prepare("UPDATE auto_requests SET state='pending',code=NULL WHERE id=?").run(row.id);row={...row,state:'pending',code:null};}
    if(!row.verification_code){local.prepare('UPDATE auto_requests SET verification_code=? WHERE id=?').run(verificationFor(body),row.id);row.verification_code=verificationFor(body);}
    return {pairingProtocol:body.pairingProtocol===4?4:3,verificationCode:row.verification_code,requestId:row.id,state:row.state,...(row.state==='approved'?{code:row.code,...(body.pairingProtocol===4?{approval:identity.approve({nonce:body.nonce,installationId:body.installationId,verificationCode:row.verification_code,code:row.code})}:{})}:{})};};
  const pendingRequests=()=>local.prepare("SELECT id,machine_name AS machineName,verification_code AS verificationCode,created_at AS createdAt,last_seen_at AS lastSeenAt,state,pairing_protocol AS pairingProtocol FROM auto_requests WHERE last_seen_at>? AND state IN ('pending','rejected','approved') ORDER BY created_at").all(now()-86400000).map(row=>({...row,online:now()-row.lastSeenAt<45000}));
  const approve=({requestIds,groupId,reject=false})=>{
    if(!Array.isArray(requestIds)||!requestIds.length||requestIds.length>500)fail(400,'Selecciona instalaciones pendientes.');
    if(groupId&&!store.read().config.groups.some(g=>g.id===groupId))fail(400,'El grupo no existe.');
    return local.transaction(()=>{for(const id of [...new Set(requestIds)]){const row=local.prepare("SELECT * FROM auto_requests WHERE id=? AND state IN ('pending','rejected')").get(id);if(!row)fail(409,'La solicitud ya cambió.');
      const enrollment=reject?null:code({groupId,maxUses:1,hours:4}).code;
      local.prepare('UPDATE auto_requests SET state=?,code=? WHERE id=?').run(reject?'rejected':'approved',enrollment,id);
    }return {count:requestIds.length};}).immediate();};
  const code=({deviceId,groupId,maxUses=100,hours=4})=>{
    if(deviceId)device(deviceId);else if(groupId&&!store.read().config.groups.some(g=>g.id===groupId))fail(400,'El grupo ya no existe.');
    if(!Number.isInteger(maxUses)||maxUses<1||maxUses>500||!Number.isFinite(hours)||hours<1||hours>24)fail(400,'Revisa la cantidad de equipos y la duración del código.');
    const raw=crypto.randomBytes(6).toString('hex').toUpperCase(),expires=now()+(deviceId?600000:hours*3600000);
    local.prepare('DELETE FROM codes WHERE expires_at<=?').run(now());
    if(deviceId)local.prepare('DELETE FROM codes WHERE device_id=?').run(deviceId);
    local.prepare('INSERT INTO codes(hash,device_id,group_id,expires_at,max_uses) VALUES(?,?,?,?,?)').run(sha(raw),deviceId||null,groupId||null,expires,deviceId?1:maxUses);
    return {code:raw.match(/.{4}/g).join('-'),expiresAt:new Date(expires).toISOString(),maxUses:deviceId?1:maxUses,groupId:groupId||null};
  };
  const pair=body=>local.transaction(()=>{
    const raw=String(body?.code||'').replace(/[-\s]/g,'').toUpperCase();
    if(!/^[A-F0-9]{12}$/.test(raw)||!/^[-\w]{16,80}$/.test(body?.installationId||''))fail(403,'Código o instalación no válidos.','invalid-agent-code');
    const entry=local.prepare('SELECT * FROM codes WHERE hash=? AND expires_at>?').get(sha(raw),now());
    if(!entry)fail(403,'Código incorrecto o vencido.','invalid-agent-code');
    const previous=local.prepare('SELECT device_id FROM joins WHERE code_hash=? AND installation_id=?').get(entry.hash,body.installationId);
    if(!previous&&entry.uses>=entry.max_uses)fail(403,'Este código alcanzó su límite de equipos.','invalid-agent-code');
    let deviceId=previous?.device_id||entry.device_id;
    if(!deviceId){const current=store.read();
      if(entry.group_id&&!current.config.groups.some(g=>g.id===entry.group_id))fail(409,'El grupo de inscripción fue eliminado.');
      const existing=local.prepare('SELECT device_id FROM credentials WHERE installation_id=? UNION SELECT device_id FROM device_lifecycle WHERE installation_id=? LIMIT 1').get(body.installationId,body.installationId);
      if(existing&&current.config.devices.some(d=>d.id===existing.device_id))deviceId=existing.device_id;
      else {
        if(current.config.devices.length>=500)fail(409,'Se alcanzó el máximo de equipos registrados.');
        if(existing){local.prepare('DELETE FROM credentials WHERE device_id=?').run(existing.device_id);local.prepare("UPDATE jobs SET state='cancelled',finished_at=?,message='El equipo fue eliminado.' WHERE device_id=? AND state IN ('pending','sent')").run(now(),existing.device_id);}
        deviceId=crypto.randomUUID();const name=String(body.machineName||'PC estudiante').trim().slice(0,100)||'PC estudiante';
        store.save({...current.config,devices:[...current.config.devices,{id:deviceId,name,groupId:entry.group_id||null}]},current.revision);}}
    const installed=local.prepare('SELECT device_id FROM credentials WHERE installation_id=?').get(body.installationId);
    if(installed && installed.device_id!==deviceId)fail(409,'Desvincula la instalaci?n anterior antes de reasignarla.');
    const policy=policyFor(deviceId),token=crypto.randomBytes(32).toString('base64url'),enrollment=crypto.randomUUID();
    local.prepare("UPDATE jobs SET state='cancelled',finished_at=?,message='El equipo se volvió a vincular.' WHERE device_id=? AND state IN ('pending','sent')").run(now(),deviceId);
    local.prepare('INSERT INTO credentials(device_id,installation_id,enrollment,token_hash,paired_at,last_seen_at) VALUES(?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET installation_id=excluded.installation_id,enrollment=excluded.enrollment,token_hash=excluded.token_hash,paired_at=excluded.paired_at,last_seen_at=excluded.last_seen_at,revision=NULL,last_error=NULL,capabilities=NULL,navigation_state=NULL,blocked_count=0')
      .run(deviceId,body.installationId,enrollment,sha(token),now(),now());
    local.prepare('UPDATE credentials SET machine_name=? WHERE device_id=?').run(String(body.machineName||device(deviceId).name).slice(0,100),deviceId);
    local.prepare('DELETE FROM device_lifecycle WHERE device_id=?').run(deviceId);
    if(!previous){local.prepare('INSERT INTO joins VALUES(?,?,?)').run(entry.hash,body.installationId,deviceId);local.prepare('UPDATE codes SET uses=uses+1 WHERE hash=?').run(entry.hash);}
    local.prepare('DELETE FROM auto_requests WHERE installation_id=?').run(body.installationId);
    return {token,enrollment,policy};
  }).immediate();
  const policy=token=>{const c=authorize(token);return policyFor(c.device_id);};
  const heartbeat=(token,body)=>{const c=authorize(token),current=policyFor(c.device_id);
    if(body?.revision!==current.revision)fail(409,'Hay una política nueva.','agent-policy-changed');
    const state=['configured','disabled','error'].includes(body.navigationState)?body.navigationState:'error';
    const caps={navigation:body.capabilities?.navigation===true,folders:body.capabilities?.folders===true,files:body.capabilities?.files===true};
    const count=Number(body.blockedCount);if(!Number.isInteger(count)||count<0||count>1000)fail(400,'Cantidad de dominios no válida.');
    if(state==='configured'&&count!==current.domains.length)fail(409,'No se configuraron todos los dominios.');
    local.prepare('UPDATE credentials SET last_seen_at=?,revision=?,navigation_state=?,blocked_count=?,root_path=?,capabilities=?,version=?,last_error=? WHERE device_id=?')
      .run(now(),state==='error'?null:current.revision,state,count,String(body.rootPath||'').slice(0,240),JSON.stringify(caps),String(body.version||'').slice(0,30),String(body.error||'').slice(0,500),c.device_id);
    if(typeof body.machineName==='string'&&body.machineName.trim())local.prepare('UPDATE credentials SET machine_name=? WHERE device_id=?').run(body.machineName.trim().slice(0,100),c.device_id);
    return {accepted:true};};
  const status=()=>{const config=store.read().config;return config.devices.map(d=>{const c=local.prepare('SELECT * FROM credentials WHERE device_id=?').get(d.id),life=local.prepare('SELECT * FROM device_lifecycle WHERE device_id=?').get(d.id);let p;try{p=policyFor(d.id);}catch(e){return {deviceId:d.id,state:'error',error:e.message};}
    const online=!!c?.last_seen_at&&now()-c.last_seen_at<45000;
    return {deviceId:d.id,machineName:c?.machine_name||life?.machine_name||d.name,paired:!!c,online,canSendCommands:online&&!!c?.version&&!!c?.capabilities,retired:!c&&!!life,state:!c?(life?.state||'unpaired'):c.last_error?'error':c.revision===p.revision?'configured':'pending',
      navigationState:c?.navigation_state||null,blockedCount:c?.blocked_count||0,lastSeenAt:c?.last_seen_at?new Date(c.last_seen_at).toISOString():null,changedAt:life?.changed_at?new Date(life.changed_at).toISOString():null,rootPath:c?.root_path||null,version:c?.version||null,error:c?.last_error||null,capabilities:JSON.parse(c?.capabilities||'{}'),activeUser:local.prepare('SELECT username FROM user_sessions WHERE device_id=? AND enrollment=? AND last_seen_at>? ORDER BY last_seen_at DESC LIMIT 1').get(d.id,c?.enrollment||'',now()-45000)?.username||null};});};
  const targets=scope=>{const config=store.read().config;let ids;
    if(scope?.type==='all')ids=config.devices.map(d=>d.id);else if(scope?.type==='group')ids=config.devices.filter(d=>d.groupId===scope.groupId).map(d=>d.id);else if(scope?.type==='devices'&&Array.isArray(scope.deviceIds))ids=[...new Set(scope.deviceIds)];else fail(400,'Selecciona equipos o un grupo.');
    if(!ids.length||ids.length>500||ids.some(id=>!config.devices.some(d=>d.id===id)))fail(400,'Selecciona equipos existentes.');return ids;};
  const upload=(buffer,name)=>{if(!Buffer.isBuffer(buffer)||buffer.length>50*1024*1024)fail(400,'El archivo supera 50 MB.');
    const filename=validateAgentPath(String(name||'archivo').replaceAll('\\','/').split('/').pop());
    const hash=sha(buffer),target=path.join(fileRoot,hash+'.bin');if(!fs.existsSync(target)){const tmp=target+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,buffer);fs.renameSync(tmp,target);}
    local.prepare('INSERT OR IGNORE INTO files VALUES(?,?,?,?,?)').run(hash,filename,buffer.length,hash,now());return {id:hash,name:filename,size:buffer.length,sha256:hash};};
  const createJobs=({scope,type,relativePath,fileId,destination='classroom',newRelativePath,onlyOnline=false})=>local.transaction(()=>{
    if(!['classroom','pictures','documents','desktop','downloads'].includes(destination))fail(400,'Carpeta de destino no admitida.');
    if(!['create-folder','receive-file','rename-folder','open-folder'].includes(type))fail(400,'Acción no admitida.');const relative=relativePath===''&&type==='open-folder'?'':validateAgentPath(relativePath),requested=targets(scope),batchId=crypto.randomUUID();
    if(typeof onlyOnline!=='boolean')fail(400,'Selección de equipos en línea no válida.');
    const ids=onlyOnline?requested.filter(id=>{const c=local.prepare('SELECT last_seen_at,version,capabilities FROM credentials WHERE device_id=?').get(id);return c&&now()-c.last_seen_at<45000&&!!c.version&&!!c.capabilities;}):requested;
    if(!ids.length)fail(409,'No hay equipos vinculados en línea listos para recibir esta orden. Completa la confirmación en el estudiante.');
    const renamed=type==='rename-folder'?validateAgentPath(newRelativePath):null;
    const file=type==='receive-file'?local.prepare('SELECT * FROM files WHERE id=?').get(fileId):null;if(type==='receive-file'&&(!file||!fs.existsSync(path.join(fileRoot,file.id+'.bin'))))fail(400,'Primero selecciona y carga el archivo.');
    const receipts=[];
    for(const id of ids){const d=device(id),c=local.prepare('SELECT * FROM credentials WHERE device_id=?').get(id),permission=type==='receive-file'?'files':'folders';
      if(!c)fail(409,`El equipo ${d.name} todavía no tiene el agente vinculado.`);if(!permissions(d)[permission])fail(403,`El permiso está deshabilitado para ${d.name}.`);
      if((destination!=='classroom'||type==='open-folder'||type==='rename-folder')&&(!c.version||c.version==='1.0.0'))fail(409,`Actualiza el agente de ${d.name} para usar carpetas personales.`);
      if(c.capabilities&&JSON.parse(c.capabilities)[permission]===false)fail(403,`La instalación de ${d.name} no autoriza esta acción.`);
      const jobId=crypto.randomUUID();local.prepare("INSERT INTO jobs(id,batch_id,device_id,enrollment,type,relative_path,file_id,state,created_at,destination,new_relative_path) VALUES(?,?,?,?,?,?,?,'pending',?,?,?)").run(jobId,batchId,id,c.enrollment,type,relative,file?.id||null,now(),destination,renamed);receipts.push(jobId);}
    return {batchId,count:receipts.length,skipped:requested.length-ids.length};
  }).immediate();
  const jobs=token=>{const c=jobAuth(token),d=device(c.device_id);const user=c.kind==='user';const rows=local.prepare(`SELECT * FROM jobs WHERE device_id=? AND enrollment=? AND state IN ('pending','sent') AND ${user?"(destination!='classroom' OR type='open-folder') AND (session_sid IS NULL OR session_sid=?)":"destination='classroom' AND type!='open-folder'"} ORDER BY created_at LIMIT 20`).all(...[c.device_id,c.enrollment,...(user?[c.sid]:[])]);const result=[];
    for(const row of rows){if(!permissions(d)[row.type==='receive-file'?'files':'folders']){local.prepare("UPDATE jobs SET state='cancelled',finished_at=?,message='Permiso retirado por el docente.' WHERE id=?").run(now(),row.id);continue;}
      const f=row.file_id?local.prepare('SELECT * FROM files WHERE id=?').get(row.file_id):null;
      local.prepare("UPDATE jobs SET state='sent',session_sid=COALESCE(session_sid,?) WHERE id=?").run(user?c.sid:null,row.id);
      result.push({id:row.id,type:row.type,relativePath:row.relative_path,...(row.destination!=='classroom'||row.type==='open-folder'||row.type==='rename-folder'?{destination:row.destination,newRelativePath:row.new_relative_path}:{}),...(f?{file:{size:f.size,sha256:f.sha256,url:`/api/student-agent/jobs/${row.id}/file`}}:{})});}
    return result;};
  const ownedJob=(token,id)=>{const c=jobAuth(token),job=local.prepare('SELECT * FROM jobs WHERE id=? AND device_id=? AND enrollment=?').get(id,c.device_id,c.enrollment);if(!job||(c.kind==='user'&&(job.session_sid!==c.sid||(job.destination==='classroom'&&job.type!=='open-folder')))||(c.kind==='service'&&(job.destination!=='classroom'||job.type==='open-folder')))fail(404,'Orden no encontrada.');return job;};
  const complete=(token,id,body)=>local.transaction(()=>{const job=ownedJob(token,id);if(!['success','error'].includes(body?.state))fail(400,'Resultado no válido.');
    if(['success','error','cancelled'].includes(job.state))return {accepted:true};
    local.prepare('UPDATE jobs SET state=?,finished_at=?,message=? WHERE id=?').run(body.state,now(),String(body.message||'').slice(0,500),id);
    if(body.state==='success')rememberFolder({...job,finished_at:now()});return {accepted:true};}).immediate();
  const fileFor=(token,id)=>{const job=ownedJob(token,id);if(!['pending','sent'].includes(job.state)||!permissions(device(job.device_id)).files)fail(403,'La descarga ya no está autorizada.');
    const file=local.prepare('SELECT * FROM files WHERE id=?').get(job.file_id);if(!file)fail(404,'Archivo no encontrado.');const target=path.join(fileRoot,file.id+'.bin');if(!fs.existsSync(target))fail(410,'El archivo de entrega ya no está disponible.');return {path:target,name:file.name};};
  const history=()=>local.prepare('SELECT j.id,j.batch_id AS batchId,j.device_id AS deviceId,j.type,j.destination,j.new_relative_path AS newRelativePath,j.relative_path AS relativePath,j.state,j.created_at AS createdAt,j.finished_at AS finishedAt,j.message FROM jobs j ORDER BY created_at DESC LIMIT 200').all();
  const cancel=id=>{local.prepare("UPDATE jobs SET state='cancelled',finished_at=?,message='Cancelada por el docente.' WHERE id=? AND state IN ('pending','sent')").run(now(),id);};
  const revoke=(id,state='revoked')=>{local.transaction(()=>{const c=local.prepare('SELECT * FROM credentials WHERE device_id=?').get(id);if(c)local.prepare('INSERT INTO device_lifecycle VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET installation_id=excluded.installation_id,machine_name=excluded.machine_name,state=excluded.state,changed_at=excluded.changed_at').run(id,c.installation_id,c.machine_name||null,state,now());local.prepare('DELETE FROM credentials WHERE device_id=?').run(id);local.prepare('DELETE FROM codes WHERE device_id=?').run(id);local.prepare('DELETE FROM user_sessions WHERE device_id=?').run(id);local.prepare("UPDATE jobs SET state='cancelled',finished_at=?,message='Vinculación retirada.' WHERE device_id=? AND state IN ('pending','sent')").run(now(),id);}).immediate();};
  const uninstall=token=>{const c=authorize(token);revoke(c.device_id,'uninstalled');return {accepted:true};};
  const prune=()=>{const expired=local.prepare("SELECT f.id FROM files f WHERE f.created_at<? AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.file_id=f.id AND (j.state IN ('pending','sent') OR COALESCE(j.finished_at,j.created_at)>?))").all(now()-86400000,now()-86400000);
    for(const row of expired){const target=path.join(fileRoot,row.id+'.bin');if(/^[a-f0-9]{64}$/.test(row.id)&&fs.existsSync(target))fs.unlinkSync(target);local.prepare('DELETE FROM files WHERE id=?').run(row.id);}};
  return {identity,autoRequest,pendingRequests,approve,session,sessionHeartbeat,code,pair,policy,heartbeat,status,folders,deliveryPath:studentDeliveryPath,upload,createJobs,jobs,complete,fileFor,history,cancel,revoke,uninstall,prune,close:()=>{if(!localDatabase)local.close();}};
}
