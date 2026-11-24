import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../frontend/drive-upload-client.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'upload'});
function fixture(){const context={crypto,AbortSignal,Date,fetch};vm.runInNewContext(bundle.outputFiles[0].text,context);return context.upload;}
const context={teacherId:'teacher-A',revision:3,parent:'folder-AAAAAA',parentName:'Materials'};

test('Upload client prepares content once, checks ownership and never automatically repeats an uncertain transfer',async()=>{
 const api=fixture(),file=new File(['example'],'Example.txt',{type:'text/plain'});let calls=0,owner=context.teacherId;
 const dependencies={owner:()=>owner,api:async(path,method,body)=>{assert.equal(path,'/api/drive/upload/prepare');assert.equal(body.parent,context.parent);assert.equal(body.sha256.length,64);return{ticket:'opaque-ticket',expiresAt:Date.now()+600000};}};
 const transfer=await api.prepareDriveUpload(file,context,dependencies);
 await assert.rejects(api.transferDriveUpload(transfer,false,{owner:()=>owner,fetcher:async()=>{calls++;throw new Error('network lost');}}),/Comprobar subida/);
 assert.equal(calls,1,'No blind write retry');
 const checked=await api.transferDriveUpload(transfer,true,{owner:()=>owner,fetcher:async(path,options)=>{
  assert.equal(path,'/api/drive/upload/status');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
  assert.equal(options.headers['x-armi-upload-ticket'],transfer.ticket);assert.equal(options.credentials,'same-origin');
  return Response.json({success:true,data:{uploaded:true}});
 }});
 assert.equal(checked.uploaded,true);
 owner='teacher-B';await assert.rejects(api.transferDriveUpload(transfer,false,{owner:()=>owner,fetcher:async()=>{assert.fail('Changed owner cannot send the file');}}),/cuenta/);
 await assert.rejects(api.prepareDriveUpload(new File([new Uint8Array(5000001)],'Big.bin'),context,dependencies));
});

test('Upload client sends the original bytes and returns safe server errors without exposing tickets',async()=>{
 const api=fixture(),file=new File(['body'],'Sample.txt',{type:'text/plain'}),transfer={file,context,ticket:'opaque-ticket',expiresAt:Date.now()+600000};
 const result=await api.transferDriveUpload(transfer,false,{owner:()=>context.teacherId,fetcher:async(path,options)=>{
  assert.equal(options.body,file);assert.equal(options.headers['content-type'],'application/octet-stream');
  return Response.json({success:true,data:{uploaded:true,file:{name:file.name}}});
 }});assert.equal(result.file.name,file.name);
 await assert.rejects(api.transferDriveUpload(transfer,false,{owner:()=>context.teacherId,fetcher:async()=>Response.json({success:false,message:'La carpeta cambió'},{status:409})}),/carpeta/);
});
