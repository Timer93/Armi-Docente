import { parentPort } from 'worker_threads';
import db from '../db.js';
import { calculateEvidenceRecoveryStatus } from '../evidenceRecoveryInventory.js';
import {
  evidenceRelativePathFromRow,
  evidenceFileMatchesRecord,
  getEvidenceStorageContext,
  resolveEvidenceCandidate,
  resolveEvidenceFilePathDetailed,
} from '../evidenceStorage.js';

const calculate = () => calculateEvidenceRecoveryStatus({
  rows: db.prepare('SELECT * FROM evaluacion_evidencias ORDER BY id').all(),
  context: getEvidenceStorageContext(),
  relativePath: evidenceRelativePathFromRow,
  matches: evidenceFileMatchesRecord,
  resolveCandidate: resolveEvidenceCandidate,
  resolveFile: resolveEvidenceFilePathDetailed,
});

try {
  parentPort?.postMessage({ success: true, data: calculate() });
} catch (error) {
  parentPort?.postMessage({ success: false, error: String(error?.message || error) });
}
