import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Search, Trash2, X } from 'lucide-react';

const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const compare = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
const PAGE_SIZE = 24;

export function SessionManager({ sessions, assignments, themeColor, onClose, onLoad, onDelete }: {
    sessions: any[]; assignments: any[]; themeColor: string;
    onClose: () => void; onLoad: (session: any) => void; onDelete: (id: string) => Promise<void>;
}) {
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [page, setPage] = useState(0);
    const [deleting, setDeleting] = useState('');
    const [error, setError] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose); closeRef.current = onClose;
    const areaName = (id: string) => assignments.find(a => String(a.areaId) === String(id))?.areaName || id;
    const fields = [['year', 'Año'], ['areaId', 'Área'], ['grade', 'Grado'], ['section', 'Sección'], ['unitNumber', 'Unidad'], ['sessionNumber', 'Sesión']];
    const options = useMemo(() => Object.fromEntries(fields.map(([field]) => [field,
        Array.from(new Set(sessions.map(s => String(s[field] ?? '')).filter(Boolean))).sort(compare)
    ])), [sessions]);
    const filtered = useMemo(() => {
        const words = normalize(query).split(/\s+/).filter(Boolean);
        return sessions.filter(s => Object.entries(filters).every(([key, value]) => !value || String(s[key]) === value)
            && words.every(word => normalize(`${s.title} ${areaName(s.areaId)} ${s.year} ${s.grade} ${s.section} unidad ${s.unitNumber} sesión ${s.sessionNumber} U${s.unitNumber} S${s.sessionNumber}`).includes(word)));
    }, [sessions, assignments, query, filters]);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, pages - 1);
    useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [query, filters, currentPage]);
    useEffect(() => {
        const previousFocus = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        searchRef.current?.focus({ preventScroll: true });
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
            if (event.key !== 'Tab') return;
            const elements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select') || []);
            const first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); previousFocus?.focus({ preventScroll: true }); };
    }, []);
    const remove = async (id: string) => {
        setDeleting(id); setError('');
        try { await onDelete(id); } catch (e: any) { setError(e.message || 'No se pudo eliminar la sesión.'); }
        finally { setDeleting(''); }
    };

    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-slate-900/75 backdrop-blur-sm p-3 sm:p-5" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="session-manager-title" className="flex w-full max-w-6xl min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" style={{ maxHeight: 'calc(100dvh - 40px)' }}>
                <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-4 text-white" style={{ backgroundColor: themeColor }}>
                    <div><h3 id="session-manager-title" className="text-lg font-black">Gestor de sesiones</h3><p className="mt-1 text-xs text-white/80">Encuentra una sesión para cargarla o eliminarla.</p></div>
                    <button type="button" onClick={onClose} aria-label="Cerrar gestor de sesiones" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><X size={20} /></button>
                </header>
                <div className="shrink-0 space-y-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"><Search size={18} className="shrink-0 text-slate-400" /><input ref={searchRef} aria-label="Buscar sesiones" placeholder="Buscar por título, área, grado o número de sesión…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} className="min-w-0 w-full bg-transparent text-sm text-slate-800 outline-none" /></label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        {fields.map(([key, label]) => <label key={key} className="min-w-0 text-[10px] font-bold text-slate-500">{label}<select aria-label={`Filtrar por ${label.toLowerCase()}`} value={filters[key] || ''} onChange={e => { setFilters(previous => ({ ...previous, [key]: e.target.value })); setPage(0); }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700"><option value="">Todos</option>{options[key].map(value => <option key={value} value={value}>{key === 'areaId' ? areaName(value) : value}</option>)}</select></label>)}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span role="status">{filtered.length} de {sessions.length} sesiones</span><button type="button" onClick={() => { setQuery(''); setFilters({}); setPage(0); }} className="font-semibold text-violet-700 hover:underline">Limpiar filtros</button></div>
                    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
                </div>
                <div ref={scrollRef} className="min-h-0 overflow-y-auto overscroll-contain p-4 custom-scrollbar">
                    {filtered.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(s => <article key={s.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 transition-colors hover:border-violet-300 hover:bg-violet-50/30">
                            <div className="flex items-center justify-between gap-2"><span className="rounded-md bg-violet-100 px-2 py-1 text-[11px] font-bold text-violet-700">U{s.unitNumber} · Sesión {s.sessionNumber}</span><span className="text-[11px] font-semibold text-slate-400">{s.year}</span></div>
                            <button type="button" onClick={() => onLoad(s)} className="mt-2 text-left font-bold text-sm leading-snug text-slate-800 hover:text-violet-700" title={s.title}><span className="line-clamp-2 min-h-10">{s.title || 'Sin título'}</span></button>
                            <p className="mt-2 truncate text-[11px] font-medium text-slate-500" title={areaName(s.areaId)}>{areaName(s.areaId)}</p>
                            <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-600"><span>{s.grade} · Sección {s.section}</span>{s.date && <span>· {s.date}</span>}</div>
                            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2"><button type="button" onClick={() => onLoad(s)} className="flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100"><Download size={14} />Cargar</button><button type="button" disabled={!!deleting} onClick={() => void remove(s.id)} aria-label={`Eliminar sesión ${s.sessionNumber}: ${s.title}`} title="Eliminar sesión" className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 size={16} /></button></div>
                        </article>)}
                    </div> : <p className="py-12 text-center text-sm text-slate-500">{sessions.length ? 'No hay sesiones que coincidan con los filtros.' : 'Todavía no hay sesiones guardadas.'}</p>}
                </div>
                {pages > 1 && <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-30">Anterior</button><span>Página {currentPage + 1} de {pages}</span><button type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-30">Siguiente</button></footer>}
            </div>
        </div>, document.body
    );
}
