import assert from 'node:assert/strict';
import { compareSyncManifests } from '../backend/sync.js';

const manifest = (digest, entities, generatedAt = '2026-08-27T20:00:00.000Z') => ({
  digest,
  generatedAt,
  summary: { entities },
  files: [{ relativePath: 'database/database-dump.json', size: 100, checksum: digest }],
});

const shared = {
  programaciones: 4,
  unidades: 20,
  sesiones: 118,
  estudiantes: 167,
  egresados: 32,
  rostros: 1,
  evaluaciones: 17129,
  evidencias: 76,
};

const pc2 = manifest('local-current', { ...shared, asistencias: 3338 }, '2026-08-27T20:33:30.000Z');
const driveOlder = manifest('drive-old', { ...shared, asistencias: 3261 }, '2026-08-27T21:07:30.000Z');
const misleadingSaved = manifest('local-current', { ...shared, asistencias: 3338 }, '2026-08-27T20:33:30.000Z');
assert.equal(
  compareSyncManifests(pc2, driveOlder, 'drive_mirror', misleadingSaved),
  'local-newer',
  'Una fecha o huella engañosa no debe ganar a 77 asistencias locales adicionales.',
);

const pc1 = manifest('pc1', { ...shared, asistencias: 3261, evidencias: 21 });
const driveWithEvidence = manifest('drive', { ...shared, asistencias: 3261, evidencias: 22 });
assert.equal(compareSyncManifests(pc1, driveWithEvidence, 'drive_mirror'), 'mirror-newer');

const mixedLocal = manifest('mixed-local', { ...shared, asistencias: 3338, evidencias: 21 });
const mixedDrive = manifest('mixed-drive', { ...shared, asistencias: 3261, evidencias: 22 });
assert.equal(compareSyncManifests(mixedLocal, mixedDrive, 'drive_mirror'), 'diverged');

console.log('OK: prioridad por datos completos probada para PC2, PC1 y cambios cruzados.');
