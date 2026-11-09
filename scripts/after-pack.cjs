const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  const electronPackagePath = require.resolve('electron/package.json', {
    paths: [context.packager.projectDir],
  });
  const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, 'utf8'));
  const electronVersion = String(electronPackage.version || '');
  const source = path.join(context.packager.projectDir, 'build', 'native', `electron-${electronVersion}`, 'better_sqlite3.node');
  const destination = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );

  if (!fs.existsSync(source)) {
    throw new Error(`Falta el binario aislado de better-sqlite3 para Electron: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (fs.statSync(destination).size !== fs.statSync(source).size) {
    throw new Error('El binario de better-sqlite3 no se copió completo al paquete Electron.');
  }
  console.log(`better-sqlite3 para Electron instalado en el paquete: ${destination}`);
};
