const { pathToFileURL } = require('url');

const backendEntry = String(process.env.ARMI_BACKEND_ENTRY || '').trim();

if (!backendEntry) {
  console.error('[backend-process] Falta ARMI_BACKEND_ENTRY.');
  process.exit(1);
}

let shutdownRequested = false;
const serverModule = import(pathToFileURL(backendEntry).href);
const shutdown = () => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  // A stuck network operation must not retain a server after its owner exits.
  setTimeout(() => process.exit(1), 8000).unref();
  void serverModule.then(server => server.shutdownServer?.())
    .catch(error => console.error('[backend-process] Cierre incompleto:', error?.message || error))
    .finally(() => process.exit(0));
};
process.parentPort?.on('message', event => {
  if (event.data?.type === 'armi:shutdown') shutdown();
});
const ownerPid = Number(process.env.ARMI_BACKEND_OWNER_PID);
if (Number.isInteger(ownerPid) && ownerPid > 0 && ownerPid !== process.pid) {
  const ownerMonitor = setInterval(() => {
    try { process.kill(ownerPid, 0); }
    catch (error) { if (error.code === 'ESRCH') shutdown(); }
  }, 2000);
  ownerMonitor.unref();
}

serverModule.catch((error) => {
  console.error('[backend-process] No se pudo cargar el servidor interno.');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
