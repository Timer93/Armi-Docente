import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createAccessControlStore } from '../backend/accessControl.js';
import { createAccessExtensionService } from '../backend/accessExtension.js';
import { createAccessExtensionRouter } from '../backend/routes/accessExtension.routes.js';
const root = path.resolve('artifacts/student-extension-browser'); fs.mkdirSync(root, { recursive: true });
const extension = path.join(root, 'extension');
fs.cpSync('extensions/armi-student-access', extension, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json')));
// Only the test fixture pregrants localhost access, avoiding an interactive
// permission dialog in the automated profile. Distributed permissions stay optional.
manifest.host_permissions = ['http://127.0.0.1/*'];
fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
const db = new Database(':memory:'), local = new Database(':memory:');
db.exec('CREATE TABLE armi_frontend_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');
const store = createAccessControlStore(db);
store.save({ version: 1, groups: [], devices: [{ id: 'testpc', name: 'PC de prueba', groupId: null }],
  rules: [{ id: 'block', name: 'Bloqueo de prueba', enabled: true, domains: ['blocked.armi.test'], scope: 'all', groupId: null, deviceIds: [] }] }, 'empty');
const service = createAccessExtensionService({ db, localDatabase: local });
const app = express(); app.use(express.json()); app.use('/api/access-extension', createAccessExtensionRouter(service));
let apiServer = http.createServer(app);
await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
const apiPort = apiServer.address().port, origin = `http://127.0.0.1:${apiPort}`;
let blockedRequests = 0;
const sites = http.createServer((req, res) => { if (String(req.headers.host).startsWith('blocked.')) blockedRequests++; res.end('SITIO PERMITIDO'); });
await new Promise(resolve => sites.listen(0, '127.0.0.1', resolve));
const sitePort = sites.address().port;
const browserPath = process.env.ARMI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'armi-extension-browser-'));
let child, socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startBrowser() {
  const oldPort = path.join(profile, 'DevToolsActivePort');
  if (fs.existsSync(oldPort)) fs.unlinkSync(oldPort);
  child = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--no-proxy-server',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--enable-unsafe-extension-debugging',
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP *.armi.test 127.0.0.1', 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', data => fs.appendFileSync(path.join(root, 'browser.log'), data));
  child.on('error', error => console.error(error.message));
  for (let i=0;i<150 && !fs.existsSync(oldPort);i++) await pause(200);
  assert.ok(fs.existsSync(oldPort), 'Browser debugging endpoint must start');
  const [port, endpoint] = fs.readFileSync(oldPort, 'utf8').trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true}); });
  let counter=0; const pending=new Map();
  socket.addEventListener('message', message => {
    const value=JSON.parse(message.data);const task=pending.get(value.id);if(!task)return;
    pending.delete(value.id);clearTimeout(task.timer);value.error?task.reject(new Error(value.error.message)):task.resolve(value.result);
  });
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++counter;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},20000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  let target;
  for(let i=0;i<80;i++) {
    const targets=(await call('Target.getTargets')).targetInfos;
    target=targets.find(row=>row.type==='service_worker'&&row.url.includes('/background.js'));
    if(target)break;
    if(i===5) { try {await call('Extensions.loadUnpacked',{path:extension});} catch(error){console.log('Load extension:',error.message);} }
    await pause(250);
  }
  assert.ok(target,'Student extension service worker must load in the browser');
  const worker=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  const popupTarget=(await call('Target.createTarget',{url:new URL('popup.html',target.url).href})).targetId;
  const popup=(await call('Target.attachToTarget',{targetId:popupTarget,flatten:true})).sessionId;
  const evaluate=async(expression,session=popup)=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  let ready=false;
  for(let i=0;i<200;i++){if(await evaluate(`typeof chrome!=='undefined'&&typeof chrome.runtime?.sendMessage==='function'&&document.body?.getAttribute('aria-busy')==='false'`)){ready=true;break;}await pause(100);}
  assert.ok(ready,'Extension popup must load its own runtime context');
  const message=async value=>{const result=await evaluate(`chrome.runtime.sendMessage(${JSON.stringify(value)})`);if(!result.success)throw new Error(result.message);return result.data;};
  return {call,evaluate,worker,popup,message};
}
async function stopBrowser(browser) {
  if (!browser) return;
  try {await browser.call('Browser.close');}catch{}
  for(let i=0;i<100&&child.exitCode===null;i++)await pause(100);
  socket?.close();
}
let browser;
try {
  browser = await startBrowser(); console.log('Browser: extension loaded');
  const code=service.generatePairing('testpc').code;
  await browser.evaluate(`(()=>{document.getElementById('server').value=${JSON.stringify(origin)};document.getElementById('code').value=${JSON.stringify(code)};document.getElementById('pair').click();})()`);
  let applied=false;
  for(let i=0;i<100;i++){if(await browser.evaluate(`document.getElementById('badge').textContent==='Reglas aplicadas'`)){applied=true;break;}await pause(100);}
  if(!applied) console.log('Popup:',await browser.evaluate(`document.body.innerText`));
  assert.ok(applied,'The actual popup must pair and apply the policy');
  const screenshot=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},browser.popup);
  fs.writeFileSync(path.join(root,'popup.png'),Buffer.from(screenshot.data,'base64'));
  assert.equal(service.status()[0].state,'applied');
  const target=(await browser.call('Target.createTarget',{url:'about:blank'})).targetId;
  const page=(await browser.call('Target.attachToTarget',{targetId:target,flatten:true})).sessionId;
  await browser.call('Page.enable',{},page);
  const navigate=url=>browser.call('Page.navigate',{url},page);
  assert.match((await navigate(`http://blocked.armi.test:${sitePort}/`)).errorText||'',/BLOCKED_BY_CLIENT/);
  assert.match((await navigate(`http://child.blocked.armi.test:${sitePort}/`)).errorText||'',/BLOCKED_BY_CLIENT/);
  assert.equal(blockedRequests,0,'Blocked pages must not reach the website server');
  assert.equal((await navigate(`http://allowed.armi.test:${sitePort}/`)).errorText,undefined);
  console.log('Browser: pages and subdomains blocked; unrelated site allowed');
  const current=store.read();store.save({...current.config,rules:current.config.rules.map(rule=>({...rule,enabled:false}))},current.revision);
  await browser.message({type:'sync'});
  assert.equal((await navigate(`http://blocked.armi.test:${sitePort}/`)).errorText,undefined,'Disabling a rule must release the page');
  let committed=false;
  for(let i=0;i<50;i++){if(await browser.evaluate(`location.hostname==='blocked.armi.test'&&document.body?.textContent.includes('SITIO PERMITIDO')`,page)){committed=true;break;}await pause(100);}
  assert.ok(committed,'The previously allowed site must finish loading before the next policy');
  const disabled=store.read();store.save({...disabled.config,rules:disabled.config.rules.map(rule=>({...rule,enabled:true}))},disabled.revision);
  await browser.message({type:'sync'});
  let existingTabBlocked=false,lastFrame;
  for(let i=0;i<50;i++) {
    const frame=(await browser.call('Page.getFrameTree',{},page)).frameTree.frame;lastFrame=frame;
    if(frame.unreachableUrl?.includes('blocked.armi.test')||/^(chrome|edge)-error:/.test(frame.url)){existingTabBlocked=true;break;}
    await pause(100);
  }
  if(!existingTabBlocked)console.log('Last frame:',lastFrame,'DOM:',await browser.evaluate('document.body?.innerText',page),
    'Permissions:',await browser.evaluate('chrome.permissions.getAll()'),'Tabs:',await browser.evaluate('chrome.tabs.query({})'));
  assert.ok(existingTabBlocked,'A newly blocked website already open in a tab must reload into a blocked page');
  apiServer.closeAllConnections?.();await new Promise(resolve=>apiServer.close(resolve));
  const offline=await browser.message({type:'sync'});
  assert.equal(offline.state,'offline');
  assert.match((await navigate(`http://blocked.armi.test:${sitePort}/`)).errorText||'',/BLOCKED_BY_CLIENT/);
  await stopBrowser(browser); browser=await startBrowser();
  const nextTarget=(await browser.call('Target.createTarget',{url:'about:blank'})).targetId;
  const nextPage=(await browser.call('Target.attachToTarget',{targetId:nextTarget,flatten:true})).sessionId;
  assert.match((await browser.call('Page.navigate',{url:`http://blocked.armi.test:${sitePort}/`},nextPage)).errorText||'',/BLOCKED_BY_CLIENT/);
  console.log('Browser: cached rules persist without ARMI and after browser restart');
  apiServer=http.createServer(app);await new Promise(resolve=>apiServer.listen(apiPort,'127.0.0.1',resolve));
  service.revoke('testpc');
  await browser.message({type:'sync'});
  assert.equal((await browser.call('Page.navigate',{url:`http://blocked.armi.test:${sitePort}/`},nextPage)).errorText,undefined);
  const result={browser:path.basename(browserPath),blocking:true,subdomains:true,allowOtherSites:true,liveUnblock:true,offlineRetention:true,restartPersistence:true,revocation:true};
  fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(result,null,2));
  console.log('OK: real browser DNR enforcement, group policy delivery, live unblock, offline/restart persistence and revocation.');
} finally {await stopBrowser(browser);if(apiServer.listening){apiServer.closeAllConnections?.();await new Promise(resolve=>apiServer.close(resolve));}await new Promise(resolve=>sites.close(resolve));local.close();db.close();
  if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)) {
    try { await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:0}); }
    catch(error) { if(!['EPERM','EBUSY'].includes(error.code))throw error;console.warn('Windows mantiene un archivo del perfil temporal bloqueado; las comprobaciones funcionales finalizaron.'); }
  }
}
