import { parentPort } from 'worker_threads';
import { reconcilePortableEvidenceIndex } from '../evidenceStorage.js';

try {
  const result = reconcilePortableEvidenceIndex();
  parentPort?.postMessage({ success: true, result });
} catch (error) {
  parentPort?.postMessage({ success: false, error: String(error?.message || error) });
}
