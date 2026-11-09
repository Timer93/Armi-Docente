import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function EvidenceTemplateWorkspace({documentId,onClose}:{documentId:string;onClose:()=>void}) {
    const frame=useRef<HTMLIFrameElement>(null);
    useEffect(()=>{
        const receive=(event:MessageEvent)=>{
            if(event.source!==frame.current?.contentWindow)return;
            if(event.data?.type==='armi-workspace-ready')frame.current?.contentWindow?.postMessage({type:'armi-workspace-init',teacher:true,documentId},location.origin);
            if(event.data?.type==='armi-workspace-close')onClose();
        };
        window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);
    },[documentId,onClose]);
    return createPortal(<div className="fixed inset-0 z-[10020] bg-slate-950/60 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label="Revisión de plantilla de evidencia"><iframe ref={frame} src="/estudiante-assets/evidence-workspace.html" title="Revisión y comentarios de la plantilla" className="h-full w-full rounded-2xl border-0 bg-white shadow-2xl"/></div>,document.body);
}
export function EvidenceTemplateDocuments({sessionId,studentId,criteriaId}:{sessionId:string;studentId:string;criteriaId:string}) {
    const [items,setItems]=useState<any[]>([]),[active,setActive]=useState(''),[error,setError]=useState('');
    useEffect(()=>{
        let disposed=false,running=false;const controller=new AbortController();
        const load=async()=>{if(running || document.hidden)return;running=true;try{
            const response=await fetch(`/api/evidence-templates/${encodeURIComponent(sessionId)}/documents?studentId=${encodeURIComponent(studentId)}&criteriaId=${encodeURIComponent(criteriaId || '')}`,{signal:controller.signal});const json=await response.json();if(!json.success)throw new Error(json.message);if(!disposed){setItems(json.data);setError('');}
        }catch(e:any){if(!disposed)setError(e.message);}finally{running=false;}};
        void load();const timer=setInterval(load,5000);return()=>{disposed=true;controller.abort();clearInterval(timer);};
    },[sessionId,studentId,criteriaId]);
    return <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-3"><h4 className="text-xs font-black text-violet-800">Plantillas de evidencia · avances y entregas</h4>
        {error?<p className="text-xs text-rose-700">{error}</p>:!items.length?<p className="mt-1 text-xs text-slate-500">No hay plantillas iniciadas para esta selección.</p>:items.map(item=><button type="button" key={item.id} onClick={()=>setActive(item.id)} className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl bg-white p-3 text-left text-xs shadow-sm"><span><b>{item.requested.text}</b><small className="mt-1 block text-slate-500">{item.participants.map((m:any)=>m.name).join(' · ')}</small></span><span className="shrink-0 font-bold text-violet-700">{item.status==='submitted'?'Entregado':'En elaboración'} · v1.{item.revision}<br/>Abrir y retroalimentar →</span></button>)}
        {active&&<EvidenceTemplateWorkspace documentId={active} onClose={()=>setActive('')}/>}
    </section>;
}
