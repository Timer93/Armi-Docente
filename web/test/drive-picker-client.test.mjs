import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const output=await build({entryPoints:[fileURLToPath(new URL('../frontend/drive-picker.ts',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'}});
const code=output.outputFiles[0].text;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({mode='folder',opener=true,apiError='',sdkError=false,holdScript=false,sameTab=false,writeError='',holdWrite=false,expectedRevision}={}){
 const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 if(sameTab)data.set('armi-drive-flow',JSON.stringify({kind:'picker',teacherId:'teacher-A',mode,requestId:'00000000-0000-4000-8000-000000000000',revision:1,email:'a@example.test',expiresAt:Date.now()+600000}));
 const ids=['picker-shell','picker-spinner','picker-status','picker-cancel','picker-retry','picker-help','picker-explanation','picker-error-title','picker-return'];
 const elements=Object.fromEntries(ids.map(id=>[id,{hidden:['picker-retry','picker-help','picker-explanation','picker-error-title','picker-return'].includes(id),textContent:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;}}]));
 const messages=[],calls=[],state={closed:false,reloaded:false,callback:null,script:null,locale:'',visible:false,maxItems:0,timer:null,parent:null,viewMode:null};
 class DocsView{setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}setMimeTypes(){return this;}setMode(value){state.viewMode=value;return this;}setParent(value){state.parent=value;return this;}}
 class PickerBuilder{
  addView(){return this;}setOAuthToken(value){assert.equal(value,'fixture-short-lived-token');return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOrigin(){return this;}
  setLocale(value){state.locale=value;return this;}setCallback(callback){state.callback=callback;return this;}
  enableFeature(){return this;}setMaxItems(value){state.maxItems=value;return this;}build(){return{setVisible(value){state.visible=value;}};}
 }
 const window={sessionStorage:storage,location:{search:'?mode='+mode+'&requestId=00000000-0000-4000-8000-000000000000'+(sameTab?'&flow=tab':'')+(expectedRevision?'&revision='+expectedRevision:''),origin:'https://web.armi.test',reload(){state.reloaded=true;},replace(url){state.redirect=url;}},
  opener:opener?{postMessage(message,origin){messages.push({message,origin});}}:null,
  close(){state.closed=true;},setTimeout(callback){state.timer=callback;return 1;},clearTimeout(){state.timer=null;},
  gapi:{load(_name,options){options.callback();}},google:{picker:{DocsView,PickerBuilder,DocsViewMode:{LIST:'list'},ViewId:{DOCS:'docs'},Action:{PICKED:'picked',CANCEL:'cancel'},Feature:{MULTISELECT_ENABLED:'multi'}}},
 };
 const document={getElementById(id){return elements[id];},createElement(){return{};},head:{appendChild(script){state.script=script;if(!holdScript)queueMicrotask(()=>sdkError?script.onerror():script.onload());}}};
 const fetch=async(url,options)=>{
  calls.push({url,options});
  if(url!=='/api/drive/picker-config'){
   if(holdWrite)await new Promise(resolve=>{state.completeWrite=resolve;});
   return writeError?Response.json({success:false,message:writeError},{status:409}):Response.json({success:true,data:{linked:true}});
  }
  return apiError?Response.json({success:false,message:apiError},{status:503}):Response.json({success:true,data:{accessToken:'fixture-short-lived-token',developerKey:'fixture-restricted-key',appId:'123456789012',revision:1,teacherId:'teacher-A',folderId:mode==='files'?'linked-root-123':null}});
 };
 vm.runInNewContext(code,{window,document,fetch,URLSearchParams,AbortSignal});
 await tick();await tick();
 return{elements,state,calls,messages,window,storage};
}

test('Picker starts at My Drive in list mode and saves the selection before notifying the parent',async()=>{
 const f=await fixture();assert.equal(f.state.visible,true);assert.equal(f.elements['picker-shell'].hidden,true);assert.equal(f.state.locale,'es');assert.equal(f.state.timer,null);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.credentials,'same-origin');assert.ok(f.calls[0].options.signal);
 assert.equal(f.state.parent,'root');assert.equal(f.state.viewMode,'list');
 f.state.callback({action:'picked',docs:[{id:'folder-selected-123'},{id:'invalid/url'}]});
 await tick();await tick();
 assert.equal(f.messages.length,1);assert.equal(f.messages[0].origin,'https://web.armi.test');
 assert.equal(JSON.stringify(f.messages[0].message),JSON.stringify({type:'armi-drive-saved',mode:'folder',requestId:'00000000-0000-4000-8000-000000000000'}));
 assert.equal(f.calls[1].url,'/api/drive/folder');assert.equal(f.calls[1].options.method,'PUT');assert.equal(f.calls[1].options.headers['x-armi-teacher-id'],'teacher-A');
 assert.deepEqual(JSON.parse(f.calls[1].options.body),{folder:'folder-selected-123',revision:1});
 assert.equal(f.state.closed,true);assert.ok(!JSON.stringify(f.messages).includes('fixture-short-lived-token'));
});

test('Picker in the same tab returns selected IDs without requiring an opener or exposing tokens',async()=>{
 const f=await fixture({sameTab:true,opener:false});assert.equal(f.state.visible,true);
 f.state.callback({action:'picked',docs:[{id:'selected-folder-123'}]});
 await tick();await tick();assert.equal(f.state.redirect,'/?armi-drive=saved');assert.equal(f.messages.length,0);
 const stored=JSON.parse(f.storage.getItem('armi-drive-flow'));assert.deepEqual(stored.ids,['selected-folder-123']);assert.equal(stored.savedRevision,2);assert.ok(!JSON.stringify(stored).includes('token'));
 const cancelled=await fixture({sameTab:true,opener:false});cancelled.state.callback({action:'cancel'});
 assert.equal(cancelled.state.redirect,'/?armi-drive=cancelled');assert.equal(cancelled.storage.getItem('armi-drive-flow'),null);
});

test('Picker keeps results when opener is lost, prevents duplicate saves and exposes save failures',async()=>{
 const f=await fixture({holdWrite:true});f.window.opener=null;
 f.state.callback({action:'picked',docs:[{id:'selected-folder-123'}]});
 f.state.callback({action:'picked',docs:[{id:'selected-folder-123'}]});
 assert.equal(f.calls.length,2);assert.equal(f.messages.length,0);assert.equal(f.state.closed,false);
 f.state.completeWrite();await tick();await tick();assert.equal(f.state.closed,true);assert.equal(f.elements['picker-return'].hidden,false);
 const failed=await fixture({writeError:'La conexión cambió'});failed.state.callback({action:'picked',docs:[{id:'selected-folder-123'}]});await tick();await tick();
 assert.equal(failed.state.closed,false);assert.equal(failed.messages.length,0);assert.equal(failed.elements['picker-status'].attributes.role,'alert');assert.equal(failed.elements['picker-spinner'].hidden,true);
 const stale=await fixture({expectedRevision:2});assert.equal(stale.state.visible,false);assert.equal(stale.calls.length,1);
 const invalid=await fixture();invalid.state.callback({action:'picked',docs:{}});assert.equal(invalid.calls.length,1);assert.equal(invalid.elements['picker-status'].attributes.role,'alert');
 const files=await fixture({mode:'files'});assert.equal(files.state.parent,'linked-root-123');
 files.state.callback({action:'picked',docs:[{id:'selected-file-123'}]});await tick();await tick();
 assert.deepEqual(files.calls.slice(1).map(call=>call.url),['/api/drive/selection','/api/drive/folder']);
});
test('Picker errors stop the spinner and offer retry/help without restarting OAuth',async()=>{
 for(const options of [{apiError:'Configuración pendiente'},{sdkError:true}]){
  const f=await fixture(options);assert.equal(f.elements['picker-shell'].hidden,false);assert.equal(f.elements['picker-spinner'].hidden,true);
  assert.equal(f.elements['picker-status'].attributes.role,'alert');assert.equal(f.elements['picker-help'].hidden,false);assert.equal(f.elements['picker-retry'].hidden,false);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/drive/picker-config');
  assert.ok(!JSON.stringify(f.elements).includes('fixture-short-lived-token'));f.elements['picker-retry'].onclick();assert.equal(f.state.reloaded,true);
 }
 const blocked=await fixture({holdScript:true});assert.equal(blocked.elements['picker-shell'].hidden,false);assert.ok(blocked.state.timer);
 blocked.state.timer();await tick();assert.equal(blocked.elements['picker-spinner'].hidden,true);assert.equal(blocked.elements['picker-help'].hidden,false);
});
test('Picker preserves opener validation, cancellation and bounded multiselect',async()=>{
 const detached=await fixture({opener:false});assert.equal(detached.calls.length,0);assert.equal(detached.elements['picker-retry'].hidden,true);assert.equal(detached.elements['picker-status'].attributes.role,'alert');
 const files=await fixture({mode:'files'});assert.equal(files.state.maxItems,20);files.state.callback({action:'cancel'});assert.equal(files.state.closed,true);assert.equal(files.messages.length,0);
});
