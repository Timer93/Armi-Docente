const fs = require('node:fs');
const path = require('node:path');

const safeTitle = value => {
  const name = String(value || 'Documento ARMI').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 100).replace(/[. ]+$/, '') || 'Documento ARMI';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `ARMI - ${name}` : name;
};

const createPrintPreviewController = ({ app, BrowserWindow, ipcMain, getMainWindow, log = () => {} }) => {
  const pending = new Map();
  const previews = new Map();
  const temporaryFiles = new Map();
  let disposed = false;
  const cleanup = directory => {
    // Only files created by this controller, never a renderer-supplied path.
    if (!temporaryFiles.has(directory)) return;
    try {
      const file = temporaryFiles.get(directory);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.rmdirSync(directory); temporaryFiles.delete(directory);
    } catch (error) { log('No se pudo retirar el PDF temporal', { message: String(error.message) }); }
  };
  const open = (source, title) => {
    if (disposed || source.isDestroyed()) return Promise.reject(new Error('La vista de origen ya se cerró.'));
    const sourceId = source.id;
    if (pending.has(sourceId)) return pending.get(sourceId);
    const job = (async () => {
      const existing = previews.get(sourceId);
      if (existing && !existing.isDestroyed()) existing.destroy();
      const documentTitle = safeTitle(title || source.getTitle());
      // Wait for the current React frame, fonts and images, without hanging on
      // a broken external resource. Native PDF generation applies @media print.
      await source.executeJavaScript(`(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.race([
          Promise.all([document.fonts?.ready, ...Array.from(document.images).map(image => image.decode?.().catch(() => {}))]),
          new Promise(resolve => setTimeout(resolve, 4000))
        ]);
      })()`);
      const pdf = await source.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
      if (disposed || source.isDestroyed()) throw new Error('La vista de origen ya se cerró.');
      const directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'armi-print-'));
      const file = path.join(directory, `${documentTitle}.pdf`);
      temporaryFiles.set(directory, file);
      let preview;
      try {
        fs.writeFileSync(file, pdf);
        const parent = BrowserWindow.fromWebContents(source);
        preview = new BrowserWindow({
          width: 1150, height: 860, minWidth: 720, minHeight: 540,
          parent: parent && !parent.isDestroyed() ? parent : undefined,
          show: false, autoHideMenuBar: true, title: `Vista previa de impresión · ${documentTitle}`,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, plugins: true }
        });
        previews.set(sourceId, preview);
        preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        preview.webContents.on('will-navigate', event => event.preventDefault());
        preview.on('page-title-updated', event => event.preventDefault());
        preview.once('closed', () => {
          if (previews.get(sourceId) === preview) previews.delete(sourceId);
          cleanup(directory);
        });
        // Chromium's PDF viewer includes page navigation, zoom, save and print.
        await preview.loadFile(file);
        if (disposed || source.isDestroyed() || preview.isDestroyed()) throw new Error('La vista previa se cerró.');
        preview.show(); preview.focus();
        return { success: true };
      } catch (error) {
        if (preview && !preview.isDestroyed()) preview.destroy();
        cleanup(directory); throw error;
      }
    })().finally(() => pending.delete(sourceId));
    pending.set(sourceId, job);
    return job;
  };
  const handler = async (event, options = {}) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) {
      return { success: false, message: 'La impresión solo está disponible desde la ventana principal de ARMI.' };
    }
    try { return await open(event.sender, typeof options.title === 'string' ? options.title : ''); }
    catch (error) {
      log('No se pudo generar la vista previa', { message: String(error.message) });
      return { success: false, message: 'No se pudo preparar la vista previa. Vuelve a intentarlo.' };
    }
  };
  const register = () => ipcMain.handle('print:preview', handler);
  const attach = window => {
    const source = window.webContents;
    const sourceId = source.id;
    source.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && !input.alt && String(input.key).toLowerCase() === 'p') {
        event.preventDefault(); source.send('print:request');
      }
    });
    source.once('destroyed', () => {
      const preview = previews.get(sourceId);
      if (preview && !preview.isDestroyed()) preview.destroy();
    });
  };
  const dispose = () => {
    disposed = true; ipcMain.removeHandler('print:preview');
    for (const preview of previews.values()) if (!preview.isDestroyed()) preview.destroy();
    for (const directory of temporaryFiles.keys()) cleanup(directory);
  };
  return { register, attach, dispose, open, getPreview: sourceId => previews.get(sourceId) };
};

module.exports = { createPrintPreviewController, safeTitle };
