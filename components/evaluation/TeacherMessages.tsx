import React, { useEffect, useRef, useState } from 'react';
import { Mail, Send, RefreshCw } from 'lucide-react';
import { createRandomUuid } from '../../utils/randomUuid';

type Recipient = {id:string;name:string;grade:string;section:string;online:boolean};
const request = async (route:string, options?:RequestInit) => {
  const response=await fetch(`/api/student-messages/teacher/${route}`,options);
  const payload=await response.json();
  if (!response.ok||!payload.success) throw new Error(payload.message||'No se pudo consultar la mensajería.');
  return payload.data;
};
export const TeacherMessages:React.FC = () => {
  const [open,setOpen]=useState(false),[students,setStudents]=useState<Recipient[]>([]),[history,setHistory]=useState<any[]>([]);
  const [audience,setAudience]=useState('online'),[grade,setGrade]=useState(''),[section,setSection]=useState(''),[studentId,setStudentId]=useState('');
  const [title,setTitle]=useState(''),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const draft=useRef({fingerprint:'',id:''});
  const refresh=async()=>{try{const [recipients,messages]=await Promise.all([request('recipients'),request('messages')]);setStudents(recipients);setHistory(messages);}catch(error:any){setNotice(error.message);}};
  useEffect(()=>{if(open)void refresh();},[open]);
  const recipients=students.filter(item=>audience==='all'||audience==='online'&&item.online||audience==='personal'&&item.id===studentId||audience==='class'&&item.grade===grade&&(!section||item.section===section));
  const send=async(event:React.FormEvent)=>{
    event.preventDefault();if(busy||!recipients.length)return;
    const data={audience,grade,section,studentId,title,body},fingerprint=JSON.stringify(data);
    if(draft.current.fingerprint!==fingerprint)draft.current={fingerprint,id:createRandomUuid()};
    setBusy(true);setNotice('');
    try{const result=await request('messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,requestId:draft.current.id})});setNotice(`Mensaje enviado a ${result.recipients} estudiante${result.recipients===1?'':'s'}.`);setTitle('');setBody('');draft.current={fingerprint:'',id:''};await refresh();}
    catch(error:any){setNotice(error.message);}finally{setBusy(false);}
  };
  const field='min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700';
  return <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
    <button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-4 text-left">
      <span className="flex items-center gap-3"><Mail className="h-5 w-5 text-indigo-600"/><span><strong className="block text-sm text-slate-800">Mensajes a estudiantes</strong><small className="text-xs text-slate-500">Avisos destacados y mensajes personales en el portal</small></span></span><span className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">{open?'Ocultar':'Escribir mensaje'}</span>
    </button>
    {open&&<div className="grid gap-4 border-t border-slate-100 p-4 xl:grid-cols-2">
      <form onSubmit={send} className="grid content-start gap-3">
        <div className="flex items-center justify-between"><strong className="text-xs text-slate-700">Destinatarios · {recipients.length}</strong><button type="button" onClick={()=>void refresh()} className="flex items-center gap-1 text-xs font-bold text-indigo-600"><RefreshCw className="h-3 w-3"/>Actualizar</button></div>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Enviar a<select disabled={busy} className={field} value={audience} onChange={event=>setAudience(event.target.value)}><option value="online">Estudiantes conectados ahora</option><option value="all">Todos los estudiantes activos</option><option value="class">Un grado y sección</option><option value="personal">Un estudiante (personal)</option></select></label>
        {audience==='class'&&<div className="flex gap-2"><select required disabled={busy} aria-label="Grado destinatario" className={`${field} flex-1`} value={grade} onChange={event=>{setGrade(event.target.value);setSection('');}}><option value="">Selecciona grado</option>{[...new Set(students.map(item=>item.grade))].map(value=><option key={value}>{value}</option>)}</select><select disabled={busy} aria-label="Sección destinataria" className={`${field} flex-1`} value={section} onChange={event=>setSection(event.target.value)}><option value="">Todas las secciones</option>{[...new Set(students.filter(item=>item.grade===grade).map(item=>item.section))].map(value=><option key={value}>{value}</option>)}</select></div>}
        {audience==='personal'&&<select required disabled={busy} aria-label="Estudiante destinatario" className={field} value={studentId} onChange={event=>setStudentId(event.target.value)}><option value="">Selecciona estudiante</option>{students.map(item=><option key={item.id} value={item.id}>{item.name} · {item.grade} {item.section}{item.online?' · Conectado':''}</option>)}</select>}
        <label className="grid gap-1 text-xs font-bold text-slate-600">Asunto<input required disabled={busy} maxLength={120} className={field} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Por ejemplo: Recordatorio de la entrega"/></label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">Mensaje<textarea required disabled={busy} maxLength={5000} rows={4} className={`${field} resize-y`} value={body} onChange={event=>setBody(event.target.value)} placeholder="Escribe el mensaje para tus estudiantes…"/></label>
        <div className="flex items-center justify-between gap-3"><small className="text-[11px] text-slate-500">Aparecerá un aviso con el botón «Ver mensaje». El historial se guarda en esta PC.</small><button type="submit" disabled={busy||!recipients.length||!title.trim()||!body.trim()} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"><Send className="h-4 w-4"/>{busy?'Enviando…':'Enviar mensaje'}</button></div>
        {notice&&<p role="status" className="rounded-lg bg-indigo-50 p-2 text-xs font-semibold text-indigo-800">{notice}</p>}
      </form>
      <div><strong className="text-xs text-slate-700">Últimos mensajes enviados</strong><div className="mt-2 max-h-96 space-y-2 overflow-auto">{history.length?history.map(item=><details key={item.id} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-700">{item.title}<span className="mt-1 block text-[11px] font-normal text-slate-500">{item.recipients} destinatarios · {item.readCount} leídos · {new Date(item.createdAt.replace(' ','T')+'Z').toLocaleString('es-PE')}</span></summary><p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600">{item.body}</p></details>):<p className="p-4 text-xs text-slate-400">Todavía no has enviado mensajes.</p>}</div></div>
    </div>}
  </section>;
};
