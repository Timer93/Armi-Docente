const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', event => { if (event.level === 'error') console.log('Renderer:', event.message); });
    const evaluate = script => window.webContents.executeJavaScript(script);
    const waitFor = async script => {
      for (let i = 0; i < 200; i++) { if (await evaluate(script)) return; await pause(100); }
      throw new Error(`Timed out: ${script}`);
    };
    await window.loadURL(process.env.ARMI_EVIDENCE_UI_URL);
    await evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));`);
    await waitFor(`!!document.querySelector('[aria-label^="Ver 2 evidencias de BOBADILLA"]')`);
    assert.equal(await evaluate(`!![...document.querySelectorAll('.armi-evidence-review-pending')].find(el=>el.textContent.includes('Viqueli'))`), true);
    assert.equal(await evaluate(`document.querySelectorAll('.armi-evidence-present').length`), 2, 'Reviewed and pending evidence must both remain highlighted');
    for (const width of [1600, 1100, 800]) {
      window.setSize(width, 1000); await pause(500);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `Page overflow at ${width}`);
      const headerHeight = await evaluate(`document.querySelector('table').getBoundingClientRect().top-document.querySelector('#root>div').getBoundingClientRect().top`);
      assert.ok(headerHeight < 210, `Compact register controls must fit above the table at ${width}: ${headerHeight}px`);
      fs.writeFileSync(path.join(process.env.ARMI_EVIDENCE_UI_ROOT, `register-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
    await evaluate(`fetch('/fixture/reviewed').then(()=>document.dispatchEvent(new Event('visibilitychange')))`);
    await waitFor(`![...document.querySelectorAll('.armi-evidence-review-pending')].some(el=>el.textContent.includes('Viqueli'))`);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label^="Ver 2 evidencias de BOBADILLA"]')`), true, 'Grading must never remove evidence presence');
    await evaluate(`fetch('/fixture/error').then(()=>document.dispatchEvent(new Event('visibilitychange')))`);
    await waitFor(`document.querySelector('[role="status"]')?.textContent.includes('No se pudo actualizar')`);
    assert.equal(await evaluate(`!!document.querySelector('[aria-label^="Ver 2 evidencias de BOBADILLA"]')`), true, 'A failed request must preserve last known evidence');
    await evaluate(`document.querySelector('[aria-label^="Ver 2 evidencias de BOBADILLA"]').click()`);
    await waitFor(`document.body.textContent.includes('Todas las evidencias de la sesión')`);
    await waitFor(`fetch('/last-query').then(r=>r.text()).then(query=>query.startsWith('/api/'))`);
    const query = await evaluate(`fetch('/last-query').then(r=>r.text())`);
    const params = new URL(query, process.env.ARMI_EVIDENCE_UI_URL).searchParams;
    assert.equal(params.get('criteriaId') || '', '', 'The name badge must open all competencies');
    assert.equal(params.get('studentId'), '155');
    await waitFor(`document.body.textContent.includes('area-evidence.txt')&&document.body.textContent.includes('transversal-evidence.txt')`);
    await evaluate(`document.querySelector('[aria-label="Cerrar evidencias"]').click()`);
    const openNL = index => evaluate(`document.querySelector('[aria-label^="Ver 2 evidencias de BOBADILLA"]').closest('tr').querySelectorAll('[aria-label^="Ver evidencias de"]')[${index}].click()`);
    await openNL(0);
    await waitFor(`document.body.textContent.includes('area-evidence.txt')`);
    assert.equal(await evaluate(`document.body.textContent.includes('transversal-evidence.txt')`), false);
    assert.equal(await evaluate(`document.querySelector('[role=dialog]').textContent.includes('Producto del area')`), true);
    assert.equal(await evaluate(`document.querySelector('[role=dialog]').textContent.includes('Producto transversal TIC')`), false);
    await evaluate(`document.querySelector('[aria-label="Cerrar evidencias"]').click()`);
    await openNL(1);
    await waitFor(`document.body.textContent.includes('transversal-evidence.txt')`);
    assert.equal(await evaluate(`document.body.textContent.includes('area-evidence.txt')`), false);
    assert.equal(await evaluate(`document.querySelector('[role=dialog]').textContent.includes('Producto transversal TIC')`), true);
    assert.equal(await evaluate(`document.querySelector('[role=dialog]').textContent.includes('Producto del area')`), false);
    // A delayed area response cannot repaint a transversal dialog opened later.
    await evaluate(`document.querySelector('[aria-label="Cerrar evidencias"]').click();fetch('/fixture/delay')`);
    await openNL(0);
    await waitFor(`fetch('/last-query').then(r=>r.text()).then(query=>new URL(query,location.origin).searchParams.get('criteriaId')?.startsWith('summary::primary::'))`);
    await evaluate(`document.querySelector('[aria-label="Cerrar evidencias"]').click()`);
    await openNL(1);
    await waitFor(`document.body.textContent.includes('transversal-evidence.txt')`);
    await pause(1000);
    assert.equal(await evaluate(`document.body.textContent.includes('area-evidence.txt')`), false, 'Ignore late replies from a previously opened competency');
    window.setSize(1600, 1000); await pause(300);
    fs.writeFileSync(path.join(process.env.ARMI_EVIDENCE_UI_ROOT, 'evidence-transversal.png'), (await window.webContents.capturePage()).toPNG());
    console.log('OK: real register UI, persistent evidence highlight after grading/network failure, all-evidence shortcut, compact header and 1600/1100/800 screenshots.');
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error); if (window && !window.isDestroyed()) window.destroy(); app.exit(1); }
});
