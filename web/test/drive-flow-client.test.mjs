import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../frontend/drive-flow.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'flow'});
function fixture(){const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};const context={window:{sessionStorage:storage}};vm.runInNewContext(bundle.outputFiles[0].text,context);return{api:context.flow,storage,data,context};}
const profile={email:'teacher@example.test',revision:4};
test('same-tab Drive continuation survives legacy storage replacement and consumes a selection once',()=>{
 const {api,storage,context}=fixture();context.window.sessionStorage={};assert.equal(api.driveFlowStorage(),storage);
 api.saveDriveFlow(storage,{kind:'picker',teacherId:'teacher-A',mode:'folder',requestId:'nonce',...profile});
 api.finishDrivePicker(storage,'nonce','folder',['selected-folder-123']);
 assert.equal(api.takeDriveSelection(storage,'teacher-A',profile).ids[0],'selected-folder-123');
 assert.equal(api.takeDriveSelection(storage,'teacher-A',profile),null);
});
test('same-tab continuation rejects changed teachers, revisions, Google accounts, expired and mismatched selections',()=>{
 for(const change of [{teacher:'teacher-B'},{profile:{...profile,revision:5}},{profile:{...profile,email:'other@example.test'}}]){
  const {api,storage}=fixture();api.saveDriveFlow(storage,{kind:'picker',teacherId:'teacher-A',mode:'folder',requestId:'nonce',...profile});
  api.finishDrivePicker(storage,'nonce','folder',['selected-folder-123']);
  assert.equal(api.takeDriveSelection(storage,change.teacher||'teacher-A',change.profile||profile),null);
 }
 const {api,storage}=fixture();api.saveDriveFlow(storage,{kind:'picker',teacherId:'teacher-A',mode:'folder',requestId:'nonce',...profile});
 assert.throws(()=>api.finishDrivePicker(storage,'other-nonce','folder',['selected-folder-123']));
 assert.throws(()=>api.finishDrivePicker(storage,'nonce','files',['selected-folder-123']));
 api.saveDriveFlow(storage,{kind:'connect',teacherId:'teacher-A'},1000);assert.equal(api.readDriveFlow(storage,1000+16*60*1000),null);
});

test('a selection saved inside Picker returns only to the matching committed revision',()=>{
 const {api,storage}=fixture();
 api.saveDriveFlow(storage,{kind:'picker',teacherId:'teacher-A',mode:'folder',requestId:'nonce',...profile});
 assert.throws(()=>api.finishDrivePicker(storage,'nonce','folder',['selected-folder-123'],profile.revision+2));
 api.finishDrivePicker(storage,'nonce','folder',['selected-folder-123'],profile.revision+1);
 assert.equal(api.takeDriveSelection(storage,'teacher-A',{...profile,revision:profile.revision+1}).savedRevision,profile.revision+1);
 assert.equal(api.takeDriveSelection(storage,'teacher-A',{...profile,revision:profile.revision+1}),null);
});
