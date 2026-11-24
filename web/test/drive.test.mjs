import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {driveRoute} from '../src/drive.js';
import {driveCallbackPage} from '../src/drive-callback-page.js';

const ROOT_A='folder-AAAAAA',ROOT_B='folder-BBBBBB',FILE_A='image-AAAAAAA',OUTSIDE='image-OUTSIDE',MARKER='marker-AAAAAA';
function fixture(t,{automatic=false}={}){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_identity.sql','0007_ai_student_portal.sql','0012_drive_connection.sql'])sqlite.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 if(automatic)for(const name of ['0003_academic_snapshots.sql','0004_academic_edits.sql','0005_planning_edits.sql','0006_web_configuration.sql','0008_web_instruments.sql','0009_web_evaluation.sql','0013_automatic_sync_outbox.sql'])sqlite.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 function prepare(sql,args=[]){return{bind(...values){return prepare(sql,values);},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}
 const env={ARMI_GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com',ARMI_GOOGLE_CLIENT_SECRET:'fixture-secret-not-real',ARMI_DRIVE_ENCRYPTION_KEY:'ab'.repeat(32),ARMI_DRIVE_REDIRECT_URI:'https://web.armi.test/api/drive/oauth/callback',DB:{prepare,async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}}};
 const teachers=['A','B'].map((id,index)=>{sqlite.prepare('INSERT INTO teachers(id,provider_username,display_name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,'teacher'+id,'Teacher '+id,0,0);return{id,provider_username:'teacher'+id,token_hash:String(index+1).repeat(64),membership_json:JSON.stringify({syncUserKey:'sync-'+id.toLowerCase()})};});
 const documents=new Map([
  [ROOT_A,{id:ROOT_A,name:'Mirror A',mimeType:'application/vnd.google-apps.folder',parents:[]}],
  [ROOT_B,{id:ROOT_B,name:'Mirror B',mimeType:'application/vnd.google-apps.folder',parents:[]}],
  [MARKER,{id:MARKER,name:'.armi-sync-root.json',mimeType:'application/json',parents:[ROOT_A],size:'40',body:JSON.stringify({syncUserKey:'sync-a'})}],
  [FILE_A,{id:FILE_A,name:'Evidence.png',mimeType:'image/png',parents:[ROOT_A],size:'3',body:new Uint8Array([1,2,3])}],
  [OUTSIDE,{id:OUTSIDE,name:'Private unrelated file',mimeType:'image/png',parents:[ROOT_B],size:'3',body:'bad'}],
 ]);
 let now=1000,generatedId=0;const calls=[],challenges=new Map(),provider={status:200,refreshCalls:0};
 const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
 const requester=async(value,options={})=>{
  const url=new URL(value);calls.push({url:url.href,options});
  if(provider.status!==200)return new Response('',{status:provider.status});
  if(url.href==='https://oauth2.googleapis.com/token'){
   if(provider.tokenError)return Response.json({error:provider.tokenError,error_description:'private-provider-description <script> secret=do-not-display'},{status:400});
   const body=new URLSearchParams(options.body);let identity;
   if(body.get('grant_type')==='refresh_token'){identity=body.get('refresh_token').slice(8);provider.refreshCalls++;}
   else{identity=body.get('code');const actual=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');assert.equal(actual,challenges.get(identity));}
   return Response.json({access_token:'access-'+identity,refresh_token:'refresh-'+identity,expires_in:3600,scope:provider.tokenScope||'https://www.googleapis.com/auth/drive'});
  }
  if(url.pathname==='/drive/v3/files/generateIds')return Response.json({ids:['uploaded-file-'+String(++generatedId).padStart(5,'0')]});
  if(url.pathname==='/upload/drive/v3/files'){
   if(provider.uploadRedirect)return Response.redirect('https://untrusted.example/upload',307);
   const bytes=Buffer.from(await options.body.arrayBuffer()),boundary=options.headers['content-type'].split('boundary=')[1];
   const first=bytes.indexOf('\r\n\r\n')+4,metaEnd=bytes.indexOf('\r\n--'+boundary,first),metadata=JSON.parse(bytes.subarray(first,metaEnd).toString());
   const contentStart=bytes.indexOf('\r\n\r\n',metaEnd)+4,contentEnd=bytes.lastIndexOf('\r\n--'+boundary),body=bytes.subarray(contentStart,contentEnd);
   if(documents.has(metadata.id))return new Response('',{status:409});
   const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),x=>x.toString(16).padStart(2,'0')).join('');
   documents.set(metadata.id,{...metadata,parents:metadata.parents,body,size:String(body.length),sha256Checksum:checksum});
   provider.onUpload?.();
   if(provider.loseUploadResponse)throw new Error('Connection lost after Google saved the file');
   return Response.json({id:metadata.id});
  }
  const token=options.headers.authorization.replace('Bearer access-','');
  if(url.href==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'google-'+token,email:token+'@example.test',email_verified:provider.emailVerified!==false});
  assert.equal(url.hostname,'www.googleapis.com');
  if(url.pathname.endsWith('/about'))return Response.json({user:{permissionId:'google-'+token,emailAddress:token+'@example.test'}});
  if(url.pathname==='/drive/v3/files'&&options.method==='POST'){
   const file=JSON.parse(options.body);if(documents.has(file.id))return new Response('',{status:409});documents.set(file.id,file);return Response.json({id:file.id});
  }
  if(url.pathname==='/drive/v3/files'){
   const query=url.searchParams.get('q'),parent=query.match(/^'([^']+)' in parents/)[1],name=query.match(/ and name = '([^']+)'/)?.[1];
   return Response.json({files:[...documents.values()].filter(file=>file.parents.includes(parent)&&(!name||file.name===name)&&(!provider.authorized||provider.authorized.has(file.id))).map(({body,...file})=>file)});
  }
  const id=url.pathname.split('/').at(-1);if(provider.authorized&&!provider.authorized.has(id))return new Response('',{status:403});const file=documents.get(id);if(!file)return new Response('',{status:404});
  if(url.searchParams.get('alt')==='media')return new Response(file.body,{headers:{'content-type':file.mimeType}});
  const {body,...metadata}=file;return Response.json(metadata);
 };
 const call=async(teacher,path,{method='GET',body,raw,headers={}}={})=>{
  const request=new Request('https://web.armi.test'+path,{method,headers:{'content-type':'application/json',...headers},body:raw!==undefined?raw:body===undefined?undefined:JSON.stringify(body)});
  try{return await driveRoute(request,env,teacher,{requester,digest,randomToken:()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),now,readJson:r=>r.json()});}
  catch(error){if(!error.status)throw error;return Response.json({message:error.message,diagnostic:error.driveDiagnostic},{status:error.status});}
 };
 const profile=async teacher=>(await(await call(teacher,'/api/drive/profile')).json()).data;
 const start=async(teacher,identity=teacher.id)=>{
  const response=await call(teacher,'/api/drive/connect',{method:'POST',body:{}});assert.equal(response.status,200,await response.clone().text());
  const auth=new URL((await response.json()).data.authorizationUrl);challenges.set(identity,auth.searchParams.get('code_challenge'));
  return auth;
 };
 const finish=(teacher,auth,identity=teacher.id)=>call(teacher,'/api/drive/oauth/callback?state='+auth.searchParams.get('state')+'&code='+identity);
 const connect=async(teacher,identity=teacher.id)=>{const response=await finish(teacher,await start(teacher,identity),identity);assert.equal(response.status,302,await response.clone().text());return profile(teacher);};
 const link=async(teacher,id=ROOT_A)=>call(teacher,'/api/drive/folder',{method:'PUT',body:{folder:'https://drive.google.com/drive/folders/'+id,revision:(await profile(teacher)).revision}});
 return{env,sqlite,teachers,calls,call,profile,start,finish,connect,link,documents,provider,advance:ms=>{now+=ms;}};
}

test('OAuth failures identify credential, consent and identity stages without leaking provider responses',async t=>{
 const f=fixture(t),[a]=f.teachers;
 for(const [error,reference] of [['invalid_client','DRIVE-CREDENCIALES'],['unauthorized_client','DRIVE-CREDENCIALES'],['invalid_grant','DRIVE-AUTORIZACION'],['arbitrary-secret-value','DRIVE-TOKEN']]){
  f.provider.tokenError=error;
  const result=await f.finish(a,await f.start(a));
  const data=await result.json();assert.equal(data.diagnostic,reference);
  const html=await driveCallbackPage(result.status,data.diagnostic).text();
  assert.ok(html.includes(reference));assert.ok(!html.includes('private-provider-description')&&!html.includes('<script>')&&!html.includes('arbitrary-secret-value'));
  assert.equal((await f.profile(a)).connected,false);
  f.advance(60000);
 }
 delete f.provider.tokenError;f.provider.emailVerified=false;
 const failed=await f.finish(a,await f.start(a));
 assert.equal((await failed.json()).diagnostic,'DRIVE-IDENTIDAD');assert.equal((await f.profile(a)).connected,false);
 f.advance(60000);f.provider.emailVerified=true;
 await f.connect(a);assert.equal((await f.profile(a)).connected,true);
 const untrusted=await driveCallbackPage(400,'<script>private</script>').text();assert.ok(!untrusted.includes('<script>'));
});

test('Drive OAuth is tied to one teacher/session, uses PKCE and never exposes stored Google tokens',async t=>{
 const f=fixture(t),[a,b]=f.teachers,auth=await f.start(a);
 assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/drive openid email');
 assert.equal((await f.finish(b,auth,'A')).status,400);assert.equal(f.calls.length,0);
 assert.equal((await f.finish({...a,token_hash:'f'.repeat(64)},auth,'A')).status,400);
 assert.equal((await f.finish(a,auth,'A')).status,302);
 assert.equal((await f.finish(a,auth,'A')).status,400,'Authorization cannot be replayed');
 const stored=JSON.stringify(f.sqlite.prepare('SELECT * FROM drive_connections').get());assert.ok(!stored.includes('refresh-A'));assert.ok(!stored.includes('access-A'));
 const profile=await f.profile(a);assert.equal(profile.email,'A@example.test');assert.ok(!JSON.stringify(profile).includes('token_'));
 assert.equal((await f.profile(b)).connected,false);
 const expired=await f.start(a);f.advance(601000);assert.equal((await f.finish(a,expired,'A')).status,400);
});

test('Drive folder identity and descendant checks isolate accounts and block arbitrary remote URLs',async t=>{
 const f=fixture(t),[a,b]=f.teachers;await f.connect(a);await f.connect(b);
 assert.equal((await f.link(a)).status,200);assert.equal((await f.profile(a)).folder.mirrorVerified,true);
 assert.equal((await f.link(b)).status,403,'A mirror marker for another ARMI account cannot be linked');
 assert.equal((await f.link(b,ROOT_B)).status,200);
 const files=await f.call(a,'/api/drive/files');assert.equal(files.status,200);assert.ok((await files.json()).data.files.some(file=>file.id===FILE_A));
 const forbidden=await f.call(a,'/api/drive/content?file='+OUTSIDE);assert.equal(forbidden.status,403);assert.ok(!(await forbidden.text()).includes('Private unrelated file'));
 const count=f.calls.length;assert.equal((await f.call(a,'/api/drive/content?file=https://example.test')).status,400);assert.equal(f.calls.length,count);
 const content=await f.call(a,'/api/drive/content?file='+FILE_A+'&preview=1');assert.equal(content.headers.get('content-type'),'image/png');assert.deepEqual([...new Uint8Array(await content.arrayBuffer())],[1,2,3]);
 assert.match((await f.call(a,'/api/drive/content?file='+FILE_A)).headers.get('content-disposition'),/^attachment/);
});

test('Drive refresh remains server-side; changed Google account clears the selected folder; disconnect preserves Drive files',async t=>{
 const f=fixture(t),[a,b]=f.teachers;await f.connect(a);await f.link(a);f.advance(3600000);
 assert.equal((await f.call(a,'/api/drive/files')).status,200);assert.equal(f.provider.refreshCalls,1);
 await f.connect(a,'other-A');assert.equal((await f.profile(a)).folder,null);
 await f.link(a);const current=await f.profile(a);
 assert.equal((await f.call(a,'/api/drive/connection',{method:'DELETE',body:{revision:current.revision-1}})).status,409);
 assert.equal((await f.call(a,'/api/drive/connection',{method:'DELETE',body:{revision:current.revision}})).status,200);
 assert.equal((await f.profile(a)).connected,false);assert.ok(f.documents.has(FILE_A));assert.equal((await f.profile(b)).connected,false);
 assert.equal((await f.call(a,'/api/drive/files')).status,400);
});

test('Drive encryption binds credentials to teacher; provider errors do not leak tokens or retry silently',async t=>{
 const f=fixture(t),[a,b]=f.teachers;await f.connect(a);await f.link(a);await f.connect(b);await f.link(b,ROOT_B);
 f.sqlite.exec("UPDATE drive_connections SET token_cipher=(SELECT token_cipher FROM drive_connections WHERE teacher_id='A'),token_iv=(SELECT token_iv FROM drive_connections WHERE teacher_id='A') WHERE teacher_id='B'");
 const count=f.calls.length;assert.equal((await f.call(b,'/api/drive/files')).status,503);assert.equal(f.calls.length,count);
 f.provider.status=429;const failed=await f.call(a,'/api/drive/files');assert.equal(failed.status,429);assert.equal(f.calls.length,count+1);assert.ok(!(await failed.text()).includes('access-A'));
});

test('Drive setup reports missing schema/configuration; reconnect races and duplicate unmarked folders do not overwrite bindings',async t=>{
 const f=fixture(t),[a,b]=f.teachers;delete f.env.ARMI_GOOGLE_CLIENT_SECRET;
 assert.equal((await f.profile(a)).configured,false);assert.equal((await f.call(a,'/api/drive/connect',{method:'POST',body:{}})).status,503);
 f.env.ARMI_GOOGLE_CLIENT_SECRET='fixture-secret-not-real';await f.connect(a);
 const auth=await f.start(a);f.sqlite.exec("UPDATE drive_connections SET revision=revision+1 WHERE teacher_id='A'");assert.equal((await f.finish(a,auth)).status,409);
 f.documents.delete(MARKER);assert.equal((await f.link(a)).status,200);assert.equal((await f.profile(a)).folder.mirrorVerified,false);
 await f.connect(b);assert.equal((await f.link(b)).status,409);
 f.sqlite.exec('DROP TABLE drive_oauth_states');assert.equal((await f.profile(a)).ready,false);
});

test('Broad consent reads existing descendants without individual grants and rejects files outside the selected root',async t=>{
 const f=fixture(t),[a]=f.teachers;await f.connect(a);await f.link(a);
 const child='nested-folder-A',nested='nested-file-AAA';
 f.documents.set(child,{id:child,name:'Nested',mimeType:'application/vnd.google-apps.folder',parents:[ROOT_A]});
 f.documents.set(nested,{id:nested,name:'Old.pdf',mimeType:'application/pdf',parents:[child],size:'3',body:'old'});
 const read=async parent=>(await(await f.call(a,'/api/drive/files'+(parent?'?parent='+parent:''))).json()).data;
 assert.equal((await read()).limitedAccess,false);assert.ok((await read()).files.some(file=>file.id===FILE_A));
 assert.equal((await read(child)).files[0].id,nested);
 assert.equal(await(await f.call(a,'/api/drive/content?file='+nested)).text(),'old');
 assert.equal((await f.call(a,'/api/drive/files?parent='+ROOT_B)).status,403);
 assert.equal((await f.call(a,'/api/drive/selection',{method:'POST',body:{ids:[OUTSIDE]}})).status,403);
 assert.equal((await f.call(a,'/api/drive/picker-config')).status,503);
 f.env.ARMI_GOOGLE_PICKER_API_KEY='AIza'+'a'.repeat(35);f.env.ARMI_GOOGLE_PROJECT_NUMBER='123456789012';
 const config=(await(await f.call(a,'/api/drive/picker-config')).json()).data;
 assert.equal(config.accessToken,'access-A');assert.ok(!JSON.stringify(config).includes('refresh-A'));
 assert.equal(config.teacherId,a.id);assert.equal(config.revision,(await f.profile(a)).revision);
 const rejected=await f.call(a,'/api/drive/folder',{method:'PUT',headers:{'x-armi-teacher-id':'B'},body:{folder:ROOT_A,revision:config.revision}});assert.equal(rejected.status,409);
 assert.equal((await f.profile(a)).pickerConfigured,true);
});

test('folder suggestions belong to each teacher; Picker config trims pasted whitespace and reports missing fields without secrets',async t=>{
 const f=fixture(t),[a,b]=f.teachers;
 a.membership_json=JSON.stringify({syncUserKey:'sync-a',driveFolderUrl:'https://drive.google.com/drive/folders/'+ROOT_A,driveFolderName:'My mirror A'});
 b.membership_json=JSON.stringify({syncUserKey:'sync-b'});
 assert.equal((await f.profile(a)).suggestedFolder,'');
 assert.equal((await f.profile(a)).legacyFolder.name,'My mirror A');assert.equal((await f.profile(b)).legacyFolder,null);
 assert.equal((await f.profile(a)).expectedMirrorPath,'ARMI Sync/users/sync-a');
 assert.equal((await f.profile(a)).folder,null);assert.equal((await f.profile(b)).suggestedFolder,'');
 assert.equal(f.calls.length,0,'A saved folder is only a suggestion, not an automatic Google grant');
 assert.deepEqual((await f.profile(a)).pickerSetup,{apiKeyReady:false,projectNumberReady:false,projectMatchesClient:true});
 await f.connect(a);
 await f.link(a);const linked=(await f.profile(a)).folder;
 assert.equal(linked.name,'Mirror A');assert.equal(linked.url,'https://drive.google.com/drive/folders/'+ROOT_A);
 const key='AIza'+'a'.repeat(35);f.env.ARMI_GOOGLE_PICKER_API_KEY=' '+key+'\r\n';
 f.env.ARMI_GOOGLE_PROJECT_NUMBER=' 938978696413\n';f.env.ARMI_GOOGLE_CLIENT_ID='938978696413-fixture.apps.googleusercontent.com';
 assert.equal((await f.profile(a)).pickerConfigured,true);
 const config=(await(await f.call(a,'/api/drive/picker-config')).json()).data;
 assert.equal(config.developerKey,key);assert.equal(config.appId,'938978696413');
 assert.ok(!JSON.stringify(await f.profile(a)).includes(key));
 f.env.ARMI_GOOGLE_PROJECT_NUMBER='armi-docente-cloud';
 assert.equal((await f.profile(a)).pickerSetup.projectNumberReady,false);assert.equal((await f.profile(a)).pickerConfigured,false);
 f.env.ARMI_GOOGLE_PROJECT_NUMBER='111111111111';
 assert.equal((await f.profile(a)).pickerSetup.projectMatchesClient,false);assert.equal((await f.call(a,'/api/drive/picker-config')).status,503);
 f.env.ARMI_GOOGLE_PROJECT_NUMBER='938978696413';f.env.ARMI_GOOGLE_PICKER_API_KEY='not-a-google-key';
 assert.equal((await f.profile(a)).pickerSetup.apiKeyReady,false);assert.equal((await f.profile(a)).pickerConfigured,false);
});

test('legacy Apps Script folders are never preselected as mirrors and require a matching marker to link',async t=>{
 const f=fixture(t),[a,b]=f.teachers;
 a.membership_json=JSON.stringify({syncUserKey:'sync-a',driveFolderUrl:'https://drive.google.com/drive/folders/'+ROOT_B,driveFolderName:'ARMI_legacy'});
 await f.connect(a);assert.equal((await f.link(a,ROOT_B)).status,409);assert.equal((await f.profile(a)).folder,null);
 assert.equal((await f.link(a,ROOT_A)).status,200);assert.equal((await f.profile(a)).folder.mirrorVerified,true);
 await f.connect(b);await f.link(b,ROOT_B);
 b.membership_json=JSON.stringify({syncUserKey:'sync-b',driveFolderUrl:'https://drive.google.com/drive/folders/'+ROOT_B});
 assert.equal((await f.profile(b)).legacyLocationLinked,true,'Existing unverified links are flagged without deleting data');
 b.membership_json=JSON.stringify({driveFolderUrl:'javascript:private-value'});assert.equal((await f.profile(b)).legacyFolder,null);
 a.membership_json=JSON.stringify({syncUserKey:'sync-a',driveFolderUrl:'https://drive.google.com/drive/folders/'+ROOT_A});
 assert.equal((await f.link(a,ROOT_A)).status,200,'An actual mirror marker may verify an old registered URL');
});

test('Drive rejects a new consent missing the requested full Drive permission',async t=>{
 const f=fixture(t),[a]=f.teachers;f.provider.tokenScope='https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
 const result=await f.finish(a,await f.start(a));assert.equal(result.status,502);
 assert.equal((await f.profile(a)).connected,false);
});

test('Drive file selections reuse parent metadata and cap each selection instead of multiplying directory scans',async t=>{
 const f=fixture(t),[a]=f.teachers;await f.connect(a);await f.link(a);
 const ids=Array.from({length:20},(_,n)=>'batch-file-'+String(n).padStart(3,'0'));
 for(const id of ids)f.documents.set(id,{id,name:id,mimeType:'image/png',size:'3',parents:[ROOT_A]});
 const before=f.calls.length;
 assert.equal((await f.call(a,'/api/drive/selection',{method:'POST',body:{ids}})).status,200);
 assert.equal(f.calls.length-before,21,'Twenty siblings require one common parent lookup');
 const after=f.calls.length;
 assert.equal((await f.call(a,'/api/drive/selection',{method:'POST',body:{ids:[...ids,'one-more-file']}})).status,400);
 assert.equal(f.calls.length,after);
});

test('Legacy encrypted tokens require explicit reauthorization; reconnect keeps the folder and refresh keeps its granted scope',async t=>{
 const f=fixture(t),[a]=f.teachers;await f.connect(a);await f.link(a);
 const row=f.sqlite.prepare('SELECT * FROM drive_connections WHERE teacher_id=?').get(a.id);
 const key=await crypto.subtle.importKey('raw',Buffer.from(f.env.ARMI_DRIVE_ENCRYPTION_KEY,'hex'),'AES-GCM',false,['encrypt','decrypt']);
 const aad=new TextEncoder().encode(a.id+':drive');
 const original=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(row.token_iv,'hex'),additionalData:aad},key,Buffer.from(row.token_cipher,'hex'))));
 delete original.scope;
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:Buffer.from(row.token_iv,'hex'),additionalData:aad},key,new TextEncoder().encode(JSON.stringify(original)));
 f.sqlite.prepare('UPDATE drive_connections SET token_cipher=? WHERE teacher_id=?').run(Buffer.from(cipher).toString('hex'),a.id);
 const count=f.calls.length;assert.equal((await f.profile(a)).requiresReauthorization,true);
 assert.equal((await f.call(a,'/api/drive/files')).status,409);assert.equal(f.calls.length,count,'Legacy token is never silently upgraded or sent to Google');
 await f.connect(a);const profile=await f.profile(a);assert.equal(profile.requiresReauthorization,false);assert.equal(profile.folder.id,ROOT_A);
 f.advance(3600000);assert.equal((await f.call(a,'/api/drive/files')).status,200);
 assert.equal((await f.profile(a)).requiresReauthorization,false);
});

