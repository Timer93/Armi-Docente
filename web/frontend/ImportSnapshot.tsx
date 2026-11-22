import React, { useState } from 'react';
import { academicApi } from './academic-client';
import { getWebIdentity } from './runtime.js';

const datasets = ['general', 'students', 'annual', 'units', 'sessions', 'frontend'];
const labels: Record<string, string> = { general: 'Datos generales', students: 'Estudiantes', annual: 'Programaciones', units: 'Unidades', sessions: 'Sesiones', frontend: 'Configuraciones' };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function ImportSnapshot() {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const show = async () => {
    setOpen(true); setMessage('Comprobando tu cuenta…');
    try {
      const status = await academicApi('/api/academic/status');
      setReady(status.ready && !status.hasWebEdits);
      setMessage(status.hasWebEdits ? 'Ya tienes cambios guardados en la web. La importación está bloqueada para conservarlos. La sincronización con el escritorio sigue pendiente.' : status.ready ? (status.snapshotId ? 'Ya tienes una copia activa. La importación completa la reemplazará; los cambios del escritorio no se sincronizan automáticamente.' : 'Selecciona la copia exportada del escritorio para esta cuenta.') : status.message);
    } catch (error) { setMessage((error as Error).message); }
  };
  const selectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setCopy(null); setMessage('Revisando archivo…');
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 20_000_000) throw new Error('La copia supera el límite de 20 MB de esta importación.');
      const data = JSON.parse(await file.text());
      if (data.format !== 'armi-academic-copy' || data.version !== 1 || !Array.isArray(data.rows) || data.rows.length > 10000 || data.ownerUsername !== getWebIdentity()?.user.username) throw new Error('El archivo no corresponde a tu usuario de ARMI o no tiene el formato admitido.');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ownerUsername: data.ownerUsername, rows: data.rows }))))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== data.fingerprint || !data.counts || datasets.some(dataset => data.rows.filter((row: any) => row.dataset === dataset).length !== data.counts[dataset])) throw new Error('La copia está incompleta o cambió después de exportarla.');
      setCopy(data); setMessage('Revisa las cantidades. Se importará únicamente a tu cuenta; la base del escritorio se conserva.');
    } catch (error) { setMessage((error as Error).message); }
  };
  const upload = async () => {
    if (!copy || busy) return;
    setBusy(true);
    try {
      const started = await academicApi('/api/academic/imports', 'POST', { ownerUsername: copy.ownerUsername, fingerprint: copy.fingerprint, counts: copy.counts });
      if (started.status !== 'active') {
        let offset = 0;
        let sequence = 0;
        while (offset < copy.rows.length) {
          const records = [];
          while (offset < copy.rows.length && records.length < 20) {
            const next = copy.rows[offset];
            if (bytes(next) > 320000) throw new Error('Un registro es demasiado grande. Exporta nuevamente la copia.');
            if (records.length && bytes([...records, next]) > 320000) break;
            records.push(next); offset++;
          }
          setMessage(`Importando ${offset} de ${copy.rows.length} registros…`);
          await academicApi(`/api/academic/imports/${started.importId}/chunks`, 'POST', { sequence, records });
          sequence++;
        }
      }
      await academicApi(`/api/academic/imports/${started.importId}/commit`, 'POST', {});
      window.location.reload();
    } catch (error) { setMessage((error as Error).message + ' Puedes reintentar con el mismo archivo; la copia anterior sigue disponible.'); setBusy(false); }
  };
  return <><button type="button" className="web-import-toggle" onClick={() => void show()}>Importar copia</button>{open && <section className="web-import-dialog" role="dialog" aria-modal="false" aria-labelledby="web-import-title">
    <div className="web-import-heading"><h2 id="web-import-title">Datos de mi escritorio</h2><button type="button" disabled={busy} aria-label="Cerrar importación" onClick={() => setOpen(false)}>×</button></div>
    <p>Cuenta: <strong>{getWebIdentity()?.user.username}</strong></p>
    <p>Transfiere tus datos del escritorio a esta cuenta. Solo Datos generales y el registro de estudiantes permiten guardar cambios web; esos cambios todavía no se sincronizan con el escritorio.</p>
    <label htmlFor="academic-copy-file">Archivo de copia de ARMI (.json)</label><input id="academic-copy-file" type="file" accept=".json,application/json" disabled={!ready || busy} onChange={event => void selectFile(event)} />
    {copy && <dl>{datasets.map(dataset => <div key={dataset}><dt>{labels[dataset]}</dt><dd>{copy.counts[dataset]}</dd></div>)}</dl>}
    <p role="status">{message}</p>
    {!ready && <button type="button" className="web-import-toggle" onClick={() => void show()}>Volver a comprobar</button>}
    <button type="button" className="web-import-confirm" disabled={!ready || !copy || busy} onClick={() => void upload()}>{busy ? 'Importando…' : 'Importar a mi cuenta'}</button>
  </section>}</>;
}
