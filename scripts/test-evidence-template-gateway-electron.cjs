const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const run=code=>win.webContents.executeJavaScript(code);
  const wait=async(check)=>{for(let i=0;i<160;i++){try{if(await check())return;}catch{}await sleep(100);}throw new Error('Gateway editor did not become visible');};
  try{
    await win.loadURL(`${process.env.ARMI_GATEWAY_URL}/estudiante`);
    await wait(()=>run('!!window.armiEvidenceTemplates'));
    const config={sessionId:'practice-session',templateId:process.env.ARMI_GATEWAY_TEMPLATE,token:process.env.ARMI_GATEWAY_TOKEN};
    const open=()=>run(`window.armiEvidenceTemplates.open(${JSON.stringify(config)})`);
    await open();
    await wait(async()=>{
      const workspace=win.webContents.mainFrame.frames.find(f=>f.url.endsWith('/evidence-workspace.html'));
      const canvas=workspace?.frames[0];
      return canvas?.executeJavaScript(`!!document.querySelector('[data-armi-field="necesidades"]')`);
    });
    assert.equal(await run(`!!document.querySelector('[role="dialog"] [role="status"]')`),false);
    const workspace=win.webContents.mainFrame.frames.find(f=>f.url.endsWith('/evidence-workspace.html'));
    await workspace.executeJavaScript(`document.querySelector('#close').click()`);
    await wait(()=>run(`!document.querySelector('[aria-label="Desarrollar plantilla de evidencia"]')`));
    win.webContents.session.webRequest.onBeforeRequest({urls:[`${process.env.ARMI_GATEWAY_URL}/estudiante-assets/evidence-workspace.html`]},(_details,callback)=>callback({cancel:true}));
    await open();
    await wait(()=>run(`document.querySelector('[role="status"]')?.textContent.includes('No se pudo abrir el editor')`));
    await run(`document.querySelector('[role="status"] button').click()`);
    assert.equal(await run(`!!document.querySelector('[aria-label="Desarrollar plantilla de evidencia"]')`),false);
    console.log('OK: real student gateway renders nested HTML in Electron; failed loads show a recoverable notice.');
  }finally{win.destroy();}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
