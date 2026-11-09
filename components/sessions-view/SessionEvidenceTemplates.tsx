import React, {useEffect,useRef,useState} from 'react';
import {Copy,FileCode2,RefreshCw,Upload,X} from 'lucide-react';
import {validateEvidenceTemplate,evidenceTemplatePrompt,combinedEvidenceTemplatePrompt} from '../../backend/evidenceTemplateContract.js';
import {TemplateThumbnail} from './TemplateThumbnail';
import {evidenceBotErrors} from '../../backend/evidenceTemplateBots.js';

type Props={currentSessionId:string;sessionData:any;grade:string;themeColor:string;setToast:(t:{msg:string;type:'success'|'error'|'warning'})=>void};
const periodLabel=(w:any)=>{
    if(!Number.isFinite(Date.parse(w?.openAt)) || !(Date.parse(w?.closeAt)>Date.parse(w?.openAt)))return 'Plazo pendiente';
    const date=new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Bogota'}).format(new Date(w.openAt));
    const end=new Intl.DateTimeFormat('es-PE',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Bogota'}).format(new Date(w.closeAt));
    return `${date}–${end}`;
};
export function SessionEvidenceTemplates({currentSessionId,sessionData,grade,themeColor,setToast}:Props){
    const [catalog,setCatalog]=useState<any>(null),[settings,setSettings]=useState<Record<string,any>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(''),[preview,setPreview]=useState<any>(null);
    const input=useRef<HTMLInputElement>(null),target=useRef(''),activeSession=useRef(currentSessionId);activeSession.current=currentSessionId;
    const load=async()=>{
        const id=currentSessionId;try{const response=await fetch(`/api/evidence-templates/${encodeURIComponent(id)}/catalog`);const result=await response.json();if(!result.success)throw new Error(result.message);if(activeSession.current!==id)return;setCatalog(result.data);setSettings(Object.fromEntries(result.data.templates.map((t:any)=>[t.evidence_id,{mode:t.mode,enabled:!!t.enabled,overrides:t.overrides}])));setError('');}catch(e:any){if(activeSession.current===id)setError(e.message);}
    };
    useEffect(()=>{setCatalog(null);setSettings({});setError('');if(currentSessionId)void load();},[currentSessionId]);
    const setting=(id:string)=>settings[id] || {mode:'individual',enabled:false,overrides:{}};
    const update=(id:string,value:any)=>setSettings(s=>({...s,[id]:{...setting(id),...value}}));
    const persist=async(evidenceId:string,html:string,automatic=false,refresh=true)=>{
        const checked=validateEvidenceTemplate(html);if(!checked.valid)throw new Error(checked.errors.join(' '));
        const existing=catalog?.templates.find((t:any)=>t.evidence_id===evidenceId);
        if(!(existing?.html===html && !setting(evidenceId).enabled && !automatic)){
            const botErrors=evidenceBotErrors(html,catalog?.imageNames || []);if(botErrors.length)throw new Error(botErrors.join(' '));
        }
        const response=await fetch(`/api/evidence-templates/${encodeURIComponent(currentSessionId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({evidenceId,html,...setting(evidenceId),...(automatic?{activation:'session_schedule'}:{})})});const result=await response.json();if(!result.success)throw new Error(result.message);
        if(refresh){await load();setToast({msg:result.data.message,type:automatic&&!result.data.enabled?'warning':'success'});}
        return result.data;
    };
    const run=async(id:string,fn:()=>Promise<void>)=>{if(busy)return;setBusy(id);try{await fn();}catch(e:any){setToast({msg:e.message,type:'error'});}finally{setBusy('');}};
    const activateLoaded=async()=>{
        if(busy)return;setBusy('all');let activated=0;const problems:string[]=[];
        try{for(const t of catalog.templates.filter((item:any)=>!item.enabled && catalog.evidences.some((e:any)=>e.id===item.evidence_id))){
            try{const saved=await persist(t.evidence_id,t.html,true,false);if(saved.enabled)activated++;else problems.push(saved.message);}catch(e:any){problems.push(e.message);}
        }await load();setToast({msg:`${activated} plantilla(s) activada(s) con el horario de clase.${problems.length?` ${[...new Set(problems)].join(' ')}`:''}`,type:problems.length?'warning':'success'});}finally{setBusy('');}
    };
    const promptContext={...(catalog?.pedagogy || {}),grade,imageNames:catalog?.imageNames || []};
    const copyText=async(prompt:string,message:string)=>{try{await navigator.clipboard.writeText(prompt);setToast({msg:message,type:'success'});}catch{setPreview({prompt});}};
    const copy=(e:any)=>copyText(evidenceTemplatePrompt(e,{...promptContext,mode:setting(e.id).mode,fileNumber:(catalog?.evidences.findIndex((item:any)=>item.id===e.id) ?? 0)+1}),'Prompt de plantilla copiado. Pégalo en ChatGPT.');
    const copyAll=()=>copyText(combinedEvidenceTemplatePrompt(catalog.evidences,promptContext,settings),`Prompts de ${catalog.evidences.length} evidencias copiados en una sola solicitud.`);
    return <section className="min-w-0 overflow-hidden rounded-[2rem] border bg-white shadow-xl" style={{borderColor:themeColor}}>
        <header className="flex items-center justify-between gap-2 px-5 py-4 text-xs font-black uppercase tracking-widest text-white" style={{backgroundColor:themeColor}}><span className="flex items-center gap-2"><FileCode2 size={18}/>Plantillas de evidencias</span><button type="button" onClick={()=>void load()} title="Actualizar desde la sesión guardada" aria-label="Actualizar plantillas"><RefreshCw size={16}/></button></header>
        <div className="space-y-3 p-4"><p className="text-[11px] text-slate-500">Al importar, la plantilla se activa con la fecha de la sesión y tu horario de clase por sección. El plazo excepcional es opcional.</p>
        {catalog?.templates.some((t:any)=>!t.enabled && catalog.evidences.some((e:any)=>e.id===t.evidence_id))&&<button type="button" disabled={!!busy} onClick={()=>void activateLoaded()} className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800 disabled:opacity-50">Activar las cargadas con horario de sesión</button>}
        {!!catalog?.evidences.length&&<button type="button" onClick={()=>void copyAll()} className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] font-bold text-violet-800"><Copy size={14}/>Copiar todos los prompts ({catalog.evidences.length})</button>}
        {error&&<p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{error}</p>}
        {catalog?.evidences.length===0&&<p className="text-xs text-slate-500">Define las evidencias, guarda la sesión y pulsa Actualizar.</p>}
        {catalog?.evidences.map((e:any,index:number)=>{const t=catalog.templates.find((v:any)=>v.evidence_id===e.id),s=setting(e.id);const color=/^#[a-f0-9]{6}$/i.test(e.color)?e.color:'#334155';return <article key={e.id} data-evidence-color={color} className="rounded-2xl border p-3" style={{borderColor:`${color}55`,borderLeftWidth:4,backgroundColor:`${color}0d`}}>
            <div className="flex flex-wrap gap-3 sm:flex-nowrap"><TemplateThumbnail html={t?.html} title={e.text} onClick={()=>t&&setPreview(t)}/><div className="min-w-0 flex-1"><h4 className="text-xs font-black text-slate-800">{index+1}. {e.text}</h4><p className="mt-1 text-[10px] font-semibold" style={{color:e.color}}>{e.source==='transversal'?'Transversal':'Área'} · {e.competency}</p><div className="mt-2 flex flex-wrap items-center gap-2"><select aria-label={`Modalidad de evidencia ${index+1}`} value={s.mode} onChange={event=>update(e.id,{mode:event.target.value})} className="rounded-lg border bg-white px-2 py-1 text-[11px]"><option value="individual">Individual</option><option value="group">Grupal</option></select><span className="text-[10px] font-bold text-slate-500">{t?(t.enabled?'Publicada':'Borrador'):'Sin HTML'}{t?` · v${t.version}`:''}</span></div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>void copy(e)} className="flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-[10px] font-bold text-violet-700"><Copy size={13}/>Copiar prompt</button><button type="button" disabled={!!busy} onClick={()=>{target.current=e.id;input.current?.click();}} className="flex items-center gap-1 rounded-lg bg-violet-700 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"><Upload size={13}/>{busy===e.id?'Guardando…':'Buscar HTML'}</button></div></div></div>
            <p className="mt-2 text-[10px] text-slate-500">Horario de sesión: {catalog.schedules.map((schedule:any)=>`${schedule.section}: ${(s.overrides?.[schedule.section]?[s.overrides[schedule.section]]:schedule.windows).map(periodLabel).join(' · ') || 'Falta fecha u horario semanal'}`).join(' | ')}</p>
            {t&&!t.enabled&&<button type="button" disabled={!!busy} onClick={()=>void run(e.id,async()=>{await persist(e.id,t.html,true);})} className="mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">Activar con horario de sesión</button>}
            <details className="mt-3 text-[11px]"><summary className="cursor-pointer font-bold text-slate-600">Horario automático y excepciones</summary><div className="mt-2 space-y-2"><p className="text-slate-500">El horario se toma de la fecha guardada de esta sesión y de tu Horario Semanal. Solo define una excepción si deseas otro plazo. Los trabajos iniciados conservan su plantilla y modalidad originales.</p>{catalog.schedules.map((schedule:any)=>{
                const override=s.overrides?.[schedule.section];
                const changeWindow=(key:string,value:string)=>{const overrides={...s.overrides};overrides[schedule.section]={...(overrides[schedule.section] || {}),[key]:value?new Date(value).toISOString():''};update(e.id,{overrides});};
                const local=(iso:string)=>{if(!iso)return '';const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
                return <div key={schedule.section} className="rounded-xl bg-white p-2"><b>Sección {schedule.section}</b><p className="text-slate-500">{schedule.windows.length?schedule.windows.map((w:any)=>`${new Date(w.openAt).toLocaleString()} — ${new Date(w.closeAt).toLocaleTimeString()}`).join(' · '):'Sin horario: define inicio y cierre para publicar.'}</p><label className="mt-1 flex gap-2"><input type="checkbox" checked={!!override} onChange={event=>{const overrides={...s.overrides};if(event.target.checked)overrides[schedule.section]={openAt:'',closeAt:''};else delete overrides[schedule.section];update(e.id,{overrides});}}/>Definir un plazo excepcional</label>{override&&<div className="mt-2 flex flex-wrap gap-2"><label>Inicio<input type="datetime-local" value={local(override.openAt)} onChange={event=>changeWindow('openAt',event.target.value)} className="block rounded border p-1"/></label><label>Cierre<input type="datetime-local" value={local(override.closeAt)} onChange={event=>changeWindow('closeAt',event.target.value)} className="block rounded border p-1"/></label></div>}</div>;
            })}<label className="flex gap-2"><input type="checkbox" checked={s.enabled} onChange={event=>update(e.id,{enabled:event.target.checked})}/>Publicar en el portal del estudiante</label><button type="button" disabled={!t || !!busy} onClick={()=>void run(e.id,()=>persist(e.id,t.html))} className="rounded-lg bg-slate-800 px-3 py-2 font-bold text-white disabled:opacity-40">Guardar configuración</button></div></details>
        </article>;})}
        <input ref={input} type="file" accept=".html,.htm,text/html" className="hidden" onChange={event=>{const file=event.target.files?.[0],id=target.current;if(file)void run(id,async()=>{if(file.size>512*1024)throw new Error('La plantilla supera 512 KB.');await persist(id,await file.text(),true);});event.currentTarget.value='';}}/>
        </div>
        {preview&&<div className="fixed inset-0 z-[10010] flex flex-col bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Vista previa de plantilla"><div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"><header className="flex justify-between border-b p-3"><b className="text-sm">{preview.prompt?'Prompt de plantilla · copia el texto':'Vista previa de la plantilla'}</b><button type="button" onClick={()=>setPreview(null)} aria-label="Cerrar vista previa"><X size={20}/></button></header>{preview.prompt?<textarea readOnly value={preview.prompt} className="flex-1 p-4" onFocus={e=>e.currentTarget.select()}/>:<iframe title="Vista previa de plantilla" sandbox="" srcDoc={preview.html} className="w-full flex-1 border-0"/>}</div></div>}
    </section>;
}
