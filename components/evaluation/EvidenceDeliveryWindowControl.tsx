import React, { useEffect, useState } from 'react';
import { getEvidenceDeliveryWindow, resetEvidenceDeliveryWindow, saveEvidenceDeliveryWindow } from '../../services/apiService';

const toLocalInput = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

type Props = {
  sessionId: string;
  sessionLabel: string;
};

export const EvidenceDeliveryWindowControl: React.FC<Props> = ({ sessionId, sessionLabel }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [openFrom, setOpenFrom] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [message, setMessage] = useState('');
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let active = true;
    if (!sessionId) return;
    setLoading(true);
    setMessage('');
    getEvidenceDeliveryWindow(sessionId).then((result) => {
      if (!active) return;
      if (result.success) {
        setConfigured(!!result.data?.explicit);
        setEnabled(result.data?.explicit ? !!result.data?.enabled : true);
        setOpenFrom(toLocalInput(result.data?.explicit?.open_from || result.data?.openAt));
        setCloseAt(toLocalInput(result.data?.explicit?.close_at || result.data?.closeAt));
      } else {
        setMessage(result.message || 'No se pudo leer el plazo de entrega.');
      }
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sessionId]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    const result = await saveEvidenceDeliveryWindow(sessionId, {
      enabled,
      exceptional: true,
      openFrom,
      closeAt
    });
    setSaving(false);
    setMessage(result.success
      ? (enabled ? 'Plazo excepcional guardado. Ya se refleja en el portal del estudiante.' : 'La recepción de esta sesión quedó cerrada.')
      : (result.message || 'No se pudo guardar el plazo.'));
    if (result.success) setConfigured(true);
  };

  const reset = async () => {
    setSaving(true);
    const result = await resetEvidenceDeliveryWindow(sessionId);
    setSaving(false);
    if (result.success) {
      setConfigured(false);
      setEnabled(true);
      setMessage('Se restauró la disponibilidad automática según la semana de la sesión.');
    } else {
      setMessage(result.message || 'No se pudo restaurar la disponibilidad automática.');
    }
  };

  return (
    <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-violet-600">Disponibilidad excepcional</p>
          <h3 className="mt-1 text-xs font-black text-slate-800">{sessionLabel}</h3>
          <p className="mt-1 text-[10px] font-semibold leading-relaxed text-slate-500">Fuera de su semana, esta sesión solo aparecerá como entregable durante el plazo indicado.</p>
        </div>
        <label className="m-0 flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-violet-700">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Recibir
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="m-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
          Apertura
          <input type="datetime-local" value={openFrom} onChange={(event) => setOpenFrom(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700" />
        </label>
        <label className="m-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
          Cierre
          <input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700" />
        </label>
      </div>
      <button type="button" onClick={save} disabled={loading || saving || !openFrom || !closeAt} className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 text-[9px] font-black uppercase tracking-widest text-white hover:bg-violet-700 disabled:opacity-50">
        {saving ? 'Guardando...' : enabled ? 'Guardar plazo excepcional' : 'Cerrar recepción de esta sesión'}
      </button>
      {configured ? (
        <button type="button" onClick={reset} disabled={saving} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Restaurar disponibilidad semanal automática
        </button>
      ) : null}
      {message ? <p className="mt-3 text-[10px] font-bold text-slate-600">{message}</p> : null}
    </div>
  );
};
