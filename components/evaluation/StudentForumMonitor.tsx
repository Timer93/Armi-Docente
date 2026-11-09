import { openStudentPhoto } from '../students/studentPhotoViewer';
import { createRandomUuid } from '../../utils/randomUuid';
import React, { useEffect, useRef, useState } from 'react';

const request = async (path: string, options?: RequestInit) => {
  const response = await fetch(`/api/student-forum/teacher/${path}`, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.message || 'No se pudo consultar el foro.');
  return payload.data;
};
const patch = (path: string, data: any) => request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const reactionLabels: Record<string, string> = { like: '👍 Me gusta', heart: '❤️ Me encanta', idea: '💡 Buena idea' };
const labels: Record<string, string> = { pregunta: 'Pregunta', aporte: 'Aporte', proyecto: 'Proyecto', debate: 'Debate' };
const unitColors = ['#f8fafc', '#f0eafa', '#e8f2fa', '#e8f3eb', '#faf0e6', '#f8eaf0', '#e8f7f5', '#faf7df', '#edf0fc'];
const unitStyle = (unit: string) => ({ backgroundColor: unitColors[Number(unit)] || unitColors[0] });
const bimesters = ['I', 'II', 'III', 'IV'];

export const StudentForumMonitor: React.FC = () => {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [filters, setFilters] = useState({ year: '', grade: '', section: '', search: '' });
  const [period, setPeriod] = useState({ unit: '', bimester: '' });
  const [fileSelection, setFileSelection] = useState<string[]>([]);
  const [page, setPage] = useState(0), [listing, setListing] = useState<any>({ posts: [], total: 0, hasMore: false });
  const [reports, setReports] = useState<any[]>([]), [selected, setSelected] = useState<any>(null);
  const [queue, setQueue] = useState<any>({ posts: [], comments: [] });
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{ name: string; kind: string; url: string; html?: string; text?: string } | null>(null);
  const selectedRequest = useRef(0);
  const [alerts, setAlerts] = useState<any>({ reports: 0, pendingComments: 0, pendingPosts: 0, latestReply: '' });
  const [reply, setReply] = useState('');
  const [newReplies, setNewReplies] = useState(false);
  const latestSeen = useRef('');
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const data = await request('alerts'); if (!alive) return; setAlerts(data); let seen = latestSeen.current; try { seen = localStorage.getItem('armi-forum-teacher-seen') || seen; } catch {} if (data.latestReply && data.latestReply > seen) { setNewReplies(true); setNotice('Hay nuevas respuestas en el foro. Pulsa Consultar para actualizar.'); } latestSeen.current = data.latestReply; } catch {} };
    void poll(); const timer = setInterval(() => { void poll(); }, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  useEffect(() => { try { setReply(localStorage.getItem(`armi-forum-teacher-reply:${selected?.post.id}`) || ''); } catch { setReply(''); } }, [selected?.post.id]);
  const saveReply = (value: string) => { setReply(value); try { localStorage.setItem(`armi-forum-teacher-reply:${selected?.post.id}`, value); } catch {} };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setNotice('');
    try { await work(); } catch (error: any) { setNotice(error.message); } finally { setBusy(false); }
  };
  const refresh = async (nextPage = page, nextPeriod = period) => {
    const [posts, flags, pending] = await Promise.all([request(`posts?${new URLSearchParams({ ...filters, ...nextPeriod, offset: String(nextPage * 20) })}`), request('reports'), request('moderation')]);
    setListing(posts); setReports(flags); setQueue(pending); setPage(nextPage);
    const summary = await request('alerts'); setAlerts(summary); setNewReplies(false); try { localStorage.setItem('armi-forum-teacher-seen', summary.latestReply); } catch {}
  };
  const select = async (postId: string) => {
    const sequence = ++selectedRequest.current;
    const data = await request(`posts/${encodeURIComponent(postId)}`);
    if (sequence === selectedRequest.current) { setSelected(data); setFileSelection([]); }
  };
  const changePeriod = async (next: typeof period) => {
    setPeriod(next); ++selectedRequest.current; setSelected(null); setFileSelection([]); await refresh(0, next);
  };
  const scopeType = period.unit ? 'unit' : period.bimester ? 'bimester' : 'all';
  const scopeValue = period.unit || period.bimester;
  const scopeClosed = !!listing.scopes?.some((state: any) => state.type === scopeType && state.value === scopeValue && state.closed);
  const changeScope = async (closed: boolean) => {
    if (!window.confirm(`${closed ? '¿Cerrar' : '¿Reabrir'} el foro ${period.unit ? period.unit === 'general' ? 'general' : `de la unidad ${period.unit}` : period.bimester ? `del bimestre ${period.bimester}` : 'de todo el año'}? El cierre bloquea publicaciones y comentarios, conservando la lectura.`)) return;
    await patch('scopes', { year: listing.scopeYear, type: scopeType, value: scopeValue, closed });
    await refresh(); if (selected) await select(selected.post.id);
  };
  const removeFiles = async () => {
    if (!selected || !fileSelection.length || !window.confirm(`¿Eliminar ${fileSelection.length} archivo(s) de esta publicación?`)) return;
    await request(`posts/${selected.post.id}/attachments/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attachmentIds: fileSelection, requestId: createRandomUuid() }) });
    await select(selected.post.id); await refresh();
  };
  useEffect(() => { if (open) void run(() => refresh(0)); }, [open]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);
  const moderate = async (field: string, value: boolean) => {
    if (!selected) return;
    await patch(`posts/${selected.post.id}`, field === 'locked' && !value ? { action: 'reopen' } : { [field]: value });
    await Promise.all([select(selected.post.id), refresh()]);
  };
  const viewFile = async (file: any) => {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error('No se pudo abrir el adjunto.');
    const blob = await response.blob(), url = URL.createObjectURL(blob);
    let html, text;
    if (file.kind === 'html') html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">${await blob.text()}`;
    if (file.kind === 'text') text = (await blob.text()).slice(0, 200000);
    setPreview({ name: file.name, kind: file.kind, url, html, text });
  };
  const button = 'rounded-lg border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40';
  const author = (entry: any) => <span className="flex items-center gap-2">{entry.profileUrl && <button type="button" aria-label={`Ampliar foto de ${entry.authorName}`} onClick={() => void openStudentPhoto(entry.authorId, entry.authorName)}><img data-student-photo-id={String(entry.authorId)} src={entry.profileUrl} alt="" className="h-8 w-8 rounded-full object-cover" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /></button>}<span>{entry.authorName}<small className="block text-slate-500">{entry.authorType === 'teacher' ? 'Docente' : `${entry.grade} · Sección ${entry.section}`}</small></span></span>;
  const decide = async (kind: string, id: string, approve: boolean, postId = selected?.post.id) => {
    if (!approve && !window.confirm('¿Eliminar este contenido? Se conservará el registro para revisión docente.')) return;
    if (approve) await patch(`${kind}/${id}`, { action: 'approve' }); else await request(`${kind}/${id}`, { method: 'DELETE' });
    if (!approve && kind === 'posts') { ++selectedRequest.current; setSelected(null); await refresh(); }
    else await Promise.all([select(postId), refresh()]);
  };
  const reactions = (entry: any, kind: string) => <div className="my-3 flex flex-wrap gap-2" aria-label="Reacciones">{Object.entries(reactionLabels).map(([key, label]) => <button key={key} type="button" aria-pressed={entry.reactions?.mine === key} disabled={busy || entry.deleted || entry.hidden || selected?.post.deleted || selected?.post.hidden} className={`${button} ${entry.reactions?.mine === key ? 'bg-violet-100 ring-1 ring-violet-400' : 'bg-white'}`} onClick={() => void run(async () => {
    const result = await request(`${kind}/${entry.id}/reaction`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reaction: entry.reactions?.mine === key ? '' : key }) });
    setSelected((current: any) => current?.post.id !== selected.post.id ? current : kind === 'posts' ? { ...current, post: { ...current.post, reactions: result } } : { ...current, comments: current.comments.map((comment: any) => comment.id === entry.id ? { ...comment, reactions: result } : comment) });
  })}>{label} <span>{entry.reactions?.counts?.[key] || 0}</span></button>)}</div>;
  const approved = (entry: any) => entry.reviewedAt && !entry.deleted && !entry.hidden ? <span title={new Date(entry.reviewedAt).toLocaleString('es-PE')} className="my-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">✓ Visto y aprobado por el docente</span> : null;
  return <section className={`${expanded ? 'fixed inset-3 z-[100] overflow-y-auto' : ''} rounded-[2rem] border border-violet-100 bg-white p-5 shadow-sm`}>
    <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => { setOpen(!open); if (open) setExpanded(false); }} aria-expanded={open}>
      <span><b className="text-sm text-slate-800">Foro del portal estudiantil{newReplies ? ' · Nuevas respuestas' : ''}</b><span className="mt-1 block text-xs text-slate-500">Todos los grados · {alerts.pendingComments + alerts.pendingPosts} textos pendientes · {alerts.reports} reportes</span></span><span className="text-violet-700">{open ? '−' : '+'}</span>
    </button>
    {open && <div className="mt-5 space-y-4">
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-500">Revisa proyectos, participa y acompaña las conversaciones.</p><button type="button" className={button} onClick={() => setExpanded(!expanded)}>{expanded ? 'Salir de pantalla amplia' : 'Ampliar foro'}</button></div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => { await refresh(0); if (selected) await select(selected.post.id); }); }}>
        {(['year', 'grade', 'section', 'search'] as const).map((key) => <label key={key} className="text-xs text-slate-500">{{ year: 'Año', grade: 'Grado', section: 'Sección', search: 'Buscar' }[key]}<input className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" value={filters[key]} placeholder={{ year: '2026', grade: '5to', section: 'A', search: 'Título, autor o contenido' }[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} /></label>)}
        <button className={button} disabled={busy}>Consultar</button>
      </form>
      <nav aria-label="Organizar publicaciones" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2" aria-label="Bimestres">{['', ...bimesters].map(bimester => <button type="button" key={bimester} disabled={busy} aria-pressed={period.bimester === bimester} className={`${button} ${period.bimester === bimester ? 'bg-violet-100 ring-1 ring-violet-400' : ''}`} onClick={() => void run(() => changePeriod({ unit: '', bimester }))}>{bimester ? `Bimestre ${bimester}` : 'Todos los bimestres'}</button>)}</div>
        <div className="flex flex-wrap gap-2" aria-label="Unidades">{['', ...(!period.bimester ? ['general'] : []), ...Array.from({ length: 8 }, (_, index) => String(index + 1)).filter(unit => !period.bimester || bimesters[Math.floor((Number(unit) - 1) / 2)] === period.bimester)].map(unit => <button type="button" key={unit} disabled={busy} aria-pressed={period.unit === unit} className={`${button} ${period.unit === unit ? 'ring-2 ring-violet-400' : ''}`} style={unitStyle(unit)} onClick={() => void run(() => changePeriod({ ...period, unit }))}>{unit ? unit === 'general' ? 'General / sin unidad' : `Unidad ${unit}` : 'Todas las unidades'}</button>)}</div>
        <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-slate-600">Año {listing.scopeYear} · {scopeClosed ? 'Foro cerrado' : 'Foro abierto'} · {period.unit ? period.unit === 'general' ? 'General' : `Unidad ${period.unit}` : period.bimester ? `Bimestre ${period.bimester}` : 'Todo el año'}</span><button type="button" className={button} disabled={busy || !listing.scopeYear} onClick={() => void run(() => changeScope(!scopeClosed))}>{scopeClosed ? 'Reabrir este foro' : 'Cerrar este foro'}</button></div>
        {listing.scopes?.filter((state: any) => state.closed).map((state: any) => <div key={`${state.type}:${state.value}`} className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><span>Cerrado: {state.type === 'all' ? 'todo el año' : state.type === 'unit' ? state.value === 'general' ? 'foro general' : `unidad ${state.value}` : `bimestre ${state.value}`}. Este cierre prevalece sobre sus unidades y publicaciones.</span><button type="button" className={button} disabled={busy} onClick={() => void run(async () => { await patch('scopes', { year: listing.scopeYear, type: state.type, value: state.value, closed: false }); await refresh(); if (selected) await select(selected.post.id); })}>Reabrir</button></div>)}
      </nav>
      <p role="status" className="text-xs text-rose-700">{notice}</p>
      <details className="rounded-xl border border-orange-200 bg-orange-50 p-3" open={queue.posts.length + queue.comments.length > 0}>
        <summary className="cursor-pointer text-xs font-bold text-orange-800">Textos ocultos por el filtro · Revisión exclusiva del docente</summary>
        {[...queue.posts.map((entry: any) => ({ ...entry, kind: 'posts', postId: entry.id })), ...queue.comments.map((entry: any) => ({ ...entry, kind: 'comments' }))].map((entry: any) => <article key={entry.id} className="mt-3 rounded-lg bg-white p-3 text-xs"><b>{entry.title}</b><div className="my-2">{author(entry)}</div><p className="whitespace-pre-wrap break-words text-slate-600">{entry.body}</p><div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { void run(() => decide(entry.kind, entry.id, true, entry.postId)); }}>Aprobar</button><button className={button} disabled={busy} onClick={() => { void run(() => decide(entry.kind, entry.id, false, entry.postId)); }}>Eliminar</button><button className={button} disabled={busy} onClick={() => { void run(() => select(entry.postId)); }}>Ver conversación</button></div></article>)}
        {!queue.posts.length && !queue.comments.length && <p className="mt-2 text-xs text-slate-500">No hay textos pendientes.</p>}
      </details>
      <details className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <summary className="cursor-pointer text-xs font-bold text-amber-800">{reports.length} reporte(s) pendiente(s) de revisión</summary>
        <div className="mt-3 space-y-2">{reports.map((report) => <article key={report.id} className="rounded-lg bg-white p-3 text-xs text-slate-600"><b>{report.title}</b><p>{report.year} · {report.grade} {report.section} · {report.comment_id ? 'Comentario reportado' : 'Publicación reportada'}</p><p className="whitespace-pre-wrap">{report.reason}</p><p>Reportado por {report.reporter_id === 'system' ? 'Filtro automático' : report.reporter_name || 'Estudiante'}</p><div className="mt-2 flex gap-2"><button className={button} disabled={busy} onClick={() => { void run(() => select(report.post_id)); }}>Revisar conversación</button><button className={button} disabled={busy} onClick={() => { void run(async () => { await patch(`reports/${report.id}`, {}); await refresh(); }); }}>Marcar revisado</button></div></article>)}{!reports.length && <p className="text-xs text-slate-500">No hay reportes pendientes.</p>}</div>
      </details>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.38fr)_minmax(0,1fr)]">
        <div className="max-h-[80vh] space-y-2 overflow-y-auto pr-1"><p className="text-xs text-slate-500">{listing.total} publicación(es)</p>{listing.posts.map((post: any) => <button key={post.id} style={unitStyle(post.unitNumber)} type="button" disabled={busy} onClick={() => { void run(() => select(post.id)); }} className={`block w-full rounded-xl border p-3 text-left ${selected?.post.id === post.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-slate-50'}`}><b className="block text-xs text-slate-800">{post.title}</b><span className="mt-1 block text-[11px] text-slate-500">{post.authorName} · {post.grade} {post.section} · {post.year}</span><span className="mt-1 block text-[10px] text-violet-600">{post.unitNumber ? `Unidad ${post.unitNumber} / Bimestre ${post.bimester}` : 'General / sin unidad'} · {labels[post.category]} · {post.commentCount} comentarios{post.reviewedAt ? ' · ✓ Revisada' : ' · Sin revisión docente'}{post.hidden ? ' · Oculta' : ''}{post.locked ? ' · Cerrada' : ''}{post.pinned ? ' · Destacada' : ''}{post.reportCount ? ` · ${post.reportCount} reportes` : ''}</span></button>)}{!listing.posts.length && <p className="p-4 text-xs text-slate-400">No hay publicaciones con estos filtros.</p>}<div className="flex justify-between gap-2"><button className={button} disabled={busy || page === 0} onClick={() => { void run(() => refresh(page - 1)); }}>Anterior</button><button className={button} disabled={busy || !listing.hasMore} onClick={() => { void run(() => refresh(page + 1)); }}>Siguiente</button></div></div>
        <div style={selected ? unitStyle(selected.post.unitNumber) : undefined} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{selected ? <>
          <div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-xs font-bold text-slate-600">Ubicación de la publicación<select className="ml-2 rounded-lg border border-slate-200 bg-white p-2 text-xs" value={selected.post.unitNumber || ''} disabled={busy || selected.post.deleted || !!selected.post.sessionId} onChange={(event) => { const unitNumber = event.target.value; void run(async () => { await patch(`posts/${selected.post.id}`, { unitNumber }); await select(selected.post.id); await refresh(); }); }}><option value="">General / sin unidad</option>{Array.from({ length: 8 }, (_, i) => <option key={i} value={String(i + 1)}>Unidad {i + 1} / Bimestre {bimesters[Math.floor(i / 2)]}</option>)}</select></label>{selected.post.sessionId && <small className="text-slate-500">La unidad corresponde a la sesión vinculada.</small>}</div>
          <h3 className="text-xl font-bold text-slate-800">{selected.post.title}</h3><div className="mt-2 text-xs text-slate-500">{author(selected.post)} · {new Date(selected.post.createdAt).toLocaleString('es-PE')}</div>{approved(selected.post)}{selected.post.deleted && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Esta publicación fue eliminada. Se conserva para revisión docente.</p>}<p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{selected.post.body}</p>
          <div className="my-5 grid grid-cols-1 gap-3 sm:grid-cols-2">{selected.post.attachments.map((file: any) => <div key={file.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><button type="button" className="group block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-violet-400 hover:shadow-md disabled:opacity-40" disabled={busy} onClick={() => { void run(() => viewFile(file)); }}>
            {['image', 'svg'].includes(file.kind) ? <img loading="lazy" src={file.url} alt={file.name} className="h-48 w-full bg-slate-100 object-contain" /> : file.kind === 'video' ? <video preload="metadata" src={file.url} className="h-48 w-full bg-slate-900 object-contain" muted /> : <span className="flex h-28 items-center justify-center bg-violet-50 text-lg font-bold text-violet-600">{{ pdf: 'PDF', html: 'HTML interactivo', audio: '♫ Audio', text: 'Texto' }[file.kind] || 'Documento'}</span>}
            <span className="block p-3"><b className="block break-all text-xs text-slate-700">{file.name}</b><small className="mt-1 block text-violet-600">{(file.size / 1048576).toFixed(1)} MB · Abrir vista previa ↗</small></span>
          </button><label className="flex cursor-pointer items-center gap-2 border-t border-slate-100 bg-white p-3 text-xs text-slate-600"><input type="checkbox" disabled={busy || selected.post.deleted} checked={fileSelection.includes(file.id)} onChange={(event) => setFileSelection(current => event.target.checked ? [...current, file.id] : current.filter(id => id !== file.id))} />Seleccionar para eliminar</label></div>)}</div>
          {!!selected.post.attachments.length && <div className="mb-4 flex flex-wrap items-center gap-3"><button type="button" className={`${button} !border-rose-200 !text-rose-700`} disabled={busy || selected.post.deleted || !fileSelection.length} onClick={() => void run(removeFiles)}>Eliminar archivos seleccionados ({fileSelection.length})</button><small className="text-slate-500">Puedes eliminar varios archivos a la vez. Sin límite de operaciones para el docente.</small></div>}{reactions(selected.post, 'posts')}
          {selected.post.moderationStatus === 'pending' && <div className="my-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><b>Publicación oculta por el filtro. Pendiente de revisión.</b><p>Revisa el contenido y utiliza Aprobar o Eliminar.</p></div>}
          {selected.post.closeAt && <p className="my-2 text-xs text-slate-500">Plazo de comentarios: {new Date(selected.post.closeAt).toLocaleString('es-PE')}</p>}
          <div className="flex flex-wrap gap-2 border-y border-slate-100 py-3">
          <button className={button} disabled={busy || selected.post.deleted || !!selected.post.reviewedAt && !selected.post.hidden} onClick={() => void run(() => decide('posts', selected.post.id, true))}>✓ Aprobar publicación</button>
          <button className={`${button} !border-rose-200 !text-rose-700`} disabled={busy || selected.post.deleted} onClick={() => void run(() => decide('posts', selected.post.id, false))}>Eliminar publicación</button>{(['pinned', 'locked', 'hidden'] as const).map((field) => <button key={field} className={button} disabled={busy || selected.post.deleted || (field === 'hidden' && selected.post.moderationStatus === 'pending')} onClick={() => { void run(() => moderate(field, field === 'locked' ? !!selected.post.canComment : !selected.post[field])); }}>{{ pinned: selected.post.pinned ? 'Quitar destacado' : 'Destacar', locked: selected.post.locked || !selected.post.canComment ? 'Reabrir comentarios' : 'Cerrar comentarios', hidden: selected.post.hidden ? 'Mostrar publicación' : 'Ocultar publicación' }[field]}</button>)}</div>
          <h4 className="mt-5 text-sm font-bold text-slate-700">Comentarios ({selected.total})</h4>{!selected.comments.length && <p className="my-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Aún no hay comentarios. Puedes iniciar la conversación con una orientación.</p>}{selected.comments.map((comment: any) => <article key={comment.id} className="my-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs"><div className="font-bold text-slate-600">{author(comment)}{comment.deleted && <span> - Eliminado</span>}{comment.hidden ? ' · Oculto' : ''}{comment.moderationStatus === 'pending' ? ' · Pendiente de revisión' : ''}</div>{approved(comment)}<p className="my-2 whitespace-pre-wrap break-words leading-relaxed text-slate-600">{comment.body}</p>{!comment.deleted && !selected.post.deleted && <div className="mb-2 flex gap-2"><button className={button} disabled={busy || !!comment.reviewedAt && !comment.hidden} onClick={() => { void run(() => decide('comments', comment.id, true)); }}>Aprobar comentario</button><button className={button} disabled={busy} onClick={() => { void run(() => decide('comments', comment.id, false)); }}>Eliminar comentario</button></div>}<button disabled={busy || selected.post.deleted || comment.deleted || comment.moderationStatus === 'pending'} className="font-bold text-violet-700" onClick={() => { void run(async () => { await patch(`comments/${comment.id}`, { hidden: !comment.hidden }); await select(selected.post.id); await refresh(); }); }}>{comment.hidden ? 'Mostrar' : 'Ocultar'}</button>{reactions(comment, 'comments')}</article>)}
          {selected.hasMore && <button className={`${button} mt-3`} disabled={busy} onClick={() => { void run(async () => { const more = await request(`posts/${selected.post.id}?offset=${selected.comments.length}`); setSelected({ ...more, comments: [...selected.comments, ...more.comments] }); }); }}>Cargar más comentarios</button>}
          {selected.post.canComment ? <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await request(`posts/${selected.post.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply, requestId: createRandomUuid() }) }); saveReply(''); await select(selected.post.id); await refresh(); }); }}><label className="block text-xs font-bold text-slate-600">Respuesta del docente<textarea required maxLength={2000} rows={3} value={reply} onChange={(event) => saveReply(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-200 p-3 font-normal" /></label><p className="text-xs text-slate-400">Borrador guardado en este equipo. Los participantes recibirán un aviso.</p><button className={button} disabled={busy || !reply.trim()}>Responder como docente</button></form> : <p className="mt-4 text-xs text-amber-700">{selected.post.closeReason}</p>}
        </> : <p className="text-xs text-slate-400">Selecciona una publicación para revisar su conversación.</p>}</div>
      </div>
    </div>}
    {preview && <div onKeyDown={(event) => { if (event.key === 'Escape') setPreview(null); }} tabIndex={-1} className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-label={preview.name}>
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"><header className="flex items-center justify-between border-b p-4"><b className="break-all text-sm text-slate-700">{preview.name}</b><button className={button} onClick={() => setPreview(null)}>Cerrar</button></header><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-50">
        {['image', 'svg'].includes(preview.kind) ? <img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" /> : preview.kind === 'video' ? <video src={preview.url} controls className="max-h-full max-w-full" /> : preview.kind === 'audio' ? <audio src={preview.url} controls /> : preview.kind === 'html' ? <iframe title={preview.name} sandbox="allow-scripts" srcDoc={preview.html} className="h-full w-full border-0" /> : preview.kind === 'pdf' ? <iframe title={preview.name} src={preview.url} className="h-full w-full border-0" /> : preview.kind === 'text' ? <pre className="h-full w-full whitespace-pre-wrap break-words p-4 text-xs text-slate-600">{preview.text}</pre> : <p className="text-sm text-slate-500">Descarga este archivo para abrirlo con su aplicación.</p>}
      </div><footer className="flex justify-end border-t p-3"><a className={button} href={preview.url} download={preview.name}>Descargar archivo</a></footer></div>
    </div>}
  </section>;
};
