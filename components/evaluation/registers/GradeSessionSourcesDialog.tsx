import React, { useEffect, useRef } from 'react';
import type { SessionRegisterSource } from '../../../utils/sessionRegisterNavigation';

export function GradeSessionSourcesDialog({ sources, onClose, onOpen }: {
  sources: SessionRegisterSource[];
  onClose: () => void;
  onOpen: (source: SessionRegisterSource) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  if (!sources.length) return null;
  return <div className="fixed inset-0 z-[7000] flex items-center justify-center bg-slate-950/50 p-4 print:hidden" onClick={onClose}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="grade-sources-title" className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') || []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="flex items-center justify-between gap-3"><h3 id="grade-sources-title" className="font-bold text-slate-900">{sources.every(source => source.pending) ? 'Sesiones con notas pendientes' : 'Registros de origen'}</h3><button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-600">Cerrar</button></div>
      <p className="mt-1 text-xs font-semibold text-slate-700">{sources[0].studentName}</p>
      <p className="mt-1 text-xs text-slate-500">{sources[0].capacityName || sources[0].competencyName}</p>
      {sources.every(source => source.pending) && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Faltan notas en estas sesiones. Completa los criterios pendientes para calcular el resultado.</p>}
      <div className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto">{sources.map(source => <button key={source.sessionId} type="button" onClick={() => onOpen(source)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left text-xs hover:border-sky-400 hover:bg-sky-50 focus-visible:outline focus-visible:outline-sky-600">
        <span><span className="font-bold">Unidad {source.unitNumber} · S{source.sessionNumber}</span><span className="mt-1 block text-slate-500">{source.title || 'Abrir registro de la sesión'}</span></span>
        <span className={`shrink-0 font-black ${source.pending ? 'text-amber-800' : 'text-sky-900'}`}>{source.pending ? 'Pendiente' : source.code.toUpperCase()}{!source.pending && source.numericScore != null ? ` · ${source.numericScore.toFixed(1)}` : ''} →</span>
      </button>)}</div>
    </section>
  </div>;
}
