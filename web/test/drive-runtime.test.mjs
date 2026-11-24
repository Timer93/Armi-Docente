import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('workerd: real outbound fetch completes Drive OAuth and blocks redirects for tokens, files and AI', {timeout:60000}, async t=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const calls=[];let challenge='',redirectToken=false,redirectFile=false,redirectAI=false,uploaded=null,redirectUpload=false;
 const assets=fs.mkdtempSync(path.join(os.tmpdir(),'armi-picker-runtime-'));
 fs.copyFileSync(new URL('../public/drive-picker.html',import.meta.url),path.join(assets,'drive-picker.html'));
 t.after(()=>{fs.unlinkSync(path.join(assets,'drive-picker.html'));fs.rmdirSync(assets);});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'armi-picker-runtime',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-21',d1Databases:{DB:'armi-drive-runtime'},assets:{directory:assets,binding:'ASSETS',routerConfig:{has_user_worker:true},run_worker_first:['/api/*']},bindings:{
  ARMI_AUTH_APPS_SCRIPT_URL:'https://script.google.com/macros/s/runtime-fixture/exec',
  ARMI_GOOGLE_CLIENT_ID:'runtime.apps.googleusercontent.com',ARMI_GOOGLE_CLIENT_SECRET:'runtime-fixture-secret-only',
  ARMI_DRIVE_ENCRYPTION_KEY:'ab'.repeat(32),ARMI_AI_ENCRYPTION_KEY:'cd'.repeat(32),
  ARMI_DRIVE_REDIRECT_URI:'https://web.armi.test/api/drive/oauth/callback',
  ARMI_GOOGLE_PICKER_API_KEY:'AIza'+'a'.repeat(35),ARMI_GOOGLE_PROJECT_NUMBER:'123456789012',
 },outboundService:async request=>{
  const url=new URL(request.url);calls.push(url.origin+url.pathname);
  if(url.hostname==='script.google.com')return Response.json({success:true,data:{username:'runtime-teacher',displayName:'Runtime teacher',active:true,estado:'Habilitad@'}});
  if(url.href==='https://oauth2.googleapis.com/token'){
   if(redirectToken)return Response.redirect('https://untrusted.example/credentials',302);
   const form=new URLSearchParams(await request.text());
   assert.equal(form.get('grant_type'),'authorization_code');
   assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),challenge);
   return Response.json({access_token:'runtime-access-token',refresh_token:'runtime-refresh-token',expires_in:3600,scope:'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive'});
  }
  if(url.href==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'runtime-google-account',email:'runtime@example.test',email_verified:true});
  if(url.pathname==='/drive/v3/files/generateIds')return Response.json({ids:['runtime-upload-file']});
  if(url.pathname==='/drive/v3/files/runtime-upload-file')return uploaded?Response.json(uploaded):new Response('',{status:404});
  if(url.pathname==='/upload/drive/v3/files'){
   if(redirectUpload)return Response.redirect('https://untrusted.example/upload',307);
   const bytes=Buffer.from(await request.arrayBuffer()),boundary=request.headers.get('content-type').split('boundary=')[1];
   const first=bytes.indexOf('\r\n\r\n')+4,end=bytes.indexOf('\r\n--'+boundary,first),metadata=JSON.parse(bytes.subarray(first,end).toString());
   const start=bytes.indexOf('\r\n\r\n',end)+4,last=bytes.lastIndexOf('\r\n--'+boundary),body=bytes.subarray(start,last);
   assert.equal(body.toString(),'runtime-upload-body');assert.equal(metadata.parents[0],'runtime-folder-root');
   uploaded={...metadata,size:String(body.length),sha256Checksum:createHash('sha256').update(body).digest('hex')};
   return Response.json({id:metadata.id});
  }
  if(url.pathname==='/drive/v3/files/runtime-folder-root')return Response.json({id:'runtime-folder-root',name:'My Drive folder',mimeType:'application/vnd.google-apps.folder',parents:[]});
  if(url.pathname==='/drive/v3/files')return Response.json({files:[]});
  if(url.pathname==='/drive/v3/files/runtime-image-file'){
   if(url.searchParams.get('alt')==='media')return redirectFile?Response.redirect('https://untrusted.example/content',302):new Response('fixture-image');
   return Response.json({id:'runtime-image-file',name:'Evidence.png',mimeType:'image/png',parents:['runtime-folder-root'],size:'13'});
  }
  if(url.hostname==='generativelanguage.googleapis.com')return redirectAI?Response.redirect('https://untrusted.example/ai',307):Response.json({models:[{name:'models/gemini-runtime',displayName:'Runtime fixture',supportedGenerationMethods:['generateContent']}]});
  assert.fail('Unexpected outbound destination: '+url.origin+url.pathname);
 }}));
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 for(const file of ['0001_identity.sql','0007_ai_student_portal.sql','0012_drive_connection.sql']){
  const sql=fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/^\s*--.*$/gm,'');
  for(const statement of sql.split(';').map(value=>value.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 let cookie='';
 const call=(path,method='GET',body)=>mf.dispatchFetch('https://web.armi.test'+path,{method,redirect:'manual',headers:{origin:'https://web.armi.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const anonymousPicker=await call('/api/drive/picker?mode=folder&requestId=00000000-0000-4000-8000-000000000000');
 assert.equal(anonymousPicker.status,401,await anonymousPicker.text());
 const login=await call('/api/auth/login','POST',{username:'runtime-teacher',password:'fixture-password'});
 assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
 const start=async()=>{
  const response=await call('/api/drive/connect','POST',{});assert.equal(response.status,200,await response.clone().text());
  const authorization=new URL((await response.json()).data.authorizationUrl);challenge=authorization.searchParams.get('code_challenge');
  return '/api/drive/oauth/callback?code=runtime-code&state='+authorization.searchParams.get('state');
 };
 const completed=await call(await start());
 assert.equal(completed.status,302,await completed.clone().text());
 assert.equal(completed.headers.get('location'),'/?armi-drive=connected');
 const profile=async()=>(await(await call('/api/drive/profile')).json()).data;
 assert.equal((await profile()).email,'runtime@example.test');
 const query='?mode=folder&requestId=00000000-0000-4000-8000-000000000000';
 const fileRedirect=await call('/drive-picker.html'+query);
 assert.equal(fileRedirect.status,307,'Actual asset routing canonicalizes .html filenames');
 assert.equal(fileRedirect.headers.get('location'),'/drive-picker'+query);
 const pickerPage=await call('/api/drive/picker'+query);
 assert.equal(pickerPage.status,200,'The authenticated picker must return HTML without redirecting away and losing mode or requestId');
 assert.equal(pickerPage.headers.get('location'),null);
 assert.ok((await pickerPage.text()).includes('id="picker-status"'));
 assert.ok(pickerPage.headers.get('content-security-policy').includes('https://apis.google.com'));
 assert.equal(pickerPage.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 assert.equal((await call('/api/drive/folder','PUT',{folder:'runtime-folder-root',revision:1})).status,200);
 const uploadBytes='runtime-upload-body';
 const prepare=await call('/api/drive/upload/prepare','POST',{parent:'runtime-folder-root',revision:(await profile()).revision,name:'From web.txt',mimeType:'text/plain',size:Buffer.byteLength(uploadBytes),sha256:createHash('sha256').update(uploadBytes).digest('hex')});
 assert.equal(prepare.status,200,await prepare.clone().text());const intent=(await prepare.json()).data;
 const transfer=()=>mf.dispatchFetch('https://web.armi.test/api/drive/upload',{method:'POST',headers:{origin:'https://web.armi.test',cookie,'content-type':'application/octet-stream','x-armi-upload-ticket':intent.ticket},body:uploadBytes});
 redirectUpload=true;const refusedUpload=await transfer();assert.equal(refusedUpload.status,502);assert.equal(uploaded,null);
 redirectUpload=false;const acceptedUpload=await transfer();assert.equal(acceptedUpload.status,200,await acceptedUpload.clone().text());
 assert.equal((await acceptedUpload.json()).data.file.id,'runtime-upload-file');
 assert.equal((await profile()).uploadMaxBytes,5000000);
 const download=await call('/api/drive/content?file=runtime-image-file');assert.equal(download.status,200);assert.equal(await download.text(),'fixture-image');
 redirectFile=true;assert.equal((await call('/api/drive/content?file=runtime-image-file')).status,502);
 await call('/api/ai/credentials','PUT',{provider:'gemini',key:'runtime-own-ai-key-not-real'});
 const models=await call('/api/ai/models?provider=gemini');assert.equal(models.status,200,await models.clone().text());
 redirectAI=true;assert.equal((await call('/api/ai/models?provider=gemini')).status,502);
 redirectToken=true;const refused=await call(await start());assert.equal(refused.status,502);
 assert.ok((await refused.text()).includes('DRIVE-TOKEN'));assert.equal((await profile()).connected,true);
 assert.ok(calls.includes('https://oauth2.googleapis.com/token'));
 assert.ok(!calls.some(value=>value.startsWith('https://untrusted.example')));
});
