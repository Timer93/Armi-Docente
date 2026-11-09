import React, { useEffect, useRef, useState } from 'react';
import {usePanelPolling} from './usePanelPolling';
import {useAccessAutosave} from './useAccessAutosave';
import {StudentAgentPanel} from './StudentAgentPanel';
import { requestAccessControl, requestExtensionAction, type AccessConfig, type AccessRule, type AccessSnapshot, type AccessExtensionStatus, type StudentAgentStatus } from '../services/accessControl';

const newRule = (): AccessRule => ({ id: crypto.randomUUID(), name: '', domains: [], scope: 'all', groupId: null, deviceIds: [], enabled: true });
const inputStyle = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const smallButton = 'rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40';

export function AccessControlView() {
  const {snapshot,dirty,saving,saveError,change:changeConfig,accept,flush,reload:reloadSaved}=useAccessAutosave();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [groupName, setGroupName] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [deviceGroup, setDeviceGroup] = useState('');
  const [editing, setEditing] = useState<AccessRule>(newRule);
  const [domainsText, setDomainsText] = useState('');
  const [extension, setExtension] = useState<AccessExtensionStatus>({ devices: [], serverUrls: [], downloadUrl: '/extensions/ARMI-Estudiantes.zip' });
  const [extensionError, setExtensionError] = useState('');
  const [pairing, setPairing] = useState<{ deviceId: string; code: string; expiresAt: string } | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [agentStatus,setAgentStatus]=useState<StudentAgentStatus|null>(null);
  const mounted=useRef(false);
  const requestScope=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;const controller=new AbortController();requestScope.current=controller;return()=>{mounted.current=false;controller.abort();};},[]);
  const acceptAgentStatus=(value:StudentAgentStatus,startedAt:number)=>{setAgentStatus(value);if(value.snapshot)accept(value.snapshot,startedAt);};
  const refreshExtension = async (signal?:AbortSignal) => {
    if(!mounted.current||signal?.aborted)return;
    const scoped=signal?AbortSignal.any([signal,requestScope.current!.signal]):requestScope.current!.signal;
    try { const value=await requestExtensionAction<AccessExtensionStatus>('extension','GET',scoped);if(!mounted.current||scoped.aborted)return;setExtension(value); setExtensionError(''); }
    catch { if(mounted.current&&!scoped.aborted)setExtensionError('No se pudo consultar la conexión de las extensiones. Comprueba que ARMI esté actualizado.'); }
  };
  usePanelPolling(refreshExtension,15000);
  const config = snapshot?.config;
  const change=(next:AccessConfig)=>{changeConfig(next);setMessage('');setError('');};
  const reload=async()=>{try{await reloadSaved();void refreshExtension();}catch(e){setError((e as Error).message);}};
  const save=()=>void flush().catch(()=>{});
  const editRule = (rule: AccessRule) => { setEditing({ ...rule, deviceIds: [...rule.deviceIds] }); setDomainsText(rule.domains.join('\n')); };
  const resetRule = () => { setEditing(newRule()); setDomainsText(''); };
  const addRule = (event: React.FormEvent) => {
    event.preventDefault();
    if (!config) return;
    const values = domainsText.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
    const domains: string[] = [];
    try {
      for (const value of values) {
        const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname.includes('.')) throw new Error();
        domains.push(url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''));
      }
    } catch { setError('Revisa los dominios: por ejemplo, youtube.com o https://www.facebook.com.'); return; }
    if (!domains.length || (editing.scope === 'group' && !editing.groupId) || (editing.scope === 'devices' && !editing.deviceIds.length)) {
      setError('Añade dominios y selecciona a quién se aplicará la regla.'); return;
    }
    const rule: AccessRule = { ...editing, name: editing.name.trim(), domains: [...new Set(domains)],
      groupId: editing.scope === 'group' ? editing.groupId : null, deviceIds: editing.scope === 'devices' ? editing.deviceIds : [] };
    change({ ...config, rules: [...config.rules.filter(row => row.id !== rule.id), rule] });
    resetRule();
  };
  const targetLabel = (rule: AccessRule) => rule.scope === 'all' ? 'Todos los equipos'
    : rule.scope === 'group' ? config?.groups.find(row => row.id === rule.groupId)?.name || 'Grupo'
      : rule.deviceIds.map(id => config?.devices.find(row => row.id === id)?.name || 'Equipo').join(', ');
  const pairingAction = async (deviceId: string) => {
    setPairingBusy(true); setError('');
    try { setPairing(await requestExtensionAction<{deviceId:string;code:string;expiresAt:string}>(`devices/${encodeURIComponent(deviceId)}/pairing`, 'POST')); }
    catch (e) { setError((e as Error).message); }
    finally { setPairingBusy(false); }
  };
  const revokeDevice = async (deviceId: string) => {
    if (!window.confirm('¿Retirar la vinculación de este equipo? Su extensión liberará el bloqueo cuando vuelva a comunicarse con esta PC.')) return;
    setPairingBusy(true);
    try { await requestExtensionAction(`devices/${encodeURIComponent(deviceId)}/revoke`, 'POST'); if (pairing?.deviceId === deviceId) setPairing(null); await refreshExtension(); }
    catch (e) { setError((e as Error).message); }
    finally { setPairingBusy(false); }
  };
  const ruleStatus = (rule: AccessRule) => {
    if (!rule.enabled) return 'Deshabilitada';
    const targets = config?.devices.filter(device => rule.scope === 'all' || (rule.scope === 'group' ? device.groupId === rule.groupId : rule.deviceIds.includes(device.id))) || [];
    if (!targets.length) return 'Sin equipos asignados';
    const confirmed = targets.filter(device => extension.devices.some(state => state.deviceId === device.id && state.online && state.state === 'applied')||agentStatus?.devices.some(state=>state.deviceId===device.id&&state.online&&state.state==='configured'&&state.navigationState==='configured')).length;
    return `${confirmed}/${targets.length} equipos confirmados`;
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="sticky top-0 z-20 flex flex-wrap items-end justify-between gap-4 rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur">
      <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Administrador</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-800">Control de acceso</h1>
        <p className="mt-2 text-sm text-slate-500">Organiza los equipos y configura las páginas bloqueadas por equipo o grupo.</p>
      </div>
      <div className="flex items-center gap-2"><button className={smallButton} onClick={reload} disabled={saving}>Recargar</button>
        <span role="status" aria-label="Estado del guardado" className={`rounded-full px-3 py-2 text-xs font-semibold ${saveError?'bg-red-50 text-red-700':dirty||saving?'bg-amber-50 text-amber-800':'bg-emerald-50 text-emerald-800'}`}>{saving?'Guardando\u2026':saveError?'No se pudo guardar':dirty?'Cambios pendientes':'Guardado autom\u00e1tico'}</span>
        {saveError&&<button onClick={save} className={smallButton}>Reintentar guardado</button>}</div>
    </header>
    {config && <StudentAgentPanel config={config} dirty={dirty} onChange={change} onReload={()=>void reload()} onStatus={acceptAgentStatus}/>}
    <details className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold text-slate-700">Complemento de navegador y vinculación manual (opcional)</summary>
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>Extensión ARMI Estudiantes.</strong> Instálala en cada navegador, guarda el equipo y genera su código de vinculación.</div>
        <a className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white" href={extension.downloadUrl} download>Descargar extensión</a></div>
      <p className="mt-3 text-xs">Los equipos consultan las reglas aproximadamente cada 30 segundos. Si pierden conexión, conservan el último bloqueo. La vinculación corresponde a esta PC docente.</p>
      {extension.serverUrls.length > 0 && <div className="mt-3"><p className="text-xs font-semibold">Dirección de ARMI para las PCs de estudiantes en la misma red:</p>{extension.serverUrls.map(url => <code className="mr-3 inline-block select-all pt-1 text-sm" key={url}>{url}</code>)}</div>}
    </div>
    {extensionError && <p className="text-sm text-amber-800" role="status">{extensionError}</p>}
    {pairing && <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950" aria-label="Código de vinculación">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">Vincular {config?.devices.find(device => device.id === pairing.deviceId)?.name}</h2><p className="mt-1 text-sm">En la extensión de ese equipo, escribe la dirección de ARMI y este código de un solo uso:</p><p className="my-3 select-all font-mono text-2xl font-black tracking-widest">{pairing.code}</p><p className="text-xs">Vence a las {new Date(pairing.expiresAt).toLocaleTimeString('es-PE')}. Un código nuevo sustituye al anterior de este equipo.</p></div><button className={smallButton} onClick={() => setPairing(null)}>Cerrar</button></div>
    </section>}
    </details>
    {(error||saveError) && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error||saveError}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {!config ? <p className="p-6 text-sm text-slate-500">{error ? 'Usa Recargar para volver a intentar.' : 'Cargando control de acceso…'}</p> : <fieldset className="min-w-0 space-y-6">
      <details className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold text-slate-700">Organizar grupos y registros manuales</summary>
      <div className="grid gap-4 sm:grid-cols-3">
        {[['Grupos', config.groups.length], ['Registros guardados', config.devices.length], ['Reglas habilitadas', config.rules.filter(rule => rule.enabled).length]].map(([label, count]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-black text-slate-800">{count}</p></div>)}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-800">Grupos</h2><p className="mt-1 text-sm text-slate-500">Por ejemplo: 3.º U, 5.º A o Centro de cómputo.</p>
          <form className="mt-4 flex gap-2" onSubmit={event => { event.preventDefault(); change({ ...config, groups: [...config.groups, { id: crypto.randomUUID(), name: groupName.trim() }] }); setGroupName(''); }}>
            <input aria-label="Nombre del grupo" required maxLength={100} pattern=".*\S.*" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Nombre del grupo" className={inputStyle} />
            <button className="rounded-xl bg-slate-800 px-4 text-sm font-bold text-white">Añadir</button>
          </form>
          <ul className="mt-4 divide-y divide-slate-100">{config.groups.map(group => <li key={group.id} className="flex items-center justify-between gap-3 py-3"><span className="text-sm font-semibold text-slate-700">{group.name}</span><button className={smallButton} onClick={() => {
            if (config.devices.some(row => row.groupId === group.id) || config.rules.some(row => row.groupId === group.id)) { setError('Primero reasigna los equipos y las reglas de ese grupo.'); return; }
            change({ ...config, groups: config.groups.filter(row => row.id !== group.id) });
          }}>Eliminar</button></li>)}</ul>
          {!config.groups.length && <p className="mt-4 text-sm text-slate-400">Todavía no hay grupos registrados.</p>}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-800">Equipos</h2><p className="mt-1 text-sm text-slate-500">Opciones manuales del complemento de navegador. El estado del agente se muestra arriba.</p>
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); change({ ...config, devices: [...config.devices, { id: crypto.randomUUID(), name: deviceName.trim(), groupId: deviceGroup || null }] }); setDeviceName(''); }}>
            <input aria-label="Nombre del equipo" required pattern=".*\S.*" maxLength={100} value={deviceName} onChange={e => setDeviceName(e.target.value)} placeholder="Ej.: PC estudiante 01" className={`${inputStyle} flex-1`} />
            <select aria-label="Grupo del nuevo equipo" value={deviceGroup} onChange={e => setDeviceGroup(e.target.value)} className={`${inputStyle} sm:!w-40`}><option value="">Sin grupo</option>{config.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
            <button className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white">Registrar</button>
          </form>
          <ul className="mt-4 divide-y divide-slate-100">{config.devices.map(device => <li key={device.id} className="flex flex-wrap items-center gap-2 py-3">
            <div className="min-w-28 flex-1"><p className="text-sm font-semibold text-slate-700">{device.name}</p><p className="mt-1 text-xs text-amber-700">Navegador: {(() => { const state = extension.devices.find(row => row.deviceId === device.id); return !state?.paired ? 'Pendiente de vincular' : !state.online ? 'Sin conexión' : state.state === 'applied' ? `Reglas aplicadas · ${state.blockedCount} dominios` : state.state === 'error' ? 'Error al aplicar reglas' : 'Actualización pendiente'; })()}</p>
              {extension.devices.find(row => row.deviceId === device.id)?.error && <p className="mt-1 text-xs text-red-700">{extension.devices.find(row => row.deviceId === device.id)?.error}</p>}
            </div>
            <select aria-label={`Grupo de ${device.name}`} value={device.groupId || ''} onChange={e => change({ ...config, devices: config.devices.map(row => row.id === device.id ? { ...row, groupId: e.target.value || null } : row) })} className={`${inputStyle} !w-36`}><option value="">Sin grupo</option>{config.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
            <button className={smallButton} onClick={() => { if (config.rules.some(rule => rule.deviceIds.includes(device.id))) { setError('Primero retira este equipo de sus reglas individuales.'); return; } change({ ...config, devices: config.devices.filter(row => row.id !== device.id) }); }}>Eliminar</button>
            <button className={`${smallButton} !text-emerald-700`} disabled={dirty || pairingBusy} title={dirty ? 'Guarda los cambios antes de vincular.' : ''} onClick={() => void pairingAction(device.id)}>Generar código</button>
            {extension.devices.some(row => row.deviceId === device.id && row.paired) && <button className={`${smallButton} !text-red-700`} disabled={pairingBusy} onClick={() => void revokeDevice(device.id)}>Desvincular</button>}
          </li>)}</ul>
          {!config.devices.length && <p className="mt-4 text-sm text-slate-400">Todavía no hay equipos registrados.</p>}
        </section>
      </div>
      </details>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
        <h2 className="text-lg font-bold text-slate-800">Páginas bloqueadas</h2>
        <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)]">
          <form onSubmit={addRule} className="space-y-4 rounded-xl bg-slate-50 p-4">
            <h3 className="font-bold text-slate-700">{config.rules.some(rule => rule.id === editing.id) ? 'Editar regla' : 'Nueva regla'}</h3>
            <label className="block text-sm font-semibold text-slate-600">Nombre<input required maxLength={100} pattern=".*\S.*" className={`${inputStyle} mt-1`} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ej.: Redes sociales durante la sesión" /></label>
            <label className="block text-sm font-semibold text-slate-600">Dominios<textarea required rows={4} value={domainsText} onChange={e => setDomainsText(e.target.value)} placeholder={'facebook.com\ntiktok.com'} className={`${inputStyle} mt-1`} /></label>
            <p className="text-xs text-slate-500">Uno por línea. Una dirección completa se convierte a su dominio; la regla incluirá sus subdominios.</p>
            <label className="block text-sm font-semibold text-slate-600">Aplicar a<select className={`${inputStyle} mt-1`} value={editing.scope} onChange={e => setEditing({ ...editing, scope: e.target.value as AccessRule['scope'] })}><option value="all">Todos los equipos</option><option value="group">Un grupo</option><option value="devices">Equipos seleccionados</option></select></label>
            {editing.scope === 'group' && <select aria-label="Grupo de la regla" required value={editing.groupId || ''} className={inputStyle} onChange={e => setEditing({ ...editing, groupId: e.target.value })}><option value="">Selecciona un grupo</option>{config.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
            {editing.scope === 'devices' && <div className="max-h-40 space-y-2 overflow-auto rounded-xl border border-slate-200 bg-white p-3" aria-label="Equipos de la regla">{config.devices.length ? config.devices.map(device => <label key={device.id} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editing.deviceIds.includes(device.id)} onChange={e => setEditing({ ...editing, deviceIds: e.target.checked ? [...editing.deviceIds, device.id] : editing.deviceIds.filter(id => id !== device.id) })} />{device.name}</label>) : <p className="text-sm text-slate-500">Registra primero los equipos.</p>}</div>}
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />Regla habilitada</label>
            <div className="flex flex-wrap gap-2"><button className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white">{config.rules.some(rule => rule.id === editing.id) ? 'Actualizar regla' : 'Añadir regla'}</button><button type="button" className={smallButton} onClick={resetRule}>Limpiar formulario</button></div>
            <p className="text-xs text-slate-500">Las reglas se guardan automáticamente al añadirlas o modificarlas.</p>
          </form>
          <div className="space-y-3">{config.rules.map(rule => <article key={rule.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-slate-800">{rule.name}</h3><p className="mt-1 text-sm text-slate-500">{targetLabel(rule)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${rule.enabled ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{ruleStatus(rule)}</span></div>
            <div className="mt-3 flex flex-wrap gap-1.5">{rule.domains.map(domain => <span key={domain} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">{domain}</span>)}</div>
            <div className="mt-3 flex flex-wrap gap-1"><button className={smallButton} onClick={() => editRule(rule)}>Editar</button><button className={smallButton} onClick={() => change({ ...config, rules: config.rules.map(row => row.id === rule.id ? { ...row, enabled: !row.enabled } : row) })}>{rule.enabled ? 'Deshabilitar' : 'Habilitar'}</button><button className={`${smallButton} !text-red-600`} onClick={() => { change({ ...config, rules: config.rules.filter(row => row.id !== rule.id) }); if (editing.id === rule.id) resetRule(); }}>Eliminar</button></div>
          </article>)}{!config.rules.length && <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center"><p className="font-semibold text-slate-600">Todavía no hay reglas de bloqueo.</p><p className="mt-2 text-sm text-slate-400">Crea una regla para todos los equipos, un grupo o PCs seleccionadas.</p></div>}</div>
        </div>
      </section>
      <p className="text-xs text-slate-500" role="status">{dirty ? 'Guardado automático pendiente.' : snapshot.updatedAt ? `Último guardado: ${new Date(snapshot.updatedAt).toLocaleString('es-PE')}` : 'La configuración todavía no tiene cambios guardados.'}</p>
    </fieldset>}
  </div>;
}
