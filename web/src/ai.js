import {AuthError} from './apps-script-auth.js';
const fail=(message,status=400)=>{throw new AuthError(message,status);};
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=text=>Uint8Array.from(text.match(/../g)||[],x=>parseInt(x,16));
const providers=['gemini','openai'];
export async function servicesReady(db) {return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_credentials'").first());}
export async function serviceLimit(db,bucket,limit,expires) {
 const row=await db.prepare('INSERT INTO web_service_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,expires).first();
 if(row.attempts>limit)fail('Demasiados intentos. Espera un momento para continuar.',429);
}
async function cipherKey(env) {
 if(!/^[a-f0-9]{64}$/i.test(env.ARMI_AI_ENCRYPTION_KEY||''))fail('El administrador todavía no activó el almacenamiento seguro de claves de IA.',503);
 return crypto.subtle.importKey('raw',unhex(env.ARMI_AI_ENCRYPTION_KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function aiProfile(env,teacherId) {
 const installed=await servicesReady(env.DB);
 const ready=installed && /^[a-f0-9]{64}$/i.test(env.ARMI_AI_ENCRYPTION_KEY||'');
 if(!installed)return {ready:false,providers:{},preferences:{provider:'gemini'}};
 const rows=(await env.DB.prepare('SELECT provider,model FROM ai_credentials WHERE teacher_id=?').bind(teacherId).all()).results;
 const prefs=await env.DB.prepare('SELECT payload_json FROM ai_preferences WHERE teacher_id=?').bind(teacherId).first();
 return {ready,providers:Object.fromEntries(rows.map(row=>[row.provider,{configured:true,model:row.model}])),preferences:JSON.parse(prefs?.payload_json||'{"provider":"gemini"}')};
}
async function apiKey(env,teacherId,provider) {
 const row=await env.DB.prepare('SELECT cipher,iv FROM ai_credentials WHERE teacher_id=? AND provider=?').bind(teacherId,provider).first();
 if(!row)fail('Conecta tu propia clave de IA en Configuración de IA.');
 try {return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(row.iv),additionalData:new TextEncoder().encode(`${teacherId}:${provider}`)},await cipherKey(env),unhex(row.cipher)));}
 catch{fail('No se pudo abrir tu clave guardada. Vuelve a conectarla en Configuración de IA.',503);}
}
async function upstream(requester,url,options) {
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90_000);
 try {
  const response=await requester(url,{...options,signal:controller.signal,redirect:'manual'});
  if(!response.ok)fail(response.status===429?'Tu proveedor de IA alcanzó su cuota. Revisa tu cuenta o espera antes de reintentar.':response.status===401||response.status===403?'La clave de IA no es válida o no tiene permiso para este modelo.':'El proveedor de IA no pudo completar la solicitud. Revisa el modelo y vuelve a intentar.',response.status===429?429:502);
  const reader=response.body.getReader();const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();fail('La respuesta de IA supera el tamaño permitido.',502);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
 }catch(error){if(error instanceof AuthError)throw error;fail('No se pudo completar la conexión con tu proveedor de IA. Intenta nuevamente.',502);}
 finally{clearTimeout(timer);}
}
export async function aiRoute(request,env,teacher,{readJson,digest,randomToken,now,requester}) {
 const url=new URL(request.url),db=env.DB;
 if(url.pathname==='/api/ai/profile' && request.method==='GET')return aiProfile(env,teacher.id);
 if(!await servicesReady(db))fail('Falta activar los servicios web. Ejecuta 0007_ai_student_portal.sql en D1.',503);
 await cipherKey(env);
 if(url.pathname==='/api/ai/credentials' && ['PUT','DELETE'].includes(request.method)) {
  const body=await readJson(request);if(Object.keys(body).some(k=>!['provider','key'].includes(k))||!providers.includes(body.provider))fail('Configuración de IA no válida.');
  await serviceLimit(db,`ai-key:${teacher.id}:${Math.floor(now/60_000)}`,10,now+120_000);
  if(request.method==='DELETE')await db.prepare('DELETE FROM ai_credentials WHERE teacher_id=? AND provider=?').bind(teacher.id,body.provider).run();
  else {
   if(typeof body.key!=='string'||body.key.trim().length<16||body.key.length>512||/[\s\x00-\x1f]/.test(body.key))fail('Revisa el formato de tu clave de IA.');
   const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`${teacher.id}:${body.provider}`)},await cipherKey(env),new TextEncoder().encode(body.key));
   await db.prepare("INSERT INTO ai_credentials(teacher_id,provider,cipher,iv,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(teacher_id,provider) DO UPDATE SET cipher=excluded.cipher,iv=excluded.iv,updated_at=excluded.updated_at").bind(teacher.id,body.provider,hex(new Uint8Array(cipher)),hex(iv),now).run();
  }
  return aiProfile(env,teacher.id);
 }
 if(url.pathname==='/api/ai/preferences' && request.method==='PUT') {
  const body=await readJson(request,12_000);const allowed=['provider','geminiModel','openaiModel','aiPedagogicalRoute','institutionalProblems','unitPedagogicalFocus'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||!providers.includes(body.provider)||Object.values(body).some(v=>typeof v!=='string'||v.length>3000))fail('Preferencias de IA no válidas.');
  for(const provider of providers)if(body[provider+'Model'] && !/^[a-zA-Z0-9._-]{1,100}$/.test(body[provider+'Model']))fail('Modelo de IA no válido.');
  await db.prepare('INSERT INTO ai_preferences(teacher_id,payload_json) VALUES(?,?) ON CONFLICT(teacher_id) DO UPDATE SET payload_json=excluded.payload_json').bind(teacher.id,JSON.stringify(body)).run();
  for(const provider of providers)if(body[provider+'Model'])await db.prepare('UPDATE ai_credentials SET model=? WHERE teacher_id=? AND provider=?').bind(body[provider+'Model'],teacher.id,provider).run();
  return aiProfile(env,teacher.id);
 }
 if(url.pathname==='/api/ai/models' && request.method==='GET') {
  const provider=url.searchParams.get('provider');if(!providers.includes(provider))fail('Proveedor no válido.');
  await serviceLimit(db,`ai-models:${teacher.id}:${Math.floor(now/60_000)}`,10,now+120_000);
  const key=await apiKey(env,teacher.id,provider);
  const payload=await upstream(requester,provider==='gemini'?'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000':'https://api.openai.com/v1/models',{headers:provider==='gemini'?{'x-goog-api-key':key}:{authorization:`Bearer ${key}`}});
  const models=(provider==='gemini'?payload.models||[]:payload.data||[]).filter(item=>provider!=='gemini'||item.supportedGenerationMethods?.includes('generateContent')).map(item=>({id:String(item.name||item.id).replace(/^models\//,''),label:item.displayName||item.id||item.name})).filter(item=>/^[a-zA-Z0-9._-]{1,100}$/.test(item.id)&&!/image|vision|tts|audio|embedding|realtime|transcrib|search|moderation|codex/i.test(item.id));
  return {models};
 }
 if(url.pathname==='/api/ai/generate' && request.method==='POST') {
  const body=await readJson(request,200_000);
  if(Object.keys(body).some(k=>!['provider','model','prompt','config'].includes(k))||!providers.includes(body.provider)||typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>150_000||!/^[a-zA-Z0-9._-]{1,100}$/.test(body.model||'')||/image|tts|audio|embedding|realtime|transcrib|search/i.test(body.model))fail('Solicitud de IA no válida.');
  const config=body.config||{};if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!['temperature','responseMimeType','responseSchema','maxOutputTokens'].includes(k))||JSON.stringify(config).length>40_000)fail('Formato de generación no válido.');
  const key=await apiKey(env,teacher.id,body.provider),lease=randomToken();
  await serviceLimit(db,`ai-minute:${teacher.id}:${Math.floor(now/60_000)}`,12,now+120_000);
  const slot=await db.prepare('INSERT INTO ai_leases(teacher_id,lease_id,expires_at) VALUES(?,?,?) ON CONFLICT(teacher_id) DO UPDATE SET lease_id=excluded.lease_id,expires_at=excluded.expires_at WHERE ai_leases.expires_at<=?').bind(teacher.id,lease,now+100_000,now).run();
  if(!slot.meta.changes)fail('Ya hay una generación de IA en curso en tu cuenta.',429);
  const day=new Date(now).toISOString().slice(0,10);
  try {
   const usage=await db.prepare('INSERT INTO ai_usage(teacher_id,day,calls) VALUES(?,?,1) ON CONFLICT(teacher_id,day) DO UPDATE SET calls=calls+1 RETURNING calls').bind(teacher.id,day).first();
   if(usage.calls>100)fail('Tu cuenta alcanzó el límite diario de solicitudes de IA en ARMI Web.',429);
   const outputLimit=Math.min(16384,Math.max(256,Number(config.maxOutputTokens)||16384));
   const payload=await upstream(requester,body.provider==='gemini'?`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(body.model)}:generateContent`:'https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json',...(body.provider==='gemini'?{'x-goog-api-key':key}:{authorization:`Bearer ${key}`})},body:JSON.stringify(body.provider==='gemini'?{contents:[{role:'user',parts:[{text:body.prompt}]}],generationConfig:{...config,maxOutputTokens:outputLimit}}:{model:body.model,input:body.prompt,max_output_tokens:outputLimit,store:false})});
   const text=body.provider==='gemini'?(payload.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join(''):(payload.output||[]).flatMap(row=>row.content||[]).filter(p=>p.type==='output_text').map(p=>p.text||'').join('\n')||payload.output_text;
   if(!text||payload.status==='incomplete'||payload.candidates?.[0]?.finishReason==='MAX_TOKENS')fail('La IA no devolvió una respuesta completa. Reduce el contenido o revisa el modelo.',422);
   const input=Number(payload.usageMetadata?.promptTokenCount||payload.usage?.input_tokens||0),output=Number(payload.usageMetadata?.candidatesTokenCount||payload.usage?.output_tokens||0);
   await db.prepare('UPDATE ai_usage SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE teacher_id=? AND day=?').bind(input,output,teacher.id,day).run();
   return {text,usage:{inputTokens:input,outputTokens:output,totalTokens:input+output}};
  }finally{await db.prepare('DELETE FROM ai_leases WHERE teacher_id=? AND lease_id=?').bind(teacher.id,lease).run();}
 }
 fail('Operación de IA no disponible.',404);
}
