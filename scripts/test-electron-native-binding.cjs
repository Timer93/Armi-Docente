const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');

const bindingPath = path.resolve(process.argv[2] || '');

app.whenReady().then(() => {
  let database;
  try {
    database = new Database(':memory:', { nativeBinding: bindingPath });
    const result = database.prepare('SELECT 42 AS value').get();
    if (result?.value !== 42) throw new Error('La consulta SQLite de prueba devolvio un resultado inesperado.');
    console.log(`better-sqlite3 funciona en Electron ${process.versions.electron}.`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    try { database?.close(); } catch {}
  }
});
