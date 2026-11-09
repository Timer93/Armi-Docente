import { startVisiblePanelPolling } from '../utils/panelPolling';
import { createPortal } from 'react-dom';
import { CheckCircle2, RefreshCw, Clock3, AlertCircle, ArrowUp, ArrowDown, X, Files } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getLocalCloudSyncStatus, resolveResourceFileConflict, type LocalCloudSyncStatusData } from '../services/apiService';
import { CLOUD_SYNC_EVENT } from '../utils/cloudSyncState';
import { describeBackgroundSync, describeDirectionalSync, formatSyncBytes, compactSyncState } from '../utils/backgroundSyncStatus';
import { SyncDeliveryDetails } from './SyncDeliveryDetails';

export const BackgroundSyncIndicator: React.FC<{ collapsed: boolean; ready: boolean; error: string; onRetry: () => void }> = ({ collapsed, ready, error, onRetry }) => {
  const [status, setStatus] = useState<LocalCloudSyncStatusData | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [openDirection, setOpenDirection] = useState<'upload' | 'download' | null>(null);
  const [pinned, setPinned] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = () => { setOpenDirection(null); setPinned(false); };
    const outside = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); setShowConflicts(false); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--armi-sync-footer-height', `${footer.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--armi-sync-footer-height');
    };
  }, []);
  useEffect(() => startVisiblePanelPolling(async signal => {
    const response = await getLocalCloudSyncStatus({ lightweight: true, signal });
    if (signal.aborted) return;
    if (response.success && response.data) { setStatus(response.data); setConnectionError(''); }
    else setConnectionError('No se pudo comprobar la sincronización. Se reintentará automáticamente.');
  }, 2000, [CLOUD_SYNC_EVENT]), []);
  const view = describeBackgroundSync(status, ready, error || connectionError);
  const directions = describeDirectionalSync(status, ready, error || connectionError);
  const selected = openDirection ? directions[openDirection] : null;
  const [showConflicts, setShowConflicts] = useState(false);
  const [resolving, setResolving] = useState('');
  const [conflictError, setConflictError] = useState('');
  const versionsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!showConflicts) return;
    const before = document.activeElement as HTMLElement | null;
    versionsRef.current?.querySelector<HTMLElement>('button, a')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(versionsRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') || []);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => { document.removeEventListener('keydown', trapFocus); before?.focus(); };
  }, [showConflicts]);
  const conflicts = status?.resourceConflicts || [];
  const chooseVersion = async (id: string, version: 'local' | 'mirror') => {
    setResolving(id); setConflictError('');
    try {
      const result = await resolveResourceFileConflict(id, version);
      if (!result.success) { setConflictError(result.message || 'No se pudo guardar la elecci?n.'); return; }
      setStatus(previous => previous ? { ...previous, resourceConflicts: previous.resourceConflicts?.filter(item => item.id !== id) } : previous);
      window.dispatchEvent(new window.Event(CLOUD_SYNC_EVENT));
    } finally { setResolving(''); }
  };
  const StateIcon = ({ icon }: { icon: string }) => {
    const Icon = icon === 'check' ? CheckCircle2 : icon === 'alert' ? AlertCircle : icon === 'wait' ? Clock3 : RefreshCw;
    return <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${icon === 'sync' ? 'animate-spin motion-reduce:animate-none' : ''} ${icon === 'check' ? 'text-emerald-600' : icon === 'alert' ? 'text-rose-600' : icon === 'wait' ? 'text-amber-600' : 'text-violet-600'}`} />;
  };
  const overallIcon = conflicts.length ? 'wait' : view.tone === 'success' || view.tone === 'local' ? 'check' : view.tone === 'error' ? 'alert' : view.tone === 'warning' ? 'wait' : 'sync';
  const selectedView = selected && openDirection ? compactSyncState(selected, openDirection) : null;
  return <div ref={footerRef} className={`fixed bottom-0 right-0 z-40 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] leading-4 text-slate-600 backdrop-blur print:hidden ${collapsed ? 'left-[6rem]' : 'left-[19rem]'}`}>
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <StateIcon icon={overallIcon} />
      <span role="status" className="truncate">{conflicts.length ? 'Revisar versiones' : view.tone === 'success' ? 'Al día en esta PC' : view.tone === 'local' ? 'Guardado en esta PC' : view.tone === 'busy' ? 'Sincronizando' : view.tone === 'error' ? 'Reintento pendiente' : 'Sincronización pendiente'}</span>
    </div>
    {conflicts.length > 0 && <button type="button" onClick={() => setShowConflicts(true)} className="flex items-center gap-1 rounded bg-amber-50 px-2 py-1 font-semibold text-amber-800"><Files className="h-3.5 w-3.5" />{conflicts.length} recurso{conflicts.length === 1 ? '' : 's'} con dos versiones</button>}
    {view.tone !== 'local' && <div ref={detailsRef} className="relative flex shrink-0 items-center gap-3"
      onMouseLeave={() => { if (!pinned) setOpenDirection(null); }}>
      {(['upload', 'download'] as const).map(direction => {
        const transfer = directions[direction], compact = compactSyncState(transfer, direction);
        const DirectionIcon = direction === 'upload' ? ArrowUp : ArrowDown;
        return <button key={direction} type="button" aria-label={`${direction === 'upload' ? 'Subida' : 'Bajada'}: ${compact.text}${compact.count ? ', ' + compact.count : ''}`}
          aria-haspopup="dialog" aria-controls="armi-sync-transfer-detail" aria-expanded={openDirection === direction}
          onMouseEnter={() => { if (!pinned) setOpenDirection(direction); }}
          onFocus={() => { if (!pinned) setOpenDirection(direction); }}
          onClick={() => { if (pinned && openDirection === direction) { setPinned(false); setOpenDirection(null); } else { setOpenDirection(direction); setPinned(true); } }}
          className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-violet-400">
          <DirectionIcon className="h-3 w-3 text-slate-400" aria-hidden="true" />
          <StateIcon icon={compact.icon} />
          <span className="tabular-nums">{compact.count || (compact.icon === 'check' ? 'Al día' : compact.text)}</span>
        </button>;
      })}
      {selected && selectedView && <div className="absolute bottom-full right-0 z-50 w-72 max-w-[calc(100vw-2rem)] pb-2">
        <div id="armi-sync-transfer-detail" role="dialog" aria-label="Estado de archivos" className="max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl">
          <div className="flex items-center gap-2"><StateIcon icon={selectedView.icon} /><strong className="flex-1 text-slate-800">{selectedView.text}</strong><button type="button" aria-label="Cerrar detalle" onClick={() => { setOpenDirection(null); setPinned(false); }}><X className="h-4 w-4 text-slate-400" /></button></div>
          {selectedView.count && <p className="mt-2 font-medium tabular-nums text-slate-700">{selectedView.count}</p>}
          {selected.percent !== null && selected.total !== null && selected.total > 0 && <div role="progressbar" aria-label={selectedView.text} aria-valuenow={selected.percent} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${selectedView.icon === 'check' ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{width:`${selected.percent}%`}} /></div>}
          {selected.total !== null && selected.completed !== null && selected.total > selected.completed && selected.unit === 'archivos' && <p className="mt-1 text-slate-500">{selected.total - selected.completed} archivos pendientes</p>}
          {selected.files[0] && selected.tone === 'busy' && <p className="mt-2 truncate text-[11px] text-slate-400" title={selected.files[0].name}>{selected.files[0].name}</p>}
          <SyncDeliveryDetails status={status} />
        </div>
      </div>}
    </div>}
    {showConflicts && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-6" onClick={() => setShowConflicts(false)}>
      <section ref={versionsRef} role="dialog" aria-modal="true" aria-label="Recursos con dos versiones" className="max-h-[75vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex justify-between"><h2 className="text-sm font-bold text-slate-900">Recursos con dos versiones</h2><button type="button" aria-label="Cerrar versiones" onClick={() => setShowConflicts(false)}><X className="h-4 w-4" /></button></div>
        <p className="mb-4 text-xs text-slate-500">Elige cuál usar. Ambas quedan respaldadas.</p>
        {conflictError && <p role="alert" className="mb-3 text-xs text-rose-600">{conflictError}</p>}
        {conflicts.length === 0 && <p className="text-sm text-emerald-700">Todo revisado.</p>}
        {conflicts.map(item => <article key={item.id} className="mb-3 rounded-xl border border-amber-100 p-3">
          <h3 className="text-sm font-semibold text-slate-800">{item.title}</h3><p className="truncate text-[10px] text-slate-400" title={item.fileName}>{item.fileName}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">{item.versions.map(version => <div key={version.key} className="rounded-lg bg-slate-50 p-2">
            <strong className="text-xs">{version.label}</strong><p className="text-[10px] text-slate-500">{new Date(version.modifiedAt).toLocaleString('es-CO')} · {formatSyncBytes(version.size)}</p>
            <a className="mt-2 inline-block text-xs text-violet-700 underline" href={`/api/sync/resource-conflicts/${item.id}/${version.key}`} download>Ver archivo</a>
            <button type="button" disabled={!!resolving} onClick={() => void chooseVersion(item.id, version.key)} className="mt-2 block rounded bg-violet-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40">{resolving === item.id ? 'Guardando…' : 'Usar esta versión'}</button>
          </div>)}</div>
        </article>)}
      </section>
    </div>, document.body)}
    {error && <button onClick={onRetry} className="shrink-0 font-semibold text-violet-700 hover:underline">Reintentar</button>}
  </div>;
};
