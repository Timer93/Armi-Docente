(() => {
  'use strict';
  const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let config, state, template, actor, docId, timer, selectedField='', lastQuote='', lastStart=-1, selectedFieldRevision=0, stopped=false, polling=false,paintDrawing;
  const clientId=crypto.randomUUID(), edits=new Map(), queues=new Map();
  const storageKey=()=>`armi_evidence_draft:${actor?.id}:${docId}`;
  const notice=(message,kind='info')=>{$('notice').textContent=message || '';$('notice').dataset.kind=kind;};
  const remember=()=>{if(!actor)return;try{const saved=recovered();for(const [key,e] of edits){if(e.dirty)saved[key]={value:e.value,revision:e.revision};else if(!e.preservePending)delete saved[key];}localStorage.setItem(storageKey(),JSON.stringify(saved));}catch{notice('No se pudo proteger el borrador en este dispositivo. Guarda y libera tus campos.');}};
  const recovered=()=>{try{return JSON.parse(localStorage.getItem(storageKey()) || '{}');}catch{return {};}};
  const request=async(path,body)=>{
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),10000);
    try{const response=await fetch(`/api/${path}`,{method:body?'POST':'GET',headers:{...(config.token?{Authorization:`Bearer ${config.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store'});
      const json=await response.json();if(!response.ok || !json.success)throw Object.assign(new Error(json.message || 'No se pudo conectar.'),{status:response.status});return json.data;
    }finally{clearTimeout(timeout);}
  };
  const base=()=>`${config.teacher?'':'student-portal/'}evidence-documents/${encodeURIComponent(docId)}`;
  const action=body=>request(`${base()}/action`,{...body,clientId});
  const bridge=()=>{
    function boot(){
      const fields=[...document.querySelectorAll('[data-armi-field]')], controls=new Map();
      document.querySelectorAll('[data-armi-meta]').forEach(el=>{el.textContent=({team:'Equipo asignado por ARMI',date:'Fecha automática',version:'1.0'})[el.dataset.armiMeta] || '';});
      const send=(type,extra)=>parent.postMessage({type:'armi-template-field',event:type,...extra},'*');
      const style=document.createElement('style');style.textContent='[hidden]{display:none!important}.armi-field-wrap{position:relative;margin:8px 0 14px;min-width:0}.armi-field-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font:11px/1.4 system-ui;color:#475569;padding:5px 0}.armi-field-tools button{font:inherit;border:1px solid #cbd5e1;background:#f8fafc;border-radius:7px;padding:4px 8px;cursor:pointer;color:#334155}.armi-field-tools .armi-who{color:#6d28d9}.armi-field-wrap input,.armi-field-wrap textarea,.armi-field-wrap select{max-width:100%;box-sizing:border-box}.armi-field-wrap [readonly]{background:#f8fafc}.armi-comment-mark{border-left:3px solid #8b5cf6;padding-left:7px}';document.head.append(style);
      fields.forEach(el=>{const id=el.dataset.armiField,wrap=document.createElement('div'),tools=document.createElement('div');wrap.className='armi-field-wrap';tools.className='armi-field-tools';el.parentNode.insertBefore(wrap,el);wrap.append(el,tools);
        const reading=document.createElement('div');reading.hidden=true;reading.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;min-height:60px;color:#1e293b';wrap.insertBefore(reading,tools);
        const edit=document.createElement('button'),history=document.createElement('button'),who=document.createElement('span');edit.type=history.type='button';who.className='armi-who';history.textContent='Aportes y comentarios';tools.append(edit,history,who);
        const drawing=el.tagName==='CANVAS';
        const value=()=>drawing?el.dataset.armiDrawing || '':el.type==='checkbox'?el.checked:el.value;
        let owned=false,teacher=false;
        let stroke=null,ink='#334155',width=3;
        const drawingTools=[];
        if(drawing){
          el.width=960;el.height=480;el.style.cssText+=';max-width:100%;height:auto;touch-action:none;display:block;background:#fff;border:1px solid #cbd5e1;border-radius:8px';
          // A generated canvas can live inside a label. Suppress the label's
          // implicit click on its first button when a drawing stroke ends.
          el.addEventListener('click',event=>event.preventDefault());
          const emit=()=>el.dispatchEvent(new Event('input',{bubbles:true}));
          const data=()=>{try{return JSON.parse(value() || '{"version":1,"strokes":[]}');}catch{return {version:1,strokes:[]};}};
          const paint=d=>{el.dataset.armiDrawing=JSON.stringify(d);window.armiPaintDrawing(el,el.dataset.armiDrawing);};
          const point=e=>{const r=el.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
          const color=document.createElement('input');color.type='color';color.value=ink;color.setAttribute('aria-label','Color del lápiz');color.style.cssText='width:30px;height:26px;padding:0;border:0';color.oninput=()=>ink=color.value;
          const undo=document.createElement('button'),clear=document.createElement('button');undo.type=clear.type='button';undo.textContent='Deshacer trazo';clear.textContent='Vaciar dibujo';
          undo.onclick=()=>{if(!owned)return;const d=data();d.strokes.pop();paint(d);emit();};clear.onclick=()=>{if(!owned)return;paint({version:1,strokes:[]});emit();};
          tools.append(color,undo,clear);drawingTools.push(color,undo,clear);
          el.onpointerdown=e=>{if(!owned || (e.pointerType==='mouse' && e.button!==0))return;const d=data();if(d.strokes.length>=200 || d.strokes.reduce((n,s)=>n+s.points.length,0)>=2500){who.textContent='Límite del dibujo: guarda el avance o deshaz un trazo.';return;}e.preventDefault();el.setPointerCapture(e.pointerId);stroke={color:ink,width,points:[point(e)]};d.strokes.push(stroke);paint(d);};
          el.onpointermove=e=>{if(!owned || !stroke)return;const p=point(e),last=stroke.points.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])<0.003)return;const d=data();if(d.strokes.reduce((n,s)=>n+s.points.length,0)>=2500)return;stroke.points.push(p);d.strokes[d.strokes.length-1]=stroke;paint(d);};
          const finish=()=>{if(!stroke)return;stroke=null;emit();};el.onpointerup=finish;el.onpointercancel=finish;el.onlostpointercapture=finish;
        }
        edit.onclick=()=>send(owned?'save':'lock',{fieldId:id,value:value()});
        history.onclick=()=>{const selection=getSelection();let quote='',startOffset=-1;if(!reading.hidden && selection?.rangeCount && reading.contains(selection.anchorNode) && reading.contains(selection.focusNode)){quote=selection.toString();const before=selection.getRangeAt(0).cloneRange();before.selectNodeContents(reading);before.setEnd(selection.getRangeAt(0).startContainer,selection.getRangeAt(0).startOffset);startOffset=before.toString().length;}else if(typeof el.selectionStart==='number'){quote=String(el.value).slice(el.selectionStart,el.selectionEnd);startOffset=el.selectionStart;}send('detail',{fieldId:id,quote,startOffset});};
        el.addEventListener('input',()=>{if(owned)send('input',{fieldId:id,value:value()});});
        controls.set(id,{el,edit,who,wrap,reading,drawing,drawingTools,setOwned:v=>{owned=v;if(!v)stroke=null;},setTeacher:v=>teacher=v});
      });
      addEventListener('message',event=>{if(event.source!==parent || event.data?.type!=='armi-template-state')return;
        const data=event.data;
        for(const [id,c] of controls){const field=data.fields?.[id],lock=data.locks?.[id],owned=!!lock && lock.clientId===data.clientId && lock.studentId===data.actorId && data.editable && !data.saving?.includes(id);
          c.setOwned(owned);c.setTeacher(data.teacher);
          const setValue=value=>{if(c.drawing){if(c.el.dataset.armiDrawing!==String(value || '')){c.el.dataset.armiDrawing=value || '';window.armiPaintDrawing(c.el,value);}}else if(c.el.type==='checkbox')c.el.checked=!!value;else if(c.el.value!==String(value??''))c.el.value=value??'';};
          if(field && !data.pending?.includes(id))setValue(field.value);
          if(owned && Object.prototype.hasOwnProperty.call(data.localValues || {},id))setValue(data.localValues[id]);
          c.drawingTools.forEach(control=>control.disabled=!owned);
          if(c.drawing)c.el.style.touchAction=owned?'none':'pan-y';
          if(c.el.tagName==='SELECT' || c.el.type==='checkbox')c.el.disabled=!owned;else c.el.readOnly=!owned;
          c.edit.hidden=!!data.teacher;c.edit.disabled=!owned && (!data.editable || !!lock);c.edit.textContent=owned?'Guardar y liberar':lock?'Campo ocupado':!data.editable?'Edición cerrada':'Editar';
          const authors=field?.authors || (field?.author?[field.author]:[]);c.who.textContent=lock?`${lock.name} está editando`:authors.length?`Aportes: ${authors.join(', ')} · Último cambio: ${field.author}`:'Sin aportes';
          const comments=(data.comments || []).filter(x=>x.field_id===id && !x.resolved);c.wrap.classList.toggle('armi-comment-mark',!!comments.length);if(comments.length)c.who.textContent+=` · ${comments.length} comentario(s) del docente`;
          const showReading=!owned && c.el.tagName==='TEXTAREA' && !!field?.value;
          c.reading.hidden=!showReading;c.el.hidden=showReading;
          if(showReading){const text=String(field.value);const signature=JSON.stringify([text,comments]);if(c.reading.dataset.signature!==signature){c.reading.dataset.signature=signature;c.reading.replaceChildren();const marks=comments.filter(x=>x.quote && x.field_revision===field.revision).map(x=>({start:x.start_offset>=0?x.start_offset:text.indexOf(x.quote),end:x.end_offset>=0?x.end_offset:text.indexOf(x.quote)+x.quote.length,message:x.message})).filter(x=>x.start>=0).sort((a,b)=>a.start-b.start);let offset=0;for(const mark of marks){if(mark.start<offset)continue;c.reading.append(document.createTextNode(text.slice(offset,mark.start)));const span=document.createElement('mark');span.textContent=text.slice(mark.start,mark.end);span.title=`Docente: ${mark.message}`;span.style.cssText='background:#ede9fe;color:#5b21b6;border-bottom:2px solid #8b5cf6';c.reading.append(span);offset=mark.end;}c.reading.append(document.createTextNode(text.slice(offset)));}}
        }
        document.querySelectorAll('[data-armi-meta]').forEach(el=>{const key=el.dataset.armiMeta;let value=data.metadata?.[key] || '';if(key==='date' && /^\d{4}-\d{2}-\d{2}$/.test(value)){const [y,m,d]=value.split('-');value=`${d}/${m}/${y}`;}el.textContent=value;});
      });send('ready',{});
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  };
  const push=()=>{
    if(!state)return;
    $('canvas').contentWindow?.postMessage({type:'armi-template-state',fields:state.fields || {},comments:state.comments || [],locks:state.locks || {},metadata:state.metadata,teacher:config.teacher,clientId,actorId:actor?.id,editable:state.availability?.editable && state.status!=='submitted',pending:[...edits].filter(([,e])=>e.dirty).map(([id])=>id),localValues:Object.fromEntries([...edits].filter(([,e])=>e.dirty).map(([id,e])=>[id,e.value])),saving:[...edits].filter(([,e])=>e.releasing).map(([id])=>id)},'*');
    const confirmed=state.participants.filter(m=>state.confirmations[m.id]?.revision===state.revision);
    $('status').textContent=state.status==='submitted'?`Entregado · versión ${state.metadata?.version || `1.${state.revision}`}`:`${state.availability?.reason || 'En elaboración'} · versión ${state.metadata?.version || `1.${state.revision}`}`;
    $('members').replaceChildren();for(const m of state.participants){const confirmation=state.confirmations[m.id],confirmed=confirmation?.revision===state.revision;const span=document.createElement('span');span.textContent=`${confirmed?'✓':'○'} ${m.name}${confirmed && confirmation.by==='teacher'?' (excepción docente)':''} · `;if(confirmation?.reason)span.title=confirmation.reason;$('members').append(span);if(config.teacher && !confirmed && state.status!=='submitted'){const b=document.createElement('button');b.textContent='Autorizar excepción';b.style.cssText='font-size:11px;padding:2px 6px;margin-right:8px';b.onclick=()=>{const reason=prompt(`Motivo de la excepción para ${m.name} (quedará registrado):`);if(reason?.trim())void action({action:'exception',memberId:m.id,reason}).then(merge).catch(e=>notice(e.message));};$('members').append(b);}}
    $('confirm').hidden=!!config.teacher || state.status==='submitted';$('confirm').disabled=!state.availability?.editable || [...edits.values()].some(e=>e.dirty);
    $('confirm').textContent=state.confirmations[actor?.id]?.revision===state.revision?`Confirmado (${confirmed.length}/${state.participants.length})`:'Confirmar mi participación';
    $('reopen').hidden=!config.teacher || state.status!=='submitted';
    $('audit').hidden=false;
  };
  const merge=data=>{if(state && (data.sequence<state.sequence || data.serverNow<state.serverNow))return;const delivered=state?.status!=='submitted' && data.status==='submitted';state={...state,...data,fields:data.fields || state?.fields || {},comments:data.comments || state?.comments || []};push();if(delivered)notice('Trabajo entregado. Se registraron las confirmaciones de esta versión.','success');if(selectedField)drawComments();};
  const saveField=(id,release=false)=>{
    const previous=queues.get(id) || Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const e=edits.get(id);if(!e)return;
      clearTimeout(e.timer);const value=e.value;
      try{
        const result=await action({action:'save',fieldId:id,value,fieldRevision:e.revision,release});
        e.revision=result.fields?.[id]?.revision || e.revision;
        if(e.value===value)e.dirty=false;
        remember();if(release){edits.delete(id);}
        merge(result);notice(release?'Aporte guardado. Campo disponible para tus compañeros.':'Borrador guardado.');
      }catch(error){e.dirty=true;e.releasing=false;remember();notice(`${error.message} Tu borrador se conserva en este dispositivo.`);push();throw error;}
    });queues.set(id,task);return task;
  };
  const drawComments=()=>{
    const field=state.fields[selectedField],comments=state.comments.filter(c=>c.field_id===selectedField);
    $('comments').innerHTML=comments.map(c=>`<article><b>Docente${c.resolved?' · Resuelto':''}</b>${c.quote?`<pre>“${esc(c.quote)}”</pre>`:''}<p>${esc(c.message)}</p><small>${c.field_revision!==(field?.revision || 0)?'El texto original fue modificado.':new Date(c.created_at).toLocaleString()}</small>${config.teacher?`<button data-resolve="${esc(c.id)}" data-value="${c.resolved?'0':'1'}">${c.resolved?'Reabrir comentario':'Marcar resuelto'}</button>`:''}</article>`).join('') || '<small>Sin comentarios en este campo.</small>';
    $('comments').querySelectorAll('[data-resolve]').forEach(b=>b.onclick=()=>void action({action:'resolve',commentId:b.dataset.resolve,resolved:b.dataset.value==='1'}).then(merge).catch(e=>notice(e.message)));
  };
  const loadHistory=async(id,before)=>{
    try{const rows=await request(`${base()}/history?fieldId=${encodeURIComponent(id)}&clientId=${clientId}${before?`&before=${before}`:''}`);if(selectedField!==id)return;
      if(!before)$('history').replaceChildren();$('history').querySelector('[data-more]')?.remove();
      const drawing=template.fields.find(f=>f.id===id)?.tag==='canvas';
      const display=value=>{const v=JSON.parse(value);if(!drawing)return esc(v);try{return `Dibujo: ${JSON.parse(v || '{}').strokes?.length || 0} trazo(s)`;}catch{return 'Dibujo vacío';}};
      $('history').insertAdjacentHTML('beforeend',rows.map(h=>`<article><b>${esc(h.author)}</b><small>${new Date(h.created_at).toLocaleString()} · v1.${h.revision} · ${{draft:'Borrador',save:'Guardado manual',restore:'Restauración docente',reopen:'Reapertura',exception:'Excepción docente'}[h.kind] || esc(h.kind)}</small><small>Antes</small><pre>${display(h.before_value)}</pre><small>Después</small><pre>${display(h.after_value)}</pre>${drawing?`<canvas data-history-drawing="${esc(h.id)}" width="480" height="240" style="width:100%;height:auto;background:white;border:1px solid #cbd5e1"></canvas>`:''}${config.teacher && id?`<button data-restore="${esc(h.id)}">Restaurar esta versión</button>`:''}</article>`).join('') || (before?'':'<small>Todavía no hay modificaciones.</small>'));
      if(drawing)for(const h of rows){const canvas=$('history').querySelector(`[data-history-drawing="${h.id}"]`);if(canvas)paintDrawing(canvas,JSON.parse(h.after_value));}
      $('history').querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{if(confirm('¿Restaurar esta versión del campo? El cambio actual quedará en el historial.'))void action({action:'restore',historyId:b.dataset.restore}).then(d=>{merge(d);return detail(id);}).catch(e=>notice(e.message));});
      if(rows.length===(drawing?20:100)){const b=document.createElement('button');b.dataset.more='';b.textContent='Ver versiones anteriores';b.onclick=()=>{b.disabled=true;void loadHistory(id,rows.at(-1).cursor);};$('history').append(b);}
    }catch(e){notice(e.message);}
  };
  const detail=async(id,quote='',start=-1)=>{
    selectedField=id;lastQuote=quote;lastStart=start;selectedFieldRevision=state.fields[id]?.revision || 0;$('details').hidden=false;$('fieldTitle').textContent=template.fields.find(f=>f.id===id)?.label || id;$('quote').value=quote;
    $('commentForm').hidden=!config.teacher;drawComments();
    const pending=recovered()[id];$('pending').replaceChildren();if(pending){
      const drawing=template.fields.find(f=>f.id===id)?.tag==='canvas',p=document.createElement('p');p.textContent=drawing?'Dibujo pendiente en este dispositivo:':`Borrador pendiente en este dispositivo: ${pending.value}`;
      const b=document.createElement('button');b.textContent=drawing?'Recuperar dibujo pendiente':'Copiar borrador pendiente';
      b.onclick=drawing?async()=>{if(!confirm('¿Recuperar este dibujo? Al guardar reemplazará el dibujo actual; la versión anterior se conservará en el historial.'))return;try{const result=await action({action:'lock',fieldId:id});edits.set(id,{value:pending.value,revision:result.fields?.[id]?.revision || 0,dirty:true});remember();merge(result);notice('Dibujo recuperado. Revísalo y pulsa Guardar y liberar.');}catch(e){notice(e.message);}}:()=>navigator.clipboard.writeText(String(pending.value)).then(()=>notice('Borrador copiado. Revisa el campo actual antes de incorporarlo.')).catch(()=>notice('Selecciona y copia el borrador mostrado.'));
      const discard=document.createElement('button');discard.textContent='Descartar borrador local';discard.onclick=()=>{if(!confirm('¿Descartar solamente este borrador del dispositivo? El trabajo guardado en ARMI se conserva.'))return;const saved=recovered();delete saved[id];localStorage.setItem(storageKey(),JSON.stringify(saved));if(edits.has(id))edits.get(id).preservePending=false;$('pending').replaceChildren();};$('pending').append(p);
      if(drawing){const canvas=document.createElement('canvas');canvas.width=480;canvas.height=240;canvas.style.cssText='width:100%;height:auto;background:white;border:1px solid #cbd5e1';paintDrawing(canvas,pending.value);$('pending').append(canvas);}
      $('pending').append(b,discard);
    }
    await loadHistory(id);
  };
  addEventListener('message',async event=>{
    if(event.source===$('canvas').contentWindow && event.data?.type==='armi-template-field' && state){
      const m=event.data,id=m.fieldId;if(m.event==='ready'){push();return;}if(!template.fields.some(f=>f.id===id))return;
      if(m.event==='detail'){void detail(id,m.quote,m.startOffset);return;}if(config.teacher)return;
      try{
        if(m.event==='lock'){
          const result=await action({action:'lock',fieldId:id});
          if(edits.get(id)?.dirty){const pending=edits.get(id),revision=result.fields?.[id]?.revision || 0;if(pending.revision!==revision){remember();edits.set(id,{value:result.fields?.[id]?.value ?? '',revision,dirty:false,preservePending:true});merge(result);notice('El campo cambió durante la desconexión. Revisa tu borrador pendiente antes de incorporarlo.');void detail(id);return;}merge(result);notice('Borrador recuperado. Revisa tu aporte y pulsa Guardar y liberar.');return;}
          const saved=recovered()[id], revision=result.fields?.[id]?.revision || 0;
          const canRestore=saved && saved.revision===revision;
          edits.set(id,{value:canRestore?saved.value:result.fields?.[id]?.value ?? (template.fields.find(f=>f.id===id)?.type==='checkbox'?false:''),revision,dirty:!!canRestore,preservePending:!!saved && !canRestore});merge(result);
          if(canRestore)notice('Borrador recuperado. Revisa tu aporte y pulsa Guardar y liberar.');else if(saved){notice('El campo tiene cambios más recientes. Conservamos tu borrador pendiente para que puedas compararlo.');void detail(id);}
        }else if(m.event==='input'){
          const e=edits.get(id);if(!e)return;e.value=m.value;e.dirty=true;e.preservePending=false;clearTimeout(e.timer);remember();e.timer=setTimeout(()=>void saveField(id).catch(()=>{}),850);notice('Guardando borrador…');push();
        }else if(m.event==='save'){
          const e=edits.get(id);if(e){e.value=m.value;e.releasing=true;push();await saveField(id,true);}
        }
      }catch(e){notice(e.message);}
      return;
    }
    if(event.source!==parent || event.data?.type!=='armi-workspace-init' || config)return;
    config=event.data;try{
      let data;
      if(config.teacher){docId=config.documentId;data=await request(base());}
      else data=await request(`student-portal/evidence-templates/${encodeURIComponent(config.sessionId)}/${encodeURIComponent(config.templateId)}`);
      docId=data.id;template=data.template;actor=data.actor;state=data;
      $('title').textContent=template.requested.text;
      const policy=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">`;
      const {paintTemplateDrawing}=await import('/estudiante-assets/evidence-drawing.js');
      paintDrawing=paintTemplateDrawing;
      $('canvas').srcdoc=template.html.replace(/<head([^>]*)>/i,`<head$1>${policy}`).replace(/<\/body>/i,`<script>window.armiPaintDrawing=${paintTemplateDrawing.toString()};(${bridge.toString()})();<\/script></body>`);
      push();if(Object.keys(recovered()).length)notice('Hay borradores pendientes en este dispositivo. Abre Aportes y comentarios en el campo correspondiente para recuperarlos.');
      timer=setInterval(async()=>{if(stopped || polling || document.hidden)return;polling=true;try{const data=await request(`${base()}?cursor=${state.sequence}&clientId=${clientId}`);merge(data);}catch(e){notice(`Conexión pendiente: ${e.message}`);}finally{polling=false;}},2000);
    }catch(e){notice(e.message);$('status').textContent='No se pudo abrir la plantilla';}
  });
  $('confirm').onclick=async()=>{try{$('confirm').disabled=true;merge(await action({action:'confirm',revision:state.revision}));notice(state.status==='submitted'?'Trabajo entregado.':'Tu participación está confirmada. Falta la confirmación de los demás integrantes.',state.status==='submitted'?'success':'info');}catch(e){notice(e.message);push();}};
  $('reopen').onclick=()=>{if(confirm('¿Reabrir el trabajo? La entrega anterior se conservará. Revisa también el horario de edición.'))void action({action:'reopen'}).then(merge).catch(e=>notice(e.message));};
  $('commentForm').onsubmit=async event=>{event.preventDefault();try{merge(await action({action:'comment',fieldId:selectedField,quote:lastQuote,startOffset:lastStart,fieldRevision:selectedFieldRevision,message:$('comment').value}));$('comment').value='';notice('Comentario publicado.');}catch(e){notice(e.message);}};
  $('hideDetails').onclick=()=>{$('details').hidden=true;selectedField='';};
  $('audit').onclick=()=>{selectedField='';$('details').hidden=false;$('fieldTitle').textContent='Actividad del trabajo';$('quote').value='';$('pending').replaceChildren();$('comments').replaceChildren();$('commentForm').hidden=true;void loadHistory('');};
  $('close').onclick=async()=>{if([...edits.values()].some(e=>e.dirty) && !confirm('Hay cambios pendientes. Se conservarán como borrador en este dispositivo. ¿Cerrar?'))return;stopped=true;clearInterval(timer);remember();for(const [id,e] of edits){clearTimeout(e.timer);void action({action:'release',fieldId:id}).catch(()=>{});}parent.postMessage({type:'armi-workspace-close'},'*');};
  addEventListener('beforeunload',event=>{remember();if([...edits.values()].some(e=>e.dirty)){event.preventDefault();event.returnValue='';}});
  parent.postMessage({type:'armi-workspace-ready'},'*');
})();
