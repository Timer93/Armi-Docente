import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import React,{act} from 'react';
const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
const prior=Object.fromEntries(['window','document','HTMLElement','Node','localStorage','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,globalThis[key]]));
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Node:window.Node,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},IS_REACT_ACT_ENVIRONMENT:true});
let restarted=0;
let remote={success:false,message:'No responde el portal local',data:{tunnelStatus:'ERROR',enabledByTeacher:true,lastError:'No responde el portal local',publicUrl:'',pendingAccessDurationMs:60000}};
globalThis.__armiRemoteMock=async name=>{
  if(name==='getRemoteAccessStatus')return remote;
  if(name==='getRemoteAccessStudents')return {success:true,data:{students:[]}};
  if(name==='getEstudiantes')return [];
  if(name==='getProgramacionesAnuales'||name==='getSessionIndex')return {};
  if(name==='getDatosGenerales')return {year:'2026'};
  if(name==='getEvaluacionEvidencias')return {success:true,data:[]};
  if(name==='getEvidenceStorageConfig')return {success:true,data:{portalUrls:[]}};
  if(name==='restartRemoteAccess'){
    restarted++;remote={success:true,data:{...remote.data,tunnelStatus:'CONNECTED',publicUrl:'https://example.invalid',lastError:null}};return remote;
  }
  return {success:true,data:{}};
};
const source=fs.readFileSync('components/evaluation/EvidenceBank.tsx','utf8');
const names=source.match(/import\s*\{([^}]+)\}\s*from\s*'\.\.\/\.\.\/services\/apiService'/s)[1].split(',').map(name=>name.trim()).filter(Boolean);
const hook=registerHooks({resolve(specifier,context,next){
  if(specifier==='../../services/apiService')return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(names.map(name=>`export const ${name}=(...args)=>globalThis.__armiRemoteMock(${JSON.stringify(name)},...args);`).join('\n'))};
  if(['./StudentChatMonitor','./TeacherMessages','./StudentForumMonitor'].includes(specifier))return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(`export const ${specifier.slice(2)}=()=>null;`)};
  if(specifier.startsWith('.')) {
    const base=new URL(specifier,context.parentURL);
    for(const ext of ['.ts','.tsx']) if(fs.existsSync(new URL(base.href+ext))) return {shortCircuit:true,url:base.href+ext};
  }
  return next(specifier,context);
},load(url,context,next){
  if(url.startsWith('file:')&&/\.(tsx|ts)$/.test(url))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText};
  return next(url,context);
}});
let root;
try {
  const {createRoot}=await import('react-dom/client');
  const {EvidenceBank}=await import('../components/evaluation/EvidenceBank.tsx');
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(EvidenceBank)));
  const retry=[...document.querySelectorAll('button')].find(button=>/Reintentar acceso|Reintentar enlace|Reintentar/i.test(button.textContent));
  assert.ok(retry,'A valid ERROR response must expose the link retry button');
  assert.equal(retry.disabled,false);
  assert.ok(!document.body.textContent.includes('Recuperando servicio local'));
  await act(async()=>retry.click());
  assert.equal(restarted,1);
  assert.match(document.body.textContent,/Acceso remoto conectado|Conectado/);
  console.log('OK: a reported tunnel error keeps the backend available and permits a successful retry.');
} finally {
  if(root)await act(async()=>root.unmount());hook.deregister();delete globalThis.__armiRemoteMock;
  for(const [key,value]of Object.entries(prior)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
}
