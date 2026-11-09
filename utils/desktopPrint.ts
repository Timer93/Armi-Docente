// Route every existing window.print() through the desktop preview. In a normal
// browser window.print keeps its native behavior.
export const installDesktopPrint = () => {
  if (!window.armiApp?.previewPrint) return () => {};
  const original = window.print;
  let busy = false;
  const style = document.createElement('style');
  style.textContent = `.armi-print-preparing{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);color:white;font:600 18px system-ui}.armi-print-preparing span{padding:24px;border-radius:20px;background:#312e81}@media print{.armi-print-preparing{display:none!important}}`;
  document.head.appendChild(style);
  const print = () => {
    if (busy) return;
    busy = true;
    const title = document.title;
    const overlay = document.createElement('div');
    overlay.className = 'armi-print-preparing'; overlay.setAttribute('role', 'status');
    const message = document.createElement('span'); message.textContent = 'Preparando vista previa…';
    overlay.appendChild(message); document.body.appendChild(overlay);
    void window.armiApp!.previewPrint!({ title }).then(result => {
      if (!result?.success) window.alert(result?.message || 'No se pudo preparar la vista previa.');
    }).catch(() => window.alert('No se pudo preparar la vista previa. Vuelve a intentarlo.'))
      .finally(() => { overlay.remove(); busy = false; });
  };
  window.print = print;
  const unsubscribe = window.armiApp.onPrintRequest?.(print);
  return () => { window.print = original; unsubscribe?.(); style.remove(); };
};
