import React, { useEffect, useRef, useState } from 'react';

const request = async (url: string, options?: RequestInit) => {
  const response = await fetch(`/api${url}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw new Error(payload.message || 'No se pudo completar la operación.');
  return payload.data || [];
};

const PARTICIPANT_COLORS = [
  ['#6d28d9', '#ede9fe'], ['#0369a1', '#e0f2fe'], ['#047857', '#d1fae5'],
  ['#b45309', '#fef3c7'], ['#be123c', '#ffe4e6'], ['#0f766e', '#ccfbf1'],
  ['#7e22ce', '#f3e8ff'], ['#c2410c', '#ffedd5'],
];

const participantColors = (value: unknown) => {
  const key = String(value || 'participante');
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  return PARTICIPANT_COLORS[Math.abs(hash) % PARTICIPANT_COLORS.length];
};

export const StudentChatMonitor: React.FC = () => {
  const [groups, setGroups] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkEditing, setLinkEditing] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadGroups = async () => setGroups(await request('/student-chat/teacher/groups'));
  const select = async (group: any) => {
    setActive(group);
    setLinkValue(group.portfolio_url || '');
    setLinkEditing(false);
    setMessages(await request(`/student-chat/teacher/groups/${group.id}/messages`));
  };

  useEffect(() => { if (open) void loadGroups(); }, [open]);
  useEffect(() => {
    if (!open || !active) return;
    const timer = window.setInterval(async () => {
      try { setMessages(await request(`/student-chat/teacher/groups/${active.id}/messages`)); } catch {}
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open, active?.id]);

  const send = async () => {
    const file = fileRef.current?.files?.[0];
    if (!active || busy || (!text.trim() && !file)) return;
    setBusy(true);
    setNotice('');
    const formData = new FormData();
    formData.append('text', text.trim());
    formData.append('teacherName', 'Docente');
    if (file) formData.append('file', file);
    try {
      await request(`/student-chat/teacher/groups/${active.id}/messages`, { method: 'POST', body: formData });
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      await select(active);
    } catch (error: any) {
      setNotice(error.message || 'No se pudo enviar el mensaje.');
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async () => {
    if (!active || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await request(`/student-chat/teacher/groups/${active.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portfolioUrl: linkValue }),
      });
      const portfolioUrl = result.portfolioUrl || '';
      const updated = { ...active, portfolio_url: portfolioUrl };
      setActive(updated);
      setLinkValue(portfolioUrl);
      setLinkEditing(false);
      await loadGroups();
      setNotice(portfolioUrl ? 'Enlace del grupo guardado.' : 'Enlace del grupo retirado.');
    } catch (error: any) {
      setNotice(error.message || 'No se pudo guardar el enlace.');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (message: any) => {
    const canPreview = /^(image|audio|video)\//i.test(String(message.file_type || ''))
      || message.file_type === 'application/pdf' || String(message.file_type || '').startsWith('text/');
    const popup = canPreview ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    try {
      const response = await fetch(message.file_url);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'No se pudo abrir el archivo.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (canPreview && popup) popup.location.href = objectUrl;
      else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = message.file_name || 'archivo';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error: any) {
      popup?.close();
      setNotice(error.message || 'No se pudo abrir el archivo.');
    }
  };

  const deleteMessage = async (message: any) => {
    if (!window.confirm(`¿Eliminar el mensaje de ${message.sender_name || 'este participante'}?`)) return;
    await request(`/student-chat/teacher/messages/${message.id}`, { method: 'DELETE' });
    setMessages((current) => current.filter((item) => item.id !== message.id));
  };

  const clearChat = async () => {
    if (!active || !window.confirm(`¿Vaciar todos los mensajes de “${active.name}”? Los archivos locales del chat también se eliminarán.`)) return;
    await request(`/student-chat/teacher/groups/${active.id}/messages`, { method: 'DELETE' });
    setMessages([]);
    setNotice('Chat vaciado correctamente.');
  };

  const deleteGroup = async () => {
    if (!active || !window.confirm(`¿Eliminar definitivamente el grupo “${active.name}”, sus mensajes y archivos locales?`)) return;
    await request(`/student-chat/teacher/groups/${active.id}`, { method: 'DELETE' });
    setActive(null);
    setMessages([]);
    await loadGroups();
    setNotice('Grupo eliminado.');
  };

  return <section className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white shadow-sm">
    <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-5 text-left">
      <span><span className="block text-[9px] font-black uppercase tracking-[0.18em] text-violet-600">Modo fantasma docente</span><strong className="mt-1 block text-lg text-slate-800">Conversaciones grupales del aula</strong></span>
      <span className="rounded-full bg-violet-100 px-4 py-2 text-[10px] font-black text-violet-700">{open ? 'Ocultar' : 'Supervisar chats'}</span>
    </button>
    {open ? <div className="grid min-h-[420px] border-t border-slate-100 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-2 border-r border-slate-100 bg-slate-50 p-3">
        {groups.length ? groups.map((group) => <button key={group.id} type="button" onClick={() => void select(group)} className={`w-full rounded-xl p-3 text-left ${active?.id === group.id ? 'bg-violet-600 text-white' : 'bg-white text-slate-700'}`}>
          <strong className="block text-xs">{group.name}</strong><span className="text-[9px] opacity-70">{group.grade} {group.section} · {group.member_count} integrantes</span>
        </button>) : <p className="p-4 text-xs text-slate-400">Todavía no hay grupos.</p>}
      </aside>
      <div className="flex min-w-0 flex-col bg-[#f4f2f8]">
        {active ? <>
          <header className="border-b border-slate-100 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><strong className="text-sm">{active.name}</strong><span className="block text-[9px] text-slate-400">Tu presencia no aparece como integrante.</span></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setLinkEditing((value) => !value)} className="rounded-lg border border-violet-200 px-3 py-2 text-[9px] font-black text-violet-700">Configurar enlace</button>
                <button type="button" onClick={() => void clearChat()} className="rounded-lg border border-amber-200 px-3 py-2 text-[9px] font-black text-amber-700">Vaciar chat</button>
                <button type="button" onClick={() => void deleteGroup()} className="rounded-lg border border-red-200 px-3 py-2 text-[9px] font-black text-red-700">Eliminar grupo</button>
              </div>
            </div>
            {linkEditing ? <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-violet-50 p-3">
              <input type="url" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="https://docs.google.com/..." className="min-w-[220px] flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs" />
              <button type="button" disabled={busy} onClick={() => void saveLink()} className="rounded-lg bg-violet-600 px-4 py-2 text-[9px] font-black text-white disabled:opacity-50">Guardar</button>
              <button type="button" onClick={() => { setLinkValue(active.portfolio_url || ''); setLinkEditing(false); }} className="rounded-lg bg-white px-4 py-2 text-[9px] font-black text-slate-600">Cancelar</button>
            </div> : null}
          </header>
          <div className="flex flex-1 flex-col gap-2 overflow-auto p-4">
            {messages.length ? messages.map((message) => {
              const [color, soft] = participantColors(`${message.sender_type}:${message.sender_id || message.sender_name}`);
              return <div key={message.id} style={{ backgroundColor: soft, borderLeftColor: color }} className={`group relative max-w-[78%] rounded-xl border-l-4 p-3 text-xs shadow-sm ${message.sender_type === 'teacher' ? 'ml-auto' : ''}`}>
                <button type="button" onClick={() => void deleteMessage(message)} title="Eliminar mensaje" className="absolute right-2 top-2 rounded-full bg-white/70 px-2 py-1 text-[9px] font-black text-red-600 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">×</button>
                <strong style={{ color }} className="block pr-7 text-[9px]">{message.sender_name}</strong>
                {message.message_text ? <p className="my-1 whitespace-pre-wrap break-words">{message.message_text}</p> : null}
                {message.file_name ? <button type="button" onClick={() => void openFile(message)} style={{ color, borderColor: `${color}55` }} className="mt-2 flex w-full items-center gap-2 rounded-lg border bg-white/70 px-3 py-2 text-left text-[9px] font-bold"><span>📎</span><span className="min-w-0 flex-1 truncate">{message.file_name}</span><small>Abrir o descargar</small></button> : null}
              </div>;
            }) : <div className="m-auto text-xs font-bold text-slate-400">Este grupo todavía no tiene mensajes.</div>}
          </div>
          <footer className="border-t border-slate-100 bg-white p-3">
            <div className="flex gap-2"><input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Escribir como docente..."/><button type="button" disabled={busy} onClick={() => void send()} className="rounded-xl bg-violet-600 px-4 text-xs font-black text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Enviar'}</button></div>
            <div className="mt-2 flex items-center justify-between gap-3"><input ref={fileRef} type="file" className="min-w-0 flex-1 text-[9px] text-slate-500"/><span className="text-[8px] font-semibold text-slate-400">Archivos locales · máximo 15 MB · no se sincronizan con Drive</span></div>
            {notice ? <p className="mt-2 text-[9px] font-bold text-violet-700">{notice}</p> : null}
          </footer>
        </> : <div className="m-auto text-xs font-bold text-slate-400">Selecciona un grupo para leerlo sin aparecer como integrante.</div>}
      </div>
    </div> : null}
  </section>;
};
