import React, { useMemo, useState } from 'react';
import { BookOpen, GraduationCap, ClipboardList, CheckSquare, Image, Settings, Search, ChevronDown, Check } from 'lucide-react';
import { groupWordMarkers } from '../../utils/sessionWordMerge';

const icons = { general: BookOpen, competencies: GraduationCap, development: ClipboardList, assessment: CheckSquare, resources: Image, other: Settings };
export const WordMarkerGroups: React.FC<{ templateFields: string[]; suggested: string[]; onError: (message: string) => void }> = ({ templateFields, suggested, onError }) => {
  const [search, setSearch] = useState(''), [copied, setCopied] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const groups = useMemo(() => groupWordMarkers(templateFields, suggested, search), [templateFields, suggested, search]);
  const total = useMemo(() => groupWordMarkers(templateFields, suggested).reduce((sum, group) => sum + group.markers.length, 0), [templateFields, suggested]);
  const visibleTotal = groups.reduce((sum, group) => sum + group.markers.length, 0);
  const copy = async (marker: string) => {
    try {
      const text = `<<${marker}>>`;
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const previous = document.activeElement as HTMLElement | null;
        const field = document.createElement('textarea'); field.value = text;
        field.style.cssText = 'position:fixed;opacity:0;left:0;top:0';
        document.body.appendChild(field);
        try { field.select(); if (!document.execCommand('copy')) throw new Error('copy'); }
        finally { field.remove(); previous?.focus(); }
      }
      setCopied(marker);
    } catch { onError('No se pudo copiar. Selecciona el marcador y cópialo manualmente.'); }
  };
  return <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-lg">
    <header className="mb-3 flex items-start gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-sm font-black text-white">2</span>
      <div className="min-w-0 flex-1"><h3 className="text-sm font-black text-slate-800">Campos de plantilla</h3><p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">Pulsa un campo para copiar <span className="font-mono">&lt;&lt;campo&gt;&gt;</span>.</p></div>
      <span className="shrink-0 rounded-xl bg-violet-50 px-2 py-1 text-center text-xs font-black text-violet-700">{total}<span className="block text-[9px] font-semibold">campos</span></span>
    </header>
    <label className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 px-2.5"><Search className="h-4 w-4 shrink-0 text-slate-400" /><input aria-label="Buscar campo de plantilla" placeholder="Buscar campo…" value={search} onChange={event => setSearch(event.target.value)} className="h-8 w-full min-w-0 bg-transparent text-xs outline-none" /></label>
    <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
      {groups.filter(group => group.markers.length > 0).map(group => {
        const Icon = icons[group.id], open = Boolean(search.trim()) || expanded.includes(group.id);
        return <div key={group.id} className="overflow-hidden rounded-xl border border-slate-200">
          <button type="button" aria-expanded={open} onClick={() => setExpanded(current => current.includes(group.id) ? current.filter(id => id !== group.id) : [...current, group.id])} className="flex w-full items-center gap-2 bg-white px-2.5 py-2 text-left hover:bg-violet-50">
            <Icon className="h-4 w-4 shrink-0 text-violet-600" /><span className="min-w-0 flex-1 text-[11px] font-bold leading-snug text-slate-700">{group.label}</span><span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-500">{group.markers.length}</span><ChevronDown className={`h-3 w-3 shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && <div className="space-y-1 border-t border-slate-100 bg-slate-50 p-2">{group.markers.map(marker => <button key={marker} type="button" onClick={() => void copy(marker)} title={`Copiar <<${marker}>>`} className="flex w-full min-w-0 items-start gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left font-mono text-[10px] text-slate-600 hover:border-violet-300 hover:text-violet-700"><span className="min-w-0 flex-1 break-all">{`<<${marker}>>`}</span>{copied === marker && <Check className="h-3 w-3 shrink-0 text-emerald-600" />}</button>)}</div>}
        </div>;
      })}
      {visibleTotal === 0 && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{search ? 'No hay campos con esa búsqueda.' : 'No se pudieron leer los campos de la plantilla.'}</p>}
    </div>
  </section>;
};
