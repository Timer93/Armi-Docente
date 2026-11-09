import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
import React,{act} from 'react';

const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,Node:window.Node,IS_REACT_ACT_ENVIRONMENT:true});
const source=fs.readFileSync('components/sessions-view/useSessionLoader.ts','utf8');
const names=source.match(/import\s*\{([^}]+)\}\s*from '\.\/shared'/s)[1].split(',').map(name=>name.trim()).filter(Boolean);
const shared=names.map(name=>`export const ${name}=${['ENFOQUE_DETAILS','instrumentTypeLabelMap'].includes(name)?'{}':name==='TRANSVERSAL_NAMES'?'[]':name==='cloneInitialSessionData'?'()=>({})':'(value)=>value'};`).join('\n');
const dataModule=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const hook=registerHooks({
  resolve(specifier,context,next){
    if(specifier==='./shared')return {url:dataModule(shared),shortCircuit:true};
    if(specifier==='./sessionAiSupport')return {url:dataModule('export const ensureSessionExtraBlocks=value=>value;export const buildDefaultAreaTemplateSessionData=()=>({});'),shortCircuit:true};
    if(specifier==='../../services/apiService')return {url:dataModule('export const getSesion=(...args)=>globalThis.__loaderRead(...args);export const getUnidadDidactica=async()=>null;export const getCompetencias=async()=>[];'),shortCircuit:true};
    return next(specifier,context);
  },
  load(url,context,next){if(url.endsWith('/useSessionLoader.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText};return next(url,context);},
});
let root;
try {
  const {createRoot}=await import('react-dom/client');
  const {useSessionLoader}=await import(pathToFileURL(path.resolve('components/sessions-view/useSessionLoader.ts')).href);
  let state={},reads=0,toasts=0,pending;
  globalThis.__loaderRead=async(_year,_area,_grade,section)=>{reads++;if(section==='B')return new Promise(resolve=>{pending=resolve;});return {title:'Saved '+section,date:'2026-11-03'};};
  const params={ready:false,selArea:'EPT',selGrade:'5to',selSection:'A',unitNumber:'7',sessionNumber:'8',year:'2026',assignments:[{areaName:'EPT',areaId:'1'}],allSavedPrograms:{},bimesterLabel:'IV',
    sessionLoadRequestRef:{current:0},lastSelectionKeyRef:{current:''},setSessionData:value=>{state=typeof value==='function'?value(state):value;},setDateOptions(){},setSessionDate(){},setCompetenciasBase(){},setMaxSessionsInUnit(){},setToast(){toasts++;},loadTemplateRowsByInstrument:async()=>[],hydrateMissingInstrumentTemplate:async data=>({data,hydrated:false})};
  const Harness=props=>{useSessionLoader(props);return React.createElement('div',null,'Editor');};
  root=createRoot(document.getElementById('root'));
  const render=async props=>act(async()=>{root.render(React.createElement(Harness,props));});
  await render(params);assert.equal(reads,0,'Do not load before the initial assignments/programs arrive');
  await render({...params,ready:true});assert.equal(reads,1);assert.equal(toasts,1);
  state={...state,title:'Unsaved teacher draft'};
  await render({...params,ready:true,assignments:[...params.assignments],allSavedPrograms:{unrelated:{new:true}}});
  assert.equal(reads,1,'Replacing equivalent source containers must not reload the lesson');
  assert.equal(state.title,'Unsaved teacher draft');assert.equal(toasts,1,'Background rendering must not repeat the loaded toast');
  await render({...params,ready:true,selSection:'B'});assert.equal(reads,2);
  await render({...params,ready:true,selSection:'C'});assert.equal(state.title,'Saved C');
  await act(async()=>pending({title:'Late reply from B',date:'2026-11-03'}));
  assert.equal(state.title,'Saved C','An old selection response cannot overwrite the current lesson');
  console.log('OK: one load per selection, initial-source gate, unsaved draft and toast stability, and cancellation of stale section responses.');
} finally {if(root)await act(async()=>root.unmount());hook.deregister();delete globalThis.__loaderRead;}
