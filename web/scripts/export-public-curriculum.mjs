// Export only the application's shared curricular catalog, never teacher data.
// Explicit columns exclude custom precisions, accounts, files and credentials.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export function publicCurriculum(db) {
  return {
    format:'armi-public-curriculum',version:1,
    areas:db.prepare('SELECT id,area,proposito,enfoque FROM db_areas ORDER BY id').all(),
    competencias:db.prepare('SELECT id,area,competencias,capacidades,grado,desempenos_dcbn FROM db_competencias ORDER BY id').all(),
    estandares:db.prepare('SELECT id,area,competencias,grado,desempenos_dcbn,estandar FROM db_estandares ORDER BY id').all(),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[process.argv.indexOf('--database') + 1];
  if (!process.argv.includes('--database') || !source) throw new Error('Specify --database explicitly.');
  const db = new DatabaseSync(source,{readOnly:true});
  let data;
  try { db.exec('BEGIN'); data = publicCurriculum(db); db.exec('ROLLBACK'); } finally { db.close(); }
  fs.writeFileSync(new URL('../public/curriculum.json',import.meta.url),JSON.stringify(data));
  console.log(JSON.stringify({areas:data.areas.length,competencias:data.competencias.length,estandares:data.estandares.length}));
}
