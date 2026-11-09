import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// Execute the actual portal HTML and all its scripts together, not isolated API handlers.
async function run({ brokenPortfolio = false, unavailable = false } = {}) {
  const source = fs.readFileSync('backend/public/student-portal.html', 'utf8');
  const { window, document } = parseHTML(source);
  const errors = [];
  const storage = new Map([['armiStudentToken', 'test-token'], ['armiStudent', JSON.stringify({id:'test-student',name:'Estudiante de prueba',grade:'5to',section:'A',group:'1'})]]);
  const local = new Map();
  const store = map => ({getItem:key=>map.get(key) || null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)});
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // Linkedom models DOM structure and events; browser scrolling and select setters are supplied here.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {configurable:true,get(){const selected=[...this.querySelectorAll('option')].find(option=>option.hasAttribute('selected'));return selected?.getAttribute('value') ?? selected?.textContent ?? this.querySelector('option')?.getAttribute('value') ?? '';},set(value){this.querySelectorAll('option').forEach(option=>{if((option.getAttribute('value') ?? option.textContent)===String(value))option.setAttribute('selected','');else option.removeAttribute('selected');});}});
  const item = {id:'1',sessionId:'session-1',fileName:'reporte.txt',fileType:'text/plain',previewKind:'text',fileUrl:'/api/evaluacion/evidencias/1/file',previewUrl:'/api/evaluacion/evidencias/1/preview',year:'2026',areaId:'MAT',unitNumber:'1',sessionNumber:'5',sessionTitle:'Aprendemos a organizar datos',submittedAt:'2026-10-04'};
  const session={id:'session-1',title:item.sessionTitle,areaId:'MAT',areaName:'Matemática',unitNumber:'1',unitTitle:'Nuestro proyecto',sessionNumber:'5',year:'2026',evidenceCount:1,status:'delivered',dates:['2026-10-04']};
  const sessions=[session,{...session,id:'session-2',sessionNumber:'6',title:'Trabajo en equipo'}, {...session,id:'session-3',unitNumber:'2',unitTitle:'Desarrollo del proyecto',title:'Otra unidad sin entregas'}];
  const portfolioItems=[item,{...item,id:'2',fileName:'costos.png',fileType:'image/png',thumbnailUrl:'/api/evaluacion/evidencias/2/thumbnail'}, {...item,id:'3',sessionId:'session-2',sessionNumber:'6',fileName:'equipo.png',fileType:'image/png',thumbnailUrl:'/api/evaluacion/evidencias/3/thumbnail'}];
  let entries=[];
  let copiedLink='';
  const teacherNotes=[{id:1,title:'Mensaje importante del docente',body:'Revisa la entrega de tu proyecto. <img src=x onerror=alert(1)>',teacherName:'Tu docente',createdAt:'2026-10-17 12:00:00',readAt:null,notifiedAt:null}];
  const fetch = async (url, options={}) => {
    if (unavailable) return new Response('Temporary tunnel outage', { status: 503 });
    const route=String(url);
    if(route.endsWith('/chat/messages/1/file'))return new Response('<html><body>Archivo del chat<script>parent.pwned=true</script></body></html>',{headers:{'Content-Type':'text/html'}});
    if(route.endsWith('/thumbnail'))return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNecAAAAASUVORK5CYII=','base64'),{headers:{'Content-Type':'image/png'}});
    if(route.includes('/evaluacion/evidencias/'))return new Response('<script>Texto de evidencia</script>',{headers:{'Content-Type':'text/plain'}});
    let data={};
    if(route.endsWith('/teacher-messages'))data={items:teacherNotes,unread:teacherNotes.filter(item=>!item.readAt).length};
    else if(/\/teacher-messages\/1\/(read|notified)$/.test(route)){assert.equal(options.method,'POST');teacherNotes[0][route.endsWith('/read')?'readAt':'notifiedAt']='2026-10-17 12:01:00';}
    else if(route.endsWith('/grades'))data={year:'2026',areas:[{id:'MAT',name:'Matemática',bimesters:['I','II','III','IV'].map((label,index)=>({label,unitNumbers:[index*2+1,index*2+2],code:index?'ne':'a',numericScore:null,inProgress:true,competencies:[],units:[1,2].map(offset=>({number:index*2+offset,title:'Nuestra unidad',code:offset===1&&index===0?'a':'ne',gradedSessions:offset===1&&index===0?1:0,sessionCount:offset===1&&index===0?1:0,inProgress:true,competencies:[],sessions:offset===1&&index===0?[{id:'session-1',number:'5',title:'<img src=x onerror=alert(1)> Aprendemos',code:'a',numericScore:null,observation:'Sigue así',competencies:[]}]:[]}))}))}]};
    else if(route.endsWith('/sessions'))data=[session];
    else if(route.endsWith('/portfolio-items'))data=portfolioItems;
    else if(route.endsWith('/academic-overview'))data={sessions,achievements:{}};
    else if(route.endsWith('/chat/groups'))data=[{id:1,name:'Grupo de prueba',memberCount:3}];
    else if(route.endsWith('/chat/peers'))data=[];
    else if(route.endsWith('/chat/groups/1/messages'))data=[{senderId:'test-student',senderName:'Estudiante',senderType:'student',text:'Consulta https://example.com/recurso?a=1&b=2. También www.example.org y <img src=x onerror=alert(1)> javascript:alert(1)',fileUrl:'/api/student-portal/chat/messages/1/file',fileName:'practica.html',fileType:'text/html',createdAt:'2026-10-06'}];
    else if(route.endsWith('/forum/draft'))data={data:{post:{},comments:{}},updatedAt:''};
    else if(route.endsWith('/forum/resources'))data={sessions:[],evidences:[],year:'2026'};
    else if(route.endsWith('/forum/notifications'))data={items:[],unread:0};
    else if(route.includes('/forum/posts?'))data={posts:[],total:0};
    else if(route.endsWith('/journal'))data=entries;
    else if(route.endsWith('/journal/session-1') && options.method==='PUT'){const submitted=JSON.parse(options.body);assert.deepEqual(submitted.evidenceIds,['1','2'],'Existing session evidence must be linked automatically');data={...submitted,id:'journal-1',sessionId:'session-1',sessionTitle:session.title,unitNumber:'1',sessionNumber:'5',revision:'saved-revision',evidences:[item]};entries=[data];}
    return new Response(JSON.stringify({success:true,data}),{headers:{'Content-Type':'application/json'}});
  };
  const timers = new Set();
  const schedule=(callback,delay=0)=>{const timer=setTimeout(()=>{timers.delete(timer);try{callback();}catch(error){errors.push(error);}},delay>100 ? 0:delay);timers.add(timer);return timer;};
  const context=vm.createContext({window,document,console:{...console,error:(...args)=>errors.push(args)},sessionStorage:store(storage),localStorage:store(local),location:{hash:'',pathname:'/estudiante',search:'',reload(){}},history:{replaceState(){}},navigator:{clipboard:{writeText:async value=>{copiedLink=value;}}},fetch,Response,AbortController,DOMException,Blob,URL,URLSearchParams,FormData,Intl,Date,JSON,CSS:{escape:String},crypto:globalThis.crypto,MutationObserver:window.MutationObserver,requestAnimationFrame:callback=>schedule(callback),setTimeout:schedule,clearTimeout,setInterval:()=>1,clearInterval(){},alert(){},confirm:()=>true,Event:window.Event});
  const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setTimeout(resolve,5));};
  try {
    for(const script of document.querySelectorAll('script')){
      const src=script.getAttribute('src');
      vm.runInContext(src?fs.readFileSync(`backend/public/${src.split('/').pop()}`,'utf8'):script.textContent,context,{filename:src || 'student-portal-inline.js'});
      if(brokenPortfolio && src?.endsWith('/student-portfolio.js'))window.armiStudentPortfolio.create=()=>{throw new Error('Simulated portfolio module failure');};
    }
    await flush();
    if(unavailable){assert.equal(storage.get('armiStudentToken'),'test-token','A temporary tunnel outage must preserve the saved student session');assert.equal(document.getElementById('loginView').classList.contains('hidden'),false);return;}
    assert.equal(document.querySelector('[data-student-page="home"]').classList.contains('active'),true,'Inicio must be visible after login');
    assert.ok(document.getElementById('studentMetrics').children.length>0,'Home metrics must finish loading');
    const buttons=[...document.querySelectorAll('.student-sidebar [data-student-target]')];
    assert.equal(buttons.length,12);
    for(const button of buttons){assert.equal(typeof button.onclick,'function',`Missing click handler: ${button.dataset.studentTarget}`);button.onclick();await flush();assert.equal(document.querySelector(`[data-student-page="${button.dataset.studentTarget}"]`).classList.contains('active'),true,`Tab failed: ${button.dataset.studentTarget}`);}
    if(brokenPortfolio){assert.ok(errors.length>0);return;}
    assert.deepEqual(errors,[],'The complete portal must initialize without runtime errors');
    document.querySelector('[data-student-target="grades"]').onclick();await flush();
    assert.equal(document.querySelectorAll('[data-sg-period]').length,4);
    assert.equal(document.querySelectorAll('.sg-unit-heading').length,2,'Each bimester displays its two units in one table');
    assert.equal(document.querySelectorAll('.sg-table').length,1);
    assert.equal(document.querySelectorAll('.sg-session').length,1);
    assert.match(document.getElementById('studentGrades').textContent,/Logro esperado/);
    assert.match(document.getElementById('studentGrades').textContent,/Pendiente/);
    assert.equal(document.querySelectorAll('#studentGrades img').length,0,'Session titles must be escaped');
    document.querySelector('[data-sg-detail]').onclick();
    assert.match(document.querySelector('.sg-detail-row').textContent,/Sigue así/);
    assert.equal(document.querySelector('[data-sg-detail]').getAttribute('aria-expanded'),'true');
    document.querySelector('[data-sg-period="II"]').onclick();
    assert.match(document.querySelector('.sg-summary').textContent,/Unidades 3 y 4/);
    assert.equal(document.querySelectorAll('.sg-session').length,0,'Changing the period scopes the sessions');
    const gradeView=document.querySelector('[data-sg-view]');gradeView.value='unit';gradeView.onchange({target:gradeView});
    const gradeUnit=document.querySelector('[data-sg-unit]');gradeUnit.value='1';gradeUnit.onchange({target:gradeUnit});
    assert.equal(document.querySelectorAll('.sg-unit-heading').length,1);
    assert.equal(document.querySelectorAll('.sg-session').length,1);
    assert.equal(document.querySelectorAll('.sg-bimester-result').length,0);
    assert.match(document.querySelector('.sg-summary').textContent,/Unidad 1/);
    assert.equal(document.getElementById('profileNotifications'),null,'The notification switch must not exist');
    assert.ok(document.querySelector('.teacher-toast'),'Teacher notice must appear even while viewing grades');
    assert.equal(document.querySelectorAll('.teacher-toast img').length,0);
    assert.equal(teacherNotes[0].readAt,null,'Navigating to messages does not read the notice automatically');
    document.querySelector('[data-teacher-toast-open]').onclick();await flush();
    assert.equal(document.querySelector('[data-student-page="messages"]').classList.contains('active'),true);
    assert.match(document.querySelector('.teacher-message-body').textContent,/Revisa la entrega/);
    assert.equal(document.querySelectorAll('.teacher-message-body img').length,0);
    assert.ok(teacherNotes[0].readAt);
    assert.equal(document.querySelector('.teacher-toast'),null);
    document.querySelector('.student-sidebar [data-student-target="messages"]').onclick();await flush();
    document.querySelector('[data-chat="1"]').onclick();await flush();
    const links=[...document.querySelectorAll('.chat-link a')];assert.equal(links.length,2);assert.equal(links[0].getAttribute('href'),'https://example.com/recurso?a=1&b=2');assert.equal(links[1].getAttribute('href'),'https://www.example.org/');
    assert.equal(document.querySelectorAll('.chat-bubble img').length,0,'Message HTML must remain escaped');
    await document.querySelector('[data-chat-copy-link]').onclick();assert.equal(copiedLink,'https://example.com/recurso?a=1&b=2');
    await document.querySelector('[data-chat-file]').onclick();await flush();
    const chatFrame=document.getElementById('evidenceViewerBody').querySelector('iframe');assert.ok(chatFrame,'Chat files must preview inside the portal');assert.equal(chatFrame.getAttribute('sandbox'),'allow-scripts allow-forms allow-modals');assert.match(chatFrame.srcdoc,/connect-src 'none'/);
    document.getElementById('closeEvidenceViewer').onclick();
    document.querySelector('.student-sidebar [data-student-target="portfolio"]').onclick();await flush();
    assert.equal(typeof document.getElementById('downloadZip').onclick,'function');
    assert.equal(typeof document.getElementById('downloadPdf').onclick,'function');
    document.querySelector('[data-pf-view]').onclick();await flush();
    assert.equal(document.getElementById('evidenceViewer').hidden,false,'Portfolio preview must use the shared viewer');
    assert.ok(document.getElementById('evidenceViewerBody').querySelector('iframe'));
    document.getElementById('closeEvidenceViewer').onclick();
    // Delivery previews still use the file URL API.
    context.testEvidence=item;
    vm.runInContext('state.files=[testEvidence]; void openEvidence(testEvidence.fileUrl)',context);
    await flush();
    assert.equal(document.getElementById('evidenceViewer').hidden,false);
    document.getElementById('closeEvidenceViewer').onclick();
    document.querySelector('[data-pf-tab="journal"]').onclick();await flush();
    assert.equal(document.getElementById('pf-journal').hidden,false);
    assert.equal(document.querySelectorAll('.pf-journal-entry').length,3,'Sessions must appear before any journal has been written');
    assert.equal(document.querySelectorAll('.pf-journal-unit').length,2,'Sessions are grouped by unit');
    const journalFilters=document.querySelector('[data-pf-journal-filters]');
    assert.equal(journalFilters.querySelector('[data-pf-filter="unit"]').querySelectorAll('option').length,3,'Unit filters come from existing session data');
    assert.equal(journalFilters.querySelector('[data-pf-filter="session"]').querySelectorAll('option').length,3);
    const firstEntry=document.querySelector('[data-pf-journal-session="session-1"]');
    assert.equal(firstEntry.querySelectorAll('[data-pf-view]').length,2,'All submitted evidence appears automatically');
    assert.ok(firstEntry.querySelector('img').src.startsWith('blob:'),'Existing image thumbnails must load with student authentication');
    assert.equal(document.querySelector('[data-pf-journal-session="session-2"]').querySelectorAll('[data-pf-view]').length,1,'Evidence remains in its own session');
    const unitFilter=journalFilters.querySelector('[data-pf-filter="unit"]');unitFilter.value='2026|MAT|2';unitFilter.onchange();
    assert.equal(document.querySelectorAll('.pf-journal-entry').length,1);
    assert.ok(document.querySelector('[data-pf-journal-session="session-3"]'));
    const allUnits=journalFilters.querySelector('[data-pf-filter="unit"]');allUnits.value='';allUnits.onchange();
    const search=journalFilters.querySelector('[data-pf-filter="search"]');search.value='costos.png';search.oninput();assert.equal(document.querySelectorAll('.pf-journal-entry').length,1);search.value='';search.oninput();
    document.querySelector('[data-pf-new]').onclick();await flush();
    const form=document.querySelector('.pf-journal-editor'),input=form.querySelector('[name="activities"]');
    input.value='Organicé los datos de mi proyecto.';form.oninput({target:input});
    assert.ok([...local.values()].some(value=>value.includes(input.value)),'Journal must keep a local draft');
    await form.onsubmit({preventDefault(){}});await flush();
    assert.equal(document.querySelectorAll('.pf-journal-entry').length,3);
    assert.match(document.querySelector('[data-pf-journal-session="session-1"]').textContent,/Organicé los datos/);
    portfolioItems.push({...item,id:'4',fileName:'avance.png',fileType:'image/png',thumbnailUrl:'/api/evaluacion/evidencias/4/thumbnail'});
    document.querySelector('.student-sidebar [data-student-target="portfolio"]').onclick();await flush();
    const refreshed=document.querySelector('[data-pf-journal-session="session-1"]');
    assert.equal(refreshed.querySelectorAll('[data-pf-view]').length,3,'New deliveries must appear in an existing journal');
    assert.match(refreshed.textContent,/Organicé los datos/,'Automatic evidence refresh must preserve the student text');
    // Exercise the real file-picker handlers and draft placement for each product.
    context.requestedTestSession = { ...session, available: true, studentEvidenceCount: 0, requestedEvidences: [
      { id: 'interview', text: 'Entrevista <img src=x onerror=alert(1)>', source: 'primary', competency: 'Área', color: '#334155' },
      { id: 'digital', text: 'Presentación digital', source: 'transversal', competency: 'Entornos virtuales', color: '#007c59' },
    ] };
    vm.runInContext('state.selected=requestedTestSession;state.files=[];state.filesToUpload=[];state.fileDetails={};state.replaceEvidenceId=null;renderRequestedSlots()', context);
    assert.equal(document.querySelectorAll('[data-requested-input]').length, 2);
    assert.equal(document.querySelector('#requestedEvidenceSlots img'), null, 'Requested evidence text must remain escaped');
    const selectFiles = (id, files) => {
      const picker = document.querySelector(`[data-requested-input="${id}"]`);
      Object.defineProperty(picker, 'files', { configurable: true, value: files });
      picker.onchange();
    };
    selectFiles('interview', [{ name: 'entrevista-1.txt', size: 25, type: 'text/plain', lastModified: 1 }, { name: 'entrevista-2.txt', size: 25, type: 'text/plain', lastModified: 2 }]);
    const firstDraft = document.querySelector('[data-requested-drafts="interview"] textarea');
    firstDraft.value = 'Primera parte de la entrevista'; firstDraft.oninput();
    selectFiles('digital', [{ name: 'presentacion.txt', size: 30, type: 'text/plain', lastModified: 3 }]);
    assert.equal(document.querySelectorAll('[data-requested-drafts="interview"] [data-file-draft]').length, 2);
    assert.equal(document.querySelectorAll('[data-requested-drafts="digital"] [data-file-draft]').length, 1);
    assert.equal(document.querySelector('[data-requested-drafts="interview"] textarea').value, 'Primera parte de la entrevista');
    vm.runInContext('renderRequestedSlots()', context); // Periodic refresh must retain both files and descriptions.
    assert.equal(document.querySelectorAll('[data-requested-drafts="interview"] [data-file-draft]').length, 2);
    document.querySelector('[data-requested-drafts="digital"] [data-remove-draft]').onclick();
    assert.equal(document.querySelectorAll('[data-requested-drafts="digital"] [data-file-draft]').length, 0);
    assert.equal(document.querySelectorAll('[data-requested-drafts="interview"] [data-file-draft]').length, 2);
    assert.equal(document.getElementById('uploadButton').disabled, false);
    vm.runInContext("state.files=[{id:99,requestedEvidence:requestedTestSession.requestedEvidences[0]}];state.replaceEvidenceId=99", context);
    const replacementPicker = document.getElementById('replaceInput');
    Object.defineProperty(replacementPicker, 'files', { configurable: true, value: [{ name: 'nueva-version.txt', size: 30, type: 'text/plain', lastModified: 4 }] });
    replacementPicker.onchange({ target: replacementPicker });
    assert.equal(document.getElementById('requestedEvidenceSlots').hidden, true);
    document.querySelector('[data-remove-draft]').onclick();
    assert.equal(document.getElementById('requestedEvidenceSlots').hidden, false, 'Canceling a replacement must restore the product pickers');
    assert.equal(document.querySelectorAll('[data-requested-input]').length, 2);
    assert.deepEqual(errors,[]);
  } finally {timers.forEach(clearTimeout);}
}

await run();
await run({brokenPortfolio:true});
console.log('OK: inicio, doce apartados, calificaciones por bimestre/unidad, portafolio y vista previa; navegación conservada si falla el módulo de portafolio.');

await run({unavailable:true});
