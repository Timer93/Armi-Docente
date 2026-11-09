import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { parseHTML } from 'linkedom';
import React, { act } from 'react';

const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
window.localStorage = { getItem: () => null, setItem() {}, length: 0 };
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
  Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true });
const state = globalThis.__appPerformance = { session: null, imports: [], renders: 0, reads: 0, api: [] };
const session = { user: { id: 'teacher', displayName: 'Docente', permissions: { features: ['full_access'] } }, authenticatedAt: 'test' };
const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const source = fs.readFileSync('App.tsx', 'utf8');
const moduleMocks = {
  './components/auth/AuthContext': 'export const useAuth=()=>({loading:false,session:globalThis.__appPerformance.session,logout(){}});',
  './constants': "export const INITIAL_MODULE_STATUS={datos_generales:true,sesiones:true};",
  './services/apiService': `const state=globalThis.__appPerformance;
    export const bootstrapPortableState=()=>new Promise(()=>{});
    export const saveCloudFrontendState=async()=>({success:true});
    export const getModuleStatus=()=>{state.api.push('status');return new Promise(resolve=>state.status=resolve);};
    export const getDatosGenerales=()=>{state.api.push('general');return new Promise(resolve=>state.general=resolve);};
    export const getEstudiantes=async()=>[];`,
  './utils/cloudSyncState': `export const CLOUD_SYNC_EVENT='armi-cloud-sync-updated';
    export const collectArmiLocalState=()=>{globalThis.__appPerformance.reads++;return {};};
    export const applyArmiLocalState=()=>{};export const emitCloudSyncUpdated=()=>{};`,
  './utils/observePortableStorage': 'export const observePortableStorage=()=>()=>{};',
  './utils/backgroundSyncStatus': 'export const mergeRecoveryProgress=()=>({keys:{},baseline:{},changedKeys:[]});',
  './utils/moduleStateRefresh': "export const needsAcademicViewRefresh=(_before,after)=>Object.hasOwn(after,'armi_assignments');",
  './utils/sessionRegisterNavigation': "export const OPEN_SESSION_REGISTER_EVENT='open-register';export const isSessionRegisterTarget=()=>true;",
  './components/Sidebar': `import React from 'react';export const Sidebar=props=>{
    globalThis.__appPerformance.sidebar=props;return React.createElement('nav',null,'Menu');};`,
  './components/AppErrorBoundary': 'export const AppErrorBoundary=({children})=>children;',
  './components/GeneralNotesOverlay': 'export const GeneralNotesOverlay=()=>null;export const GeneralNotesFloatingButton=()=>null;',
  './components/DatosGeneralesView': `import React from 'react';export const DatosGeneralesView=()=>{
    globalThis.__appPerformance.renders++;return React.createElement('input',{defaultValue:'Draft',id:'draft'});};`,
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react' && context.parentURL?.startsWith('data:')) {
      return next(specifier, { ...context, parentURL: import.meta.url });
    }
    if (context.parentURL?.endsWith('/App.tsx')) {
      if (moduleMocks[specifier]) return { url: dataModule(moduleMocks[specifier]), shortCircuit: true };
      if (specifier.endsWith('.css')) return { url: dataModule(''), shortCircuit: true };
      if (specifier.startsWith('./components/')) {
        state.imports.push(specifier);
        const name = specifier.split('/').at(-1);
        return { url: dataModule(`import React from 'react';export const ${name}=()=>React.createElement('div',null,'${name}');`), shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('/App.tsx')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
let root;
try {
  const { createRoot } = await import('react-dom/client');
  const { default: App } = await import(pathToFileURL(path.resolve('App.tsx')).href);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(App)));
  assert.equal(state.imports.some(name => name.endsWith('/SessionsView')), false, 'Login must not load the lesson editor');
  state.session = session;
  await act(async () => root.render(React.createElement(App)));
  assert.deepEqual(state.api, ['status', 'general'], 'Independent initial requests must start together');
  const draft = document.getElementById('draft');
  draft.value = 'Unsaved lesson';
  const renders = state.renders, reads = state.reads;
  await act(async () => state.sidebar.toggleCollapse());
  assert.equal(state.renders, renders, 'Sidebar changes must not render the open workspace again');
  assert.equal(state.reads, reads, 'Routine app renders must not scan local storage');
  await act(async () => { state.status({ datos_generales: true, sesiones: true }); state.general({ teacher: 'Updated teacher' }); });
  assert.equal(state.renders, renders, 'Teacher/status responses must preserve the workspace render');
  assert.equal(document.getElementById('draft'), draft);
  assert.equal(draft.value, 'Unsaved lesson');
  await act(async () => window.dispatchEvent(new window.CustomEvent('armi-cloud-sync-updated', { detail: { changedKeys: ['armi_assignments'] } })));
  assert.equal(state.renders, renders + 1, 'Real academic updates must still remount the workspace');
  await act(async () => state.sidebar.onPrepareNavigate('sesiones'));
  assert.equal(state.imports.filter(name => name.endsWith('/SessionsView')).length, 1, 'Menu intent must prepare the selected module');
  assert.ok(document.getElementById('draft'), 'Preparing a module must preserve the current workspace');
  await act(async () => state.sidebar.onNavigate('sesiones', 'sesiones'));
  assert.equal(state.imports.filter(name => name.endsWith('/SessionsView')).length, 1);
  assert.match(document.body.textContent, /SessionsView/, 'Lazy navigation must display the selected workspace');
  await act(async () => state.sidebar.onNavigate('datos_generales'));
  await act(async () => state.sidebar.onNavigate('sesiones', 'sesiones'));
  assert.equal(state.imports.filter(name => name.endsWith('/SessionsView')).length, 1, 'The loaded workspace must be reused');
  console.log('OK: lazy module navigation, cached imports, parallel startup requests, stable editor drafts and academic refresh.');
} finally {
  if (root) await act(async () => root.unmount());
  hook.deregister();
  delete globalThis.__appPerformance;
}
