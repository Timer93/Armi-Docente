import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './auth';
import { installWebRuntime, getWebIdentity } from './runtime.js';
import { ImportSnapshot } from './ImportSnapshot';
import {PortalPanel} from './PortalPanel';
import './web.css';
import '../../index.css';

installWebRuntime(window);

function WebHost({ App }: { App: React.ComponentType }) {
  const { session } = useAuth();
  const [save, setSave] = useState({state:'idle',message:''});
  useEffect(() => {
    const listener = (event: Event) => setSave((event as CustomEvent).detail);
    window.addEventListener('armi-web-save', listener);
    return () => window.removeEventListener('armi-web-save', listener);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('armi-web-session', Boolean(session));
    if (!session) return;
    // Solo los módulos conectados a D1 admiten escritura. Nunca reactivar un
    // control deshabilitado por React (p. ej. mientras elimina un estudiante).
    const disableEditing = () => {
      const permits = (element: Element) => {
        const editor = element.closest('[data-armi-web-editor]')?.getAttribute('data-armi-web-editor');
        return Boolean(editor && (editor==='evaluation'?getWebIdentity()?.academic?.evaluationEditable:editor==='instruments'?getWebIdentity()?.academic?.instrumentsEditable:editor==='settings'?getWebIdentity()?.academic?.settingsEditable:['annual','units','sessions'].includes(editor) ? getWebIdentity()?.academic?.planningEditable : getWebIdentity()?.academic?.editable));
      };
      document.querySelector('#root aside')?.setAttribute('data-armi-web-sidebar', '');
      document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#root main input, #root main select, #root main textarea, #root main button, [data-armi-web-editor] input, [data-armi-web-editor] select, [data-armi-web-editor] textarea, [data-armi-web-editor] button, #root [data-armi-web-sidebar] input[type="file"], #root [data-armi-web-sidebar] button[title="Cambiar foto"]').forEach(control => {
        const label = `${control.getAttribute('title') || ''} ${control.getAttribute('aria-label') || ''} ${control.tagName === 'BUTTON' ? control.textContent : ''}`;
        const aiControl=/\bIA\b/i.test(label)&&!/imagen|visual|audio/i.test(label);
        const editor=control.closest('[data-armi-web-editor]')?.getAttribute('data-armi-web-editor')||'';
        const unavailableEvaluationAction=editor==='evaluation'&&/evidencia|archivo|adjuntar|plazo|subir|descargar|plantilla|foto/i.test(label);
        const unavailablePlanningAction = ['annual','units','sessions'].includes(editor) && !aiControl && (/plantilla|correspondencia|\bword\b|excel|\bpdf\b|descargar|subir|adjuntar|importar|generar/i.test(label)||(!getWebIdentity()?.academic?.evaluationEditable&&/calificaci[oó]n/i.test(label)));
        const unavailablePin = !getWebIdentity()?.academic?.settingsEditable && /fijar|desfijar/i.test(label);
        const unavailableSettingsExport=control.closest('[data-armi-web-editor]')?.getAttribute('data-armi-web-editor')==='settings' && /\bword\b|excel|descargar|plantilla|\bIA\b/i.test(label);
        const supported = permits(control) && !control.closest('[data-web-unavailable]') && control.getAttribute('type') !== 'file' && !unavailableEvaluationAction && !unavailablePlanningAction && !unavailablePin && !unavailableSettingsExport;
        if (!supported && !control.disabled) control.disabled = true;
      });
      document.querySelectorAll<HTMLElement>('#root main [contenteditable="true"]').forEach(element => { if (!permits(element) || element.closest('[data-web-unavailable]')) element.contentEditable = 'false'; });
    };
    disableEditing();
    const observer = new MutationObserver(disableEditing);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'contenteditable'] });
    return () => observer.disconnect();
  }, [session]);
  const editable = getWebIdentity()?.academic?.editable;
  const planning = getWebIdentity()?.academic?.planningEditable;
  const settings=getWebIdentity()?.academic?.settingsEditable;
  return <>{session && <><div className="web-adaptation-notice"><strong>ARMI Docente · Web</strong><span>{settings?'Guardado por cuenta en la web. Archivos, Drive y sincronización con escritorio pendientes.':planning ? 'Guardado web: Programación, Unidades y Sesiones. Archivos, Drive y sincronización pendientes.' : editable ? 'Datos generales y registro de estudiantes: guardado web. Falta activar el guardado de planificación. Drive y sincronización pendientes.' : 'Copia de consulta. Falta activar el guardado web en la base de datos.'}</span><ImportSnapshot /><PortalPanel /></div>{(editable || planning || settings) && <div className={`web-save-status ${save.state}`} role="status" aria-live="polite">{save.state === 'pending'?'Cambios pendientes de guardar':save.state === 'saving' ? 'Guardando en la web…' : save.state === 'saved' ? 'Guardado en la web' : save.state === 'error' ? save.message : 'Guardado web disponible'}{save.state === 'error' && <button onClick={() => window.location.reload()}>Recargar</button>}</div>}</>}<App /></>;
}

async function start() {
  // Importar la aplicación después de instalar el transporte y almacenamiento
  // exclusivos de web. El arranque Electron y su index.tsx no se ejecutan aquí.
  const { default: App } = await import('../../App');
  createRoot(document.getElementById('root')!).render(<AuthProvider><WebHost App={App} /></AuthProvider>);
}
start().catch(() => { document.getElementById('root')!.textContent = 'No se pudo cargar ARMI. Recarga la página para reintentar.'; });
