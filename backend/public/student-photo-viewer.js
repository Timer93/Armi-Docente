(() => {
  'use strict';
  let active;
  const open = async (options) => {
    active?.close();
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'armi-photo-dialog';
    dialog.setAttribute('aria-label', 'Foto de perfil del estudiante');
    dialog.innerHTML = `<div class="armi-photo-card"><div class="armi-photo-orbit"><div class="armi-photo-ring"></div><div class="armi-photo-sparks">${Array.from({length:12},(_,i)=>`<i style="--spark:${i}"></i>`).join('')}</div><div class="armi-photo-face"><span></span><img hidden alt=""></div></div><h2></h2><p class="armi-photo-status" role="status" aria-live="polite"></p><div class="armi-photo-actions"><button type="button" aria-label="Descargar imagen" title="Descargar imagen" disabled><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg></button><button type="button" aria-label="Reemplazar imagen" title="Reemplazar imagen"><svg viewBox="0 0 24 24"><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></svg></button></div><small>Haz clic fuera de la imagen o pulsa Esc para cerrar</small><input type="file" accept="image/jpeg,image/png,image/webp" hidden></div>`;
    const [download, replace] = dialog.querySelectorAll('button');
    const image = dialog.querySelector('img'), status = dialog.querySelector('[role="status"]'), input = dialog.querySelector('input');
    dialog.querySelector('h2').textContent = options.name || 'Estudiante';
    dialog.querySelector('.armi-photo-face span').textContent = (options.name || 'E').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    image.alt = `Foto de ${options.name || 'estudiante'}`;
    image.onerror = () => {image.hidden=true;download.disabled=true;status.textContent='No se pudo mostrar esta foto.';};
    replace.disabled = !options.replace;
    if (!options.replace) replace.title = 'Solo puedes reemplazar tu propia foto';
    let blob, objectUrl, closed = false, busy = false;
    const close = () => { if(closed)return; closed=true; dialog.close(); dialog.remove(); if(objectUrl)URL.revokeObjectURL(objectUrl); if(active?.dialog===dialog)active=null; if(previousFocus?.isConnected)previousFocus.focus(); };
    active = { close, dialog };
    dialog.addEventListener('close', close);
    dialog.addEventListener('click', event => { if(event.target===dialog)close(); });
    const show = async (source) => {
      status.textContent = 'Cargando foto…';
      try {
        const response = await fetch(source, {headers:options.headers || {}, cache:'no-store'});
        if(response.status===204 || response.status===404){status.textContent='Todavía no hay foto de perfil.';return;}
        if(!response.ok)throw new Error('No se pudo cargar la foto.');
        const next = await response.blob();
        if(!next.type.startsWith('image/'))throw new Error('No se pudo cargar la foto.');
        if(closed)return;
        if(objectUrl)URL.revokeObjectURL(objectUrl);
        blob=next; objectUrl=URL.createObjectURL(blob); image.src=objectUrl; image.hidden=false; download.disabled=false; status.textContent='';
      }catch(error){if(!closed)status.textContent=error.message;}
    };
    download.onclick = () => {
      if(!blob)return;
      const link=document.createElement('a');
      const url=URL.createObjectURL(blob); link.href=url;
      const extension = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[blob.type] || 'png';
      link.download=`${(options.name || 'estudiante').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}.${extension}`;
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    };
    replace.onclick = () => input.click();
    input.onchange = async () => {
      const file=input.files?.[0]; if(!file || busy)return;
      if(!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size>8*1024*1024){status.textContent='Selecciona JPG, PNG o WebP de hasta 8 MB.';input.value='';return;}
      busy=true;replace.disabled=true;status.textContent='Guardando foto…';
      try {const source=await options.replace(file);if(!closed){await show(source || options.source);if(blob)status.textContent='Foto guardada.';}}
      catch(error){if(!closed)status.textContent=error.message || 'No se pudo guardar la foto.';}
      finally {busy=false;replace.disabled=!options.replace;input.value='';}
    };
    document.body.appendChild(dialog);dialog.showModal();
    if(options.source)await show(options.source);else status.textContent='Todavía no hay foto de perfil.';
  };
  window.armiStudentPhotoViewer = {open, close:()=>active?.close()};
})();
