import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './auth';
import { installWebRuntime, getWebIdentity } from './runtime.js';
import { ImportSnapshot } from './ImportSnapshot';
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
      document.querySelector('#root aside')?.setAttribute('data-armi-web-sidebar', '');
      document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#root main input, #root main select, #root main textarea, #root main button, #root [data-armi-web-sidebar] input[type="file"], #root [data-armi-web-sidebar] button[title="Cambiar foto"]').forEach(control => {
        const supported = getWebIdentity()?.academic?.editable && control.closest('[data-armi-web-editor]') && !control.closest('[data-web-unavailable]') && control.getAttribute('type') !== 'file';
        if (!supported && !control.disabled) control.disabled = true;
      });
      document.querySelectorAll<HTMLElement>('#root main [contenteditable="true"]').forEach(element => { if (!getWebIdentity()?.academic?.editable || !element.closest('[data-armi-web-editor]')) element.contentEditable = 'false'; });
    };
    disableEditing();
    const observer = new MutationObserver(disableEditing);
    observer.observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'contenteditable'] });
    return () => observer.disconnect();
  }, [session]);
  const editable = getWebIdentity()?.academic?.editable;
  return <>{session && <><div className="web-adaptation-notice"><strong>ARMI Docente · Web</strong><span>{editable ? 'Datos generales y registro de estudiantes: guardado web. Los demás módulos siguen en consulta. Drive y sincronización pendientes.' : 'Copia de consulta. Falta activar el guardado web en la base de datos.'}</span><ImportSnapshot /></div>{editable && <div className={`web-save-status ${save.state}`} role="status" aria-live="polite">{save.state === 'saving' ? 'Guardando en la web…' : save.state === 'saved' ? 'Guardado en la web' : save.state === 'error' ? save.message : 'Guardado web disponible'}{save.state === 'error' && <button onClick={() => window.location.reload()}>Recargar</button>}</div>}</>}<App /></>;
}

async function start() {
  // Importar la aplicación después de instalar el transporte y almacenamiento
  // exclusivos de web. El arranque Electron y su index.tsx no se ejecutan aquí.
  const { default: App } = await import('../../App');
  createRoot(document.getElementById('root')!).render(<AuthProvider><WebHost App={App} /></AuthProvider>);
}
start().catch(() => { document.getElementById('root')!.textContent = 'No se pudo cargar ARMI. Recarga la página para reintentar.'; });
