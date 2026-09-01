const { pathToFileURL } = require('url');

const backendEntry = String(process.env.ARMI_BACKEND_ENTRY || '').trim();

if (!backendEntry) {
  console.error('[backend-process] Falta ARMI_BACKEND_ENTRY.');
  process.exit(1);
}

import(pathToFileURL(backendEntry).href).catch((error) => {
  console.error('[backend-process] No se pudo cargar el servidor interno.');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