test('Drive uploads create one file, verify its bytes and let lost responses be checked without duplicates',async t=>{
 const f=fixture(t),[a]=f.teachers;await f.connect(a);await f.link(a);
 const bytes=new Uint8Array([1,2,3]),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const prepare=await f.call(a,'/api/drive/upload/prepare',{method:'POST',body:{name:'Evidence.png',size:3,mimeType:'image/png',sha256,parent:ROOT_A,revision:(await f.profile(a)).revision}});
 assert.equal(prepare.status,200,await prepare.clone().text());const intent=(await prepare.json()).data;
 const options={method:'POST',raw:bytes,headers:{'content-type':'application/octet-stream','x-armi-upload-ticket':intent.ticket}};
 f.provider.loseUploadResponse=true;
 const lost=await f.call(a,'/api/drive/upload',options);assert.equal(lost.status,502);assert.ok((await lost.text()).includes('Comprobar subida'));
 const status=await f.call(a,'/api/drive/upload/status',{headers:{'x-armi-upload-ticket':intent.ticket}});
 assert.equal((await status.json()).data.uploaded,true);
 f.provider.loseUploadResponse=false;
 const retry=await f.call(a,'/api/drive/upload',options);assert.equal(retry.status,200);assert.equal((await retry.json()).data.reused,true);
 assert.equal(f.calls.filter(call=>new URL(call.url).pathname==='/upload/drive/v3/files').length,1);
 assert.equal([...f.documents.values()].filter(file=>file.appProperties?.armiTeacher===a.id).length,1);
 assert.deepEqual([...f.documents.get(intent.file.id).body],[1,2,3]);assert.deepEqual([...f.documents.get(FILE_A).body],[1,2,3],'Existing files are never replaced');
 const wrong=await f.call(a,'/api/drive/upload',{...options,raw:new Uint8Array([3,2,1])});assert.equal(wrong.status,409);
});

