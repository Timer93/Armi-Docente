import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {driveRoute} from '../src/drive.js';
import {driveCallbackPage} from '../src/drive-callback-page.js';

const ROOT_A='folder-AAAAAA',ROOT_B='folder-BBBBBB',FILE_A='image-AAAAAAA',OUTSIDE='image-OUTSIDE',MARKER='marker-AAAAAA';
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_identity.sql','0007_ai_student_portal.sql','0012_drive_connection.sql'])sqlite.exec(fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
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
 let now=1000;const calls=[],challenges=new Map(),provider={status:200,refreshCalls:0};
 const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
 const requester=async(value,options={})=>{
  const url=new URL(value);calls.push({url:url.href,options});
  if(provider.status!==200)return new Response('',{status:provider.status});
  if(url.href==='https://oauth2.googleapis.com/token'){
   if(provider.tokenError)return Response.json({error:provider.tokenError,error_description:'private-provider-description <script> secret=do-not-display'},{status:400});
   const body=new URLSearchParams(options.body);let identity;
   if(body.get('grant_type')==='refresh_token'){identity=body.get('refresh_token').slice(8);provider.refreshCalls++;}
   else{identity=body.get('code');const actual=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');assert.equal(actual,challenges.get(identity));}
   return Response.json({access_token:'access-'+identity,refresh_token:'refresh-'+identity,expires_in:3600,scope:provider.tokenScope||'https://www.googleapis.com/auth/drive.file'});
  }
  const token=options.headers.authorization.replace('Bearer access-','');
  if(url.href==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'google-'+token,email:token+'@example.test',email_verified:provider.emailVerified!==false});
  assert.equal(url.hostname,'www.googleapis.com');
  if(url.pathname.endsWith('/about'))return Response.json({user:{permissionId:'google-'+token,emailAddress:token+'@example.test'}});
  if(url.pathname==='/drive/v3/files'){
   const query=url.searchParams.get('q'),parent=query.match(/^'([^']+)' in parents/)[1],name=query.match(/ and name = '([^']+)'/)?.[1];
   return Response.json({files:[...documents.values()].filter(file=>file.parents.includes(parent)&&(!name||file.name===name)&&(!provider.authorized||provider.authorized.has(file.id))).map(({body,...file})=>file)});
  }
  const id=url.pathname.split('/').at(-1);if(provider.authorized&&!provider.authorized.has(id))return new Response('',{status:403});const file=documents.get(id);if(!file)return new Response('',{status:404});
  if(url.searchParams.get('alt')==='media')return new Response(file.body,{headers:{'content-type':file.mimeType}});
  const {body,...metadata}=file;return Response.json(metadata);
 };
 const call=async(teacher,path,{method='GET',body}={})=>{
  const request=new Request('https://web.armi.test'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
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
 assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file openid email');
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

test('limited Drive consent does not silently include old files, and Picker selection is checked against the linked folder',async t=>{
 const f=fixture(t),[a]=f.teachers;await f.connect(a);f.provider.authorized=new Set([ROOT_A]);
 assert.equal((await f.link(a)).status,200);assert.equal((await f.profile(a)).folder.mirrorVerified,false);
 const read=async()=>(await(await f.call(a,'/api/drive/files')).json()).data;
 assert.equal((await read()).limitedAccess,true);assert.deepEqual((await read()).files,[]);
 assert.equal((await f.call(a,'/api/drive/content?file='+FILE_A)).status,502,'An unselected file is not authorized by assuming its parent is selected');
 f.provider.authorized.add(FILE_A);
 assert.equal((await f.call(a,'/api/drive/selection',{method:'POST',body:{ids:[FILE_A]}})).status,200);
 assert.equal((await read()).files[0].id,FILE_A);
 f.provider.authorized.add(OUTSIDE);f.provider.authorized.add(ROOT_B);
 assert.equal((await f.call(a,'/api/drive/selection',{method:'POST',body:{ids:[OUTSIDE]}})).status,403);
 assert.equal((await f.call(a,'/api/drive/picker-config')).status,503);
 f.env.ARMI_GOOGLE_PICKER_API_KEY='AIza'+'a'.repeat(35);f.env.ARMI_GOOGLE_PROJECT_NUMBER='123456789012';
 const config=(await(await f.call(a,'/api/drive/picker-config')).json()).data;
 assert.equal(config.accessToken,'access-A');assert.ok(!JSON.stringify(config).includes('refresh-A'));
 assert.equal((await f.profile(a)).pickerConfigured,true);
});

test('Drive never upgrades a limited authorization to broad Drive read access',async t=>{
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
