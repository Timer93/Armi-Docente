const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = process.env.ARMI_MERGE_UI_ROOT; app.setPath('userData', path.join(root, 'profile'));
let window;
const evaluate = code => window.webContents.executeJavaScript(code);
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const wait = async code => { for (let i = 0; i < 400; i++) { if (await evaluate(code)) return; await pause(); } throw Error('UI wait timed out: ' + code); };
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
    await window.loadURL(process.env.ARMI_MERGE_UI_URL);
    await wait(`document.querySelectorAll('tbody tr').length===9`);
    const open = label => evaluate(`Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]')).find(button=>document.getElementById(button.getAttribute('aria-labelledby').split(' ')[0]).textContent===${JSON.stringify(label)}).click()`);
    const check = label => evaluate(`Array.from(document.querySelectorAll('[role="dialog"] label')).find(label=>label.textContent.trim()===${JSON.stringify(label)}).querySelector('input').click()`);
    await open('Unidad'); await check('Unidad 1'); await check('Unidad 2');
    await wait(`document.querySelectorAll('tbody tr').length===6`);
    await evaluate(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await open('Sesión'); await check('Sesión 1'); await check('Sesión 3');
    await wait(`document.querySelectorAll('tbody tr').length===4`);
    await evaluate(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('thead button').click()`);
    await wait(`document.body.textContent.includes('4 marcadas para exportar')`);
    const search = value => evaluate(`(()=>{const input=document.querySelector('input[aria-label="Buscar campo de plantilla"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await search('evaluacion');
    await wait(`document.querySelector('button[title="Copiar <<instrumento_evaluacion>>"]')`);
    await evaluate(`document.querySelector('button[title="Copiar <<instrumento_evaluacion>>"]').click()`);
    await wait(`window.copiedMarker==='<<instrumento_evaluacion>>'`);
    await search('');
    for (const width of [1600, 1100, 800]) {
      window.setSize(width - 1, 1000); await pause(); window.setSize(width, 1000);
      await evaluate(`document.getAnimations().forEach(animation=>animation.finish())`);
      window.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'No page overflow at ' + width);
      fs.writeFileSync(path.join(root, `merge-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
    console.log('OK: real React UI, multiple unit/session filters, grouped sections, batch marking, marker search/copy and responsive overflow checks.');
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error); if (window && !window.isDestroyed()) window.destroy(); app.exit(1); }
});