test('Drive uploads reject internal mirror folders, other teachers, altered tickets and changed roots',async t=>{
 const f=fixture(t),[a,b]=f.teachers;await f.connect(a);await f.link(a);await f.connect(b);await f.link(b,ROOT_B);
 const internal='internal-folder-A',nested='internal-child-AA';
 f.documents.set(internal,{id:internal,name:'.armi-sync',mimeType:'application/vnd.google-apps.folder',parents:[ROOT_A]});
 f.documents.set(nested,{id:nested,name:'current',mimeType:'application/vnd.google-apps.folder',parents:[internal]});
 const bytes=new Uint8Array([4]),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const base={parent:ROOT_A,revision:(await f.profile(a)).revision,name:'New.pdf',size:1,mimeType:'application/pdf',sha256};
 for(const changes of [{parent:ROOT_B},{parent:nested},{name:'.armi-sync-root.json'},{size:5000001},{name:'../escape.png'},{mimeType:'application/vnd.google-apps.document'}]){
  const result=await f.call(a,'/api/drive/upload/prepare',{method:'POST',body:{...base,...changes}});assert.ok(result.status>=400);
 }
 const {ticket}=((await(await f.call(a,'/api/drive/upload/prepare',{method:'POST',body:base})).json()).data);
 const options={method:'POST',raw:bytes,headers:{'content-type':'application/octet-stream','x-armi-upload-ticket':ticket}};
 assert.equal((await f.call(b,'/api/drive/upload',options)).status,503,'Encrypted upload authorization belongs to its teacher');
 assert.equal((await f.call(a,'/api/drive/upload',{...options,headers:{...options.headers,'x-armi-upload-ticket':ticket.slice(0,-2)+'ff'}})).status,503);
 assert.equal((await f.call(a,'/api/drive/upload',{...options,raw:new Uint8Array([1,2])})).status,413);
 f.documents.set(ROOT_A,{...f.documents.get(ROOT_A),name:'.armi-sync'});
 assert.equal((await f.call(a,'/api/drive/upload',options)).status,403);
 f.documents.set(ROOT_A,{...f.documents.get(ROOT_A),name:'Root A'});
 f.sqlite.exec("UPDATE drive_connections SET revision=revision+1 WHERE teacher_id='A'");
 assert.equal((await f.call(a,'/api/drive/upload',options)).status,409);
 assert.equal(f.calls.filter(call=>new URL(call.url).pathname==='/upload/drive/v3/files').length,0);
});

