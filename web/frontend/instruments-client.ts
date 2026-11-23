import {academicApi,displayValue,withWebSave} from './academic-client';
export async function getInstrumentos(filters:Record<string,unknown>={}) {
  try {
    const query=new URLSearchParams();
    for(const key of ['year','areaId','grade','section','type'])if(filters[key])query.set(key,String(filters[key]));
    const rows=[];let cursor='';
    do {
      if(cursor)query.set('cursor',cursor);
      const page=await academicApi('/api/instruments?'+query);
      rows.push(...page.records.map(displayValue));cursor=page.nextCursor||'';
      if(rows.length>500)throw new Error('Demasiados instrumentos. Filtra por año y área.');
    }while(cursor);
    return {success:true,data:rows};
  }catch(error){return {success:false,message:(error as Error).message,data:[]};}
}
export async function saveInstrumento(data:any) {
  try {
    const value=Object.fromEntries(['year','areaId','grade','section','type','name','structure','version'].map(key=>[key,data[key]]));
    const result=await withWebSave(()=>academicApi('/api/instruments','PUT',{id:data.id||'web-'+crypto.randomUUID(),value,expectedRevision:data.id?data.webRevision:0,operationId:crypto.randomUUID()}));
    return {success:true,data:displayValue(result.record)};
  }catch(error){return {success:false,message:(error as Error).message};}
}
export async function deleteInstrumento(id:string|number,webRevision?:number) {
  try {
    await withWebSave(()=>academicApi('/api/instruments','DELETE',{id:String(id),expectedRevision:webRevision,operationId:crypto.randomUUID()}));
    return {success:true};
  }catch(error){return {success:false,message:(error as Error).message};}
}
