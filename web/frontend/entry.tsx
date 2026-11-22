import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './auth';
import { installWebRuntime } from './runtime.js';
import { ImportSnapshot } from './ImportSnapshot';
import './web.css';
import '../../index.css';

installWebRuntime(window);

function WebHost({ App }: { App: React.ComponentType }) {
  const { session } = useAuth();
  useEffect(() => {
    document.body.classList.toggle('armi-web-session', Boolean(session));
    if (!session) return;
    // La navegación original sigue disponible. Los controles del contenido no
    // permiten simular un guardado antes de adaptar los servicios del servidor.
    const disableEditing = () => {
      document.querySelector('#root aside')?.setAttribute('data-armi-web-sidebar', '');
      document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#root main input, #root main select, #root main textarea, #root main button, #root [data-armi-web-sidebar] input[type="file"], #root [data-armi-web-sidebar] button[title="Cambiar foto"]').forEach(control => { if (!control.disabled) control.disabled = true; });
      document.querySelectorAll<HTMLElement>('#root main [contenteditable="true"]').forEach(element => { element.contentEditable = 'false'; });
    };
    disableEditing();
    const observer = new MutationObserver(disableEditing);
    observer.observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'contenteditable'] });
    return () => observer.disconnect();
  }, [session]);
  return <>{session && <div className="web-adaptation-notice"><strong>ARMI Docente · Web</strong><span>Consulta de copias por cuenta. El guardado académico, Drive y la sincronización todavía están pendientes.</span><ImportSnapshot /></div>}<App /></>;
}

async function start() {
  // Importar la aplicación después de instalar el transporte y almacenamiento
  // exclusivos de web. El arranque Electron y su index.tsx no se ejecutan aquí.
  const { default: App } = await import('../../App');
  createRoot(document.getElementById('root')!).render(<AuthProvider><WebHost App={App} /></AuthProvider>);
}
start().catch(() => { document.getElementById('root')!.textContent = 'No se pudo cargar ARMI. Recarga la página para reintentar.'; });