test('Automatic sync captures committed work, groups edits, preserves pending work after response loss and never claims desktop receipt',async t=>{
 const f=fixture(t,{automatic:true}),[a,b]=f.teachers;await f.connect(a);await f.link(a);
 const insert=f.sqlite.prepare("INSERT INTO academic_edits(teacher_id,dataset,record_id,payload_json,revision,operation_id,operation_hash,updated_at) VALUES(?,'general','general',?,1,'op','hash',1000)");
 insert.run(a.id,JSON.stringify({teacher:'First value'}));insert.run(b.id,JSON.stringify({teacher:'Private teacher B'}));
 const first=f.sqlite.prepare("SELECT id FROM web_sync_outbox WHERE teacher_id='A'").get().id;
 f.sqlite.prepare("UPDATE academic_edits SET payload_json=?,revision=2 WHERE teacher_id='A'").run(JSON.stringify({teacher:'Final value'}));
 const changed=f.sqlite.prepare("SELECT * FROM web_sync_outbox WHERE teacher_id='A'").get();assert.ok(changed.id>first);assert.equal(changed.before_json,'null');
 assert.equal(JSON.parse(changed.after_json).value.teacher,'Final value');
 f.provider.loseUploadResponse=true;
 const lost=await f.call(a,'/api/drive/sync',{method:'POST',body:{}});assert.equal(lost.status,502);
 let status=(await(await f.call(a,'/api/drive/sync/status')).json()).data;assert.equal(status.pending,1);assert.equal(status.desktopConfirmed,false);
 const pending=f.sqlite.prepare("SELECT * FROM web_sync_deliveries WHERE teacher_id='A'").get();assert.ok(pending.packet_json);assert.ok(!pending.packet_json.includes('Private teacher B'));assert.ok(!pending.packet_json.includes('refresh-A'));
 f.provider.loseUploadResponse=false;f.advance(30000);
 const sent=await f.call(a,'/api/drive/sync',{method:'POST',body:{}});assert.equal(sent.status,200,await sent.clone().text());assert.equal((await sent.json()).data.pending,0);
 status=(await(await f.call(a,'/api/drive/sync/status')).json()).data;assert.ok(status.lastSentAt);assert.equal(status.desktopConfirmed,false);
 assert.equal(f.calls.filter(call=>new URL(call.url).pathname==='/upload/drive/v3/files').length,1,'Retry checks the same immutable Google file rather than creating a duplicate');
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_sync_outbox WHERE teacher_id='B'").get().n,1);
 f.sqlite.exec(fs.readFileSync(new URL('../migrations/0013_automatic_sync_outbox.sql',import.meta.url),'utf8'));
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_sync_outbox WHERE teacher_id='A'").get().n,0,'Repeated setup does not enqueue already sent work again');
});

