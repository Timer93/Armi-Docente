import assert from 'node:assert/strict';
import fs from 'node:fs';
import { minimatch } from 'minimatch';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const included = (file) => pkg.build.files.some((pattern) => !pattern.startsWith('!') && minimatch(file, pattern))
  && !pkg.build.files.some((pattern) => pattern.startsWith('!') && minimatch(file, pattern.slice(1)));
for (const file of ['backend/server.js', 'backend/db.js', 'backend/driveDesktopLauncher.js', 'backend/continuousSyncQueue.js',
  'backend/syncReferenceIdentity.js','backend/identityMigration.js','backend/dataEpochFence.js',
  'electron/main.cjs', 'electron/startup-navigation.cjs', 'dist/index.html', 'src/LOGO3D.png', 'src/Logo_bar.ico', 'src/student-portal-icons/example.svg',
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'backend/FolderPickerHelper/publish/win-x64/FolderPickerHelper.exe']) {
  assert.equal(included(file), true, `Required runtime resource excluded: ${file}`);
}
for (const file of ['database/armi.db', 'database/armi.db-wal', 'database/backups/old.db', 'backend/templates/sesion_aprendizaje.docx',
  'artifacts/migracion-identidades-2026-10-19-v4-03/payload.json',
  'backend/FolderPickerHelper/bin/Release/helper.exe', 'backend/FolderPickerHelper/obj/compiler.tmp', 'components/Sidebar.tsx']) {
  assert.equal(included(file), false, `Duplicate or build material included: ${file}`);
}
const seed = pkg.build.extraResources.find((item) => item.to === 'database');
assert.equal(seed.from, 'build/installer-database');
assert.deepEqual(seed.filter, ['armi.db']);
const templates = pkg.build.extraResources.find((item) => item.to === 'backend/templates');
assert.equal(templates.from, 'backend/templates');
for (const name of ['sesion_aprendizaje.docx', 'unidad_aprendizaje.docx', 'programacion_anual.docx']) {
  assert.ok(fs.existsSync(`${templates.from}/${name}`));
}
assert.ok(pkg.build.extraResources.some((item) => item.to === 'cloudflared/cloudflared.exe'));
assert.equal(pkg.scripts['dist:win'], 'node scripts/build-installer.mjs');
console.log('OK: required resources retained, duplicate seed/templates and build material excluded, manual installer command preserved.');
