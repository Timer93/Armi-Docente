const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fileURLToPath } = require('node:url');
const { createPrintPreviewController } = require('../electron/print-preview.cjs');
const root = process.env.ARMI_PRINT_TEST_ROOT;
app.setPath('userData', path.join(root, 'profile'));
let source, controller;
class HiddenPreview extends BrowserWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); }
  show() {}
  focus() {}
}
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    source = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.resolve(__dirname, '../electron/preload.cjs') } });
    controller = createPrintPreviewController({ app, BrowserWindow: HiddenPreview, ipcMain, getMainWindow: () => source });
    controller.register(); controller.attach(source);
    for (const [name, orientation, count] of [['vertical', 'portrait', 1], ['horizontal', 'landscape', 2]]) {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Prueba ${name}</title><style>
        @page{size:A4 ${orientation};margin:12mm}body{font-family:Arial;margin:0;color:#172554}.page{break-after:page}.page:last-child{break-after:auto}h1{background:#dbeafe;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #64748b;padding:10px}.print-only{display:none}@media print{.screen-only{display:none}.print-only{display:block}}
        </style></head><body><nav class="screen-only">NO IMPRIMIR MENUS</nav>${Array.from({ length: count }, (_, i) => `<section class="page"><h1>ARMI - Vista ${name} ${i + 1}</h1><p>Documento de prueba de impresión.</p><table><tr><th>Estudiante</th><th>Resultado</th></tr>${Array.from({ length: 7 }, (_, j) => `<tr><td>Estudiante ${j + 1}</td><td>Logro esperado</td></tr>`).join('')}</table><p class="print-only">CONTENIDO PARA IMPRESION</p></section>`).join('')}</body></html>`;
      await source.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const request = source.webContents.executeJavaScript(`window.armiApp.previewPrint({title:${JSON.stringify('Prueba ' + name)}})`);
      const result = await request; assert.equal(result.success, true);
      const preview = controller.getPreview(source.webContents.id); assert(preview);
      const file = fileURLToPath(preview.webContents.getURL());
      assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), '%PDF-');
      fs.copyFileSync(file, path.join(root, name + '.pdf'));
      // Give the built-in PDF viewer time to initialize its embedded guest.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const embed = await preview.webContents.executeJavaScript(`Boolean(document.querySelector('embed[type="application/pdf"]'))`);
      assert.equal(embed, true, 'Native PDF viewer must be loaded, rather than an empty HTML page.');
      preview.destroy(); assert.equal(fs.existsSync(file), false, 'Closing preview removes its temporary PDF.');
      console.log('OK: preview through real IPC, native PDF viewer and cleanup: ' + name);
    }
    const untrusted = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), contextIsolation: true, sandbox: true } });
    await untrusted.loadURL('about:blank');
    assert.equal((await untrusted.webContents.executeJavaScript('window.armiApp.previewPrint()')).success, false);
    untrusted.destroy();
    controller.dispose(); source.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); controller?.dispose();
    if (source && !source.isDestroyed()) source.destroy(); app.exit(1);
  }
});