test('Automatic sync acknowledgements retain edits made while a packet is transferring',async t=>{
 const f=fixture(t,{automatic:true}),[a]=f.teachers;await f.connect(a);await f.link(a);
 f.sqlite.prepare("INSERT INTO academic_edits(teacher_id,dataset,record_id,payload_json,revision,operation_id,operation_hash,updated_at) VALUES('A','general','general',?,1,'op','hash',1000)").run(JSON.stringify({teacher:'Before upload'}));
 f.provider.onUpload=()=>f.sqlite.prepare("UPDATE academic_edits SET payload_json=?,revision=revision+1 WHERE teacher_id='A'").run(JSON.stringify({teacher:'Changed during upload'}));
 const result=await f.call(a,'/api/drive/sync',{method:'POST',body:{}});assert.equal(result.status,200,await result.clone().text());assert.equal((await result.json()).data.pending,1);
 assert.equal(JSON.parse(f.sqlite.prepare("SELECT after_json FROM web_sync_outbox WHERE teacher_id='A'").get().after_json).value.teacher,'Changed during upload');
 const state=f.sqlite.prepare("SELECT * FROM web_sync_deliveries WHERE teacher_id='A'").get();assert.equal(state.packet_json,null);
 delete f.provider.onUpload;f.advance(30000);assert.equal((await f.call(a,'/api/drive/sync',{method:'POST',body:{}})).status,200);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM web_sync_outbox WHERE teacher_id='A'").get().n,0);
});

