import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export const WordNumberFilter: React.FC<{
  label: string; prefix: string; options: { value: string; label: string }[];
  values: string[]; onChange: (values: string[]) => void;
}> = ({ label, prefix, options, values, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const selected = options.filter(option => values.includes(option.value));
  const summary = !values.length ? 'Todas' : selected.map(option => `${prefix}${option.value}`).join(', ') || `${values.length} seleccionadas`;
  const visible = options.filter(option => option.label.toLowerCase().includes(search.toLowerCase()));
  return <div ref={root} className="relative min-w-0" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
    <label id={`${id}-label`} className="mb-1 block truncate text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</label>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-haspopup="dialog" aria-controls={`${id}-options`} title={summary} onClick={() => { setSearch(''); setOpen(value => !value); }} className="flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-[11px] font-bold text-slate-700 hover:border-violet-300">
      <span id={`${id}-value`} className="truncate">{summary}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
    </button>
    {open && <div id={`${id}-options`} role="dialog" aria-label={`Seleccionar ${label.toLowerCase()}`} className="absolute left-0 top-full z-[110] mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      <input ref={input} aria-label={`Buscar ${label.toLowerCase()}`} placeholder="Buscar…" value={search} onChange={event => setSearch(event.target.value)} className="h-8 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-xs" />
      <div className="my-1.5 flex flex-wrap justify-between gap-1 text-[10px] font-bold text-violet-700"><button type="button" onClick={() => onChange(options.map(option => option.value))}>Marcar todas</button><button type="button" onClick={() => onChange([])}>Quitar filtro</button></div>
      <div className="max-h-48 space-y-0.5 overflow-y-auto">
        {visible.map(option => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-slate-700 hover:bg-violet-50"><input type="checkbox" checked={values.includes(option.value)} onChange={() => onChange(values.includes(option.value) ? values.filter(value => value !== option.value) : [...values, option.value])} className="h-3.5 w-3.5 shrink-0 accent-violet-600" /><span className="min-w-0 break-words">{option.label}</span></label>)}
        {!visible.length && <p className="py-2 text-xs text-slate-400">Sin opciones.</p>}
      </div>
    </div>}
  </div>;
};
