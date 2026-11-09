import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

export const prepareInstallerDatabase = async (sourcePath, destinationPath) => {
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) throw new Error('La copia de instalacion debe estar separada de la base original.');
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const temporary = `${destinationPath}.${crypto.randomUUID()}.tmp`;
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    // SQLite backup includes committed WAL data without changing the source.
    await source.backup(temporary);
    const snapshot = new Database(temporary);
    try {
      // Ship the catalog and schema, never the developer's academic records,
      // credentials or replicated browser settings. Existing profiles are not
      // touched: db.js only seeds when the user's database does not exist.
      const catalogs = new Set(['padron_colegios', 'db_areas', 'db_competencias', 'db_estandares']);
      const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.some(({ name }) => name === 'datos_generales')) {
        snapshot.pragma('foreign_keys = OFF');
        snapshot.transaction(() => {
          for (const { name } of tables) {
            if (!catalogs.has(name)) snapshot.exec(`DELETE FROM "${name.replace(/"/g, '""')}"`);
          }
          if (snapshot.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").get()) snapshot.exec('DELETE FROM sqlite_sequence');
        })();
        snapshot.exec('VACUUM');
      }
      snapshot.pragma('wal_checkpoint(TRUNCATE)');
      snapshot.pragma('journal_mode = DELETE');
      if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('La copia de instalacion no paso la verificacion de integridad.');
    } finally { snapshot.close(); }
    fs.renameSync(temporary, destinationPath);
    return destinationPath;
  } finally { source.close(); }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await prepareInstallerDatabase(path.resolve('database/armi.db'), path.resolve('build/installer-database/armi.db'));
  console.log('Base de instalacion preparada y verificada; originales y respaldos conservados.');
}
