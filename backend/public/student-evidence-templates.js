(() => {
  let overlay;
  window.armiEvidenceTemplates={open(config){
    if(overlay)return;
    overlay=document.createElement('div');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Desarrollar plantilla de evidencia');overlay.style.cssText='position:fixed;inset:0;z-index:15000;background:#fff';
    const frame=document.createElement('iframe');frame.title='Plantilla de evidencia';frame.style.cssText='width:100%;height:100%;border:0';
    const previous=document.activeElement;
    const loading=document.createElement('div');loading.setAttribute('role','status');loading.style.cssText='position:absolute;inset:0;display:grid;place-content:center;gap:16px;text-align:center;padding:24px;background:#f8fafc;color:#334155;font:16px system-ui';
    const message=document.createElement('p');message.textContent='Abriendo plantilla de evidencia…';
    const close=document.createElement('button');close.type='button';close.textContent='Volver al portal';close.style.cssText='padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:white;color:#5b35cc;cursor:pointer';loading.append(message,close);
    let timeout;
    const dismiss=()=>{clearTimeout(timeout);overlay?.remove();overlay=null;removeEventListener('message',receive);previous?.focus();};
    close.onclick=dismiss;
    const receive=event=>{if(event.source!==frame.contentWindow || event.origin!==location.origin)return;if(event.data?.type==='armi-workspace-ready'){clearTimeout(timeout);loading.remove();frame.contentWindow.postMessage({type:'armi-workspace-init',...config},location.origin);}if(event.data?.type==='armi-workspace-close')dismiss();};
    timeout=setTimeout(()=>{message.textContent='No se pudo abrir el editor. Vuelve al portal e inténtalo de nuevo. Si continúa, actualiza ARMI Docente.';},12000);
    addEventListener('message',receive);frame.src='/estudiante-assets/evidence-workspace.html';overlay.append(frame,loading);document.body.append(overlay);close.focus();
  }};
})();
