(() => {
  const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  window.armiTeacherMessages={create(host,{api,identity,onOpen,onUnread}){
    let items=[],unread=0,expanded=null,timer=0,revision=0,busy=false,current='';
    const shown=new Set(),read=new Set(),toast=document.createElement('div');toast.className='teacher-toast-host';toast.setAttribute('aria-live','polite');document.body.appendChild(toast);
    const render=()=>{
      onUnread(unread);
      host.innerHTML=`<section class="teacher-inbox"><header><h3>Mensajes de tu docente ${unread?`<span>${unread} sin leer</span>`:''}</h3><button type="button" data-teacher-refresh>Actualizar</button></header>${items.length?`<div class="teacher-message-list">${items.map(item=>`<article class="teacher-message ${item.readAt?'':'unread'}"><button type="button" data-teacher-message="${item.id}" aria-expanded="${expanded===item.id}"><span><strong>${safe(item.title)}</strong><small>${safe(item.teacherName)} · ${safe(new Date(item.createdAt.replace(' ','T')+'Z').toLocaleString('es-PE'))}</small></span><b>${expanded===item.id?'Cerrar':item.readAt?'Ver':'Leer'}</b></button>${expanded===item.id?`<div class="teacher-message-body">${safe(item.body)}</div>`:''}</article>`).join('')}</div>`:'<p class="teacher-inbox-empty">Aquí encontrarás los mensajes que te envíe tu docente.</p>'}</section>`;
      host.querySelector('[data-teacher-refresh]').onclick=()=>void poll();
      host.querySelectorAll('[data-teacher-message]').forEach(button=>button.onclick=()=>{const id=Number(button.dataset.teacherMessage);if(expanded===id){expanded=null;render();}else void open(id);});
    };
    const open=async id=>{
      const item=items.find(item=>item.id===id);if(!item)return;
      const epoch=revision;expanded=id;toast.replaceChildren();onOpen();render();host.scrollIntoView?.({behavior:'smooth',block:'start'});
      if(!item.readAt){try{await api(`/api/student-portal/teacher-messages/${id}/read`,{method:'POST'});if(epoch!==revision)return;read.add(id);const currentItem=items.find(item=>item.id===id);if(currentItem&&!currentItem.readAt){currentItem.readAt=new Date().toISOString();unread=Math.max(0,unread-1);}render();}catch{/* Keep it unread until the server confirms. */}}
    };
    const poll=async()=>{
      if(busy||!current||document.hidden)return;
      const epoch=revision,captured=current;busy=true;
      try{
        const result=await api('/api/student-portal/teacher-messages');
        if(epoch!==revision||captured!==identity())return;
        items=result.items||[];unread=result.unread||0;
        items.forEach(item=>{if(read.has(item.id)&&!item.readAt){item.readAt=new Date().toISOString();unread=Math.max(0,unread-1);}});render();
        const pending=items.filter(item=>!item.readAt&&!item.notifiedAt&&!shown.has(item.id));
        if(pending.length){
          const latest=pending[0];
          toast.innerHTML=`<aside class="teacher-toast" role="status"><span class="teacher-toast-icon" aria-hidden="true">✉</span><div><small>MENSAJE DE TU DOCENTE${pending.length>1?` · ${pending.length} nuevos`:''}</small><strong>${safe(latest.title)}</strong><p>${safe(latest.body.slice(0,140))}${latest.body.length>140?'…':''}</p><button type="button" data-teacher-toast-open>${pending.length>1?'Ver mensajes':'Ver mensaje'} →</button></div><button type="button" class="teacher-toast-close" data-teacher-toast-close aria-label="Descartar aviso">×</button></aside>`;
          toast.querySelector('[data-teacher-toast-open]').onclick=()=>void open(latest.id);
          toast.querySelector('[data-teacher-toast-close]').onclick=()=>toast.replaceChildren();
          pending.forEach(item=>{shown.add(item.id);void api(`/api/student-portal/teacher-messages/${item.id}/notified`,{method:'POST'}).catch(()=>{});});
        }
      }catch{/* The next poll retries without interrupting student work. */}
      finally{if(epoch===revision)busy=false;}
    };
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
    const reset=()=>{revision++;clearInterval(timer);timer=0;busy=false;current='';items=[];unread=0;expanded=null;shown.clear();read.clear();toast.replaceChildren();host.replaceChildren();onUnread(0);};
    return {start(){const next=identity();if(!next)return;if(timer&&next===current)return;reset();current=next;render();void poll();timer=setInterval(()=>void poll(),5000);},refresh:poll,reset};
  }};
})();
