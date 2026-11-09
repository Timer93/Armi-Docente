(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${({folder:'M3 7h7l2 2h9l-3 11H3z M3 7V4h7l2 3',book:'M6 3h14v18H6z M3 6h6 M3 10h6 M3 14h6 M3 18h6 M12 7h4 M12 11h4',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',edit:'M4 20l4-1L20 7l-4-4L4 15z',calendar:'M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16',search:'M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'})[name] || 'M5 3h10l4 4v14H5z'}"/></svg>`;
  const fields = [['activities','Actividades realizadas'],['progress','Avances o resultados'],['difficulties','Dificultades encontradas'],['strategies','Estrategias o soluciones'],['reflection','Reflexión final']];
  const day = value => { if(!value)return 'Sin fecha'; const date=new Date(String(value).slice(0,10)+'T12:00:00');return Number.isNaN(date.getTime())?'Sin fecha':new Intl.DateTimeFormat('es-PE',{dateStyle:'short'}).format(date); };
  const today = () => { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const groupKey = item => `${item.year || ''}|${item.areaId || ''}|${item.unitNumber || ''}`;
  const create = (root, {api,token,student,preview,download,onSession,exports}) => {
    let items=[],sessions=[],entries=[],tab='evidences',generation=0,loginGeneration=0,editor=null,dirty=false,saving=false;
    let filters={unit:'',session:'',type:'',search:''}, journalFilters={unit:'',session:'',search:''},observer;
    const urls=new Map();
    root.innerHTML=`<div class="pf-tabs" role="tablist" aria-label="Contenido del portafolio"><button id="pf-evidence-tab" role="tab" aria-selected="true" aria-controls="pf-evidences" data-pf-tab="evidences">${icon('folder')}Evidencias</button><button id="pf-journal-tab" role="tab" aria-selected="false" aria-controls="pf-journal" data-pf-tab="journal" tabindex="-1">${icon('book')}Bitácora</button></div><section id="pf-evidences" role="tabpanel" aria-labelledby="pf-evidence-tab"><div class="pf-banner"><span class="pf-banner-icon">${icon('folder')}</span><div><h3>Mis evidencias de aprendizaje</h3><p>Aquí se muestran tus entregas, organizadas por unidad y sesión.</p></div><div class="pf-exports"></div></div><div class="pf-filters" data-pf-filters></div><div data-pf-evidence-list></div></section><section id="pf-journal" role="tabpanel" aria-labelledby="pf-journal-tab" hidden><div class="pf-banner"><span class="pf-banner-icon">${icon('book')}</span><div><h3>Mi bitácora de aprendizaje</h3><p>Registra lo que hiciste, tus avances y lo que aprendiste en cada sesión.</p></div><button class="pf-primary" data-pf-new>Completar una sesi\u00f3n</button></div><div class="pf-filters" data-pf-journal-filters></div><div data-pf-editor></div><div data-pf-journal-list></div></section><p class="pf-status" data-pf-status role="status" aria-live="polite"></p>`;
    if(exports){root.querySelector('.pf-exports').appendChild(exports);const description=exports.querySelector(':scope > div:first-child');if(description)description.hidden=true;}
    const status = (message,error=false) => {const node=root.querySelector('[data-pf-status]');node.textContent=message;node.classList.toggle('error',error);};
    const sessionInfo = id => sessions.find(s=>String(s.id)===String(id)) || {};
    const mergeSessions = () => {
      sessions=[...new Map([...sessions,...items.map(item=>({id:item.sessionId,title:item.sessionTitle,unitNumber:item.unitNumber,sessionNumber:item.sessionNumber,year:item.year,areaId:item.areaId,areaName:item.areaId})),...entries.map(entry=>({id:entry.sessionId,title:entry.sessionTitle,unitNumber:entry.unitNumber,sessionNumber:entry.sessionNumber,year:entry.year,areaId:entry.areaId,areaName:entry.areaId}))].filter(s=>s.id).reverse().map(s=>[String(s.id),s])).values()].sort((a,b)=>String(b.year || '').localeCompare(String(a.year || '')) || String(a.unitNumber).localeCompare(String(b.unitNumber),'es',{numeric:true}) || String(a.sessionNumber).localeCompare(String(b.sessionNumber),'es',{numeric:true}));
    };
    const unitLabel = item => {const s=sessionInfo(item.sessionId || item.id);return `Unidad ${item.unitNumber}${s.unitTitle ? ': '+s.unitTitle : ''}${s.areaName ? ' · '+s.areaName : ''}${item.year ? ' · '+item.year : ''}`;};
    const extension = item => String(item.fileName || '').split('.').pop().toUpperCase();
    const thumbnail = item => `<button class="pf-thumb" data-pf-view="${esc(item.id)}" aria-label="Ver ${esc(item.fileName)}">${item.thumbnailUrl?`<img data-pf-thumbnail="${esc(item.thumbnailUrl)}" alt="${esc(item.fileName)}" loading="lazy">`:`<span>${esc(extension(item))}</span>`}</button>`;
    const getFile = id => [...items,...entries.flatMap(e=>e.evidences || [])].find(item=>String(item.id)===String(id));
    const bindFiles = host => {
      host.querySelectorAll('[data-pf-view]').forEach(button=>button.onclick=()=>{const item=getFile(button.dataset.pfView);if(item)void preview(item).catch(e=>status(e.message,true));});
      host.querySelectorAll('[data-pf-download]').forEach(button=>button.onclick=async()=>{const item=getFile(button.dataset.pfDownload);if(!item)return;button.disabled=true;try{const response=await fetch(item.fileUrl,{headers:{Authorization:`Bearer ${token()}`}});if(!response.ok)throw new Error('No se pudo descargar la evidencia.');download(await response.blob(),item.fileName);}catch(e){status(e.message,true);}finally{button.disabled=false;}});
      host.querySelectorAll('[data-pf-open-session]').forEach(button=>button.onclick=()=>onSession?.(button.dataset.pfOpenSession));
      hydrate(host);
    };
    const hydrate = host => {
      const captured=generation,currentToken=token();
      const load=async image=>{const source=image.dataset.pfThumbnail;try{let url=urls.get(source);if(!url){const response=await fetch(source,{headers:{Authorization:`Bearer ${currentToken}`}});if(!response.ok)throw new Error();const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error();if(currentToken!==token()||captured!==generation)return;url=URL.createObjectURL(blob);urls.set(source,url);}if(image.isConnected&&captured===generation)image.src=url;}catch{if(image.isConnected){image.hidden=true;image.parentElement.classList.add('pf-thumb-missing');image.parentElement.title='Abrir evidencia';}}};
      host.querySelectorAll('[data-pf-thumbnail]').forEach(image=>{if('IntersectionObserver' in window){observer ||= new IntersectionObserver(list=>list.forEach(entry=>{if(entry.isIntersecting){observer.unobserve(entry.target);void load(entry.target);}}),{rootMargin:'100px'});observer.observe(image);}else void load(image);});
    };
    const optionList = (list,current,label,formatter=value=>value) => `<option value="">${label}</option>${list.map(value=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(formatter(value))}</option>`).join('')}`;
    const filterMarkup = (data,current,journal=false) => {
      const groups=[...new Map(data.map(item=>[groupKey(item),item])).entries()];
      const sessionNumbers=[...new Set(data.filter(item=>!current.unit||groupKey(item)===current.unit).map(item=>String(item.sessionNumber)))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));
      return `<label>Unidad<select data-pf-filter="unit">${optionList(groups.map(([key])=>key),current.unit,'Todas las unidades',key=>unitLabel(groups.find(([k])=>k===key)[1]))}</select></label><label>Sesión<select data-pf-filter="session">${optionList(sessionNumbers,current.session,'Todas las sesiones',v=>'Sesión '+v)}</select></label>${!journal?`<label>Tipo de evidencia<select data-pf-filter="type">${optionList([...new Set(data.map(extension))].sort(),current.type,'Todos')}</select></label>`:''}<label class="pf-search">Buscar<div>${icon('search')}<input data-pf-filter="search" value="${esc(current.search)}" placeholder="${journal?'Buscar en mi bitácora…':'Buscar evidencia…'}"></div></label>`;
    };
    const bindFilters = (host,current,drawFilters,draw) => host.querySelectorAll('[data-pf-filter]').forEach(input=>{const change=()=>{current[input.dataset.pfFilter]=input.value;if(input.dataset.pfFilter==='unit'){current.session='';drawFilters();}draw();};if(input.tagName==='INPUT')input.oninput=change;else input.onchange=change;});
    const evidenceFilters = () => {const host=root.querySelector('[data-pf-filters]');host.innerHTML=filterMarkup(items,filters);bindFilters(host,filters,evidenceFilters,drawEvidence);};
    const drawEvidence = () => {
      const host=root.querySelector('[data-pf-evidence-list]');host.querySelectorAll('[data-pf-thumbnail]').forEach(image=>observer?.unobserve(image));const matching=items.filter(item=>(!filters.unit||groupKey(item)===filters.unit)&&(!filters.session||String(item.sessionNumber)===filters.session)&&(!filters.type||extension(item)===filters.type)&&norm(`${item.fileName} ${item.sessionTitle}`).includes(norm(filters.search)));
      const groups=new Map();matching.forEach(item=>{const key=groupKey(item);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);});
      host.innerHTML=[...groups.values()].map(rows=>`<section class="pf-unit"><header>${icon('folder')}<h4>${esc(unitLabel(rows[0]))}</h4><span>${rows.length} evidencia${rows.length===1?'':'s'}</span></header>${rows.map(item=>`<article class="pf-evidence-row">${thumbnail(item)}<div class="pf-evidence-text"><h4>${esc(item.fileName)} <span class="pf-type">${esc(extension(item))}</span></h4><p><b>U${esc(item.unitNumber)} · S${esc(item.sessionNumber)}</b> ${esc(item.sessionTitle)}</p></div><span class="pf-delivered">✓ Entregado</span><time>${icon('calendar')}${esc(day(item.submittedAt || item.uploadedAt || item.updatedAt))}</time><div class="pf-row-actions"><button data-pf-view="${esc(item.id)}">${icon('eye')}Ver</button><button data-pf-download="${esc(item.id)}">${icon('download')}Descargar</button></div><details class="pf-more"><summary aria-label="Más opciones para ${esc(item.fileName)}" title="Más opciones">⋮</summary><div><button data-pf-open-session="${esc(item.sessionId)}">Abrir sesión</button></div></details></article>`).join('')}</section>`).join('')||`<div class="pf-empty">${items.length?'No hay evidencias que coincidan con tus filtros.':'Tu portafolio se llenará con las evidencias que entregues en tus sesiones.'}</div>`;
      bindFiles(host);
    };
    const journalRows = () => sessions.map(session => {
      const sessionId=String(session.id),saved=entries.find(entry=>String(entry.sessionId)===sessionId);
      const submitted=items.filter(item=>String(item.sessionId)===sessionId);
      const evidences=submitted.length ? submitted : (saved?.evidences || []);
      return {activities:'',progress:'',difficulties:'',strategies:'',reflection:'',revision:'',...saved,
        sessionId,sessionTitle:session.title || saved?.sessionTitle || 'Sesión de aprendizaje',
        unitNumber:session.unitNumber,sessionNumber:session.sessionNumber,areaId:session.areaId,
        year:session.year || saved?.year || submitted[0]?.year || '',
        date:saved?.date || session.dates?.[0] || session.date || '',
        evidences,evidenceIds:evidences.map(item=>String(item.id)),saved:!!saved};
    });
    const journalFilterControls = () => {const host=root.querySelector('[data-pf-journal-filters]');host.innerHTML=filterMarkup(journalRows(),journalFilters,true);bindFilters(host,journalFilters,journalFilterControls,drawJournal);};
    const renderText = text => text ? esc(text).replace(/\n/g,'<br>') : '<span class="pf-muted">Sin registrar</span>';
    const drawJournal = () => {
      const host=root.querySelector('[data-pf-journal-list]');host.querySelectorAll('[data-pf-thumbnail]').forEach(image=>observer?.unobserve(image));
      const rows=journalRows().filter(entry=>(!journalFilters.unit||groupKey(entry)===journalFilters.unit)&&(!journalFilters.session||String(entry.sessionNumber)===journalFilters.session)&&norm([entry.sessionTitle,...fields.map(([key])=>entry[key]),...entry.evidences.map(item=>item.fileName)].join(' ')).includes(norm(journalFilters.search)));
      const groups=new Map();rows.forEach(entry=>{const key=groupKey(entry);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);});
      const markup = entry => `
        <article class="pf-journal-entry" data-pf-journal-session="${esc(entry.sessionId)}">
          <header><div><h3>Sesi\u00f3n ${esc(entry.sessionNumber)} \u2013 ${esc(entry.sessionTitle)}</h3><small>Unidad ${esc(entry.unitNumber)} \u00b7 ${esc(sessionInfo(entry.sessionId).areaName || '')}</small></div>
          <time>${icon('calendar')}Fecha: ${esc(day(entry.date))}</time>
          <button data-pf-edit="${esc(entry.sessionId)}" aria-label="Completar bit\u00e1cora de la sesi\u00f3n ${esc(entry.sessionNumber)}" title="${entry.saved?'Editar registro':'Completar registro'}">${icon('edit')}<span>${entry.saved?'Editar':'Completar'}</span></button></header>
          <dl>${fields.slice(0,4).map(([key,label])=>`<div class="pf-journal-line ${key}"><dt>${label}</dt><dd>${renderText(entry[key])}</dd></div>`).join('')}
            <div class="pf-journal-line evidences"><dt>Evidencias</dt><dd><div class="pf-journal-evidence-grid">${entry.evidences.map(item=>`<figure>${thumbnail(item)}<figcaption>${esc(item.fileName)}</figcaption></figure>`).join('') || '<span class="pf-muted">A\u00fan no hay evidencias presentadas en esta sesi\u00f3n.</span>'}</div></dd></div>
            <div class="pf-journal-line reflection"><dt>Reflexi\u00f3n final</dt><dd>${renderText(entry.reflection)}</dd></div>
          </dl>
        </article>`;
      host.innerHTML=[...groups.values()].map(group=>`<section class="pf-unit pf-journal-unit"><header>${icon('folder')}<h4>${esc(unitLabel(group[0]))}</h4><span>${group.length} sesiones</span></header>${group.map(markup).join('')}</section>`).join('') || '<div class="pf-empty">No hay sesiones que coincidan con los filtros.</div>';
      host.querySelectorAll('[data-pf-edit]').forEach(button=>button.onclick=()=>void edit(button.dataset.pfEdit));bindFiles(host);
    };
    const draftKey = id => `armi-journal-draft:${student()?.id}:${id}`;
    const cacheDraft = () => {if(!editor)return;try{localStorage.setItem(draftKey(editor.sessionId),JSON.stringify(editor));}catch{status('No se pudo respaldar el borrador en este navegador. Guarda tu registro.',true);}};
    const showEditor = () => {
      const host=root.querySelector('[data-pf-editor]');if(!editor){host.innerHTML='';return;}
      const selected=sessionInfo(editor.sessionId);
      host.innerHTML=`<form class="pf-journal-editor"><div class="pf-editor-head"><h3>Registrar mi aprendizaje</h3><small>Tu borrador se conserva en este navegador.</small></div><div class="pf-editor-context"><label>Sesión<select name="sessionId" required><option value="">Selecciona una sesión</option>${sessions.map(s=>`<option value="${esc(s.id)}" ${String(s.id)===String(editor.sessionId)?'selected':''}>U${esc(s.unitNumber)} · S${esc(s.sessionNumber)} · ${esc(s.title)} · ${esc(s.areaName)}</option>`).join('')}</select></label><label>Fecha<input type="date" name="date" value="${esc(editor.date)}" required></label></div>${fields.map(([key,label])=>`<label class="pf-editor-field ${key}">${label}<textarea name="${key}" maxlength="6000" rows="${key==='reflection'?3:2}" placeholder="${key==='activities'?'Describe lo que hiciste en esta sesión…':label+'…'}">${esc(editor[key])}</textarea></label>`).join('')}<fieldset><legend>Evidencias presentadas en esta sesi\u00f3n</legend><p class="pf-muted">Se incluyen autom\u00e1ticamente tus entregas existentes.</p><div class="pf-journal-evidence-grid">${(journalRows().find(row=>row.sessionId===String(editor.sessionId))?.evidences || []).map(item=>`<figure>${thumbnail(item)}<figcaption>${esc(item.fileName)}</figcaption></figure>`).join('') || '<p>A\u00fan no hay evidencias entregadas para esta sesi\u00f3n.</p>'}</div></fieldset><div class="pf-editor-actions"><span data-pf-save-status role="status"></span><button type="button" data-pf-cancel>Cancelar</button><button class="pf-primary" type="submit">Guardar bitácora</button></div></form>`;
      bindFiles(host);
      const form=host.querySelector('form');
      form.oninput=event=>{if(event.target.name==='sessionId')return;if(event.target.name==='evidenceId')editor.evidenceIds=[...form.querySelectorAll('[name=evidenceId]:checked')].map(input=>input.value);else editor[event.target.name]=event.target.value;dirty=true;cacheDraft();form.querySelector('[data-pf-save-status]').textContent='Borrador guardado en este navegador';};
      form.querySelector('[name=sessionId]').onchange=event=>{cacheDraft();void edit(event.target.value,true);};
      form.querySelector('[data-pf-cancel]').onclick=()=>{if(saving)return;cacheDraft();editor=null;dirty=false;showEditor();status('El borrador se conserva para continuar después.');};
      form.onsubmit=async event=>{event.preventDefault();if(saving)return;if(!editor.sessionId){status('Selecciona una sesión.',true);return;}editor.evidenceIds=(journalRows().find(row=>row.sessionId===String(editor.sessionId))?.evidenceIds || []).slice(0,10);saving=true;const captured=loginGeneration,snapshot={...editor};form.querySelectorAll('button,input,textarea,select').forEach(node=>node.disabled=true);try{const saved=await api(`/api/student-portal/journal/${encodeURIComponent(editor.sessionId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editor)});if(captured!==loginGeneration)return;entries=[saved,...entries.filter(e=>e.sessionId!==saved.sessionId)].sort((a,b)=>b.date.localeCompare(a.date));try{localStorage.removeItem(draftKey(saved.sessionId));}catch{}editor=null;dirty=false;showEditor();journalFilterControls();drawJournal();status('Bitácora guardada correctamente.');}catch(error){if(captured===loginGeneration){editor=snapshot;cacheDraft();status(error.message,true);form.querySelector('[data-pf-save-status]').textContent=error.message;}}finally{saving=false;form.querySelectorAll('button,input,textarea,select').forEach(node=>node.disabled=false);}};
      if(selected.title)host.querySelector('h3').textContent=`Sesión ${selected.sessionNumber} · ${selected.title}`;
    };
    const edit = async (id='',fromSelect=false) => {
      if(saving)return;
      if(dirty && !fromSelect)cacheDraft();
      let draft;try{draft=JSON.parse(localStorage.getItem(draftKey(id)) || 'null');}catch{}
      const saved=journalRows().find(e=>String(e.sessionId)===String(id));
      editor=draft || (saved?{...saved,date:saved.date || today()}:{sessionId:id,date:today(),revision:'',evidenceIds:[],activities:'',progress:'',difficulties:'',strategies:'',reflection:''});dirty=!!draft;showEditor();
      if(draft && draft.revision!==(saved?.revision || '')){status('Hay un borrador de una versión anterior. Puedes copiar su texto y cargar el registro actualizado.',true);const button=document.createElement('button');button.type='button';button.textContent='Cargar versión guardada';button.onclick=()=>{if(confirm('¿Descartar este borrador y cargar la versión guardada?')){try{localStorage.removeItem(draftKey(id));}catch{}editor=null;dirty=false;void edit(id);}};root.querySelector('.pf-editor-actions').prepend(button);}
      if(!fromSelect)root.querySelector('[data-pf-editor]').scrollIntoView({behavior:'smooth',block:'start'});
    };
    const loadJournal = async () => {const captured=loginGeneration;status('Cargando bitácora…');try{const data=await api('/api/student-portal/journal');if(captured!==loginGeneration)return;entries=data;mergeSessions();journalFilterControls();drawJournal();status('');}catch(e){if(captured===loginGeneration)status(e.message,true);}};
    const selectTab = value => {tab=value;root.querySelectorAll('[data-pf-tab]').forEach(button=>{const active=button.dataset.pfTab===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});root.querySelector('#pf-evidences').hidden=tab!=='evidences';root.querySelector('#pf-journal').hidden=tab!=='journal';if(tab==='journal'){journalFilterControls();drawJournal();void loadJournal();}};
    root.querySelectorAll('[data-pf-tab]').forEach(button=>{button.onclick=()=>selectTab(button.dataset.pfTab);button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'evidences':event.key==='End'?'journal':tab==='evidences'?'journal':'evidences';selectTab(next);root.querySelector(`[data-pf-tab="${next}"]`).focus();}};});
    root.querySelector('[data-pf-new]').onclick=()=>{const row=journalRows().find(entry=>(!journalFilters.unit||groupKey(entry)===journalFilters.unit)&&(!journalFilters.session||String(entry.sessionNumber)===journalFilters.session));void edit(row?.sessionId || '');};
    const legacyLinksAnchor=document.getElementById('studentPortfolioList');if(legacyLinksAnchor)root.querySelector('#pf-evidences').appendChild(legacyLinksAnchor);
    return {update(data){items=data.items || [];sessions=data.sessions || [];mergeSessions();evidenceFilters();drawEvidence();if(tab==='journal'){journalFilterControls();drawJournal();}},open(){if(tab==='journal')void loadJournal();},reset(){cacheDraft();loginGeneration++;generation++;observer?.disconnect();observer=null;urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();items=[];sessions=[];entries=[];editor=null;dirty=false;filters={unit:'',session:'',type:'',search:''};journalFilters={unit:'',session:'',search:''};showEditor();drawEvidence();drawJournal();}};
  };
  window.armiStudentPortfolio={create};
})();
