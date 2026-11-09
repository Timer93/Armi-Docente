import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

const { code } = await transform(fs.readFileSync('utils/driveDetection.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const { getDriveDetectionState } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
assert.equal(getDriveDetectionState(null), 'unknown');
assert.equal(getDriveDetectionState(undefined), 'unknown');
assert.equal(getDriveDetectionState({ detected: false, processRunning: null }), 'unknown');
assert.equal(getDriveDetectionState({ detected: false, installed: true }), 'detected');
assert.equal(getDriveDetectionState({ detected: false, installed: false, processRunning: true }), 'detected');
assert.equal(getDriveDetectionState({ detected: true }), 'detected');
assert.equal(getDriveDetectionState({ detected: false, installed: false, processRunning: false }), 'not-detected');
console.log('OK: missing/failed observations do not claim Drive is absent; executable or running process confirms detection.');
