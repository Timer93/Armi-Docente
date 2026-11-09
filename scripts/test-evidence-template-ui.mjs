import {createFixture,fixtureHtml} from './fixtures/evidence-template-server.mjs';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const fixture=await createFixture();
fixture.automaticWindows.push({openAt:new Date(Date.now()-60000).toISOString(),closeAt:new Date(Date.now()+3600000).toISOString(),section:'B'});
let vite;
try{
 const call=async(route,data,token)=>{const r=await fetch(`${fixture.url}/api/${route}`,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});const json=await r.json();if(!json.success)throw new Error(json.message);return json.data;};
 const catalog=await call('evidence-templates/s/catalog');
 const enriched=fixtureHtml.replace('</body>','<img data-armi-image="bot_atento" alt="Bot de ARMI"><label>Boceto<canvas data-armi-field="boceto" aria-label="Boceto" width="960" height="480" style="width:100%;height:auto"></canvas></label></body>');
 const t=await call('evidence-templates/s',{evidenceId:catalog.evidences[0].id,html:enriched,mode:'group',enabled:true,overrides:{B:{openAt:new Date(Date.now()-60000).toISOString(),closeAt:new Date(Date.now()+3600000).toISOString()}}});
 const doc=await call(`student-portal/evidence-templates/s/${t.id}`,null,'a');
 const root=path.resolve('artifacts/evidence-templates-ui');fs.mkdirSync(root,{recursive:true});
 fs.copyFileSync(path.resolve('scripts/fixtures/evidence-template-planning.tsx.fixture'),path.join(root,'planning.tsx'));
 fixture.app.get('/api/interactive-activities/:sessionId/:activityId/results',(_req,res)=>res.json({success:true,data:[]}));
 fixture.app.get('/planning',async(req,res)=>res.type('html').send(await vite.transformIndexHtml(req.url,`<!doctype html><html><head></head><body style="margin:0;background:#f1f5f9"><div id="root"></div><script>window.fixtureHtml=${JSON.stringify(enriched).replace(/</g,'\\u003c')}</script><script type="module" src="/artifacts/evidence-templates-ui/planning.tsx"></script></body></html>`)));
 vite=await createServer({configFile:false,plugins:[react()],appType:'custom',cacheDir:path.resolve('node_modules/.vite-evidence-template-ui'),server:{middlewareMode:true,hmr:{server:fixture.server},watch:{ignored:['**/artifacts/**','**/backend/**','**/scripts/**']}},optimizeDeps:{entries:[path.join(root,'planning.tsx')],include:['react','react-dom/client','lucide-react']},define:{__APP_VERSION__:JSON.stringify('test')}});
 fixture.app.use(vite.middlewares);
 const env={...process.env,ARMI_TEMPLATE_URL:fixture.url,ARMI_TEMPLATE_ID:t.id,ARMI_TEMPLATE_DOCUMENT:doc.id,ARMI_TEMPLATE_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(createRequire(import.meta.url)('electron'),['scripts/test-evidence-template-ui-electron.cjs'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.once('error',reject);child.once('exit',resolve);});
}finally{if(vite)await vite.close();await new Promise(resolve=>fixture.server.close(resolve));fixture.db.close();}
