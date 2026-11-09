import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import React, {act} from 'react';

const {window}=parseHTML('<html><body><div id="root"></div><button id="outside">Outside</button></body></html>');
const prior=Object.fromEntries(['window','document','HTMLElement','Node','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,globalThis[key]]));
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Node:window.Node,
  ResizeObserver:class {observe(){} disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true});
globalThis.__armiTransferStatus={config:{mode:'drive_mirror'},hasUnsyncedChanges:false,
  continuousSync:{state:'syncing',progress:{phase:'copying',completedFiles:2,totalFiles:5,completedBytes:2048,totalBytes:4096,currentFile:'uploads/practica.html'}},
  incrementalSync:{state:'in-sync',pendingOperations:0},
  downloadProgress:{state:'transferring',completedFiles:1,totalFiles:3,completedBytes:1024,totalBytes:4096},
  activeTransfers:[{state:'downloading',fileName:'evidencia.pdf',relativePath:'uploads/evidencia.pdf',copiedBytes:1024,totalBytes:4096}]};
const hook=registerHooks({
  resolve(specifier,context,next) {
    if(specifier==='./SyncDeliveryDetails')
      return {url:pathToFileURL(path.resolve('components/SyncDeliveryDetails.tsx')).href,shortCircuit:true};
    if(specifier==='../services/apiService') return {url:'data:text/javascript,export const resolveResourceFileConflict=async()=>({success:true});export const getLocalCloudSyncStatus=async()=>({success:true,data:structuredClone(globalThis.__armiTransferStatus)});',shortCircuit:true};
    if(specifier==='../utils/backgroundSyncStatus' || specifier==='../utils/cloudSyncState' || specifier==='../utils/panelPolling')
      return {url:pathToFileURL(path.resolve(specifier.replace('../','')+'.ts')).href,shortCircuit:true};
    return next(specifier,context);
  },
  load(url,context,next) {
    if(url.startsWith('file:') && /\.(tsx|ts)$/.test(url)) return {format:'module',shortCircuit:true,
      source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText};
    return next(url,context);
  },
});
let root;
try {
  const {createRoot}=await import('react-dom/client');
  const {BackgroundSyncIndicator}=await import('../components/BackgroundSyncIndicator.tsx');
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(BackgroundSyncIndicator,{collapsed:false,ready:true,error:'',onRetry(){}}));});
  const buttons=()=>[...document.querySelectorAll('button[aria-haspopup="dialog"]')];
  assert.equal(buttons().length,2);
  assert.match(buttons()[0].textContent,/2\/5 arch\./);
  assert.match(buttons()[1].textContent,/1\/3 arch\./);
  await act(async()=>buttons()[0].dispatchEvent(new window.Event('mouseover',{bubbles:true})));
  assert.match(document.querySelector('[role="dialog"]').textContent,/practica.html/);
  assert.match(document.querySelector('[role="dialog"]').textContent,/3 archivos pendientes/);
  assert.match(document.querySelector('[role="dialog"]').textContent,/Servidores de Google Drive/);
  assert.match(document.querySelector('[role="dialog"]').textContent,/adjuntos se comprueban por separado/);
  await act(async()=>buttons()[0].click());
  await act(async()=>document.getElementById('outside').dispatchEvent(new window.Event('mouseover',{bubbles:true})));
  assert.ok(document.querySelector('[role="dialog"]'),'Click keeps the detail pinned');
  await act(async()=>buttons()[1].click());
  assert.match(document.querySelector('[role="dialog"]').textContent,/evidencia.pdf/);
  const escape=new window.Event('keydown',{bubbles:true});escape.key='Escape';
  await act(async()=>document.dispatchEvent(escape));
  assert.equal(document.querySelector('[role="dialog"]'),null);
  await act(async()=>buttons()[0].click());
  await act(async()=>document.getElementById('outside').dispatchEvent(new window.Event('pointerdown',{bubbles:true})));
  assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(buttons()[0].getAttribute('aria-expanded'),'false');
  globalThis.__armiTransferStatus.resourceConflicts = [{ id: 'a'.repeat(64), title: 'Sesión 5 · Práctica', fileName: 'practica.png', createdAt: new Date().toISOString(),
    versions: [{key:'local',label:'Este equipo',size:10,modifiedAt:new Date().toISOString()},{key:'mirror',label:'Carpeta espejo',size:11,modifiedAt:new Date().toISOString()}] }];
  await act(async()=>window.dispatchEvent(new window.Event('armi-cloud-sync-updated')));
  const conflictButton = [...document.querySelectorAll('button')].find(button=>button.textContent.includes('1 recurso con dos versiones'));
  assert.ok(conflictButton, 'Only actual unresolved resource conflicts show the discreet notice');
  await act(async()=>conflictButton.click());
  const dialog=document.querySelector('[aria-label="Recursos con dos versiones"]');
  assert.match(dialog.textContent,/Sesión 5 · Práctica/);
  assert.equal(dialog.querySelectorAll('a[download]').length,2);
  assert.equal([...dialog.querySelectorAll('button')].filter(button=>button.textContent==='Usar esta versión').length,2);
  globalThis.__armiTransferStatus.resourceConflicts=[];
  await act(async()=>[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Usar esta versión').click());
  assert.match(dialog.textContent,/Todo revisado/);
  console.log('OK: real file counts, hover detail, pinned click, switching directions, Escape and outside dismissal.');
} finally {
  if(root) await act(async()=>root.unmount());
  hook.deregister();delete globalThis.__armiTransferStatus;
  for(const [key,value] of Object.entries(prior)) {if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
}
