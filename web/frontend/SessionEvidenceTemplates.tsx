import React,{useEffect,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {academicApi} from './academic-client';
const previewDocument=(html:string)=>{
 const safe=DOMPurify.sanitize(html,{WHOLE_DOCUMENT:true,FORBID_TAGS:['script','iframe','object','embed','form','base','link','meta'],FORBID_ATTR:['src','srcset','action','formaction']});
 return `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'">${safe}`;
};

export function SessionEvidenceTemplates({currentSessionId,themeColor}:any){
 const [catalog,setCatalog]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<any>(null);
 const active=useRef(currentSessionId);active.current=currentSessionId;
 const load=async()=>{const id=currentSessionId;setBusy(true);setError('');try{const data=await academicApi('/api/drive/templates?sessionId='+encodeURIComponent(id));if(active.current===id)setCatalog(data);}catch(e:any){if(active.current===id)setError(e.message);}finally{if(active.current===id)setBusy(false);}};
 useEffect(()=>{active.current=currentSessionId;setCatalog(null);setPreview(null);if(currentSessionId)void load();return()=>{active.current='';};},[currentSessionId]);
 const documentHtml=preview?previewDocument(preview.html):'';
 return <section data-armi-web-template-reader="" className="min-w-0 overflow-hidden rounded-[2rem] border bg-white shadow-xl" style={{borderColor:themeColor}}>
  <header className="flex items-center justify-between gap-3 px-5 py-4 text-sm font-bold text-white" style={{background:themeColor}}><span>Plantillas de actividades y evidencias</span><button type="button" disabled={busy} onClick={()=>void load()} className="rounded-xl border border-white/40 px-3 py-2">{busy?'Cargando…':'Actualizar'}</button></header>
  <div className="space-y-3 p-4">{error&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
   {catalog?.message&&<p className="text-sm text-slate-600">{catalog.message}</p>}
   {catalog?.templates?.length>0&&<p className="text-sm text-slate-600">Plantillas de tu carpeta de Drive. Puedes consultar su contenido; la edición y el trabajo de estudiantes en estas plantillas todavía se realizan en Windows.</p>}
   {catalog?.templates?.map((t:any)=>{const evidence=catalog.evidences.find((e:any)=>e.id===t.evidence_id)||t.requested;return <article key={t.id} className="flex items-center gap-4 rounded-2xl border p-3"><button type="button" aria-label={'Vista previa: '+(evidence?.text||'Plantilla')} onClick={()=>setPreview(t)} className="relative h-[90px] w-[128px] shrink-0 overflow-hidden rounded-xl border bg-slate-50"><iframe title="Miniatura de plantilla" sandbox="" loading="lazy" tabIndex={-1} srcDoc={previewDocument(t.html)} style={{position:'absolute',top:0,left:0,width:960,height:675,transform:'scale(0.1333)',transformOrigin:'top left',pointerEvents:'none',border:0}}/><span className="absolute inset-0" aria-hidden="true"/></button><div className="min-w-0 flex-1"><h4 className="text-sm font-bold">{evidence?.text||'Plantilla de evidencia'}</h4><p className="text-xs text-slate-500">{t.mode==='individual'?'Individual':'Trabajo en equipo'}</p><button type="button" onClick={()=>setPreview(t)} className="mt-2 rounded-xl border px-3 py-2 text-sm">Ver plantilla</button></div></article>;})}
  </div>
  {preview&&<div className="fixed inset-0 z-[15000] flex flex-col bg-slate-950/70 p-3" role="dialog" aria-modal="true" aria-label="Plantilla de evidencia"><div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"><header className="flex justify-between border-b p-3"><b>Vista previa de la plantilla</b><button type="button" onClick={()=>setPreview(null)} className="rounded-lg border px-3 py-2">Cerrar vista previa</button></header><iframe title="Contenido de la plantilla" sandbox="" srcDoc={documentHtml} className="w-full flex-1 border-0"/></div></div>}
 </section>;
}
