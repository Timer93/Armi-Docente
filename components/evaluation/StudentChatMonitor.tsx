import React, { useEffect, useState } from 'react';

const request = async (url: string, options?: RequestInit) => {
  const response = await fetch(`/api${url}`, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.message || 'No se pudo completar la operación.');
  return payload.data || [];
};

export const StudentChatMonitor: React.FC = () => {
  const [groups, setGroups] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const loadGroups = async () => setGroups(await request('/student-chat/teacher/groups'));
  useEffect(() => { if (open) void loadGroups(); }, [open]);
  useEffect(() => {
    if (!open || !active) return;
    const timer = window.setInterval(async () => {
      try { setMessages(await request(`/student-chat/teacher/groups/${active.id}/messages`)); } catch {}
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open, active?.id]);
  const select = async (group: any) => { setActive(group); setMessages(await request(`/student-chat/teacher/groups/${group.id}/messages`)); };
  const send = async () => { if (!active || !text.trim()) return; await request(`/student-chat/teacher/groups/${active.id}/messages`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text, teacherName:'Docente' }) }); setText(''); await select(active); };
  const saveLink = async () => { if (!active) return; const portfolioUrl = window.prompt('Enlace de Google Docs o portafolio para este grupo:', active.portfolio_url || ''); if (portfolioUrl === null) return; await request(`/student-chat/teacher/groups/${active.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ portfolioUrl }) }); await loadGroups(); setActive({ ...active, portfolio_url: portfolioUrl }); };
  return <section className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white shadow-sm">
    <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-5 text-left">
      <span><span className="block text-[9px] font-black uppercase tracking-[0.18em] text-violet-600">Modo fantasma docente</span><strong className="mt-1 block text-lg text-slate-800">Conversaciones grupales del aula</strong></span><span className="rounded-full bg-violet-100 px-4 py-2 text-[10px] font-black text-violet-700">{open ? 'Ocultar' : 'Supervisar chats'}</span>
    </button>
    {open ? <div className="grid min-h-[420px] border-t border-slate-100 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-2 border-r border-slate-100 bg-slate-50 p-3">{groups.length ? groups.map(group => <button key={group.id} type="button" onClick={() => void select(group)} className={`w-full rounded-xl p-3 text-left ${active?.id === group.id ? 'bg-violet-600 text-white' : 'bg-white text-slate-700'}`}><strong className="block text-xs">{group.name}</strong><span className="text-[9px] opacity-70">{group.grade} {group.section} · {group.member_count} integrantes</span></button>) : <p className="p-4 text-xs text-slate-400">Todavía no hay grupos.</p>}</aside>
      <div className="flex min-w-0 flex-col bg-[#f4f2f8]">
        {active ? <><header className="flex items-center justify-between border-b border-slate-100 bg-white p-3"><div><strong className="text-sm">{active.name}</strong><span className="block text-[9px] text-slate-400">Tu presencia no aparece como integrante.</span></div><button type="button" onClick={() => void saveLink()} className="rounded-lg border border-violet-200 px-3 py-2 text-[9px] font-black text-violet-700">Configurar enlace</button></header><div className="flex flex-1 flex-col gap-2 overflow-auto p-4">{messages.map(message => <div key={message.id} className={`max-w-[78%] rounded-xl bg-white p-3 text-xs shadow-sm ${message.sender_type === 'teacher' ? 'ml-auto bg-violet-100' : ''}`}><strong className="block text-[9px] text-violet-700">{message.sender_name}</strong><p className="my-1">{message.message_text}</p>{message.file_name ? <a href={message.file_url || '#'} target="_blank" rel="noreferrer" className="text-[9px] font-bold text-blue-600">📎 {message.file_name}</a> : null}</div>)}</div><footer className="flex gap-2 border-t border-slate-100 bg-white p-3"><input value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send(); }} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Escribir como docente..."/><button type="button" onClick={() => void send()} className="rounded-xl bg-violet-600 px-4 text-xs font-black text-white">Enviar</button></footer></> : <div className="m-auto text-xs font-bold text-slate-400">Selecciona un grupo para leerlo sin aparecer como integrante.</div>}
      </div>
    </div> : null}
  </section>;
};
