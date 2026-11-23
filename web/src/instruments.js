import {AuthError} from './apps-script-auth.js';
const fail=(message,status=400)=>{throw new AuthError(message,status);};
export async function instrumentsReady(db) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='web_instruments'").first());
}
const validId=id=>typeof id==='string' && /^web-[a-f0-9-]{36}$/.test(id);
const publicRow=row=>({...JSON.parse(row.payload_json),id:row.id,webRevision:row.revision});
const fields=['year','areaId','grade','section','type','name','structure','version'];
const types=['rubrica','lista_cotejo','escala_valoracion','guia_observacion'];
export async function instrumentsRoute(request,env,teacher,{readJson,digest,now,validateRecord}) {
  const db=env.DB,url=new URL(request.url);
  if(!await instrumentsReady(db))fail('Falta activar Instrumentos. Ejecuta 0008_web_instruments.sql en D1.',503);
  if(request.method==='GET') {
    const allowed=['year','areaId','grade','section','type','cursor'];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key)))fail('Filtros de instrumentos no válidos.');
    const cursor=url.searchParams.get('cursor')||'';
    if(cursor&&!validId(cursor))fail('Página no válida.');
    const params=[teacher.id,cursor],conditions=['teacher_id=?','id>?','deleted=0'];
    for(const [field,column] of [['year','year'],['areaId','area_id'],['grade','grade'],['section','section']]) {
      const value=url.searchParams.get(field)||'';
      if(value.length>80||/[\x00-\x1f]/.test(value))fail('Filtros no válidos.');
      if(value){conditions.push(`${column}=?`);params.push(value);}
    }
    const type=url.searchParams.get('type');if(type){if(!types.includes(type))fail('Tipo no válido.');conditions.push("json_extract(payload_json,'$.type')=?");params.push(type);}
    const result=(await db.prepare(`SELECT id,payload_json,revision FROM web_instruments WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT 51`).bind(...params).all()).results;
    return {records:result.slice(0,50).map(publicRow),nextCursor:result.length>50?result[49].id:null};
  }
  if(!['PUT','DELETE'].includes(request.method))fail('Operación no disponible.',404);
  const body=await readJson(request,280_000);
  if(Object.keys(body).some(key=>!['id','value','expectedRevision','operationId'].includes(key))||!validId(body.id)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>Number.MAX_SAFE_INTEGER-1||!/^[a-f0-9-]{36}$/.test(body.operationId||''))fail('Operación de instrumento no válida.');
  const deleting=request.method==='DELETE';
  if(deleting?body.value!==undefined:!body.value||typeof body.value!=='object'||Array.isArray(body.value)||Object.keys(body.value).some(key=>!fields.includes(key)))fail('Datos de instrumento no válidos.');
  const previous=await db.prepare('SELECT * FROM web_instruments WHERE teacher_id=? AND id=?').bind(teacher.id,body.id).first();
  const hash=await digest(JSON.stringify({method:request.method,...body}));
  if(previous?.operation_id===body.operationId) {
    if(previous.operation_hash!==hash)fail('La operación ya se utilizó con otros datos.',409);
    return {record:publicRow(previous),deleted:Boolean(previous.deleted)};
  }
  if((previous?.revision||0)!==body.expectedRevision||previous?.deleted)fail('El instrumento cambió en otra pestaña. Recarga antes de continuar.',409);
  if(deleting&&!previous)fail('Instrumento no encontrado.',404);
  const value=deleting?JSON.parse(previous.payload_json):body.value;
  if(!deleting) {
    if(!/^\d{4}$/.test(value.year||'')||['areaId','grade','section','name'].some(key=>typeof value[key]!=='string'||value[key].length>(key==='name'?300:80)||/[\x00-\x1f]/.test(value[key]))||!value.areaId.trim()||!value.name.trim()||!types.includes(value.type)||!value.structure||typeof value.structure!=='object'||Array.isArray(value.structure)||!Number.isSafeInteger(value.version)||value.version<1||value.version>100000)fail('Completa año, área, nombre y estructura del instrumento.');
    // Reuse the bounded academic JSON validator: excludes secrets, local paths,
    // embedded files and prototype keys, including inside custom layouts.
    validateRecord({dataset:'annual',id:body.id,value});
  }
  const payload=JSON.stringify(value);
  if(!previous){const count=await db.prepare('SELECT COUNT(*) AS n FROM web_instruments WHERE teacher_id=? AND deleted=0').bind(teacher.id).first();if(count.n>=500)fail('Tu cuenta admite hasta 500 instrumentos activos en esta etapa.',429);}
  const result=await db.prepare(`INSERT INTO web_instruments(teacher_id,id,year,area_id,grade,section,payload_json,revision,deleted,operation_id,operation_hash,updated_at)
    SELECT ?,?,?,?,?,?,?,1,?,?,?,? WHERE (?=0 AND (SELECT COUNT(*) FROM web_instruments WHERE teacher_id=? AND deleted=0)<500)
      OR EXISTS(SELECT 1 FROM web_instruments WHERE teacher_id=? AND id=? AND revision=? AND deleted=0)
    ON CONFLICT(teacher_id,id) DO UPDATE SET year=excluded.year,area_id=excluded.area_id,grade=excluded.grade,section=excluded.section,payload_json=excluded.payload_json,revision=web_instruments.revision+1,deleted=excluded.deleted,operation_id=excluded.operation_id,operation_hash=excluded.operation_hash,updated_at=excluded.updated_at
    WHERE web_instruments.revision=? AND web_instruments.deleted=0`)
    .bind(teacher.id,body.id,value.year,value.areaId,value.grade,value.section,payload,Number(deleting),body.operationId,hash,now,body.expectedRevision,teacher.id,teacher.id,body.id,body.expectedRevision,body.expectedRevision).run();
  if(!result.meta.changes)fail('El instrumento cambió o se alcanzó el límite. Recarga antes de continuar.',409);
  return {record:{...value,id:body.id,webRevision:body.expectedRevision+1},deleted:deleting};
}
