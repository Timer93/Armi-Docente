import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

const {window,document}=parseHTML('<html><body><main id="forum"></main></body></html>');
window.HTMLElement.prototype.scrollIntoView=()=>{};
window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};
window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
Object.defineProperty(window.HTMLElement.prototype,'elements',{get(){return Object.fromEntries([...this.querySelectorAll('[name]')].map(node=>[node.name,node]));}});
let photoOpens=0;
window.armiStudentPhotoViewer={open(){photoOpens++;}};
const attachments=['image','video','audio','pdf','html','download'].map(kind=>({id:kind,kind,name:`archivo.${kind}`,size:100,url:`/file/${kind}`}));
const post={id:'post1',authorId:'student2',authorName:'Estudiante de prueba',authorType:'student',grade:'5to',section:'A',profileUrl:'/profile/2',createdAt:new Date().toISOString(),title:'Proyecto',body:'Contenido',category:'aporte',attachments,commentCount:0,canComment:true};
const root=document.getElementById('forum');
const api=async url=>url.endsWith('/draft')?{data:{post:{},comments:{}}}:url.endsWith('/resources')?{sessions:[],evidences:[]}:url.endsWith('/notifications')?{items:[],unread:0}:{posts:[post],total:1,classroom:{year:'2026'},hasMore:false};
const context=vm.createContext({window,document,console,crypto:globalThis.crypto,URL,URLSearchParams,Blob,FormData,Intl,Date,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},localStorage:{getItem:()=>null,setItem(){}},fetch:async url=>new Response(String(url).endsWith('/html')?'<h1>Publicación</h1>':'contenido')});
vm.runInContext(fs.readFileSync('backend/public/student-forum.js','utf8'),context);
const controller=window.armiForumPortal.create(root,{api,token:()=> 'test-token',student:()=>({id:'student1'})});
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setTimeout(resolve,2));};
controller.open();await flush();
const avatar=root.querySelector('.forum-avatar');
assert.equal(avatar.hasAttribute('tabindex'),false);
assert.equal(avatar.getAttribute('role'),null);
avatar.dispatchEvent(new window.Event('click',{bubbles:true}));assert.equal(photoOpens,0);
for(const type of ['contextmenu','dragstart']){
  const event=new window.Event(type,{bubbles:true,cancelable:true});
  avatar.querySelector('img').dispatchEvent(event);assert.equal(event.defaultPrevented,true);
}
for(const file of attachments){
  root.querySelector(`[data-forum-file="${file.id}"]`).onclick();await flush();
  const dialog=document.querySelector('.forum-preview');assert.ok(dialog);
  assert.equal(dialog.querySelector('[data-forum-download],a[download]'),null);
  const event=new window.Event('contextmenu',{bubbles:true,cancelable:true});dialog.querySelector('.forum-preview-content').dispatchEvent(event);assert.equal(event.defaultPrevented,true);
  if(file.kind==='image')assert.equal(dialog.querySelector('img').getAttribute('draggable'),'false');
  if(['video','audio'].includes(file.kind))assert.match(dialog.querySelector(file.kind).getAttribute('controlslist'),/nodownload/);
  if(file.kind==='html'){const frame=dialog.querySelector('iframe');assert.equal(frame.getAttribute('sandbox'),'allow-scripts');assert.match(frame.srcdoc,/contextmenu/);assert.match(frame.srcdoc,/connect-src 'none'/);}
  if(file.kind==='download')assert.match(dialog.textContent,/Sin vista previa disponible/);
  dialog.querySelector('header button').onclick();
}
controller.reset();
console.log('OK: foro sin ampliación de perfiles ni botones de descarga; clic derecho y arrastre bloqueados; vistas previas conservadas.');
