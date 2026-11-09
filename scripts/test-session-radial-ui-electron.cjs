const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{let win;try{
win=new BrowserWindow({width:1200,height:900,show:false,webPreferences:{backgroundThrottling:false,offscreen:true}});win.webContents.setFrameRate(30);
const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
const evaluate=script=>win.webContents.executeJavaScript(script);
const waitFor=async script=>{for(let i=0;i<150;i++){if(await evaluate(script))return;await pause(100)}throw new Error('Timed out: '+script)};
const open=async()=>{await evaluate(`document.querySelector('[data-radial-trigger]').click()`);await waitFor(`!!document.querySelector('.session-radial-fan')`);await pause(170);};
const close=async()=>{await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await pause(40);};
const action=label=>evaluate(`document.querySelector('.session-radial [aria-label="${label}"]').click()`);
await win.loadURL(process.env.ARMI_RADIAL_URL);
await waitFor(`!!document.querySelector('[aria-label="Guardar Sesión"]')`);await pause(100);
assert.equal(await evaluate(`!!document.querySelector('.session-radial')`),false,'no floating duplicate at page top');
assert.equal(await evaluate('window.audioContexts'),0,'no audio context at startup');
await evaluate(`window.scrollTo(0,700)`);await waitFor(`!!document.querySelector('.session-radial')`);
assert.ok((await evaluate(`document.querySelector('.session-radial-context').textContent`)).includes('5to B'),'actual grading section in context');
const centre=await evaluate(`(()=>{const r=document.querySelector('[data-radial-trigger]').getBoundingClientRect();return {x:Math.round(r.x+24),y:Math.round(r.y+24)}})()`);
win.webContents.sendInputEvent({type:'mouseMove',x:centre.x,y:centre.y});await waitFor(`!!document.querySelector('.session-radial-fan')`);
assert.equal(await evaluate('window.audioContexts'),0,'hover must be silent');
await close();win.webContents.sendInputEvent({type:'mouseMove',x:10,y:10});await pause(350);
await open();
assert.equal(await evaluate(`document.querySelectorAll('.session-radial-item').length`),8);
assert.equal(await evaluate(`[...document.querySelectorAll('.session-radial-action')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=document.documentElement.clientWidth&&r.bottom<=innerHeight})`),true);
for(const[label,name]of [['Completar con IA Armi','ai'],['Configuración de IA','settings'],['Limpiar Formulario','clear'],['Ver sesiones guardadas','manager'],['Ver Plantilla','template']]){await action(label);assert.equal(await evaluate('window.lastAction'),name);await pause(190);await open();}
await evaluate(`window.audioNotes=[];window.deferSave=true;window.saveResult=true`);await action('Guardar Sesión');await pause(50);
assert.deepEqual(await evaluate('window.audioNotes'),[640],'only click before successful response');
const count=await evaluate('window.saveCalls');await evaluate(`document.querySelector('.session-glass-toolbar [aria-label="Guardando sesión"]').click()`);
await evaluate(`window.finishSave()`);await waitFor(`window.audioNotes.includes(880)`);assert.equal(await evaluate('window.saveCalls'),count,'no duplicate save');
assert.deepEqual(await evaluate('window.audioNotes'),[640,660,880]);await pause(200);
await open();await evaluate(`window.deferSave=false;window.saveResult=false;window.audioNotes=[]`);await action('Guardar Sesión');await pause(200);assert.deepEqual(await evaluate('window.audioNotes'),[640],'failed save must not play confirmation');
await open();await action('Silenciar sonidos');await pause(200);assert.equal(await evaluate(`localStorage.getItem('armi_sessions_action_sound')`),'off');
await open();await evaluate('window.audioNotes=[]');await action('Completar con IA Armi');await pause(200);assert.deepEqual(await evaluate('window.audioNotes'),[],'muted actions are silent');
await open();await action('Activar sonidos');await pause(200);await evaluate('window.audioNotes=[]');
// Real pointer capture and drag: the synthetic click following pointer-up
// must not open the menu or trigger a sound/action.
const before=await evaluate(`(()=>{const r=document.querySelector('.session-radial').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
const x=Math.round(before.x+24),y=Math.round(before.y+24);
win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
win.webContents.sendInputEvent({type:'mouseMove',x:x-200,y:y+120,button:'left'});await pause(80);
win.webContents.sendInputEvent({type:'mouseUp',x:x-200,y:y+120,button:'left',clickCount:1});await pause(80);
const after=await evaluate(`(()=>{const r=document.querySelector('.session-radial').getBoundingClientRect();return {x:r.x,y:r.y}})()`);
assert.ok(after.x<before.x-150&&after.y>before.y+80,'drag must move floating trigger');assert.equal(await evaluate(`!!document.querySelector('.session-radial-fan')`),false,'drag must not open menu');
assert.deepEqual(await evaluate('window.audioNotes'),[],'drag must be silent even with sounds enabled');
await waitFor(`!!localStorage.getItem('armi_sessions_radial_position_v1')`);await pause(500);
await open();await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);await pause(50);assert.equal(await evaluate(`!!document.querySelector('.session-radial-fan')`),false,'outside click closes');
await open();fs.writeFileSync(path.join(process.env.ARMI_RADIAL_ROOT,'radial-desktop.png'),(await win.webContents.capturePage()).toPNG());await close();
await evaluate(`document.querySelector('.session-glass-toolbar [aria-label="Silenciar sonidos"]').click()`);
await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});await waitFor(`!!document.querySelector('.session-glass-toolbar')`);await pause(300);await evaluate(`window.scrollTo(0,700)`);await waitFor(`!!document.querySelector('.session-radial')`);
const restored=await evaluate(`(()=>{const r=document.querySelector('.session-radial').getBoundingClientRect();return {x:r.x,y:r.y}})()`);assert.ok(Math.abs(restored.x-after.x)<2&&Math.abs(restored.y-after.y)<2,'restores dragged position');
assert.equal(await evaluate('window.audioContexts'),0,'muted reload allocates no sound engine');
for(const width of [800,360]){win.setSize(width,700);await pause(150);await open();assert.equal(await evaluate(`[...document.querySelectorAll('.session-radial-action')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=document.documentElement.clientWidth&&r.bottom<=innerHeight})`),true,'radial actions remain in viewport');fs.writeFileSync(path.join(process.env.ARMI_RADIAL_ROOT,`radial-${width}.png`),(await win.webContents.capturePage()).toPNG());await close();}
await evaluate(`window.scrollTo(0,0)`);await waitFor(`!document.querySelector('.session-radial')`);
// The shared control must use unit actions, permissions and preferences without
// introducing a Clear action or changing a session's position/color.
const sessionPosition=await evaluate(`localStorage.getItem('armi_sessions_radial_position_v1')`);
const sessionColor=await evaluate(`localStorage.getItem('armi_sessions_theme')`);
win.setSize(1200,900);await evaluate(`window.setModule('units')`);await waitFor(`!!document.querySelector('[aria-label="Acciones de unidad"]')`);
await pause(150);await evaluate(`window.scrollTo(0,700)`);await waitFor(`!!document.querySelector('.session-radial')`);
await open();assert.equal(await evaluate(`document.querySelectorAll('.session-radial-item').length`),7);
assert.equal(await evaluate(`!!document.querySelector('.session-radial [aria-label="Limpiar Formulario"]')`),false);
await evaluate(`window.lastAction='untouched'`);await action('Gestor de Unidades');await action('Correspondencia');assert.equal(await evaluate('window.lastAction'),'untouched','unit manager/template respect missing stored units');
await evaluate(`window.setUnitsStored(true)`);await pause(30);await action('Gestor de Unidades');assert.equal(await evaluate('window.lastAction'),'unit-manager');await pause(180);await open();await action('Correspondencia');assert.equal(await evaluate('window.lastAction'),'unit-template');await pause(180);
await open();await evaluate(`window.setUnitsReady(false);window.lastAction='untouched'`);await pause(30);await action('Guardar Unidad');assert.equal(await evaluate('window.lastAction'),'untouched','unit save respects missing selections');await evaluate(`window.setUnitsReady(true)`);await close();
await evaluate(`document.querySelector('.session-glass-toolbar [aria-label="Activar sonidos"]').click()`);await pause(30);
await open();await evaluate(`window.audioNotes=[];window.saveResult=true`);await action('Guardar Unidad');await waitFor(`window.audioNotes.includes(880)`);assert.equal(await evaluate('window.lastAction'),'unit-save');await pause(180);
await open();await evaluate(`window.audioNotes=[];window.saveResult=false`);await action('Guardar Unidad');await pause(180);assert.deepEqual(await evaluate('window.audioNotes'),[640],'failed unit save is not confirmed');
await evaluate(`(()=>{const input=document.querySelector('[aria-label="Color de unidades"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#156f65');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await waitFor(`localStorage.getItem('armi_units_theme')==='#156f65'`);assert.equal(await evaluate(`localStorage.getItem('armi_sessions_theme')`),sessionColor);
const unitCentre=await evaluate(`(()=>{const r=document.querySelector('.session-radial').getBoundingClientRect();return {x:Math.round(r.x+24),y:Math.round(r.y+24)}})()`);
win.webContents.sendInputEvent({type:'mouseMove',x:unitCentre.x,y:unitCentre.y});win.webContents.sendInputEvent({type:'mouseDown',x:unitCentre.x,y:unitCentre.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:unitCentre.x-100,y:unitCentre.y+70,button:'left'});await pause(60);win.webContents.sendInputEvent({type:'mouseUp',x:unitCentre.x-100,y:unitCentre.y+70,button:'left',clickCount:1});await waitFor(`!!localStorage.getItem('armi_units_radial_position_v1')`);
assert.equal(await evaluate(`localStorage.getItem('armi_sessions_radial_position_v1')`),sessionPosition,'unit drag must not overwrite session position');await pause(500);await open();
fs.writeFileSync(path.join(process.env.ARMI_RADIAL_ROOT,'radial-unidades.png'),(await win.webContents.capturePage()).toPNG());await close();await evaluate(`window.scrollTo(0,0)`);await waitFor(`!document.querySelector('.session-radial')`);
assert.deepEqual(errors,[]);console.log('OK: intersection/scroll, hover/click, eight actions, save confirmation timing, mute persistence, real drag/click suppression, position restoration, Escape/outside close and responsive edge layout.');win.destroy();app.exit(0);
}catch(error){console.error(error);if(win&&!win.isDestroyed()){try{console.log('UI diagnostics:',await win.webContents.executeJavaScript(`(()=>{const a=document.querySelector('.session-glass-toolbar');const r=a?.getBoundingClientRect();return {scrollY,innerWidth,innerHeight,height:document.documentElement.scrollHeight,toolbar:r?{top:r.top,bottom:r.bottom}:null,active:document.activeElement?.getAttribute('aria-label')}})()`))}catch{}win.destroy();}app.exit(1)}});
