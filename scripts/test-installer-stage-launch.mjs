import assert from 'node:assert/strict';
import { runStage } from './build-installer.mjs';

// Exercise the same runner as dist:win, without building an installer.
await runStage({
  label: 'Prueba de Node con ruta y argumentos con espacios',
  command: process.execPath,
  args: ['-e', 'require("node:assert/strict").equal(process.argv[1], "argumento con espacios");', 'argumento con espacios'],
}, 0);
await runStage({
  label: 'Prueba de npm en Windows',
  command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
  args: ['--version'],
}, 1);
await runStage({
  label: 'Prueba de copia SQLite sobre datos aislados',
  command: process.execPath,
  args: ['scripts/test-installer-database.mjs'],
}, 2);
await assert.rejects(runStage({
  label: 'Ejecutable inexistente de prueba',
  command: 'armi-missing-executable-test.exe', args: [],
}, 3), /No se pudo iniciar la etapa/);
console.log('\nOK: Node, npm, copia SQLite y errores de arranque verificados sin generar instalador.');
