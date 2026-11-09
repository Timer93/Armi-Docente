// A renderer may reload to adopt a new data epoch before loadURL settles.
// Electron rejects the superseded navigation with -3 even though its replacement
// is healthy. Wait for that actual document; never stop the backend just for -3.
const loadStartupPage = (window, url, { timeoutMs = 30_000, log = () => {} } = {}) => new Promise((resolve, reject) => {
  const contents = window.webContents;
  const expected = new URL(url);
  let settled = false, aborted = false, timer;
  const matches = () => {
    try {const current = new URL(contents.getURL());return current.origin === expected.origin && current.pathname === expected.pathname && current.search === expected.search;}
    catch {return false;}
  };
  const cleanup = () => {
    clearTimeout(timer);
    contents.removeListener('did-finish-load', finished);
    contents.removeListener('did-fail-load', failed);
    contents.removeListener('render-process-gone', gone);
    window.removeListener('closed', closed);
  };
  const complete = (error, value) => {if(settled)return;settled=true;cleanup();error ? reject(error) : resolve(value);};
  const finished = () => {
    if(!matches())return complete(new Error('La ventana de inicio terminó en una dirección inesperada.'));
    if(aborted)log('Recarga de inicio completada sin detener el backend');
    complete(null,true);
  };
  const failed = (_event, code, description, _validatedURL, isMainFrame) => {
    if(isMainFrame === false)return;
    if(code === -3) {aborted=true;log('Navegación inicial sustituida; esperando la recarga');return;}
    const error=new Error(`No se pudo cargar la ventana: ${description} (${code})`);error.errno=code;complete(error);
  };
  const gone = () => complete(new Error('El proceso de la ventana terminó durante el inicio.'));
  const closed = () => complete(null,false);
  contents.on('did-finish-load',finished);
  contents.on('did-fail-load',failed);
  contents.on('render-process-gone',gone);
  window.once('closed',closed);
  timer=setTimeout(()=>complete(new Error('La ventana no completó su carga dentro del tiempo de inicio.')),timeoutMs);
  try {
    Promise.resolve(window.loadURL(url)).then(()=>{
      if(!settled && matches() && !contents.isLoadingMainFrame())finished();
    },error=>{
      if(settled)return;
      if(error?.code === 'ERR_ABORTED' || error?.errno === -3 || /^ERR_ABORTED \(-3\)/.test(String(error?.message || ''))) {
        aborted=true;log('Navegación inicial cancelada por una recarga; esperando su finalización');
      } else complete(error);
    });
  }catch(error){complete(error);}
});
module.exports={loadStartupPage};
