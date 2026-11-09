const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{let win;try{
 win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
 for(let i=1;i<=3;i++){
  win.setSize(1280,900);const html=fs.readFileSync(path.join(process.env.ARMI_CANVAS_FOLDER,`evidencia-${i}.html`),'utf8');await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);await win.webContents.executeJavaScript(`Promise.all([...document.images].map(image=>image.decode()))`);await pause(250);
  const inspect=()=>win.webContents.executeJavaScript(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.body.scrollHeight,fields:document.querySelectorAll('[data-armi-field]').length,bot:!!document.querySelector('img[data-armi-image]')?.naturalWidth,header:document.querySelector('header.top')?.getBoundingClientRect().height})`);
  let result=await inspect();assert.ok(result.bot,'real bot image must render');assert.ok(result.fields<=80);assert.ok(result.scrollWidth<=result.width);console.log(`Desktop ${i}:`,JSON.stringify(result));
  fs.writeFileSync(path.join(process.env.ARMI_CANVAS_PREVIEW,`evidencia-${i}-desktop.png`),(await win.webContents.capturePage()).toPNG());
  win.setSize(390,844);await pause(100);result=await inspect();assert.ok(result.scrollWidth<=result.width,`mobile evidence ${i} overflows`);fs.writeFileSync(path.join(process.env.ARMI_CANVAS_PREVIEW,`evidencia-${i}-mobile.png`),(await win.webContents.capturePage()).toPNG());
 }
 win.destroy();console.log('OK: all three corrected canvases render their bot, compact header and product matrix; desktop and mobile have no horizontal overflow.');app.exit(0);
 }catch(e){console.error(e);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}});
