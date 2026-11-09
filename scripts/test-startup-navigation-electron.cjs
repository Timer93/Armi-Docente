const {app,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {loadStartupPage}=require('../electron/startup-navigation.cjs');
const root=process.env.ARMI_NAV_TEST_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'armi-navigation-'));app.setPath('userData',root);
let window,requests=0,server;
app.whenReady().then(async()=>{
 try{
  server=http.createServer((req,res)=>{
   if(req.url==='/health'){res.end('ok');return;}
   if(req.url==='/slow.png'){setTimeout(()=>{res.writeHead(200,{'Content-Type':'image/png'});res.end();},1200);return;}
   requests++;res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
   res.end(`<html><head><title>Ready</title></head><body><script>if(!sessionStorage.reloaded){sessionStorage.reloaded='1';setTimeout(()=>location.reload(),25)}</script><img src='/slow.png'></body></html>`);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  window=new BrowserWindow({show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});
  const logs=[];assert.equal(await loadStartupPage(window,url,{log:line=>logs.push(line)}),true);
  assert.ok(requests>=2,'The renderer must really reload during initial load');
  assert.ok(logs.some(line=>/recarga|sustituida/.test(line)),'The test must exercise an actual aborted Electron navigation');
  assert.equal(window.webContents.getTitle(),'Ready');assert.equal(await(await fetch(url+'health')).text(),'ok');
  console.log('OK: real hidden Electron window survives a reload during initial navigation; server remains available.');
  window.destroy();server.close();app.exit(0);
 }catch(error){console.error(error);if(window&&!window.isDestroyed())window.destroy();if(server)server.close();app.exit(1);}
});
app.on('window-all-closed',()=>{});
