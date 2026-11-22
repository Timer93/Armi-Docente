import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResponsablesSection, type ResponsablesData } from '../../components/shared/ResponsablesSection';

type RecordData = { values: ResponsablesData; revision: number };
type Api = (path: string, method?: string, body?: unknown) => Promise<RecordData>;
const endpoint = '/api/datos-generales/responsables';

function Responsables({ api }: { api: Api }) {
  const [record, setRecord] = useState<RecordData | null>(null);
  const [values, setValues] = useState<ResponsablesData | null>(null);
  const [message, setMessage] = useState('Cargando responsables…');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const active = useRef(true);
  const load = async () => {
    setBusy(true); setSaved(false); setMessage('Cargando responsables…');
    try {
      const data = await api(endpoint);
      if (!active.current) return;
      setRecord(data); setValues(data.values); setMessage('');
    } catch (error) { if (active.current) setMessage((error as Error).message); }
    finally { if (active.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, []);
  const dirty = Boolean(record && values && JSON.stringify(record.values) !== JSON.stringify(values));
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (dirty) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const save = async () => {
    if (!record || !values || busy) return;
    setBusy(true); setSaved(false); setMessage('Guardando…');
    try {
      const data = await api(endpoint, 'PUT', { values, revision: record.revision });
      if (!active.current) return;
      setRecord(data); setValues(data.values); setSaved(true); setMessage('Los responsables se guardaron en tu cuenta web.');
    } catch (error) { if (active.current) setMessage((error as Error).message); }
    finally { if (active.current) setBusy(false); }
  };
  return <div>
    <div className="shared-module-title"><div><p className="eyebrow">DATOS GENERALES</p><h2>Responsables</h2></div><button type="button" className="secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm('Hay cambios sin guardar. ¿Quieres descartarlos y recargar?')) void load(); }}>Recargar</button></div>
    <p className="muted shared-module-note">Estos datos se guardan por docente en la web. La sincronización con el escritorio todavía no está habilitada.</p>
    {values && <ResponsablesSection value={values} disabled={busy} maxLength={200} onChange={event => { const { name, value } = event.target; setValues(current => ({ ...current!, [name]: value })); setSaved(false); setMessage(''); }} />}
    <div className="shared-module-actions">{values && <button className="primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar responsables'}</button>}<p role="status" className={`message${saved ? ' success' : ''}`}>{message || (dirty ? 'Tienes cambios sin guardar.' : '')}</p></div>
  </div>;
}

export function mountResponsables(element: HTMLElement, api: Api) {
  const root = createRoot(element);
  root.render(<Responsables api={api} />);
  return () => root.unmount();
}