test('Automatic sync captures transactionally and refuses changed roots or incomplete setup',async t=>{
 const f=fixture(t,{automatic:true}),[a]=f.teachers;await f.connect(a);await f.link(a);
 const insert=()=>f.sqlite.prepare("INSERT INTO academic_edits(teacher_id,dataset,record_id,payload_json,revision,operation_id,operation_hash,updated_at) VALUES('A','general','general',?,1,'op','hash',1000)").run(JSON.stringify({teacher:'Saved value'}));
 f.sqlite.exec('BEGIN');insert();f.sqlite.exec('ROLLBACK');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM web_sync_outbox').get().n,0,'A failed save never emits a change');
 insert();assert.equal((await f.call(a,'/api/drive/sync',{method:'POST',body:{}})).status,200);
 f.sqlite.prepare("UPDATE academic_edits SET revision=2,payload_json=? WHERE teacher_id='A'").run(JSON.stringify({teacher:'Pending value'}));
 f.sqlite.prepare("UPDATE drive_connections SET folder_id=?,revision=revision+1 WHERE teacher_id='A'").run(ROOT_B);
 const count=f.calls.length;assert.equal((await f.call(a,'/api/drive/sync',{method:'POST',body:{}})).status,409);assert.equal(f.calls.length,count);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM web_sync_outbox').get().n,1);
 f.sqlite.exec('DROP TRIGGER sync_academic_edits_update');
 assert.equal((await(await f.call(a,'/api/drive/sync/status')).json()).data.ready,false);
});
